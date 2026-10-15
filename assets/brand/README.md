# Brand masters

The logo's source files: fill-only SVGs, one blue (`#4A74FF`). They
sit outside `public/`, so none of them ships; `pnpm icons`
(`scripts/generate-icons.mjs`) renders what does.

| File | Drawn for | Renders |
| --- | --- | --- |
| `mark.svg` | 48 px and up (128 canvas) | `public/icons/icon-48.png` |
| `mark-128.svg` | the 128 px store and install icon (art inside 96 px) | `public/icons/icon-128.png` |
| `mark-32.svg` | 32 px, on the pixel grid | `public/icons/icon-32.png`; the in-UI mark at 2x |
| `mark-16.svg` | 16 px, on the pixel grid | `public/icons/icon-16.png`; the in-UI mark at 1x |
| `lockup.svg`, `lockup-h.svg` | the mark with the wordmark, stacked and horizontal, on light grounds | nothing yet |
| `lockup-dark.svg`, `lockup-h-dark.svg` | the same on dark (butter wordmark) | nothing yet |

The in-UI mark is `src/lib/view/mark-data.ts`: the paths of the 16 and
the 32 drawing, each cropped to its ink (`docs/notes/ui.md` § masthead-mark).

## Swapping in a new master

Replace the files here under the same names (fill-only: `<svg viewBox>`
with `<path d fill>` children, no strokes, filters or editor metadata),
then:

```bash
pnpm icons    # rewrites public/icons/*.png and src/lib/view/mark-data.ts
pnpm verify   # tests/brand.test.ts checks the outputs against the manifests and the masters
```

The small drawings must keep their pixel grid (16 and 32 units square)
for the PNGs and the in-UI mark to stay crisp. A new colour also goes
into `--brand` in `src/styles/brreg.css`; the test fails until it does.
