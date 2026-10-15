# Brand masters

The logo's source files: fill-only SVGs, one blue (`#4A74FF`). They
sit outside `public/`, so none of them ships. `pnpm icons`
(`scripts/generate-icons.mjs`) is the one command that turns them into
three kinds of output:

- `public/icons/icon-{16,32,48,128}.png`, the manifests' icons;
- `src/lib/view/mark-data.ts`, the in-UI mark's paths;
- `icons.lock.json` (here), the sha256 of every master it read and
  every file above it wrote.

| File | Drawn for | Renders |
| --- | --- | --- |
| `mark.svg` | 48 px and up (128 canvas) | `public/icons/icon-48.png`, scaled down from the 128 canvas, not drawn on a 48 grid |
| `mark-128.svg` | the 128 px store and install icon (art inside 96 px) | `public/icons/icon-128.png` |
| `mark-32.svg` | 32 px, on the pixel grid | `public/icons/icon-32.png`; the in-UI mark at 2x |
| `mark-16.svg` | 16 px, on the pixel grid | `public/icons/icon-16.png`; the in-UI mark at 1x |
| `lockup.svg`, `lockup-h.svg` | the mark with the wordmark, stacked and horizontal, on light grounds | nothing (not used by the build) |
| `lockup-dark.svg`, `lockup-h-dark.svg` | the same on dark (butter wordmark) | nothing (not used by the build) |

The in-UI mark is `src/lib/view/mark-data.ts`: the paths of the 16 and
the 32 drawing, each cropped to its ink (`docs/notes/ui.md` § masthead-mark).

## Swapping in a new master

Replace the files here under the same names (fill-only: `<svg viewBox>`
with `<path d fill>` children, no strokes, filters or editor metadata),
then:

```bash
pnpm icons    # rewrites public/icons/*.png, src/lib/view/mark-data.ts and icons.lock.json
pnpm verify   # tests/brand.test.ts, below
```

`tests/brand.test.ts` checks that the manifests reference only icons
the generator writes, each PNG at its size; that every master it reads
is fill-only; that the in-UI mark carries the 16 and 32 masters'
paths and lands on whole device pixels; that `--brand` is the masters'
colour; and that every master and output still hashes to its entry in
`icons.lock.json`. A master swapped, or an output edited, without
running `pnpm icons` therefore fails. The test renders nothing:
whether a new PNG looks right is yours to check before committing.

The small drawings must keep their pixel grid (16 and 32 units square)
for the PNGs and the in-UI mark to stay crisp, and the in-UI slot (the
taller of the two drawings cropped to their ink) must come out an odd
number of CSS px tall, today 16×15 (`docs/notes/ui.md`
§ masthead-mark). A new colour also goes into `--brand` in
`src/styles/brreg.css`; the test fails until it does.
