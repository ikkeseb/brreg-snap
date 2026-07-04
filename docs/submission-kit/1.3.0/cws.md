# CWS submission kit — brreg-snap 1.3.0

Copy-paste kit for uploading 1.3.0 to the Chrome Web Store. Sourced
from `docs/cws-submission.md` (canonical). CWS runs **1.1.0**; there
is no per-version release-notes field on CWS — the upload just
replaces the package, so the only work is the zip + a listing-text
correction.

## Upload recipe

1. Get `brreg-snap-chrome-1.3.0.zip` — from the GitHub Release for
   `v1.3.0` or locally via `pnpm package:chrome`. Sanity check:
   `unzip -l web-ext-artifacts/brreg-snap-chrome-1.3.0.zip | grep -E 'manifest.json|\.map'`
   → `manifest.json` at the archive root, no `.map` files.
2. <https://chrome.google.com/webstore/devconsole> → **brreg-snap** →
   Package → **Upload new package** → the zip.
3. **Listing text correction** (one-time): if the live description
   mentions *signaturrett* / *signatory rights*, replace it with §
   Listing description below — the open brreg API doesn't expose
   signatur and the product doesn't show it.
4. Privacy tab: **no changes** — single purpose, "no remote code",
   zero data collection, and the permission justifications all still
   hold (full text in `docs/cws-submission.md` § 3 if the console
   asks again).
5. Submit for review. Record the submission date + version in
   `docs/chrome-port.md` Phase 5.

## Listing description (English — only needed for recipe step 3)

```
brreg-snap surfaces Norwegian company information from the
Brønnøysund Register Centre directly in your browser. Click the
toolbar icon while visiting a Norwegian business website to get:

- Company name, organisation number, and status flags
- Business and postal address
- Industry code and employee count
- CEO, board members, auditor, and accountant
- Latest filed accounts with key figures
- Subsidiaries and parent entity, where applicable

A side panel shows the same data in a deeper layout. Enable
"Auto-oppdater ved fane-bytte" to have the panel re-resolve
automatically as you switch tabs (optional, runtime permission).

Smart resolution: the extension finds the organisation number
either directly from the URL, or by querying brreg with the
hostname and page title. When several companies are plausible
candidates, it shows a "Did you mean …?" picker rather than
guessing. When nothing matches, you can search manually.

Security and privacy:

- No content scripts. The extension never reads the pages you
  visit.
- The only external service contacted is data.brreg.no — the
  public API operated by Brønnøysundregistrene.
- No analytics, no trackers, no telemetry, zero runtime
  dependencies.

Source code under MIT licence at
https://github.com/ikkeseb/brreg-snap
```

## Unchanged fields (verify, don't edit)

- Single purpose text, store icon (`icon-128.png`), screenshots,
  category, support email `sebastian@nuez.no`.
- Privacy policy URL must still resolve publicly:
  `https://github.com/ikkeseb/brreg-snap/blob/main/PRIVACY.md`.
