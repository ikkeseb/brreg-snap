# Backlog

Decisions and deferred work that doesn't fit in CLAUDE.md (which
documents shipped state) or commit messages.

## Audit findings — adversarial review 2026-06-02

A 28-agent adversarial audit of the Chrome port (6 lenses × find +
independent verify) produced 26 findings; 9 confirmed real after
verification. **Key result: every confirmed finding is PRE-EXISTING
and engine-independent — none were introduced by the Chrome port** (all
verified absent from `git diff chrome-port...HEAD`). They affect the
AMO-approved Firefox v1.0.0 identically. So they are product backlog,
not port blockers, and **fixing the resolution-logic ones changes the
approved product's behavior → needs Seb's sign-off + embargo sequencing
(don't land on the chrome-port branch, which must stay FF-behavior-
equivalent).** Several scary-sounding candidates were dismissed on
verification and three were additionally confirmed-safe LIVE on real
Chrome (Playwright + `dist-chrome`): the refresh button works
(`permissions.contains({tabs})` returns `false`, does not reject, for
the undeclared perm), the shim ordering holds, and the full lookup +
all four detail tabs render real brreg data with no console errors.

### Confirmed — worth fixing (in priority order)

- **[MEDIUM] orgnr extraction: first mod11-valid 9-digit run wins**
  (`src/lib/orgnr.ts:8-17`). `extractOrgnrFromText` returns the FIRST
  9-digit run that passes mod11. ~9% of arbitrary 9-digit numbers pass
  mod11 (measured 9.11%/100k), and the whole raw tab URL/title is
  scanned positionally — so a chance-valid affiliate ID / timestamp /
  SKU appearing BEFORE the page's real `?orgnr=` silently resolves the
  wrong company with no ambiguity signal. Verified:
  `extract('…?aff=923609016&orgnr=982463718')` → 923609016 (wrong).
  Real-world trigger is narrow (page needs both a chance-valid 9-digit
  AND the real orgnr, former positionally first) but the failure is
  silent + confident. **Fix is a product judgment — pick one:**
  (A) key-aware: in `resolveOrgnr`, check query keys matching
  `/^orgn(r)?$|organisasjonsnummer/i` + last path segment first, fall
  back to positional; (B) ambiguity-refuse: collect ALL distinct
  mod11-valid candidates, return undefined when >1 so the
  hostname-search/picker decides; or a hybrid (A then B). Add a
  regression test (`?aff=<valid>&orgnr=<valid>`). Candidate for a
  Firefox v1.0.1 once Seb chooses the approach.

### Confirmed — low severity (resolution heuristics, pre-existing)

- **[LOW] `hostnameLabel` returns the public-suffix segment** for
  multi-part TLDs / trailing-dot FQDNs (`hostname-score.ts:47-54`).
  e.g. `telenor.no.` → `"telenor"` only after a trailing-dot strip; a
  `foo.co.uk` style host mislabels. Fix: strip trailing dot + lowercase
  before splitting; consider a public-suffix-aware split.
- **[LOW] hjemmeside substring match (+12) cross-brand contamination**
  (`hostname-score.ts:137-139`). `hjem.includes(bareHost)` lets
  `bloggvg.no` match host `vg.no`. Fix: require a label boundary.
- **[LOW] a single unrelated company self-reporting the host as its
  homepage can auto-resolve with zero name relation**
  (`hostname-score.ts:127-148`, `:235-252`). Fix: expose `nameMatched`
  from `scoreCandidate`; force `band='picker'` (never `auto`) when the
  top candidate has no name relation.
- **[LOW] `findDagligLeder` silently drops a corporate (enhet) daglig
  leder** (`src/lib/roller.ts:3-18`) — only handles person-name roles.
  The sidebar's `render/roles.ts:60-83` already handles the enhet case;
  mirror that fallback so the popup's quick-glance daglig leder matches.

### Confirmed — accessibility (pre-existing)

- **[LOW] manual-search & recent rows are non-semantic `<li tabindex=0>`**
  (`details.ts:309-342`, `popup.ts:602-632`, `popup.ts:513-535`): no
  role, no Space activation. Fix: wrap each row in a real
  `<button type="button">` like the picker already does
  (`popup.ts:410-411`, `details.ts:180`).
- **[LOW] side-panel result is never announced to screen readers**
  (`details.ts setState`/`loadOrgnr`): the loading announcement is set
  then hidden on the result transition. Fix: populate the polite live
  region with e.g. `"${enhet.navn} lastet"` on result.

### Confirmed — Chrome-only, behavior defensible (port-specific)

- **[LOW] popup `syncSidebarIfOpen` writes the global side-panel path on
  every auto-resolve** because Chrome's `isOpen()` stub returns `true`
  (`popup.ts:220-254` + `sidebar.ts:96-98`). Consequence: opening the
  panel via Chrome's native side-panel dropdown shows the last-resolved
  company. `setOptions(enabled:true)` does NOT auto-open the panel, and
  the explicit open paths always `setPanel` right before `open()`, so
  this is benign (arguably good UX — "last company you looked at").
  Optional refinement: only write the global path from explicit open
  intents. Left as-is for the MVP.

### Confirmed — robustness (pre-existing, optional)

- **[LOW] `details.ts init()` is unguarded** (`details.ts:775-818`):
  unlike `popup.ts init()` (try/catch → showError), a `storage.session`
  rejection during the no-match/active-tab path would leave the panel
  on the initial HTML (no terminal state). Fix: wrap the body in
  try/catch → `showError`. Near-impossible in practice (storage rarely
  rejects), but cheap insurance.

### Dismissed on verification (notable false alarms)

Verified NOT bugs: "side panel can never resolve the active tab on
Chrome" (it does, via `?orgnr=` + activeTab on context-menu open);
"shim ordering relies on chunk-merge luck" (verified deterministic);
"refresh button no-op / `permissions.contains` rejects" (live-verified
returns false); mod11 accepts `000000000`/repdigits (real but inert —
brreg 404s them); concurrent `cacheGet`/`cacheSet` double-fetch
(converges, not wrong data); gesture races on the popup/context-menu
open paths (no `await` before `open()` — covered by the live Phase-4
checks). Full per-finding reasoning was in the audit run output.

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

- **Context-menu trigger** — `menus` permission + "Vis i brreg-snap
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
- **Domain-match signal in hostname scoring.** Considered as a way
  to surface brand-only hostnames whose legal name doesn't carry
  the brand token (nrk.no → NORSK RIKSKRINGKASTING AS). brreg's
  API refuses an `epostadresse` filter (confirmed 2026-05-16) and
  the obvious shape — boost candidates whose `epostadresse` or
  `hjemmeside` ends with the hostname's registered domain — only
  helps when the right candidate is already in the search pool.
  Verified against the trigger case: `?hjemmeside=nrk.no` returns
  zero NRK-correct hits and `?navn=nrk&FORTLOEPENDE` returns 31
  satellite orgs (B.I.L., veterankor, journalistlag) but never
  NORSK RIKSKRINGKASTING itself — it has no `hjemmeside` field and
  the legal name is not substring-matchable from "nrk". Scoring
  cannot promote a candidate that isn't in the pool. The acronym
  case would need a different mechanism (acronym expansion or
  email-domain query, neither cheap) and the manual sidebar search
  already handles these hosts per the "no curated data → fall
  through to manual search" principle in CLAUDE.md. Closed.

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
