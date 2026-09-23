import { describe, expect, it } from 'vitest';

import { deriveKobling, DIRECTORY_DOMAINS } from '../src/lib/trust/kobling.js';
import type { ResolutionMethod } from '../src/lib/resolution-method.js';
import type { Kobling } from '../src/lib/trust/types.js';
import type { Enhet } from '../src/types/brreg.js';
import bbcFixture from './fixtures/brreg/enhet-932324229-bbc.json';
import dnb from './fixtures/brreg/enhet-984851006-dnb.json';
import equinor from './fixtures/brreg/enhet-923609016-equinor.json';
import komplett from './fixtures/brreg/enhet-980213250-komplett.json';

// Live 2026-09-24: BBC AS has no hjemmeside at all (the field is absent).
const bbc = bbcFixture as Enhet;
const SITE_CLAIMS: ResolutionMethod[] = ['url-param', 'url-path', 'title'];
const noHjemmeside = { hjemmeside: undefined };

// The visible part of the signal, for compact expectations.
function shown(k: Kobling | undefined) {
  return k && { kind: k.kind, tone: k.tone, value: k.value, detail: k.detail };
}

describe('deriveKobling — no site in play', () => {
  it.each(['manual', 'drill-in'] as const)('%s has no kobling', (method) => {
    expect(deriveKobling({ method, host: 'www.dnb.no', enhet: dnb })).toBeUndefined();
  });

  it('no host (panel hint, restored history entry) has no kobling', () => {
    expect(deriveKobling({ method: 'url-path', host: undefined, enhet: dnb })).toBeUndefined();
    expect(deriveKobling({ method: 'host-auto', host: '', enhet: dnb })).toBeUndefined();
    expect(deriveKobling({ method: undefined, host: 'dnb.no', enhet: dnb })).toBeUndefined();
  });
});

describe('deriveKobling — registered: the registry ties the site to the company', () => {
  it.each([
    'url-param',
    'url-path',
    'title',
    'host-auto',
    'host-pick',
  ] as const)('%s on the registered site is registered', (method) => {
    const k = deriveKobling({ method, host: 'www.dnb.no', enhet: dnb });
    expect(k).toEqual({
      key: 'kobling',
      label: 'Kobling',
      kind: 'registered',
      tone: 'ok',
      value: 'dnb.no er registrert hjemmeside',
      host: 'www.dnb.no',
      registeredDomain: 'dnb.no',
    });
  });

  it('subdomains compare as the site: nettbank.dnb.no vs www.dnb.no', () => {
    const k = deriveKobling({ method: 'host-auto', host: 'nettbank.dnb.no', enhet: dnb });
    expect(shown(k)).toMatchObject({ kind: 'registered', value: 'dnb.no er registrert hjemmeside' });
    expect(k?.host).toBe('nettbank.dnb.no');
    expect(
      deriveKobling({
        method: 'title',
        host: 'dnb.no',
        enhet: { hjemmeside: 'https://nettbank.dnb.no/login' },
      })?.kind,
    ).toBe('registered');
  });

  it('any of several registered sites counts', () => {
    const enhet = { hjemmeside: 'www.firma.no, https://firma-shop.no/' };
    expect(deriveKobling({ method: 'title', host: 'firma-shop.no', enhet })?.kind).toBe(
      'registered',
    );
  });

  it('multi-part suffixes: shop.firma.co.uk vs www.firma.co.uk', () => {
    const enhet = { hjemmeside: 'www.firma.co.uk' };
    expect(deriveKobling({ method: 'url-path', host: 'shop.firma.co.uk', enhet })?.value).toBe(
      'firma.co.uk er registrert hjemmeside',
    );
  });

  it('IDN sites compare in ACE form and read as typed', () => {
    const k = deriveKobling({
      method: 'host-auto',
      host: 'xn--blbr-roah.no',
      enhet: { hjemmeside: 'www.blåbær.no' },
    });
    expect(shown(k)).toMatchObject({ kind: 'registered', value: 'blåbær.no er registrert hjemmeside' });
  });
});

describe('deriveKobling — the site named the orgnr itself (URL/title)', () => {
  it('the spoof case: a .shop title carrying Equinor’s orgnr is a mismatch', () => {
    const k = deriveKobling({ method: 'title', host: 'trygg-handel-billig.shop', enhet: equinor });
    expect(k).toEqual({
      key: 'kobling',
      label: 'Kobling',
      kind: 'mismatch',
      tone: 'danger',
      value: 'Registrert hjemmeside er equinor.com',
      detail: 'ikke trygg-handel-billig.shop',
      host: 'trygg-handel-billig.shop',
      registeredDomain: 'equinor.com',
    });
  });

  it.each(SITE_CLAIMS)('%s against another registered site is a mismatch', (method) => {
    expect(shown(deriveKobling({ method, host: 'www.equinor.no', enhet: equinor }))).toEqual({
      kind: 'mismatch',
      tone: 'danger',
      value: 'Registrert hjemmeside er equinor.com',
      detail: 'ikke equinor.no',
    });
  });

  it.each(SITE_CLAIMS)('%s with no hjemmeside registered is the site’s own claim', (method) => {
    expect(shown(deriveKobling({ method, host: 'www.butikk.no', enhet: noHjemmeside }))).toEqual({
      kind: 'site-claims',
      tone: 'neutral',
      value: 'Siden oppgir selv dette org.nr',
      detail: 'ingen hjemmeside registrert',
    });
  });

  it('junk in hjemmeside counts as none registered, not as a mismatch', () => {
    for (const hjemmeside of ['ingen', '-', 'post@firma.no', '  ']) {
      expect(deriveKobling({ method: 'title', host: 'butikk.no', enhet: { hjemmeside } })?.kind).toBe(
        'site-claims',
      );
    }
  });

  it.each([...DIRECTORY_DOMAINS])('a company page on %s is a directory lookup', (domain) => {
    const k = deriveKobling({ method: 'url-path', host: `www.${domain}`, enhet: equinor });
    expect(shown(k)).toEqual({
      kind: 'directory',
      tone: 'neutral',
      value: `Oppslag på ${domain}`,
      detail: 'katalogside, ikke selskapets egen',
    });
    expect(k?.registeredDomain).toBe('equinor.com');
  });

  it('brreg’s own lookup subdomain is a directory, even for a company with no site', () => {
    const k = deriveKobling({ method: 'url-path', host: 'virksomhet.brreg.no', enhet: noHjemmeside });
    expect(shown(k)).toMatchObject({ kind: 'directory', value: 'Oppslag på brreg.no' });
  });

  it('a directory’s own company on its own site stays registered', () => {
    const k = deriveKobling({
      method: 'url-path',
      host: 'www.proff.no',
      enhet: { hjemmeside: 'www.proff.no' },
    });
    expect(k?.kind).toBe('registered');
  });

  it('a lookalike of a directory is not a directory', () => {
    expect(deriveKobling({ method: 'title', host: 'proff.no.example.shop', enhet: equinor })?.kind).toBe(
      'mismatch',
    );
    expect(deriveKobling({ method: 'title', host: 'myproff.no', enhet: equinor })?.kind).toBe(
      'mismatch',
    );
  });
});

describe('deriveKobling — found by the hostname search (host-auto)', () => {
  it('komplett.no → KOMPLETT ASA, registered on komplettgroup.com: other site', () => {
    expect(shown(deriveKobling({ method: 'host-auto', host: 'www.komplett.no', enhet: komplett }))).toEqual({
      kind: 'other-site',
      tone: 'warn',
      value: 'Registrert hjemmeside er komplettgroup.com',
      detail: 'funnet via navnet',
    });
  });

  it('bbc.co.uk → BBC AS, no hjemmeside: a guess from the name', () => {
    const k = deriveKobling({ method: 'host-auto', host: 'www.bbc.co.uk', enhet: bbc });
    expect(k).toEqual({
      key: 'kobling',
      label: 'Kobling',
      kind: 'name-guess',
      tone: 'warn',
      value: 'Gjettet ut fra navnet «bbc»',
      detail: 'ingen hjemmeside registrert',
      host: 'www.bbc.co.uk',
    });
  });
});

describe('deriveKobling — picked by the user (host-pick)', () => {
  it('is the user’s choice, whatever the company registered', () => {
    expect(shown(deriveKobling({ method: 'host-pick', host: 'www.komplett.no', enhet: komplett }))).toEqual({
      kind: 'chosen',
      tone: 'neutral',
      value: 'Valgt av deg for komplett.no',
      detail: undefined,
    });
    expect(deriveKobling({ method: 'host-pick', host: 'bbc.co.uk', enhet: bbc })?.kind).toBe(
      'chosen',
    );
  });

  it('unless the registry itself ties the site to it', () => {
    expect(deriveKobling({ method: 'host-pick', host: 'dnb.no', enhet: dnb })?.kind).toBe(
      'registered',
    );
  });
});

describe('deriveKobling — hosting tenants', () => {
  it('the tenant is the site: firma.netlify.app registered on itself', () => {
    const enhet = { hjemmeside: 'https://firma.netlify.app/' };
    expect(deriveKobling({ method: 'title', host: 'firma.netlify.app', enhet })?.kind).toBe(
      'registered',
    );
  });

  it('another tenant on the same platform is another site', () => {
    const enhet = { hjemmeside: 'https://firma.netlify.app/' };
    expect(shown(deriveKobling({ method: 'title', host: 'svindel.netlify.app', enhet }))).toEqual({
      kind: 'mismatch',
      tone: 'danger',
      value: 'Registrert hjemmeside er firma.netlify.app',
      detail: 'ikke svindel.netlify.app',
    });
  });

  it('a bare platform in hjemmeside ties no tenant to the company', () => {
    const enhet = { hjemmeside: 'netlify.app' };
    expect(deriveKobling({ method: 'title', host: 'firma.netlify.app', enhet })?.kind).toBe(
      'site-claims',
    );
  });
});

describe('deriveKobling — hosts without a registrable domain', () => {
  it('an IP host with a URL orgnr still compares, by the bare host', () => {
    expect(shown(deriveKobling({ method: 'url-param', host: '192.168.1.10', enhet: dnb }))).toEqual({
      kind: 'mismatch',
      tone: 'danger',
      value: 'Registrert hjemmeside er dnb.no',
      detail: 'ikke 192.168.1.10',
    });
  });
});
