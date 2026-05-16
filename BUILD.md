# Build instructions for AMO reviewers

This document gives a reviewer everything needed to reproduce the
shipped `.xpi` from source. No private repositories, no commercial
tools, no remote-loaded code.

## Environment

- **OS**: Built on macOS 26.4. Linux and Windows produce equivalent
  output (the build is platform-independent — Vite + esbuild).
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

From the repository root:

```bash
pnpm install --frozen-lockfile      # uses pnpm-lock.yaml exactly
pnpm test                           # 105 unit tests (vitest)
pnpm typecheck                      # tsc --noEmit, zero errors
pnpm lint:ts                        # eslint, zero warnings
pnpm package                        # builds + produces .xpi
```

The final artifact lands at
`web-ext-artifacts/brreg-snap-<version>.zip`. (web-ext writes the
package as `.zip`; AMO accepts both extensions interchangeably.)

The **contents** of the package — every file under the archive
root — are bit-for-bit identical to the file submitted to AMO when
run on the same Node/pnpm combination. We verified this by running
`pnpm package` in two separate working trees from the same source
and comparing `dist/` recursively with `diff -rq` (zero
differences).

The zip envelope itself has different SHA-256 hashes between builds
because `web-ext` records each file's modification time in the
zip's central directory, and those timestamps differ across
extractions. The standard verification flow at review time is
therefore: unzip both archives and diff the contents, not hash the
outer envelope.

## What the build does

`pnpm package` is the composite of two steps:

1. **`pnpm build`** (Vite) — compiles TypeScript sources under
   `src/` to JavaScript, copies static assets from `public/` (the
   manifest and toolbar icons), relocates the popup/details HTML
   entries to their manifest-expected paths, and writes everything
   to `dist/`.
2. **`web-ext build`** — packages the contents of `dist/` into a
   `.zip` file with the `.xpi` extension. No code transformation.

## Minification

The build uses esbuild's minifier (default Vite production setting).
Source maps are emitted for every JavaScript bundle so the minified
code can be mapped back to the original TypeScript at review time.
The full original source is also in this submission for reference.

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
remote-loaded code. See [PRIVACY.md](PRIVACY.md) for the full data
flow.

## Verification

After `pnpm package`, the resulting `.xpi` can be inspected with any
zip tool:

```bash
unzip -l web-ext-artifacts/brreg-snap-*.xpi
```

Expected top-level entries: `manifest.json`, `background/`,
`popup/`, `details/`, `chunks/`, `icons/`. No other files.
