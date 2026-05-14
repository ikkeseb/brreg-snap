# Backlog

Decisions and deferred work that doesn't fit in CLAUDE.md (which
documents shipped state) or commit messages.

## Sidebar auto-sync on tab switch

**Status.** Not implemented. Shipped workarounds: ↻ button in the
sidebar header (re-fetches the *same* orgnr, does not read the active
tab), and popup-driven `runtime.sendMessage` sync (popup-open
broadcasts to the sidebar listener).

**Problem.** With the sidebar open on tab A, switching to tab B in
Firefox leaves the sidebar showing A's company. The user has to click
the toolbar action (opens the popup, which broadcasts sync) to get B's
data into the sidebar. Auto-refresh on `tabs.onActivated` requires
either the `tabs` permission (URL/title are stripped without it) or
content scripts — both off-limits per CLAUDE.md § Security
constraints.

### Recommended next step: context-menu trigger

Add `menus` permission + a page-context item ("Vis i brreg-now
sidebar"). Right-click anywhere on the page → click item →
`menus.onClicked` fires with `activeTab` granted for the right-clicked
tab → handler reads URL/title via `tabs.query` synchronously, resolves
orgnr, broadcasts `{type:'sync', orgnr, host}` — the same shape
`details.ts` already listens for.

Cost: one new permission entry (`menus`), ~20 lines in
`background.ts`, zero changes to `details.ts`. Install prompt
unchanged — `menus` is on Mozilla's no-prompt list. README §
Permissions needs an extra line.

UX: right-click → menu item → sidebar updates. Replaces "click
toolbar → click Detaljert visning" with one step, no popup flash.

Caveat: the item appears on every http(s) page, not just
bedriftssider. The handler degrades gracefully when no orgnr resolves
— same fallback as the popup's "Ingen bedrift oppdaget".

### Implementation notes (for when this is picked up)

- `menus.onClicked` handler **must** call `tabs.query` synchronously
  before any `await`. User-gesture status is lost on the first
  microtask break — same caveat as `commands.onCommand`.
- Reuse `resolveOrgnr` and the existing `{type:'sync', orgnr, host}`
  message shape. The `details.ts` listener stays as-is.
- `web-ext lint` must remain 0/0/0.
- Update README § Security model to note the new `menus` entry and
  why it does not grant tab snooping (no `activeTab` granted unless
  the user clicks the menu item).

### Alternatives considered (and why deferred / rejected)

- **Commands keyboard shortcut.** Same gesture class — silent install,
  grants `activeTab`, no `permissions` entry needed (`commands` is a
  manifest key outside the array). Same `tabs.query`-before-`await`
  caveat. Trade-off: invisible until the user discovers it via
  `about:addons` → manage shortcuts. **Worth adding as a power-user
  follow-up after the context menu ships** — the handler logic is
  reusable. Tracked here, not separately, because it's the same
  problem with a complementary surface.
- **`tabs` permission for true auto-sync.** Enables refresh on
  `tabs.onActivated` with no user gesture. Trade-off: install dialog
  shows "Access browser tabs", which breaks the zero-tab-snooping
  narrative in README § Security model. **Rejected unless the
  permissionless paths prove insufficient in practice** — revisit
  only if real users complain after context menu + shortcut ship.
- **Iframe button inside the sidebar.** Falsified empirically — see
  CLAUDE.md § "A button *inside the sidebar iframe* does NOT grant
  activeTab". Don't re-investigate.
- **`webNavigation` as a middle-ground permission.** Fires on
  navigation events, not on switching to an already-loaded tab.
  Partial fit only; not worth the prompt for the gap it leaves.

### Sources

Subagent research from 2026-05-14 covering:

- Firefox `commands` API + `activeTab` grant semantics (MDN docs,
  stable since Fx 63, no open Bugzilla regressions).
- Survey of every WebExtensions gesture surface that grants
  `activeTab` (browser action, sidebar action, page action,
  commands, menus, omnibox, notifications).
- Cost analysis of `tabs` permission (install prompt text, AMO
  review implications, alternatives like `webNavigation` and
  `history`).
