# Cache + race guards

Source: `src/lib/brreg.ts`, `src/lib/hostname-search.ts`,
`src/popup/popup.ts`, `src/details/details.ts`.

<!-- SECTION: 24h-session -->
## 24h session cache

`src/lib/brreg.ts` wraps every API call in `browser.storage.session`
for 24 hours. `storage.session` is in-memory, process-local, and
cleared when the browser shuts down — *not* `storage.local`. Cache
writes are typed (`CacheEntry<T>` with `expiresAt`) and reads validate
the response shape via `isEnhet` / `isUnderenhet` /
`isRollerResponse` before returning (no blind `as Enhet` cast).

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
- `rejected:<host>` → `string[]`. Orgnrs the user said "Feil bedrift?"
  on for this host. The pipeline filters these out before scoring,
  and the band cache key folds the sorted set in
  (`hostname:<host>:rej:<a>|<b>`) so a fresh rejection doesn't serve
  the stale pre-rejection result. `addRejectedChoice` also clears the
  positive `picker-choice:<host>` if it equals the rejected orgnr —
  otherwise the choice would keep short-circuiting future
  resolutions back to the rejected entity.

All three keys honor the same 24h TTL.

<!-- SECTION: failure-no-cache -->
## Failures never enter the band cache

`searchEnheter` / `searchEnheterWithParams` THROW on network failure,
timeout, or any non-2xx (429/503 included). `[]` means a genuine
2xx response with zero hits, nothing else — the pipeline must be able
to tell "no hits" from "couldn't ask".

The pipeline (`runPipeline` in `hostname-search.ts`) settles each
constituent query individually (`Promise.allSettled` via
`settleSearches`) and tracks a `complete` flag:

- **All queries succeeded** → result cached under the band key,
  exactly as before.
- **Partial failure** (some queries failed, others returned hits) →
  the best-effort result from the successful queries is returned to
  the caller, but the band cache is NOT written.
- **All queries failed** → `{band: 'none', candidates: []}` is
  returned, NOT cached.

In both failure cases the next visit re-runs the pipeline instead of
serving a 24h "no match" — an offline or throttled moment must never
pin `{band: 'none'}` for a day. The no-label early exit (hostname has
no usable brand label) still caches `'none'`: that's a deterministic
property of the hostname, not a network outcome. Picker-choice and
rejected caches are written only on explicit user action and are
unaffected by query failures.

All brreg fetches carry `AbortSignal.timeout(8000)`; a timeout rejects
the fetch and counts as a failure like any other (no retries).

<!-- SECTION: search-runid -->
## Search debounce + race guard

`src/lib/ui/manual-search.ts` (shared by popup and sidebar) uses a
monotonic `searchRunId` token to drop stale `runSearch` results when
the user keeps typing — the network can land calls out of order
otherwise. Don't simplify it away.

<!-- SECTION: load-runid -->
## Load-run-id guards

Both surfaces use a monotonic `loadRunId` token (same pattern as
`searchRunId`): `src/details/details.ts` so a sync push that arrives
while a previous `loadOrgnr` is still fetching doesn't get overwritten
by the older response, and `src/popup/popup.ts` so rapid clicks
(manual hit → recent entry) can't paint the first-clicked, stale
company. Keep both.
