# AGENTS.md

Guidance for coding agents in this repository. `CLAUDE.md` only imports
this file; edit this one.

## Active work + release rules

Active work is driven by `docs/plans/2026-09-23-plan.md` — read its
Decisions and Progress first; evidence per item is in
`docs/plans/2026-09-23-findings.md`. Unscheduled ideas and the rejected
list live in `docs/backlog.md`. Release state lives in git tags (`v*` =
tagged release, `amo-submission-*` / `cws-submission-*` = what was
uploaded to each store) and GitHub Releases. Store state is never
written down; run `pnpm store-status` (`--deep` compares the served
packages with the Release).

- `main` is the only long-running branch. Docs-only changes that don't
  affect the `.xpi` may land on `main` directly.
- Support email everywhere: `sebastian@nuez.no`.
- Releasing and store publishing (`pnpm release`, the generated
  submission kit, `release.yml`, `publish.yml`): `docs/release.md`.

## Definition of done

Say which rung you reached; "done" without one means rung 1 only.

1. **`pnpm verify` is green.** It is the gate CI, the release workflow
   and the pre-push hook all run.
2. **Data-dependent or visual change: checked against the live API**
   in `scripts/preview/` (both themes, popup and the 320 px panel), and
   `pnpm smoke` for the recorded state matrix. Synthetic fixtures and
   the preview harness have both passed while the live data shape broke
   a feature, so fixtures alone never count. When the network blocks
   `data.brreg.no` (cloud sessions), report the live check as not run.
3. **Real extension load:** `pnpm dev` (Firefox) or `dist-chrome/`
   loaded unpacked.
4. **Seb only:** permission prompts, the gesture-gated side panel open,
   store credentials, and approving each `publish.yml` run. Store
   listing edits happen in his logged-in browser on the Mac
   (`docs/release.md` § What stays manual).

## Commands

This project uses **pnpm** (pinned via `packageManager` in
`package.json`). Don't run `npm install` — it will recreate
`package-lock.json` next to `pnpm-lock.yaml` and drift the dep tree.

`pnpm verify` = `verify:fast` (typecheck + lint + test), `check:docs`,
both builds, `verify:dist`, `lint:ext`. `pnpm install` points git at the
committed hook (`prepare` sets `core.hooksPath .githooks`); `git push
--no-verify` is the conscious bypass. The browser smoke (`pnpm smoke`)
is NOT in the gate or the hook (it needs a browser): CI runs it as its
own `smoke` job after `ci`.

```bash
pnpm verify                                # the full gate (about 12 s)
pnpm verify:fast                           # typecheck + lint + test
pnpm typecheck                             # tsc: src, tests/, tsconfig.node.json projects
pnpm lint                                  # ESLint on src, tests, scripts (not scripts/preview/), configs; 0 warnings
pnpm check:docs                            # backticked repo paths and § anchors in the live docs resolve
pnpm lint:ext                              # web-ext lint on dist-firefox/; fails on errors + unlisted warnings
pnpm verify:dist                           # dist manifests + the files they reference, file set, no eval/Function (AST); run both builds first
pnpm test                                  # vitest run
pnpm smoke                                 # build:chrome + Playwright smoke (tests/e2e/): harness states x widths x themes + real Chromium load; screenshots in test-results/
pnpm smoke:record                          # re-record tests/e2e/fixtures/ from the live API (build:chrome first; review the diff)
pnpm exec playwright install chromium      # one-time browser download for the smoke
pnpm preview                               # build:chrome + the preview harness on the live API (scripts/preview/README.md)
pnpm test:watch                            # vitest interactive
pnpm test:live                             # live brreg canary: API contracts + resolver corpus (network; not in verify)
pnpm exec vitest run tests/orgnr.test.ts   # single file
pnpm exec vitest run -t "rejects numbers whose check digit would be 10"  # single test by name
pnpm build                                 # = build:firefox (default target)
pnpm build:firefox                         # vite build --mode firefox -> dist-firefox/
pnpm build:chrome                          # vite build --mode chrome   -> dist-chrome/
pnpm watch                                 # vite build --watch (firefox target)
pnpm dev                                   # = dev:firefox (build + web-ext run, FF profile)
pnpm dev:chrome                            # build:chrome + web-ext run -t chromium
pnpm package                               # = package:firefox (.xpi/.zip, maps stripped)
pnpm package:chrome                        # dist-chrome/ -> CWS-ready .zip (manifest at root)
pnpm release X.Y.Z [--dry-run]             # bump, date CHANGELOG, verify, render kit (docs/release.md)
pnpm release X.Y.Z --tag                   # commit + annotated tag vX.Y.Z; prints the push
pnpm store-status                          # live AMO/CWS versions vs tags; --deep diffs packages, --strict for CI
```

There is no Vite dev server for popup-only extensions: `pnpm dev`
exercises the popup as an extension, and `pnpm preview` renders the
built pages in a plain tab. Chrome has no `web-ext run` parity for the
side panel; load `dist-chrome/` unpacked via `chrome://extensions` →
Developer mode → "Load unpacked" instead.

### Dual-browser build

One source tree, two targets via `vite build --mode firefox|chrome`.
Outputs go to `dist-firefox/` and `dist-chrome/`; the matching
`public/manifest.<browser>.json` is copied to `manifest.json` by the
`copy-static-assets` plugin in `vite.config.ts` (`publicDir` is
disabled so the source manifests don't leak). Engine differences are
isolated in `src/lib/platform/` — see `docs/notes/platform.md`. Store
uploads are the CI release artifacts only (`.gitattributes` forces LF
so local and CI builds match; AMO re-serialises the manifest when it
signs, so the shipped one is never byte-identical anyway).

## Architecture — routing table

Topic notes live in `docs/notes/`. Each note has stable
`<!-- SECTION: ... -->` anchors that `grep` can target. Hit the
note before reading the source file.

| Concern                                       | Source                          | Note                              |
| --------------------------------------------- | ------------------------------- | --------------------------------- |
| Resolution cascade, provenance (resolution method), Kobling, scoring bands + hjemmeside ties, registrable domain + site keys, picker choice + undo, title word hints, orgnr → underenhet fallback | `src/lib/orgnr.ts`, `mod11.ts`, `resolution-method.ts`, `hostname-search.ts`, `hostname-score.ts`, `company-load.ts`, `trust/kobling.ts` | `docs/notes/resolution.md`        |
| Session cache (TTL, sweep, data age), failures never cached, race guards (manual search `runId`, popup `loadRunId`, the panel's load token) | `src/lib/session-cache.ts`, `brreg.ts`, `hostname-search.ts`, `ui/manual-search.ts`, `panel-follow.ts`, `src/popup/popup.ts`, `src/details/controller.ts` | `docs/notes/cache.md`             |
| Sidebar sync: panel-hosted auto-sync, window-scoped messages, same-view keep | `src/details/{controller,main,painter}.ts`, `src/lib/panel-protocol.ts`, `panel-follow.ts`, `tab-sync.ts`, `popup/popup.ts`, `background/background.ts` | `docs/notes/sidebar-sync.md`      |
| Engines: manifest split, the in-house `browser` shim (no polyfill), runtime `isFirefox` checks, sidebar vs side panel + the `sidePanel.open` gesture, `menus` vs `contextMenus`, the `onUpdated` filter, event page vs service worker, `lint:ext` Firefox-only | `src/lib/platform/*.ts`, `public/manifest.*.json`, `src/background/background.ts`, `src/lib/tab-sync.ts`, `scripts/lint-ext.mjs` | `docs/notes/platform.md`          |
| Permissions: `activeTab` limits, runtime `tabs` opt-in + consent step, gesture-stack rules, background wake-up, `browsingActivity` declaration, selection lookup + `commands` + toolbar badge (no new permission) | `public/manifest.*.json`, `src/background/background.ts`, `src/details/auto-sync-switch.ts`, `src/lib/auto-sync-*.ts`, `src/lib/platform/badge.ts` | `docs/notes/permissions-model.md` |
| brreg API: regnskap base URL + latest year only, regnskap 500 = not in the open API, error contract (search throws, `[]` = real empty), no signatur, name search matches a dot literally (finn.no misses because FINN was renamed), konsernstruktur (whole group, duplicate parents), annual-report copies + kunngjøringer links, live canary | `src/lib/brreg.ts`, `regnskap.ts`, `konsern.ts`, `aarsregnskap.ts`, `tests/live/` | `docs/notes/brreg-api.md`         |
| Build/tooling: Vite popup.html relocation, clipboard without `clipboardWrite` | `vite.config.ts`, `src/lib/copy-orgnr.ts` | `docs/notes/build.md`             |
| Trust view: answer priority, signals (deadline-aware regnskap, rekonstruksjon, NUF), merknader (påtegninger), endringer + the change feed | `src/lib/trust/*.ts`, `src/lib/brreg-endringer.ts`, `company-load.ts` | `docs/notes/trust.md`             |
| Stores: store-status probe + verdict rules, what AMO/CWS change in a package; listing text lives in `docs/amo-submission.md` / `docs/cws-submission.md` (the kit renders from their anchors) | `scripts/store-status*.mjs`, `.github/workflows/store-status.yml` | `docs/notes/stores.md`            |
| UI system (1.4): the loudness rule, tokens + type scale, font + CSP, the component inventory (module → API → markup), the a11y contract, the popup's 600 px budget, seat amendments, the panel's search view + compact head + tab landing, the badge rule, the welcome page | `src/styles/brreg.css`, `src/lib/view/{trust-view,dossier-view,copy}.ts`, `src/lib/view/components/*.ts`, `src/popup/views.ts`, `src/details/{painter,tabs}.ts`, `src/welcome/` | `docs/notes/ui.md`                |

The panel is a controller (`src/details/controller.ts`, the state
machine, tested with a fake painter) behind a painting seam
(`src/details/view.ts`) that `src/details/painter.ts` implements with
the shared components; `main.ts` wires the document and the browser.
The tab content is built as data in `src/lib/view/dossier-view.ts` and
painted by `src/lib/view/components/{oversikt,personer,okonomi,
enheter,notes}.ts`.

Frontend system (1.4, «Dossier, stamped», `docs/notes/ui.md`): tokens
and every component live in `src/styles/brreg.css` (light + dark via
`prefers-color-scheme` and `.theme-*`); `popup.css` / `details.css` /
`welcome.css` keep layout only. One view model,
`src/lib/view/trust-view.ts` (`buildTrustView`, with the panel's tab
content from `dossier-view.ts`), feeds the popup, the panel and the
welcome page's examples; the components in `src/lib/view/components/`
are pure DOM writers and every user-facing string is in
`src/lib/view/copy.ts`. Loudness follows severity: ok is a quiet band,
warn a firmer band with the way out inside it, danger a stamp. A
signal whose fetch failed is OMITTED, never rendered as "not filed".
No `style` attributes (CSP): state is classes and `data-*` / `aria-*`,
computed widths go through `style.setProperty`. `src/welcome/` is the
first-run page the install hook opens once (no network).

### Docs conventions

- A note owns its topic; other docs point at it instead of restating
  it. Cross-doc references read `path` § `slug`, where the slug is a
  `<!-- SECTION: slug -->` anchor in the target; `pnpm check:docs`
  (in `pnpm verify`) fails when a backticked repo path or an anchor
  doesn't resolve.
- Cite files, symbols or tags, never short commit hashes.
- Living docs hold decisions and invariants; history belongs to git and
  `CHANGELOG.md`.

```bash
# Pull a single gotcha by anchor:
grep -n 'SECTION: regnskap-500-unsupported-plan' docs/notes/brreg-api.md
```

## No curated data

Every orgnr resolves via the live brreg API only — no static
hostname → orgnr table, even for hard cases (FINN.no, regulated
subsidiaries). Hosts brreg can't disambiguate fall through to the
inline manual search in both popup and sidebar empty states. Both
empty states also surface a `storage.session`-scoped recents list
(`src/lib/ui/recent.ts`, max 5) so the user can re-open a recently
viewed orgnr without re-typing.

## Security constraints

These are the product differentiator, not preferences (`README.md`
§ Security model says it to users). Relaxing one is a product decision
for Seb: it needs his explicit OK and an edited invariant, never a
workaround.

| Rule | Enforced by |
| --- | --- |
| No content scripts; no `web_accessible_resources`, `externally_connectable` or any other unlisted manifest key | exact key lists in `scripts/manifest-invariants.mjs`, run on the source manifests by `tests/manifest.test.ts` and on the built ones by `pnpm verify:dist` |
| Install-time permissions exactly: Firefox `activeTab` + `storage` + `menus`; Chrome `activeTab` + `storage` + `contextMenus` + `sidePanel`. No `<all_urls>`, `cookies`, `webRequest` | same |
| `tabs` is `optional_permissions` only, requested at runtime (below) | same |
| `data.brreg.no` is the only host permission | same |
| CSP is exactly the strict policy: `default-src 'self'`, `base-uri` / `form-action` / `frame-ancestors` all `'none'`, no `'unsafe-inline'`, no remote script hosts | same |
| Firefox declares `browsingActivity` as required data collection; Chrome ships no gecko block (the CWS privacy tab discloses web history) | `tests/manifest.test.ts` (data collection declaration) |
| No `eval`, no `Function()`, no remote-loaded code | `src` lint rules in `eslint.config.js` (pinned by `tests/lint-security.test.ts`) and the AST scan of the built JS (`scripts/codegen-scan.mjs`, in `verify:dist`) |
| No HTML sinks (`innerHTML` & co.) in `src`: brreg text is written by the registrants themselves | `src` lint rules, `tests/lint-security.test.ts` |

`tabs` opt-in flow: the user flips «Auto-oppdater» in the sidebar's
masthead and confirms the inline disclosure, whose «Slå på» click calls
`permissions.request({permissions: ['tabs']})`; flipping off calls
`permissions.remove`. `menus` is on Mozilla's no-prompt list, so the
install dialog advertises only `activeTab` + storage + the brreg host
(plus, on Firefox 140+, the `browsingActivity` declaration). The data
declarations stay honest because the visited site's domain goes to
data.brreg.no.

## Dependencies

Zero runtime dependencies in the shipped bundle (everything is
inlined TypeScript). `pnpm verify` enforces it: the build fails when
any module outside `src/`, or any non-`.ts` script, enters the bundle
graph (`scripts/build-graph.mjs`); ESLint bans non-relative imports in
`src/`; `verify:dist` fails if `package.json` gains a `dependencies`
field. Every package is a dev dependency, so `pnpm audit` advisories
concern the toolchain, not the extension. `@types/node` follows the
Node major in `.node-version` (`.github/dependabot.yml` holds the
bound).
