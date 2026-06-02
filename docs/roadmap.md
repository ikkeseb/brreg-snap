# Post-MVP roadmap

Forward-looking work after the Chrome MVP (which is feature-complete bar
auto-sync — see `docs/chrome-port.md`). Ordered by value/effort. None of
these may violate the non-negotiables (no content scripts, only
`data.brreg.no`, minimal install perms, strict CSP, zero third-party
runtime JS, no curated host→orgnr table).

## Do these next (3)

1. **Verify the Chrome side-panel → `permissions.request` gesture** (gates
   all of auto-sync). The code is already written correctly:
   `details.ts handleToggleChange` calls `permissions.request` as the
   first async call inside the toggle's own `change` handler — the
   documented-valid shape. The one unknown is whether Chrome treats a
   *side-panel page's* input event as a valid activation (Chrome docs
   don't explicitly enumerate side-panel pages as a gesture context).
   This is a ~5-min manual test, not a redesign: throwaway unpacked
   extension with a side-panel checkbox that calls
   `chrome.permissions.request({permissions:['tabs']})` and logs the
   result; load in Chrome 116+, flip it, watch for the prompt.
   - Green (prompt shows) → ship auto-sync as-is.
   - "must be called during a user gesture" → use the popup-mediated
     grant fallback (move the grant to the action popup, an unambiguous
     gesture context; the side-panel toggle then just reflects state).

2. **Ship Chrome auto-sync** (if #1 is green). The code already exists and
   is engine-gated; re-enabling is three un-gates + a manifest delta:
   - `public/manifest.chrome.json`: add `"optional_permissions": ["tabs"]`
     (does NOT change the install dialog — optional perms don't prompt).
   - `src/details/details.ts`: remove the `!isFirefox` early-return in
     `setupAutoSyncToggle` (un-hide the toggle). Make the deny message in
     `auto-sync-controller.ts` engine-aware ("Firefox blokkerte…").
   - `src/background/background.ts`: drop the `!isFirefox` short-circuit
     in `refreshAutoSyncEnabled`. The tab listeners are already
     registered unconditionally at top level (correct for the SW wakeup
     model), so no rewiring.
   - Test matrix: toggle on → switch between a NO-company site and a
     non-company site → the open panel repaints / clears; toggle off →
     `permissions.remove` fires and tab switches stop updating.

3. **`setPanelBehavior({openPanelOnActionClick})` as an opt-in preference.**
   Native Chrome ergonomic (toolbar icon opens the panel). Caveat:
   `true` suppresses the popup (action opens panel OR popup, not both),
   and the popup is brreg-snap's primary fast-glance surface — so make it
   a stored preference, NOT the default. ~10 lines, no new permissions.

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
