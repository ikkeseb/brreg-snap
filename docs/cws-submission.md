# Chrome Web Store submission guide

Everything needed to publish the Chrome build of brreg-snap to the
Chrome Web Store (CWS). Mirrors `docs/amo-submission.md` for Firefox.
Facts verified against developer.chrome.com (2026-06).

> **Do this only after** the Phase 4 smoke matrix in
> `docs/chrome-port.md` is green in a real Chrome window.

## 0. One-time account setup

- Register a developer account at
  <https://developer.chrome.com/docs/webstore/register>.
- **One-time USD $5** registration fee (lifetime, not recurring).
- Provide and **verify a developer contact email** (separate from the
  Google login; it can't be changed later — use a durable address).
  Decided 2026-07-04: `sebastian@nuez.no`.
- Enable two-step verification on the Google account (required to
  publish).

## 1. Build the package

```bash
pnpm package:chrome
# -> web-ext-artifacts/brreg-snap-chrome-<version>.zip
```

The zip has `manifest.json` at the **archive root** (CWS requirement —
not nested in a folder), and excludes sourcemaps and `icons/README.md`.
Verify:

```bash
unzip -l web-ext-artifacts/brreg-snap-chrome-*.zip | grep -E 'manifest.json|\.map'
# expect: manifest.json present at top level; no .map files
```

Each upload must carry a strictly higher `version` than the previous
one. Manifest metadata (name etc.) effectively can't be edited in the
dashboard after submission — get it right in the zip.

## 2. Listing assets

- **Store icon:** 128×128 PNG (reuse `public/icons/icon-128.png` —
  artwork ~96px centered in the 128 canvas, reads on light & dark).
- **Screenshots:** 1–5, **1280×800** (preferred) or 640×400, PNG/JPEG,
  square corners, full-bleed, showing the real UI. Reuse / re-shoot
  from `docs/screenshots/` (re-crop to 1280×800 if needed).
- **Description (English required):** keep it tight and single-purpose
  (see below). Norwegian optional.
- **Privacy policy URL (REQUIRED, must resolve publicly):** host
  `PRIVACY.md`'s content at a public URL — e.g. GitHub Pages or the
  raw GitHub file. A 404 / placeholder is a common rejection even for
  zero-data extensions. **← action item for Seb: confirm a live URL.**

## 3. Privacy practices tab

1. **Single purpose** (required free text):
   > Look up Norwegian companies in the Brønnøysund Register Centre
   > (Brreg) directly from the browser — org number, roles,
   > parent/subsidiary structure, and key financial figures, sourced
   > live from the official Brreg open-data API.

2. **Remote code:** select **"No, I am not using remote code."**
   (MV3 + CSP `default-src 'self'` = none.)

3. **Data usage:** leave **every** data-type category **unchecked**
   (the extension collects/transmits no user data). Then tick all three
   required certifications — all true here:
   - not selling/transferring user data to third parties;
   - not using/transferring data for purposes unrelated to the single
     purpose;
   - not using/transferring data for creditworthiness/lending.

4. **Permission justifications** (a free-text box per declared
   permission — reviewers read these; unjustified = rejection):

   | Permission | Justification |
   |-----------|---------------|
   | `activeTab` | Reads the URL/hostname of the active tab only after the user clicks the toolbar icon or context-menu item, to resolve the company behind that site against Brreg. No persistent tab access; granted only on a user gesture. |
   | `storage` | Caches Brreg lookup results (24 h TTL) and the user's picker choice / recent lookups locally so repeat views are instant and we make fewer API calls. Local only; no syncing of personal data. |
   | `contextMenus` | Adds a single right-click item ("Vis i brreg-snap sidebar") to trigger a lookup for the current page without opening the popup. |
   | `sidePanel` | Shows the detailed company view (roles, parent/subsidiaries, key figures) in Chrome's side panel alongside the page. |
   | host `https://data.brreg.no/*` | The extension's sole network endpoint — all company data is fetched read-only from the official Brønnøysund open-data API. No other hosts are contacted; there are no content scripts. |
   | `tabs` *(optional)* | Requested **at runtime only** when the user turns on "Auto-oppdater ved fane-bytte" in the side panel, so the panel can follow the active tab and show the company behind whatever page is in front. Granted via `permissions.request` on the toggle click; removed via `permissions.remove` when toggled off. Not requested at install time — the install dialog shows only `activeTab` + storage + the Brreg host. |

   > `tabs` is the only `optional_permissions` entry. It backs the
   > auto-sync opt-in (D13) and is never held unless the user explicitly
   > enables the toggle. Reviewers: this is a runtime, revocable grant,
   > not an install-time permission.

## 4. Common rejection pitfalls (pre-checked here)

- ✅ Manifest at zip root — handled by `package:chrome`.
- ✅ No Firefox-only keys leak (`background.scripts`, `sidebar_action`,
  `menus`, `browser_specific_settings`) — the Chrome manifest is a
  separate file.
- ✅ Permission set is minimal and all justifiable.
- ✅ Host permission is narrow (single host) — state explicitly in the
  justification that it's the only endpoint and there are no content
  scripts.
- ⚠️ Privacy policy URL must be live (see §2).
- ⚠️ Keep manifest behaviour, the dashboard data form, and the privacy
  policy all consistent at **zero data collection**.

## 5. Submit

Upload the zip, fill the listing + privacy tabs, submit for review.
Review usually completes in a few days but can take weeks (a submission
surge was noted on the review-process page as of April 2026). Record
the submission date, version, and any reviewer notes in
`docs/chrome-port.md` Phase 5.
