# AMO submission content

Source of truth for the metadata to paste into the AMO submission
form. Norwegian (`nb-NO`) is the primary locale since the audience
is Norwegian users; English (`en-US`) is provided as a secondary
fallback because AMO requires at least one English locale.

---

## Upload

Upload only the assets of the GitHub Release for tag `v<version>`,
which CI builds from the tagged tree: `brreg-snap-<version>.zip` (the
package) and `brreg-snap-source-<version>.zip` (answer **Yes** to "Do
you need to submit source code?"). Never a local build.

Afterwards, record what went up as an annotated tag on the release
commit, carrying both digests:

```bash
gh release view v<version> --json assets --jq '.assets[] | [.name, .digest] | @tsv'
git tag -a amo-submission-<version> v<version>^{commit} \
  -m "AMO <version>: brreg-snap-<version>.zip sha256:… source sha256:…"
```

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

- **Email**: `sebastian@nuez.no` (decided 2026-07-04 — the one durable
  support address for AMO, CWS, and everything user-facing)
- **Website**: `https://github.com/ikkeseb/brreg-snap`
- **Support site**: `https://github.com/ikkeseb/brreg-snap/issues`

## Privacy policy

AMO hosts its own copy of the policy text; it doesn't follow a URL.
Paste the full contents of `PRIVACY.md` into the listing's privacy
policy field on every submission where `PRIVACY.md` changed. AMO
renders its Markdown.

## Data collection

Not a form field: AMO and Firefox read it from the manifest
(`browser_specific_settings.gecko.data_collection_permissions`). It is
`required: ["browsingActivity"]`, because the domain of the site the
user looks up is sent to data.brreg.no. Firefox 140+ shows it in the
install prompt, and existing users get an update prompt («New required
data collection») the first time a version adds it. Why required, not
optional: `docs/notes/permissions-model.md`
§ data-collection-declaration. Firefox 115–139 ignore the key; the
notes for reviewers below say how consent works there.

---

## Norwegian listing (primary — `nb-NO`)

### Summary (kort beskrivelse, ≤ 250 tegn)

> Slå opp norske bedrifter i Brønnøysundregistrene med ett klikk. Henter status, daglig leder, styret, nøkkeltall og regnskap direkte fra data.brreg.no. Ingen content scripts, ingen tredjeparts-trackere.

(202 tegn — under grensen. NB: tidligere versjoner nevnte
«signaturrett» — den finnes ikke i det åpne API-et og vises ikke i
produktet; fjernet fra all listing-tekst 2026-07-05.)

### Description (lang beskrivelse, markdown OK)

> **brreg-snap** henter bedriftsinfo fra Brønnøysundregistrene rett
> i nettleseren. Klikk på verktøylinje-ikonet mens du er på et norsk
> bedriftsnettsted, så får du opp:
>
> - Firmanavn, organisasjonsnummer og status
> - Forretningsadresse og postadresse
> - Næringskode og antall ansatte
> - Daglig leder, styret, revisor og regnskapsfører
> - Siste innleverte regnskap med nøkkeltall
> - Eventuelle underenheter (avdelinger) og overordnet enhet
>
> **Sidebar-panel** gir samme informasjon med dypere oppslag. Slå
> på "Auto-oppdater ved fane-bytte" for å la sidebaren slå opp siden
> du ser på hver gang du bytter fane eller åpner en ny side, så lenge
> den er åpen.
>
> **Smart oppslag**: Utvidelsen finner organisasjonsnummeret enten
> direkte i adressen eller sidetittelen, eller ved å søke i brreg på
> domenet til nettstedet. Hvis flere bedrifter er kandidater, viser
> utvidelsen en "Mente du …?"-velger framfor å gjette. Hvis
> ingenting matcher, kan du søke manuelt.
>
> **Sikkerhet og personvern**:
>
> - For å finne bedriften sendes domenet til nettstedet du slår opp
>   (for eksempel `dnb.no` for `nettbank.dnb.no`; underdomener sendes
>   ikke), eller et organisasjonsnummer fra adressen eller
>   sidetittelen, til `data.brreg.no` — aldri til utvikleren eller
>   andre.
> - Ingen content scripts. Utvidelsen leser ikke innholdet på
>   nettsidene du besøker.
> - Eneste eksterne tjeneste er `data.brreg.no` —
>   Brønnøysundregistrenes åpne API.
> - Ingen analytics, ingen tredjeparts-trackere, ingen telemetri.
> - Null runtime-avhengigheter i den bygde utvidelsen.
> - Auto-oppdater slår opp siden du ser på hver gang du bytter fane
>   eller åpner en ny side, så lenge et brreg-snap-panel er åpent.
>   Den krever `tabs`-tilgang, som utvidelsen ber om først når du
>   slår den på, etter en kort forklaring av hva som sendes. Slå den
>   av, eller trekk tilgangen tilbake i `about:addons`, når som helst.
>
> Kildekoden er åpen under MIT-lisens på
> [github.com/ikkeseb/brreg-snap](https://github.com/ikkeseb/brreg-snap).

---

## English listing (secondary — `en-US`)

### Summary (≤ 250 chars)

> Look up Norwegian companies in the public Brønnøysund Register with one click. Shows status, CEO, board, key figures, and accounts straight from data.brreg.no. No content scripts, no third-party trackers.

(206 chars — under the limit.)

### Description

> **brreg-snap** surfaces Norwegian company information from the
> Brønnøysund Register Centre directly in your browser. Click the
> toolbar icon while visiting a Norwegian business website to get:
>
> - Company name, organisation number, and status flags
> - Business and postal address
> - Industry code and employee count
> - CEO, board members, auditor, and accountant
> - Latest filed accounts with key figures
> - Sub-units (underenheter) and parent unit, where registered
>
> A **sidebar panel** shows the same data in a deeper layout.
> Enable "Auto-oppdater ved fane-bytte" to have the sidebar look up
> the page you are on every time you switch tabs or open a new page,
> while it is open.
>
> **Smart resolution**: the extension finds the organisation number
> either directly in the page address or title, or by searching
> brreg for the site's domain. When several companies are plausible
> candidates, it shows a "Did you mean …?" picker rather than
> guessing. When nothing matches, you can search manually.
>
> **Security and privacy**:
>
> - To find the company, the domain of the site you look up (for
>   example `dnb.no` for `nettbank.dnb.no`; subdomains are not sent),
>   or an organisation number from the page address or title, is sent
>   to `data.brreg.no` — never to the developer or anyone else.
> - No content scripts. The extension never reads the DOM or text
>   of pages you visit.
> - The only external service contacted is `data.brreg.no` — the
>   public API operated by Brønnøysundregistrene.
> - No analytics, no third-party trackers, no telemetry.
> - Zero runtime dependencies in the shipped bundle.
> - Auto-sync looks up the page you are on every time you switch
>   tabs or open a new page, as long as a brreg-snap panel is open.
>   It needs the `tabs` permission, which the extension only asks
>   for when you turn it on, after a short note on what is sent.
>   Turn it off, or revoke the permission in `about:addons`, at any
>   time.
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
  organisation number, or to derive the site's registrable domain
  for a brreg search query. The permission does not grant DOM access
  or background tab access.

- **`storage`** — `storage.session` (in memory, cleared when the
  browser closes): brreg API responses and per-hostname lookup
  results, including the user's picker choice, each with a 24-hour
  TTL, plus the 5 most recently viewed companies. `storage.local`:
  one boolean, the auto-sync toggle. Nothing is synced to a remote
  account.

- **`menus`** — Registers a single right-click menu item ("Vis i
  brreg-snap sidebar") on web pages that opens the sidebar panel and
  triggers a lookup. This permission is on Mozilla's no-prompt list
  and does not grant tab access by itself.

- **`host_permissions: https://data.brreg.no/*`** — The only
  external endpoint the extension contacts. This is the public
  API operated by the Norwegian Brønnøysund Register Centre. No
  other hosts are listed and the CSP's `connect-src` directive
  enforces this restriction at runtime.

- **`optional_permissions: tabs`** — Off at install time. The
  user opts in by switching on the "Auto-oppdater ved fane-bytte"
  toggle in the sidebar header. That first shows an inline
  disclosure: every tab switch or new page is looked up while a
  brreg-snap panel is open, the domain goes to data.brreg.no, and
  nothing goes to the developer. Its «Slå på» button then calls
  `permissions.request`, which shows Firefox's standard runtime
  permission prompt. When granted, each open sidebar listens to
  `tabs.onActivated` and `tabs.onUpdated` for its own window, and
  only while it is open, to re-resolve the organisation number when
  the user switches tabs or opens a new page. It reads only
  `tab.url` and `tab.title` on these events and sends only the
  queries described under data collection below. The toggle calls
  `permissions.remove` when switched off; the permission can also be
  revoked from `about:addons` at any time.

## Notes for reviewers

> This add-on is a popup and sidebar company lookup tool for
> Norwegian users. It has no content scripts and only contacts
> `data.brreg.no`, the public API of the Norwegian Brønnøysund
> Register Centre.
>
> Data collection: to find the company behind the current site, the
> add-on sends data.brreg.no an organisation number found in the page
> address or title or, if there is none, the site's registrable
> domain (`dnb.no` for `nettbank.dnb.no`; subdomains are not sent)
> and a name label derived from it. Text the user types into the
> search box is sent as a search. The manifest therefore declares
> `data_collection_permissions` with `required: ["browsingActivity"]`,
> which Firefox 140+ shows in the install and update prompts. IP
> addresses and reserved local names (localhost, single-label hosts,
> and TLDs such as .local, .lokal, .internal, .intern, .lan,
> .home.arpa, .priv) are never sent. Nothing goes to the developer or
> any other party.
>
> Lookups run when the user clicks the toolbar button, opens the
> sidebar, uses the context-menu item or searches, and, only if the
> user turns on "Auto-oppdater ved fane-bytte" and grants `tabs`, on
> every tab switch or new page while a brreg-snap sidebar is open.
>
> Firefox 115–139 ignore the manifest declaration. There, each click
> lookup is a direct, immediate result of a single deliberate user
> command on a clearly labelled control, and this listing says what
> is sent (implicit consent under the add-on policies). Auto-sync is
> the only lookup not tied to a click: before it asks for `tabs`, the
> sidebar shows its own disclosure of what is sent and to whom, and
> its «Slå på» button is the explicit consent.
>
> The build uses esbuild minification through Vite. Source maps are
> excluded from the package; the complete original source is the
> attached source zip (`git archive` of tag `v<version>`). Build
> instructions are in `BUILD.md` at the repo root — reproduction is
> `pnpm install --frozen-lockfile && pnpm package` with Node ≥ 18
> and pnpm 10.33.0 (pinned via the `packageManager` field). The
> unzipped package matches the CI build attached to the GitHub
> Release for `v<version>`.
>
> The privacy policy is the one on this listing (same text as
> `PRIVACY.md` in the repository).
>
> The `tabs` permission is listed as `optional_permissions` and is
> requested at runtime only from the «Slå på» button of the
> auto-sync disclosure in the sidebar. On Firefox 140+ the install
> prompt therefore shows only access to data.brreg.no and the
> browsing-activity data collection.

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
   the Enheter (sub-units) tab listing TELENOR ASA's three
   registered sub-units. Demonstrates that the extension has two
   surfaces and surfaces deeper data on the sidebar.
3. **`docs/screenshots/03-popup-only.png`** —
   popup over `tomra.com` showing TOMRA SYSTEMS ASA. Demonstrates
   the lightweight one-click flow without opening the sidebar.

All three are 2562×1602 (2× retina capture of 1281×801, 1.6:1
aspect ratio — AMO's recommended display ratio). PNG.

## Distribution choice

**Listed on AMO** — the only Firefox install channel. GitHub Releases
carry the unsigned CI build and the source zip for review; they are
not an install channel (release Firefox only installs AMO-signed
add-ons).
