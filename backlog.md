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

- **Hostname → brreg search as primary resolution (BIG ONE).**
  Current cascade is URL regex → title regex → curated `domains.ts`
  table. The curated table has ~12 entries and was misread by a
  previous Claude session as the intended primary path — it is not.
  The point of the extension is *automatic* lookup against the brreg
  API for whatever site the user is on. Right now Yara, Shell, Tomra,
  Mestergruppen, Øyehaug, Finansavisen and the vast majority of
  Norwegian company sites get no hit in the sidebar.

  Redesign sketch:
  1. URL regex (keep)
  2. Title regex (keep)
  3. Hostname-based brreg search: strip `www.`, drop the TLD, hit
     `data.brreg.no/enhetsregisteret/api/enheter?navn=<query>&size=5`.
     The `domains.ts` curated table becomes a *tiebreaker* for cases
     where the brand name and legal-entity name diverge (FINN.no →
     VEND MARKETPLACES AS, finn.no doesn't get a clean hit by `navn`
     because the public search drops the dot).
  4. If single confident match → load it. If multiple plausible
     candidates → render a picker in the sidebar (same shape as the
     popup's free-text search results) rather than the current dead
     "no hit" state.
  5. Domain-keyed cache so the same hostname doesn't re-hit search on
     every tab switch (storage.session, 24h TTL — same pattern as
     `fetchEnhet`).

  Open design questions:
  - How aggressive about disambiguation? Pure top-1 will be wrong
    often; always-picker is annoying for unambiguous cases. Probably
    "single result above a confidence bar → auto; otherwise picker."
    Confidence bar TBD — name similarity, organisasjonsform filter
    (skip ENK/personlig), antallAnsatte>0, etc.
  - Domain table fate. Probably keep as a small hand-curated
    override list (FINN.no class of problems) rather than delete.
    Rename to make role clear — `domains-override.ts` or similar.
  - Should the popup `showSearch` fallback go away too, replaced by
    pre-populating the search box with the stripped hostname? Likely
    yes — same logic, less surface.

  No new permissions needed (`data.brreg.no` already in
  `host_permissions`).

- **Repo segmentation / routing table for fast Claude lookups.**
  CLAUDE.md is ~220 lines of dense gotchas and `details.ts` is ~800
  lines — every Claude session pays a context tax to read them in
  full. Goal: a routing-table approach where a small top-level index
  (CLAUDE.md or a new `MAP.md`) points at narrowly-scoped files for
  each concern (security, brreg-API quirks, sidebar/permissions,
  resolution cascade, UI rendering). Then grep/glob can target the
  exact file instead of paging through one giant document. Concrete
  starting moves:
  - Split `details.ts` into smaller modules — renderers (`render-*`)
    separated from message-handling and lifecycle.
  - Move the "Architecture" gotchas in CLAUDE.md into per-topic
    files under `docs/notes/` (e.g. `regnskap-api.md`,
    `permissions-model.md`, `sidebar-sync.md`); keep CLAUDE.md as a
    one-line-per-topic index with `[[link]]`s.
  - Tag each architecture note with a stable anchor so
    `Grep --glob docs/notes/permissions-model.md` lands first try.
  - Consider section anchors like `<!-- SECTION: permissions -->`
    that grep can target instead of full-file reads.

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
