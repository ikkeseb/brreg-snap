# Changelog

All notable changes to brreg-snap are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/) (loosely).
Browser-specific lines are prefixed `[chrome]` / `[firefox]`.

## [Unreleased]

### Added

- `[chrome]` Chrome / Chromium support from the same source tree
  (`BROWSER=chrome` build). Chrome's side panel (`sidePanel`) replaces
  the Firefox sidebar; popup lookup, context menu, manual search,
  picker, recents and click-to-copy all work. Engine differences are
  isolated in `src/lib/platform/` with no third-party polyfill (a
  ~3-line `browser`→`chrome` shim), preserving the zero-runtime-
  dependency guarantee. Pending Chrome Web Store review.
- `[chrome]` Auto-update on tab switch ("Auto-oppdater ved fane-bytte")
  is now at parity with Firefox — `tabs` is a runtime opt-in in the
  Chrome manifest, requested only when the user enables the toggle.

### Changed

- Removed the manual refresh button from the side panel (both engines).
  It couldn't follow the active tab without `tabs`, and with auto-sync
  on the panel already follows live, so the refresh icon promised a sync
  it couldn't deliver; the footer "Oppdatert" freshness stamp stays.
- `[firefox]` Packaged `.xpi` no longer ships sourcemaps or
  `icons/README.md` (~263 KB → 43 KB). No change to executed code —
  maps remain in the build dir for local debugging and the full
  TypeScript source ships in the source zip used for AMO review.

### Fixed

- More reliable org-number resolution: a chance-valid 9-digit number in
  a URL or title no longer shadows the real company. An explicit named
  `?orgnr=` wins; otherwise a bare 9-digit is trusted only when it's the
  single mod-11-valid candidate, else the extension abstains to the
  hostname search / picker rather than showing a confidently-wrong hit.

### Internal

- Characterization tests for `format` and `recent`, plus tests for the
  platform layer (engine detection + sidebar adapter) and Chrome-mode
  background dispatch. 105 → 182 tests.
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
