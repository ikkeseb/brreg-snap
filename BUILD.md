# Build instructions for AMO reviewers

This document gives a reviewer everything needed to reproduce the
shipped package from source. No private repositories, no commercial
tools, no remote-loaded code.

## Which source to build

Build from the source zip for the version under review,
`brreg-snap-source-<version>.zip`. It is the file uploaded to AMO next
to the package, and the same file is attached to the GitHub Release
for tag `v<version>`
([github.com/ikkeseb/brreg-snap/releases](https://github.com/ikkeseb/brreg-snap/releases)).
`pnpm package:source` makes it with `git archive` of that tag, so it
holds exactly the tree CI built the release packages from
(`.github/workflows/release.yml`). The same Release carries those
unsigned packages to compare against: `brreg-snap-<version>.zip`
(Firefox) and `brreg-snap-chrome-<version>.zip` (Chrome).

## Environment

- **OS**: any. Release packages are built by CI on Ubuntu. The
  repository forces LF line endings (`.gitattributes`), so Windows,
  macOS and Linux produce the same bytes (see Reproducibility below).
  On Windows, the repo's `.npmrc` (`shell-emulator=true`) makes the
  POSIX-style `BROWSER=…` env prefixes in the package scripts work
  under pnpm — no WSL needed.
- **Node.js**: ≥ 18 (tested on v25.8.1; any 18 LTS / 20 LTS / 22 LTS
  release should work).
- **pnpm**: 10.33.0 (pinned via the `packageManager` field in
  `package.json`).

Install Node from <https://nodejs.org/> and pnpm via
`npm install -g pnpm@10.33.0` or
[corepack](https://nodejs.org/api/corepack.html):

```bash
corepack enable
corepack prepare pnpm@10.33.0 --activate
```

## Reproducing the build

From the root of the unzipped source zip (or a checkout of the tag):

```bash
pnpm install --frozen-lockfile      # uses pnpm-lock.yaml exactly
pnpm test                           # unit tests (vitest)
pnpm typecheck                      # tsc --noEmit, zero errors
pnpm lint:ts                        # eslint, zero warnings
pnpm package                        # builds Firefox + produces the package
```

`pnpm package` is an alias for `pnpm package:firefox`. The repository
also builds a Chrome target (`pnpm package:chrome`). Both come from
the same `src/` and ship the same JavaScript and HTML; only
`manifest.json` differs (`public/manifest.<browser>.json`). Engine
differences are runtime feature checks in `src/lib/platform/`.

The Firefox package's `manifest.json` is `public/manifest.firefox.json`
byte for byte, apart from the stamped `version` (see Versioning). AMO
re-serializes `manifest.json` when it signs, so compare against the
unsigned package, not the signed `.xpi` AMO serves.

`pnpm package:source` archives the tag `v<version>`, not the working
tree, and fails if that tag doesn't exist yet.

## Versioning

`package.json` is the single source of truth for the version. At
build time, the copy-static-assets plugin in `vite.config.ts` stamps
the `"version"` field of the copied manifest with the package.json
version, via a string-level replacement that leaves every other byte
of the manifest untouched — so the built Firefox manifest stays
byte-identical to `public/manifest.firefox.json` whenever the two
versions agree. Both source manifests carry the same version as
`package.json`; a mismatch would only appear if a manifest bump were
forgotten, and the stamp makes that harmless.

The final artifact lands at
`web-ext-artifacts/brreg-snap-<version>.zip`. (web-ext writes the
package as `.zip`; AMO accepts both extensions interchangeably.)

## Reproducibility

The **contents** of the package — every file under the archive
root — are reproducible bit-for-bit with the same Node/pnpm
combination, on any OS. Checked 2026-09-23: a build on Windows 11
from an LF checkout matched the CI (Ubuntu) packages of the v1.3.0
GitHub Release file for file, for both Firefox and Chrome.

This holds because the repository forces LF line endings
(`.gitattributes`: `* text=auto eol=lf`, since 1.3.1). Vite copies the
manifests and HTML entries byte for byte, so before that a Windows
checkout with `core.autocrlf=true` (Git for Windows' default) built
packages whose manifest and HTML files had CRLF line endings. Source
zips made with `git archive` have LF line endings (checked for
v1.3.0), so building from one was not affected. A clone made before
1.3.1 keeps its CRLF files until a one-time refresh on a clean tree:
`git rm -r -q --cached . && git reset -q --hard`.

The zip envelope itself has different SHA-256 hashes between builds
because `web-ext` records each file's modification time in the
zip's central directory, and those timestamps differ across
extractions. The standard verification flow at review time is
therefore: unzip both archives and diff the contents, not hash the
outer envelope:

```bash
mkdir mine ci
unzip -q -d mine web-ext-artifacts/brreg-snap-<version>.zip
unzip -q -d ci   brreg-snap-<version>.zip   # from the GitHub Release
diff -r mine ci                             # expect no output
```

## What the build does

`pnpm package` is the composite of two steps:

1. **`pnpm build:firefox`** (Vite) — compiles TypeScript sources
   under `src/` to JavaScript, copies the Firefox manifest
   (`public/manifest.firefox.json` → `manifest.json`, stamping its
   `version` field from `package.json` — see Versioning above) and
   toolbar icons, relocates the popup/details HTML entries to their
   manifest-expected paths, and writes everything to `dist-firefox/`.
2. **`web-ext build`** — packages the contents of `dist-firefox/`
   into `web-ext-artifacts/brreg-snap-<version>.zip`, excluding
   sourcemaps (`*.map`) and `icons/README.md`. No code transformation.

## Minification

The build uses esbuild's minifier (default Vite production setting).
Source maps are emitted for every JavaScript bundle into
`dist-firefox/` for local debugging, but are **excluded from the
packaged `.zip`/`.xpi`** (they are dead weight for end users — the
maps were ~66% of an earlier package). The minified code can still be
mapped back to the original TypeScript at review time: the full
original source ships in the source submission
(`brreg-snap-source-<version>.zip`), which is what AMO review uses.

No obfuscation, no name mangling beyond standard minification, no
runtime code generation. The codebase does not use `eval` or the
dynamic-function constructor — verifiable with
`grep -rE "(\beval\b|Function *\()" src/`, which returns nothing.

## Dependencies

- **Runtime**: zero. The shipped bundle contains no third-party
  JavaScript. `pnpm audit --prod` returns 0.
- **Dev-only**: TypeScript, ESLint, Vite, Vitest, web-ext, and their
  transitive dependencies. None of these ship in the `.xpi`.

## Network access

The extension contacts only `https://data.brreg.no/*` (the public
Norwegian business registry API). This is enforced by:

- `host_permissions: ["https://data.brreg.no/*"]` in the manifest
- CSP `connect-src https://data.brreg.no`

There are no content scripts, no `<all_urls>` permissions, and no
remote-loaded code. To find the company behind a site, the extension
sends that site's hostname (and name words derived from it) to
data.brreg.no, which is why the manifest declares `browsingActivity`
in `data_collection_permissions`. See [PRIVACY.md](PRIVACY.md) for the
full data flow.

## Verification

After `pnpm package`, the resulting package can be inspected with any
zip tool:

```bash
unzip -l web-ext-artifacts/brreg-snap-<version>.zip
```

Expected top-level entries: `manifest.json`, `background/`,
`popup/`, `details/`, `chunks/`, `icons/`. No other files.
