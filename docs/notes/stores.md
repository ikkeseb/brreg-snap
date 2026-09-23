# Stores: what they serve and what they change

Source: `scripts/store-status.mjs` (network, git, report),
`scripts/store-status-core.mjs` (pure rules, tested in
`tests/store-status.test.ts`), `.github/workflows/store-status.yml`.

<!-- SECTION: store-status-probe -->
## The probe (`pnpm store-status`)

Store state is never written down in docs; this probe is the source.
It reads public, unauthenticated endpoints only:

- AMO: `GET https://addons.mozilla.org/api/v5/addons/addon/<gecko id>/`
  (the id from `public/manifest.firefox.json`; the slug `brreg-snap`
  works too) → `current_version.version`, `last_updated`,
  `current_version.file.url` + `.hash`, `average_daily_users`, `ratings`.
- CWS: the Chrome update check
  `https://clients2.google.com/service/update2/crx?response=updatecheck&acceptformat=crx3&prodversion=999.0&x=id%3D<item id>%26uc`
  → `<updatecheck version codebase hash_sha256>`. Any `prodversion` at
  or above `minimum_chrome_version` gets the current package. An
  unknown id answers `<app status="error-unknownApplication"/>`. The
  item id lives in `docs/cws-submission.md` § `item-id`.
- CWS listing page (informational only): "Updated <date>"; the user
  count is not rendered while the item has none/few users.

Verdict per store: serves the latest `v*` tag (`git describe`) → ok;
serves something older than the latest `<store>-submission-*` tag → in
review since that tag's date, a warning after 14 days; anything else →
mismatch. A failing endpoint prints `unknown`.

`--deep` downloads the served AMO `.xpi` and CWS `.crx` (checked against
the store's advertised sha256), and compares them file by file with the
`brreg-snap-<v>.zip` / `brreg-snap-chrome-<v>.zip` assets of the GitHub
Release for the served version. `--strict` also fails on `unknown` and
on a stale review. Exit 1 on any mismatch; without `--strict`, unknown
rows exit 0.

The weekly workflow runs `--deep --strict` and opens or comments on the
one open issue labelled `store-status`. Its `keepalive` job re-enables
the workflow via the REST API each scheduled run (GitHub disables
scheduled workflows after 60 days without repo activity).

<!-- SECTION: store-package-changes -->
## What the stores change in a package

Observed 2026-09-24 on the served 1.3.0 packages:

- **AMO** adds `META-INF/` (`cose.manifest`, `cose.sig`, `manifest.mf`,
  `mozilla.rsa`, `mozilla.sf`: the signature) and re-serialises
  `manifest.json` (non-ASCII as `\u` escapes, one array item per line,
  key order kept). It adds no manifest keys: equal as parsed JSON.
- **CWS** wraps the zip in a CRX3 header (`Cr24`, uint32 version 3,
  uint32 header length, protobuf header; the zip follows), adds
  `_metadata/verified_contents.json` and inserts `update_url` into
  `manifest.json`.
- Every other file must be byte-identical to the Release asset. The
  1.3.0 packages in both stores differ from the v1.3.0 Release in
  `popup/popup.html` and `details/details.html` by line endings only:
  they were uploaded from a local Windows (CRLF) build, not the CI
  artifact. `.gitattributes` now forces LF, and uploads come from the
  Release only.
