# Changelog

All notable changes to brreg-snap are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/) (loosely).

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
