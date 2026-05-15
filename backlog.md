# Backlog

Decisions and deferred work that doesn't fit in CLAUDE.md (which
documents shipped state) or commit messages.

## Sidebar auto-sync on tab switch — shipped 2026-05-15

Both paths from the original backlog landed in commit `ed5bb74`:

- **Context-menu trigger** — `menus` permission + "Vis i brreg-now
  sidebar" right-click item on every http(s) page. Handler reads
  URL/title via `tabs.query`, resolves orgnr, broadcasts
  `{type:'sync', orgnr, host}` to the sidebar listener.
- **`tabs` permission for true auto-sync** — added as
  `optional_permissions`, runtime-requested via the "Auto-oppdater
  ved fane-bytte" toggle in the sidebar header. Flipping off (or
  revoking via `about:addons`) calls `permissions.remove` and
  detaches the tab listeners. The install-time permission set stays
  at `activeTab` + `storage` + `menus` + the brreg host — the `tabs`
  prompt only appears if the user opts in.

See CLAUDE.md § "Tab-sync via runtime `tabs` opt-in is the supported
path" and § Security constraints for the shipped contract.

### Still open

- **Commands keyboard shortcut.** Same gesture class as the context
  menu — silent install, grants `activeTab`, no `permissions` entry
  needed (`commands` is a manifest key outside the array). Same
  `tabs.query`-before-`await` caveat. Trade-off: invisible until the
  user discovers it via `about:addons` → manage shortcuts. Worth
  adding as a power-user follow-up — handler logic from the context
  menu and the auto-sync toggle is reusable.

### Rejected / not pursued

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
