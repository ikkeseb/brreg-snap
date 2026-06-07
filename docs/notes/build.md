# Build + tooling quirks

Source: `vite.config.ts`, `package.json`,
`public/manifest.<browser>.json`, `src/lib/copy-orgnr.ts`.

<!-- SECTION: dual-browser-build -->
## Dual-browser build (`BROWSER=firefox|chrome`)

`vite.config.ts` reads `process.env.BROWSER` (default `firefox`),
builds to `dist-${browser}/`, and the `copy-static-assets`
`closeBundle` plugin copies `public/manifest.${browser}.json` to
`dist-${browser}/manifest.json`. `publicDir` is set to `false` so
Vite's automatic public/ copy doesn't drag BOTH source manifests into
the output — the plugin copies exactly the right one plus the icons
(filtering out `icons/*.md`). Scripts: `build:{firefox,chrome}`,
`package:{firefox,chrome}`; the bare `build`/`dev`/`package` alias the
Firefox target. The Firefox `manifest.json` stays byte-identical to
the AMO submission — verify with `diff` against
`git show amo-submission-1.0.0:public/manifest.json` after any
`vite.config.ts` change.

<!-- SECTION: vite-popup-html -->
## Vite popup.html path quirk

Vite emits HTML entries at the same relative path they live at in
the source (so `src/popup/popup.html` → `dist-<browser>/src/popup/popup.html`).
The manifest expects `popup/popup.html`. `vite.config.ts`
`closeBundle` relocates the file and deletes `dist-<browser>/src/`.
Removing this hook breaks the packaged extension silently.

<!-- SECTION: minify -->
## esbuild minify is on by default

`vite.config.ts` sets `build.minify: 'esbuild'` (target `firefox115`
or `chrome116`). Source maps are emitted to `dist-<browser>/` for
local debugging but are **stripped from the packaged artifact** via
the `--ignore-files "**/*.map"` flag on the `web-ext build` step (the
old `web-ext-config.cjs` that tried to do this was never loaded —
web-ext doesn't auto-discover `.cjs` config, only the `package.json`
default; that file has been removed). AMO source review reads the
full TS in the source zip, not the `.xpi` maps. Don't switch to
terser unless you have a reason — esbuild minify is fast enough that
watch-mode stays responsive, and the codebase has no name-sensitive
reflection (no `eval`, no `Function`, no string dispatch on
identifier names) for terser to do anything extra with.

<!-- SECTION: clipboard-no-permission -->
## Click-to-copy without `clipboardWrite`

Click-to-copy on orgnr lives in `src/lib/copy-orgnr.ts`. Shared
helper used by the popup result row, sidebar header, and underenheter
table cells. `navigator.clipboard.writeText` works in extension
contexts without `clipboardWrite` in the manifest as long as the call
is in a user-gesture stack (i.e. inside a click handler) — which it
is. Don't add `clipboardWrite` to the permission list.
