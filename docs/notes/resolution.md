# Resolution cascade

Source: `src/lib/orgnr.ts`, `src/lib/mod11.ts`, `src/lib/domains.ts`,
`src/lib/hostname-search.ts`.

<!-- SECTION: cascade -->
## Cascade order

`resolveOrgnr` (sync) in `src/lib/orgnr.ts` tries:

1. URL regex
2. Title regex
3. Domain table (`domainToOrgnr` from `domains.ts`)

`resolveOrgnrAsync` runs the same cascade then falls back to a
hostname-based brreg search (`searchByHostname` in
`hostname-search.ts`). The domain override stays *before* the search
on purpose — the search can't find FINN.no (brreg name search drops
the dot) or sparebank1.no (legal entity name diverges from the
brand), so manual entries take precedence.

The regex iterates every 9-digit run via `matchAll` and accepts the
first mod-11 valid candidate — needed because an upstream phone
number or article id can shadow a real orgnr in the same string.

<!-- SECTION: mod11-cycle -->
## Why `mod11.ts` is its own module

`domains.ts` runs a module-load invariant that every table entry
passes mod-11, which means it must import `isValidOrgnr`. `orgnr.ts`
imports `domainToOrgnr` for the fallback cascade. If mod-11 lives in
`orgnr.ts` directly, those modules cycle and the invariant crashes
with "isValidOrgnr is not a function" at test-run time. Keep mod-11
in its own zero-dependency module.

<!-- SECTION: sync-vs-async -->
## Sync vs async — when to call which

`resolveOrgnr` / `deriveSync` are still exported because some callers
run inside a user-gesture stack and can't await before the next
browser API call (`sidebarAction.open`, `permissions.request`). The
context menu handler is the canonical example: it sync-resolves for
`setPanel + open`, then runs `deriveSyncAsync` in a detached promise
for the broadcast.

Everything else (popup init, sidebar `resolveFromActiveTab`,
background tab listeners) uses the async variant.
