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
