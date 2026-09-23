# AMO submission kit — brreg-snap 1.3.1

Copy-paste kit for uploading 1.3.1 to addons.mozilla.org. Everything
below is EXACT text for the form fields — sourced from
`docs/amo-submission.md` and `CHANGELOG.md` § [1.3.1] (those stay
canonical). This is a correctness + privacy patch: wrong data shown
for several company types, an auto-sync privacy bug, and Firefox's
new `browsingActivity` data-collection declaration (Firefox 140+
shows a one-time consent prompt).

## Upload recipe

1. Get the artifacts — ONLY from the GitHub Release for tag `v1.3.1`
   (built by `.github/workflows/release.yml` from the tagged tree).
   Never a local build. Firefox needs `brreg-snap-1.3.1.zip` and
   `brreg-snap-source-1.3.1.zip` (the Chrome zip is not used here).
2. <https://addons.mozilla.org/developers/> → My Add-ons →
   **brreg-snap** → Upload New Version → upload `brreg-snap-1.3.1.zip`
   (Firefox desktop only; no Android listing).
3. When asked "Do you need to submit source code?" answer **Yes** and
   upload `brreg-snap-source-1.3.1.zip`. Build instructions are in
   `BUILD.md` at the repo root.
4. Paste **Release notes** (nb-NO primary, en-US fallback) from §
   Release notes below.
5. Paste **Notes for reviewers** from § Notes for reviewers below.
6. **Update the listing text** — CHANGELOG's 1.3.1 Privacy section
   says "PRIVACY.md and both store listings rewritten against the
   code." Replace Summary and Description in BOTH locales with §
   Listing text below.
7. **Privacy policy field** — replace the pasted text with the full
   contents of `PRIVACY.md` (paste the whole file; AMO hosts its own
   copy and renders Markdown).
8. Submit.
9. Record what was submitted:
   ```bash
   gh release view v1.3.1 --json assets --jq '.assets[] | [.name, .digest] | @tsv'
   git tag -a amo-submission-1.3.1 v1.3.1 -m "xpi sha256:<…> source sha256:<…>"
   git push origin amo-submission-1.3.1
   ```

## Release notes (nb-NO — primary)

```
Retter feil data: styremedlemmer som har gått av vises ikke lenger
som aktive i styret. Regnskap i utenlandsk valuta (USD, EUR) viser
riktig valuta i stedet for automatisk «kr». Banker og
forsikringsselskaper får igjen et regnskapstall i vurderingsstripen.
Selskaper med 1–4 ansatte viser «1–4» i stedet for «Ingen».

Rettet en personvernfeil: auto-oppdater fulgte fanebytter selv når
sidebaren var lukket — nå slår den bare opp mens en sidebar er åpen.

Fra og med Firefox 140 spør nettleseren deg én gang om å godta at
utvidelsen sender domenet til siden du besøker til
Brønnøysundregistrene (data.brreg.no) — aldri til utvikleren.
```

## Release notes (en-US — fallback)

```
Fixes wrong data: board members who have resigned no longer show as
active. Accounts filed in foreign currency (USD, EUR) now show the
correct currency instead of defaulting to Norwegian kroner. Banks
and insurers get a filing figure back in the verdict strip.
Companies with 1–4 employees show "1–4" instead of "None".

Also fixes a privacy bug: auto-sync kept following tab switches even
when the sidebar was closed — it now only looks up while a sidebar
is open.

Starting with Firefox 140, the browser will ask you once to accept
that the add-on sends the domain of the site you're visiting to the
Brønnøysund Register Centre (data.brreg.no) — never to the
developer.
```

## Notes for reviewers

```
This add-on is a popup and sidebar company lookup tool for
Norwegian users. It has no content scripts and only contacts
data.brreg.no, the public API of the Norwegian Brønnøysund
Register Centre.

Data collection: to find the company behind the current site, the
add-on sends data.brreg.no an organisation number found in the page
address or title or, if there is none, the site's registrable
domain (dnb.no for nettbank.dnb.no; subdomains are not sent) and a
name label derived from it. Text the user types into the search box
is sent as a search. The manifest therefore declares
data_collection_permissions with required: ["browsingActivity"],
which Firefox 140+ shows in the install and update prompts. IP
addresses and reserved local names (localhost, single-label hosts,
and TLDs such as .local, .lokal, .internal, .intern, .lan,
.home.arpa, .priv) are never sent. Nothing goes to the developer or
any other party.

Lookups run when the user clicks the toolbar button, opens the
sidebar, uses the context-menu item or searches, and, only if the
user turns on "Auto-oppdater ved fane-bytte" and grants tabs, on
every tab switch or new page while a brreg-snap sidebar is open.

Firefox 115–139 ignore the manifest declaration. There, each click
lookup is a direct, immediate result of a single deliberate user
command on a clearly labelled control, and this listing says what
is sent (implicit consent under the add-on policies). Auto-sync is
the only lookup not tied to a click: before it asks for tabs, the
sidebar shows its own disclosure of what is sent and to whom, and
its «Slå på» button is the explicit consent.

The build uses esbuild minification through Vite. Source maps are
excluded from the package; the complete original source is the
attached source zip (git archive of tag v1.3.1). Build instructions
are in BUILD.md at the repo root — reproduction is
pnpm install --frozen-lockfile && pnpm package with Node >= 18
and pnpm 10.33.0 (pinned via the packageManager field). The
unzipped package matches the CI build attached to the GitHub
Release for v1.3.1.

The privacy policy is the one on this listing (same text as
PRIVACY.md in the repository).

The tabs permission is listed as optional_permissions and is
requested at runtime only from the «Slå på» button of the
auto-sync disclosure in the sidebar. On Firefox 140+ the install
prompt therefore shows only access to data.brreg.no and the
browsing-activity data collection.
```

## Listing text (update BOTH locales — see recipe step 6)

### Summary nb-NO (≤ 250 tegn)

```
Slå opp norske bedrifter i Brønnøysundregistrene med ett klikk. Henter status, daglig leder, styret, nøkkeltall og regnskap direkte fra data.brreg.no. Ingen content scripts, ingen tredjeparts-trackere.
```

### Description nb-NO

```
**brreg-snap** henter bedriftsinfo fra Brønnøysundregistrene rett
i nettleseren. Klikk på verktøylinje-ikonet mens du er på et norsk
bedriftsnettsted, så får du opp:

- Firmanavn, organisasjonsnummer og status
- Forretningsadresse og postadresse
- Næringskode og antall ansatte
- Daglig leder, styret, revisor og regnskapsfører
- Siste innleverte regnskap med nøkkeltall
- Eventuelle underenheter (avdelinger) og overordnet enhet

**Sidebar-panel** gir samme informasjon med dypere oppslag. Slå
på "Auto-oppdater ved fane-bytte" for å la sidebaren slå opp siden
du ser på hver gang du bytter fane eller åpner en ny side, så lenge
den er åpen.

**Smart oppslag**: Utvidelsen finner organisasjonsnummeret enten
direkte i adressen eller sidetittelen, eller ved å søke i brreg på
domenet til nettstedet. Hvis flere bedrifter er kandidater, viser
utvidelsen en «Vi fant flere mulige treff»-velger framfor å gjette. Hvis
ingenting matcher, kan du søke manuelt.

**Sikkerhet og personvern**:

- For å finne bedriften sendes domenet til nettstedet du slår opp
  (for eksempel `dnb.no` for `nettbank.dnb.no`; underdomener sendes
  ikke), eller et organisasjonsnummer fra adressen eller
  sidetittelen, til `data.brreg.no` — aldri til utvikleren eller
  andre.
- Ingen content scripts. Utvidelsen leser ikke innholdet på
  nettsidene du besøker.
- Eneste eksterne tjeneste er `data.brreg.no` —
  Brønnøysundregistrenes åpne API.
- Ingen analytics, ingen tredjeparts-trackere, ingen telemetri.
- Null runtime-avhengigheter i den bygde utvidelsen.
- Auto-oppdater slår opp siden du ser på hver gang du bytter fane
  eller åpner en ny side, så lenge et brreg-snap-panel er åpent.
  Den krever `tabs`-tilgang, som utvidelsen ber om først når du
  slår den på, etter en kort forklaring av hva som sendes. Slå den
  av, eller trekk tilgangen tilbake i `about:addons`, når som helst.

Kildekoden er åpen under MIT-lisens på
[github.com/ikkeseb/brreg-snap](https://github.com/ikkeseb/brreg-snap).
```

### Summary en-US (≤ 250 chars)

```
Look up Norwegian companies in the public Brønnøysund Register with one click. Shows status, CEO, board, key figures, and accounts straight from data.brreg.no. No content scripts, no third-party trackers.
```

### Description en-US

```
**brreg-snap** surfaces Norwegian company information from the
Brønnøysund Register Centre directly in your browser. Click the
toolbar icon while visiting a Norwegian business website to get:

- Company name, organisation number, and status flags
- Business and postal address
- Industry code and employee count
- CEO, board members, auditor, and accountant
- Latest filed accounts with key figures
- Sub-units (underenheter) and parent unit, where registered

A **sidebar panel** shows the same data in a deeper layout.
Enable "Auto-oppdater ved fane-bytte" to have the sidebar look up
the page you are on every time you switch tabs or open a new page,
while it is open.

**Smart resolution**: the extension finds the organisation number
either directly in the page address or title, or by searching
brreg for the site's domain. When several companies are plausible
candidates, it shows a "Did you mean …?" picker rather than
guessing. When nothing matches, you can search manually.

**Security and privacy**:

- To find the company, the domain of the site you look up (for
  example `dnb.no` for `nettbank.dnb.no`; subdomains are not sent),
  or an organisation number from the page address or title, is sent
  to `data.brreg.no` — never to the developer or anyone else.
- No content scripts. The extension never reads the DOM or text
  of pages you visit.
- The only external service contacted is `data.brreg.no` — the
  public API operated by Brønnøysundregistrene.
- No analytics, no third-party trackers, no telemetry.
- Zero runtime dependencies in the shipped bundle.
- Auto-sync looks up the page you are on every time you switch
  tabs or open a new page, as long as a brreg-snap panel is open.
  It needs the `tabs` permission, which the extension only asks
  for when you turn it on, after a short note on what is sent.
  Turn it off, or revoke the permission in `about:addons`, at any
  time.

Source code under MIT licence at
[github.com/ikkeseb/brreg-snap](https://github.com/ikkeseb/brreg-snap).
```

## Unchanged fields (verify, don't edit)

- Add-on URL slug: `brreg-snap`.
- Categories: Search Tools; no Android listing.
- License: MIT. Support email: `sebastian@nuez.no`.
- Website `https://github.com/ikkeseb/brreg-snap`, support site
  `…/issues`.
- Permission justifications: unchanged since 1.1.0 — full text in
  `docs/amo-submission.md` § Permission justifications if AMO asks.
- Screenshots: keep the existing three (`docs/screenshots/01–03`).
