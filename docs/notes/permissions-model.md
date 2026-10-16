# Permissions model

Source: `public/manifest.firefox.json`, `public/manifest.chrome.json`,
`src/background/background.ts`,
`src/details/{auto-sync-ui,auto-sync-switch}.ts`, `src/lib/auto-sync-*.ts`,
`src/lib/platform/permissions.ts`, `src/welcome/welcome.ts`.

<!-- SECTION: active-tab-limits -->
## Auto-sync on tab switch is blocked by activeTab — by design

`activeTab` grants extension UI access to *one* tab on user gesture
(popup click, sidebar toggle, shortcut). When the sidebar / side
panel is open and the user switches tabs, no new gesture fires against
the extension, so `tabs.query` returns empty URL/title for the new
tab. `tabs.onActivated` fires without `tabs` permission but its
`Tab` object is stripped of URL/title for the same reason.

The permissionless paths out: (a) require a fresh gesture against
the *toolbar/shortcut* surface (click the sidebar icon, or the
sidebar shortcut — see § commands-and-selection), or
(b) accept the limitation. Escalating to `tabs` as a static
install-time permission would relax the security differentiator —
see `AGENTS.md` § Security constraints. `webNavigation`,
`tabs.onUpdated` and focus events are no way around it: none of them
gives URL or title access with today's permissions (tab and focus
events fire, but without `tabs` they carry no URL or title), and
`webNavigation` would be a new install-time permission those same
security rules do not allow.

<!-- SECTION: tabs-runtime-optin -->
## Tab-sync via runtime `tabs` opt-in is the supported path

The sidebar exposes an "Auto-oppdater" toggle that
requests `tabs` at runtime. Switching it on first shows an inline
disclosure: the page you are on is looked up every time you switch
tabs or open a new page, as long as a brreg-snap panel is open in any
window; the domain goes to data.brreg.no, nothing to the developer.
Its «Slå på» button is the consent and the gesture that calls
`permissions.request`. The flow lives in `src/lib/auto-sync-toggle.ts`
(tested without a DOM); `details/auto-sync-switch.ts` only binds the DOM. With it
on, the panel page registers
`tabs.onActivated`/`onUpdated` for its own window and resolves the
new tab itself — see sidebar-sync.md § panel-hosted-auto-sync. Nothing
outside an open panel listens to tabs, so the grant never causes a
lookup while the panel is closed. Settings live in `storage.local`
(survives browser restarts); the response cache stays on
`storage.session` (in-memory).

<!-- SECTION: withheld-host-permission -->
## A withheld data.brreg.no grant: say so, offer «Gi tilgang»

The user can withhold the one host permission after install: Firefox
lists it as optional in about:addons → Permissions (MDN
`host_permissions`: «most browsers treat `host_permissions` as
optional»), Chrome under the extension's site access. Firefox only
grants it at install from 127 (bug 1889402, «Grant origin permissions
during install for mv3»), so an install on 115–126 starts without it.
Without the grant only the regnskap figures fail, since that endpoint
sends no CORS header (`docs/notes/brreg-api.md` § cors).

- `loadCompany` asks `permissions.contains(BRREG_ORIGINS)` only after
  the regnskap fetch failed, and sets `noHostAccess` when the grant is
  missing. A browser that can't answer counts as holding it, so a
  plain failure is never blamed on a permission.
- The panel's Økonomi tab then says «brreg-snap har ikke tilgang til
  data.brreg.no, så regnskapstallene kan ikke hentes.» with a «Gi
  tilgang» button instead of «Prøv igjen senere». The click reaches
  `permissions.request(BRREG_ORIGINS)` with no await before it
  (§ gesture-stack; `requestBrregAccess` in
  `src/lib/platform/permissions.ts`, `intents.grantAccess` in
  `src/details/controller.ts`). A refusal leaves the state as it was.
- A grant heals the panel instead of reloading it. The controller
  counts grants (the request answering yes, and `permissions.onAdded`
  with the origin, so a grant given in about:addons or Chrome's site
  access counts too) and records the count each load began under. A
  result on screen that lacks the figures and was fetched before the
  latest grant is fetched again and repainted in place: no load token,
  no skeleton, and only while that same result is still on screen. A
  tab switch, sync or pick meanwhile replaces it as usual and is never
  made stale by the heal. A heal never closes the user's search either:
  while the search view is open it waits, and lands when the search
  closes back to that result (`ResultPaint.heal`). A load in flight at
  the grant heals once it lands, and a company loaded while the prompt
  was open heals on the grant. A load that began before the latest grant
  and came back without figures counts as lacking access even without
  `noHostAccess`: the loader asks `contains` only after every part
  settled, so it may already see the new grant. A refetch that still
  lacks access stops there. A failed fetch
  is never cached, so the figures come in while the rest comes from the
  cache; after «Gi tilgang» the result lands on the open tab.
- The popup says it as one line under the answer: «Mangler tilgang til
  regnskapstallene.» with a text button «Gi tilgang», instead of naming
  regnskap in «Noe kunne ikke hentes: …» (other failed parts stay
  named there). The panel's longer line doesn't fit the 600 px budget
  (`docs/notes/ui.md` § popup-budget). A verdict has no room for either
  line, as before.
- The prompt closes the popup: a popup closes when it loses focus, and
  the prompt takes it. Firefox: bug 1766834 («as soon as the
  browserAction popup loses the focus, it gets auto-closed»), which
  also reports the prompt can get hidden on Linux. Chromium: the smoke
  sees the popup close on the click. The grant still applies, and the
  next popup shows the figures. A popup that does survive reloads.
- The ledger's regnskap row keeps the Enhet's filing year without
  money, on both surfaces.
- No manifest change: both engines let `permissions.request` ask for
  an origin in `host_permissions` the user withheld (MDN
  `host_permissions`: «it can request them using
  permissions.request()»; Chrome's permissions API: «required
  permissions that were withheld by the user»).
- The smoke withholds site access in real Chromium through
  `chrome.developerPrivate` on chrome://extensions, since Chrome refuses
  `permissions.remove` for a required origin (`tests/e2e/extension.spec.ts`).
  In the popup the browser's own CORS check blocks the figures
  (`tests/e2e/native.ts` answers with live CORS headers); the panel,
  a Playwright page whose routes get a CORS header from Playwright,
  aborts the figures instead. Headless can't answer the prompt; the
  heal is pinned in `tests/details-controller.test.ts` and shown in
  the preview harness with `&hostaccess=withheld`.

<!-- SECTION: event-page-wakeup -->
## Background listeners must register synchronously at top level

The background is a non-persistent event page (Firefox) / service
worker (Chrome); see `docs/notes/platform.md` § background-lifecycle.
For the runtime to wake the script for an event, the
corresponding `addListener` call has to run synchronously during
module evaluation — not after an awaited permission/storage check.
Async registration leaves the runtime unaware that this script should
be dispatched the event, so events are silently dropped while the
script is idle. Today that covers `runtime.onInstalled`/`onStartup`
and the context-menu `onClicked`.

Symptom of getting this wrong: the feature works only while
about:debugging Inspector is open (the inspector keeps the script
alive), then breaks after idle. That is how the old background-hosted
auto-sync broke once; the tab listeners have since moved into the
panel, whose document is alive exactly while it's visible, so they
have no wake-up problem to begin with.

<!-- SECTION: gesture-stack -->
## Never await between a user gesture and `permissions.request`

Firefox consumes the user-activation token on the first await in a
click handler. If `permissions.request` lands *after* that first
await, Firefox rejects it without a prompt («permissions.request may
only be called from a user input handler»), and the panel can only
report «Tilgang til fanene ble ikke gitt». `tests/auto-sync-toggle.test.ts`
pins that «Slå på» reaches the request synchronously.

Same constraint for opening the panel from the context menu
(`sidebarAction.open`; Chrome's `sidePanel.open` is stricter, see
`docs/notes/platform.md` § sidepanel-open-needs-live-gesture).
That's why `background.ts` menu handler does a sync `deriveSync`
before `setPanel + open`, and on a miss leaves the async host search
to the panel (sidebar-sync.md § no-match-broadcast).

<!-- SECTION: commands-and-selection -->
## Selection lookup and keyboard shortcuts add no permission

- **«Slå opp «%s» i brreg-snap»** is a second context-menu item
  (`contexts: ['selection']`) under the same `menus` / `contextMenus`
  permission as the page item. The browser hands the handler
  `info.selectionText`; no content script, no page access. The handler
  follows § gesture-stack: a sync `extractOrgnrFromText`, then
  `setPanel` + `open`. A single valid orgnr opens as a manual pick
  (`?orgnr=…&m=manual`); any other text becomes a `?q=` hint the
  panel's search runs (panel-protocol.ts). A `?q=` hint applies only
  while fresh, so a leftover never re-sends the text. PRIVACY.md lists
  the selected text as sent data.
- **`commands`** is a manifest key, not a permission; the install
  prompt doesn't change (pinned exactly in `tests/manifest.test.ts`).
  Both engines: `_execute_action` (popup), Alt+Shift+O, on macOS
  MacCtrl+Shift+O. Firefox: `_execute_sidebar_action`, Alt+Shift+S /
  MacCtrl+Shift+S, handled by the browser. Chrome has no built-in
  side-panel command, but its sidePanel docs list «a keyboard
  shortcut» among the user actions `sidePanel.open()` accepts, so an
  `open-panel` command (same keys) goes through the page item's
  handler in `background.ts`. A command also grants activeTab on
  Chrome (activeTab docs: «Executing a keyboard shortcut from the
  commands API»), so the tab's URL is readable there.
- Why not Alt+Shift+B: Chromium binds it to «focus bookmarks bar» on
  Windows, Linux and ChromeOS
  (`chrome/browser/ui/accelerator_table.cc`, `IDC_FOCUS_BOOKMARKS`).
  Checked 2026-09-24: that table has no Alt+Shift+O/S; Firefox's
  `browser-sets.inc.xhtml` keyset has no Alt+Shift combination at all.
  macOS gets MacCtrl because Option+Shift+letter types characters
  (Chromium avoids it for the same reason). Not verified: Firefox's
  Alt+Shift content accesskeys on a page that defines `o`/`s`, and
  ChromeOS system shortcuts (Alt+Shift+S opens quick settings there).
  Users can rebind in `about:addons` / `chrome://extensions/shortcuts`.
- **`action.default_area: "navbar"`** (Firefox only) puts the button
  on the toolbar for new installs instead of the extensions menu. It
  changes nothing for existing installs (MDN manifest.json/action).
- **The toolbar badge** (`platform/badge.ts`, `action.setBadgeText` /
  `setBadgeBackgroundColor` per tab) needs no permission on either
  engine: MDN setBadgeText «No specific permission is required»;
  Chrome's action API only needs the `action` key. A per-tab value is
  dropped by the browser when the tab loads another document (Chromium
  `ExtensionActionRunner::DidFinishNavigation`; MDN: «Resets when the
  user navigates»), so a badge can't follow the user to the next site.
  It is not dropped on a same-document (SPA) navigation.

<!-- SECTION: install-tab -->
## The welcome tab on install needs no permission

`runtime.onInstalled` with `reason: 'install'` opens
`welcome/welcome.html` through `tabs.create` (`background.ts`,
`onInstalled`). `tabs.create` is one of the tabs-API calls that need
no permission at all (MDN tabs API: only `url`, `title`, `favIconUrl`
reads on other tabs are gated, and the page opened is the extension's
own). An update (`reason: 'update'`) and a Firefox temporary load
(`details.temporary`, about:debugging / `web-ext run`) open nothing;
Chrome's unpacked load counts as an install. The page itself reads
only `commands.getAll()` — the user's current shortcut bindings, no
permission — and makes no request: its two examples are fictional
view data painted with the shared components. `welcome/` is an
allowed package root in `scripts/lib/manifest-invariants.mjs`; no manifest
key points at it.

<!-- SECTION: iframe-not-a-gesture-surface -->
## A button *inside* the sidebar iframe does NOT grant activeTab

A click inside the sidebar is not a gesture on the extension's
surface: `tabs.query({active:true, currentWindow:true})` called from a
button in the panel returns the same empty `url`/`title` as
`tabs.onActivated`. The user-gesture grant is scoped to the
toolbar/sidebar-action surface, not clicks inside the already-loaded
panel, so a sync button inside the panel can't read the active tab.

<!-- SECTION: desktop-only -->
## Desktop only: no Firefox for Android target

The extension is desktop-only by design: `sidebar_action` isn't
implemented on Firefox for Android, and the whole UX is built around
the sidebar. If an Android lint warning ever shows up, don't silence
it by dropping the optional `tabs` permission or the runtime opt-in
flow. If we ever target Android, the entire surface needs a re-think,
not a manifest tweak.

<!-- SECTION: data-collection-declaration -->
## Firefox data collection is `browsingActivity` + `websiteContent`, required

Every lookup sends the site's registrable domain, and a name label
derived from it, to data.brreg.no. Mozilla counts any data "handled outside of the
add-on or the local browser" as transmission, a public government API
included, and its taxonomy puts domains under `browsingActivity`. The
selection lookup (the «Slå opp «…» i brreg-snap» menu item)
also sends text the user selected on the page (at most 100 characters),
and Mozilla defines `websiteContent` as "anything visible on a website
— such as text, images, videos, and links", with no exemption for a
lookup the user starts. So
`browser_specific_settings.gecko.data_collection_permissions` is
exactly `{"required": ["browsingActivity", "websiteContent"]}` (the
maintainer's decision for 1.6.1), pinned by `tests/manifest.test.ts`
and the CI dist check. PRIVACY.md § Store declarations and the CWS
privacy form («Web history» + «Website content») say the same thing;
change all three together.

- Required, not optional. Optional types are off until the user opts
  in, so click lookups (or selection lookups, for `websiteContent`)
  would have to stop until then; there is no in-extension opt-in. `none` plus an
  optional type would make the install prompt say the extension
  "doesn't require data collection" while every click sends a domain.
- Adding a required type re-prompts existing users on Firefox 140+
  («New required data collection»). The update waits until they
  accept; the old version keeps running. Treat any change to the list
  like adding a permission. Adding `websiteContent` in 1.6.1 costs
  existing Firefox users that one prompt, an accepted cost.
- Firefox 115–139 ignore the key and show the user nothing. AMO's
  linter warns about that (`KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION`,
  since `strict_min_version` is below 140). Expected.
- Never set `has_previous_consent`: it would claim a consent we never
  asked for, and AMO's linter rejects `true` anyway.
