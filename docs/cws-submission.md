# Chrome Web Store submission guide

Everything needed to publish the Chrome build of brreg-snap to the
Chrome Web Store (CWS). Mirrors `docs/amo-submission.md` for Firefox.
Listing: <https://chromewebstore.google.com/detail/brreg-snap/mccggmiialopdaaokhakeijmbafhdmli>.

## 0. Account

- Developer account registered (one-time USD $5 fee); two-step
  verification on the Google account is required to publish.
- **Contact email** (Account page; shown on the listing):
  `sebastian@nuez.no`. The account's login email can't be changed,
  but the contact email can: Account → Add email → open the
  verification link.

## 1. Package

Upload only `brreg-snap-chrome-<version>.zip` from the GitHub Release
for tag `v<version>`, which CI builds from the tagged tree. Never a
local build. It has `manifest.json` at the archive root and no `.map`
files (`pnpm package:chrome` is what CI runs). Put its sha256 in the
annotated `amo-submission-<version>` tag message next to the AMO
digests (see `docs/amo-submission.md` § Upload).

Each upload must carry a strictly higher `version` than the previous
one. Manifest metadata (name etc.) effectively can't be edited in the
dashboard after submission — get it right in the zip.

## 2. Listing

- **Store icon:** 128×128 PNG (reuse `public/icons/icon-128.png` —
  artwork ~96px centered in the 128 canvas, reads on light & dark).
- **Screenshots:** 1–5, **1280×800** (preferred) or 640×400, PNG/JPEG,
  square corners, full-bleed, showing the real UI (`docs/screenshots/
  cws-*.png`).
- **Description:** plain text. CWS does not render Markdown, so no
  `**bold**`, no backticks, no `[text](url)` links: they show up
  literally. Paste the Norwegian text below; the English one is for an
  English locale.
- **Privacy policy URL:**
  `https://github.com/ikkeseb/brreg-snap/blob/main/PRIVACY.md`

### Description (nb — paste as is)

```
brreg-snap henter bedriftsinfo fra Brønnøysundregistrene rett i nettleseren. Klikk på verktøylinje-ikonet mens du er på et norsk bedriftsnettsted, så får du opp:

• Firmanavn, organisasjonsnummer og status
• Forretningsadresse og postadresse
• Næringskode og antall ansatte
• Daglig leder, styret, revisor og regnskapsfører
• Siste innleverte regnskap med nøkkeltall
• Eventuelle underenheter (avdelinger) og overordnet enhet

Sidepanelet gir samme informasjon med dypere oppslag. Slå på «Auto-oppdater ved fane-bytte» for å la panelet slå opp siden du ser på hver gang du bytter fane eller åpner en ny side, så lenge det er åpent.

Smart oppslag: Utvidelsen finner organisasjonsnummeret enten direkte i adressen eller sidetittelen, eller ved å søke i brreg på domenet til nettstedet. Hvis flere bedrifter er kandidater, viser utvidelsen en «Vi fant flere mulige treff»-velger framfor å gjette. Hvis ingenting matcher, kan du søke manuelt.

Sikkerhet og personvern:

• For å finne bedriften sendes domenet til nettstedet du slår opp (for eksempel dnb.no for nettbank.dnb.no; underdomener sendes ikke), eller et organisasjonsnummer fra adressen eller sidetittelen, til data.brreg.no, aldri til utvikleren eller andre.
• Ingen content scripts. Utvidelsen leser ikke innholdet på nettsidene du besøker.
• Eneste eksterne tjeneste er data.brreg.no, Brønnøysundregistrenes åpne API.
• Ingen analytics, ingen tredjeparts-trackere, ingen telemetri.
• Auto-oppdater slår opp siden du ser på hver gang du bytter fane eller åpner en ny side, så lenge et brreg-snap-panel er åpent. Det krever tilgang til faner, som utvidelsen ber om først når du slår det på, etter en kort forklaring av hva som sendes. Slår du det av, gir utvidelsen tilgangen tilbake. Fjerner du utvidelsen, forsvinner tilgangen også.

Kildekoden er åpen under MIT-lisens: https://github.com/ikkeseb/brreg-snap
```

### Description (en)

```
brreg-snap shows Norwegian company information from the Brønnøysund Register Centre right in your browser. Click the toolbar icon while you are on a Norwegian business website to get:

• Company name, organisation number and status
• Business and postal address
• Industry code and employee count
• CEO, board, auditor and accountant
• Latest filed accounts with key figures
• Sub-units (underenheter) and parent unit, where registered

The side panel shows the same data in more depth. Turn on "Auto-oppdater ved fane-bytte" to have the panel look up the page you are on every time you switch tabs or open a new page, while it is open.

Smart lookup: the extension finds the organisation number in the page address or title, or by searching the register for the site's domain. When several companies are plausible, it shows a picker of likely matches instead of guessing. When nothing matches, you can search by hand.

Security and privacy:

• To find the company, the domain of the site you look up (for example dnb.no for nettbank.dnb.no; subdomains are not sent), or an organisation number from the page address or title, is sent to data.brreg.no, never to the developer or anyone else.
• No content scripts. The extension never reads the pages you visit.
• The only external service is data.brreg.no, the register's public API.
• No analytics, no trackers, no telemetry.
• Auto-update looks up the page you are on every time you switch tabs or open a new page, as long as a brreg-snap panel is open. It needs access to your tabs, which the extension asks for only when you turn it on, after a short note on what is sent. Turning it off gives the access back; removing the extension removes it too.

Source code (MIT licence): https://github.com/ikkeseb/brreg-snap
```

## 3. Privacy practices tab

1. **Single purpose** (required free text):
   > Look up Norwegian companies in the Brønnøysund Register Centre
   > (Brreg) directly from the browser: status, roles, parent unit and
   > sub-units, and key financial figures, sourced live from the
   > official Brreg open-data API.

2. **Remote code:** select **"No, I am not using remote code."**
   (MV3 + CSP `default-src 'self'` = none.)

3. **Data usage — what is collected:** tick **Web history** and
   nothing else. The extension sends the registrable domain of the
   site the user looks up (dnb.no for nettbank.dnb.no) to
   data.brreg.no (the CWS User Data FAQ counts "the domains or URLs
   the browser interacts with" as web browsing activity). Lookups run
   when the user asks for one; auto-update runs only after the user
   confirms an in-panel disclosure and grants `tabs` (see the `tabs`
   justification below). Leave unchecked: personally identifiable
   information, health, financial and payment, authentication,
   personal communications, location, user activity, website content.
   If the form asks what the data is used for: core functionality
   only.

4. **Data usage — certifications:** tick all three; all true here.
   The transfer to data.brreg.no is the single purpose itself, which
   the Limited Use policy allows. The listing shows them as: not sold
   to third parties outside the approved use cases; not used or
   transferred for purposes unrelated to the item's core
   functionality; not used or transferred to determine
   creditworthiness or for lending.

5. **Limited Use statement:** CWS requires an affirmative Limited Use
   statement on the website or privacy policy. It lives in
   `PRIVACY.md` § Store declarations:
   > brreg-snap's use of information received from Chrome extension
   > APIs adheres to the Chrome Web Store User Data Policy, including
   > the Limited Use requirements.

6. **Permission justifications** (a free-text box per declared
   permission — reviewers read these; unjustified = rejection):

   | Permission | Justification |
   |-----------|---------------|
   | `activeTab` | Reads the URL and title of the active tab only after the user clicks the toolbar icon or the context-menu item, to find the company behind that site in Brreg. Only an organisation number found in the URL or title, or else the site's registrable domain (dnb.no for nettbank.dnb.no) and a name label derived from it, is sent to data.brreg.no for that lookup; the page content is never read. |
   | `storage` | Caches Brreg lookup results and the user's picker choice per site (24 h, in session storage, cleared when the browser closes), keeps the 5 most recent companies, and stores the on/off setting for auto-update. Local only; nothing is synced. |
   | `contextMenus` | Adds a single right-click item ("Vis i brreg-snap sidebar") to trigger a lookup for the current page without opening the popup. |
   | `sidePanel` | Shows the detailed company view (roles, parent unit, sub-units, key figures) in Chrome's side panel alongside the page. |
   | host `https://data.brreg.no/*` | The extension's sole network endpoint: all company data is fetched read-only from the official Brønnøysund open-data API. No other hosts are contacted; there are no content scripts. |
   | `tabs` *(optional)* | Requested at runtime only when the user turns on "Auto-oppdater ved fane-bytte" in the side panel, so an open panel can look up the page in front every time the user switches tabs or opens a new page. Turning it on first shows an in-panel disclosure: pages are looked up while a brreg-snap panel is open, the domain goes to data.brreg.no, nothing goes to the developer. Its "Slå på" button calls permissions.request; turning the setting off calls permissions.remove. Used only while a side panel is open. Not requested at install time. |

## 4. Common rejection pitfalls (pre-checked here)

- ✅ Manifest at zip root — handled by `package:chrome`.
- ✅ No Firefox-only keys leak (`background.scripts`, `sidebar_action`,
  `menus`, `browser_specific_settings`) — the Chrome manifest is a
  separate file, and `tests/manifest.test.ts` pins it.
- ✅ Permission set is minimal and all justifiable.
- ✅ Host permission is narrow (single host) — state explicitly in the
  justification that it's the only endpoint and there are no content
  scripts.
- ⚠️ The privacy tab, `PRIVACY.md` and the Firefox manifest must tell
  the same story: the site's domain goes to data.brreg.no (Web
  history / `browsingActivity`), nowhere else.

## 5. Submit

Upload the zip, check the listing and privacy tabs against this file,
submit for review. Review usually takes a few days but can take
weeks.
