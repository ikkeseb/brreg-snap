# AMO submission content

Source of truth for the metadata to paste into the AMO submission
form. Norwegian (`nb-NO`) is the primary locale since the audience
is Norwegian users; English (`en-US`) is provided as a secondary
fallback because AMO requires at least one English locale.

---

## Add-on URL slug

`brreg-snap` (matches the extension name, repo name, and gecko ID).

## Categories

- **Firefox**: `Search Tools` (primary) — the extension exists to
  look up companies in a public registry, which is fundamentally a
  search/lookup workflow. Secondary candidate: `Other` or
  `Privacy & Security` if we want to lean on the no-tracking angle.
- **Firefox for Android**: not applicable. The extension uses
  `sidebar_action`, which is desktop-only. We will not list for
  Android.

## License

MIT (matches `LICENSE` in the repo).

## Support contact

- **Email**: _to be filled by Seb at submission time._
- **Website**: `https://github.com/ikkeseb/brreg-snap`
- **Support site**: `https://github.com/ikkeseb/brreg-snap/issues`

## Privacy policy

URL: `https://github.com/ikkeseb/brreg-snap/blob/main/PRIVACY.md`

(Inline alternative: paste the contents of `PRIVACY.md` directly
into the AMO listing's privacy field.)

---

## Norwegian listing (primary — `nb-NO`)

### Summary (kort beskrivelse, ≤ 250 tegn)

> Slå opp norske bedrifter i Brønnøysundregistrene med ett klikk. Henter daglig leder, styremedlemmer, signaturrett, nøkkeltall og regnskap direkte fra data.brreg.no. Ingen content scripts, ingen tredjeparts-trackere.

(238 tegn — under grensen.)

### Description (lang beskrivelse, markdown OK)

> **brreg-snap** henter bedriftsinfo fra Brønnøysundregistrene rett
> i nettleseren. Klikk på verktøylinje-ikonet mens du er på et norsk
> bedriftsnettsted, så får du opp:
>
> - Firmanavn, organisasjonsnummer og status
> - Forretningsadresse og postadresse
> - Næringskode og antall ansatte
> - Daglig leder, styremedlemmer og signaturrett
> - Siste innleverte regnskap med nøkkeltall
> - Eventuelle underenheter og morselskap
>
> **Sidebar-panel** gir samme informasjon med dypere oppslag. Slå
> på "Auto-oppdater ved fane-bytte" for å la sidebaren oppdatere
> seg automatisk når du bytter fane.
>
> **Smart oppslag**: Utvidelsen finner organisasjonsnummeret enten
> direkte fra URL-en, eller ved å søke i brreg på hostname og
> sidetittel. Hvis flere bedrifter er kandidater, viser sidebaren
> en "Mente du …?"-velger framfor å gjette. Hvis ingenting matcher,
> kan du søke manuelt.
>
> **Sikkerhet og personvern**:
>
> - Ingen content scripts. Utvidelsen leser ikke innholdet på
>   nettsidene du besøker.
> - Eneste eksterne tjeneste er `data.brreg.no` — Brønnøysund­
>   registrenes åpne API.
> - Ingen analytics, ingen tredjeparts-trackere, ingen telemetri.
> - Null runtime-avhengigheter i den bygde utvidelsen.
> - Auto-oppdater-funksjonen krever `tabs`-tilgang som utvidelsen
>   ber om kun ved første aktivering — du kan trekke den tilbake
>   når som helst fra `about:addons`.
>
> Kildekoden er åpen under MIT-lisens på
> [github.com/ikkeseb/brreg-snap](https://github.com/ikkeseb/brreg-snap).

---

## English listing (secondary — `en-US`)

### Summary (≤ 250 chars)

> Look up Norwegian companies in the public Brønnøysund Register with one click. Shows CEO, board members, signatory rights, key figures, and accounts straight from data.brreg.no. No content scripts, no third-party trackers.

(241 chars — under the limit.)

### Description

> **brreg-snap** surfaces Norwegian company information from the
> Brønnøysund Register Centre directly in your browser. Click the
> toolbar icon while visiting a Norwegian business website to get:
>
> - Company name, organisation number, and status flags
> - Business and postal address
> - Industry code and employee count
> - CEO, board members, and signatory rights
> - Latest filed accounts with key figures
> - Subsidiaries and parent entity, where applicable
>
> A **sidebar panel** shows the same data in a deeper layout.
> Enable "Auto-oppdater ved fane-bytte" to have the sidebar
> re-resolve automatically as you switch tabs.
>
> **Smart resolution**: the extension finds the organisation number
> either directly from the URL, or by querying brreg with the
> hostname and page title. When several companies are plausible
> candidates, the sidebar surfaces a "Did you mean …?" picker
> rather than guessing. When nothing matches, you can search
> manually.
>
> **Security and privacy**:
>
> - No content scripts. The extension never reads the DOM or text
>   of pages you visit.
> - The only external service contacted is `data.brreg.no` — the
>   public API operated by Brønnøysundregistrene.
> - No analytics, no third-party trackers, no telemetry.
> - Zero runtime dependencies in the shipped bundle.
> - The auto-sync feature requires the `tabs` permission, which
>   the extension only requests when you first toggle it on. You
>   can revoke it at any time from `about:addons`.
>
> Source code under MIT licence at
> [github.com/ikkeseb/brreg-snap](https://github.com/ikkeseb/brreg-snap).

---

## Permission justifications

These are pasted into the "Notes for Reviewers" field. One line per
permission, explaining why each is necessary.

- **`activeTab`** — Reads the URL and title of the active tab only
  when the user clicks the toolbar icon, the sidebar icon, or a
  context-menu item. Used to extract a 9-digit Norwegian
  organisation number, or to derive a hostname for a brreg search
  query. The permission does not grant DOM access or background
  tab access.

- **`storage`** — Caches brreg API responses in `storage.session`
  (24-hour TTL, cleared at end-of-session) and persists a single
  boolean (the auto-sync toggle state) in `storage.local`. No data
  is synced to a remote account.

- **`menus`** — Registers a single right-click menu item ("Vis i
  brreg-snap sidebar") on http(s) pages that opens the sidebar
  panel and triggers a lookup. This permission is on Mozilla's
  no-prompt list and does not grant tab snooping by itself.

- **`host_permissions: https://data.brreg.no/*`** — The only
  external endpoint the extension contacts. This is the public
  API operated by the Norwegian Brønnøysund Register Centre. No
  other hosts are listed and the CSP's `connect-src` directive
  enforces this restriction at runtime.

- **`optional_permissions: tabs`** — Off at install time. The
  user must opt in by flipping the "Auto-oppdater ved fane-bytte"
  toggle in the sidebar header, which triggers Firefox's standard
  runtime permission prompt. When granted, the extension uses
  `tabs.onActivated` and `tabs.onUpdated` to re-resolve the
  organisation number as the user switches tabs. The extension
  reads only `tab.url` and `tab.title` on these events and does
  not store or transmit tab data beyond what's already documented
  for `activeTab`. The toggle calls `permissions.remove` when
  switched off; the permission can also be revoked from
  `about:addons` at any time.

## Notes for reviewers

> This add-on is a popup-only / sidebar-only company lookup tool
> for Norwegian users. It has no content scripts and only contacts
> `data.brreg.no`, the public API of the Norwegian Brønnøysund
> Register Centre.
>
> The build uses esbuild minification through Vite. Source maps
> are included in the package for every JS bundle, and the
> complete original source has been submitted alongside the
> `.xpi`. Build instructions are in `BUILD.md` at the repo root
> — reproduction is `pnpm install --frozen-lockfile && pnpm package`
> with Node ≥ 18 and pnpm 10.33.0 (pinned via the `packageManager`
> field).
>
> The privacy policy is at
> `https://github.com/ikkeseb/brreg-snap/blob/main/PRIVACY.md`.
>
> The `tabs` permission is listed as `optional_permissions` and is
> requested at runtime only when the user enables the "Auto-oppdater
> ved fane-bytte" toggle in the sidebar. The install-time
> permission dialogue therefore shows only `activeTab`, storage,
> and the `data.brreg.no` host.

## Screenshots

Upload in this order — AMO displays them in the listing in the
order they're uploaded, and the story should go from "what is
this" → "depth available" → "lightweight use".

1. **`docs/screenshots/01-sidebar-overview.png`** —
   sidebar open on `orkla.com`, showing ORKLA ASA's overview tab
   (organisation form, registration date, NACE code, employee
   count, CEO, addresses). Demonstrates the core lookup.
2. **`docs/screenshots/02-popup-and-sidebar.png`** —
   `telenor.no` with both popup and sidebar visible. Sidebar is on
   the Enheter (subsidiaries) tab listing TELENOR ASA's three
   registered sub-units. Demonstrates that the extension has two
   surfaces and surfaces deeper data on the sidebar.
3. **`docs/screenshots/03-popup-only.png`** —
   popup over `tomra.com` showing TOMRA SYSTEMS ASA. Demonstrates
   the lightweight one-click flow without opening the sidebar.

All three are 2562×1602 (2× retina capture of 1281×801, 1.6:1
aspect ratio — AMO's recommended display ratio). PNG.

## Distribution choice

**Listed on AMO.** Self-distribution remains available via the
GitHub release page as a backup.
