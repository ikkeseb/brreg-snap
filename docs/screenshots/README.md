# Store screenshots

The current set is `v1.4-01-lookup.png` through `v1.4-05-search.png`.
Upload all five in numerical order to AMO and CWS. Each is a 1280×800
RGB PNG with Norwegian captions and the bundled Schibsted Grotesk font.

## Source

The UI captures come from a local `pnpm smoke` run on `dev` at the
commit «feat(brand): the refined overhand knot». The smoke runs the real
built UI through `scripts/preview/serve.mjs` with the recorded fixtures
in `tests/e2e/fixtures` and writes its captures to
`test-results/screenshots/`. No live API data was used for these images;
person names are fictional. The caption canvas is composed by a script
kept outside the repo; it adds no UI elements and does not alter the
captured text or data.

| Image | Capture under `screenshots/` | Crop in source pixels |
|---|---|---|
| 01 lookup | `popup-light/popup-dnb.png` | Entire 380×600 capture |
| 02 warnings | `panel-400-light/konkurs.png` | x=0, y=0, width=400, height=640 |
| 03 accounts | `panel-400-light/equinor-okonomi.png` | x=0, y=474, width=400, height=680 |
| 04 group | `panel-400-light/equinor-enheter.png` | x=0, y=474, width=400, height=640 |
| 05 search | `panel-400-light/search-view.png` | x=0, y=0, width=400, height=624 |

Captures keep their original pixel scale on the caption canvas, and
each crop ends between two rows, never through one.
The accounts and group crops start at the panel's compact company
header, matching the view after scrolling. The footer explicitly
labels the data as examples and the person names as fictional.

To regenerate the underlying captures, run `pnpm smoke`. The preview
setup and fixture limits are in `scripts/preview/README.md`.
