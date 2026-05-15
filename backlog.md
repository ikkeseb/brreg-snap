# Backlog

Decisions and deferred work that doesn't fit in CLAUDE.md (which
documents shipped state) or commit messages.

## Sidebar inline search + Feil bedrift? override — shipped 2026-05-15

Two follow-ups to the v2 picker, addressing real friction Seb hit on
the first manual smoke test:

- **Inline manual search in the sidebar empty state** replaces the
  "Klikk verktøylinjeikonet for å søke manuelt" hint. The empty
  state now hosts its own debounced search input + result list
  mirroring the popup's runId pattern. Sidebar is self-sufficient
  once open. New `data-state="empty"` distinct from `error` so
  genuine fetch failures still display only the error text.
- **"Feil bedrift? Vis alternativer"** override on host-resolved
  results. Click writes the orgnr to `rejected:<host>` (24h, separate
  from picker-choice), drops a positive picker-choice if it equals
  the rejected orgnr, and re-runs the pipeline with rejected filtered
  before scoring. Band cache key folds the sorted rejected set so the
  pre-rejection cache entry isn't served. Empty after filter falls
  back to the inline search above.

See `docs/notes/resolution.md` § reject-override and
`docs/notes/cache.md` for the new keys.

## Curated domain table removed — shipped 2026-05-15

`src/lib/domains.ts` and its hand-maintained host → orgnr table are
gone. Resolution is now pure brreg API: URL/title regex →
hostname-search pipeline → manual search fallback. Hosts brreg can't
disambiguate (FINN.no, sparebank1.no, etc.) simply don't auto-resolve
and the sidebar's manual search covers the gap. See CLAUDE.md
§ "No curated domain table".

## Hostname-resolution v2 (multi-query + scoring + picker) — shipped 2026-05-15

Replaced the "first prefix match wins" hostname resolver with a
multi-query + confidence-scoring pipeline (Q1 hjemmeside, Q2 navn
FORTLOEPENDE with Nordic-folded variants and org-form filter, Q3
fallback). Three-band outcome: AUTO (top ≥ 75 AND margin ≥ 10),
PICKER (top ≥ 45), NONE.

Picker UI lives in the sidebar (`data-state="picker"`) — "Mente du
…?" with the top 4 candidates and "Ingen av disse". User choice
caches under `picker-choice:<host>` for 24h.

Benchmark against 17-hostname test set:
6 auto-correct, 4 refuse-correct, 3 picker-with-right, **0 AUTO-WRONG**.

See `docs/notes/resolution.md` § bands + § picker-choice and
`docs/superpowers/specs/2026-05-15-hostname-resolution-design.md`.

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

- **Title parsing for hostnames that collapse spaces.** rema1000.no
  → "REMA 1000", detnorsketeatret.no → "DET NORSKE TEATRET",
  lieoverflate.no → "LIE OVERFLATE" — the page `<title>` carries the
  right tokens with correct spacing but the hostname doesn't. A
  follow-up could parse the active tab's title and use those tokens
  as a secondary brreg query in the resolution pipeline. Requires no
  new permissions (`activeTab` already covers it) but adds a new
  pipeline stage. Would also help brand≠entity cases (Finansavisen
  → HEGNAR MEDIA AS) when the title carries the legal name. See
  `docs/superpowers/specs/2026-05-15-hostname-resolution-design.md`
  § Out of scope / backlog.

- **Picker UX polish.** v1 picker (shipped 2026-05-15) renders the
  top 4 candidates as click targets. Backlogged: keyboard
  navigation, last-used-orgnr at the top, "show more" beyond top 4.
  Defer to a follow-up once we have feedback on the v1 picker.

- **Split `src/details/details.ts` into smaller modules
  (segmentation phase B).** Phase A (routing table + docs/notes/)
  shipped with the same commit as Bug 1 wiring. The 835-line file
  still mixes lifecycle, message handling, and ~15 render functions.
  Natural seams:
  - `src/details/render/` — `header.ts`, `overview.ts`, `roles.ts`,
    `parent.ts`, `underenheter.ts`, `nokkeltall.ts`. Each a pure
    render function.
  - `src/details/state.ts` — `loadOrgnr`, `loadRunId`, `currentOrgnr`.
  - `src/details/auto-sync-ui.ts` — toggle handling, permissions
    plumbing (already partially independent via auto-sync-controller
    + auto-sync-settings).
  - `src/details/main.ts` — boots, wires listeners, owns `init()`.

  Skipped in the segmentation session because it touches shipped
  behaviour and risks regressions. Worth doing when next adding a
  render concern (e.g. picker UI from above) — splitting first
  shrinks the surface that change has to read.

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
