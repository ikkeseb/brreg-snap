# Resolution cascade

Source: `src/lib/orgnr.ts`, `src/lib/mod11.ts`,
`src/lib/hostname-search.ts`.

<!-- SECTION: cascade -->
## Cascade order

`resolveOrgnr` (sync) in `src/lib/orgnr.ts` tries:

1. An orgnr named EXPLICITLY in a query param (`?orgnr=`,
   `?organisasjonsnummer=` …) — author intent, wins outright.
2. A single distinct valid candidate in the URL.
3. A single distinct valid candidate in the title.

A candidate is either a contiguous 9-digit run or the canonical
display format — three groups of three digits with ONE consistent
separator from {space, dot, U+00A0} ("982 463 718", "982.463.718").
Mixed separators and groups embedded in longer digit sequences
("1982 463 718") are rejected; spaced matches normalize to 9 digits
and share the same candidate set as contiguous runs, so the same
orgnr in both formats counts once.

`resolveOrgnrAsync` runs the same sync cascade then falls back to a
hostname-based brreg search (`searchByHostname` in
`hostname-search.ts`). There is no static domain → orgnr table —
every resolution decision is a live brreg API call. Hosts brreg's
data can't disambiguate (e.g. `finn.no`, whose legal name "FINN.no"
loses its period in the search index) simply don't resolve, and the
sidebar falls back to inline manual search.

**Ambiguity → abstain (anti-shadowing).** `extractOrgnrFromText`
trusts a 9-digit run ONLY when it is the *single* distinct mod-11-valid
candidate in the text; with two or more distinct valid candidates it
returns `undefined`. ~9% of arbitrary 9-digit numbers pass mod-11, so a
chance-valid tracking id / product id / timestamp positionally before
the real orgnr used to win and silently resolve the WRONG company
(the pre-2026-06 "first valid run wins" behaviour). A bare 9-digit
*path* segment is deliberately NOT authoritative — it is as likely a
product id — so it rides the same single-candidate rule; only a *named*
param wins amid other digits (abstaining if two named values disagree).
Abstaining drops through to the hostname pipeline / picker: better no
answer than a confidently wrong one. The named-param + ambiguity cases
are pinned in `tests/orgnr.test.ts`.

<!-- SECTION: mod11-module -->
## Why `mod11.ts` is its own module

`isValidOrgnr` is consumed by `orgnr.ts` (URL/title cascade) and
`details.ts` (validating the `?orgnr=` URL param before fetching).
Keeping it in a zero-dependency module means new callers can pull
it in without dragging the rest of `orgnr.ts` along and without
risking an import cycle.

<!-- SECTION: first-digit-89 -->
## First digit must be 8 or 9

`isValidOrgnr` requires the first digit to be 8 or 9 on top of the
mod-11 check. Empirical, not documented: the lowest registered orgnr
is 810034882 (lowest underenhet 811545082, verified against the live
API 2026-06-10 across all 1,164,034 enheter) — an artifact of the
1995 conversion from 7-digit numbers. Brreg only documents "9 digits
+ mod-11", so if a new series ever opens the check must be relaxed
in `mod11.ts`; the failure mode is graceful (extraction misses →
hostname/name-search fallback). Until then it rejects most
chance-valid junk ids that mod-11 alone lets through (~9% of
arbitrary 9-digit runs).

<!-- SECTION: sync-vs-async -->
## Sync vs async — when to call which

`resolveOrgnr` / `deriveSync` are still exported because some callers
run inside a user-gesture stack and can't await before the next
browser API call (`sidebarAction.open`, `permissions.request`). The
context menu handler is the canonical example: it sync-resolves for
`setPanel + open`, then runs `deriveSyncAsync` in a detached promise
for the broadcast.

Everything else (popup init, sidebar `resolveFromActiveTab`,
background tab listeners) uses the async variant. The sidebar calls
`searchByHostnameDetailed` directly so it can branch on the resolution
band (see § bands below) and render the picker for ambiguous hosts.

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
| `picker` | top ≥ 45 | popup + sidebar show top-N + "Ingen av disse" |
| `none` | otherwise | sidebar shows empty state |

The AUTO margin requirement is what prevents kjedebutikker (ELKJØP
LEKNES vs ELKJØP SVOLVÆR, both 111 via hjemmeside-exact) from
auto-resolving.

The picker row count is `MAX_PICKER_CANDIDATES` exported from
`hostname-search.ts` — currently 4. The constant is tied to the
keyboard shortcuts (1-4 select the corresponding row, 0/Esc triggers
"Ingen av disse") both popup and sidebar register at module load.
Bumping the constant requires extending the digit-key handler in
`popup.ts` and `details.ts`.

<!-- SECTION: label-extraction -->
## Label extraction (multi-part TLDs, punycode)

`hostnameLabel` in `hostname-score.ts` picks the registrable label
that seeds the name search. Two traps it handles:

- **Multi-part public suffixes.** A small static list (`co.uk`,
  `com.au`, `kommune.no`, … — intentionally non-exhaustive, generic
  TLD knowledge, NOT curated company data) shifts the label one part
  left so `company.co.uk` → "company" and `oslo.kommune.no` → "oslo"
  instead of "co"/"kommune".
- **Punycode.** `new URL().hostname` returns IDN labels in ACE form
  (`blåbær.no` → `xn--blbr-roah.no`). A minimal RFC 3492 decoder
  (`src/lib/punycode.ts`, decode only) restores the human label so
  the Nordic-variant machinery can actually match æ/ø/å brands. A
  label that fails to decode returns `undefined` — the abstain
  signal: `resolveInternal` treats a falsy label as band `none`, so
  the sidebar falls to manual search instead of querying a raw
  `xn--` string that can never match.

<!-- SECTION: hjemmeside-normalization -->
## Hjemmeside normalization

Brreg's `hjemmeside` field is free text ("http://www.equinor.com",
"https://orkla.com/", "tine.no/om"). `normalizeHjemmeside` in
`hostname-score.ts` reduces it to a bare lowercase host (strip
scheme, `www.`, path/port/query/fragment, trailing dots) before the
exact/prefix/substring comparison, so an exact-host field earns the
full +35 instead of leaking down to substring (+12). Scoring bands
and thresholds are unchanged by normalization.

<!-- SECTION: picker-choice -->
## Picker choice cache

When the user picks from the sidebar's "Mente du…?" list,
`setPickerChoice(host, orgnr)` writes a 24h entry under
`picker-choice:<host>`. The next visit short-circuits both bands and
the network — `searchByHostnameDetailed` returns `{band:'auto',
candidates:[], choice}`. `setPickerChoice(host, null)` ("Ingen av
disse") caches a negative choice that returns `{band:'none'}` on the
next visit. Clears with the existing `storage.session` lifetime.

<!-- SECTION: reject-override -->
## Reject override (`Feil bedrift?` / `Feil treff?`)

Both popup ("Feil treff? Vis alternativer") and sidebar ("Feil
bedrift? Vis alternativer") expose this link on the result panel
whenever the current orgnr was resolved by hostname search
(`host-auto` or `host-pick` resolution method). Clicking it calls
`addRejectedChoice(host, orgnr)` which:

1. Appends the orgnr to `rejected:<host>` (24h TTL).
2. Clears `picker-choice:<host>` if it equals the rejected orgnr.

The next `searchByHostnameDetailed` reads the rejected list, passes
it through `runPipeline` which filters rejected candidates before
scoring, and stores the result under
`hostname:<host>:rej:<sorted>` so the pre-rejection cache entry
isn't served. The picker then opens over the remaining candidates
(even when filtering leaves a single AUTO winner — the user just
expressed doubt, the picker requires explicit confirmation). Empty
after filtering → empty state with inline manual search.

URL-derived orgnrs (regex hit in path or title) do not show the
override — they're authoritative for the domain.
