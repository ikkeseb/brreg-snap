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
refresh doesn't re-hit. `hostname-search.ts` caches positive results
*and* negative results (as `null`) under `hostname:<host>` keys so
browsing back to mdn.mozilla.org doesn't re-search every visit.

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
