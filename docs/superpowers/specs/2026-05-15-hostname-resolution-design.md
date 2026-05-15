# Hostname-based resolution: scoring, thresholds, sidebar picker

**Date:** 2026-05-15
**Status:** Draft, pending review
**Supersedes:** `backlog.md` § Bug 1 (hostname→brreg search), `handoff/tune hostname-based resolution`

## Context

Bug 1 wired hostname-based brreg search as step 4 of the resolution
cascade (`src/lib/hostname-search.ts`). QA on real sites showed
roughly 60/40 hit-rate. Empirical investigation of brreg's documented
API (`data.brreg.no/enhetsregisteret/api/dokumentasjon/no/index.html`)
plus benchmarking against 17 hostnames identified the root causes:

- **Single-query strategy is too narrow.** `?navn=<label>` is
  prefix-style; substring matches inside legal names are missed.
- **`navnMetodeForSoek=FORTLOEPENDE` exists** and gives substring
  matching, but only within contiguous strings — not across word
  boundaries. "detnorsketeatret" still misses "DET NORSKE TEATRET".
- **`?hjemmeside=<url>` is a documented query parameter** with
  substring matching. Useful but unreliable as a primary signal: the
  field is sparsely populated, and when populated it more often
  represents satellite associations (vennelag, pensjonskasse) or
  drift companies than the parent. Confirming signal, not load-bearer.
- **Binary confidence is wrong.** The current pick is "first prefix
  match wins" — no notion of "this might not be the right entity,
  ask the user". Treffsikkerhet (priority 1, per user) requires the
  ability to refuse to resolve, and to surface alternatives when
  ambiguous.
- **Curated overrides are off the table.** Per user, all resolution
  must be on-demand. `domains.ts` retains its existing 11 entries as
  the cascade's step 3 (for cases brreg literally cannot resolve like
  FINN.no), but is not the scaling answer for ambiguous matches.

## Goal

Improve treffsikkerhet measurably while operating under three hard
constraints:

1. **Zero false auto-resolves.** Better to refuse than to confidently
   pick the wrong entity. Benchmark target: 0 auto-WRONG on the test
   set.
2. **No new permissions, no new hosts.** Stays on `data.brreg.no`
   only; respects the manifest constraints in `CLAUDE.md § Security
   constraints`.
3. **No pre-curated mapping table.** Every resolution decision is
   computed from a live brreg query.

When the system cannot decide with confidence, surface plausible
alternatives in a sidebar picker — never auto-pick.

## Design overview

Three changes:

### 1. Multi-query candidate gathering

`hostname-search.ts` issues parallel queries instead of one:

- **Q1 — `?hjemmeside=<host>`** with two host variants (bare,
  `www.`-prefixed). Protocol is stripped before query; trailing slash
  irrelevant (brreg matches as substring). Confirming-signal-only.
- **Q2 — `?navn=<label>&navnMetodeForSoek=FORTLOEPENDE&organisasjonsform=AS,ASA,SA,ORGL,SF&sort=antallAnsatte,DESC&size=20`**
  for each Nordic-folded label variant. Folding generates one
  variant per `o→ø` and `a→å` position, plus `ae→æ` and `aa→å` if
  applicable. Capped at one substitution per position so the variant
  set stays small.
- **Q3 (only if Q1+Q2 yields no candidates) — `?navn=<label>&navnMetodeForSoek=FORTLOEPENDE&size=20`**
  with no org-form filter. Catches ORGL/SF entities like
  EKSPORTFINANSIERING NORGE — but only when nothing else turned up.

Candidates are deduplicated by `organisasjonsnummer`. The merged set
goes through scoring.

### 2. Confidence scoring

The scoring function in `hostname-search.ts` replaces the current
"first prefix match wins" rule. Inputs: candidate `enhet` object,
hostname label (lowercased, ASCII-folded), and the full hostname (for
hjemmeside-match comparisons).

Hard gate: a candidate with neither a name relation (label found
inside the legal name) nor a hjemmeside-field relation scores 0 and
is dropped. This kills false positives like norden.org → NORDAN AS
(unrelated entity that shares an org form and high employee count).

Name-match (load-bearing, mutually exclusive):

| Relation | Score |
|---|---|
| Exact name or prefix-then-space | `28 + round(20 / wordCount)` |
| Prefix without word boundary (SHELLUX from "shell") | 22 |
| Internal word boundary or end-of-string | 28 |
| Substring inside a single word | 12 |

The ratio bonus on the prefix tier rewards labels that fill more of
the name: ORKLA matches ORKLA ASA (2 words → +10) more strongly than
ORKLA FOODS NORGE AS (4 words → +5).

Hjemmeside-felt match (confirming signal, not primary):

| Relation | Score |
|---|---|
| Exact | 35 |
| Prefix | 22 |
| Substring | 12 |

Org-form bias:

| Form | Bonus |
|---|---|
| ASA | +28 |
| ORGL, SF | +18 |
| AS | +15 |
| SA | +12 |
| DA, ANS | +5 |
| NUF | −10 |
| UTLA | −15 |
| STI | −20 |
| ENK | −25 |
| PK | −30 |
| FLI | −35 |
| PERS | −50 |

Additional signals:

- Top-level (no `overordnetEnhet`): +12. Subsidiary: −6.
- Employees: `≥500` +20, `≥100` +15, `≥10` +8, `≥1` +3.
- `registrertIForetaksregisteret`: +6.
- Name length: 2 words +10, 1 word +5, ≥5 words −10.
- Konkurs / underAvvikling: −30.
- Noise word in name (VENNELAG, VENNER, PENSJONSKASSE, KLUBB,
  FORENING, STIFTELSEN, SUPPORTER, ANSATTES, SENIOR, BEDRIFTSIDRETT,
  IDRETTSLAG, KORPS, ARBEIDERLAG, VETERAN): −40.
- Subsidiary keyword in name when label is matched (SVERIGE, DANMARK,
  FINLAND, FINANCE, FINANS, INVEST, FOODS, HEALTH, SNACKS, CARE,
  EIENDOM, PROPERTY, ASIA, EUROPE, GLOBAL, IT): −15. **NORGE,
  NORWAY, NORDIC, INTERNATIONAL, GROUP, GRUPPEN, HOLDING are NOT
  here** — they regularly name the country-level operating company
  or the group parent itself.

### 3. Three-band resolution

| Band | Condition | Outcome |
|---|---|---|
| AUTO | top score ≥ 75 **and** top − runner-up ≥ 10 | resolve to top candidate, sidebar shows entity |
| PICKER | top score ≥ 45 | sidebar shows "Mente du…?" with top 4 candidates + "Ingen av disse" |
| NO-MATCH | otherwise | sidebar shows "ingen sikker match" |

The margin requirement on AUTO is critical: it prevents auto-picking
when several candidates have similar scores (typical for kjedebutikk
hostnames like elkjop.no, where every regional Elkjøp AS scores the
same via hjemmeside-match).

### 4. Sidebar picker UI

New component in `src/details/details.ts` and the sidebar HTML.
Triggered when resolution returns `band: 'picker'`. Shows:

```
Vi fant flere mulige treff på denne siden:

  [ ] Selskap A AS — 9XX XXX XXX, X ansatte
  [ ] Selskap B AS — 9XX XXX XXX, X ansatte
  [ ] Selskap C AS — 9XX XXX XXX, X ansatte
  [ ] Selskap D AS — 9XX XXX XXX, X ansatte
  [ ] Ingen av disse
```

User selects a candidate → orgnr resolves to that entity, normal
detail view renders. User selects "Ingen av disse" → falls through
to the no-match state.

Picker state is per-host: once a user has chosen for a given
hostname, the choice is cached in `storage.session` under
`picker-choice:<host>` so subsequent visits within the cache window
skip the picker. Cache TTL matches the existing 24h hostname-search
cache. Selecting "Ingen av disse" caches a negative choice — the
sidebar will render the no-match state directly on next visit instead
of showing the picker again.

Language is intentionally non-committal. "Mente du…?" and "Ingen av
disse" — not "Velg riktig selskap", which would imply we know the
answer is among the options.

## Cache and race-guard implications

The existing `hostname:<host>` cache key in `storage.session` extends
to hold the resolution band (`auto` | `picker` | `none`) plus the
candidate list. `loadRunId`/`searchRunId` race guards apply
unchanged — the picker's resolve-on-click goes through the same path
as today's auto-resolve.

Cache invariants:

- `auto` and `none` results cache 24h as today.
- `picker` results cache the candidate list 24h, but the user's
  `picker-choice` cache wins if present (so a user who explicitly
  picked on day 1 doesn't see the picker on day 2 unless they clear
  it).
- Network errors still bypass caching.

## Validation: benchmark results

Run `node scripts/benchmark-hostname.mjs` to reproduce. Against the
17-hostname test set:

- AUTO-correct: 6 (orkla.com, tv2.no, equinor.no, dnb.no, yara.com,
  telenor.no)
- Refuse-correct: 4 (finansavisen.no, eksfin.no, zalando.no,
  norden.org)
- PICKER with right answer in top 4: 3 (shell.no, elkjop.no,
  storebrand.no)
- PICKER with plausible alternative but not optimal: 3 (lieoverflate,
  nrk, rema1000)
- Missed (refuse when answer exists): 1 (detnorsketeatret — requires
  title-parsing)
- **AUTO-WRONG: 0**

13/17 strictly correct, 3 surfacing reasonable alternatives via
picker, 1 honest refuse. Most importantly: zero false auto-resolves.

## Out of scope / backlog

Not addressed in this design — explicitly deferred:

- **Title parsing.** Hostnames that collapse spaces present in the
  legal name (rema1000.no → "REMA 1000", detnorsketeatret.no → "DET
  NORSKE TEATRET", lieoverflate.no → "LIE OVERFLATE") cannot be
  resolved from the hostname alone. The page `<title>` carries the
  right tokens with correct spacing; a follow-up could parse title
  and use those tokens as a secondary brreg query. Requires no new
  permissions (activeTab covers it) but adds a new pipeline stage.
- **Brand-to-legal-name mapping for stub-brand hostnames.**
  finansavisen.no → HEGNAR MEDIA AS, eksfin.no → EKSPORTFINANSIERING
  NORGE, nrk.no → NORSK RIKSKRINGKASTING AS. The legal name shares
  no tokens with the brand, and brreg has no alias/historikk field.
  Title parsing may help when the title carries the legal name; in
  the general case these will remain refuse.
- **Picker UX polish.** Keyboard navigation, last-used-orgnr at the
  top, "show more" beyond top 4. Defer to a follow-up once we have
  feedback on the v1 picker.

## Implementation notes

- `hostname-search.ts` grows new exports: `searchByHostname` keeps its
  current signature for backward compat with the sync cascade entry
  point but is reimplemented to use the multi-query pipeline. A new
  `searchByHostnameDetailed` returns `{band, candidates, choice?}`
  for the picker flow.
- Scoring lives in a new file `src/lib/hostname-score.ts` so it can be
  unit-tested independently of API calls.
- The `vitest` suite gains `tests/hostname-score.test.ts` with fixture
  responses from the benchmark — including all 17 hostnames so any
  regression on the existing matrix surfaces in CI.
- The benchmark script (`scripts/benchmark-hostname.mjs`) stays in
  the repo as a runnable harness for tuning. Not part of the shipped
  bundle.
- Sidebar HTML in `src/details/details.html` gets a new
  `data-state="picker"` block, hidden by default.
- All security constraints from `CLAUDE.md` remain unchanged: no new
  hosts, no content scripts, no new install-time permissions.
