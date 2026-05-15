# Backlog

Decisions and deferred work that doesn't fit in CLAUDE.md (which
documents shipped state) or commit messages.

## details.ts render slice extracted — shipped 2026-05-15

The 1227-line `src/details/details.ts` had ~15 render functions inline
(header, overview, contact, roles, parent, underenheter, nokkeltall)
plus shared DOM helpers (`addRow`, `addLink`, `emptyLine`, `makeFlag`,
`$`). They moved to `src/details/render/*.ts` as pure DOM writers —
each module owns its DOM refs via the shared `$` helper in
`render/dom.ts`. `details.ts` is now 880 lines and imports the render
functions instead of defining them.

What was safe to extract: render fns have no shared mutable state
(no `currentOrgnr` / `loadRunId` / `currentResolutionMethod` reads).
They take typed data, write to DOM, return void. Same module-load
discipline as the rest of the codebase — `$()` runs on import, but
`details.html` loads scripts at body end (ESM defer semantics), so
DOM is ready.

Not extracted in the same pass: lifecycle (`init`, `loadOrgnr`),
state mutation (`setSourceHost`, `setState`), message handling
(`onMessage` listener), auto-sync UI plumbing. Those share mutable
state and need a design pass — see "Still open" below.

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

`src/lib/domains.ts` deleted. Cascade is now URL/title regex →
hostname-search pipeline → manual search fallback. Principle in
CLAUDE.md § "No curated data".

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

- **Domain-match signal in hostname scoring.** Brand-only hostnames
  where the brand isn't in the legal name fall through the AUTO band
  today — nrk.no matches `NRK BARNEHAGEN OSLO SA` and other navn-`nrk`
  hits, but never `NORSK RIKSKRINGKASTING AS` whose registered email
  is `dokumentarkivet@NRK.no`. brreg's API refuses an `epostadresse`
  filter (`'epostadresse' er ikke et støttet parameter`, confirmed
  2026-05-16), so a direct query is out. Two viable shapes:

  **(a) Post-filter on search hits.** Run a broader name query, then
  hit `/enheter/{orgnr}` per candidate to read `epostadresse` and
  drop hits whose domain doesn't match. Adds one full-enhet fetch
  per candidate — expensive when the candidate set is large.

  **(b) Domain-match as a scoring boost (recommended).** Keep the
  current pipeline, but in `hostname-score.ts` fetch full `Enhet`
  for the top-N candidates (cached) and award a large boost when
  `enhet.epostadresse` or `enhet.hjemmeside` ends with the same
  registered-domain suffix as the hostname. Lets brand-only entities
  surface without inventing new query stages, and integrates
  cleanly with the existing AUTO / PICKER / NONE banding. Cost: a
  few extra fetches on cold candidate sets, no extra cost on cached
  ones.

  Trade-off: fan-out grows with candidate count. Keep N small (top
  4–6 by base score before applying the boost) and cache aggressively
  to bound it.

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

- **Split `src/details/details.ts` further (segmentation phase B
  remainder).** Render slice landed (`src/details/render/*.ts` —
  see below). Remaining seams still inline in details.ts:
  - `src/details/state.ts` — `loadOrgnr`, `loadRunId`, `currentOrgnr`,
    `currentResolutionMethod`. Shared mutable state, needs a design
    pass before extraction (loadRunId is bumped by both `loadOrgnr`
    and `showPicker`/`onMessage`, so ownership boundary isn't trivial).
  - `src/details/auto-sync-ui.ts` — toggle handling, permissions
    plumbing (already partially independent via auto-sync-controller
    + auto-sync-settings). Coupled to `autoSyncToggle` element +
    `currentAutoSyncEnabled` cache + `toggleInFlight` guard.
  - `src/details/main.ts` — boots, wires listeners, owns `init()` and
    the top-level setup* calls.

  Deferred: each of these moves shared mutable state across a
  module boundary; the render slice was safe because render fns are
  pure DOM writers with no state coupling.

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
