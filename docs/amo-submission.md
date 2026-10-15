# AMO submission content

Source of truth for the AMO listing and submission metadata. The
publish workflow sends the reviewer notes with every version and,
when asked, the listing text, categories and privacy policy
(`docs/release.md`); the rest is entered by hand. Norwegian (`nb-NO`)
is the primary locale since the audience is Norwegian users; English
(`en-US`) is provided as a secondary fallback because AMO requires at
least one English locale.

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

`brreg-snap` (matches the repo name and gecko ID).

## Categories

<!-- SECTION: categories -->
### Firefox (slugs, one per line; the listing sync sends them)

> search-tools
> privacy-security

`Search Tools`: a company lookup in a public registry. `Privacy &
Security`: it checks who is behind a site. At most 3; `other` only
alone. Slugs: <https://mozilla.github.io/addons-server/topics/api/categories.html>.

### Firefox for Android

Not listed. The extension uses `sidebar_action`, which is
desktop-only.

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
headings as bold lines, tables as lists). The listing sync sends it
under `nb-NO`, the add-on's default locale.

## Data collection

Not a form field: AMO and Firefox read it from the manifest
(`browser_specific_settings.gecko.data_collection_permissions`). It is
`required: ["browsingActivity", "websiteContent"]`, because the domain
of the site the user looks up, and text the user selects and chooses
to look up, are sent to data.brreg.no. Firefox 140+ shows it in the
install prompt, and existing users get an update prompt («New required
data collection») the first time a version adds a type (1.6.1 adds
`websiteContent`). Why required, not
optional: `docs/notes/permissions-model.md`
§ data-collection-declaration. Firefox 115–139 ignore the key; the
notes for reviewers below say how consent works there.

---

## Norwegian listing (primary — `nb-NO`)

<!-- SECTION: summary-nb -->
### Summary (kort beskrivelse, ≤ 250 tegn)

> Orgnr, status, daglig leder, styre, omsetning, resultat og regnskap for bedriften bak nettsiden eller nettbutikken du er på, rett fra Brønnøysundregistrene (data.brreg.no). Ett klikk, ingen konto, ingen sporing.

<!-- SECTION: description-nb -->
### Description (nb — paste as is)

> Brønnøysundregistrene, rett fra nettsiden du er på. Ett klikk slår opp bedriften bak siden: organisasjonsnummer, status og det viktigste fra registeret.
>
> • Se hvordan siden henger sammen med bedriften: registrert hjemmeside, et organisasjonsnummer siden selv oppgir, eller bare et navnetreff.
> • Sidepanelet går dypere: roller, adresser, næring og formål, konsern og underenheter, nøkkeltall som omsetning og resultat over flere år der de åpne dataene har dem, og lenker til årsregnskap og kunngjøringer.
> • Varsler i registeret, som konkurs, avvikling eller manglende regnskap, vises tydelig. Ingen varsler er likevel ingen garanti.
> • Søk på navn eller organisasjonsnummer, slå opp markert tekst med høyreklikk, eller bruk en hurtigtast.
> • Velg en annen bedrift ved feil treff, og kopier organisasjonsnummeret eller et sammendrag.
>
> Med «Auto-oppdater» følger et åpent sidepanel fanen du ser på. Du får først en forklaring, deretter spør nettleseren om tilgang til faner. Slår du det av, gis tilgangen tilbake.
>
> Personvern: Oppslag sendes bare til data.brreg.no, aldri til utvikleren. Utvidelsen sender nettstedets registrerbare domene, et organisasjonsnummer eller søketeksten du selv skriver eller velger å slå opp. Den har ingen content scripts og leser ikke nettsideinnhold automatisk. Ingen analytics, trackere eller telemetri. Velkomstsiden gjør ingen nettverkskall. «Rapporter feil treff» åpner e-postprogrammet ditt; du velger selv om meldingen sendes.
>
> brreg-snap er et uavhengig prosjekt, ikke tilknyttet Brønnøysundregistrene, og bruker åpne data fra data.brreg.no.
>
> Kildekode under MIT-lisens: https://github.com/ikkeseb/brreg-snap

---

## English listing (secondary — `en-US`)

<!-- SECTION: summary-en -->
### Summary (≤ 250 chars)

> Organisation number (orgnr), status, CEO, board, revenue, results and accounts for the company behind the site or online shop you are on, straight from the Brønnøysund Register Centre (data.brreg.no). One click, no account, no tracking.

<!-- SECTION: description-en -->
### Description (en)

> Norway's company register, right from the site you are on. One click looks up the company behind the page in the Brønnøysund Register Centre and shows its organisation number, its status and the essentials from the register.
>
> • See how the site connects to the company: its registered website, an organisation number stated on the site, or only a name match.
> • The side panel goes deeper: roles, addresses, industry and purpose, group structure and sub-units, key figures such as revenue and profit over several years where the open data has them, and links to annual accounts and announcements.
> • Registry warnings stand out, such as bankruptcy, liquidation or overdue accounts. A clean record is still no guarantee.
> • Search by name or organisation number, look up selected text from the right-click menu, or use a keyboard shortcut.
> • Pick another company after a wrong match and copy the organisation number or a summary.
>
> With "Auto-oppdater" on, an open side panel follows your active tab. A short explanation comes first, then the browser asks for tab access. Turning it off gives the permission back.
>
> Privacy: Lookups go only to data.brreg.no, never to the developer. The extension sends the site's registrable domain, an organisation number or search text you type or choose to look up. It has no content scripts and does not read page content automatically. No analytics, trackers or telemetry. The welcome page makes no network requests. "Rapporter feil treff" opens your email app; you decide whether to send the message.
>
> brreg-snap is an independent project, not affiliated with the Brønnøysund Register Centre, and uses open data from data.brreg.no.
>
> Source code under the MIT licence: https://github.com/ikkeseb/brreg-snap

---

<!-- SECTION: permission-justifications -->
## Permission justifications

Why each permission is necessary, one line each: the reference when
a reviewer asks. The notes for reviewers below carry the short form.

- **`activeTab`** — Reads the URL and title of the active tab only
  when the user clicks the toolbar icon, the sidebar icon, or a
  context-menu item, or uses a keyboard shortcut. Used to extract a
  9-digit Norwegian organisation number, or to derive the site's
  registrable domain for a brreg search query. The permission does
  not grant DOM access or background tab access.

- **`storage`** — `storage.session` (in memory, cleared when the
  browser closes): brreg API responses and per-hostname lookup
  results, including the user's picker choice, each with a 24-hour
  TTL, plus the 5 most recently viewed companies. `storage.local`:
  one boolean, the "Auto-oppdater" setting. Nothing is synced to a
  remote account.

- **`menus`** — Registers right-click items for looking up the current
  page and selected text. Selected text is sent only when the user
  chooses that lookup, limited to 100 characters; if it contains
  exactly one valid organisation number, only that number is sent.
  This permission is on Mozilla's no-prompt list and does not grant
  tab access by itself.

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

> A popup and sidebar company lookup for Norwegian users. No content
> scripts; the only host it contacts is `data.brreg.no`, the public
> API of the Norwegian Brønnøysund Register Centre.
>
> Data collection: to find the company behind the current site, the
> add-on sends data.brreg.no an organisation number found in the page
> address or title or, if there is none, the site's registrable
> domain (`dnb.no` for `nettbank.dnb.no`; subdomains are not sent,
> except a site's own name on some known hosting platforms, such as
> `firma.github.io`) and a name label derived from it. Search-box
> text and text explicitly selected for a right-click lookup are sent
> as a search (a selection: at most 100 characters, and only the
> number when it holds exactly one valid organisation number). Hence
> `data_collection_permissions` `required: ["browsingActivity",
> "websiteContent"]` (the selected text is website content), which
> Firefox 140+ shows in the install and update prompts. IP
> addresses and reserved local names (localhost, single-label hosts,
> .local, .lokal, .internal, .intern, .lan, .home.arpa, .priv) are
> never sent. Nothing goes to the developer or any other party.
>
> Lookups run on a click of the toolbar button, the sidebar, a
> keyboard shortcut, a context-menu item or a search, and, only if the
> user turns on "Auto-oppdater" and grants `tabs`, on every tab switch
> or new page while a brreg-snap sidebar is open.
>
> Firefox 115–139 ignore the declaration. There, each click lookup is
> the direct result of one deliberate command on a clearly labelled
> control, and the listing says what is sent (implicit consent under
> the add-on policies). "Auto-oppdater" first shows its own disclosure
> of what is sent and to whom; its «Slå på» button is the explicit
> consent.
>
> No API or host permission added since 1.1.0. The data collection
> declaration changed in 1.3.1 (from `none` to `browsingActivity`) and
> in 1.6.1 (adds `websiteContent` for the selection lookup's text,
> which was already sent; no new data flow).
> Annual-report PDFs and announcements are ordinary user-clicked
> links. A welcome page opens once on install, not on update, and
> makes no network requests. Schibsted Grotesk is bundled locally (SIL
> Open Font License, fonts/OFL.txt). "Rapporter feil treff" is a
> mailto link and sends nothing itself.
>
> To test: open https://www.dnb.no and click the toolbar button (the
> popup shows DNB BANK ASA), then open the sidebar; "Auto-oppdater" in
> its header asks for `tabs`.
>
> Build: Vite's default minifier (Oxc); no source maps in the package.
> The attached source zip is `git archive` of tag `v<version>`;
> instructions in `BUILD.md` at the repo root. Reproduce with
> `pnpm install --frozen-lockfile && pnpm package` on Node 24
> (`.node-version`) and pnpm 12.10.1 (`packageManager`). The unzipped
> package matches the CI build attached to the GitHub Release for
> `v<version>`.
>
> The listing privacy policy matches `PRIVACY.md`.

## Screenshots

Upload the five `docs/screenshots/0*.png` files in numerical
order (1280×800, RGB PNG). What they show and how they were made:
`docs/screenshots/README.md`.

## Distribution choice

**Listed on AMO** — the only Firefox install channel. GitHub Releases
carry the unsigned CI build and the source zip for review; they are
not an install channel (release Firefox only installs AMO-signed
add-ons).
