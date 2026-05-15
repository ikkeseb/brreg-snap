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

All three keys honor the same 24h TTL. Network errors still bypass
caching so the next visit retries.

<!-- SECTION: search-runid -->
## Search debounce + race guard

`src/popup/popup.ts` uses a monotonic `searchRunId` token to drop
stale `runSearch` results when the user keeps typing — the network
can land calls out of order otherwise. Don't simplify it away.

<!-- SECTION: load-runid -->
## Sidebar load-run-id guard

`src/details/details.ts` uses a monotonic `loadRunId` token (same
pattern as `searchRunId`) so a sync push that arrives while a
previous `loadOrgnr` is still fetching doesn't get overwritten by the
older response. Keep it.
