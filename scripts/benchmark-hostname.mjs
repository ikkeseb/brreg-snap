// Benchmarks hostname → orgnr resolution against a curated test set,
// using the SHIPPED scoring code (no reimplementation). NOT shipped —
// kept under scripts/ so the next iteration can rerun it.
//
//   node scripts/benchmark-hostname.mjs
//
// It imports the real scoring/banding/variant/label functions from
// src/lib/hostname-score.ts (Node strips the types) and mirrors the
// thin query+pipeline orchestration of src/lib/hostname-search.ts
// runPipeline(). The only thing reproduced here is the brreg query
// construction + fetch (an exact copy of brreg.ts searchEnheterWithParams
// and hostname-search.ts queryBy*). If runPipeline's QUERY shape changes,
// keep the two queryBy* helpers below in sync — the SCORING can no longer
// drift because it is imported, not copied.
//
// Per host it runs Q1 (?hjemmeside), Q2 (?navn FORTLOEPENDE + org-form
// filter), Q3 (drop the filter iff Q1+Q2 yielded zero), scores + bands,
// prints the top candidates, and compares the verdict against an
// expected orgnr (or null = should refuse). The line that matters is
// `auto-WRONG` — it must stay 0.

import { registerHooks } from 'node:module';

// hostname-score.ts imports './punycode.js' (repo convention — tsc and
// Vite map .js specifiers to .ts sources), but Node's type stripping
// does NOT rewrite extensions. Retry relative .js specifiers as .ts so
// the shipped modules load unmodified. Hooks only affect imports made
// AFTER registration, hence the dynamic import below.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (
        err?.code === 'ERR_MODULE_NOT_FOUND' &&
        specifier.startsWith('.') &&
        specifier.endsWith('.js')
      ) {
        return next(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw err;
    }
  },
});

const { decideBand, generateNordicVariants, hostnameLabel, scoreCandidate } =
  await import('../src/lib/hostname-score.ts');

const API = 'https://data.brreg.no/enhetsregisteret/api/enheter';
const MAX_PICKER_CANDIDATES = 4;

const TESTS = [
  // Original test set from QA
  { host: 'shell.no',             expected: '914807077' }, // A/S Norske Shell
  { host: 'orkla.com',            expected: '910747711' }, // ORKLA ASA
  { host: 'tv2.no',               expected: '979484534' }, // TV 2 AS
  { host: 'finansavisen.no',      expected: null        }, // brand ≠ entity
  { host: 'eksfin.no',            expected: null        }, // brand ≠ entity
  { host: 'zalando.no',           expected: null        }, // no NO entity
  { host: 'norden.org',           expected: null        }, // intergov, not in brreg
  { host: 'detnorsketeatret.no',  expected: '921196164' }, // LL DET NORSKE TEATRET
  { host: 'lieoverflate.no',      expected: '918178147' }, // LIE OVERFLATE AS

  // Extended — large well-known NO companies (expected unverified;
  // included to inspect scoring behaviour, not as hard ground truth).
  { host: 'equinor.no',           expected: '923609016' }, // EQUINOR ASA
  { host: 'dnb.no',               expected: '984851006' }, // DNB BANK ASA
  { host: 'nrk.no',               expected: '976390512' }, // NORSK RIKSKRINGKASTING AS
  { host: 'yara.com',             expected: '986228608' }, // YARA INTERNATIONAL ASA
  { host: 'telenor.no',           expected: '982463718' }, // TELENOR ASA
  { host: 'rema1000.no',          expected: '923704290' }, // REMA 1000 AS (guess)
  { host: 'storebrand.no',        expected: '916300484' }, // STOREBRAND ASA
  { host: 'elkjop.no',            expected: '947054600' }, // ELKJØP NORGE AS (correction; orig guess was wrong)
];

// --- query layer (mirrors brreg.ts + hostname-search.ts queryBy*) ---

async function searchEnheterWithParams(params) {
  try {
    const r = await fetch(`${API}?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return [];
    const d = await r.json();
    return d?._embedded?.enheter ?? [];
  } catch {
    return [];
  }
}

async function queryByHjemmeside(host) {
  const bare = host.replace(/^www\./i, '').toLowerCase();
  const variants = [bare, `www.${bare}`];
  const results = await Promise.all(
    variants.map((v) => {
      const params = new URLSearchParams();
      params.set('hjemmeside', v);
      params.set('size', '10');
      return searchEnheterWithParams(params);
    }),
  );
  return results.flat();
}

async function queryByNavn(label, withFilter) {
  const variants = generateNordicVariants(label);
  const results = await Promise.all(
    variants.map((v) => {
      const params = new URLSearchParams();
      params.set('navn', v);
      params.set('navnMetodeForSoek', 'FORTLOEPENDE');
      params.set('size', '20');
      if (withFilter) {
        params.set('organisasjonsform', 'AS,ASA,SA,ORGL,SF');
        params.set('sort', 'antallAnsatte,DESC');
      }
      return searchEnheterWithParams(params);
    }),
  );
  return results.flat();
}

function dedupeByOrgnr(hits) {
  const seen = new Map();
  for (const h of hits) {
    if (!seen.has(h.organisasjonsnummer)) seen.set(h.organisasjonsnummer, h);
  }
  return [...seen.values()];
}

// Mirrors hostname-search.ts runPipeline() (sans the rejected-set path,
// which the benchmark doesn't exercise). Scoring/banding are imported.
async function runPipeline(host, label) {
  const [byHj, byNavn] = await Promise.all([
    queryByHjemmeside(host),
    queryByNavn(label, true),
  ]);
  let candidates = dedupeByOrgnr([...byHj, ...byNavn]);
  if (candidates.length === 0) {
    candidates = dedupeByOrgnr(await queryByNavn(label, false));
  }
  if (candidates.length === 0) return { band: 'none', scored: [] };

  const scored = candidates
    .map((c) => ({ cand: c, ...scoreCandidate(c, label, host) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const runnerUp = scored[1];
  const band = decideBand(top?.score ?? 0, runnerUp?.score);
  return { band, scored };
}

// --- runner ---

const pad = (s, n) => String(s).padEnd(n);

const main = async () => {
  let correctAuto = 0;
  let correctRefuse = 0;
  let wrongAuto = 0;
  let pickerWithRight = 0;
  let pickerWithoutRight = 0;
  let missedRefuse = 0;

  for (const { host, expected } of TESTS) {
    const label = hostnameLabel(host);
    const { band, scored } = label
      ? await runPipeline(host, label)
      : { band: 'none', scored: [] };
    const top = scored[0];
    const expectedLabel = expected ?? '∅ (refuse)';
    console.log(`\n━━━ ${host}  (label=${label ?? '—'})  expected=${expectedLabel}`);
    for (const s of scored.slice(0, 8)) {
      const c = s.cand;
      console.log(
        `  ${pad(s.score, 4)} ${pad(c.organisasjonsnummer, 10)} ${pad(c.organisasjonsform?.kode ?? '', 5)} ` +
          `${pad((c.navn || '').slice(0, 45), 45)} ans=${pad(c.antallAnsatte ?? '-', 4)}`,
      );
    }

    let result;
    if (band === 'auto') {
      const got = top.cand.organisasjonsnummer;
      if (got === expected) {
        result = 'AUTO ✓';
        correctAuto++;
      } else if (expected === null) {
        result = `AUTO ✗ (resolved when should refuse — got ${got})`;
        wrongAuto++;
      } else {
        result = `AUTO ✗ (got ${got}, want ${expected})`;
        wrongAuto++;
      }
    } else if (band === 'picker') {
      const inPicker = scored
        .slice(0, MAX_PICKER_CANDIDATES)
        .some((s) => s.cand.organisasjonsnummer === expected);
      if (expected === null) {
        result = 'PICKER (refuse expected — user-rejectable)';
        correctRefuse++;
      } else if (inPicker) {
        result = 'PICKER ✓ (right answer in top 4)';
        pickerWithRight++;
      } else {
        result = 'PICKER ✗ (right answer NOT in top 4)';
        pickerWithoutRight++;
      }
    } else {
      if (expected === null) {
        result = 'NO-MATCH ✓';
        correctRefuse++;
      } else {
        result = `NO-MATCH ✗ (expected ${expected})`;
        missedRefuse++;
      }
    }
    console.log(`  → ${result}`);
  }

  console.log('\n━━━ summary');
  console.log(`  auto-correct       : ${correctAuto}`);
  console.log(`  refuse-correct     : ${correctRefuse}`);
  console.log(`  picker-with-right  : ${pickerWithRight}`);
  console.log(`  picker-without-rgt : ${pickerWithoutRight}`);
  console.log(`  auto-WRONG         : ${wrongAuto}   <-- must be 0`);
  console.log(`  missed (no-match)  : ${missedRefuse}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
