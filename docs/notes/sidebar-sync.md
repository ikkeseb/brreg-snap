# Sidebar sync

Source: `src/details/details.ts`, `src/lib/panel-follow.ts`,
`src/lib/panel-protocol.ts`, `src/lib/tab-sync.ts`,
`src/popup/popup.ts`, `src/background/background.ts`.

<!-- SECTION: panel-hosted-auto-sync -->
## Auto-sync runs in the panel, never in the background

With «Auto-oppdater» on (stored toggle + runtime `tabs` grant), the
panel page itself registers `tabs.onActivated` / `tabs.onUpdated`
(`createTabWatcher` in `tab-sync.ts`), filtered to its own window
(`windows.getCurrent()` from a sidebar / side-panel document returns
the window hosting it), and resolves with the same picker-aware
`resolveTabContext` it uses at startup. The panel document exists only
while the sidebar / side panel is open, so closing it stops every tab
lookup and every brreg request by construction — the promise
PRIVACY.md makes. The background registers no tab listeners at all
(pinned by `tests/background-module.test.ts`), so the Chrome service
worker isn't woken on every tab switch either.

The toggle, an external revoke (`permissions.onRemoved`) and a flip in
another window's panel (`storage.onChanged`) attach / detach the
listeners live. `onUpdated` follows only URL changes of the active tab
in this window: Firefox gets a `{properties:['url'], windowId}` filter;
Chrome throws on any filter, so `followsUpdate` is the gate there.

<!-- SECTION: sendmessage-not-setpanel -->
## Messages repaint an open panel; each names its window

`sidebarAction.setPanel({panel: url})` *should* repaint an open
sidebar per MDN, but in Firefox 115+ it doesn't reliably — the panel
URL is updated for the next open, the visible iframe stays put. So the
popup (after resolving the tab, and on «Ingen av disse») and the
context menu send a `runtime.sendMessage` the open panel applies in
place. The shape lives in `panel-protocol.ts`: `{type:'sync', windowId,
orgnr, host, method}` or `{type:'no-match', windowId, host}`.

`runtime.sendMessage` reaches every extension page, and each browser
window has its own panel document, so every message carries the
sender's `windowId` and the panel drops the rest (`isForWindow`; a
panel that couldn't learn its window takes none). `method` travels
with a sync so «Feil bedrift?» shows in the panel exactly when it
shows on the sender. A missing listener (panel closed) rejects
`sendMessage` — expected, swallowed in `notifyPanel`.

The popup only messages an open panel; it no longer calls `setPanel`
for that (it only left a global panel URL behind for a later open).

<!-- SECTION: active-tab-on-load -->
## On open the active tab wins; the panel URL is a stamped hint

`sidebar.setPanel` sets the GLOBAL panel URL on both engines, and it
outlives the open it was set for. Only gestures that also open the
panel set it (popup link, context menu), via `panelPath(target, now)`:
`details.html?orgnr=…&at=<ms>` or `?nomatch=<host>&at=<ms>`.

On load (`chooseStart` in `panel-follow.ts`, tested there):

1. A fresh hint (`at` within `PANEL_HINT_FRESH_MS`) wins unless the
   active tab already resolves to it — then the tab's resolution is
   used, since it carries the host label and method. This keeps e.g. a
   manual pick in the popup when the user opens it in the panel.
2. Otherwise a readable active tab wins. A leftover `?nomatch=X` or
   `?orgnr=A` never overrides the page the user is on now.
3. Only when the tab can't be read (no `activeTab` grant, no `tabs`
   opt-in) does a leftover hint apply. A hint orgnr is shown without a
   host label: it didn't come from this tab.

The tab is readable when `tabs.query` returns a URL — Firefox grants
`activeTab` on the user action that toggles the sidebar (sidebar icon,
toolbar action, shortcut) and on the context-menu click. The panel's
own page (opened as a normal tab) counts as unreadable, so it never
sends its extension id to brreg as a hostname.

<!-- SECTION: no-match-broadcast -->
## `no-match` makes the panel resolve the host itself

The context menu resolves only synchronously (gesture stack, see
permissions-model.md § gesture-stack). On a miss it sends
`{type:'no-match', windowId, host}` and the panel runs the picker-aware
host search — the one resolver, which can show the picker and keeps
the resolution method. The popup sends `no-match` after «Ingen av
disse» so an open panel clears the stale company.

<!-- SECTION: load-race-guards -->
## One load token; every flow that paints checks it

`details.ts` has one `createLoadSequence()` (`panel-follow.ts`). The
painters (`loadOrgnr`, `showPicker`, `showEmptyState`) claim a token
themselves; flows that await before painting — startup, a tab event,
a no-match probe, the «Feil bedrift?» reject flow — claim one when
they start and return after any await once it's stale. Arrival order,
not network order, decides what ends up on screen. There are no manual
bumps to forget. A picker choice is applied only while that picker is
still on screen. `renderParent`'s late name upgrade checks that its
load's result is still the one shown (`shownLoad`), not the token, so
a sync that keeps the same company doesn't cut it off.

The popup's `loadAndRender` keeps its own `loadRunId` (manual result
then a recent entry in quick succession must paint the second). Stale
runs return silently after every await — including the error path.

<!-- SECTION: same-view-keep -->
## A sync or tab event for what's on screen keeps it

`sameView` compares the incoming view with the settled one (company by
orgnr, picker / empty state by host). A match keeps the rendered
content — no skeleton, scroll, focus, open tab and «Oppdatert» stamp
stay put, a half-typed manual search survives — and only refreshes the
footer host, method and history entry. Auto-sync fires on every URL
change of the active tab, most of which stay on the same company.

<!-- SECTION: background-repaint-etiquette -->
## Background repaints must not steal focus or lie in the footer

With auto-sync on, the panel repaints on tab switches while the user
is working in the page. Two rules in `details.ts`:

- `showEmptyState` focuses the manual-search input only when
  `document.hasFocus()` — an unconditional `focus()` yanked the
  keyboard out of the page on every switch to an unresolvable site.
- `setState` hides the "Synket fra `<host>` · Oppdatert …" footer and
  clears its 30s repaint interval for every non-result state; it
  described an entity no longer on screen. `markUpdated()` re-arms
  both on the next successful load.

<!-- SECTION: shared-ui-modules -->
## Popup and sidebar share their resolution UX via `src/lib/ui/`

The picker (incl. digit shortcuts + "Ingen av disse" +
"Feil bedrift?" reject flow), the debounced manual search (incl.
inline error + "Prøv igjen" retry — manual-search failures never flip
the panel to the full error state), the active-tab resolution cascade
(`resolveTabContext`, `TabContext`, `ResolutionMethod`) and the
source-host footer label live in `src/lib/ui/{picker,manual-search,
resolve-tab,source-label,hit-row,flags}.ts`. The surfaces keep only
their side effects (URL params, load tokens, panel messages, the
popup's recents list) in callbacks. Fixes to that UX land there, once.
