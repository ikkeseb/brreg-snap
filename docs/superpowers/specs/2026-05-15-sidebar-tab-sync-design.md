# Sidebar tab-sync via runtime `tabs` permission

**Date:** 2026-05-15
**Status:** Approved (verbal, in chat). Ready for plan.
**Supersedes:** `backlog.md` § Sidebar auto-sync on tab switch (resolution: context menu was insufficient UX; escalate to runtime opt-in)

## Context

The sidebar currently goes stale on tab switch: opened on tab A, the
user switches to tab B, sidebar still shows A. Shipped mitigations
(↻ button that re-fetches the *same* orgnr, popup-driven sync,
context menu from the previous milestone) do not cover the common
case of "I'm browsing, I want the sidebar to follow me".

`backlog.md` § Alternatives previously rejected a `tabs` permission
because the install dialog would advertise "Access your tabs" and
break the README zero-tab-snooping narrative. The context menu was
shipped as the permissionless compromise.

User feedback (this session): context menu is acceptable as a
fallback but not the target UX. Permissionless paths are now
considered insufficient in practice — the backlog's stated trigger
for revisiting `tabs`.

## Goal

Keep the sidebar synchronized with the active tab through:

1. A toggle the user opts into ("Auto-oppdater ved fane-bytte").
2. A refresh button that reads the active tab when permission allows,
   and degrades to the current "re-fetch same orgnr" behavior when it
   doesn't.
3. The existing context-menu item (unchanged) as a third path.

Install stays silent. The `tabs` permission is requested at runtime,
on user gesture, and persisted only while the toggle is on.

## Design overview

`tabs` moves from "never" to `optional_permissions`. This keeps it
out of the install dialog. The sidebar exposes a toggle; flipping it
on triggers `permissions.request({permissions: ['tabs']})`. With
permission granted, the background script registers listeners on
`tabs.onActivated` and `tabs.onUpdated`, reads `tab.url` / `tab.title`,
resolves the orgnr via the existing `deriveSync` helper, and
broadcasts `{type:'sync', orgnr, host}` to the sidebar — the same
shape `details.ts` already listens for.

Toggle state is the source of truth, stored in `storage.local`. On
sidebar load, the UI reconciles toggle state against
`permissions.contains({permissions: ['tabs']})`; if permission was
revoked externally (Add-ons Manager) the toggle resets to off and
listeners detach.

The refresh button in the sidebar header gains conditional behavior:
with `tabs` granted, it calls `tabs.query({active: true,
currentWindow: true})` and broadcasts sync; without, it preserves
today's behavior (re-fetch the displayed orgnr).

The context-menu handler shipped in the previous milestone is
unchanged.

## Components

### `public/manifest.json`

- `permissions`: unchanged (`activeTab`, `storage`, `menus`)
- `optional_permissions`: add `["tabs"]`

The install dialog stays silent — `optional_permissions` does not
contribute to install-time prompts in Firefox.

### `src/background/background.ts`

Existing context-menu wiring stays. Adds:

- `permissions.onAdded` / `permissions.onRemoved` listeners that
  attach/detach the `tabs.onActivated` and `tabs.onUpdated` handlers.
- On service-worker boot: check `permissions.contains` and
  `storage.local` toggle. If both true, register tab listeners; else
  leave them detached.
- Tab listeners reuse `deriveSync(tab.url, tab.title)` and the
  existing `broadcastSync` helper. No new orgnr-resolution path.

`tabs.onActivated` fires with `{tabId, windowId}` only — URL is not
on the event. The handler must `tabs.get(tabId)` to read URL/title.
This requires `tabs` permission (which we have by hypothesis at that
point). `tabs.onUpdated` fires with `{tabId, changeInfo, tab}` and
provides the tab object directly.

### `src/details/details.ts` (sidebar UI)

Adds two UI elements to the header (or settings panel — TBD by UI
designer, not load-bearing for this spec):

- **Toggle "Auto-oppdater ved fane-bytte"** — checkbox/switch. Wired
  to a controller function that:
  1. Reads current toggle state from `storage.local`
  2. On flip-to-on: calls `permissions.request({permissions:
     ['tabs']})`. If denied, toggle reverts and shows inline status.
  3. On flip-to-off: stops listening. Whether to also call
     `permissions.remove` is an open question (see § Open questions);
     the implementation should make the choice obvious to swap.
  4. Writes toggle state to `storage.local`

- **Smart refresh button (↻)** — existing button, conditional path:
  - `permissions.contains({permissions: ['tabs']})` true: call
    `browser.tabs.query({active: true, currentWindow: true})`,
    resolve orgnr via `deriveSync`, then either broadcast sync over
    `runtime.sendMessage` or call the in-iframe load function
    directly. Either reaches the same end state — pick the one that
    keeps the load path consistent with the existing message-handler
    flow in `details.ts`.
  - false: current behavior (re-fetch displayed orgnr)

The existing `runtime.onMessage` sync listener does not change.

### `src/lib/context-menu.ts`

`deriveSync` already exists from the previous milestone. The
background tab-listener handlers call it with the same `(url, title)`
shape. No change.

Consider renaming the module to `src/lib/tab-sync.ts` since it now
serves three call sites (context menu, refresh button, auto-refresh).
Defer to plan stage.

### `storage.local` schema

New key: `settings.autoSyncOnTabSwitch: boolean`. Default false.
Read on sidebar load and on service-worker boot. No migration needed
(absent key reads as undefined → coerce to false).

## Edge cases

- **Permission revoked externally** (Add-ons Manager). `permissions.onRemoved`
  fires → background detaches listeners → sidebar reconciles toggle
  to off on next load. If sidebar is open at revoke time, listener on
  `permissions.onRemoved` in the sidebar flips the toggle live.
- **Toggle on, permission denied at request.** Toggle resets to off,
  inline message: "Firefox blokkerte forespørselen. Klikk igjen for
  å prøve på nytt."
- **Tab switch to about:blank, file://, about:addons, etc.**
  `deriveSync` returns null → no broadcast. Sidebar shows whatever
  was last loaded.
- **Tab switch to a page with no resolvable orgnr.** Same as above —
  no broadcast, sidebar stays put. (Alternative: broadcast a
  "cleared" message. Defer to plan stage; not blocking.)
- **Service worker is idle when tab switch fires.** MV3 wakes it.
  Listeners are re-registered on each cold start from the boot-time
  reconciliation (toggle state + permission check).
- **User has multiple Firefox windows.** `tabs.onActivated` and
  `onUpdated` fire per-window. Sidebar is per-window in Firefox, so
  the broadcast naturally matches the user's focused window via
  `runtime.sendMessage` routing.
- **Race between manual click on refresh button and an arriving
  `tabs.onActivated` event.** Existing `loadRunId` monotonic token in
  `details.ts` already handles out-of-order loads. No new race.

## Security model update

`CLAUDE.md` § Security constraints and `README.md` § Security model
both need an updated permissions block:

```
Permissions: activeTab + storage + menus (install) + tabs (optional,
runtime opt-in).

`tabs` is listed in optional_permissions, not permissions. Install
stays silent. The user must explicitly enable "Auto-oppdater" in the
sidebar to grant it, and can revoke via Add-ons Manager at any time.
With tabs granted, the background script reads tab URL/title on tab
switch (tabs.onActivated → tabs.get) and on tab update
(tabs.onUpdated). No content scripts, no broader host_permissions, no
cookie or webRequest access.
```

The product-level commitment ("default: zero tab snooping; the user
opts in") is preserved.

## Testing

### Unit (vitest)

- `deriveSync` — covered already.
- New: toggle controller logic in isolation. Mock `browser.storage`
  and `browser.permissions`. Test:
  - flip-to-on with grant → storage write, listeners attach signal
  - flip-to-on with deny → no storage write, toggle reverts
  - flip-to-off with previously-on → permissions.remove called,
    storage cleared
  - external `permissions.onRemoved` → toggle reads as off on reload

### Manual

- Install fresh, confirm no "Access your tabs" in install dialog.
- Open sidebar, flip toggle on → Firefox shows runtime permission
  prompt → accept → sidebar switches to active tab as you switch
  tabs (dnb.no → vg.no → ssb.no).
- Flip toggle off → tab switches no longer update sidebar.
- Revoke permission via about:addons → toggle reverts to off on next
  sidebar open.
- Refresh button: with toggle off, re-fetches displayed orgnr. With
  toggle on (permission granted), reads active tab.
- Context menu still works in all states.

### Lint

- `web-ext lint` must stay 0/0/0.
- `pnpm audit --prod` must stay 0.

## Out of scope

- **Keyboard shortcut via `commands` API.** Still tracked in
  `backlog.md` as power-user follow-up. The auto-refresh path now
  covers the primary tab-switch UX, which lowers the priority of the
  shortcut. Revisit if users ask.
- **Sidebar UI redesign / settings panel layout.** Where exactly the
  toggle lives (header, gear icon, dedicated settings view) is a UX
  decision for the plan/implementation stage. The toggle's existence
  and behavior is locked by this spec; its placement is not.
- **Migrating away from `storage.local` for settings.** Today's cache
  uses `storage.session`. Settings need persistence across browser
  restarts → `storage.local` is correct. No migration debt.
- **Telemetry on toggle adoption.** No telemetry in this extension,
  spec-aligned.

## Open questions for plan stage

1. Module rename `context-menu.ts` → `tab-sync.ts`? Or keep both as
   separate modules (context-menu wiring vs. derive logic)?
2. Where in the sidebar UI does the toggle live? Header inline,
   header overflow menu, or dedicated settings view?
3. On toggle-off, should the extension call `permissions.remove`, or
   just stop listening while keeping the grant? Removing is
   "cleaner" (off means revoked) but flipping back on will re-prompt
   the user. Keeping the grant is friction-free but the user still
   sees "Access your tabs" in `about:addons`. Decision pending
   Seb's UX preference.
