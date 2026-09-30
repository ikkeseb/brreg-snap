# Build + tooling quirks

Source: `vite.config.ts`, `package.json`,
`public/manifest.<browser>.json`, `src/lib/copy-orgnr.ts`.

<!-- SECTION: dual-browser-build -->
## Dual-browser build (`--mode firefox|chrome`)

`vite.config.ts` reads Vite's mode (`chrome`; any other mode builds
Firefox), builds to `dist-${browser}/`, and the `copy-static-assets`
`closeBundle` plugin copies `public/manifest.${browser}.json` to
`dist-${browser}/manifest.json`. `publicDir` is set to `false` so
Vite's automatic public/ copy doesn't drag BOTH source manifests into
the output — the plugin copies exactly the right one plus the icons
(filtering out `icons/*.md`). Scripts: `build:{firefox,chrome}`,
`package:{firefox,chrome}`; the bare `build`/`dev`/`package` alias the
Firefox target. The built `manifest.json` is the source manifest
byte for byte apart from the stamped `version` (string replace, not
JSON re-serialisation). AMO re-serialises the manifest when it signs,
so the signed `.xpi` never matches the repo; compare the unsigned
package instead, as BUILD.md tells reviewers.

<!-- SECTION: vite-popup-html -->
## Vite popup.html path quirk

Vite emits HTML entries at the same relative path they live at in
the source (so `src/popup/popup.html` → `dist-<browser>/src/popup/popup.html`).
The manifest expects `popup/popup.html`. `vite.config.ts`
`closeBundle` relocates the file and deletes `dist-<browser>/src/`.
Removing this hook breaks the packaged extension silently.

<!-- SECTION: minify -->
## Default minifier; source maps never ship

`vite.config.ts` sets no minifier, so the build uses Vite's default
(Oxc since Vite 8), with `build.target` `firefox115` or `chrome116`.
Source maps are emitted to `dist-<browser>/` for local debugging but
are **stripped from the packaged artifact** via the
`--ignore-files "**/*.map"` flag on the `web-ext build` step, and
`scripts/verify-package.mjs` fails a package that carries one. AMO
source review reads the full TS in the source zip, not the maps. The
codebase has no name-sensitive reflection (no `eval`, no `Function`,
no string dispatch on identifier names), so minification is safe.

<!-- SECTION: clipboard-no-permission -->
## Click-to-copy without `clipboardWrite`

Click-to-copy on orgnr lives in `src/lib/copy-orgnr.ts`. Shared
helper used by the popup result row, sidebar header, and underenheter
table cells. `navigator.clipboard.writeText` works in extension
contexts without `clipboardWrite` in the manifest as long as the call
is in a user-gesture stack (i.e. inside a click handler) — which it
is. Don't add `clipboardWrite` to the permission list.

Every other copy action goes through the same `writeClipboard(text)`
(returns false when refused, so the UI can say so): the text comes
from the pure builders in `src/lib/trust/summary.ts` (`buildSummary`),
built and written inside the click handler with no
await before the write.
