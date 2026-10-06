import { describe, expect, it } from 'vitest';

import {
  bandScored,
  decideBand,
  foldNordic,
  generateNordicVariants,
  hjemmesideDomains,
  hostnameLabel,
  namedAfterSite,
  normalizeHjemmeside,
  pickerRows,
  registrableDomain,
  scoreCandidate,
  titleSegmentations,
  type ScoredHit,
} from '../src/lib/hostname-score.js';
import type { SearchHit } from '../src/types/brreg.js';

function cand(over: Partial<SearchHit> & { navn: string }): SearchHit {
  return {
    organisasjonsnummer: '999999999',
    organisasjonsform: { kode: 'AS' },
    ...over,
  };
}

describe('foldNordic', () => {
  it('folds ø/Ø to o/O', () => {
    expect(foldNordic('ELKJØP NORGE AS')).toBe('ELKJOP NORGE AS');
    expect(foldNordic('Bjørn')).toBe('Bjorn');
  });

  it('folds å/Å to a/A', () => {
    expect(foldNordic('Ås')).toBe('As');
    expect(foldNordic('FÅ')).toBe('FA');
  });

  it('folds æ/Æ to ae/AE', () => {
    expect(foldNordic('Sæther')).toBe('Saether');
    expect(foldNordic('TÆR')).toBe('TAER');
  });

  it('leaves ASCII strings untouched', () => {
    expect(foldNordic('ORKLA ASA')).toBe('ORKLA ASA');
  });
});

describe('generateNordicVariants', () => {
  it('returns the bare label as the first variant', () => {
    const out = generateNordicVariants('elkjop');
    expect(out[0]).toBe('elkjop');
  });

  it('adds one variant per "o" position substituted with "ø"', () => {
    const out = generateNordicVariants('boot');
    expect(out).toContain('bøot');
    expect(out).toContain('boøt');
  });

  it('adds one variant per "a" position substituted with "å"', () => {
    const out = generateNordicVariants('ban');
    expect(out).toContain('bån');
  });

  it('adds an "ae"→"æ" variant when present', () => {
    const out = generateNordicVariants('saether');
    expect(out).toContain('sæther');
  });

  it('adds an "aa"→"å" variant when present', () => {
    const out = generateNordicVariants('baard');
    expect(out).toContain('bård');
  });

  it('deduplicates — same input twice does not double the set', () => {
    const out = generateNordicVariants('shell');
    const set = new Set(out);
    expect(set.size).toBe(out.length);
  });
});

describe('hostnameLabel', () => {
  it('strips www and TLD, returns the rightmost remaining label', () => {
    expect(hostnameLabel('www.yara.com')).toBe('yara');
    expect(hostnameLabel('yara.com')).toBe('yara');
  });

  it('uses the registrable label for deeper hosts', () => {
    expect(hostnameLabel('shop.mestergruppen.no')).toBe('mestergruppen');
  });

  it('lowercases the result', () => {
    expect(hostnameLabel('NRK.no')).toBe('nrk');
  });

  it('returns undefined for single-label hostnames', () => {
    expect(hostnameLabel('localhost')).toBeUndefined();
  });

  it('returns undefined when the brand label is shorter than 2 chars', () => {
    expect(hostnameLabel('a.no')).toBeUndefined();
  });

  it('steps past multi-part public suffixes to the registrable label', () => {
    // Without the suffix list these would yield "co" / "com" /
    // "kommune" — garbage queries that can only mis-resolve.
    expect(hostnameLabel('company.co.uk')).toBe('company');
    expect(hostnameLabel('www.company.co.uk')).toBe('company');
    expect(hostnameLabel('telstra.com.au')).toBe('telstra');
    expect(hostnameLabel('oslo.kommune.no')).toBe('oslo');
    expect(hostnameLabel('innlandet.fylkeskommune.no')).toBe('innlandet');
  });

  it('uses the part left of a multi-part suffix even on deeper hosts', () => {
    expect(hostnameLabel('shop.company.co.uk')).toBe('company');
  });

  it('returns undefined when the host IS a bare public suffix', () => {
    expect(hostnameLabel('co.uk')).toBeUndefined();
    expect(hostnameLabel('kommune.no')).toBeUndefined();
  });

  it('decodes punycoded IDN labels back to the human brand', () => {
    // `new URL('https://blåbær.no').hostname` → 'xn--blbr-roah.no' —
    // the scorer sees ACE form, but brreg names carry real æ/ø/å.
    expect(hostnameLabel('xn--blbr-roah.no')).toBe('blåbær');
    expect(hostnameLabel('www.xn--blbr-roah.no')).toBe('blåbær');
    expect(hostnameLabel('xn--hndverker-52a.no')).toBe('håndverker');
  });

  it('abstains (undefined) when an xn-- label fails to decode', () => {
    // undefined is the pipeline's abstain signal: resolveInternal in
    // hostname-search.ts treats a falsy label as band 'none', so the
    // sidebar falls through to manual search instead of querying the
    // raw ACE string (which can never match a registered name).
    expect(hostnameLabel('xn--.no')).toBeUndefined(); // empty payload
    expect(hostnameLabel('xn--a-b.no')).toBeUndefined(); // truncated
  });

  it('uses the tenant, not the platform, on hosting-platform subdomains', () => {
    // Before: 'pages' / 'github' / 'myshopify' — queries that could only
    // surface unrelated companies (firma.pages.dev → PRISMATIC PAGES AS).
    expect(hostnameLabel('firma.pages.dev')).toBe('firma');
    expect(hostnameLabel('nrkbeta.github.io')).toBe('nrkbeta');
    expect(hostnameLabel('butikk.myshopify.com')).toBe('butikk');
    expect(hostnameLabel('www.firma.netlify.app')).toBe('firma');
  });

  it('abstains on IP literals and intranet hosts', () => {
    // Before: 192.168.10.20 → '10', jira.corp.internal → 'corp' —
    // both sent to brreg.
    expect(hostnameLabel('192.168.10.20')).toBeUndefined();
    expect(hostnameLabel('172.16.254.100')).toBeUndefined();
    expect(hostnameLabel('jira.corp.internal')).toBeUndefined();
    expect(hostnameLabel('intranet.company.local')).toBeUndefined();
    expect(hostnameLabel('router.home.arpa')).toBeUndefined();
    expect(hostnameLabel('sites.google.com')).toBeUndefined();
  });
});

describe('registrableDomain', () => {
  it('reduces subdomains to the registrable domain', () => {
    expect(registrableDomain('nettbank.dnb.no')).toBe('dnb.no');
    expect(registrableDomain('www.dnb.no')).toBe('dnb.no');
    expect(registrableDomain('dnb.no')).toBe('dnb.no');
    expect(registrableDomain('a.b.c.yara.com')).toBe('yara.com');
  });

  it('keeps one label left of a multi-part public suffix', () => {
    expect(registrableDomain('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('shop.company.co.uk')).toBe('company.co.uk');
    expect(registrableDomain('bydel.oslo.kommune.no')).toBe('oslo.kommune.no');
  });

  it('keeps the tenant on hosting platforms', () => {
    expect(registrableDomain('firma.github.io')).toBe('firma.github.io');
    expect(registrableDomain('blogg.firma.github.io')).toBe('firma.github.io');
    expect(registrableDomain('firma.pages.dev')).toBe('firma.pages.dev');
    expect(registrableDomain('firma.wixsite.com')).toBe('firma.wixsite.com');
  });

  it('normalizes case and a trailing dot', () => {
    expect(registrableDomain('WWW.DNB.NO.')).toBe('dnb.no');
  });

  it('refuses IPv4 and IPv6 literals', () => {
    // `new URL().hostname` shapes: IPv6 stays bracketed, and every IPv4
    // spelling (0x7f.1, 3232235777) is normalized to dotted decimal.
    expect(registrableDomain('192.168.10.20')).toBeUndefined();
    expect(registrableDomain('10.0.0.12')).toBeUndefined();
    expect(registrableDomain('127.0.0.1')).toBeUndefined();
    expect(registrableDomain('[::1]')).toBeUndefined();
    expect(registrableDomain('[2001:db8::1]')).toBeUndefined();
    expect(registrableDomain(new URL('http://3232235777/').hostname)).toBeUndefined();
  });

  it('refuses single-label and intranet/special-use hosts', () => {
    for (const host of [
      'localhost',
      'intranet',
      'printer.local',
      'jira.corp.internal',
      'nas.lan',
      'router.home.arpa',
      'files.home',
      'app.localhost',
      'site.test',
      'www.example',
      'x.invalid',
      'abc.onion',
      // Intranet names on unregistered TLDs, Norwegian spellings too.
      'fileserver.firma.lokal',
      'sharepoint.firma.intern',
      'server.priv',
      'nas.private',
      // The FRITZ!Box router's home-network name.
      'fritz.box',
      'nas.fritz.box',
    ]) {
      expect(registrableDomain(host), host).toBeUndefined();
      expect(hostnameLabel(host), host).toBeUndefined();
    }
  });

  it('refuses only fritz.box on .box, a public TLD', () => {
    expect(registrableDomain('shop.firma.box')).toBe('firma.box');
  });

  it('refuses hosts that are themselves a public suffix', () => {
    expect(registrableDomain('co.uk')).toBeUndefined();
    expect(registrableDomain('kommune.no')).toBeUndefined();
    expect(registrableDomain('github.io')).toBeUndefined();
    expect(registrableDomain('www.github.io')).toBeUndefined();
    // Path-tenant platform: the tenant is in the URL path, never in the
    // host, so the host abstains instead of matching GOOGLE NORWAY AS.
    expect(registrableDomain('sites.google.com')).toBeUndefined();
  });
});

describe('normalizeHjemmeside', () => {
  it('strips scheme and www', () => {
    expect(normalizeHjemmeside('http://www.equinor.com')).toBe('equinor.com');
    expect(normalizeHjemmeside('https://orkla.com')).toBe('orkla.com');
    expect(normalizeHjemmeside('www.tine.no')).toBe('tine.no');
  });

  it('strips path, query, fragment, and trailing slash', () => {
    expect(normalizeHjemmeside('https://orkla.com/')).toBe('orkla.com');
    expect(normalizeHjemmeside('tine.no/om')).toBe('tine.no');
    expect(normalizeHjemmeside('tine.no?lang=no')).toBe('tine.no');
    expect(normalizeHjemmeside('tine.no#main')).toBe('tine.no');
  });

  it('strips ports, trailing dots, whitespace, and lowercases', () => {
    expect(normalizeHjemmeside('tine.no:8080')).toBe('tine.no');
    expect(normalizeHjemmeside('tine.no.')).toBe('tine.no');
    expect(normalizeHjemmeside(' TINE.NO ')).toBe('tine.no');
  });
});

describe('scoreCandidate', () => {
  it('returns 0 for a candidate with neither name nor hjemmeside relation', () => {
    const c = cand({ navn: 'NORDAN AS' });
    const { score } = scoreCandidate(c, 'norden', 'norden.org');
    expect(score).toBe(0);
  });

  it('rewards exact-name match with the highest prefix bonus', () => {
    const c = cand({ navn: 'ORKLA', organisasjonsform: { kode: 'ASA' } });
    const { score } = scoreCandidate(c, 'orkla', 'orkla.com');
    expect(score).toBeGreaterThanOrEqual(73);
  });

  it('scores a 2-word prefix higher than a 4-word prefix', () => {
    const two = cand({ navn: 'ORKLA ASA', organisasjonsform: { kode: 'ASA' } });
    const four = cand({
      navn: 'ORKLA FOODS NORGE AS',
      organisasjonsform: { kode: 'AS' },
    });
    const sTwo = scoreCandidate(two, 'orkla', 'orkla.com').score;
    const sFour = scoreCandidate(four, 'orkla', 'orkla.com').score;
    expect(sTwo).toBeGreaterThan(sFour);
  });

  it('matches Nordic-folded names against an ASCII label', () => {
    const c = cand({
      navn: 'ELKJØP NORGE AS',
      organisasjonsform: { kode: 'AS' },
      antallAnsatte: 2573,
    });
    const { score } = scoreCandidate(c, 'elkjop', 'elkjop.no');
    expect(score).toBeGreaterThan(0);
  });

  it('penalises noise words like VENNELAG', () => {
    const noisy = cand({
      navn: 'SHELL VENNELAG',
      organisasjonsform: { kode: 'FLI' },
    });
    const clean = cand({
      navn: 'A/S NORSKE SHELL',
      organisasjonsform: { kode: 'AS' },
    });
    expect(scoreCandidate(noisy, 'shell', 'shell.no').score).toBeLessThan(
      scoreCandidate(clean, 'shell', 'shell.no').score,
    );
  });

  it('penalises konkurs / underAvvikling', () => {
    const live = cand({ navn: 'TV2 AS', organisasjonsform: { kode: 'AS' } });
    const dead = cand({
      navn: 'TV2 AS',
      organisasjonsform: { kode: 'AS' },
      konkurs: true,
    });
    expect(scoreCandidate(dead, 'tv2', 'tv2.no').score).toBeLessThan(
      scoreCandidate(live, 'tv2', 'tv2.no').score,
    );
  });

  it('does not penalise the site\'s own company when it is winding down', () => {
    // Live shape (10thpbergen.com): the only hit for the host is its own
    // DA, under avvikling. With the -30 it scored 18 and the site showed
    // «Ingen bedrift identifisert» — hiding the one warning that matters.
    const own = cand({
      navn: '10TH PLANET BERGEN JIU JITSU - DA',
      organisasjonsform: { kode: 'DA' },
      hjemmeside: '10thpbergen.com',
      registrertIForetaksregisteret: true,
      underAvvikling: true,
    });
    const { score, reasons } = scoreCandidate(own, '10thpbergen', '10thpbergen.com');
    expect(reasons).not.toContain('inactive(-30)');
    expect(score).toBe(48); // 35 + DA 5 + top-level 12 + foretaksreg 6 - long 10
  });

  it('still penalises a winding-down company tied only by a page on the site', () => {
    // Live shape (nrk.no, name fictitious): an Urørt artist registered
    // a page on nrk.no. That is not the site's own company, so the
    // penalty stays.
    const artist = cand({
      navn: 'EKSEMPELBAND DA',
      organisasjonsform: { kode: 'DA' },
      hjemmeside: 'nrk.no/urort/artist/eksempelband',
      underAvvikling: true,
    });
    const { reasons } = scoreCandidate(artist, 'nrk', 'nrk.no');
    expect(reasons).toContain('hjemmeside=page(+12)');
    expect(reasons).toContain('inactive(-30)');
  });

  it('rewards hjemmeside-exact match even without a name match', () => {
    const c = cand({
      navn: 'UNRELATED MEDIA AS',
      organisasjonsform: { kode: 'AS' },
      hjemmeside: 'finansavisen.no',
    });
    const { score } = scoreCandidate(c, 'unrelated', 'finansavisen.no');
    expect(score).toBeGreaterThan(0);
  });

  it('scores messy-but-exact hjemmeside values as exact, not substring', () => {
    // Brreg's hjemmeside is free text. Every shape below names exactly
    // the visited site, so each must earn the full +35 — before
    // normalization they fell through to a weaker band and confident
    // matches landed in the picker.
    const shapes = [
      ['http://www.equinor.com', 'equinor.com'],
      ['https://orkla.com/', 'orkla.com'],
      ['www.telenor.no/', 'telenor.no'],
      ['HTTPS://TINE.NO', 'tine.no'],
      ['tine.no.', 'tine.no'],
      ['tine.no:8080', 'tine.no'],
      ['tine.no?lang=no', 'tine.no'],
      ['Askertannlegene.no', 'askertannlegene.no'],
    ] as const;
    for (const [hjemmeside, host] of shapes) {
      const c = cand({ navn: 'UNRELATED AS', hjemmeside });
      const { reasons } = scoreCandidate(c, 'unrelated', host);
      expect(reasons, `${hjemmeside} vs ${host}`).toContain(
        'hjemmeside=exact(+35)',
      );
    }
  });

  it('matches a normalized hjemmeside against a www-visited host', () => {
    const c = cand({ navn: 'UNRELATED AS', hjemmeside: 'http://www.tine.no' });
    const { reasons } = scoreCandidate(c, 'unrelated', 'www.tine.no');
    expect(reasons).toContain('hjemmeside=exact(+35)');
  });

  it('keeps the +12 band for a hjemmeside on a subdomain of the site', () => {
    const c = cand({ navn: 'UNRELATED AS', hjemmeside: 'shop.elkjop.no' });
    const { reasons, hjemmesideTie } = scoreCandidate(c, 'unrelated', 'elkjop.no');
    expect(reasons).toContain('hjemmeside=subdomain(+12)');
    expect(hjemmesideTie).toBe(true);
  });

  it('scores a hjemmeside pointing at a page on the site as a page tie', () => {
    // Live shape (storebrand.no): property SPVs and funds register
    // www.storebrand.no/eiendom or /fond. Scored exact, they outranked
    // STOREBRAND ASA and pushed it out of the picker.
    const spv = cand({
      navn: 'STOREBRAND TILLERTORGET AS',
      hjemmeside: 'www.storebrand.no/eiendom',
    });
    const { reasons, hjemmesideTie } = scoreCandidate(spv, 'storebrand', 'storebrand.no');
    expect(reasons).toContain('hjemmeside=page(+12)');
    expect(hjemmesideTie).toBe(true);
    const tine = cand({ navn: 'UNRELATED AS', hjemmeside: 'tine.no/om' });
    expect(scoreCandidate(tine, 'unrelated', 'tine.no').reasons).toContain(
      'hjemmeside=page(+12)',
    );
  });

  it('ties a subdomain visit to the registrable domain\'s hjemmeside', () => {
    // Before, nettbank.dnb.no was compared as a whole host and lost
    // the +35 that dnb.no gets (101 vs 136).
    const dnb = cand({
      navn: 'DNB BANK ASA',
      organisasjonsform: { kode: 'ASA' },
      hjemmeside: 'www.dnb.no',
    });
    const { reasons } = scoreCandidate(dnb, 'dnb', 'nettbank.dnb.no');
    expect(reasons).toContain('hjemmeside=exact(+35)');
  });

  it('matches hjemmeside only on domain-label boundaries', () => {
    // Live hjemmeside values that contain the visited host as a plain
    // substring. None of them is the site: sbanken.no auto-resolved to
    // TIDSBANKEN AS through 'tidsbanken.no'.includes('sbanken.no').
    const cases = [
      ['www.tidsbanken.no', 'sbanken.no'],
      ['www.bovg.no', 'vg.no'],
      ['vg.nordland.no', 'vg.no'],
      ['aaulie.no', 'aulie.no'],
      ['www.lorenskogif.no', 'if.no'],
      ['olapsychicmedium.com', 'medium.com'], // ENK, name fictitious
    ] as const;
    for (const [hjemmeside, host] of cases) {
      const c = cand({ navn: 'UNRELATED AS', hjemmeside });
      const { score, reasons, hjemmesideTie } = scoreCandidate(c, 'nomatch', host);
      expect(reasons, `${hjemmeside} vs ${host}`).toEqual(['no-relation']);
      expect(score).toBe(0);
      expect(hjemmesideTie).toBe(false);
    }
  });

  it('gives TIDSBANKEN AS no hjemmeside credit for sbanken.no', () => {
    // Live shape. The name still carries a substring hit, so it can
    // sit in the picker — but with no tie it can never be AUTO.
    const tidsbanken = cand({
      navn: 'TIDSBANKEN AS',
      organisasjonsnummer: '999582214',
      hjemmeside: 'www.tidsbanken.no',
      antallAnsatte: 54,
      registrertIForetaksregisteret: true,
    });
    const { score, reasons, hjemmesideTie } = scoreCandidate(
      tidsbanken,
      'sbanken',
      'sbanken.no',
    );
    expect(reasons.some((r) => r.startsWith('hjemmeside='))).toBe(false);
    expect(hjemmesideTie).toBe(false);
    expect(score).toBe(63); // was 75 with hjemmeside=substr(+12) → AUTO
  });

  it('reads every entry of a list-shaped hjemmeside', () => {
    const c = cand({
      navn: 'UNRELATED AS',
      hjemmeside: 'www.firma-group.com, www.firma.no; firma.se',
    });
    expect(scoreCandidate(c, 'nomatch', 'firma.no').reasons).toContain(
      'hjemmeside=exact(+35)',
    );
    expect(scoreCandidate(c, 'nomatch', 'firma.se').reasons).toContain(
      'hjemmeside=exact(+35)',
    );
    expect(scoreCandidate(c, 'nomatch', 'firma.dk').score).toBe(0);
  });

  it('flags a name-only candidate as having no hjemmeside tie', () => {
    // Live shape (medium.com): MEDIUM AS, no hjemmeside, no employees.
    const medium = cand({
      navn: 'MEDIUM AS',
      registrertIForetaksregisteret: true,
    });
    const { score, hjemmesideTie } = scoreCandidate(medium, 'medium', 'medium.com');
    expect(score).toBe(81);
    expect(hjemmesideTie).toBe(false);
  });

  it('gives no hjemmeside credit to unrelated hosts', () => {
    // Name must not match the label either, so the no-relation gate
    // is what decides — normalization must not invent a relation
    // between vg.no and tine.no.
    const c = cand({ navn: 'SOMETHING ELSE AS', hjemmeside: 'http://www.vg.no' });
    const { score, reasons } = scoreCandidate(c, 'unrelated', 'tine.no');
    expect(score).toBe(0);
    expect(reasons).toEqual(['no-relation']);
  });

  it('penalises subsidiaries via overordnetEnhet', () => {
    const parent = cand({
      navn: 'YARA INTERNATIONAL ASA',
      organisasjonsform: { kode: 'ASA' },
    });
    const subsidiary = cand({
      navn: 'YARA INTERNATIONAL ASA',
      organisasjonsform: { kode: 'ASA' },
      overordnetEnhet: '123456789',
    });
    expect(scoreCandidate(subsidiary, 'yara', 'yara.com').score).toBeLessThan(
      scoreCandidate(parent, 'yara', 'yara.com').score,
    );
  });

  it('penalises subsidiary keywords like INVEST and FOODS', () => {
    const plain = cand({ navn: 'ORKLA ASA', organisasjonsform: { kode: 'ASA' } });
    const sub = cand({
      navn: 'ORKLA FOODS AS',
      organisasjonsform: { kode: 'AS' },
    });
    expect(scoreCandidate(sub, 'orkla', 'orkla.com').score).toBeLessThan(
      scoreCandidate(plain, 'orkla', 'orkla.com').score,
    );
  });

  it('does NOT penalise NORGE / NORDIC / GROUP as subsidiary keywords', () => {
    const norge = cand({
      navn: 'ELKJØP NORGE AS',
      organisasjonsform: { kode: 'AS' },
      antallAnsatte: 2573,
    });
    const score = scoreCandidate(norge, 'elkjop', 'elkjop.no').score;
    expect(score).toBeGreaterThan(50);
  });
});

describe('decideBand', () => {
  it('returns auto when top score >= 75 and margin >= 10', () => {
    expect(decideBand(80, 60, true)).toBe('auto');
    expect(decideBand(75, 65, true)).toBe('auto');
  });

  it('returns picker when top score >= 75 but margin < 10', () => {
    expect(decideBand(80, 75, true)).toBe('picker');
  });

  it('never returns auto without a hjemmeside tie on the top candidate', () => {
    // medium.com / bbc.co.uk: 81 on the name alone, clear margin — a
    // guess the user has to confirm, not a verified match.
    expect(decideBand(81, 68, false)).toBe('picker');
    expect(decideBand(150, undefined, false)).toBe('picker');
  });

  it('returns picker when top score is in [45, 75)', () => {
    expect(decideBand(50, 30, true)).toBe('picker');
    expect(decideBand(74, 0, true)).toBe('picker');
  });

  it('returns none when top score < 45', () => {
    expect(decideBand(40, 0, true)).toBe('none');
    expect(decideBand(40, 0, false)).toBe('none');
  });

  it('returns none when top score is 0 or negative', () => {
    expect(decideBand(0, 0, true)).toBe('none');
    expect(decideBand(-5, -10, true)).toBe('none');
  });

  it('treats missing runner-up as score 0 for the margin check', () => {
    expect(decideBand(80, undefined, true)).toBe('auto');
    expect(decideBand(70, undefined, true)).toBe('picker');
  });
});

describe('namedAfterSite — the name IS the label, or its initials', () => {
  it('run together, folded, without the legal form at either end', () => {
    expect(namedAfterSite('ALNA REGNSKAP AS', 'alnaregnskap')).toBe(true);
    expect(namedAfterSite('TV 2 AS', 'tv2')).toBe(true);
    expect(namedAfterSite('A-MØBLER AS', 'a-mobler')).toBe(true);
    expect(namedAfterSite('AS BACKE', 'backe')).toBe(true);
    expect(namedAfterSite('DANSKE BANK A/S NUF', 'danskebank')).toBe(true);
    expect(namedAfterSite('LL DET NORSKE TEATRET', 'detnorsketeatret')).toBe(true);
    expect(namedAfterSite('ACME LTD NUF', 'acme')).toBe(true);
  });

  it('the initials of two or more words', () => {
    expect(namedAfterSite('VERDENS GANG AS', 'vg')).toBe(true);
    expect(namedAfterSite('UNIVERSITETET I OSLO', 'uio')).toBe(true);
    expect(namedAfterSite('FESTSPILLENE I BERGEN STI', 'fib')).toBe(true);
  });

  it('nothing of the name may be left over', () => {
    expect(namedAfterSite('XXL SPORT & VILLMARK AS', 'xxl')).toBe(false);
    expect(namedAfterSite('VG CONSULT AS', 'vg')).toBe(false);
    expect(namedAfterSite('AKERSHUS FORSIKRINGSSENTER AS', 'if')).toBe(false);
    // A legal form inside the name is a word of it.
    expect(namedAfterSite('ACME SE AS', 'acme')).toBe(false);
    // Letters outside a–z are kept, not deleted into a false match.
    expect(namedAfterSite('CAF AS', 'café')).toBe(false);
    expect(namedAfterSite('X AS', 'x')).toBe(false);
    // ÅS is a place; only the folded form looks like AS.
    expect(namedAfterSite('ÅS REGNSKAP', 'regnskap')).toBe(false);
    expect(namedAfterSite('ACME LTD', 'acme')).toBe(false);
  });
});

describe('bandScored — an answer needs the tie and the name to agree', () => {
  const scored = (
    label: string,
    host: string,
    ...hits: SearchHit[]
  ): ScoredHit[] =>
    hits.map((c) => ({ cand: c, ...scoreCandidate(c, label, host) }));
  const band = (label: string, host: string, ...hits: SearchHit[]) => {
    const { band, ranked } = bandScored(scored(label, host, ...hits), [label]);
    return { band, names: ranked.map((s) => s.cand.navn) };
  };
  const firm = { registrertIForetaksregisteret: true };

  it('a holder with a run-together name is the answer', () => {
    // 68 on the score alone: the label is no whole word of the name.
    expect(
      band(
        'alnaregnskap',
        'alnaregnskap.no',
        cand({ navn: 'ALNA REGNSKAP AS', hjemmeside: 'alnaregnskap.no', ...firm }),
      ),
    ).toEqual({ band: 'auto', names: ['ALNA REGNSKAP AS'] });
  });

  it('a holder whose initials are the label beats lower name look-alikes', () => {
    expect(
      band(
        'vg',
        'vg.no',
        cand({ navn: 'VG CONSULT AS', organisasjonsnummer: '2', antallAnsatte: 13, ...firm }),
        cand({
          navn: 'VERDENS GANG AS',
          organisasjonsnummer: '1',
          hjemmeside: 'www.vg.no',
          antallAnsatte: 327,
          ...firm,
        }),
      ),
    ).toEqual({ band: 'auto', names: ['VERDENS GANG AS', 'VG CONSULT AS'] });
  });

  it('a named holder answers even with a negative score', () => {
    expect(
      band(
        'bak',
        'bak.no',
        cand({ navn: 'BAKER HUGHES NORGE AS', organisasjonsnummer: '2', antallAnsatte: 900, ...firm }),
        cand({
          navn: 'BERGEN AERO KLUBB',
          organisasjonsnummer: '1',
          organisasjonsform: { kode: 'FLI' },
          hjemmeside: 'bak.no',
        }),
      ),
    ).toMatchObject({ band: 'auto', names: ['BERGEN AERO KLUBB', 'BAKER HUGHES NORGE AS'] });
  });

  it('a named holder is contested by a name match that scores as high', () => {
    // An association holds the site and its initials are the label; the
    // company people mean has no site registered.
    expect(
      band(
        'if',
        'if.no',
        cand({
          navn: 'INTERESSENES FORENING',
          organisasjonsnummer: '1',
          organisasjonsform: { kode: 'FLI' },
          hjemmeside: 'if.no',
        }),
        cand({ navn: 'IF NORGE AS', organisasjonsnummer: '2', antallAnsatte: 1700, ...firm }),
      ),
    ).toEqual({ band: 'picker', names: ['IF NORGE AS', 'INTERESSENES FORENING'] });
  });

  it('a name match without the tie contests at an equal score too', () => {
    const same = { antallAnsatte: 10, ...firm };
    const rows = scored(
      'vg',
      'vg.no',
      cand({ navn: 'VERDENS GANG AS', organisasjonsnummer: '1', hjemmeside: 'vg.no', ...same }),
      cand({ navn: 'VG CONSULT AS', organisasjonsnummer: '2', ...same }),
    );
    expect(rows[0]?.score).toBe(rows[1]?.score);
    expect(bandScored(rows, ['vg']).band).toBe('picker');
  });

  it('a rival counts even when its own score keeps it out of play', () => {
    const rows = scored(
      'bak',
      'bak.no',
      cand({
        navn: 'BERGEN AERO KLUBB',
        organisasjonsnummer: '1',
        organisasjonsform: { kode: 'FLI' },
        hjemmeside: 'bak.no',
      }),
      cand({
        navn: 'BAK KLUBB',
        organisasjonsnummer: '2',
        organisasjonsform: { kode: 'FLI' },
        hjemmeside: 'bak.no/klubb',
      }),
    );
    expect(rows.map((s) => s.score)).toEqual([-28, -3]);
    expect(bandScored(rows, ['bak'])).toMatchObject({
      band: 'picker',
      ranked: [{ cand: { navn: 'BERGEN AERO KLUBB' } }],
    });
  });

  it('two holders that both carry the name need the margin', () => {
    const xxl = (navn: string, nr: string, antallAnsatte?: number) =>
      cand({ navn, organisasjonsnummer: nr, hjemmeside: 'www.xxl.no', antallAnsatte, ...firm });
    // The shell and the operating company, six points apart.
    expect(
      band('xxl', 'xxl.no', xxl('XXL AS', '1'), xxl('XXL SPORT & VILLMARK AS', '2', 1955)).band,
    ).toBe('picker');
    const kleins = (navn: string, nr: string, antallAnsatte: number) =>
      cand({ navn, organisasjonsnummer: nr, hjemmeside: 'www.kleins.no', antallAnsatte, ...firm });
    expect(
      band('kleins', 'kleins.no', kleins('KLEINS CITY SYD AS', '2', 16), kleins('KLEINS AS', '1', 34)),
    ).toEqual({ band: 'auto', names: ['KLEINS AS', 'KLEINS CITY SYD AS'] });
  });

  it('the answer leads the ranking even when another holder scores higher', () => {
    const af = (navn: string, nr: string, kode: string, antallAnsatte: number) =>
      cand({
        navn,
        organisasjonsnummer: nr,
        organisasjonsform: { kode },
        hjemmeside: 'www.afgruppen.no',
        antallAnsatte,
        ...firm,
      });
    const { band: b, ranked } = bandScored(
      scored(
        'afgruppen',
        'afgruppen.no',
        af('AF GRUPPEN NORGE AS', '2', 'AS', 1492),
        { ...af('AF GRUPPEN ASA', '1', 'ASA', 5), overordnetEnhet: undefined },
      ),
      ['afgruppen'],
    );
    expect(b).toBe('auto');
    expect(ranked[0]?.cand.navn).toBe('AF GRUPPEN ASA');
  });

  it('a lone holder without the name is a row, not an answer, beside name matches', () => {
    expect(
      band(
        'if',
        'if.no',
        cand({ navn: 'IF BYGG AS', organisasjonsnummer: '2', ...firm }),
        cand({
          navn: 'AKERSHUS FORSIKRINGSSENTER AS',
          organisasjonsnummer: '1',
          hjemmeside: 'www.if.no',
          antallAnsatte: 23,
          ...firm,
        }),
      ),
    ).toEqual({ band: 'picker', names: ['AKERSHUS FORSIKRINGSSENTER AS', 'IF BYGG AS'] });
  });

  it('several holders without the name: never the one with the shorter name', () => {
    const grocer = (navn: string, nr: string, antallAnsatte: number) =>
      cand({ navn, organisasjonsnummer: nr, hjemmeside: 'www.bunnpris.no', antallAnsatte, ...firm });
    // 86 against 76 only because NÆR-MAT AS is two words.
    expect(
      band('bunnpris', 'bunnpris.no', grocer('NÆR-MAT AS', '1', 17), grocer('SKJERVØY MATGLEDE AS', '2', 23)).band,
    ).toBe('picker');
  });

  it('several holders, the top one a whole-word match: the scores decide as before', () => {
    const shop = (navn: string, nr: string, antallAnsatte: number) =>
      cand({ navn, organisasjonsnummer: nr, hjemmeside: 'www.elkjop.no', antallAnsatte, ...firm });
    expect(
      band('elkjop', 'elkjop.no', shop('ELKJØP NORGE AS', '1', 5000), shop('LEFDAL ELEKTROMARKED AS', '2', 20)),
    ).toMatchObject({ band: 'auto', names: { 0: 'ELKJØP NORGE AS' } });
  });

  it('several holders without the name: one that leads on substance still answers', () => {
    const apotek = (navn: string, nr: string, antallAnsatte: number) =>
      cand({ navn, organisasjonsnummer: nr, hjemmeside: 'www.vitusapotek.no', antallAnsatte, ...firm });
    expect(
      band(
        'vitusapotek',
        'vitusapotek.no',
        apotek('APOTEK MORENEN AS', '2', 6),
        apotek('NORSK MEDISINALDEPOT AS', '1', 3777),
        apotek('APOTEK KIELLANDS HUS AS', '3', 5),
      ),
    ).toMatchObject({ band: 'auto', names: { 0: 'NORSK MEDISINALDEPOT AS' } });
  });

  it('a holder is never dropped: under the threshold or below zero it is a picker row', () => {
    // An ENK with no name match scores 22; today's thresholds say none.
    expect(
      band(
        'alnaregnskap',
        'alnaregnskap.no',
        cand({ navn: 'KARI NORDMANN', organisasjonsform: { kode: 'ENK' }, hjemmeside: 'alnaregnskap.no' }),
      ),
    ).toEqual({ band: 'picker', names: ['KARI NORDMANN'] });
    expect(
      band(
        'adressa',
        'adressa.no',
        cand({
          navn: 'REDAKSJONSKLUBBEN ADRESSEAVISEN',
          organisasjonsform: { kode: 'FLI' },
          hjemmeside: 'adressa.no',
        }),
      ),
    ).toEqual({ band: 'picker', names: ['REDAKSJONSKLUBBEN ADRESSEAVISEN'] });
  });

  it('a name-only company outranks the association holding the site: picker', () => {
    expect(
      band(
        'ikea',
        'ikea.no',
        cand({
          navn: 'IKEA KUNSTFORENING',
          organisasjonsnummer: '2',
          organisasjonsform: { kode: 'FLI' },
          hjemmeside: 'www.ikea.no',
        }),
        cand({ navn: 'IKEA AS', organisasjonsnummer: '1', antallAnsatte: 2842, ...firm }),
      ),
    ).toEqual({ band: 'picker', names: ['IKEA AS', 'IKEA KUNSTFORENING'] });
  });

  it('a clear name-only winner is a picker, never an answer', () => {
    expect(
      band('medium', 'medium.com', cand({ navn: 'MEDIUM AS', antallAnsatte: 600, ...firm })).band,
    ).toBe('picker');
  });

  it('a clear holder with a whole-word name answers on the score, as before', () => {
    expect(
      band(
        'dnb',
        'dnb.no',
        cand({ navn: 'DNB LIVSFORSIKRING AS', organisasjonsnummer: '2' }),
        cand({
          navn: 'DNB BANK ASA',
          organisasjonsnummer: '1',
          organisasjonsform: { kode: 'ASA' },
          hjemmeside: 'www.dnb.no',
          antallAnsatte: 9000,
        }),
      ),
    ).toEqual({ band: 'auto', names: ['DNB BANK ASA', 'DNB LIVSFORSIKRING AS'] });
  });

  it('nothing related is none, with no rows', () => {
    expect(bandScored([], ['shell'])).toEqual({ band: 'none', ranked: [] });
    expect(band('shell', 'shell.no', cand({ navn: 'NORDAN AS' }))).toEqual({
      band: 'none',
      names: [],
    });
    // A positive score under the picker threshold, and no holder.
    const weak = cand({ navn: 'SHELL AS', organisasjonsform: { kode: 'ENK' } });
    expect(scoreCandidate(weak, 'shell', 'shell.no').score).toBe(35);
    expect(band('shell', 'shell.no', weak)).toEqual({ band: 'none', names: [] });
  });
});

describe('pickerRows — the cap keeps a holder in sight', () => {
  const row = (navn: string, score: number, holder = false): ScoredHit => ({
    cand: cand({ navn }),
    score,
    reasons: [],
    hjemmesideTie: holder,
    hjemmesideKind: holder ? 'exact' : undefined,
    wholeWord: !holder,
    nameLength: 0,
  });

  it('takes the best rows, and swaps the weakest for a holder that was cut', () => {
    const ranked = [row('A', 90), row('B', 80), row('C', 70), row('D', 60), row('H', -18, true)];
    expect(pickerRows(ranked, 4).map((s) => s.cand.navn)).toEqual(['A', 'B', 'C', 'H']);
    expect(pickerRows(ranked.slice(0, 3), 4).map((s) => s.cand.navn)).toEqual(['A', 'B', 'C']);
    const withHolder = [row('H', 95, true), ...ranked.slice(0, 4)];
    expect(pickerRows(withHolder, 4).map((s) => s.cand.navn)).toEqual(['H', 'A', 'B', 'C']);
  });
});

describe('titleSegmentations — the title only places spaces', () => {
  it('re-spaces a run-together label at the title’s word boundaries', () => {
    expect(titleSegmentations('rema1000', 'REMA 1000 – Handle mat på nett')).toEqual([
      'rema 1000',
    ]);
    expect(
      titleSegmentations('detnorsketeatret', 'Forestillinger | Det Norske Teatret'),
    ).toEqual(['det norske teatret']);
  });

  it('may carry the title’s æ/ø/å where the ASCII label has the folded form', () => {
    expect(titleSegmentations('bokogdesign', 'Bok og Design Grünerløkka')).toEqual([
      'bok og design',
    ]);
    expect(titleSegmentations('norskbokhandel', 'Nørsk Bokhandel')).toEqual([
      'nørsk bokhandel',
    ]);
    expect(titleSegmentations('blabaerhuset', 'Blåbær Huset – Butikk')).toEqual([
      'blåbær huset',
    ]);
  });

  it('every result is exactly the label with spaces inserted (after folding)', () => {
    const fold = (s: string) => foldNordic(s.toLowerCase());
    const cases: Array<[string, string]> = [
      ['rema1000', 'Velkommen til REMA 1000!'],
      ['detnorsketeatret', 'Det Norske Teatret'],
      ['blabaerhuset', 'Blåbær Huset'],
    ];
    for (const [label, title] of cases) {
      for (const q of titleSegmentations(label, title)) {
        expect(fold(q.replace(/ /g, ''))).toBe(fold(label));
        expect(q).toMatch(/^[\p{L}\p{N}]+( [\p{L}\p{N}]+)+$/u);
      }
    }
  });

  it('returns nothing when the title does not spell the label out', () => {
    // Negative: the words are there but not as one consecutive run.
    expect(titleSegmentations('rema1000', 'REMA butikker – 1000 varer')).toEqual([]);
    expect(titleSegmentations('rema1000', 'Handle mat på nett')).toEqual([]);
    expect(titleSegmentations('rema1000', '')).toEqual([]);
    // A single title word equal to the label adds no boundary.
    expect(titleSegmentations('rema1000', 'Rema1000 kundeklubb')).toEqual([]);
    // A partial run is not enough.
    expect(titleSegmentations('detnorsketeatret', 'Det Norske')).toEqual([]);
    // Extra letters glued on are not the label.
    expect(titleSegmentations('rema1000', 'REMA 10000')).toEqual([]);
  });

  it('leaves labels that already carry a boundary alone', () => {
    expect(titleSegmentations('det-norske-teatret', 'Det Norske Teatret')).toEqual([]);
  });

  it('caps the number of distinct segmentations', () => {
    expect(
      titleSegmentations('abcd', 'ab cd · a bcd · abc d · a b c d'),
    ).toHaveLength(2);
    expect(titleSegmentations('abcd', 'ab cd · ab cd')).toEqual(['ab cd']);
  });
});

describe('hjemmesideDomains — the registrable domains a hjemmeside names', () => {
  it('normalizes scheme, www, path, port and case', () => {
    expect(hjemmesideDomains('http://www.Equinor.com/')).toEqual(['equinor.com']);
    expect(hjemmesideDomains('https://nettbank.dnb.no:443/login')).toEqual(['dnb.no']);
    expect(hjemmesideDomains('www.storebrand.no/eiendom')).toEqual(['storebrand.no']);
  });

  it('splits several sites and dedupes', () => {
    expect(hjemmesideDomains('www.a.no, b.no; https://www.a.no/om c.co.uk')).toEqual([
      'a.no',
      'b.no',
      'c.co.uk',
    ]);
  });

  it('drops junk, e-mail addresses and bare public suffixes', () => {
    expect(hjemmesideDomains('ingen')).toEqual([]);
    expect(hjemmesideDomains('-')).toEqual([]);
    expect(hjemmesideDomains('post@firma.no')).toEqual([]);
    expect(hjemmesideDomains('netlify.app')).toEqual([]);
    expect(hjemmesideDomains('http://')).toEqual([]);
    expect(hjemmesideDomains(undefined)).toEqual([]);
    expect(hjemmesideDomains('')).toEqual([]);
  });

  it('keeps hosting tenants and punycodes IDN spellings', () => {
    expect(hjemmesideDomains('firma.netlify.app')).toEqual(['firma.netlify.app']);
    expect(hjemmesideDomains('www.blåbær.no')).toEqual(['xn--blbr-roah.no']);
  });
});
