# Hostname-resolution v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace today's "first prefix match wins" hostname→brreg
resolver (`src/lib/hostname-search.ts`) with a multi-query + scoring
pipeline that auto-resolves only when confident and surfaces a sidebar
picker for ambiguous matches — driving 0 AUTO-WRONG on the 17-host
benchmark while keeping the legacy `searchByHostname` signature stable
for the sync cascade.

**Architecture:** New pure scoring module (`src/lib/hostname-score.ts`)
holds the load-bearing logic, tested independently of the network. New
`searchByHostnameDetailed` returns `{band, candidates, choice?}` for
the sidebar's picker flow; `searchByHostname` becomes a thin wrapper
that only returns AUTO. Sidebar gains a `data-state="picker"` block
that lists top-4 candidates with "Ingen av disse"; the user's choice
caches per host alongside the existing 24h hostname cache so re-visits
skip the picker. No new permissions, no new hosts, no content scripts
— all decisions stay on `data.brreg.no` queries.

**Tech Stack:** TypeScript, MV3, WebExtensions API
(`storage.session`), vitest, vite, web-ext, brreg public API
(`/enheter` with `hjemmeside`, `navn`, `navnMetodeForSoek=FORTLOEPENDE`,
`organisasjonsform`, `sort` params).

---

## File map

**New:**
- `src/lib/hostname-score.ts` — pure scoring + band-decision logic.
  Exports `scoreCandidate`, `decideBand`, `foldNordic`,
  `generateNordicVariants`, `hostnameLabel`, plus the type
  `ResolutionBand = 'auto' | 'picker' | 'none'` and `HostnameResult`.
- `tests/hostname-score.test.ts` — unit tests for the pure functions.

**Modified:**
- `src/lib/brreg.ts` — add `searchEnheterWithParams(params)` helper
  for the multi-query pipeline. `searchEnheter(query, size)` keeps
  its existing signature (popup free-form search still works).
- `src/lib/hostname-search.ts` — rewritten around the multi-query
  pipeline. Adds `searchByHostnameDetailed`, plus `getPickerChoice` /
  `setPickerChoice` helpers. `searchByHostname` becomes a thin wrapper.
  Cache value shape changes from `string | null` to `HostnameResult`.
- `tests/hostname-search.test.ts` — updated to mock the new helper +
  cover the multi-query/picker/choice paths.
- `src/details/details.html` — new picker block visible at
  `data-state="picker"`.
- `src/details/details.css` — picker styles.
- `src/details/details.ts` — picker rendering, `data-state='picker'`
  support, choice caching, dispatch from `init` / `onMessage`.
- `docs/notes/resolution.md` — extend cascade section to cover bands.
- `docs/notes/cache.md` — extend cache schema section to cover the
  new `hostname:` and `picker-choice:` shapes.

**Unchanged (verify after each task):**
- `public/manifest.json` — no permission changes.
- `src/lib/orgnr.ts` — `resolveOrgnrAsync` stays string|undefined.
  Background script and popup still call it unchanged.
- `src/lib/domains.ts` — 11 grandfathered entries stay.
- `scripts/benchmark-hostname.mjs` — kept as regression harness.

---

## Task 1: Pure helpers in `hostname-score.ts`

**Why first:** `scoreCandidate` depends on `foldNordic` and string
helpers; the multi-query pipeline depends on `generateNordicVariants`
and `hostnameLabel`. Land the pure utilities with tests before the
load-bearing scoring function.

**Files:**
- Create: `src/lib/hostname-score.ts`
- Create: `tests/hostname-score.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `tests/hostname-score.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  foldNordic,
  generateNordicVariants,
  hostnameLabel,
} from '../src/lib/hostname-score.js';

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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/hostname-score.test.ts`
Expected: FAIL — module `src/lib/hostname-score.ts` does not exist.

- [ ] **Step 3: Create the module with the helpers**

Create `src/lib/hostname-score.ts`:

```ts
// Pure scoring + utilities for hostname → brreg resolution. No network
// access, no storage — depends only on the candidate shape returned
// from brreg's /enheter endpoint. See docs/notes/resolution.md for the
// pipeline overview.

// Fold Nordic letters to ASCII: Ø→O, Å→A, Æ→AE (and lowercase). Brreg
// stores names with Nordic letters; hostnames cannot carry them. The
// label is therefore always ASCII. Without folding, "elkjop" would
// never match "ELKJØP NORGE AS".
export function foldNordic(s: string): string {
  return s
    .replace(/Ø/g, 'O')
    .replace(/ø/g, 'o')
    .replace(/Å/g, 'A')
    .replace(/å/g, 'a')
    .replace(/Æ/g, 'AE')
    .replace(/æ/g, 'ae');
}

// Hostnames are ASCII; brreg search does NOT auto-fold Nordic letters
// (?navn=elkjop returns 0, ?navn=elkjøp returns ELKJØP NORGE AS).
// Generate variants by substituting one "o"→"ø" or "a"→"å" per
// position, plus "ae"→"æ" / "aa"→"å" when present. Capped at one
// substitution per position so the set stays small.
export function generateNordicVariants(label: string): string[] {
  const out = new Set<string>([label]);
  for (let i = 0; i < label.length; i++) {
    if (label[i] === 'o') {
      out.add(label.slice(0, i) + 'ø' + label.slice(i + 1));
    }
    if (label[i] === 'a') {
      out.add(label.slice(0, i) + 'å' + label.slice(i + 1));
    }
  }
  if (label.includes('ae')) out.add(label.replace(/ae/g, 'æ'));
  if (label.includes('aa')) out.add(label.replace(/aa/g, 'å'));
  return [...out];
}

// Pull the brandable part out of a hostname for use as a search label.
// `www.yara.com` → `yara`, `shop.mestergruppen.no` → `mestergruppen`,
// `nrk.no` → `nrk`. Strips `www.` and the TLD segment, then takes the
// rightmost remaining label. Returns undefined if the result is empty
// or shorter than 2 chars (would match too much).
export function hostnameLabel(hostname: string): string | undefined {
  const stripped = hostname.replace(/^www\./i, '').toLowerCase();
  const parts = stripped.split('.');
  if (parts.length < 2) return undefined;
  const base = parts[parts.length - 2];
  if (!base || base.length < 2) return undefined;
  return base;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/hostname-score.test.ts`
Expected: PASS — 15 tests green.

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm typecheck`
Expected: PASS, no errors.

Run: `pnpm lint:ts`
Expected: PASS, no errors.

- [ ] **Step 6: Commit**

```pwsh
git add src/lib/hostname-score.ts tests/hostname-score.test.ts
git commit -m "Add hostname-score utilities: fold, variants, label"
```

---

## Task 2: `scoreCandidate` function

**Why next:** Load-bearing scoring logic, ported from
`scripts/benchmark-hostname.mjs`. Pure function, no network.

**Files:**
- Modify: `src/lib/hostname-score.ts` (append `scoreCandidate`)
- Modify: `tests/hostname-score.test.ts` (append scoring tests)

- [ ] **Step 1: Write failing tests**

Append to `tests/hostname-score.test.ts`:

```ts
import { scoreCandidate } from '../src/lib/hostname-score.js';
import type { SearchHit } from '../src/types/brreg.js';

function cand(over: Partial<SearchHit> & { navn: string }): SearchHit {
  return {
    organisasjonsnummer: '999999999',
    organisasjonsform: { kode: 'AS' },
    ...over,
  } as SearchHit;
}

describe('scoreCandidate', () => {
  it('returns 0 for a candidate with neither name nor hjemmeside relation', () => {
    const c = cand({ navn: 'NORDAN AS' });
    const { score } = scoreCandidate(c, 'norden', 'norden.org');
    expect(score).toBe(0);
  });

  it('rewards exact-name match with the highest prefix bonus', () => {
    const c = cand({ navn: 'ORKLA', organisasjonsform: { kode: 'ASA' } });
    const { score } = scoreCandidate(c, 'orkla', 'orkla.com');
    // prefix(28+ratio20) + ASA(+28) + top-level(+12) + short(1w)(+5)
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
    // ELKJØP → ELKJOP folded; "elkjop" matches as prefix.
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
    const live = cand({ navn: 'TV 2 AS', organisasjonsform: { kode: 'AS' } });
    const dead = cand({
      navn: 'TV 2 AS',
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
    // hjemmeside-exact (+35) + form AS (+15) + ... still positive.
    expect(score).toBeGreaterThan(0);
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
    // No subsidiary-kw penalty applied — the score should reflect the
    // employee bonus and top-level status without the -15 hit.
    expect(score).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/hostname-score.test.ts -t scoreCandidate`
Expected: FAIL — `scoreCandidate is not a function`.

- [ ] **Step 3: Implement `scoreCandidate`**

Append to `src/lib/hostname-score.ts`:

```ts
import type { SearchHit } from '../types/brreg.js';

// Words that strongly suggest a satellite organisation (vennelag,
// pensjonskasse, klubb) rather than the operating company.
const NOISE_WORDS = [
  'VENNELAG', 'VENNER', 'PENSJONSKASSE', 'KLUBB', 'FORENING',
  'STIFTELSEN', 'SUPPORTER', 'ANSATTES', 'SENIOR', 'BEDRIFTSIDRETT',
  'IDRETTSLAG', 'KORPS', 'ARBEIDERLAG', 'VETERAN',
];

// Words that suggest the candidate is a subsidiary/division. NORGE /
// NORWAY / NORDIC / INTERNATIONAL / GROUP / GRUPPEN / HOLDING are
// intentionally NOT here — they routinely name the country-level
// operating company (ELKJØP NORGE AS) or the group parent itself
// (YARA INTERNATIONAL ASA).
const SUBSIDIARY_KEYWORDS = [
  'SVERIGE', 'DANMARK', 'FINLAND',
  'FINANCE', 'FINANS', 'INVEST',
  'FOODS', 'HEALTH', 'SNACKS', 'CARE', 'EIENDOM', 'PROPERTY',
  'ASIA', 'EUROPE', 'GLOBAL', 'IT',
];

const ORG_FORM_WEIGHTS: Record<string, number> = {
  AS: 15, ASA: 28, SA: 12, ORGL: 18, SF: 18,
  DA: 5, ANS: 5,
  FLI: -35, STI: -20, ENK: -25, PERS: -50, NUF: -10, UTLA: -15, PK: -30,
};

export interface ScoreResult {
  score: number;
  reasons: string[];
}

export function scoreCandidate(
  cand: SearchHit,
  label: string,
  host: string,
): ScoreResult {
  const navn = foldNordic((cand.navn || '').toUpperCase());
  const labelU = foldNordic(label.toUpperCase());
  const formKode = cand.organisasjonsform?.kode ?? '';

  const reasons: string[] = [];

  // Name matching. Prefix bonus is scaled by word count so that ORKLA
  // matches ORKLA ASA (2 words) more strongly than ORKLA FOODS NORGE
  // AS (4 words).
  const wordCount = navn.split(/\s+/).filter(Boolean).length || 1;
  let nameScore = 0;
  if (navn.startsWith(labelU + ' ') || navn === labelU) {
    const ratioBonus = Math.round(20 / wordCount);
    nameScore = 28 + ratioBonus;
    reasons.push(`prefix(+${28 + ratioBonus})`);
  } else if (navn.startsWith(labelU)) {
    nameScore = 22;
    reasons.push('weak-prefix(+22)');
  } else if (
    navn.includes(' ' + labelU + ' ') ||
    navn.endsWith(' ' + labelU)
  ) {
    nameScore = 28;
    reasons.push('word(+28)');
  } else if (navn.includes(labelU)) {
    nameScore = 12;
    reasons.push('substr(+12)');
  }

  // Hjemmeside-felt match. Weighted lower than name match — small
  // associations populate this field more often than parent companies
  // (SHELL VETERANENE for shell.no, drift companies for lieoverflate).
  const hjem = (cand.hjemmeside ?? '').toLowerCase();
  const bareHost = host.replace(/^www\./, '').toLowerCase();
  let hjemScore = 0;
  if (hjem) {
    if (hjem === bareHost || hjem === `www.${bareHost}`) {
      hjemScore = 35;
      reasons.push('hjemmeside=exact(+35)');
    } else if (
      hjem.startsWith(bareHost) ||
      hjem.startsWith(`www.${bareHost}`)
    ) {
      hjemScore = 22;
      reasons.push('hjemmeside=prefix(+22)');
    } else if (hjem.includes(bareHost)) {
      hjemScore = 12;
      reasons.push('hjemmeside=substr(+12)');
    }
  }

  // Hard gate: no name AND no hjemmeside relation → drop. Kills
  // unrelated candidates that happen to share org form / employee
  // count (norden.org → NORDAN AS).
  if (nameScore === 0 && hjemScore === 0) {
    return { score: 0, reasons: ['no-relation'] };
  }

  let score = nameScore + hjemScore;

  const formBonus = ORG_FORM_WEIGHTS[formKode] ?? 0;
  if (formBonus) {
    const sign = formBonus >= 0 ? '+' : '';
    score += formBonus;
    reasons.push(`form=${formKode}(${sign}${formBonus})`);
  }

  // Parent vs subsidiary signal: overordnetEnhet is present only for
  // subsidiaries.
  if (!cand.overordnetEnhet) {
    score += 12;
    reasons.push('top-level(+12)');
  } else {
    score -= 6;
    reasons.push('subsidiary(-6)');
  }

  const ansatte = cand.antallAnsatte ?? 0;
  if (ansatte >= 500) {
    score += 20;
    reasons.push('ansatte>=500(+20)');
  } else if (ansatte >= 100) {
    score += 15;
    reasons.push('ansatte>=100(+15)');
  } else if (ansatte >= 10) {
    score += 8;
    reasons.push('ansatte>=10(+8)');
  } else if (ansatte >= 1) {
    score += 3;
    reasons.push('ansatte>=1(+3)');
  }

  // Subsidiary keywords only count when the label is already matched —
  // otherwise unrelated entities containing these words get penalised
  // for no reason.
  if (nameScore > 0) {
    const matchedSub = SUBSIDIARY_KEYWORDS.find(
      (w) => navn.includes(' ' + w) || navn.includes(w + ' '),
    );
    if (matchedSub) {
      score -= 15;
      reasons.push(`subsidiary-kw=${matchedSub}(-15)`);
    }
  }

  if (cand.registrertIForetaksregisteret) {
    score += 6;
    reasons.push('foretaksreg(+6)');
  }

  const matchedNoise = NOISE_WORDS.find((w) => navn.includes(w));
  if (matchedNoise) {
    score -= 40;
    reasons.push(`noise=${matchedNoise}(-40)`);
  }

  if (wordCount >= 5) {
    score -= 10;
    reasons.push(`long(${wordCount}w)(-10)`);
  } else if (wordCount === 2) {
    score += 10;
    reasons.push('short(2w)(+10)');
  } else if (wordCount === 1) {
    score += 5;
    reasons.push('short(1w)(+5)');
  }

  if (cand.konkurs || cand.underAvvikling) {
    score -= 30;
    reasons.push('inactive(-30)');
  }

  return { score, reasons };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/hostname-score.test.ts`
Expected: PASS — all scoring tests green.

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint:ts`
Expected: PASS, no errors.

- [ ] **Step 6: Commit**

```pwsh
git add src/lib/hostname-score.ts tests/hostname-score.test.ts
git commit -m "Add hostname scoring function with name/hjemmeside gates"
```

---

## Task 3: `decideBand` + types

**Why:** Pure 3-band threshold logic. Tested independently so the
multi-query pipeline can compose it without re-deriving thresholds.

**Files:**
- Modify: `src/lib/hostname-score.ts` (append `decideBand` + types)
- Modify: `tests/hostname-score.test.ts` (append band tests)

- [ ] **Step 1: Write failing tests**

Append to `tests/hostname-score.test.ts`:

```ts
import { decideBand } from '../src/lib/hostname-score.js';

describe('decideBand', () => {
  it('returns auto when top score >= 75 and margin >= 10', () => {
    expect(decideBand(80, 60)).toBe('auto');
    expect(decideBand(75, 65)).toBe('auto');
  });

  it('returns picker when top score >= 75 but margin < 10', () => {
    // Both candidates close → ambiguous, ask user.
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/hostname-score.test.ts -t decideBand`
Expected: FAIL — `decideBand is not exported`.

- [ ] **Step 3: Implement `decideBand` + types**

Append to `src/lib/hostname-score.ts`:

```ts
// Thresholds — tuned against scripts/benchmark-hostname.mjs.
//
// AUTO: top must be confidently above the noise floor (75) AND
// clearly ahead of the runner-up (+10) so kjedebutikker (ELKJØP
// LEKNES vs ELKJØP SVOLVÆR, both 111 via hjemmeside-exact) don't
// auto-resolve.
//
// PICKER: top must be plausible (45) but not confident — surface
// the top 4 with "Ingen av disse" instead of guessing.
const AUTO_THRESHOLD = 75;
const AUTO_MARGIN = 10;
const PICKER_THRESHOLD = 45;

export type ResolutionBand = 'auto' | 'picker' | 'none';

export function decideBand(
  topScore: number,
  runnerUpScore: number | undefined,
): ResolutionBand {
  if (topScore <= 0) return 'none';
  const runner = runnerUpScore ?? 0;
  if (topScore >= AUTO_THRESHOLD && topScore - runner >= AUTO_MARGIN) {
    return 'auto';
  }
  if (topScore >= PICKER_THRESHOLD) return 'picker';
  return 'none';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/hostname-score.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint:ts`
Expected: PASS, no errors.

- [ ] **Step 6: Commit**

```pwsh
git add src/lib/hostname-score.ts tests/hostname-score.test.ts
git commit -m "Add three-band resolution decision with AUTO margin gate"
```

---

## Task 4: Multi-query helper in `brreg.ts`

**Why:** The pipeline needs flexible query parameters beyond `?navn=`
(also `?hjemmeside=`, `navnMetodeForSoek`, `organisasjonsform`,
`sort`). Add one general-purpose helper; keep `searchEnheter` simple
for the popup's free-form search.

**Files:**
- Modify: `src/lib/brreg.ts` (add `searchEnheterWithParams`)

- [ ] **Step 1: Add the helper**

In `src/lib/brreg.ts` after the existing `searchEnheter` function
(after line 93), append:

```ts
// Multi-parameter search for the hostname-resolution pipeline. Callers
// pass a fully constructed URLSearchParams so they can mix
// `hjemmeside`, `navn`, `navnMetodeForSoek`, `organisasjonsform`,
// `sort`, `size`, etc. without an option-soup signature. Failures and
// non-2xx responses return [] — the pipeline aggregates across several
// calls and a single hiccup shouldn't poison the whole result.
export async function searchEnheterWithParams(
  params: URLSearchParams,
): Promise<SearchHit[]> {
  const url = new URL(`${API}/enheter`);
  for (const [k, v] of params) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      _embedded?: { enheter?: SearchHit[] };
    };
    return data._embedded?.enheter ?? [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint:ts`
Expected: PASS, no errors.

- [ ] **Step 3: Run the existing suite to confirm no regressions**

Run: `pnpm test`
Expected: PASS — no test touches this new export.

- [ ] **Step 4: Commit**

```pwsh
git add src/lib/brreg.ts
git commit -m "Add searchEnheterWithParams helper for multi-param brreg search"
```

---

## Task 5: Rewrite `hostname-search.ts` with multi-query pipeline

**Why:** Replace the single-query "first prefix wins" logic with the
multi-query + scoring + 3-band pipeline. Keep `searchByHostname`
signature stable (string|undefined for AUTO band); add
`searchByHostnameDetailed` for the picker flow. Extend the cache
schema.

**Files:**
- Modify: `src/lib/hostname-search.ts` (complete rewrite of the
  resolver; cache helpers extended)

- [ ] **Step 1: Rewrite the module**

Replace the entire contents of `src/lib/hostname-search.ts` with:

```ts
// Hostname → brreg resolution. Last tier of the resolve cascade,
// after URL regex / title regex / curated domain override all miss.
//
// Runs three parallel brreg queries (hjemmeside, navn FORTLOEPENDE
// with org-form filter, fallback navn without filter), aggregates +
// scores candidates via src/lib/hostname-score.ts, and picks one of
// three outcomes:
//
//   - 'auto'   → confident match, resolves to a single orgnr
//   - 'picker' → ambiguous, return top candidates for sidebar UI
//   - 'none'   → no plausible match, surface manual-search UX
//
// Cached per hostname in storage.session (24h) so re-visits don't
// churn the API. User picker choices cache separately under
// `picker-choice:<host>` and win over any cached band.

import { searchEnheterWithParams } from './brreg.js';
import {
  decideBand,
  generateNordicVariants,
  hostnameLabel,
  scoreCandidate,
  type ResolutionBand,
} from './hostname-score.js';
import type { SearchHit } from '../types/brreg.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PREFIX = 'hostname:';
const CHOICE_KEY_PREFIX = 'picker-choice:';
const MAX_CANDIDATES_IN_CACHE = 4;

export type HostnameResult =
  | { band: 'auto'; orgnr: string; candidates: SearchHit[] }
  | { band: 'picker'; candidates: SearchHit[] }
  | { band: 'none'; candidates: [] };

export interface DetailedResult {
  band: ResolutionBand;
  candidates: SearchHit[];
  // Populated when the user has previously picked a candidate for
  // this host. band is 'auto' in that case; sidebar loads `choice`
  // directly. A cached negative choice ("Ingen av disse") becomes
  // band='none' with `choice` undefined.
  choice?: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

async function cacheGet<T>(key: string): Promise<T | undefined> {
  const store = await browser.storage.session.get(key);
  const entry = store[key] as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    try {
      await browser.storage.session.remove(key);
    } catch {
      /* best-effort */
    }
    return undefined;
  }
  return entry.value;
}

async function cacheSet<T>(key: string, value: T): Promise<void> {
  const entry: CacheEntry<T> = {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  await browser.storage.session.set({ [key]: entry });
}

// Public helpers for the sidebar to read/write the user's picker
// choice. `value=null` represents "Ingen av disse" — a deliberate
// negative answer, distinct from "no cache entry".
export async function getPickerChoice(
  host: string,
): Promise<string | null | undefined> {
  return cacheGet<string | null>(`${CHOICE_KEY_PREFIX}${host}`);
}

export async function setPickerChoice(
  host: string,
  value: string | null,
): Promise<void> {
  await cacheSet(`${CHOICE_KEY_PREFIX}${host}`, value);
}

// Pull the brandable label out of a hostname for use as a search
// query. Re-exported from hostname-score so existing callers
// (tests, etc.) don't need a different import.
export function queryFromHostname(hostname: string): string | undefined {
  return hostnameLabel(hostname);
}

async function queryByHjemmeside(host: string): Promise<SearchHit[]> {
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

async function queryByNavn(
  label: string,
  withFilter: boolean,
): Promise<SearchHit[]> {
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

function dedupeByOrgnr(hits: SearchHit[]): SearchHit[] {
  const seen = new Map<string, SearchHit>();
  for (const h of hits) {
    if (!seen.has(h.organisasjonsnummer)) seen.set(h.organisasjonsnummer, h);
  }
  return [...seen.values()];
}

async function runPipeline(
  host: string,
  label: string,
): Promise<HostnameResult> {
  const [byHj, byNavn] = await Promise.all([
    queryByHjemmeside(host),
    queryByNavn(label, true),
  ]);

  let candidates = dedupeByOrgnr([...byHj, ...byNavn]);

  // Q3 fallback — drop the org-form filter only if Q1+Q2 yielded zero.
  // Catches ORGL/SF entities like EKSPORTFINANSIERING NORGE without
  // re-adding the FLI/ENK noise we filtered out otherwise.
  if (candidates.length === 0) {
    candidates = dedupeByOrgnr(await queryByNavn(label, false));
  }

  if (candidates.length === 0) {
    return { band: 'none', candidates: [] };
  }

  const scored = candidates
    .map((c) => ({ cand: c, ...scoreCandidate(c, label, host) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const runnerUp = scored[1];
  const band = decideBand(top?.score ?? 0, runnerUp?.score);

  if (band === 'auto' && top) {
    return {
      band: 'auto',
      orgnr: top.cand.organisasjonsnummer,
      candidates: scored.slice(0, MAX_CANDIDATES_IN_CACHE).map((s) => s.cand),
    };
  }
  if (band === 'picker') {
    return {
      band: 'picker',
      candidates: scored.slice(0, MAX_CANDIDATES_IN_CACHE).map((s) => s.cand),
    };
  }
  return { band: 'none', candidates: [] };
}

// Internal: resolve via cache + pipeline. Returns the rich result; the
// public wrappers below adapt it to their own return shapes.
async function resolveInternal(
  hostname: string,
): Promise<HostnameResult | undefined> {
  const label = queryFromHostname(hostname);
  if (!label) {
    await cacheSet(`${KEY_PREFIX}${hostname}`, {
      band: 'none',
      candidates: [],
    } as HostnameResult);
    return { band: 'none', candidates: [] };
  }

  const cacheKey = `${KEY_PREFIX}${hostname}`;
  const cached = await cacheGet<HostnameResult>(cacheKey);
  if (cached) return cached;

  let result: HostnameResult;
  try {
    result = await runPipeline(hostname, label);
  } catch {
    // Network glitch — don't cache, next visit retries. The popup /
    // sidebar already handle undefined gracefully.
    return undefined;
  }

  await cacheSet(cacheKey, result);
  return result;
}

// Backwards-compatible AUTO-only resolver. Used by the sync cascade
// in src/lib/orgnr.ts and by the popup/background flows that only
// want a confident orgnr or nothing.
export async function searchByHostname(
  hostname: string,
): Promise<string | undefined> {
  const choice = await getPickerChoice(hostname);
  if (choice !== undefined) {
    // User explicitly chose for this host. Positive choice → that
    // orgnr; negative choice (null) → no match.
    return choice ?? undefined;
  }
  const result = await resolveInternal(hostname);
  if (!result) return undefined;
  return result.band === 'auto' ? result.orgnr : undefined;
}

// Picker-aware resolver. Returns the band + candidates so the sidebar
// can render the picker UI directly.
export async function searchByHostnameDetailed(
  hostname: string,
): Promise<DetailedResult | undefined> {
  const choice = await getPickerChoice(hostname);
  if (choice !== undefined) {
    if (choice === null) {
      return { band: 'none', candidates: [] };
    }
    return { band: 'auto', candidates: [], choice };
  }
  const result = await resolveInternal(hostname);
  if (!result) return undefined;
  if (result.band === 'auto') {
    return {
      band: 'auto',
      candidates: result.candidates,
      choice: result.orgnr,
    };
  }
  if (result.band === 'picker') {
    return { band: 'picker', candidates: result.candidates };
  }
  return { band: 'none', candidates: [] };
}
```

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm typecheck`
Expected: PASS, no errors.

Run: `pnpm lint:ts`
Expected: PASS, no errors.

- [ ] **Step 3: Run the existing hostname-search tests — expect FAIL**

Run: `pnpm exec vitest run tests/hostname-search.test.ts`
Expected: FAIL — existing tests mock `searchEnheter`, but the new
pipeline uses `searchEnheterWithParams`. Test rewrite happens in
Task 6.

The other suites should still pass:

Run: `pnpm exec vitest run tests/orgnr.test.ts tests/domains.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```pwsh
git add src/lib/hostname-search.ts
git commit -m "Rewrite hostname-search with multi-query + scoring + bands"
```

---

## Task 6: Rewrite `tests/hostname-search.test.ts`

**Why:** The pipeline now mocks `searchEnheterWithParams` instead of
`searchEnheter`. Cover the multi-query branches, the band decisions,
and the picker-choice cache.

**Files:**
- Modify: `tests/hostname-search.test.ts` (full rewrite)

- [ ] **Step 1: Replace the test file**

Replace the entire contents of `tests/hostname-search.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchHit } from '../src/types/brreg.js';

vi.mock('../src/lib/brreg.js', () => ({
  searchEnheterWithParams: vi.fn(),
}));

import { searchEnheterWithParams } from '../src/lib/brreg.js';
import {
  getPickerChoice,
  queryFromHostname,
  searchByHostname,
  searchByHostnameDetailed,
  setPickerChoice,
} from '../src/lib/hostname-search.js';

const searchMock = vi.mocked(searchEnheterWithParams);

type StorageMap = Record<string, unknown>;

function installStorageMock(initial: StorageMap = {}): StorageMap {
  const store: StorageMap = { ...initial };
  (globalThis as { browser?: unknown }).browser = {
    storage: {
      session: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: StorageMap = {};
          for (const k of list) {
            if (k in store) out[k] = store[k];
          }
          return out;
        }),
        set: vi.fn(async (entries: StorageMap) => {
          Object.assign(store, entries);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete store[k];
        }),
      },
    },
  };
  return store;
}

function hit(
  navn: string,
  organisasjonsnummer: string,
  extra: Partial<SearchHit> = {},
): SearchHit {
  return {
    navn,
    organisasjonsnummer,
    organisasjonsform: { kode: 'AS' },
    ...extra,
  } as SearchHit;
}

describe('queryFromHostname', () => {
  it('strips www and TLD, leaves the brand label', () => {
    expect(queryFromHostname('www.yara.com')).toBe('yara');
    expect(queryFromHostname('yara.com')).toBe('yara');
  });

  it('returns undefined for single-label or too-short hostnames', () => {
    expect(queryFromHostname('localhost')).toBeUndefined();
    expect(queryFromHostname('a.no')).toBeUndefined();
  });
});

describe('searchByHostname (AUTO-only legacy wrapper)', () => {
  beforeEach(() => {
    installStorageMock();
    searchMock.mockReset();
  });

  it('returns the AUTO-band orgnr when scoring is confident', async () => {
    // ORKLA ASA → exact-prefix(+48) + ASA(+28) + top-level(+12) +
    // short(2w)(+10) = 98, clear winner. Picker runner-up well below.
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      // Q1 hjemmeside lookups return nothing.
      if (params.has('hjemmeside')) return [];
      // Q2 navn → ORKLA ASA + ORKLA FOODS NORGE AS.
      return [
        hit('ORKLA ASA', '910747711', {
          organisasjonsform: { kode: 'ASA' },
          antallAnsatte: 50,
        }),
        hit('ORKLA FOODS NORGE AS', '999999998', {
          organisasjonsform: { kode: 'AS' },
          overordnetEnhet: '910747711',
        }),
      ];
    });

    expect(await searchByHostname('orkla.com')).toBe('910747711');
  });

  it('returns undefined when band is picker (ambiguous)', async () => {
    // Two near-identical kjedebutikker — picker band, no AUTO.
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) {
        return [
          hit('ELKJØP LEKNES', '111111118', { hjemmeside: 'elkjop.no' }),
          hit('ELKJØP SVOLVÆR', '222222226', { hjemmeside: 'elkjop.no' }),
        ];
      }
      return [];
    });

    expect(await searchByHostname('elkjop.no')).toBeUndefined();
  });

  it('returns undefined when no candidates score above the gate', async () => {
    searchMock.mockResolvedValue([]);
    expect(await searchByHostname('mdn.mozilla.org')).toBeUndefined();
  });

  it('caches results and skips network on the second call', async () => {
    searchMock.mockResolvedValue([
      hit('ORKLA ASA', '910747711', { organisasjonsform: { kode: 'ASA' } }),
    ]);
    await searchByHostname('orkla.com');
    const callsAfterFirst = searchMock.mock.calls.length;
    await searchByHostname('orkla.com');
    expect(searchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('returns the cached picker choice when one exists', async () => {
    await setPickerChoice('shell.no', '914807077');
    expect(await searchByHostname('shell.no')).toBe('914807077');
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('returns undefined when the cached choice is "Ingen av disse"', async () => {
    await setPickerChoice('shell.no', null);
    expect(await searchByHostname('shell.no')).toBeUndefined();
    expect(searchMock).not.toHaveBeenCalled();
  });
});

describe('searchByHostnameDetailed', () => {
  beforeEach(() => {
    installStorageMock();
    searchMock.mockReset();
  });

  it('returns band=auto with the choice orgnr when confident', async () => {
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) return [];
      return [
        hit('ORKLA ASA', '910747711', {
          organisasjonsform: { kode: 'ASA' },
        }),
      ];
    });

    const result = await searchByHostnameDetailed('orkla.com');
    expect(result?.band).toBe('auto');
    expect(result?.choice).toBe('910747711');
  });

  it('returns band=picker with candidates when ambiguous', async () => {
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) {
        return [
          hit('ELKJØP LEKNES', '111111118', { hjemmeside: 'elkjop.no' }),
          hit('ELKJØP SVOLVÆR', '222222226', { hjemmeside: 'elkjop.no' }),
        ];
      }
      return [];
    });

    const result = await searchByHostnameDetailed('elkjop.no');
    expect(result?.band).toBe('picker');
    expect(result?.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('returns band=none when nothing matches', async () => {
    searchMock.mockResolvedValue([]);
    const result = await searchByHostnameDetailed('mdn.mozilla.org');
    expect(result?.band).toBe('none');
    expect(result?.candidates).toEqual([]);
  });

  it('honors a positive picker-choice cache: band=auto, choice set', async () => {
    await setPickerChoice('shell.no', '914807077');
    const result = await searchByHostnameDetailed('shell.no');
    expect(result).toEqual({ band: 'auto', candidates: [], choice: '914807077' });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('honors a negative picker-choice cache: band=none', async () => {
    await setPickerChoice('shell.no', null);
    const result = await searchByHostnameDetailed('shell.no');
    expect(result).toEqual({ band: 'none', candidates: [] });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('falls back to Q3 (no org-form filter) when Q1+Q2 yields zero', async () => {
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      // Q1 hjemmeside: 0 hits.
      if (params.has('hjemmeside')) return [];
      // Q2 has the AS/ASA filter set: 0 hits.
      if (params.get('organisasjonsform') === 'AS,ASA,SA,ORGL,SF') return [];
      // Q3 no filter: returns an ORGL.
      return [
        hit('EKSPORTFINANSIERING NORGE', '999000001', {
          organisasjonsform: { kode: 'ORGL' },
        }),
      ];
    });

    const result = await searchByHostnameDetailed('eksfin.no');
    // Whatever the band lands at, the Q3 call must have happened —
    // i.e. searchMock was called with no organisasjonsform set.
    const q3Call = searchMock.mock.calls.find(
      (call) => !(call[0] as URLSearchParams).has('organisasjonsform'),
    );
    expect(q3Call).toBeDefined();
    expect(result).toBeDefined();
  });
});

describe('getPickerChoice / setPickerChoice', () => {
  beforeEach(() => {
    installStorageMock();
  });

  it('round-trips a positive choice', async () => {
    await setPickerChoice('shell.no', '914807077');
    expect(await getPickerChoice('shell.no')).toBe('914807077');
  });

  it('round-trips a negative choice (null = "Ingen av disse")', async () => {
    await setPickerChoice('shell.no', null);
    expect(await getPickerChoice('shell.no')).toBeNull();
  });

  it('returns undefined when no choice has been cached', async () => {
    expect(await getPickerChoice('shell.no')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the hostname-search tests**

Run: `pnpm exec vitest run tests/hostname-search.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 3: Run the full suite**

Run: `pnpm test`
Expected: PASS — all suites green.

- [ ] **Step 4: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint:ts`
Expected: PASS, no errors.

- [ ] **Step 5: Commit**

```pwsh
git add tests/hostname-search.test.ts
git commit -m "Update hostname-search tests for multi-query + picker"
```

---

## Task 7: Picker block in `details.html`

**Why:** Add the `data-state="picker"` UI block that the sidebar
toggles to when resolution returns the picker band.

**Files:**
- Modify: `src/details/details.html`

- [ ] **Step 1: Add the picker section**

In `src/details/details.html`, after the existing
`<section id="status">` line (line 31) and before
`<section id="result" hidden>` (line 32), insert:

```html
        <section id="picker" hidden>
          <p class="picker-intro">Vi fant flere mulige treff på denne siden:</p>
          <ul id="picker-list" class="picker-list"></ul>
          <button type="button" id="picker-none" class="picker-none">
            Ingen av disse
          </button>
        </section>
```

- [ ] **Step 2: Verify the file parses**

Run: `pnpm build`
Expected: PASS — Vite copies the HTML untouched into `dist/`.

- [ ] **Step 3: Commit**

```pwsh
git add src/details/details.html
git commit -m "Add picker block to sidebar HTML"
```

---

## Task 8: Picker styling in `details.css`

**Why:** Match the dark theme used by the rest of the sidebar.

**Files:**
- Modify: `src/details/details.css` (append picker styles)

- [ ] **Step 1: Append picker styles**

Append to the end of `src/details/details.css`:

```css
/* --- picker (data-state='picker') ------------------------------- */

#picker {
  padding: 16px 0;
}

main[data-state='picker'] #status,
main[data-state='picker'] #result {
  display: none;
}

.picker-intro {
  margin: 0 0 12px;
  color: var(--muted);
  font-size: 13px;
}

.picker-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.picker-item {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: var(--fg);
  transition: border-color 120ms ease, background 120ms ease;
}

.picker-item:hover,
.picker-item:focus-visible {
  border-color: var(--accent);
  outline: none;
}

.picker-item-name {
  display: block;
  font-weight: 500;
  color: var(--fg-strong);
}

.picker-item-meta {
  display: block;
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--muted);
}

.picker-none {
  background: none;
  border: 1px dashed var(--border-strong);
  color: var(--muted);
  padding: 10px 14px;
  border-radius: var(--radius);
  cursor: pointer;
  font: inherit;
  width: 100%;
  transition: color 120ms ease, border-color 120ms ease;
}

.picker-none:hover,
.picker-none:focus-visible {
  color: var(--fg);
  border-color: var(--border-strong);
  outline: none;
}
```

- [ ] **Step 2: Build to verify the CSS compiles**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```pwsh
git add src/details/details.css
git commit -m "Style sidebar picker for dark theme"
```

---

## Task 9: Wire picker into `details.ts`

**Why:** Hook the picker discovery + rendering into the sidebar's
load flow. Reuses `searchByHostnameDetailed` for the picker decision;
on click, caches the user's choice and loads the orgnr (or shows
empty state for "Ingen av disse").

**Files:**
- Modify: `src/details/details.ts`

- [ ] **Step 1: Add picker imports and DOM handles**

In `src/details/details.ts`, replace the import block (lines 1–24)
with this updated version that adds the new hostname-search helpers:

```ts
import { decideToggle } from '../lib/auto-sync-controller.js';
import { getAutoSync, setAutoSync } from '../lib/auto-sync-settings.js';
import {
  fetchEnhet,
  fetchRegnskap,
  fetchRoller,
  fetchUnderenheter,
  invalidateCache,
} from '../lib/brreg.js';
import { buildOrgnrCopyButton, renderOrgnrCopy } from '../lib/copy-orgnr.js';
import { formatAddress, formatNok, formatRelativeTime } from '../lib/format.js';
import {
  searchByHostnameDetailed,
  setPickerChoice,
} from '../lib/hostname-search.js';
import { isValidOrgnr } from '../lib/mod11.js';
import { resolveOrgnr } from '../lib/orgnr.js';
import { findDagligLeder } from '../lib/roller.js';
import type {
  Enhet,
  Person,
  RegnskapResponse,
  Rolle,
  RolleEnhet,
  RolleGruppe,
  RollerResponse,
  SearchHit,
  Underenhet,
} from '../types/brreg.js';
```

(Note: `resolveOrgnr` replaces `resolveOrgnrAsync`. The sidebar now
runs the sync cascade itself and falls back to
`searchByHostnameDetailed` when sync misses, so it can branch on band.)

After the existing `sourceHostEl` line (line 49), append:

```ts
const pickerEl = $('picker');
const pickerListEl = $('picker-list') as HTMLUListElement;
const pickerNoneBtn = $('picker-none') as HTMLButtonElement;
```

- [ ] **Step 2: Extend the state-machine type and `setState`**

Replace the existing `setState` function (lines 78–82) with:

```ts
function setState(
  state: 'loading' | 'result' | 'error' | 'picker',
): void {
  app.dataset.state = state;
  statusEl.hidden = state === 'result' || state === 'picker';
  resultEl.hidden = state !== 'result';
  pickerEl.hidden = state !== 'picker';
}
```

- [ ] **Step 3: Add the picker rendering helper**

After the existing `showEmptyState` function (ends around line 102),
append:

```ts
function showPicker(host: string, candidates: SearchHit[]): void {
  setState('picker');
  setSourceHost(host);
  // Bump loadRunId so any in-flight loadOrgnr from a previous tab
  // can't overwrite the picker when its fetches land.
  ++loadRunId;
  currentOrgnr = undefined;
  // Clear any orgnr in the URL so a panel reload doesn't re-fetch.
  const url = new URL(window.location.href);
  url.searchParams.delete('orgnr');
  window.history.replaceState(null, '', url.toString());

  pickerListEl.innerHTML = '';
  for (const cand of candidates.slice(0, 4)) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picker-item';
    btn.addEventListener('click', () => {
      void handlePickerChoice(host, cand.organisasjonsnummer);
    });

    const name = document.createElement('span');
    name.className = 'picker-item-name';
    name.textContent = cand.navn;
    btn.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'picker-item-meta';
    const ansatte = cand.antallAnsatte;
    const ansatteLabel =
      typeof ansatte === 'number' && ansatte > 0
        ? `, ${ansatte} ansatte`
        : '';
    meta.textContent = `${cand.organisasjonsnummer}${ansatteLabel}`;
    btn.appendChild(meta);

    li.appendChild(btn);
    pickerListEl.appendChild(li);
  }
}

async function handlePickerChoice(host: string, orgnr: string): Promise<void> {
  await setPickerChoice(host, orgnr);
  const url = new URL(window.location.href);
  url.searchParams.set('orgnr', orgnr);
  window.history.replaceState(null, '', url.toString());
  await loadOrgnr(orgnr);
}

async function handlePickerNone(host: string): Promise<void> {
  await setPickerChoice(host, null);
  showEmptyState(host);
}

pickerNoneBtn.addEventListener('click', () => {
  if (!currentSourceHost) return;
  void handlePickerNone(currentSourceHost);
});
```

- [ ] **Step 4: Replace `resolveFromActiveTab` to surface picker data**

Replace the existing `resolveFromActiveTab` function and its
`TabContext` interface (around lines 335–370) with:

```ts
interface TabContext {
  orgnr?: string;
  host?: string;
  pickerCandidates?: SearchHit[];
}

async function resolveFromActiveTab(): Promise<TabContext> {
  try {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tab = tabs[0];
    if (!tab) return {};
    const url = tab.url ?? '';
    const title = tab.title ?? '';
    if (!url && !title) return {};
    let host: string | undefined;
    if (url) {
      try {
        host = new URL(url).hostname;
      } catch {
        /* invalid url — leave host undefined */
      }
    }
    // Sync cascade first — fast, no network. Covers URL/title regex
    // and the curated domains table.
    const sync = resolveOrgnr({ url, title });
    if (sync) return { orgnr: sync, host };
    if (!host) return { host };
    // Sync miss → hostname-based brreg search with band awareness.
    const detailed = await searchByHostnameDetailed(host);
    if (!detailed) return { host };
    if (detailed.band === 'auto') {
      return { orgnr: detailed.choice, host };
    }
    if (detailed.band === 'picker') {
      return { host, pickerCandidates: detailed.candidates };
    }
    return { host };
  } catch {
    return {};
  }
}
```

- [ ] **Step 5: Update `init` to branch on picker candidates**

Replace the existing `init` function (around lines 372–407) with:

```ts
async function init(): Promise<void> {
  const noMatchHost = getNoMatchHostFromUrl();
  if (noMatchHost !== undefined) {
    showEmptyState(noMatchHost);
    return;
  }

  const fromTab = await resolveFromActiveTab();
  const fromUrl = getOrgnrFromUrl();
  const orgnr = fromTab.orgnr ?? fromUrl;

  if (!orgnr) {
    if (fromTab.pickerCandidates && fromTab.host) {
      showPicker(fromTab.host, fromTab.pickerCandidates);
      return;
    }
    showEmptyState(fromTab.host);
    return;
  }

  if (fromTab.orgnr && fromTab.orgnr !== fromUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set('orgnr', fromTab.orgnr);
    window.history.replaceState(null, '', url.toString());
  }
  setSourceHost(fromTab.host);
  await loadOrgnr(orgnr);
}
```

- [ ] **Step 6: Update `doRefresh` to honor picker on miss**

Replace the existing `doRefresh` function (around lines 171–197)
with:

```ts
async function doRefresh(currentOrgnrArg: string): Promise<void> {
  refreshBtn.disabled = true;
  try {
    const hasTabs = await browser.permissions.contains({
      permissions: ['tabs'],
    });
    if (hasTabs) {
      const fromTab = await resolveFromActiveTab();
      if (fromTab.orgnr) {
        setSourceHost(fromTab.host);
        const url = new URL(window.location.href);
        url.searchParams.set('orgnr', fromTab.orgnr);
        window.history.replaceState(null, '', url.toString());
        await invalidateCache(fromTab.orgnr);
        await loadOrgnr(fromTab.orgnr);
        return;
      }
      if (fromTab.pickerCandidates && fromTab.host) {
        showPicker(fromTab.host, fromTab.pickerCandidates);
        return;
      }
      if (fromTab.host) {
        showEmptyState(fromTab.host);
        return;
      }
    }
    if (!currentOrgnrArg) return;
    await invalidateCache(currentOrgnrArg);
    await loadOrgnr(currentOrgnrArg);
  } finally {
    refreshBtn.disabled = false;
  }
}
```

- [ ] **Step 7: Update the `no-match` runtime message handler to try the picker path**

Replace the existing `browser.runtime.onMessage.addListener` block
(around lines 447–462) with:

```ts
browser.runtime.onMessage.addListener((msg: unknown) => {
  if (isNoMatchMessage(msg)) {
    ++loadRunId;
    void handleNoMatchBroadcast(msg.host);
    return;
  }
  if (!isSyncMessage(msg)) return;
  if (!isValidOrgnr(msg.orgnr)) return;
  setSourceHost(msg.host);
  const url = new URL(window.location.href);
  url.searchParams.set('orgnr', msg.orgnr);
  window.history.replaceState(null, '', url.toString());
  void loadOrgnr(msg.orgnr);
});

async function handleNoMatchBroadcast(host: string | undefined): Promise<void> {
  // Background broadcasts no-match when the sync cascade (and the
  // AUTO band of hostname-search) couldn't resolve. Re-run the
  // picker-aware resolver here — cache hits make this nearly free,
  // and it surfaces the picker for ambiguous sites instead of
  // showing the bare empty state.
  if (!host) {
    showEmptyState(undefined);
    return;
  }
  const detailed = await searchByHostnameDetailed(host);
  if (detailed?.band === 'picker') {
    showPicker(host, detailed.candidates);
    return;
  }
  if (detailed?.band === 'auto' && detailed.choice) {
    setSourceHost(host);
    const url = new URL(window.location.href);
    url.searchParams.set('orgnr', detailed.choice);
    window.history.replaceState(null, '', url.toString());
    await loadOrgnr(detailed.choice);
    return;
  }
  showEmptyState(host);
}
```

- [ ] **Step 8: Run typecheck and lint**

Run: `pnpm typecheck`
Expected: PASS, no errors.

Run: `pnpm lint:ts`
Expected: PASS, no errors.

- [ ] **Step 9: Run the full test suite**

Run: `pnpm test`
Expected: PASS — sidebar isn't covered by unit tests, but the type
checker catches signature drift.

- [ ] **Step 10: Build the extension**

Run: `pnpm build`
Expected: PASS — `dist/` populated.

Run: `pnpm lint:ext`
Expected: PASS — web-ext lint clean on the built extension.

- [ ] **Step 11: Commit**

```pwsh
git add src/details/details.ts
git commit -m "Wire sidebar picker for ambiguous hostname matches"
```

---

## Task 10: Update routing table notes

**Why:** `docs/notes/resolution.md` and `docs/notes/cache.md` are the
indexed entry points for future grep-based context loading. Extend
them with the band/picker model and the new cache key.

**Files:**
- Modify: `docs/notes/resolution.md`
- Modify: `docs/notes/cache.md`

- [ ] **Step 1: Extend `resolution.md` with the band section**

In `docs/notes/resolution.md`, append after the existing
`<!-- SECTION: sync-vs-async -->` block (after line 48):

```markdown

<!-- SECTION: bands -->
## Resolution bands

`hostname-search.ts` exposes two entry points:

- `searchByHostname(host)` returns `string | undefined` — only AUTO
  matches resolve. Used by the sync cascade in `orgnr.ts` and by
  background/popup flows that just want a confident orgnr.
- `searchByHostnameDetailed(host)` returns `{band, candidates, choice?}`
  — used by the sidebar so it can render the picker UI for the
  `'picker'` band.

Bands are decided in `hostname-score.ts:decideBand`:

| Band | Condition | Outcome |
|---|---|---|
| `auto` | top ≥ 75 AND top − runner-up ≥ 10 | resolve to top candidate |
| `picker` | top ≥ 45 | sidebar shows top-4 + "Ingen av disse" |
| `none` | otherwise | sidebar shows empty state |

The AUTO margin requirement is what prevents kjedebutikker (ELKJØP
LEKNES vs ELKJØP SVOLVÆR, both 111 via hjemmeside-exact) from
auto-resolving.

<!-- SECTION: picker-choice -->
## Picker choice cache

When the user picks from the sidebar's "Mente du…?" list,
`setPickerChoice(host, orgnr)` writes a 24h entry under
`picker-choice:<host>`. The next visit short-circuits both bands and
the network — `searchByHostnameDetailed` returns `{band:'auto',
candidates:[], choice}`. `setPickerChoice(host, null)` ("Ingen av
disse") caches a negative choice that returns `{band:'none'}` on the
next visit. Clears with the existing `storage.session` lifetime.
```

- [ ] **Step 2: Extend `cache.md` with the new cache keys**

In `docs/notes/cache.md`, find the existing
`<!-- SECTION: 24h-session -->` block (around line 6) and replace the
`hostname-search.ts` paragraph (currently ending "every visit") with:

```markdown
`fetchRegnskap` caches both empty results (404, normal for small AS)
and "unsupported plan" results (500 from BANK/FORS filings) so a
refresh doesn't re-hit.

`hostname-search.ts` caches under two keys:

- `hostname:<host>` → `HostnameResult` = `{band: 'auto' | 'picker' |
  'none', candidates: SearchHit[]}` (orgnr is included on the auto
  variant). Replaces the older `string | null` shape.
- `picker-choice:<host>` → `string | null` (null = "Ingen av disse").
  Set by the sidebar when the user resolves a picker prompt. Wins
  over the band cache: if a choice is cached, both
  `searchByHostname` and `searchByHostnameDetailed` short-circuit
  before running the pipeline.

Both keys honor the same 24h TTL. Network errors still bypass caching
so the next visit retries.
```

- [ ] **Step 3: Commit**

```pwsh
git add docs/notes/resolution.md docs/notes/cache.md
git commit -m "Document band model + picker-choice cache in routing notes"
```

---

## Task 11: Verify benchmark + manual smoke test

**Why:** The benchmark is the regression harness — it must show 0
AUTO-WRONG. Sidebar UI isn't covered by unit tests, so a quick manual
pass through Firefox is required.

**Files:** None modified. Pure verification.

- [ ] **Step 1: Run the benchmark**

Run: `node scripts/benchmark-hostname.mjs`
Expected: summary line `auto-WRONG : 0`. The shipped pipeline must
match or improve the benchmark numbers (6 auto-correct, 4 refuse-
correct, 3 picker-with-right). Variations in candidate ordering for
borderline picker cases are acceptable; AUTO-WRONG is not.

If `auto-WRONG > 0`, do not commit — diagnose the divergence. The
shipped code and the benchmark share the same scoring constants, so
divergence means the multi-query order, Nordic-variant set, or band
thresholds have drifted.

- [ ] **Step 2: Build and load in Firefox**

Run from PowerShell (not Claude Code's Bash sandbox — Firefox window
needs to be visible):

```pwsh
pnpm dev
```

Expected: web-ext spawns Firefox with a fresh profile and the
extension loaded.

- [ ] **Step 3: Smoke-test AUTO cases**

Visit each of these and open the sidebar; verify the right entity
loads with no picker:

- `https://www.orkla.com/` → ORKLA ASA (910747711)
- `https://www.tv2.no/` → TV 2 AS (979484534)
- `https://www.equinor.no/` → EQUINOR ASA (923609016)

- [ ] **Step 4: Smoke-test PICKER cases**

Visit and verify the sidebar shows the "Mente du…?" list with
"Ingen av disse" at the bottom:

- `https://www.shell.no/` → picker including A/S NORSKE SHELL
  (914807077)
- `https://www.elkjop.no/` → picker including ELKJØP NORGE AS
  (947054600)

Click one option → sidebar should load that company. Re-visit the
same host without clearing storage → sidebar should skip the picker
and load the chosen company directly (picker-choice cache hit).

Click "Ingen av disse" on a fresh host → sidebar should switch to
the empty state. Re-visit → empty state without the picker re-
appearing.

- [ ] **Step 5: Smoke-test NONE / refuse cases**

Visit and verify the empty state (no picker, no wrong auto-pick):

- `https://www.finansavisen.no/` → empty (brand ≠ legal name, no
  signal)
- `https://norden.org/` → empty (intergov, not in brreg)

- [ ] **Step 6: Smoke-test the existing flows (regression check)**

Verify nothing already-working broke:

- `https://www.brreg.no/enhet/910747711` → loads ORKLA (URL regex
  path)
- `https://www.finn.no/` → loads VEND MARKETPLACES AS (curated
  domain table, 981159772)
- Refresh button while sidebar shows a company → re-fetches the
  same entity.

- [ ] **Step 7: No commit needed**

Verification only. Plan is complete.

---

## Self-review notes

Spec coverage:
- Multi-query (§ Design overview / 1) → Task 5 (`runPipeline`).
- Confidence scoring (§ 2) → Tasks 2–3.
- Three bands (§ 3) → Task 3 `decideBand` + Tasks 5, 9.
- Sidebar picker UI (§ 4) → Tasks 7–9.
- Cache + race-guard (§ Cache and race-guard implications) → Task 5
  cache schema + Task 9 (loadRunId bump in `showPicker`).
- Validation (§ Validation: benchmark results) → Task 11.
- Out-of-scope items (title parsing, brand-to-legal mapping, picker
  UX polish) → deliberately excluded.

Type consistency:
- `ResolutionBand`, `HostnameResult`, `DetailedResult`, `ScoreResult`
  defined once in `hostname-score.ts` / `hostname-search.ts`,
  imported elsewhere.
- `searchByHostname` keeps its `Promise<string | undefined>`
  signature — `orgnr.ts` and `popup.ts` callers untouched.
- `searchByHostnameDetailed`'s `choice` field is only set on
  `band === 'auto'` — covered by tests in Task 6.

Security:
- No new `host_permissions`, no content scripts, no CSP relaxation
  (CLAUDE.md § Security constraints).
- Only `data.brreg.no` queries via `searchEnheterWithParams`, which
  reuses the same `${API}/enheter` base URL as the existing
  `searchEnheter`.

Frequent commits: each task ends in a commit. Tests precede
implementation in Tasks 1–3, 5, 6. Tasks 7–9 modify UI / network code
that has no unit harness, so they ship with manual verification in
Task 11.
