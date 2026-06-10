# Sidebar sync

Source: `src/details/details.ts`, `src/popup/popup.ts`,
`src/background/background.ts`.

<!-- SECTION: sendmessage-not-setpanel -->
## `runtime.sendMessage`, not `setPanel`, repaints the visible panel

`sidebarAction.setPanel({panel: url})` *should* repaint an open
sidebar per MDN, but in Firefox 115+ it doesn't — the panel URL is
updated for the next open, the visible iframe stays put. Callers
therefore broadcast a `{type:'sync', orgnr, host}`
`runtime.sendMessage` in addition to `setPanel`, and `details.ts`
listens for it, calls `history.replaceState`, and re-runs its loader.

`Promise.allSettled` over the two calls because a missing listener
(sidebar closed) rejects `sendMessage` — that's expected, not a
failure.

<!-- SECTION: active-tab-on-load -->
## Sidebar resolves the active tab on load

`details.ts init()` calls `tabs.query` first and only falls back to
the `?orgnr=` URL param if no orgnr could be resolved from the active
tab. The sidebar gets an `activeTab` grant when Firefox toggles it
(clicking the sidebar icon, the toolbar action, or a shortcut), so
URL/title are readable in that window. Without grant the call
silently returns empty fields and we fall through to the URL param —
no permission relaxation involved.

`?nomatch=<host>` is the deliberate-trigger counterpart: when the
context menu lands on a page with no resolvable orgnr, the sidebar
opens with `?nomatch=` and skips the active-tab probe (the caller
already told us there's nothing to find).

<!-- SECTION: no-match-broadcast -->
## `no-match` clears stale state

When a deliberate trigger (menu click, tab activate/update with
auto-sync on) lands on a page where we can't resolve an orgnr,
background.ts broadcasts `{type:'no-match', host}`. The sidebar
listener bumps `loadRunId` (so an in-flight `loadOrgnr` from the
previous page can't land late) and shows the empty state. Without
this, the sidebar would keep showing the previous company after a
tab switch to an unrelated site.

<!-- SECTION: broadcast-ordering -->
## Background broadcasts are sequenced — stale resolutions drop

`deriveSyncAsync` in the tab listeners can hit the network (hostname
pipeline), so rapid tab switches A→B can resolve out of order: slow-A
lands after fast-B and the sidebar shows the wrong company.
`background.ts` keeps a module-level `tabEventSeq`; `onActivated` /
`onUpdated` claim a slot *synchronously* at event entry (shared
counter — both feed the same sidebar) and re-check after their awaits.
A superseded event drops its broadcast. `onUpdated` only claims a slot
after its `changeInfo.url` / `tab.active` guards, so title-only churn
and background-tab navigations can't invalidate an in-flight
resolution. Covered by ordering tests in
`tests/background-module.test.ts`.

<!-- SECTION: load-race-guards -->
## Both surfaces guard their loaders with a monotonic run id

The sidebar's `loadOrgnr` has always used `loadRunId`; the popup's
`loadAndRender` now uses the same pattern (clicking a manual result
then a recent entry in quick succession must paint the second one,
not whichever fetch chain resolves last). Stale runs return silently
after every await — including the error path, so a stale failure
can't flip the panel to the error state either.

<!-- SECTION: background-repaint-etiquette -->
## Background repaints must not steal focus or lie in the footer

With auto-sync on, the sidebar repaints on tab switches while the
user is working in the page. Two rules in `details.ts`:

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
their side effects (URL params, `loadRunId` bumps, sidebar broadcasts,
the popup's recents list) in callbacks. Fixes to that UX land there,
once.
