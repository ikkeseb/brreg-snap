// Live-contract canary: the brreg API facts the extension relies on,
// asserted against data.brreg.no itself. Weekly in CI (canary.yml) and
// on demand with `pnpm test:live`; see docs/notes/brreg-api.md
// § live-canary.
//
// Responses go through the SHIPPED fetchers (fetchEnhet, fetchRoller, …)
// and helpers (deriveSignals, findRoleHolder, regnskapGap, isValidOrgnr)
// wherever they exist, so a shape change fails here the way it would
// fail in the extension. Raw requests are used only for endpoints the
// code does not expose, or when checking the raw API response shape.
//
// Politeness: every request is sequential with a pause (helpers/live.ts),
// shared between tests with once(), and the last test caps the total.

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  fetchEnhet,
  fetchRegnskap,
  fetchRoller,
  fetchUnderenhet,
  fetchUnderenheter,
  searchEnheter,
  searchEnheterWithParams,
} from '../../src/lib/brreg.js';
import { deriveKonsern, fetchKonsernstruktur } from '../../src/lib/konsern.js';
import type { KonsernNode } from '../../src/types/brreg.js';
import { isValidOrgnr } from '../../src/lib/mod11.js';
import { keyFigures, regnskapGap } from '../../src/lib/regnskap.js';
import { findRoleHolder, isResigned } from '../../src/lib/roller.js';
import { deriveSignals } from '../../src/lib/trust/signals.js';
import type { Enhet, Rolle, RollerResponse, SearchHit } from '../../src/types/brreg.js';
import {
  ER_API,
  REGNSKAP_API,
  getJson,
  getText,
  installLive,
  jobSummary,
  lastStatus,
  once,
  requestLog,
} from './helpers/live.js';

const DNB = '984851006'; // DNB BANK ASA: bank, regnskap 500
const EQUINOR = '923609016'; // EQUINOR ASA: USD accounts, roller with avregistrert
const NORDEA_NUF = '920058817'; // NORDEA BANK ABP NUF
const SLETTET = '989566733'; // ROLS AS, deleted 2026-09-15
const POSTEN_BRING = '984661185'; // more than 100 underenheter
const NOT_REGISTERED = '999999999'; // 404 on every endpoint
const DOCS_NO = 'https://data.brreg.no/enhetsregisteret/api/dokumentasjon/no/index.html';
const DOCS_EN = 'https://data.brreg.no/enhetsregisteret/api/dokumentasjon/en/index.html';
// Newest entry in brreg's Endringslogg when this suite was last reviewed.
// A new entry fails the canary on purpose: read it, adapt the code or
// this suite, then bump the constant.
const ENDRINGSLOGG_NEWEST = '24. Juni, 2026';

const REQUEST_BUDGET = 100;

// --- shared fetches (each at most once per run) ---

const dnb = once(() => fetchEnhet(DNB));
const equinor = once(() => fetchEnhet(EQUINOR));
const equinorRegnskap = once(() => fetchRegnskap(EQUINOR));
const equinorRoller = once(() => fetchRoller(EQUINOR));
const docsNo = once(() => getText(DOCS_NO));

const searchOne = (params: Record<string, string>) =>
  searchEnheterWithParams(new URLSearchParams(params));

// The newest registered ENK. Found live rather than pinned: an ENK's
// orgnr leads straight to a person, and nothing here names one.
const enk = once(async () => {
  const [hit] = await searchOne({
    organisasjonsform: 'ENK',
    sort: 'registreringsdatoEnhetsregisteret,DESC',
    size: '1',
  });
  expect(hit, 'no ENK in the search').toBeDefined();
  return fetchEnhet(hit!.organisasjonsnummer);
});

// Recently bankrupt AS-er, found live: a konkurs estate is wound up and
// deleted within months, so a pinned one goes stale.
const konkursHits = once(() =>
  searchOne({
    konkurs: 'true',
    organisasjonsform: 'AS',
    sort: 'registreringsdatoEnhetsregisteret,DESC',
    size: '3',
  }),
);

const allRoles = (r: RollerResponse): Rolle[] =>
  (r.rollegrupper ?? []).flatMap((g) => g.roller ?? []);

const statusOf = (e: Enhet) =>
  deriveSignals(e, undefined, new Date()).find((s) => s.key === 'status')?.value ?? '';

const seenOrgnrs = new Set<string>();
const remember = (hits: SearchHit[]) => {
  for (const h of hits) seenOrgnrs.add(h.organisasjonsnummer);
  return hits;
};

beforeAll(() => {
  installLive();
});

afterAll(() => {
  vi.unstubAllGlobals();
  jobSummary(`contracts: ${requestLog.length} requests to brreg`);
});

// One test per live API `<!-- SECTION: … -->` anchor, named after it.
const ANCHOR_TESTS: Record<string, () => Promise<void>> = {
  'regnskap-base-url': async () => {
    const r = await equinorRegnskap();
    expect(lastStatus(`${REGNSKAP_API}/${EQUINOR}`)).toBe(200);
    expect(r.items.length).toBeGreaterThan(0);
    // 404 = nothing filed: a brand-new ENK has no regnskap.
    const e = await enk();
    const none = await fetchRegnskap(e.organisasjonsnummer);
    expect(lastStatus(`${REGNSKAP_API}/${e.organisasjonsnummer}`)).toBe(404);
    expect(none).toEqual({ items: [] });
  },

  'regnskap-single-year-only': async () => {
    // TRIPWIRE. Two or more filings means brreg now serves history and
    // the dormant Nøkkeltall trend table (renderNokkeltall's
    // figures.length >= 2 branch) goes live — check it against this
    // data before anything else. CLAUDE.md § standing gotchas.
    const r = await equinorRegnskap();
    expect(
      r.items.length,
      'Equinor regnskap returned more than one year: the dormant trend table would render',
    ).toBe(1);
    const [latest] = r.items;
    expect((latest as { regnskapstype?: string }).regnskapstype).toBe('SELSKAP');
    // `år` does not select an older year: still the latest filing.
    const { status, body } = await getJson<unknown[]>(
      `${REGNSKAP_API}/${EQUINOR}?${new URLSearchParams({ år: '2022' })}`,
    );
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(
      (body![0] as { regnskapsperiode?: { tilDato?: string } }).regnskapsperiode?.tilDato,
    ).toBe(latest!.regnskapsperiode?.tilDato);
  },

  'regnskap-500-unsupported-plan': async () => {
    const r = await fetchRegnskap(DNB);
    expect(lastStatus(`${REGNSKAP_API}/${DNB}`)).toBe(500);
    expect(r.items).toEqual([]);
    expect(r.unavailable).toBe(true);
    // The body stopped naming the plan by 2026-09; either way the NACE
    // code must still classify a bank as special accounts.
    const e = await dnb();
    expect(e.naeringskode1?.kode).toMatch(/^64\.1/);
    expect(regnskapGap(e.naeringskode1?.kode, r.unsupportedPlan)).toBe('special-accounts');
    // The regnskap signal takes the filing year from the Enhet instead.
    expect(e.sisteInnsendteAarsregnskap).toMatch(/^\d{4}$/);
    const cell = deriveSignals(e, r, new Date()).find((s) => s.key === 'regnskap');
    expect(cell?.value).toContain(e.sisteInnsendteAarsregnskap);
  },

  'error-contract': async () => {
    // Search: non-2xx throws, a genuine empty result is [].
    await expect(searchOne({ size: '20000' })).rejects.toThrow(/returned 400/);
    await expect(searchOne({ navn: 'zzqxjvvqqxw' })).resolves.toEqual([]);
    // Detail fetchers keep their documented special cases.
    await expect(fetchEnhet(NOT_REGISTERED)).rejects.toThrow(
      `No entity found for orgnr ${NOT_REGISTERED}.`,
    );
    await expect(fetchRoller(NOT_REGISTERED)).resolves.toEqual({ rollegrupper: [] });
    await expect(fetchUnderenhet(EQUINOR)).resolves.toBeUndefined();
    // underenheter: first 100 rows, true count in `total`.
    const posten = await fetchUnderenheter(POSTEN_BRING);
    expect(posten.items.length).toBe(Math.min(100, posten.total));
    expect(posten.total).toBeGreaterThan(100);
    // A parent with none: no rows, total 0 (no _embedded at all).
    const slettet = await fetchUnderenheter(SLETTET);
    expect(slettet).toEqual({ items: [], total: 0 });
  },

  'no-signatur': async () => {
    const { status } = await getJson(`${ER_API}/enheter/${EQUINOR}/signatur`);
    expect(status).toBe(404);
  },

  'search-drops-dots': async () => {
    // Measured 2026-09-24: the dot is matched literally, not dropped. A
    // legal name with a dot is found by that name and not without it.
    const dotted = remember(
      await searchOne({ navn: 'APOTERA.NO', navnMetodeForSoek: 'FORTLOEPENDE' }),
    );
    expect(dotted.map((h) => h.organisasjonsnummer)).toContain('924572051');
    const undotted = await searchOne({ navn: 'APOTERANO', navnMetodeForSoek: 'FORTLOEPENDE' });
    expect(undotted.map((h) => h.organisasjonsnummer)).not.toContain('924572051');
    // The note's canonical case: nothing is registered under "FINN.no"
    // (the finn.no company is VEND MARKETPLACES AS, formerly FINN NO AS).
    await expect(searchEnheter('FINN.no')).resolves.toEqual([]);
  },

  'konsernstruktur': async () => {
    const top = await getJson<KonsernNode>(`${ER_API}/konsernstruktur/${EQUINOR}`);
    expect(top.status).toBe(200);
    const root = top.body!;
    expect(root.organisasjonsnummer).toBe(EQUINOR);
    expect(root.children?.length).toBeGreaterThan(0);
    const child = root.children![0]!;
    expect(typeof child.nivaa).toBe('number');
    expect(typeof child.knytningsform?.kode).toBe('string');
    expect(typeof child.knytningsform?.beskrivelse).toBe('string');
    expect(typeof child.grunnlag).toBe('string');
    expect(child.parentOrganisasjonsnummer).toBe(EQUINOR);
    // Asking from a subsidiary returns the same tree from the top.
    const fromChild = await getJson<KonsernNode>(
      `${ER_API}/konsernstruktur/${child.organisasjonsnummer}`,
    );
    expect(fromChild.body?.organisasjonsnummer).toBe(EQUINOR);
    // Not in a group → 404.
    const e = await enk();
    const outside = await getJson(`${ER_API}/konsernstruktur/${e.organisasjonsnummer}`);
    expect(outside.status).toBe(404);
  },

  'aarsregnskap-kopi': async () => {
    const { status, body } = await getJson<unknown[]>(
      `${REGNSKAP_API}/aarsregnskap/kopi/${EQUINOR}/aar`,
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body!.every((y) => typeof y === 'string' && /^\d{4}$/.test(y))).toBe(true);
    // PDF copies go back further than the single JSON year.
    expect(body!.length).toBeGreaterThan(1);
    const latest = (await equinorRegnskap()).items[0]!.regnskapsperiode?.tilDato?.slice(0, 4);
    expect(body).toContain(latest);
  },

  'konsernstruktur-duplicates': async () => {
    const root = await fetchKonsernstruktur('886581432'); // AKER ASA
    expect(root).toBeDefined();
    const nodes: KonsernNode[] = [];
    const walk = (node: KonsernNode): void => {
      nodes.push(node);
      for (const child of node.children ?? []) walk(child);
    };
    walk(root!);
    const unique = new Set(nodes.map((node) => node.organisasjonsnummer));
    expect(nodes.length).toBeGreaterThan(unique.size);
    const group = deriveKonsern(root!, '886581432');
    expect(group?.groupSize).toBe(unique.size - 1);
    expect(group?.path.at(-2)?.orgnr).toBe(group?.parent?.orgnr);
    const children = group?.children ?? [];
    expect(new Set(children.map((child) => child.orgnr)).size).toBe(children.length);
  },

  'docs-links': async () => {
    expect((await docsNo()).status).toBe(200);
    expect((await getText(DOCS_EN)).status).toBe(200);
  },
};

describe('docs/notes/brreg-api.md anchors', () => {
  for (const [anchor, run] of Object.entries(ANCHOR_TESTS)) it(anchor, run);

  it('every SECTION anchor in the note has a test here', () => {
    const note = readFileSync(new URL('../../docs/notes/brreg-api.md', import.meta.url), 'utf8');
    const anchors = [...note.matchAll(/<!-- SECTION: ([\w-]+) -->/g)]
      .map((m) => m[1]!)
      // Rate limiting is tested with synthetic 429s in tests/brreg.test.ts;
      // deliberately provoking throttling would abuse the public API.
      .filter((a) => a !== 'live-canary' && a !== 'rate-limit');
    expect(Object.keys(ANCHOR_TESTS).sort()).toEqual(anchors.sort());
  });
});

describe('entity shapes', () => {
  it('DNB 984851006: an active ASA bank', async () => {
    const e = await dnb();
    expect(e.respons_klasse).toBe('Enhet');
    expect(e.organisasjonsform?.kode).toBe('ASA');
    expect(typeof e.harRegistrertAntallAnsatte).toBe('boolean');
    expect(statusOf(e)).toBe('Aktiv');
  });

  it('Equinor 923609016: regnskap in USD', async () => {
    const e = await equinor();
    expect(e.respons_klasse).toBe('Enhet');
    expect(statusOf(e)).toBe('Aktiv');
    const r = await equinorRegnskap();
    const figures = keyFigures(r.items[0]!);
    expect(figures.valuta).toBe('USD');
    expect(figures.year).toMatch(/^\d{4}$/);
    expect(typeof figures.driftsinntekter).toBe('number');
    expect(typeof figures.egenkapital).toBe('number');
  });

  it('a konkurs AS: konkurs flag, date, and a BOBE role naming the bostyrer', async () => {
    const hits = remember(await konkursHits());
    expect(hits.length).toBeGreaterThan(0);
    const e = await fetchEnhet(hits[0]!.organisasjonsnummer);
    expect(e.konkurs).toBe(true);
    expect(e.konkursdato).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(statusOf(e)).toBe('Konkurs');
    // A BOBE role with bostyrer.navn on at least one of the three.
    let bostyrer: string | undefined;
    for (const h of hits) {
      const roller = await fetchRoller(h.organisasjonsnummer);
      const bobe = allRoles(roller).find((r) => r.type.kode === 'BOBE');
      if (typeof bobe?.bostyrer?.navn === 'string' && bobe.bostyrer.navn.trim()) {
        bostyrer = findRoleHolder(roller, 'BOBE');
        break;
      }
    }
    expect(bostyrer, 'no BOBE role with bostyrer.navn among recent konkurs AS-er').toBeTruthy();
  });

  it('a slettet entity 989566733: minimal SlettetEnhet body', async () => {
    const e = await fetchEnhet(SLETTET);
    expect(lastStatus(`${ER_API}/enheter/${SLETTET}`)).toBe(200);
    expect(e.respons_klasse).toBe('SlettetEnhet');
    expect(e.slettedato).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // No konkurs/avvikling/employee fields: status must come from slettedato.
    for (const key of ['konkurs', 'underAvvikling', 'harRegistrertAntallAnsatte'] as const) {
      expect(e).not.toHaveProperty(key);
    }
    expect(statusOf(e)).toBe('Slettet');
  });

  it('an ENK: sole proprietorship, not in a group', async () => {
    const e = await enk();
    expect(e.respons_klasse).toBe('Enhet');
    expect(e.organisasjonsform?.kode).toBe('ENK');
    expect((e as { erIKonsern?: unknown }).erIKonsern).toBe(false);
  });

  it('a NUF (Nordea Bank Abp NUF 920058817)', async () => {
    const e = await fetchEnhet(NORDEA_NUF);
    expect(e.respons_klasse).toBe('Enhet');
    expect(e.organisasjonsform?.kode).toBe('NUF');
    expect(statusOf(e)).toBe('Aktiv');
  });

  it('an underenhet: /underenheter/{orgnr} carries overordnetEnhet', async () => {
    const page = await fetchUnderenheter(DNB);
    expect(page.items.length).toBeGreaterThan(0);
    const first = page.items[0]!;
    const u = await fetchUnderenhet(first.organisasjonsnummer);
    expect(u?.respons_klasse).toBe('Underenhet');
    expect(u?.overordnetEnhet).toBe(DNB);
    remember(page.items);
  });

  it('Equinor roller: avregistrert on the roles, fratraadt gone', async () => {
    const roles = allRoles(await equinorRoller());
    expect(roles.length).toBeGreaterThan(0);
    expect(roles.some((r) => typeof r.avregistrert === 'boolean')).toBe(true);
    expect(roles.filter((r) => 'fratraadt' in r)).toEqual([]);
    // The shipped reader must still find a current daglig leder.
    expect(findRoleHolder(await equinorRoller(), 'DAGL')).toBeTruthy();
    expect(roles.filter(isResigned).every((r) => r.avregistrert === true)).toBe(true);
  });
});

describe('search semantics the resolver depends on', () => {
  it('navn search does not fold Nordic letters (elkjop ≠ elkjøp)', async () => {
    const base = { navnMetodeForSoek: 'FORTLOEPENDE', organisasjonsform: 'AS', size: '20' };
    const ascii = await searchOne({ ...base, navn: 'elkjop' });
    const nordic = remember(
      await searchOne({ ...base, navn: 'elkjøp', sort: 'antallAnsatte,DESC' }),
    );
    expect(nordic.map((h) => h.organisasjonsnummer)).toContain('947054600');
    expect(ascii.map((h) => h.organisasjonsnummer)).not.toContain('947054600');
  });

  it('hjemmeside search is a substring match, not a domain match', async () => {
    const hits = remember(await searchOne({ hjemmeside: 'sbanken.no', size: '20' }));
    const sites = hits.map((h) => (h.hjemmeside ?? '').toLowerCase());
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every((s) => s.includes('sbanken.no'))).toBe(true);
    // e.g. www.handelsbanken.no, www.tidsbanken.no: a match inside a word.
    expect(sites.some((s) => /[a-z0-9]sbanken\.no/.test(s))).toBe(true);
  });

  it('organisasjonsnummer= search returns exactly the listed entities', async () => {
    const hits = remember(await searchOne({ organisasjonsnummer: `${EQUINOR},${DNB}` }));
    expect(hits.map((h) => h.organisasjonsnummer).sort()).toEqual([EQUINOR, DNB].sort());
  });

  it('every orgnr seen passes the shipped mod-11 + 8/9-prefix check', async () => {
    // Runs last in this block: reuses what the tests above fetched.
    if (seenOrgnrs.size === 0) remember(await konkursHits());
    const bad = [...seenOrgnrs].filter((o) => !isValidOrgnr(o));
    expect(bad).toEqual([]);
  });
});

// Additional response-shape contracts used by the 1.4 features.
describe('1.4 contracts', () => {
  it('oppdateringer/enheter: JSON-Patch endringer with includeChanges', async () => {
    // dato format yyyy-MM-ddTHH:mm:ss.SSSZ is exactly toISOString().
    const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({
      organisasjonsnummer: `${EQUINOR},${DNB}`,
      dato: since,
      includeChanges: 'true',
      size: '20',
    });
    const { status, body } = await getJson<{
      _embedded?: {
        oppdaterteEnheter?: {
          oppdateringsid?: number;
          dato?: string;
          organisasjonsnummer?: string;
          endringstype?: string;
          endringer?: { op?: string; path?: string }[];
        }[];
      };
      page?: { totalElements?: number };
    }>(`${ER_API}/oppdateringer/enheter?${params}`);
    expect(status).toBe(200);
    const events = body?._embedded?.oppdaterteEnheter ?? [];
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) {
      expect([EQUINOR, DNB]).toContain(ev.organisasjonsnummer);
      expect(typeof ev.oppdateringsid).toBe('number');
      expect(typeof ev.dato).toBe('string');
      expect(typeof ev.endringstype).toBe('string');
    }
    const patches = events.flatMap((ev) => ev.endringer ?? []);
    expect(patches.length).toBeGreaterThan(0);
    for (const p of patches) {
      expect(['add', 'remove', 'replace', 'move', 'copy', 'test']).toContain(p.op);
      expect(p.path).toMatch(/^\//);
    }
  });

  it('Enhet fields: paategninger, historiskeNavn, erIKonsern, underRekonstruksjonsforhandlingDato', async () => {
    const e = (await equinor()) as Enhet & {
      historiskeNavn?: { navn?: unknown; fraDato?: unknown; tilDato?: unknown }[];
      erIKonsern?: unknown;
    };
    expect(e.erIKonsern).toBe(true);
    expect(Array.isArray(e.paategninger)).toBe(true);
    for (const p of [...(e.paategninger ?? []), ...((await dnb()).paategninger ?? [])]) {
      expect(typeof p.tekst).toBe('string');
    }
    expect(e.historiskeNavn?.length).toBeGreaterThan(0);
    for (const h of e.historiskeNavn ?? []) {
      expect(typeof h.navn).toBe('string');
      expect(typeof h.fraDato).toBe('string');
      expect(typeof h.tilDato).toBe('string');
    }
    expect(e.historiskeNavn?.map((h) => h.navn)).toContain('STATOIL ASA');
    // Rare in live data (no stable sample to pin), so checked against the
    // published Enhet schema instead.
    const { text } = await docsNo();
    expect(text).toContain('"underRekonstruksjonsforhandlingDato":{"type":"string","format":"date"');
  });

  it(`brreg Endringslogg: newest entry is still ${ENDRINGSLOGG_NEWEST}`, async () => {
    // A new entry is how brreg announces changes like the 2026-06-16
    // removal of `fratraadt`. Review it, then bump ENDRINGSLOGG_NEWEST.
    const { text } = await docsNo();
    const at = text.indexOf('data-section-id="section/Endringslogg"');
    expect(at, 'Endringslogg section not found on the docs page').toBeGreaterThan(-1);
    const plain = text
      .slice(at, at + 4000)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
    const newest = plain.match(/\d{1,2}\.\s+\p{L}+,?\s+\d{4}/u)?.[0];
    expect(newest).toBe(ENDRINGSLOGG_NEWEST);
  });
});

it(`stays polite: fewer than ${REQUEST_BUDGET} requests`, () => {
  expect(requestLog.length).toBeLessThan(REQUEST_BUDGET);
});
