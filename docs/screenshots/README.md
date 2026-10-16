# Store screenshots

The current set is `01-lookup.png` through `05-search.png`, plus two
promo tiles.

- Screenshots: upload all five in numerical order to AMO and CWS. Each
  is a 1280×800 RGB PNG with Norwegian captions and the bundled
  Schibsted Grotesk font, in the light theme.
- `promo-small-440x280.png`: the CWS small promo tile (24-bit, no
  alpha).
- `promo-marquee-1400x560.png`: the CWS marquee promo tile (24-bit, no
  alpha), shown only if the listing is featured.

`promo-readme.avif` is not a store upload: it is the README's hero, a
silent, looping 1280×720 30 fps cut of the 15 s promo «Hele oppslaget»
(the bakery and its figures are fictional). The promo draws the UI from
geometry extracted from the real markup and 1.6.2's `src/styles/brreg.css`;
its build lives outside the repo. `promo-readme-poster.jpg`, the reel's
frame at 4 s (the popup card), is the fallback for a browser without
AVIF.

## Source

The UI captures come from the smoke harness (`pnpm smoke`) at v1.6.2, on
the fixtures re-recorded on 2026-10-15 («test(e2e): re-record fixtures
from the live API»). The smoke runs the real built UI through
`scripts/preview/serve.mjs` with the fixtures in `tests/e2e/fixtures`
and writes its captures to `test-results/screenshots/`; it makes no
live API request. The figures are real register data as of the
recording; person names are fictional (`tests/e2e/fixtures/README.md`
lists what the recorder replaces). The caption canvas and the promo
tiles are composed by scripts kept outside the repo; they add no UI
elements and do not alter the captured text or data. The tiles use the
horizontal lockup (`assets/brand/lockup-h.svg`).

| Image | Capture under `test-results/screenshots/` | Crop in source pixels |
|---|---|---|
| 01 lookup | `popup-light/popup-dnb.png` | Entire 380×600 capture |
| 02 warnings | `panel-400-light/konkurs.png` | x=0, y=0, width=400, height=640 |
| 03 accounts | `panel-400-light/equinor-okonomi.png` | x=0, y=474, width=400, height=670 |
| 04 group | `panel-400-light/equinor-enheter.png` | x=0, y=474, width=400, height=640 |
| 05 search | `panel-400-light/search-view.png` | x=0, y=0, width=400, height=624 |
| Marquee tile | `popup-light/popup-dnb.png` | x=0, y=0, width=380, height=509 |

Captures keep their original pixel scale on the caption canvas, and
each crop ends between two rows, never through one.
The accounts and group crops start at the panel's compact company
header, matching the view after scrolling; the accounts crop ends below
the Økonomi trend's sentences. The marquee's popup crop ends on the
rule above the popup's footer. The footer explicitly labels the data as
examples and the person names as fictional.

To regenerate the underlying captures, run `pnpm smoke`. The preview
setup and fixture limits are in `scripts/preview/README.md`.
