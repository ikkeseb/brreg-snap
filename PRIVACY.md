# Privacy Policy

_Last updated: 2026-05-16_

brreg-snap is a browser extension that shows information from the
public Norwegian business registry
([Brønnøysundregistrene](https://data.brreg.no/)) about Norwegian
companies. This document explains exactly what data leaves your
browser, where it goes, and how the extension uses local storage.

## TL;DR

- The only external service the extension contacts is
  `data.brreg.no` — Brønnøysundregistrene's public API.
- It sends the active tab's hostname and (in some cases) the page
  title fragment, in order to look up the matching organisation.
- It does **not** read or transmit page content, send anything to
  third parties, run analytics, or track you across sites.
- Data is sent only in response to your action (clicking the
  toolbar icon, opening the sidebar, or — if you explicitly enable
  it — switching tabs while the sidebar is open).

## What data leaves your browser

When you trigger a lookup, the extension calls Brønnøysundregistrene's
public API at `data.brreg.no`. The following may be transmitted as
part of API requests:

| Data | When | Sent to |
|---|---|---|
| 9-digit organisation number | When extracted from the URL or page title, or typed/picked manually | `data.brreg.no/enhetsregisteret/api/enheter/<orgnr>` |
| Tab hostname (e.g. `example.no`) | When the extension cannot find an organisation number in the URL and falls back to brreg's `hjemmeside` search | `data.brreg.no/enhetsregisteret/api/enheter` (query parameter) |
| Page title fragment | Only when the hostname lookup returns no clear match and the extension queries by name | `data.brreg.no/enhetsregisteret/api/enheter` (query parameter) |

The extension does not transmit:

- Full URLs or query strings
- Cookies, session tokens, or any authentication data
- Page contents, DOM, or text from the page body
- Browsing history
- Any data to any service other than `data.brreg.no`

## Local storage

The extension stores the following on your device only — nothing
synced, nothing transmitted:

- **`storage.session`** — A 24-hour cache of brreg responses keyed
  by organisation number, so repeated lookups don't hammer the API.
  Cleared automatically when you close all Firefox windows.
- **`storage.session`** — A short list of recently viewed
  organisations (up to 5), used by the popup's empty state to
  re-open a recent lookup quickly. Cleared when the session ends.
- **`storage.local`** — A single boolean for the "Auto-oppdater
  ved fane-bytte" toggle in the sidebar header.

You can clear all of this at any time via `about:addons` → brreg-snap
→ Remove, or via Firefox's site data clearing.

## Permissions

| Permission | Purpose |
|---|---|
| `activeTab` | Read URL and title of the current tab, only when you click the toolbar icon, the sidebar icon, or a context-menu item. Cannot read or modify the page. |
| `storage` | Cache responses and remember the auto-sync toggle as described above. |
| `menus` | Add a "Vis i brreg-snap sidebar" item to the right-click menu. |
| `host_permissions: https://data.brreg.no/*` | The only network destination the extension contacts. |
| `optional_permissions: tabs` | **Off by default.** Required only if you enable "Auto-oppdater ved fane-bytte". Requested at runtime via Firefox's standard permission prompt. When granted, allows the extension to receive tab-switch events so the sidebar can re-resolve the organisation number automatically. Revocable from `about:addons` or by flipping the toggle off (which calls `permissions.remove`). |

## Third parties

None. The extension contacts only `data.brreg.no`. No analytics, no
crash reporting, no advertising network, no remote configuration,
no telemetry of any kind. There is no server-side component
operated by the extension author.

`data.brreg.no` is operated by Brønnøysundregistrene (the Norwegian
Brønnøysund Register Centre), a Norwegian government agency. Their
terms govern API usage; the data returned is public-record
information about Norwegian businesses.

## Code transparency

- Open source under the MIT License at
  [github.com/ikkeseb/brreg-snap](https://github.com/ikkeseb/brreg-snap).
- Zero runtime dependencies in the shipped bundle.
- No `eval`, `Function()` constructor, or remote-loaded code.
- Strict CSP: `default-src 'self'`, no `unsafe-inline`, no remote
  script hosts.
- Source maps are shipped so the minified code can be mapped back
  to the original TypeScript.

## Contact

Open an issue on GitHub:
[github.com/ikkeseb/brreg-snap/issues](https://github.com/ikkeseb/brreg-snap/issues).
