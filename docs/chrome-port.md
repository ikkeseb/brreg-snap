# Chrome port plan

Working doc for porting brreg-snap to Chrome / Chromium. Lives on
the `chrome-port` branch and stays there until the port lands —
keeps `main` aligned with the Firefox AMO submission until that
review is done.

This is a session-resumable plan: when picking up after a break,
read **Status** and **Next action**, then jump to the relevant
phase.

---

## Status

- **Current phase:** Phases 1–3 **done** (2026-06-01). Chrome MVP
  builds, type-checks, lints, and passes the full unit suite (170
  tests). Phase 4 (live Chrome smoke test) is the only thing between
  here and a CWS submission — and it needs a human at a Chrome window.
- **Branch:** `chrome-port-mvp`, off `chrome-port` (which is off
  `d98dc69` == `v1.0.0` == AMO submission snapshot). All Chrome work
  lives here; merge `chrome-port-mvp` → `chrome-port` once Phase 4 is
  green, then follow the CLAUDE.md embargo before `chrome-port` → `main`.
- **AMO review:** approved 2026-05-19; the 7-day-stable window passed
  2026-05-26. Embargo conditions 1 & 2 are met; condition 3 (this
  Chrome MVP passing Phase 4) is the last gate before a `main` merge.
  Merging is **Seb's call** — not done autonomously.
- **What deviates from the original plan (decided during build):**
  D3 (webextension-polyfill) → **in-house shim** (see D8); build-time
  module aliasing → **runtime feature detection** (see D9); D4
  (auto-sync deferred on Chrome) **reversed** — auto-sync brought
  forward into the MVP (see D13); `tabs` is a runtime opt-in in the
  Chrome manifest, same as Firefox.
- **Next action:** run the Phase 4 manual smoke matrix below in Chrome
  (load `dist-chrome/` unpacked), then `pnpm package:chrome` and follow
  `docs/cws-submission.md`.

### How to load the Chrome build for testing

```bash
pnpm build:chrome          # -> dist-chrome/
# chrome://extensions → enable "Developer mode" → "Load unpacked"
#   → select the dist-chrome/ directory
```

---

## Decisions (locked)

| # | Decision | Date | Why |
|---|----------|------|-----|
| D1 | Single repo, branch-based work | 2026-05-16 | ~95% of code is shared; two repos would drift |
| D2 | Build-time platform switching via `BROWSER=firefox\|chrome` env | 2026-05-16 | Smaller bundles than runtime-conditional; cleaner code |
| D3 | `webextension-polyfill` for the `browser.*` namespace | 2026-05-16 | Fewer call-site changes, promise-API in Chrome free, ~10kb cost acceptable |
| D4 | MVP-first Chrome release; defer auto-sync to a later phase | 2026-05-16 | Auto-sync is the only Chrome-specific permission-UX risk; isolating it ships a Chrome build faster |
| D5 | Sequential release: Firefox 1.0.0 live + stable before Chrome submission | 2026-05-16 | Avoids dual-browser support burden during the period when bugs are most likely |
| D6 | Plan + Chrome work happens on `chrome-port` branch only; not merged to `main` until both Chrome works and AMO is done | 2026-05-16 | Keeps `main` as AMO submission truth in case Mozilla requests source-matching changes |
| D7 | Versioning: both browser builds publish under the same version number once paritised. Chrome MVP releases as a version that signals partial parity (TBD — see Q1). | 2026-05-16 | Single changelog, one mental model for users |
| D8 | **In-house `browser` shim, NOT webextension-polyfill** (reverses D3) | 2026-06-01 | Research verified every API we await returns a native Promise on Chrome ≥114 (`storage`, `tabs`, `permissions`, `runtime`, `sidePanel`); the only non-promise calls (`contextMenus.create`, `runtime.getURL`) are never awaited. The polyfill is 10 kB, in maintenance mode, and doesn't even alias `browser.menus` (issue #242). The shim (`platform/globals.ts`, ~3 lines) preserves the zero-third-party-JS guarantee that CLAUDE.md/BUILD.md treat as a hard invariant. |
| D9 | **Runtime feature detection, NOT build-time module aliasing** (refines D2) | 2026-06-01 | The only divergent surface is the sidebar adapter (~30 lines, 3 methods). Shipping both branches costs <1 KB and removes all tsc/Vite alias-resolution fragility (no `tsconfig paths`, no dual typecheck). The manifest is still switched at build time — that part genuinely can't be unified. |
| D10 | **No menus adapter — use `browser.contextMenus` uniformly** | 2026-06-01 | Firefox exposes `contextMenus` as an alias of `menus` (works under the `menus` permission); Chrome only has `contextMenus`. One namespace, behaviorally identical on Firefox. A `lastError`-swallowing callback on `create` absorbs Chrome's duplicate-id-on-SW-restart. |
| D11 | **Chrome auto-sync deferred (keeps D4); `tabs` dropped from Chrome manifest** | 2026-06-01 | The toggle is hidden on Chrome and `refreshAutoSyncEnabled` short-circuits, so the Chrome MVP ships a minimal permission set (no `optional_permissions`) for a clean first CWS review. Chrome's side-panel→`permissions.request` gesture path is plausible per docs but unverified live; not worth risking a visible-but-flaky control in v1. Re-enable in Phase 6 after live verification. Auto-sync code stays in the tree (Firefox uses it). |
| D12 | **Strip sourcemaps + `icons/README.md` from packaged artifacts** | 2026-06-01 | The Firefox `.zip` shipped 174 KB of sourcemaps (66% of the artifact) because `web-ext-config.cjs`'s `ignoreFiles` was never loaded. Packaging now passes `--ignore-files` explicitly (263 KB → 43 KB). Behaviour-neutral (no executed JS changes); maps stay in `dist-*/` for local debugging and the full TS source ships in the AMO source zip. **Firefox-artifact note:** this diverges the future Firefox `.xpi` from the on-file AMO 1.0.0 package (which included maps); fold into a future Firefox update, not a silent resubmission. |
| D13 | **Chrome auto-sync brought forward into the MVP (reverses D11/D4)** | 2026-06-06 | Live smoke surfaced the gap D11 created: with auto-sync deferred AND the refresh button gated on `tabs` (absent on Chrome), there is no way to make the panel follow the active tab — switch tab → stale, refresh → reloads the *displayed* company only. Felt broken on first use. Fix mirrors the Firefox `tabs` runtime opt-in onto Chrome: `optional_permissions:["tabs"]` in the Chrome manifest, drop the two `isFirefox` short-circuits (`refreshAutoSyncEnabled`, `setupAutoSyncToggle`). Also fixes a latent MVP bug found en route: `tabs.onUpdated.addListener(cb, {properties:['url']})` **throws** on Chrome ("This event does not support filters") and aborted the rest of background.ts module eval — harmless while auto-sync was dormant, fatal once enabled. Now filter-only-on-Firefox. Security model unchanged: `tabs` stays a runtime opt-in (not install-time), gated behind the toggle. Lives on `feat/chrome-auto-sync` off `chrome-port-mvp`. |

## Open questions

| # | Question | Status / resolution |
|---|----------|---------------------|
| Q1 | Chrome MVP version number | **Resolved: `1.0.0`** — matches Firefox. With auto-sync brought forward (D13) the Chrome build is now at feature parity, so no "missing feature" caveat is needed in the listing. |
| Q2 | Single vs per-browser CHANGELOG | **Resolved: single CHANGELOG**, `[chrome]` / `[firefox]` prefixes on browser-specific lines. Not yet written — see Phase 5. |
| Q3 | Side panel global vs tab-specific | **Resolved: global** — `setOptions`/`open` are called without a `tabId`, and `open({windowId})` opens the window-wide panel. Matches Firefox's single shared sidebar. Confirm visually in Phase 4. |

---

## Architecture

### Platform adapter

```
src/lib/platform/
  index.ts                 # re-exports the active impl based on build flag
  sidebar.ts               # interface declaration (TS types only)
  sidebar.firefox.ts       # uses browser.sidebarAction
  sidebar.chrome.ts        # uses chrome.sidePanel
  menus.ts                 # interface declaration
  menus.firefox.ts         # browser.menus.*
  menus.chrome.ts          # chrome.contextMenus.*
```

Vite resolves `./sidebar` and `./menus` inside `platform/index.ts`
to the right file via `resolve.alias`, parameterised on the
`BROWSER` env var. No conditional code in callers — they always
import from `platform/index`.

The polyfill (`webextension-polyfill`) gives us a unified
`browser.*` namespace on both Chromium and Gecko, so only the
**APIs that genuinely differ** (sidebar vs. side panel, menus vs.
contextMenus, background script vs. service worker) need adapter
modules. Everything else (`browser.storage`, `browser.runtime`,
`browser.tabs`, `browser.permissions`) stays as-is.

### Build outputs

```
dist-firefox/    # produced by BROWSER=firefox vite build
dist-chrome/     # produced by BROWSER=chrome vite build
```

`pnpm package:firefox` produces an `.xpi` in `web-ext-artifacts/`.
`pnpm package:chrome` produces a `.zip` ready for Chrome Web Store
upload.

### Manifest split

```
public/manifest.firefox.json   # current public/manifest.json, renamed
public/manifest.chrome.json    # Chrome MV3 variant
```

A small build-time step (in `vite.config.ts` or a separate script)
copies the right one to `dist-<browser>/manifest.json`.

#### Chrome manifest deltas

- `sidebar_action` → removed; replaced by `side_panel: { default_path: "details/details.html" }`
- `permissions: ["activeTab", "storage", "menus"]` → `["activeTab", "storage", "contextMenus", "sidePanel"]`
- `background.scripts` → `background.service_worker: "background/background.js"` (keep `"type": "module"`)
- `browser_specific_settings` → dropped entirely (or kept; Chrome ignores it, but cleaner to drop)
- Everything else (CSP, host_permissions, optional_permissions, action, icons) identical

---

## Phase 1 — Platform adapter refactor (Firefox-only output unchanged)

**Goal:** Introduce the `platform/` module structure with Firefox
implementations. No behaviour change in the shipped extension.
Verifiable by: existing test suite passes, `pnpm build` output
manifest is unchanged, manual smoke test in Firefox matches current
1.0.0.

**Scope check before starting:** AMO has not requested any changes
that need to land in `main` yet. If AMO comes back with a
correction request before Phase 1 lands, pause this branch and fix
on `main` first.

- [ ] Create `src/lib/platform/sidebar.ts` with TS interface (
  `setPanel(path: string): Promise<void>`,
  `open(): Promise<void>`)
- [ ] Create `src/lib/platform/sidebar.firefox.ts` wrapping
  `browser.sidebarAction.setPanel({ panel: path })` and
  `browser.sidebarAction.open()`
- [ ] Create `src/lib/platform/menus.ts` with TS interface for the
  three menu operations actually used (`create`, `onClicked.addListener`)
- [ ] Create `src/lib/platform/menus.firefox.ts` re-exporting
  `browser.menus`
- [ ] Create `src/lib/platform/index.ts` that re-exports from
  `./sidebar.firefox` and `./menus.firefox` for now (no aliasing
  yet — Phase 2 introduces that)
- [ ] Update `src/background/background.ts` to import from
  `../lib/platform` instead of touching `browser.sidebarAction` and
  `browser.menus` directly
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` passes (no test changes needed — behaviour is
  identical)
- [ ] `pnpm lint:ts` clean
- [ ] `pnpm build` succeeds
- [ ] `pnpm lint:ext` (web-ext lint on `dist/`) clean
- [ ] Manual smoke in Firefox via `pnpm dev`: popup opens, side menu
  opens, lookup works, "show in sidebar" right-click works
- [ ] Commit: `refactor: introduce platform/ adapter module (firefox-only)`

**Risk flags:**

- If TypeScript path resolution gets weird because of how `browser`
  is typed (`@types/firefox-webext-browser`), we may need to install
  `@types/webextension-polyfill` early. Defer that to Phase 2 if
  possible; if Phase 1 trips on it, install in Phase 1 instead.

---

## Phase 2 — Dual build config + manifest split (still Firefox-only output)

**Goal:** Both manifest files exist, `vite.config.ts` builds to
`dist-firefox/` or `dist-chrome/` based on `BROWSER` env. Chrome
build does NOT need to work yet — it just needs to produce a
plausible `dist-chrome/` directory we can inspect. Firefox build
remains byte-for-byte identical in behaviour to Phase 1's output.

- [ ] Rename `public/manifest.json` → `public/manifest.firefox.json`
- [ ] Create `public/manifest.chrome.json` with the deltas listed in
  the Architecture section above
- [ ] Update `vite.config.ts`:
  - Read `BROWSER` env, default to `firefox`
  - Set `build.outDir` to `dist-${browser}`
  - Add a plugin / build step that copies
    `public/manifest.${browser}.json` to `dist-${browser}/manifest.json`
  - Configure `resolve.alias` so `src/lib/platform/sidebar` resolves
    to `sidebar.${browser}.ts`, same for `menus`
- [ ] Update `src/lib/platform/index.ts` to use bare imports
  (`./sidebar`, `./menus`) — Vite's alias handles the rest
- [ ] Add scripts to `package.json`:
  - `build:firefox`: `BROWSER=firefox vite build`
  - `build:chrome`: `BROWSER=chrome vite build`
  - `dev:firefox`: `pnpm build:firefox && web-ext run --source-dir dist-firefox`
  - `dev:chrome`: `pnpm build:chrome && web-ext run -t chromium --source-dir dist-chrome` (or similar — verify web-ext flag)
  - `package:firefox`: `pnpm build:firefox && web-ext build --source-dir dist-firefox ...`
  - `package:chrome`: `pnpm build:chrome && zip -r web-ext-artifacts/brreg-snap-chrome-<version>.zip dist-chrome/*`
  - Keep the existing `build`, `dev`, `package` scripts as aliases
    to the Firefox variants for backwards compatibility (or remove
    them — decide here)
- [ ] Update `.gitignore` to exclude `dist-firefox/` and
  `dist-chrome/` (in addition to existing `dist/`)
- [ ] `pnpm build:firefox` succeeds; compare output manifest to the
  AMO submission manifest — must be identical
- [ ] `pnpm build:chrome` succeeds (Chrome build target may be
  broken at runtime; that's fine, Phase 3 fixes it)
- [ ] Update `BUILD.md` to reference the new build commands (still
  Firefox-focused for AMO reviewers)
- [ ] Update `CLAUDE.md` commands section
- [ ] Commit: `build: introduce dual-browser build config (chrome target stubbed)`

**Risk flags:**

- The AMO reviewer's reproducibility expectation hinges on
  `BUILD.md`. Make sure `pnpm build:firefox` produces the same `.xpi`
  AMO has on file. Compare manifest hash before declaring this phase
  done.
- `web-ext run -t chromium` may or may not be the right flag. Check
  `web-ext` docs in Phase 2 — if it's awkward, use `--target` or
  just document "load unpacked from `dist-chrome/` manually".

---

## Phase 3 — Chrome adapter implementations

**Goal:** Chrome build actually runs as an unpacked extension.
Popup + side panel + lookup work. (Auto-sync was deferred at this
phase; later pulled forward into the MVP — see Phase 6 / D13.)

- [ ] Install `webextension-polyfill` and `@types/webextension-polyfill`
- [ ] Add polyfill import to top-level entry points (`background.ts`,
  `popup.ts`, `details.ts`) — one import, the rest just keeps
  using `browser.*`
- [ ] Replace `@types/firefox-webext-browser` with
  `@types/webextension-polyfill` in `package.json` devDependencies
- [ ] Resolve any TS errors from the type swap (most should be
  identical; differences are in optional / chrome-only APIs)
- [ ] Create `src/lib/platform/sidebar.chrome.ts`:
  - `setPanel(path)` → `browser.sidePanel.setOptions({ path, enabled: true })`
  - `open()` → `browser.sidePanel.open({ tabId })` — needs an active
    tab; gesture rules apply
- [ ] Create `src/lib/platform/menus.chrome.ts`: thin re-export of
  `browser.contextMenus` (the polyfill aliases this; verify)
- [ ] In `background.ts`, ensure the service-worker entry pattern
  is compatible: top-level listener registration (already the case),
  no global state assumed to survive termination
- [ ] Audit `searchRunId` / `loadRunId` race-guards in `background.ts`
  — if they live in module globals, they reset on SW termination.
  Document whether that's acceptable for MVP (probably yes — races
  are rare and reset is harmless)
- [ ] `pnpm build:chrome` succeeds, output `dist-chrome/` looks
  structurally complete
- [ ] Load `dist-chrome/` as unpacked extension in Chrome 114+
- [ ] Verify the install dialog only shows the expected permissions
  (activeTab, storage, host=data.brreg.no). `optional_permissions`
  for `tabs` should NOT trigger an install prompt
- [ ] Commit: `feat: chrome adapter implementations (sidepanel, contextmenus, sw)`

**Risk flags:**

- `chrome.sidePanel.open()` requires user gesture in Chrome. Our
  context-menu click path counts as a gesture, so that should work.
  The popup auto-open path (if any) might not. Verify in Phase 4.
- Service workers can be terminated between events. If you see
  state-loss bugs in Phase 4, that's where to look first.
- The polyfill aliases `chrome.contextMenus` to `browser.menus` on
  Chrome. Verify by reading the polyfill source if behaviour is
  weird — there's been historical inconsistency.

---

## Phase 4 — Chrome smoke test + bug fixes

**Goal:** Walk through every user-facing flow that MVP supports.
Log issues, fix them, re-test. Everything below typechecks, lints,
unit-tests (170), builds, and packages clean — Phase 4 is purely the
live-browser behaviours that can't be unit-tested.

**Check these three Chrome-only risk points FIRST** (they're the only
things genuinely unverified — the rest is shared, unit-tested logic):

1. **Context-menu → side panel opens.** Right-click a page →
   "Vis i brreg-snap sidebar". The panel must actually open.
   `chrome.sidePanel.open()` needs a live user gesture and was added in
   Chrome 116 (manifest sets `minimum_chrome_version: 116`). If it
   throws a "user gesture" error, the synchronous order in
   `background.ts` onClicked is wrong — but it's written to call
   `open()` with no `await` before it, so this *should* pass.
2. **Popup "Vis i sidepanel" link opens the panel.** Click the action
   icon → popup → the details link. It calls `sidePanel.open({windowId})`
   then `window.close()`. Watch for: panel doesn't open, or opens then
   the popup-close cancels it. (Secondary path; context menu is primary.)
3. **Side panel renders + repaints.** When opened it should show the
   right company (it reads `?orgnr=` from the path *and* re-resolves the
   active tab on load). Switching the popup to a new company while the
   panel is open should repaint it (the `sync` `sendMessage` broadcast).

Test matrix (run each, mark pass/fail/notes):

- [ ] Fresh install: install dialog shows only expected permissions
- [ ] Open popup: shows brreg-snap popup, lookup field works
- [ ] Manual search: type org name → result appears → click → side
  panel opens with details
- [ ] Lookup by active tab: navigate to a Norwegian company site,
  click action icon, popup or side panel shows correct orgnr
- [ ] Side panel close + reopen: state behaves consistently
- [ ] Auto-sync toggle is **present** in the side-panel toolbar on
  Chrome (auto-sync brought forward, D13), default off. The refresh
  button stays.
- [ ] Auto-sync grant: flip the toggle → Chrome prompts for `tabs`
  ("Read your browsing history") → grant → toggle stays on. Deny →
  toggle reverts to off. (This is the gesture path D11 worried about
  — the key thing to confirm live.)
- [ ] Tab switch with auto-sync ON: side panel auto-updates to the
  new tab's company (or clears on an unresolvable page).
- [ ] Tab switch with auto-sync OFF: side panel does NOT auto-update
  (re-run the gesture or flip auto-sync on).
- [ ] Auto-sync toggle off → `permissions.remove(['tabs'])`; tab
  switches stop following. Revoke from `chrome://extensions` →
  toggle reflects off on next panel open.
- [ ] Storage: recents list persists across popup close/reopen
- [ ] CSP: no console errors related to CSP
- [ ] Brreg API errors (e.g. orgnr that returns 500): graceful
  fallback message
- [ ] Picker flow (when host has multiple candidate orgnrs)
- [ ] Override flow (when user manually picks a different orgnr)
- [ ] Mod11 validation on manual orgnr input

Per failure: file a TODO in this doc under "Phase 4 bugs", fix,
re-test, commit.

**Phase 4 bugs:**

_(empty — populate as found)_

- [ ] All test matrix items pass
- [ ] Commit: any bug fixes from this phase

---

## Phase 5 — Chrome Web Store submission

**Goal:** Chrome MVP published to CWS.

- [ ] Confirm Firefox 1.0.0 has been live and stable on AMO for at
  least 7 days (D5)
- [ ] Register Chrome Web Store developer account ($5 one-time
  registration fee)
- [ ] Prepare listing assets:
  - Icon set (reuse `public/icons/icon-128.png`)
  - Screenshots: at least 1, ideally 3-5, 1280x800 or 640x400
    (reuse `docs/screenshots/` where it makes sense; Chrome may
    require specific dimensions — check current CWS requirements)
  - Description (English required; Norwegian optional)
  - Privacy policy (reuse content from `PRIVACY.md`)
- [ ] Resolve Q1 (version number) and Q2 (changelog format) above
- [ ] `pnpm package:chrome` produces a clean zip
- [ ] Upload to CWS, fill out listing, submit for review
- [ ] Document submission state in this file: date, version, any
  reviewer notes
- [ ] Commit: `docs: chrome web store submission` (in `docs/cws-submission.md` or similar — likely mirror `BUILD.md` and AMO docs pattern)

---

## Phase 6 — Auto-sync for Chrome (pulled forward into the MVP, D13)

**Goal:** Auto-sync at parity with Firefox. Done on
`feat/chrome-auto-sync` off `chrome-port-mvp`; pending Seb's live
permission-prompt smoke.

Code + static verification (done):

- [x] `optional_permissions:["tabs"]` added to `manifest.chrome.json`
- [x] Drop the two `isFirefox` short-circuits (`refreshAutoSyncEnabled`
  in background.ts, `setupAutoSyncToggle` in details.ts) so Chrome
  reconciles from permission + toggle like Firefox
- [x] Fix `tabs.onUpdated` filter throw on Chrome — register filter-only
  on Firefox (`onUpdatedDispatch` shared handler)
- [x] Unit coverage: Chrome-mode tests in `background-module.test.ts`
  (filter-free registration, tail listeners survive, dispatch proceeds)
- [x] Live: toggle now visible in Chrome side panel; background SW
  loads with zero console errors (no more filter throw) — verified via
  Playwright on real Chromium

Pending (Seb's live smoke — needs the interactive permission prompt):

- [ ] Flip toggle → Chrome `tabs` prompt appears → grant → toggle
  sticks; deny → reverts. (The gesture-from-side-panel path D11
  flagged as unverified — confirm it actually prompts.)
- [ ] Tab switch with auto-sync on → panel follows the active tab
- [ ] Toggle off → `permissions.remove`; external revoke reflected
- [ ] Verify behaviour survives a service-worker restart (idle the SW,
  then switch tabs)
- [ ] Update CWS listing: `tabs` opt-in justification; drop the
  "tab-switch auto-update lands in a follow-up" caveat
- [ ] Decide release version (parity now — no longer a missing feature)

---

## Cross-phase risks to keep in mind

- **AMO follow-up requests:** if Mozilla asks for changes during
  this work, pause Phase N, fix on `main`, tag the new submission,
  then rebase `chrome-port` onto the new `main`.
- **Chrome Web Store policy creep:** CWS occasionally tightens
  policies (e.g. MV3 deadlines, host permissions justification).
  Re-check current CWS publication requirements at the start of
  Phase 5, not now.
- **`webextension-polyfill` maintenance:** Mozilla has signaled it
  may retire the polyfill once Chrome natively supports the
  promise-based `browser.*` namespace (no firm date). If that
  happens during this work, evaluate switching to direct
  `chrome.*` / `browser.*` namespace (D3 revisit).

## Glossary for session resumption

- **AMO:** addons.mozilla.org — Firefox extension store and review
  process.
- **CWS:** Chrome Web Store.
- **MV3:** Manifest V3, current extension manifest standard.
- **Side panel:** Chrome's equivalent of Firefox's sidebar; APIs
  differ.
- **Polyfill:** `webextension-polyfill` package that maps `browser.*`
  to `chrome.*` on Chromium.
