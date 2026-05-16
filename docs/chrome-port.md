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

- **Current phase:** Phase 0 (prep) — done. Phase 1 not yet started.
- **Branch:** `chrome-port` off `d98dc69` (== `v1.0.0` == AMO
  submission snapshot).
- **AMO review:** pending (as of 2026-05-16). Do NOT merge this
  branch to `main` until AMO is green AND we have at least one
  stable week of Firefox 1.0.0 in the field.
- **Next action:** Start Phase 1 — extract `src/lib/platform/`
  adapter module, with Firefox-only implementations. Output `.xpi`
  must remain byte-equivalent in behaviour to the AMO submission.

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

## Open questions

| # | Question | Block phase | Default if unanswered |
|---|----------|-------------|-----------------------|
| Q1 | Chrome MVP version number — `1.0.0` (matches Firefox, but lacks auto-sync) or `0.9.0-chrome` / `1.0.0-mvp` (signals incomplete parity)? | Phase 5 | `1.0.0` with a clear "Chrome-specific limitations" section in the listing description |
| Q2 | Do we want a single combined CHANGELOG, or separate per-browser sections? | Phase 5 | Single CHANGELOG with `[firefox]` / `[chrome]` prefixes on browser-specific entries |
| Q3 | Side panel: Chrome allows the side panel to be tied to a specific tab vs. global. Which UX matches Firefox sidebar's behaviour best? | Phase 3 | Global side panel (one panel state across tabs, matches Firefox sidebar) — verify in Phase 4 |

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
Popup + side panel + lookup work. Auto-sync deliberately not
implemented yet.

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
Log issues, fix them, re-test.

Test matrix (run each, mark pass/fail/notes):

- [ ] Fresh install: install dialog shows only expected permissions
- [ ] Open popup: shows brreg-snap popup, lookup field works
- [ ] Manual search: type org name → result appears → click → side
  panel opens with details
- [ ] Lookup by active tab: navigate to a Norwegian company site,
  click action icon, popup or side panel shows correct orgnr
- [ ] Side panel close + reopen: state behaves consistently
- [ ] Tab switch (without `tabs` permission): side panel does NOT
  auto-update (this is correct for MVP — auto-sync deferred)
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

## Phase 6 (post-launch) — Auto-sync for Chrome

**Goal:** Bring auto-sync feature to parity with Firefox. Released
as a follow-up Chrome update once user feedback on the MVP is in.

- [ ] Audit `src/lib/auto-sync-*.ts` for Chrome compatibility
- [ ] Verify `chrome.permissions.request({ permissions: ['tabs'] })`
  works when triggered from a side panel UI gesture (Chrome's
  gesture rules are stricter than Firefox's — this may need a brief
  popup-mediated grant flow)
- [ ] Verify tab event listeners (`tabs.onActivated`,
  `tabs.onUpdated`) survive service worker restarts. SW will be
  woken up by the event, but module-level state will be fresh.
- [ ] Side panel auto-update on tab switch: Chrome's side panel has
  its own visibility / global-vs-tab-specific semantics that differ
  from Firefox sidebar. Test thoroughly.
- [ ] Update Chrome listing to reflect parity
- [ ] Release Chrome 1.1.0 (or whatever matches Firefox's then-current
  version)

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
