# Engine differences (Firefox + Chrome)

Source: `src/lib/platform/`, `public/manifest.firefox.json`,
`public/manifest.chrome.json`, `src/background/background.ts`,
`src/lib/tab-sync.ts`, `scripts/lint-ext.mjs`.

Both engines run the same JavaScript; only the manifest is chosen at
build time (mechanics: `docs/notes/build.md` § dual-browser-build).
The Chrome-port history and its decision log (D1–D15) live in git:
`git log --follow -- docs/chrome-port.md`.

<!-- SECTION: manifest-split -->
## The manifests are the only build-time switch

`public/manifest.firefox.json` vs `public/manifest.chrome.json`:

| Concern | Firefox | Chrome |
| --- | --- | --- |
| Panel | `sidebar_action` | `side_panel` + the `sidePanel` permission |
| Context-menu permission | `menus` | `contextMenus` |
| Background | `background.scripts` (event page) | `background.service_worker` |
| Panel shortcut | `_execute_sidebar_action` (the browser handles it) | `open-panel` (handled in `background.ts`) |
| Engine floor | `strict_min_version` 115 | `minimum_chrome_version` 116 (`sidePanel.open`) |
| Firefox-only keys | `browser_specific_settings.gecko`, `action.default_area` | none |

Everything else (CSP, host permission, optional `tabs`, action,
icons) is the same. Each target's shape is pinned in
`scripts/manifest-invariants.mjs` (run by `tests/manifest.test.ts`,
`verify:dist` and the package check). Vite's `build.target` follows
the floors (`vite.config.ts`).

<!-- SECTION: no-polyfill-shim -->
## `browser` is aliased to `chrome`; no polyfill

`src/lib/platform/globals.ts` sets `globalThis.browser = chrome` when
only `chrome` exists. Every API the code awaits (storage, tabs,
permissions, runtime, sidePanel) returns a native Promise on Chrome at
the manifest floor; the calls that don't (`menus.create`,
`runtime.getURL`) are never awaited. webextension-polyfill was
rejected (decision D8, 2026-06-01): no third-party JS ships
(`AGENTS.md` § Dependencies).

`globals.js` must be the first import of every entry point:
`engine.ts` and `menus.ts` read `browser` at module load. Types come
from the Firefox WebExtension typings; Chrome-only APIs are typed
locally (`ChromeSidePanel` in `sidebar.ts`). Pinned:
`tests/platform.test.ts`.

<!-- SECTION: runtime-detection -->
## Engine branches are runtime checks, not build aliases

`isFirefox` in `src/lib/platform/engine.ts` is
`'sidebarAction' in browser`. Shipping both branches costs well under
1 KB and needs no `resolve.alias`, tsconfig paths or second typecheck
(decision D9, 2026-06-01). Callers: `sidebar.ts`,
`src/details/main.ts` (`supportsUpdateFilter`), `src/welcome/welcome.ts`
(panel command name), and the browser name in bug reports. A new engine difference goes behind
`isFirefox` or its own feature check, not into the build.

<!-- SECTION: sidebar-adapter -->
## Sidebar vs side panel

The one surface with no shared shape: `sidebar` in
`src/lib/platform/sidebar.ts`.

- Firefox: `sidebarAction.{setPanel,open,isOpen}`. `setPanel` needs
  an absolute URL; the adapter resolves the path with `runtime.getURL`.
- Chrome: `sidePanel.setOptions({path, enabled})` takes the relative
  path. The panel is global, not per tab: no `tabId` on `setOptions`,
  and `open({windowId})` opens it window-wide (fallback `{tabId}`;
  neither id: no-op).
- Chrome has no `isOpen`: the adapter answers `true`, and callers
  treat the follow-up `runtime.sendMessage` as best-effort (the «no
  receiver» rejection is swallowed in `notifyPanel`).
- Every fire-and-forget call swallows its own rejection. Pinned:
  `tests/platform.test.ts` (both branches).

<!-- SECTION: sidepanel-open-needs-live-gesture -->
## `sidePanel.open` needs a live gesture and the ids up front

Both engines spend the user activation on the first await
(`docs/notes/permissions-model.md` § gesture-stack). Chrome's
`sidePanel.open` rejects outright outside a gesture and needs a window
or tab id, so every opener holds them before the click: the popup
keeps `windowId` / `tabId` from resolving its tab
(`src/popup/popup.ts`), and
the background takes them from the menu or command `tab` argument
(`openPanel` in `src/background/background.ts`). Chrome counts the context-menu
click, a click in the popup and the `open-panel` keyboard command as
the gesture. Pinned: `tests/background-module.test.ts` («context menu
click», «keyboard command»).

<!-- SECTION: menus-namespace -->
## Context menus: `browser.menus` on Firefox, `contextMenus` on Chrome

Firefox exposes `browser.menus` under the `menus` permission and no
`browser.contextMenus` alias: it is `undefined`. Chrome has only
`contextMenus`. `menus` in `src/lib/platform/menus.ts` takes whichever
exists. A hardcoded `browser.contextMenus.onClicked` threw at the
background's top level on Firefox and took every later listener with
it (`CHANGELOG.md` 1.1.0). This corrects decision D10 (2026-06-01),
which assumed Firefox aliased `contextMenus`. Pinned:
`tests/background-module.test.ts` («uses browser.menus on Firefox»).

Chrome keeps menu items across service-worker restarts, so a repeat
`registerMenu` fails with a duplicate id; the callback on each
`menus.create` reads `runtime.lastError` to swallow it.

<!-- SECTION: onupdated-filter -->
## `tabs.onUpdated` filters throw on Chrome

Firefox accepts an `onUpdated` filter (`{properties: ['url'],
windowId}`); Chrome throws «This event does not support filters». In the background that once aborted module evaluation
(decision D13, 2026-06-06); today only the panel registers tab
listeners (`docs/notes/sidebar-sync.md` § panel-hosted-auto-sync).
`createTabWatcher` in `src/lib/tab-sync.ts` passes the filter only
when `supportsUpdateFilter` is set (`isFirefox`, from
`src/details/main.ts`). `followsUpdate` is the real gate on both engines;
the filter only spares Firefox the wakeups. Pinned:
`tests/tab-sync.test.ts`.

<!-- SECTION: background-lifecycle -->
## Event page vs service worker

Firefox runs the background as a non-persistent event page, Chrome
as a module service worker. Both unload when idle, so the background
keeps no state and holds only the panel-opening entry points and the
install hook. Module evaluation touches no tabs, permissions or
storage API; the one tabs call is `tabs.create` for the welcome page
in the install hook (both pinned in `tests/background-module.test.ts`).
Tab listeners and auto-sync belong to the panel. Listeners register synchronously
at the top level (`docs/notes/permissions-model.md`
§ event-page-wakeup). The smoke's real Chromium load checks that the
worker evaluates to completion, and runs the flow end to end: a toolbar
click on a site tab, the popup resolving it, «Åpne i sidepanel» opening
the side panel on a trusted click (`tests/e2e/extension.spec.ts`; the
popup and the panel are driven over raw CDP in `tests/e2e/native.ts`).

<!-- SECTION: web-ext-lint-firefox-only -->
## `lint:ext` lints the Firefox build only

`scripts/lint-ext.mjs` runs web-ext lint (addons-linter) on the
Firefox build only: addons-linter rejects the Chrome MV3 manifest
(`background.service_worker`, no gecko id). The Chrome build is
covered by `verify:dist` and the smoke's real Chromium load. Allowed
warnings: `ALLOWED_WARNINGS` in `scripts/lint-ext-judge.mjs`.

<!-- SECTION: owned-elsewhere -->
## Engine differences documented in other notes

- Commands, the badge, `default_area`: `docs/notes/permissions-model.md`
  § commands-and-selection. Install hook: `docs/notes/permissions-model.md`
  § install-tab.
- Firefox's one shared panel URL: `docs/notes/sidebar-sync.md`
  § sendmessage-not-setpanel.
- Loading each build for manual testing: `AGENTS.md` § Commands.
