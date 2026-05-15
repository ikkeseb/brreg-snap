// Benchmarks the multi-query + scoring strategy for hostname → orgnr
// resolution against a curated test set. NOT shipped — kept under
// scripts/ so the next iteration can rerun it.
//
//   node scripts/benchmark-hostname.mjs
//
// For each test hostname the script:
//   1. Runs Q1 (?hjemmeside=...) with a couple of variants
//   2. Runs Q2 (?navn=...&FORTLOEPENDE&organisasjonsform=AS,ASA
//               &sort=antallAnsatte,DESC)
//   3. Runs Q3 (fallback: drop org-form filter) iff Q1+Q2 yields 0
//   4. Aggregates candidates, scores them, prints the top-5
//   5. Compares the top scorer against an expected orgnr (or null
//      = should refuse to resolve).

const API = 'https://data.brreg.no/enhetsregisteret/api/enheter';

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
  // included to inspect scoring behaviour, not as ground truth).
  { host: 'equinor.no',           expected: '923609016' }, // EQUINOR ASA
  { host: 'dnb.no',               expected: '984851006' }, // DNB BANK ASA
  { host: 'nrk.no',               expected: '976390512' }, // NORSK RIKSKRINGKASTING AS
  { host: 'yara.com',             expected: '986228608' }, // YARA INTERNATIONAL ASA
  { host: 'telenor.no',           expected: '982463718' }, // TELENOR ASA
  { host: 'rema1000.no',          expected: '923704290' }, // REMA 1000 AS (guess)
  { host: 'storebrand.no',        expected: '916300484' }, // STOREBRAND ASA
  { host: 'elkjop.no',            expected: '947054600' }, // ELKJØP NORGE AS (correction; orig guess was wrong)
];

// ---------- query helpers ----------

const fetchJson = async (url) => {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) return { _embedded: { enheter: [] } };
  return r.json();
};

const extractEnheter = (resp) => resp?._embedded?.enheter ?? [];

const queryByHjemmeside = async (host) => {
  const bare = host.replace(/^www\./, '');
  const variants = [bare, `www.${bare}`];
  const results = await Promise.all(
    variants.map((v) =>
      fetchJson(`${API}?hjemmeside=${encodeURIComponent(v)}&size=10`),
    ),
  );
  return results.flatMap(extractEnheter).map((e) => ({ ...e, _source: 'hjemmeside' }));
};

const hostnameLabel = (host) => {
  const bare = host.replace(/^www\./, '');
  const parts = bare.split('.');
  // drop TLD; "co.uk"-style double TLDs are rare for NO, ignore
  parts.pop();
  return parts[parts.length - 1];
};

// Hostnames cannot carry Nordic letters (ø/å/æ), so the label is the
// ASCII shadow of the legal name. Brreg search does NOT fold these:
// ?navn=elkjop returns 0, ?navn=elkjøp returns ELKJØP NORGE AS (2573
// employees). We expand the label with one-character substitutions to
// catch this — capped at a few variants per label.
const generateNordicVariants = (label) => {
  const out = new Set([label]);
  // Single o → ø and a → å per position. ASCII order is preserved so
  // the original label is tried first.
  for (let i = 0; i < label.length; i++) {
    if (label[i] === 'o') out.add(label.slice(0, i) + 'ø' + label.slice(i + 1));
    if (label[i] === 'a') out.add(label.slice(0, i) + 'å' + label.slice(i + 1));
  }
  if (label.includes('ae')) out.add(label.replace(/ae/g, 'æ'));
  if (label.includes('aa')) out.add(label.replace(/aa/g, 'å'));
  return [...out];
};

const queryByNavn = async (label, opts = {}) => {
  const { withFilter = true } = opts;
  const variants = generateNordicVariants(label);
  const responses = await Promise.all(
    variants.map((v) => {
      const params = new URLSearchParams({
        navn: v,
        navnMetodeForSoek: 'FORTLOEPENDE',
        size: '20',
      });
      if (withFilter) {
        params.set('organisasjonsform', 'AS,ASA,SA,ORGL,SF');
        params.set('sort', 'antallAnsatte,DESC');
      }
      return fetchJson(`${API}?${params}`);
    }),
  );
  return responses.flatMap(extractEnheter).map((e) => ({
    ...e,
    _source: withFilter ? 'navn+filter' : 'navn-fallback',
  }));
};

// ---------- scoring ----------

// Words that strongly suggest a satellite organisation (vennelag,
// pensjonskasse, klubb, etc.) rather than the operating company.
const NOISE_WORDS = [
  'VENNELAG', 'VENNER', 'PENSJONSKASSE', 'KLUBB', 'FORENING',
  'STIFTELSEN', 'SUPPORTER', 'ANSATTES', 'SENIOR', 'BEDRIFTSIDRETT',
  'IDRETTSLAG', 'KORPS', 'ARBEIDERLAG', 'VETERAN',
];

// Words that suggest the candidate is a subsidiary/division. Note that
// NORGE / NORWAY / NORDIC / INTERNATIONAL / GROUP / GRUPPEN / HOLDING
// are intentionally NOT here — they routinely name the country-level
// operating company (ELKJØP NORGE AS, YARA NORGE AS) or the group
// parent itself (ELKJØP NORDIC AS, YARA INTERNATIONAL ASA).
const SUBSIDIARY_KEYWORDS = [
  'SVERIGE', 'DANMARK', 'FINLAND',
  'FINANCE', 'FINANS', 'INVEST',
  'FOODS', 'HEALTH', 'SNACKS', 'CARE', 'EIENDOM', 'PROPERTY',
  'ASIA', 'EUROPE', 'GLOBAL', 'IT',
];

const ORG_FORM_WEIGHTS = {
  AS: 15, ASA: 28, SA: 12, ORGL: 18, SF: 18,
  DA: 5, ANS: 5,
  FLI: -35, STI: -20, ENK: -25, PERS: -50, NUF: -10, UTLA: -15, PK: -30,
};

// Fold Nordic letters to ASCII for matching: Ø→O, Å→A, Æ→AE. Brreg
// stores names with Nordic letters; hostnames cannot carry them, so the
// label is always ASCII. Without folding, "elkjop" would never match
// "ELKJØP NORGE AS".
const foldNordic = (s) => s
  .replace(/Ø/g, 'O').replace(/ø/g, 'o')
  .replace(/Å/g, 'A').replace(/å/g, 'a')
  .replace(/Æ/g, 'AE').replace(/æ/g, 'ae');

const scoreCandidate = (cand, label, host) => {
  const navn = foldNordic((cand.navn || '').toUpperCase());
  const labelU = foldNordic(label.toUpperCase());
  const formKode = cand.organisasjonsform?.kode || '';

  const reasons = [];

  // Name matching against the hostname label — the load-bearing signal.
  // Prefix bonus is scaled by how much of the name the label fills, so
  // ORKLA matches ORKLA ASA more strongly than ORKLA FOODS NORGE AS.
  const wordCount = navn.split(/\s+/).length;
  let nameScore = 0;
  if (navn.startsWith(labelU + ' ') || navn === labelU) {
    const ratioBonus = Math.round(20 * (1 / wordCount));
    nameScore = 28 + ratioBonus;
    reasons.push(`prefix(+28+ratio${ratioBonus})`);
  } else if (navn.startsWith(labelU)) {
    nameScore = 22;
    reasons.push('weak-prefix(+22)');
  } else if (navn.includes(' ' + labelU + ' ') || navn.endsWith(' ' + labelU)) {
    nameScore = 28;
    reasons.push('word(+28)');
  } else if (navn.includes(labelU)) {
    nameScore = 12;
    reasons.push('substr(+12)');
  }

  // Hjemmeside-felt match. Weighted lower than before: small associations
  // populate this field more often than parent companies (SHELL VETERANENE,
  // VENNER AV DET NORSKE TEATERET), and drift companies have it too
  // (LIE KOMPETANSE AS for lieoverflate.no). It's a confirming signal,
  // not a primary one.
  const hjem = (cand.hjemmeside || '').toLowerCase();
  const bareHost = host.replace(/^www\./, '');
  let hjemScore = 0;
  if (hjem) {
    if (hjem === bareHost || hjem === `www.${bareHost}`) {
      hjemScore = 35;
      reasons.push(`hjemmeside=exact(+35)`);
    } else if (hjem.startsWith(bareHost) || hjem.startsWith(`www.${bareHost}`)) {
      hjemScore = 22;
      reasons.push(`hjemmeside=prefix(+22)`);
    } else if (hjem.includes(bareHost)) {
      hjemScore = 12;
      reasons.push(`hjemmeside=substr(+12)`);
    }
  }

  // Hard gate: a candidate with NEITHER a name match nor a hjemmeside
  // match doesn't deserve consideration. This kills norden.org's
  // NORDAN AS / TORGHATTEN NORD AS false positives where the candidate
  // shares an org form and high employee count but has no actual
  // relation to the query.
  if (nameScore === 0 && hjemScore === 0) {
    return { score: 0, reasons: ['no-relation'] };
  }

  let score = nameScore + hjemScore;

  // Org form bias. ASA is rare enough that it's a strong parent-co
  // signal (ORKLA ASA vs ORKLA FOODS NORGE AS).
  const formBonus = ORG_FORM_WEIGHTS[formKode] ?? 0;
  if (formBonus) {
    score += formBonus;
    reasons.push(`form=${formKode}(${formBonus >= 0 ? '+' : ''}${formBonus})`);
  }

  // Parent-company signal: not a subsidiary. The /enheter response
  // includes overordnetEnhet as a string orgnr when applicable, or
  // omits it when the entity is top-level.
  if (!cand.overordnetEnhet) {
    score += 12;
    reasons.push('top-level(+12)');
  } else {
    score -= 6;
    reasons.push(`subsidiary(-6)`);
  }

  // Employee signal. Capped so that a giant subsidiary doesn't always
  // beat a smaller parent company.
  const ansatte = cand.antallAnsatte ?? 0;
  if (ansatte >= 500) { score += 20; reasons.push(`ansatte>=500(+20)`); }
  else if (ansatte >= 100) { score += 15; reasons.push(`ansatte>=100(+15)`); }
  else if (ansatte >= 10) { score += 8; reasons.push(`ansatte>=10(+8)`); }
  else if (ansatte >= 1) { score += 3; reasons.push(`ansatte>=1(+3)`); }

  // Subsidiary keywords in the name → likely a daughter company. Only
  // penalise when the label is already matched, otherwise we'd hit
  // unrelated entities that happen to contain these words.
  if (nameScore > 0) {
    const matchedSub = SUBSIDIARY_KEYWORDS.find(
      (w) => navn.includes(' ' + w) || navn.includes(w + ' '),
    );
    if (matchedSub) {
      score -= 15;
      reasons.push(`subsidiary-kw=${matchedSub}(-15)`);
    }
  }

  // Foretaksregisteret presence → real commercial activity.
  if (cand.registrertIForetaksregisteret) {
    score += 6;
    reasons.push(`foretaksreg(+6)`);
  }

  // Noise penalty.
  const matchedNoise = NOISE_WORDS.find((w) => navn.includes(w));
  if (matchedNoise) {
    score -= 40;
    reasons.push(`noise=${matchedNoise}(-40)`);
  }

  // Name length: prefer concise names over long compound names. The
  // parent company is usually shorter than its satellites.
  if (wordCount >= 5) {
    score -= 10;
    reasons.push(`long(${wordCount}w)(-10)`);
  } else if (wordCount === 2) {
    score += 10;
    reasons.push(`short(2w)(+10)`);
  } else if (wordCount === 1) {
    score += 5;
    reasons.push(`short(1w)(+5)`);
  }

  // Konkurs / under avvikling: zero out.
  if (cand.konkurs || cand.underAvvikling) {
    score -= 30;
    reasons.push(`inactive(-30)`);
  }

  return { score, reasons };
};

// ---------- pipeline ----------

const resolveHostname = async (host) => {
  const label = hostnameLabel(host);

  const [byHj, byNavn] = await Promise.all([
    queryByHjemmeside(host),
    queryByNavn(label, { withFilter: true }),
  ]);

  let candidates = [...byHj, ...byNavn];

  if (candidates.length === 0) {
    candidates = await queryByNavn(label, { withFilter: false });
  }

  // Deduplicate by orgnr (keep first occurrence so source is stable).
  const seen = new Map();
  for (const c of candidates) {
    if (!seen.has(c.organisasjonsnummer)) seen.set(c.organisasjonsnummer, c);
  }
  candidates = [...seen.values()];

  const scored = candidates.map((c) => ({
    cand: c,
    ...scoreCandidate(c, label, host),
  }));
  scored.sort((a, b) => b.score - a.score);
  return { label, scored };
};

// ---------- thresholds ----------

const AUTO_THRESHOLD = 75;
const AUTO_MARGIN_OVER_RUNNERUP = 10;
const PICKER_THRESHOLD = 45;

const verdict = (top, runnerUp) => {
  if (!top || top.score <= 0) return 'NO-MATCH';
  const runnerScore = runnerUp?.score ?? 0;
  if (top.score >= AUTO_THRESHOLD && top.score - runnerScore >= AUTO_MARGIN_OVER_RUNNERUP) {
    return 'AUTO';
  }
  if (top.score >= PICKER_THRESHOLD) return 'PICKER';
  return 'NO-MATCH';
};

// ---------- main ----------

const pad = (s, n) => String(s).padEnd(n);

const main = async () => {
  let correctAuto = 0;
  let correctRefuse = 0;
  let wrongAuto = 0;
  let pickerWithRight = 0;
  let pickerWithoutRight = 0;
  let missedRefuse = 0;

  for (const { host, expected } of TESTS) {
    const { label, scored } = await resolveHostname(host);
    const top = scored[0];
    const runnerUp = scored[1];
    const v = verdict(top, runnerUp);

    const expectedLabel = expected ?? '∅ (refuse)';
    console.log(`\n━━━ ${host}  (label=${label})  expected=${expectedLabel}`);

    for (const s of scored.slice(0, 10)) {
      const c = s.cand;
      console.log(
        `  ${pad(s.score, 4)} ${pad(c.organisasjonsnummer, 10)} ${pad(c.organisasjonsform?.kode ?? '', 5)} ` +
        `${pad((c.navn || '').slice(0, 45), 45)} ans=${pad(c.antallAnsatte ?? '-', 4)} src=${c._source}`,
      );
      console.log(`       ${s.reasons.join(' ')}`);
    }

    let result;
    if (v === 'AUTO') {
      if (top.cand.organisasjonsnummer === expected) {
        result = 'AUTO ✓';
        correctAuto++;
      } else if (expected === null) {
        result = `AUTO ✗ (resolved when should refuse — got ${top.cand.organisasjonsnummer})`;
        wrongAuto++;
      } else {
        result = `AUTO ✗ (got ${top.cand.organisasjonsnummer}, want ${expected})`;
        wrongAuto++;
      }
    } else if (v === 'PICKER') {
      const inPicker = scored.slice(0, 4).some(
        (s) => s.cand.organisasjonsnummer === expected,
      );
      if (expected === null) {
        result = 'PICKER (refuse expected — user-rejectable)';
        correctRefuse++; // picker with "none of these" is still safe
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
  console.log(`  auto-WRONG         : ${wrongAuto}`);
  console.log(`  missed (no-match)  : ${missedRefuse}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
