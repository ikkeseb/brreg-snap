# Chrome Web Store submission guide

Everything needed to publish the Chrome build of brreg-snap to the
Chrome Web Store (CWS). Mirrors `docs/amo-submission.md` for Firefox.
Listing: <https://chromewebstore.google.com/detail/brreg-snap/mccggmiialopdaaokhakeijmbafhdmli>.

<!-- SECTION: item-id -->
CWS item id (public; `scripts/store-status.mjs` reads it from here):
`mccggmiialopdaaokhakeijmbafhdmli`

## 0. Account

**Contact email** (Account page; shown on the listing):
`sebastian@nuez.no`.

## 1. Package

The publish workflow uploads `brreg-snap-chrome-<version>.zip` from the
GitHub Release for tag `v<version>` and submits it for review; never a
local build. The flow and the manual fallback: `docs/release.md`.

Each upload must carry a strictly higher `version` than the previous
one. Manifest metadata (name etc.) effectively can't be edited in the
dashboard after submission — get it right in the zip.

## 2. Listing

- **Store icon:** 128×128 PNG (reuse `public/icons/icon-128.png` —
  artwork ~96px centered in the 128 canvas, reads on light & dark).
- **Screenshots:** 1–5, **1280×800** (preferred) or 640×400, PNG/JPEG,
  square corners, full-bleed, showing the real UI. Upload the five `docs/screenshots/v1.4-*.png`
  files in numerical order. Fixture data and provenance:
  `docs/screenshots/README.md`.
- **Description:** plain text. CWS does not render Markdown, so no
  `**bold**`, no backticks, no `[text](url)` links: they show up
  literally. Paste the Norwegian text below; the English one is for an
  English locale.
- **Privacy policy URL:**
  `https://github.com/ikkeseb/brreg-snap/blob/main/PRIVACY.md`

<!-- SECTION: description-nb -->
### Description (nb — paste as is)

```
Sjekk hvem som står bak en norsk nettbutikk eller nettside. brreg-snap slår opp bedriften i Brønnøysundregistrene og viser organisasjonsnummer, konkurs og andre registrerte varsler, styre og regnskap.

• Se hvordan nettstedet er koblet til bedriften: registrert hjemmeside, et org.nr siden selv oppgir, eller et mulig navnetreff.
• Se status, alder, ansatte og siste innleverte regnskap. Ingen varsler i registeret er ingen garanti for at en nettbutikk er trygg.
• Åpne sidepanelet for roller, adresser, aktivitet, konsern, underenheter og lenker til årsregnskap og kunngjøringer.
• Søk på navn eller org.nr, slå opp markert tekst med høyreklikk, eller bruk en hurtigtast.
• Velg en annen bedrift ved feil treff, glem et tidligere valg, og kopier org.nr eller et sammendrag.

Slå på «Auto-oppdater» hvis du vil at et åpent sidepanel skal følge fanen du ser på. Du får først en forklaring og en forespørsel om tilgang til faner. Slår du bryteren av, gis tilgangen tilbake.

Personvern: Oppslag sendes bare til data.brreg.no, aldri til utvikleren. Utvidelsen sender nettstedets registrerbare domene, et organisasjonsnummer eller søketeksten du selv skriver eller velger å slå opp. Den har ingen content scripts og leser ikke nettsideinnhold automatisk. Ingen analytics, trackere eller telemetri. Velkomstsiden gjør ingen nettverkskall. «Rapporter feil treff» åpner e-postprogrammet ditt; du velger selv om meldingen sendes.

Kildekode under MIT-lisens: https://github.com/ikkeseb/brreg-snap
```

<!-- SECTION: description-en -->
### Description (en)

```
Check which company is behind a Norwegian shop or website. brreg-snap looks up the company in the Brønnøysund Register Centre and shows its organisation number, bankruptcy and other registry warnings, board and accounts.

• See how the site relates to the company: a registered website, an organisation number claimed by the site, or a possible name match.
• Check status, age, employees and the latest filed accounts. No registry warnings is not a guarantee that a shop is safe.
• Open the side panel for roles, addresses, activities, company groups, sub-units and links to annual reports and announcements.
• Search by name or organisation number, look up selected text from the right-click menu, or use a keyboard shortcut.
• Choose another company after a wrong match, forget a previous choice, and copy an organisation number or summary.

Turn on "Auto-oppdater" to let an open side panel follow your active tab. A short explanation and a request for tab access appear first. Turning it off gives the permission back.

Privacy: Lookups go only to data.brreg.no, never to the developer. The extension sends the site's registrable domain, an organisation number or search text you type or choose to look up. It has no content scripts and does not read page content automatically. No analytics, trackers or telemetry. The welcome page makes no network requests. "Rapporter feil treff" opens your email app; you decide whether to send the message.

Source code under the MIT licence: https://github.com/ikkeseb/brreg-snap
```

<!-- SECTION: privacy-practices -->
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
   | `activeTab` | Reads the URL and title of the active tab only after the user clicks the toolbar icon or a context-menu item, or uses a keyboard shortcut, to find the company behind that site in Brreg. Only an organisation number found in the URL or title, or else the site's registrable domain (dnb.no for nettbank.dnb.no) and a name label derived from it, is sent to data.brreg.no for that lookup; the page content is never read. |
   | `storage` | Caches Brreg lookup results and the user's picker choice per site (24 h, in session storage, cleared when the browser closes), keeps the 5 most recent companies, and stores the on/off setting for auto-update. Local only; nothing is synced. |
   | `contextMenus` | Adds right-click items to look up the current page or selected text. Text is sent to data.brreg.no only when the user chooses that lookup, limited to 100 characters; if it contains an organisation number, only that number is sent. |
   | `sidePanel` | Shows the detailed company view (roles, parent unit, sub-units, key figures) in Chrome's side panel alongside the page. |
   | host `https://data.brreg.no/*` | The extension's sole network endpoint: all company data is fetched read-only from the official Brønnøysund open-data API. No other hosts are contacted; there are no content scripts. |
   | `tabs` *(optional)* | Requested at runtime only when the user turns on "Auto-oppdater" in the side panel, so an open panel can look up the page in front every time the user switches tabs or opens a new page. Turning it on first shows an in-panel disclosure: pages are looked up while a brreg-snap panel is open, the domain goes to data.brreg.no, nothing goes to the developer. Its "Slå på" button calls permissions.request; turning the setting off calls permissions.remove. Used only while a side panel is open. Not requested at install time. |

## 4. Consistency

The package shape and the Chrome manifest are gated
(`scripts/verify-package.mjs`, `tests/manifest.test.ts`). What no gate
checks: the privacy tab, `PRIVACY.md` and the Firefox manifest must
tell the same story, that the site's domain goes to data.brreg.no (Web
history / `browsingActivity`) and nowhere else. Check the listing and
privacy tabs against this file whenever they change. Review usually
takes a few days but can take weeks.
