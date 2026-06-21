# Changelog

All notable changes to brreg-snap are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/) (loosely).
Browser-specific lines are prefixed `[chrome]` / `[firefox]`.

## [Unreleased]

These are visible behaviour changes on both engines, so they ship as a
real version bump (not a silent patch).

### Added

- Side-panel Nøkkeltall now shows a multi-year (up to 3) regnskap trend
  table built from the already-fetched filings (no extra request), plus
  derived **Gjeld** and **Egenkapitalandel**. Losses and negative
  equity are flagged in red.
- **Styreleder**, **Revisor** and **Regnskapsfører** are surfaced in the
  side-panel overview (and Styreleder in the popup) from the roller
  response already fetched for daglig leder.
- Næringskode now shows its code next to the description
  ("… (62.020)").
- The popup reached registry-flag parity with the side panel
  (Stiftelsesregistret, Frivillighetsregistret).
- A skeleton loader in the popup, matching the side panel.
- **In-panel drill-in**: clicking a parent enhet or a company
  role-holder (auditor / accountant / corporate board member) loads it
  in place, with browser Back/Forward support. Dissolved entities stay
  plain text (they would 404). The active tab is deep-linked via `?tab=`
  and restored on load.
- Role rows flag deceased persons (død) and dissolved entities
  (slettet); the underenheter table flags wound-down sub-units
  (Nedlagt).
- Keyboard: manual-search and recents rows are now operable with Space
  as well as Enter and expose a button role; Home/End jump to the
  first/last side-panel tab.

### Changed

- The UI accent is now the amber brand colour across both surfaces; the
  exploratory teal `data-accent` override is no longer shipped.

### Internal

- Consolidated the duplicated `storage.session` TTL cache into
  `src/lib/session-cache.ts`, the two `makeFlag` copies into one shared
  pill, and added `findRoleHolder` (generalising `findDagligLeder`) plus
  a DOM-free `src/lib/regnskap.ts`. New unit tests cover the cache,
  role-holder lookup, regnskap derivations, and the næring/percent
  formatters.

## [1.1.0] — 2026-06-10

### Added

- `[chrome]` Chrome / Chromium support from the same source tree
  (`BROWSER=chrome` build). Chrome's side panel (`sidePanel`) replaces
  the Firefox sidebar; popup lookup, context menu, manual search,
  picker, recents and click-to-copy all work. Engine differences are
  isolated in `src/lib/platform/` with no third-party polyfill (a
  ~3-line `browser`→`chrome` shim), preserving the zero-runtime-
  dependency guarantee. Live on the Chrome Web Store since 2026-06-07.
- `[chrome]` Auto-update on tab switch ("Auto-oppdater ved fane-bytte")
  is now at parity with Firefox — `tabs` is a runtime opt-in in the
  Chrome manifest, requested only when the user enables the toggle.

### Changed

- Hostname→orgnr resolution improvements (no curated data, as
  always): orgnr extraction now accepts the canonical spaced format
  ("982 463 718"), requires the first digit to be 8/9 (matches the
  entire live registry; cuts chance-valid junk), normalizes brreg's
  free-text `hjemmeside` field before scoring, handles multi-part
  TLDs (`company.co.uk` no longer searches for "co"), and decodes
  punycode hostnames so æ/ø/å domains resolve.
- Manual-search failures now show an inline error with "Prøv igjen"
  instead of wiping the search UI; the full error state also gained a
  retry button.
- Removed the manual refresh button from the side panel (both engines).
  It couldn't follow the active tab without `tabs`, and with auto-sync
  on the panel already follows live, so the refresh icon promised a sync
  it couldn't deliver; the footer "Oppdatert" freshness stamp stays.
- `[firefox]` Packaged `.xpi` no longer ships sourcemaps or
  `icons/README.md` (~263 KB → 43 KB). No change to executed code —
  maps remain in the build dir for local debugging and the full
  TypeScript source ships in the source zip used for AMO review.

### Fixed

- `[firefox]` Auto-update on tab switch (and the context-menu item)
  silently broke on Firefox during the Chrome port: the background
  switched to `browser.contextMenus`, which is `undefined` on Firefox
  under the `menus` permission, so the top-level access threw and
  aborted background-module evaluation before the auto-sync tab
  listeners registered. The context-menu API is now selected per engine
  (`browser.menus` on Firefox, `chrome.contextMenus` on Chromium) via
  `src/lib/platform/menus.ts`. Caught in pre-release testing — never
  shipped; the background test mock now mirrors each engine's namespace
  so a regression can't slip through again.
- Network failures (offline, timeouts, 429/5xx) are no longer cached
  as "no match" for 24h — the brreg search client now distinguishes
  errors from genuinely-empty results, and the resolution pipeline
  only caches a verdict when every constituent query succeeded. The
  next visit retries.
- All brreg fetches now carry an 8s timeout (`AbortSignal.timeout`),
  so a hung connection can't leave the popup/sidebar spinner running
  forever.
- Out-of-order auto-sync broadcasts: a slow resolution for a previous
  tab can no longer overwrite the sidebar after a fast tab switch
  (monotonic event sequencing in the background script).
- Popup gained the same load-race guard the sidebar has — rapid
  clicks can't paint a stale company.
- The sidebar no longer steals keyboard focus from the page when
  auto-sync lands on an unresolvable site, and stale footer metadata
  ("Synket fra …") no longer survives into empty/picker states.

### Internal

- ~300 lines of duplicated popup/sidebar UI logic consolidated into
  shared `src/lib/ui/` modules (picker, manual search, tab
  resolution, source label).
- GitHub Actions CI: typecheck, lint, tests, both builds, web-ext
  lint, `pnpm audit --prod`, and a manifest-invariants step that
  enforces the security non-negotiables on every push.
- Manifest version is now stamped from `package.json` at build time
  (single source of truth; Firefox manifest stays byte-identical when
  versions match).
- Builds work in a native Windows shell (`.npmrc` `shell-emulator`).
- Characterization tests for `format` and `recent`, platform-layer
  tests (engine detection + sidebar adapter), Chrome-mode background
  dispatch, and a new `brreg.ts` error-contract suite. 105 → 232 tests.
- Removed an inert `web-ext-config.cjs` (was never loaded; packaging
  options are now explicit CLI flags).

## [1.0.1] — 2026-06-06

### Fixed

- More reliable org-number resolution: a chance-valid 9-digit number in
  a URL or page title no longer shadows the real company. An explicit
  named `?orgnr=` parameter wins; otherwise a bare 9-digit is trusted
  only when it is the single mod-11-valid candidate, else the extension
  abstains to the hostname search / picker rather than showing a
  confidently-wrong hit. Reconciled the hostname benchmark to import the
  shipped scoring (confirms 0 auto-wrong resolutions).

## [1.0.0] — 2026-05-16

First public release. Renamed from the internal `brreg-now` working
name; functionality unchanged from the pre-1.0 development branch.

### Features

- Popup-only architecture: click the toolbar icon on any Norwegian
  company website to get a snapshot from Brønnøysundregistrene —
  legal name, status flags, business and postal address, NACE code,
  employee count.
- Sidebar panel with a deeper layout: board members (`STYR` /
  `LEDE`), signaturrett and prokura, latest filed regnskap with
  key figures, underenheter, parent enhet.
- Hostname → orgnr resolution via a multi-query brreg pipeline with
  confidence scoring. Three outcomes: auto-resolve when one
  candidate is clearly ahead, surface a "Mente du …?" picker when
  several plausible companies tie, fall back to inline manual
  search when none match confidently.
- "Feil bedrift? Vis alternativer" override on host-resolved auto
  matches — re-runs the pipeline with the rejected candidate
  filtered out.
- Click-to-copy on orgnr digits anywhere in the popup or sidebar.
- Optional auto-update on tab switch via a runtime-requested `tabs`
  permission (off by default, toggle in the sidebar header).
- Context-menu item ("Vis i brreg-snap sidebar") on any http(s) page.
- Responses cached in `storage.session` for 24h.

### Security

- No content scripts. No DOM access on the pages you browse.
- Only `data.brreg.no` in `host_permissions`. No third-party calls,
  no analytics, no telemetry.
- CSP keeps `default-src 'self'` with `base-uri`, `form-action`, and
  `frame-ancestors` all `'none'`. No `unsafe-inline`, no remote
  scripts, no `eval`.
- `tabs` is the only optional permission and is runtime-requested
  via Firefox's prompt — install-time permissions stay
  `activeTab` + `storage` + `menus` + the brreg host.
- Zero runtime dependencies in the shipped bundle.
