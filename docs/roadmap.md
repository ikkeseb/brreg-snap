# Post-MVP roadmap

Forward-looking work after the Chrome launch (live on CWS since
2026-06-07 at feature parity, including auto-sync — see
`docs/chrome-port.md`). Ordered by value/effort. None of
these may violate the non-negotiables (no content scripts, only
`data.brreg.no`, minimal install perms, strict CSP, zero third-party
runtime JS, no curated host→orgnr table).

## Do these next

1. ~~**Verify the Chrome side-panel → `permissions.request` gesture**~~
   **SHIPPED via D13, 2026-06-06.** Live-verified by Seb: the `tabs`
   prompt fires from the side-panel toggle (Chrome treats the
   side-panel input event as a valid activation), so no popup-mediated
   fallback was needed. See `docs/chrome-port.md` D13 / Phase 6.

2. ~~**Ship Chrome auto-sync**~~ **SHIPPED via D13, 2026-06-06**, in
   Chrome 1.0.0 (live on CWS 2026-06-07). `optional_permissions:["tabs"]`
   landed in the Chrome manifest, the two `isFirefox` short-circuits were
   dropped, and the `tabs.onUpdated` filter throw was fixed en route.
   See `docs/chrome-port.md` D13 / Phase 6 for the full trail.

3. **`setPanelBehavior({openPanelOnActionClick})` as an opt-in preference.**
   Native Chrome ergonomic (toolbar icon opens the panel). Caveat:
   `true` suppresses the popup (action opens panel OR popup, not both),
   and the popup is brreg-snap's primary fast-glance surface — so make it
   a stored preference, NOT the default. ~10 lines, no new permissions.

4. ~~**Bump GitHub Actions off the Node 20 runtime before 2026-06-16.**~~
   **DONE 2026-07-04** (checkout@v7, setup-node@v6, pnpm/action-setup@v6
   in both workflows), together with a Dependabot config that keeps the
   actions current from here on.

## Also worth doing

| # | Item | Effort | Risk | Notes |
|---|------|--------|------|-------|
| P6 | `commands` keyboard shortcut to open the popup (`_execute_action`, e.g. `Alt+B`) — both manifests, zero JS. Bundle Firefox's `_execute_sidebar_action` in the same pass. | S | low | Already in `backlog.md`. `commands` is a manifest key, not a permission. |
| P12 | **Reconcile `scripts/benchmark-hostname.mjs` with shipped scoring.** *Verified drift:* the benchmark reimplements `scoreCandidate`/`generateNordicVariants`/thresholds instead of importing `src/lib/hostname-score.ts` (it's a `.mjs`, can't import the `.ts` without a build step). The correctness safety-net is therefore measuring drifted code. **Prerequisite for P8.** | M | low | Not a shipped bug — dev-tooling reliability. |
| P8 | Trim hostname-search request fan-out (~13 brreg requests per cold resolution; the Nordic-variant fan-out is the bulk). | M | med | **Do P12 first.** Safety process: `node scripts/benchmark-hostname.mjs` to lock the baseline ledger (the `0 AUTO-WRONG` line is the invariant), change one thing, re-run, accept only if the ledger is byte-identical AND request count dropped. Never trim by reasoning — measure. |
| P9 | Batch `addRejectedChoice`'s ~4 sequential `storage.session` round-trips (the two reads can `Promise.all`). | S | low | `tests/hostname-search.test.ts` covers the reject/picker-choice interaction — keep green. |

## Parked / rejected

- **Omnibox keyword lookup** (`brreg <name>` in the address bar) —
  rejected: duplicates the popup's manual search with worse ergonomics
  and adds a permanent reserved keyword. Doesn't clear the
  minimal-surface bar. Revisit only on explicit user demand.
- **Skip tab-event work when auto-sync is off** — already handled: the
  `onActivated`/`onUpdated` handlers gate synchronously on the in-memory
  `autoSyncEnabled` flag. The listeners must stay registered at top level
  for the SW wakeup contract; the cold-start refresh await is deliberate.
- **`@types/chrome`** — deferred. The inline `ChromeSidePanel` typing in
  `platform/sidebar.ts` is 8 lines; revisit only if Phase 6 adds a third
  Chrome-only cast.
