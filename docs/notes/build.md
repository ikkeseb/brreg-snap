# Build + tooling quirks

Source: `vite.config.ts`, `package.json`, `src/lib/copy-orgnr.ts`.

<!-- SECTION: vite-popup-html -->
## Vite popup.html path quirk

Vite emits HTML entries at the same relative path they live at in
the source (so `src/popup/popup.html` → `dist/src/popup/popup.html`).
The manifest expects `popup/popup.html`. `vite.config.ts`
`closeBundle` relocates the file and deletes `dist/src/`. Removing
this hook breaks the packaged extension silently.

<!-- SECTION: minify -->
## esbuild minify is on by default

`vite.config.ts` sets `build.minify: 'esbuild'`. Source maps stay
enabled so AMO review can map the minified bundle back to TypeScript.
Don't switch to terser unless you have a reason — esbuild minify is
fast enough that watch-mode stays responsive, and the codebase has
no name-sensitive reflection (no `eval`, no `Function`, no string
dispatch on identifier names) for terser to do anything extra with.

<!-- SECTION: clipboard-no-permission -->
## Click-to-copy without `clipboardWrite`

Click-to-copy on orgnr lives in `src/lib/copy-orgnr.ts`. Shared
helper used by the popup result row, sidebar header, and underenheter
table cells. `navigator.clipboard.writeText` works in extension
contexts without `clipboardWrite` in the manifest as long as the call
is in a user-gesture stack (i.e. inside a click handler) — which it
is. Don't add `clipboardWrite` to the permission list.
