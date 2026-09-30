# AMO submission content

Source of truth for the metadata to paste into the AMO submission
form. Norwegian (`nb-NO`) is the primary locale since the audience
is Norwegian users; English (`en-US`) is provided as a secondary
fallback because AMO requires at least one English locale.

---

## Upload

The publish workflow uploads the assets of the GitHub Release for tag
`v<version>`, which CI builds from the tagged tree:
`brreg-snap-<version>.zip` (the package) and
`brreg-snap-source-<version>.zip` (the source for review), with the
release notes and reviewer notes from the version's submission kit. It
then tags `amo-submission-<version>` on the release commit with both
digests. Never a local build. The flow and the manual fallback:
`docs/release.md`.

## Add-on URL slug

`brreg-snap` (matches the extension name, repo name, and gecko ID).

## Categories

- **Firefox**: `Search Tools` — a company lookup in a public
  registry.
- **Firefox for Android**: not listed. The extension uses
  `sidebar_action`, which is desktop-only.

## License

MIT (matches `LICENSE` in the repo).

## Support contact

- **Email**: `sebastian@nuez.no`
- **Website**: `https://github.com/ikkeseb/brreg-snap`
- **Support site**: `https://github.com/ikkeseb/brreg-snap/issues`

## Privacy policy

AMO hosts its own copy of the policy text; it doesn't follow a URL.
The field keeps every newline and renders only a Markdown subset
(emphasis, links, code, lists): no headings, no tables. So it gets a
reflowed copy of `PRIVACY.md`, not the file itself: `pnpm release`
renders it into the version's submission kit (one line per paragraph,
headings as bold lines, tables as lists). Paste that on every
submission where `PRIVACY.md` changed.

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

<!-- SECTION: summary-nb -->
### Summary (kort beskrivelse, ≤ 250 tegn)

> Slå opp norske bedrifter i Brønnøysundregistrene med ett klikk. Henter status, daglig leder, styret, nøkkeltall og regnskap direkte fra data.brreg.no. Ingen content scripts, ingen tredjeparts-trackere.

(202 tegn — under grensen. NB: tidligere versjoner nevnte
«signaturrett» — den finnes ikke i det åpne API-et og vises ikke i
produktet; fjernet fra all listing-tekst 2026-07-05.)

<!-- SECTION: description-nb -->
### Description (nb — paste as is)

> Sjekk hvem som står bak en norsk nettbutikk eller nettside. brreg-snap slår opp bedriften i Brønnøysundregistrene og viser organisasjonsnummer, konkurs og andre registrerte varsler, styre og regnskap.
>
> • Se hvordan nettstedet er koblet til bedriften: registrert hjemmeside, et org.nr siden selv oppgir, eller et mulig navnetreff.
> • Se status, alder, ansatte og siste innleverte regnskap. Ingen varsler i registeret er ingen garanti for at en nettbutikk er trygg.
> • Åpne sidepanelet for roller, adresser, aktivitet, konsern, underenheter og lenker til årsregnskap og kunngjøringer.
> • Søk på navn eller org.nr, slå opp markert tekst med høyreklikk, eller bruk en hurtigtast.
> • Velg en annen bedrift ved feil treff, glem et tidligere valg, og kopier org.nr eller et sammendrag.
>
> Slå på «Auto-oppdater» hvis du vil at et åpent sidepanel skal følge fanen du ser på. Du får først en forklaring og en forespørsel om tilgang til faner. Slår du bryteren av, gis tilgangen tilbake.
>
> Personvern: Oppslag sendes bare til data.brreg.no, aldri til utvikleren. Utvidelsen sender nettstedets registrerbare domene, et organisasjonsnummer eller søketeksten du selv skriver eller velger å slå opp. Den har ingen content scripts og leser ikke nettsideinnhold automatisk. Ingen analytics, trackere eller telemetri. Velkomstsiden gjør ingen nettverkskall. «Rapporter feil treff» åpner e-postprogrammet ditt; du velger selv om meldingen sendes.
>
> Kildekode under MIT-lisens: https://github.com/ikkeseb/brreg-snap

---

## English listing (secondary — `en-US`)

<!-- SECTION: summary-en -->
### Summary (≤ 250 chars)

> Look up Norwegian companies in the public Brønnøysund Register with one click. Shows status, CEO, board, key figures, and accounts straight from data.brreg.no. No content scripts, no third-party trackers.

(206 chars — under the limit.)

<!-- SECTION: description-en -->
### Description (en)

> Check which company is behind a Norwegian shop or website. brreg-snap looks up the company in the Brønnøysund Register Centre and shows its organisation number, bankruptcy and other registry warnings, board and accounts.
>
> • See how the site relates to the company: a registered website, an organisation number claimed by the site, or a possible name match.
> • Check status, age, employees and the latest filed accounts. No registry warnings is not a guarantee that a shop is safe.
> • Open the side panel for roles, addresses, activities, company groups, sub-units and links to annual reports and announcements.
> • Search by name or organisation number, look up selected text from the right-click menu, or use a keyboard shortcut.
> • Choose another company after a wrong match, forget a previous choice, and copy an organisation number or summary.
>
> Turn on "Auto-oppdater" to let an open side panel follow your active tab. A short explanation and a request for tab access appear first. Turning it off gives the permission back.
>
> Privacy: Lookups go only to data.brreg.no, never to the developer. The extension sends the site's registrable domain, an organisation number or search text you type or choose to look up. It has no content scripts and does not read page content automatically. No analytics, trackers or telemetry. The welcome page makes no network requests. "Rapporter feil treff" opens your email app; you decide whether to send the message.
>
> Source code under the MIT licence: https://github.com/ikkeseb/brreg-snap

---

<!-- SECTION: permission-justifications -->
## Permission justifications

These are pasted into the "Notes for Reviewers" field. One line per
permission, explaining why each is necessary.

- **`activeTab`** — Reads the URL and title of the active tab only
  when the user clicks the toolbar icon, the sidebar icon, or a
  context-menu item, or uses a keyboard shortcut. Used to extract a 9-digit Norwegian
  organisation number, or to derive the site's registrable domain
  for a brreg search query. The permission does not grant DOM access
  or background tab access.

- **`storage`** — `storage.session` (in memory, cleared when the
  browser closes): brreg API responses and per-hostname lookup
  results, including the user's picker choice, each with a 24-hour
  TTL, plus the 5 most recently viewed companies. `storage.local`:
  one boolean, the auto-sync toggle. Nothing is synced to a remote
  account.

- **`menus`** — Registers right-click items for looking up the current
  page and selected text. Selected text is sent only when the user
  chooses that lookup, limited to 100 characters; if it contains an
  organisation number, only that number is sent. This permission is on
  Mozilla's no-prompt list
  and does not grant tab access by itself.

- **`host_permissions: https://data.brreg.no/*`** — The only
  external endpoint the extension contacts. This is the public
  API operated by the Norwegian Brønnøysund Register Centre. No
  other hosts are listed and the CSP's `connect-src` directive
  enforces this restriction at runtime.

- **`optional_permissions: tabs`** — Off at install time. The
  user opts in by switching on the "Auto-oppdater"
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

<!-- SECTION: reviewer-notes -->
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
> and a name label derived from it. Text typed in the search box or
> explicitly selected for a right-click lookup is sent as a search.
> Selected text is limited to 100 characters; if it contains an
> organisation number, only that number is sent. The manifest therefore declares
> `data_collection_permissions` with `required: ["browsingActivity"]`,
> which Firefox 140+ shows in the install and update prompts. IP
> addresses and reserved local names (localhost, single-label hosts,
> and TLDs such as .local, .lokal, .internal, .intern, .lan,
> .home.arpa, .priv) are never sent. Nothing goes to the developer or
> any other party.
>
> Lookups run when the user clicks the toolbar button, opens the
> sidebar, uses a keyboard shortcut or context-menu item, or searches,
> and, only if the
> user turns on "Auto-oppdater" and grants `tabs`, on
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
> Version 1.4 adds no permissions. Its new group-structure, recent-change
> and annual-report-year requests use the same host, data.brreg.no.
> Annual-report PDFs and announcements are ordinary user-clicked links.
> A welcome page opens once on installation, not on update; it makes no
> network requests. Schibsted Grotesk is bundled locally under the SIL
> Open Font License, included at fonts/OFL.txt. "Rapporter feil treff"
> is a mailto link that opens the user's email app and sends nothing
> automatically.
>
> The build uses Vite's default minifier (Oxc). Source maps are
> excluded from the package; the complete original source is the
> attached source zip (`git archive` of tag `v<version>`). Build
> instructions are in `BUILD.md` at the repo root — reproduction is
> `pnpm install --frozen-lockfile && pnpm package` with Node 24
> (`.node-version`; `engines` allows `^22.13 || ^24 || >=26`) and
> pnpm 10.33.0 (pinned via the `packageManager` field). The
> unzipped package matches the CI build attached to the GitHub
> Release for `v<version>`.
>
> The listing privacy policy matches `PRIVACY.md`.

## Screenshots

Upload the five `docs/screenshots/v1.4-*.png` files in numerical
order (1280×800, RGB PNG). What they show and how they were made:
`docs/screenshots/README.md`.

## Distribution choice

**Listed on AMO** — the only Firefox install channel. GitHub Releases
carry the unsigned CI build and the source zip for review; they are
not an install channel (release Firefox only installs AMO-signed
add-ons).
