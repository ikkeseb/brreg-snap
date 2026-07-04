# AMO submission kit — brreg-snap 1.3.0

Copy-paste kit for uploading 1.3.0 to addons.mozilla.org. Everything
below is EXACT text for the form fields — sourced from
`docs/amo-submission.md` and `CHANGELOG.md` (those stay canonical).
Stores run **1.1.0**, so this release delivers the 1.2.0 + 1.3.0
changes combined; the release notes below cover both.

## Upload recipe

1. Get the artifacts — either from the GitHub Release for `v1.3.0`
   (built by the release workflow from the tagged tree) or locally:
   `pnpm package && pnpm package:source` →
   `web-ext-artifacts/brreg_snap-1.3.0.zip` and
   `web-ext-artifacts/brreg-snap-source-1.3.0.zip`.
2. <https://addons.mozilla.org/developers/> → My Add-ons →
   **brreg-snap** → Upload New Version → upload
   `brreg_snap-1.3.0.zip` (Firefox desktop only; no Android).
3. When asked "Do you need to submit source code?" answer **Yes** and
   upload `brreg-snap-source-1.3.0.zip`.
4. Paste **Release notes** (nb-NO primary, en-US fallback) from §
   Release notes below.
5. Paste **Notes for reviewers** from § Notes for reviewers below.
6. **Update the listing text** — the live 1.1.0 listing claims the
   extension shows *signaturrett*, which the open brreg API does not
   expose (see `docs/notes/brreg-api.md` § no-signatur). Replace
   Summary and Description in BOTH locales with § Listing text below.
7. Submit. Then record what was submitted:
   `git tag amo-submission-1.3.0 && git push origin amo-submission-1.3.0`

## Release notes (nb-NO — primary)

```
Ny «vurderingsstripe» under firmanavnet: status, alder, ansatte og
regnskap på ett blikk. Konkurs/slettet vises i rødt; nyregistrert
selskap og manglende regnskap for regnskapspliktige former flagges
gult. Signaler vi ikke fikk hentet utelates — de vises aldri som
negative funn.

Ellers i denne versjonen (samler også endringene fra upubliserte
1.2.0):

- Lyst tema — følger systeminnstillingen din
- Nøkkeltall: gjeld og egenkapitalandel fra siste regnskap; tap og
  negativ egenkapital flagges
- Klikk deg inn på morselskap, revisor eller regnskapsfører direkte i
  sidepanelet, med Tilbake-knapp
- Styreleder, revisor og regnskapsfører vises i oversikten
- Norske feilmeldinger og «nylig sett»-liste i sidepanelet
- Fikset: slettede selskaper viste grønn «Aktiv»-status
- Fikset: når søket feiler (f.eks. uten nett) sier utvidelsen det,
  i stedet for å påstå at ingen bedrift ble funnet
```

## Release notes (en-US — fallback)

```
New "verdict strip" under the company name: status, age, employees
and filing record at a glance. Bankrupt/deleted companies show red;
a brand-new registration or a missing filing for an
accounting-obliged form is flagged amber. Signals we could not fetch
are omitted — never shown as negative findings.

Also in this release (includes the unpublished 1.2.0 changes):

- Light theme — follows your system setting
- Key figures: debt and equity ratio from the latest filing; losses
  and negative equity are flagged
- Drill into a parent company, auditor or accountant directly in the
  side panel, with a Back button
- Chair, auditor and accountant shown in the overview
- Norwegian error messages and a "recently viewed" list in the panel
- Fixed: deleted companies showed a green "Aktiv" status
- Fixed: a failed lookup (e.g. offline) now says so instead of
  claiming no company was found
```

## Notes for reviewers

```
This add-on is a popup-only / sidebar-only company lookup tool
for Norwegian users. It has no content scripts and only contacts
data.brreg.no, the public API of the Norwegian Brønnøysund
Register Centre.

The build uses esbuild minification through Vite. Source maps are
included in the package for every JS bundle, and the complete
original source has been submitted alongside the .xpi. Build
instructions are in BUILD.md at the repo root — reproduction is
`pnpm install --frozen-lockfile && pnpm package` with Node >= 18
and pnpm 10.33.0 (pinned via the packageManager field).

The privacy policy is at
https://github.com/ikkeseb/brreg-snap/blob/main/PRIVACY.md.

The tabs permission is listed as optional_permissions and is
requested at runtime only when the user enables the "Auto-oppdater
ved fane-bytte" toggle in the sidebar. The install-time permission
dialogue therefore shows only activeTab, storage, and the
data.brreg.no host.
```

## Listing text (update BOTH locales this time — see recipe step 6)

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
- Eventuelle underenheter og morselskap

**Sidebar-panel** gir samme informasjon med dypere oppslag. Slå
på "Auto-oppdater ved fane-bytte" for å la sidebaren oppdatere
seg automatisk når du bytter fane.

**Smart oppslag**: Utvidelsen finner organisasjonsnummeret enten
direkte fra URL-en, eller ved å søke i brreg på hostname og
sidetittel. Hvis flere bedrifter er kandidater, viser sidebaren
en "Mente du …?"-velger framfor å gjette. Hvis ingenting matcher,
kan du søke manuelt.

**Sikkerhet og personvern**:

- Ingen content scripts. Utvidelsen leser ikke innholdet på
  nettsidene du besøker.
- Eneste eksterne tjeneste er `data.brreg.no` — Brønnøysund­
  registrenes åpne API.
- Ingen analytics, ingen tredjeparts-trackere, ingen telemetri.
- Null runtime-avhengigheter i den bygde utvidelsen.
- Auto-oppdater-funksjonen krever `tabs`-tilgang som utvidelsen
  ber om kun ved første aktivering — du kan trekke den tilbake
  når som helst fra `about:addons`.

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
- Subsidiaries and parent entity, where applicable

A **sidebar panel** shows the same data in a deeper layout.
Enable "Auto-oppdater ved fane-bytte" to have the sidebar
re-resolve automatically as you switch tabs.

**Smart resolution**: the extension finds the organisation number
either directly from the URL, or by querying brreg with the
hostname and page title. When several companies are plausible
candidates, the sidebar surfaces a "Did you mean …?" picker
rather than guessing. When nothing matches, you can search
manually.

**Security and privacy**:

- No content scripts. The extension never reads the DOM or text
  of pages you visit.
- The only external service contacted is `data.brreg.no` — the
  public API operated by Brønnøysundregistrene.
- No analytics, no third-party trackers, no telemetry.
- Zero runtime dependencies in the shipped bundle.
- The auto-sync feature requires the `tabs` permission, which
  the extension only requests when you first toggle it on. You
  can revoke it at any time from `about:addons`.

Source code under MIT licence at
[github.com/ikkeseb/brreg-snap](https://github.com/ikkeseb/brreg-snap).
```

## Unchanged fields (verify, don't edit)

- Categories: Search Tools; no Android listing.
- License: MIT. Support email: `sebastian@nuez.no`.
- Website `https://github.com/ikkeseb/brreg-snap`, support site
  `…/issues`, privacy policy `…/blob/main/PRIVACY.md`.
- Permission justifications: unchanged since 1.1.0 — full text in
  `docs/amo-submission.md` § Permission justifications if AMO asks.
- Screenshots: keep the existing three (`docs/screenshots/01–03`).
