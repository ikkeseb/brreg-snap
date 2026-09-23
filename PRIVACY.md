# Privacy Policy

_Last updated: 2026-09-23. Applies to brreg-snap 1.3.1 and later._

brreg-snap is a browser extension for Firefox and Chrome that shows
public information about Norwegian companies from
[Brønnøysundregistrene](https://data.brreg.no/) (the Brønnøysund
Register Centre). To find the company behind the site you are on, it
sends that site's domain name to the register's public API. This page
says exactly what is sent, when, and what is kept on your device.

## Summary

- The extension talks to one service only: `data.brreg.no`, the
  public API of Brønnøysundregistrene, a Norwegian government agency.
- It sends the domain of the site you look up (for example `dnb.no`
  when you are on `nettbank.dnb.no`; subdomains are not sent). It
  never sends the full page address, the page title, page content or
  cookies.
- Nothing goes to the developer or to any other party. There is no
  developer server, no analytics, no ads and no telemetry.
- Lookups happen when you ask for one. If you turn on the optional
  «Auto-oppdater ved fane-bytte» setting, brreg-snap also looks up
  the page you are on every time you switch tabs or open a new page,
  as long as a brreg-snap sidebar / side panel is open.

## When data is sent

The extension contacts `data.brreg.no` only when you:

1. click the brreg-snap toolbar button,
2. open the brreg-snap sidebar (Firefox) or side panel (Chrome),
3. choose «Vis i brreg-snap sidebar» in the right-click menu,
4. type in the search box, or click a company, link or button inside
   the extension, or
5. have turned on «Auto-oppdater ved fane-bytte». Then every time
   you switch tabs or open a new page, the page you are on is looked
   up, as long as a brreg-snap sidebar / side panel is open. The
   setting covers every window; each open panel follows the tabs of
   its own window. Closing the panel stops this.

IP addresses (like `192.168.1.10`) and reserved local names are never
sent: `localhost`, names without a dot, and endings such as `.local`,
`.lokal`, `.internal`, `.intern`, `.lan`, `.home.arpa` and `.priv`.
Other names that only work on a private network are looked up like
any other site.

## What is sent

| Data | Example | Why |
|---|---|---|
| The site's registrable domain. Subdomains and `www.` are not sent | `dnb.no` (on `nettbank.dnb.no`) | Finds companies that list that domain as their website |
| The main word of that domain, plus Norwegian spellings of it | `elkjop`, `elkjøp` (on `elkjop.no`) | Finds companies whose name matches the domain |
| An organisation number | `923609016` | Fetches the company's registry entry, roles, sub-units and accounts. The number comes from the page address or title (read on your device), from a search result, from a link in the extension, or from your recent lookups |
| Text you type in the search box | `equinor` | Searches the register by company name |

Never sent: the full page address (path and query string), the page
title, page content, cookies or login data, or any identifier for you
or your browser.

As with any web request, Brønnøysundregistrene's servers see your IP
address and standard browser request headers. Their own terms apply to
their API.

## What is stored on your device

None of this is synced or sent anywhere.

- **Lookup cache** (`storage.session`): register responses keyed by
  organisation number, and the lookup result for each site you
  looked up, including a company you picked or rejected for that
  site. It makes repeat visits instant and spares the API. Entries
  expire after 24 hours, and the whole cache is cleared when you close
  the browser.
- **Recent companies** (`storage.session`): the last 5 companies you
  viewed (name, organisation number and time), shown when the popup or
  sidebar has nothing else to show. Cleared when you close the
  browser.
- **One setting** (`storage.local`): on or off for «Auto-oppdater ved
  fane-bytte». Kept until you change it.

Removing the extension deletes all of it.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Read the address and title of the current tab when you click the toolbar button, the sidebar button or the right-click menu item. No access to page content. |
| `storage` | The cache, recent list and setting above. |
| `menus` (Firefox) / `contextMenus` (Chrome) | The «Vis i brreg-snap sidebar» right-click item. |
| `sidePanel` (Chrome only) | Show the details view in Chrome's side panel. |
| `https://data.brreg.no/*` | Talk to the register's API. The only site the extension connects to. |
| `tabs` (optional, off by default) | Requested only when you turn on «Auto-oppdater ved fane-bytte» and confirm the notice that says what it sends. It lets an open panel read the address and title of the page in front when you switch tabs or open a new page. Turning the setting off gives the permission back. On Firefox you can also remove it in `about:addons`; on Chrome, removing the extension removes it too. |

## Store declarations

- **Firefox** lists «browsing activity» as required data collection,
  because the domain of the site you look up is sent to
  Brønnøysundregistrene. It goes only to that public registry, never
  to the developer.
- **Chrome Web Store** lists the same data as «Web history».
  brreg-snap's use of information received from Chrome extension APIs
  adheres to the Chrome Web Store User Data Policy, including the
  Limited Use requirements. The data is used only to show you the
  company behind a site. It is not sold, not used for advertising or
  creditworthiness, and the developer never receives it.

## Source code

Open source under the MIT License at
[github.com/ikkeseb/brreg-snap](https://github.com/ikkeseb/brreg-snap).
No third-party code in the extension, no remote code, and a strict
Content Security Policy that only allows connections to
`data.brreg.no`.

## Contact

Email [sebastian@nuez.no](mailto:sebastian@nuez.no), or open an issue
at
[github.com/ikkeseb/brreg-snap/issues](https://github.com/ikkeseb/brreg-snap/issues).
