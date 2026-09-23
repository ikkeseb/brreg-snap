# Cache + race guards

Source: `src/lib/brreg.ts`, `src/lib/hostname-search.ts`,
`src/popup/popup.ts`, `src/details/details.ts`.

<!-- SECTION: 24h-session -->
## 24h session cache

`src/lib/brreg.ts` wraps every API call in `browser.storage.session`
for 24 hours. `storage.session` is in-memory, process-local, and
cleared when the browser shuts down — *not* `storage.local`. Cache
writes are typed (`CacheEntry<T>` with `expiresAt` + `storedAt`) and
fetchers validate the response shape via `isEnhet` / `isUnderenhet` /
`isRollerResponse` before caching (no blind `as Enhet` cast).

The module is `src/lib/session-cache.ts`. Its rules:

- **Best-effort both ways.** A storage error on read is a miss; a
  failed write is swallowed (after one sweep-and-retry). A full quota
  must never turn a successful brreg fetch into an error.
- **Per-entry TTL.** `cacheSet(key, value, ttlMs?)` defaults to 24h;
  callers pass less for outcomes that shouldn't stick for a day.
- **Sweep.** Reads evict only the key they touch, so `cacheSet` also
  sweeps every expired entry (`get(null)`), at most once per 10 min
  per page. The sweep only removes values shaped like a `CacheEntry`,
  so the recents list (a bare array) is safe.
- **Data age.** `storedAt` is the fetch time. `cacheStoredAt(keys)`
  returns the oldest live one; `getFetchedAt(orgnr)` in `brreg.ts`
  wraps it for one company's keys, and `invalidateCache(orgnr)` drops
  them for a refetch.

`fetchRegnskap` caches empty results (404, normal for small AS) for
24h and "unavailable" results (500, banks/insurers) for 6h, so a
refresh doesn't re-hit (see `docs/notes/brreg-api.md`
§ regnskap-500-unsupported-plan).

`hostname-search.ts` caches under three keys:

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

Both surfaces guard their loads with a monotonic token (same pattern
as `searchRunId`): `src/details/details.ts` with the one load sequence
from `src/lib/panel-follow.ts` (every flow that paints claims it — see
sidebar-sync.md § load-race-guards), so a sync or tab event that lands
while an older load is still fetching can't be overwritten by the
older response; `src/popup/popup.ts` with `loadRunId`, so rapid clicks
(manual hit → recent entry) can't paint the first-clicked, stale
company. Keep both.
