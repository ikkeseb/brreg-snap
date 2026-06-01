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
  dependency guarantee. Tab-switch auto-update stays Firefox-only for
  now (a follow-up). Pending Chrome Web Store review.

### Changed

- `[firefox]` Packaged `.xpi` no longer ships sourcemaps or
  `icons/README.md` (~263 KB → 43 KB). No change to executed code —
  maps remain in the build dir for local debugging and the full
  TypeScript source ships in the source zip used for AMO review.

### Internal

- Characterization tests for `format` and `recent`, plus tests for the
  platform layer (engine detection + sidebar adapter). 105 → 170 tests.
- Removed an inert `web-ext-config.cjs` (was never loaded; packaging
  options are now explicit CLI flags).

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
