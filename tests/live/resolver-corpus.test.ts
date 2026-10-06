// Resolver corpus: hostname → company against the live API, through the
// SHIPPED pipeline (searchByHostnameDetailed: real queries, scoring,
// banding, candidate cap). Replaces scripts/benchmark-hostname.mjs,
// which mirrored the query layer by hand.
//
// Each host has one expectation:
//   auto(orgnr)       the right answer; auto must resolve to it
//   pickerOk(orgnr)   several plausible entities; a picker containing it
//                     is right (auto to it is fine too)
//   NONE              no entity to name; auto to anything is wrong
//
// Only auto-wrong fails a test: a confident wrong company is the one
// outcome a user can't see through. Pickers without the right answer and
// misses are counted in the ledger, printed after the run (and written
// to the job summary in CI). Expectations are verified against brreg's
// own record (name and registered hjemmeside) — a host whose right
// answer can't be checked stays out.
//
//   pnpm test:live tests/live/resolver-corpus.test.ts

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { searchByHostnameDetailed } from '../../src/lib/hostname-search.js';
import { installLive, jobSummary, requestLog } from './helpers/live.js';

type Expectation =
  | { kind: 'auto'; orgnr: string }
  | { kind: 'picker-ok'; orgnr: string }
  | { kind: 'none' };

const auto = (orgnr: string): Expectation => ({ kind: 'auto', orgnr });
const pickerOk = (orgnr: string): Expectation => ({ kind: 'picker-ok', orgnr });
const NONE: Expectation = { kind: 'none' };

const CORPUS: { host: string; expect: Expectation; why: string }[] = [
  // The original 17-host benchmark (expectations re-verified 2026-09-24).
  { host: 'shell.no', expect: auto('914807077'), why: 'A/S NORSKE SHELL' },
  { host: 'orkla.com', expect: auto('910747711'), why: 'ORKLA ASA' },
  { host: 'tv2.no', expect: auto('979484534'), why: 'TV 2 AS, hjemmeside www.tv2.no' },
  { host: 'finansavisen.no', expect: NONE, why: 'no entity by that name or hjemmeside' },
  { host: 'eksfin.no', expect: pickerOk('926718304'), why: 'EKSPORTFINANSIERING NORGE (Eksfin); no hjemmeside registered' },
  { host: 'zalando.no', expect: NONE, why: 'no Norwegian entity' },
  { host: 'norden.org', expect: NONE, why: 'intergovernmental, not in brreg' },
  { host: 'detnorsketeatret.no', expect: auto('921196164'), why: 'LL DET NORSKE TEATRET' },
  { host: 'lieoverflate.no', expect: pickerOk('918178147'), why: 'LIE OVERFLATE AS no longer registers the site; the lone holder LIE KOMPETANSE AS must not auto' },
  { host: 'equinor.no', expect: auto('923609016'), why: 'EQUINOR ASA' },
  { host: 'dnb.no', expect: auto('984851006'), why: 'DNB BANK ASA, hjemmeside www.dnb.no' },
  { host: 'nrk.no', expect: pickerOk('976390512'), why: 'NORSK RIKSKRINGKASTING AS; the NRK label also matches NRK-named namesakes' },
  { host: 'yara.com', expect: auto('986228608'), why: 'YARA INTERNATIONAL ASA, hjemmeside www.yara.com' },
  { host: 'telenor.no', expect: auto('982463718'), why: 'TELENOR ASA, hjemmeside www.telenor.no/' },
  { host: 'rema1000.no', expect: pickerOk('982254604'), why: 'REMA 1000 NORGE AS; franchisees also register www.rema1000.no' },
  { host: 'storebrand.no', expect: pickerOk('916300484'), why: 'STOREBRAND ASA among its group companies' },
  { host: 'elkjop.no', expect: auto('947054600'), why: 'ELKJØP NORGE AS' },

  // Hosts the 2026-09 audit found resolving wrongly.
  { host: 'sbanken.no', expect: NONE, why: 'must not auto TIDSBANKEN AS (hjemmeside substring)' },
  { host: 'obos.no', expect: auto('937052766'), why: 'OBOS BBL among 600+ borettslag on www.obos.no' },
  { host: 'medium.com', expect: NONE, why: 'must not auto the Norwegian namesake MEDIUM AS' },
  { host: 'bbc.co.uk', expect: NONE, why: 'must not auto the Norwegian namesake BBC AS' },
  { host: '10thpbergen.com', expect: pickerOk('931396145'), why: 'own company, under avvikling, hjemmeside 10thpbergen.com' },

  // Norwegian SMB retailers: brreg's record carries the host as hjemmeside.
  { host: 'olympiasport.no', expect: auto('988092657'), why: 'OLYMPIA SPORT AS' },
  { host: 'thomasleker.no', expect: auto('988666866'), why: 'THOMAS LEKER HOLDING AS' },
  { host: 'collectible.no', expect: auto('825489452'), why: 'COLLECTIBLE AS' },
  { host: 'gyngehesten.no', expect: auto('919632577'), why: 'GYNGEHESTEN AS' },
  { host: 'apotera.no', expect: auto('924572051'), why: 'APOTERA.NO AS' },
  { host: 'kleins.no', expect: pickerOk('913420837'), why: 'KLEINS AS; six sister shops share www.kleins.no' },
  { host: 'youandi.no', expect: auto('917318409'), why: 'YOU & I RETAIL AS' },
  { host: 'a-mobler.no', expect: auto('910082620'), why: 'A-MØBLER AS' },
  { host: 'oakland.no', expect: auto('931976281'), why: 'OAKLAND HOME AS' },
  { host: 'evoelsykler.no', expect: auto('912413608'), why: 'EVO ELSYKLER AS' },
  { host: 'hillesland.no', expect: auto('945882034'), why: 'HILLESLAND AS' },
  { host: 'hvitevareteknikk.no', expect: auto('988573450'), why: 'HVITEVARETEKNIKK AS' },

  // The two-signal rule (docs/notes/resolution.md § bands), verified
  // against brreg 2026-10-06.
  { host: 'vg.no', expect: auto('950588063'), why: 'VERDENS GANG AS: the only holder, and vg is its initials' },
  { host: 'uio.no', expect: auto('971035854'), why: 'UNIVERSITETET I OSLO: holder, initials' },
  { host: 'danskebank.no', expect: auto('977074010'), why: 'DANSKE BANK A/S NUF: holder, named after the site' },
  { host: 'alnaregnskap.no', expect: auto('994204327'), why: 'ALNA REGNSKAP AS: holder, the name run together' },
  { host: 'craftinghouse.no', expect: auto('995135086'), why: 'CRAFTING HOUSE AS: holder, run together' },
  { host: 'theplayer.no', expect: auto('978643000'), why: 'THE PLAYER AS, beside CLASSIC SPORTSWEAR AS on the same site' },
  { host: 'clemenskraft.no', expect: auto('912511480'), why: 'CLEMENS KRAFT AS among the group\'s power companies on the site' },
  { host: 'if.no', expect: pickerOk('981290666'), why: 'IF SKADEFORSIKRING NUF has no hjemmeside; the lone holder AKERSHUS FORSIKRINGSSENTER AS must not auto' },
  { host: 'adressa.no', expect: pickerOk('992664568'), why: 'ADRESSEAVISEN AS has no hjemmeside; the lone holder is its redaksjonsklubb' },
  { host: 'sparebank1.no', expect: NONE, why: 'nine holders, a factoring company and property SPVs, none of them the bank' },
  { host: 'brekke-eiendom.no', expect: NONE, why: 'seven property SPVs hold it; four BREKKE EIENDOM AS exist, none with a hjemmeside' },
  { host: 'bunnpris.no', expect: NONE, why: 'two local grocers hold it; neither is the chain' },
  { host: 'xxl.no', expect: pickerOk('881932792'), why: 'XXL SPORT & VILLMARK AS (1 955 ansatte) and the shell XXL AS both hold it' },
  { host: 'vitusapotek.no', expect: pickerOk('965336796'), why: 'NORSK MEDISINALDEPOT AS (3 777 ansatte) beside two single pharmacies' },
];

type Verdict =
  | 'auto-correct'
  | 'AUTO-WRONG'
  | 'picker-with-right'
  | 'picker-without-right'
  | 'refused'
  | 'missed';

interface LedgerRow {
  host: string;
  expected: string;
  band: string;
  got: string;
  verdict: Verdict;
}

const ledger: LedgerRow[] = [];

function judge(
  exp: Expectation,
  band: 'auto' | 'picker' | 'none',
  choice: string | undefined,
  candidates: string[],
): Verdict {
  if (band === 'auto') {
    return exp.kind !== 'none' && choice === exp.orgnr ? 'auto-correct' : 'AUTO-WRONG';
  }
  if (exp.kind === 'none') return 'refused';
  if (band === 'picker') {
    return candidates.includes(exp.orgnr) ? 'picker-with-right' : 'picker-without-right';
  }
  return 'missed';
}

beforeEach(() => {
  // Fresh storage per host: no cached band or picker choice carries over.
  installLive();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  const counts = new Map<Verdict, number>();
  for (const row of ledger) counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1);
  const order: Verdict[] = [
    'auto-correct',
    'picker-with-right',
    'refused',
    'picker-without-right',
    'missed',
    'AUTO-WRONG',
  ];
  const summary = order.map((v) => `${v}: ${counts.get(v) ?? 0}`).join(' · ');
  const lines = ledger.map(
    (r) =>
      `| ${r.host} | ${r.expected} | ${r.band} | ${r.got} | ${r.verdict} |`,
  );
  const table = [
    '| host | expected | band | got | verdict |',
    '| --- | --- | --- | --- | --- |',
    ...lines,
  ].join('\n');
  // The ledger: diff it before/after a resolver change.
  console.log(`\nResolver corpus (${ledger.length} hosts, ${requestLog.length} requests)\n${table}\n\n${summary}\n`);
  jobSummary(`### Resolver corpus\n\n${summary}\n\n${table}\n`);
});

describe('resolver corpus (live, shipped pipeline)', () => {
  it.each(CORPUS)('$host', async ({ host, expect: exp, why }) => {
    const result = await searchByHostnameDetailed(host);
    expect(result, `${host}: resolver returned nothing`).toBeDefined();
    const { band, choice, candidates, complete } = result!;
    // An incomplete run means a brreg query failed; the band is a guess.
    expect(complete, `${host}: a brreg query failed`).toBe(true);
    const orgnrs = candidates.map((c) => c.organisasjonsnummer);
    const verdict = judge(exp, band, choice, orgnrs);
    ledger.push({
      host,
      expected: exp.kind === 'none' ? 'none' : `${exp.kind} ${exp.orgnr}`,
      band,
      got: band === 'auto' ? (choice ?? '') : orgnrs.join(' '),
      verdict,
    });
    expect(verdict, `${host} auto-resolved to ${choice} (expected ${exp.kind}; ${why})`).not.toBe(
      'AUTO-WRONG',
    );
  });
});
