# Resolution cascade

Source: `src/lib/orgnr.ts`, `src/lib/mod11.ts`,
`src/lib/hostname-search.ts`.

<!-- SECTION: cascade -->
## Cascade order

`resolveOrgnr` (sync) in `src/lib/orgnr.ts` tries:

1. An orgnr named EXPLICITLY in a query param (`?orgnr=`,
   `?organisasjonsnummer=` …) — author intent, wins outright.
2. A single distinct mod-11-valid 9-digit run in the URL.
3. A single distinct mod-11-valid 9-digit run in the title.

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
