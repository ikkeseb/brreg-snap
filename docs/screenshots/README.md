# Store screenshots

The current set is `v1.4-01-lookup.png` through `v1.4-05-search.png`.
Upload all five in numerical order to AMO and CWS. Each is a 1280×800
RGB PNG with Norwegian captions and the bundled Schibsted Grotesk font.
Older files in this directory are historical.

## Source

The UI captures come from the `smoke-screenshots` artifact of GitHub
Actions run [36770498897](https://github.com/ikkeseb/brreg-snap/actions/runs/36770498897).
The smoke runs the real built UI through `scripts/preview/serve.mjs`
with `tests/e2e/fixtures`. No live API data was used for these images;
person names are fictional. The caption canvas adds no UI elements
and does not alter the captured text or data.

| Image | Capture under `screenshots/` | Crop in source pixels |
|---|---|---|
| 01 lookup | `popup-light/popup-dnb.png` | Entire 380×600 capture |
| 02 warnings | `panel-400-light/konkurs.png` | x=0, y=0, width=400, height=640 |
| 03 accounts | `panel-400-light/equinor-okonomi.png` | x=0, y=474, width=400, height=680 |
| 04 group | `panel-400-light/equinor-enheter.png` | x=0, y=474, width=400, height=680 |
| 05 search | `panel-400-light/search-view.png` | x=0, y=0, width=400, height=640 |

Captures keep their original pixel scale on the caption canvas.
The accounts and group crops start at the panel's compact company
header, matching the view after scrolling. The footer explicitly
labels the data as examples and the person names as fictional.

To regenerate the underlying captures, run `pnpm smoke`. The preview
setup and fixture limits are in `scripts/preview/README.md`.
