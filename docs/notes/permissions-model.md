# Permissions model

Source: `manifest.json`, `src/background/background.ts`,
`src/details/details.ts`, `src/lib/auto-sync-*.ts`.

<!-- SECTION: active-tab-limits -->
## Auto-sync on tab switch is blocked by activeTab — by design

`activeTab` grants extension UI access to *one* tab on user gesture
(popup click, sidebar toggle, shortcut). When the sidebar is open
and the user switches tabs in Firefox, no new gesture fires against
the extension, so `tabs.query` returns empty URL/title for the new
tab. `tabs.onActivated` fires without `tabs` permission but its
`Tab` object is stripped of URL/title for the same reason.

The permissionless paths out: (a) require a fresh gesture against
the *toolbar/shortcut* surface (click sidebar icon, ctrl+shift+B), or
(b) accept the limitation. Escalating to `tabs` as a static
install-time permission would relax the security differentiator —
see `CLAUDE.md` § Security constraints. Don't
burn cycles re-investigating `webNavigation`, `tabs.onUpdated`, or
focus events; they all need `tabs` or content scripts.

<!-- SECTION: tabs-runtime-optin -->
## Tab-sync via runtime `tabs` opt-in is the supported path

The sidebar exposes an "Auto-oppdater ved fane-bytte" toggle that
requests `tabs` at runtime. Switching it on first shows an inline
disclosure: the page you are on is looked up every time you switch
tabs or open a new page, as long as a brreg-snap panel is open in any
window; the domain goes to data.brreg.no, nothing to the developer.
Its «Slå på» button is the consent and the gesture that calls
`permissions.request`. The flow lives in `src/lib/auto-sync-toggle.ts`
(tested without a DOM); `details.ts` only wires its events. With it
on, the panel page registers
`tabs.onActivated`/`onUpdated` for its own window and resolves the
new tab itself — see sidebar-sync.md § panel-hosted-auto-sync. Nothing
outside an open panel listens to tabs, so the grant never causes a
lookup while the panel is closed. Settings live in `storage.local`
(survives browser restarts); the response cache stays on
`storage.session` (in-memory).

<!-- SECTION: event-page-wakeup -->
## Background listeners must register synchronously at top level

The background is a non-persistent event page (Firefox) / service
worker (Chrome). For the runtime to wake the script for an event, the
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

Same constraint for `sidebarAction.open` from the context menu.
That's why `background.ts` menu handler does a sync `deriveSync`
before `setPanel + open`, and on a miss leaves the async host search
to the panel (sidebar-sync.md § no-match-broadcast).

<!-- SECTION: iframe-not-a-gesture-surface -->
## A button *inside* the sidebar iframe does NOT grant activeTab

Tested empirically: a sync button rendered inside the sidebar that
called `tabs.query({active:true, currentWindow:true})` got the same
empty `url`/`title` as `tabs.onActivated`. The user-gesture grant is
scoped to the toolbar/sidebar-action surface, not clicks inside the
already-loaded panel. A sync button existed in the sidebar header
for this — it was removed because the hypothesis was wrong. Don't
re-add it.

<!-- SECTION: android-lint-warning -->
## `pnpm lint:ext` will warn `ANDROID_INCOMPATIBLE_API` — expected

The extension is desktop-only by design: `sidebar_action` isn't
implemented on Firefox for Android, and the whole UX is built around
the sidebar. The `permissions.request` warning is noise; don't try
to silence it by dropping the optional `tabs` permission or the
runtime opt-in flow. If we ever target Android, the entire surface
needs a re-think, not a manifest tweak.

<!-- SECTION: data-collection-declaration -->
## Firefox data collection is `browsingActivity`, required

Every lookup sends the site's hostname, and name labels derived from
it, to data.brreg.no. Mozilla counts any data "handled outside of the
add-on or the local browser" as transmission, a public government API
included, and its taxonomy puts domains under `browsingActivity`. So
`browser_specific_settings.gecko.data_collection_permissions` is
exactly `{"required": ["browsingActivity"]}`, pinned by
`tests/manifest.test.ts` and the CI dist check. PRIVACY.md § Store
declarations and the CWS privacy form («Web history») say the same
thing; change all three together.

- Required, not optional. Optional types are off until the user opts
  in, so click lookups would have to stop until then. `none` plus an
  optional type would make the install prompt say the extension
  "doesn't require data collection" while every click sends a domain.
- Adding a required type re-prompts existing users on Firefox 140+
  («New required data collection»). The update waits until they
  accept; the old version keeps running. Treat any change to the list
  like adding a permission.
- Firefox 115–139 ignore the key and show the user nothing. AMO's
  linter warns about that (`KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION`,
  since `strict_min_version` is below 140). Expected.
- Never set `has_previous_consent`: it would claim a consent we never
  asked for, and AMO's linter rejects `true` anyway.
