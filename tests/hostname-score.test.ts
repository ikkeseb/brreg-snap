import { describe, expect, it } from 'vitest';

import {
  decideBand,
  foldNordic,
  generateNordicVariants,
  hostnameLabel,
  normalizeHjemmeside,
  registrableDomain,
  scoreCandidate,
} from '../src/lib/hostname-score.js';
import type { SearchHit } from '../src/types/brreg.js';

function cand(over: Partial<SearchHit> & { navn: string }): SearchHit {
  return {
    organisasjonsnummer: '999999999',
    organisasjonsform: { kode: 'AS' },
    ...over,
  } as SearchHit;
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
    ]) {
      expect(registrableDomain(host), host).toBeUndefined();
    }
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
    // the visited host, so each must earn the full +35 — before
    // normalization they fell through to substr(+12) or prefix(+22)
    // and confident matches landed in the picker.
    const shapes = [
      ['http://www.equinor.com', 'equinor.com'],
      ['https://orkla.com/', 'orkla.com'],
      ['tine.no/om', 'tine.no'],
      ['HTTPS://TINE.NO', 'tine.no'],
      ['tine.no.', 'tine.no'],
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

  it('keeps the substring band for deeper hjemmeside hosts', () => {
    const c = cand({ navn: 'UNRELATED AS', hjemmeside: 'shop.elkjop.no' });
    const { reasons } = scoreCandidate(c, 'unrelated', 'elkjop.no');
    expect(reasons).toContain('hjemmeside=substr(+12)');
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
    expect(decideBand(80, 60)).toBe('auto');
    expect(decideBand(75, 65)).toBe('auto');
  });

  it('returns picker when top score >= 75 but margin < 10', () => {
    expect(decideBand(80, 75)).toBe('picker');
  });

  it('returns picker when top score is in [45, 75)', () => {
    expect(decideBand(50, 30)).toBe('picker');
    expect(decideBand(74, 0)).toBe('picker');
  });

  it('returns none when top score < 45', () => {
    expect(decideBand(40, 0)).toBe('none');
  });

  it('returns none when top score is 0 or negative', () => {
    expect(decideBand(0, 0)).toBe('none');
    expect(decideBand(-5, -10)).toBe('none');
  });

  it('treats missing runner-up as score 0 for the margin check', () => {
    expect(decideBand(80, undefined)).toBe('auto');
    expect(decideBand(70, undefined)).toBe('picker');
  });
});
