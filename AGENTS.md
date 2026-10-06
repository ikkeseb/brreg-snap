# AGENTS.md

Guidance for coding agents in this repository. `CLAUDE.md` only imports
this file; edit this one. Machine- and account-specific rules for the
maintainer's own sessions live in a local, gitignored `MAINTAINER.md`
at the repo root: read it when it exists.

## Active work + release rules

Active work is driven by `docs/plans/2026-09-23-plan.md` — read its
Decisions and Progress first; evidence per item is in
`docs/plans/2026-09-23-findings.md`. Unscheduled ideas and the rejected
list live in `docs/backlog.md`. Release state lives in git tags (`v*` =
tagged release, `amo-submission-*` / `cws-submission-*` = what was
uploaded to each store) and GitHub Releases. Store state is never
written down; run `pnpm store-status` (`--deep` compares the served
packages with the Release).

- `main` is the only branch that lives. One maintainer, so work lands
  on `main` directly once `pnpm verify` is green (the pre-push hook
  enforces it); a branch + PR is for when you want CI's browser smoke
  before `main`, not a requirement. CI still runs smoke on every push to
  `main`: a red smoke there is fixed forward first.
- The one public contact, everywhere: `sebastian@nuez.no`.
- Releasing and store publishing (`pnpm release`, the generated
  submission kit, `release.yml`, `publish.yml`): `docs/release.md`.

## Definition of done

The verification rungs, lowest first; they are the surfaces to name
when reporting a change as done:

1. **`pnpm verify` is green.** It is the gate CI, the release workflow
   and the pre-push hook all run.
2. **Data-dependent or visual change: checked against the live API**
   in `scripts/preview/` (both themes, popup and the 320 px panel), and
   `pnpm smoke` for the recorded state matrix. Synthetic fixtures and
   the preview harness have both passed while the live data shape broke
   a feature, so fixtures alone never count. Cloud sessions may block
   `data.brreg.no`.
3. **Real extension load:** `pnpm dev` (Firefox) or `dist-chrome/`
   loaded unpacked.
4. **Maintainer only:** real permission prompts, the gesture-gated
   panel open anywhere but the popup's button in Chromium (the smoke
   clicks that one), store credentials and listings, approving each
   `publish.yml` run.

## Commands

`package.json` lists every script; these are the ones with a catch.
`pnpm install` points git at the committed pre-push hook (it runs
`pnpm verify`); `git push --no-verify` is the conscious bypass.

```bash
pnpm verify                     # the gate (~12 s): typecheck, lint, test, check:docs, both builds, verify:dist, lint:ext
pnpm exec vitest run tests/orgnr.test.ts                                 # one file
pnpm exec vitest run -t "rejects numbers whose check digit would be 10"  # one test
pnpm smoke                      # Playwright: harness states x widths x themes + a real Chromium load (toolbar click, popup, side panel); not in the gate (CI runs it); once: pnpm exec playwright install chromium
pnpm smoke:record               # re-record tests/e2e/fixtures/ from the live API; review the diff
pnpm test:live                  # live brreg canary: API contracts + resolver corpus (network; not in the gate)
pnpm preview                    # the built pages in a plain tab against the live API (scripts/preview/README.md)
pnpm dev                        # the real extension in a Firefox profile (dev:chrome for Chromium)
pnpm release X.Y.Z [--dry-run]  # then --tag; docs/release.md
pnpm store-status [--deep]      # live AMO/CWS versions vs the tags
```

There is no Vite dev server for an extension popup: use `pnpm dev` or
`pnpm preview`. Chrome's side panel needs `dist-chrome/` loaded
unpacked (`chrome://extensions` → Developer mode → Load unpacked).

One source tree, two targets (`--mode firefox|chrome` → `dist-firefox/`,
`dist-chrome/`): only the manifest differs at build time
(`docs/notes/build.md` § dual-browser-build), and engine differences
are runtime checks (`docs/notes/platform.md`). Store uploads are the CI
release artifacts only; `.gitattributes` forces LF so local and CI
builds match.

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
| brreg API: regnskap base URL + several years and group (KONSERN) rows, regnskap 500 = not in the open API, error contract (search throws, `[]` = real empty), no signatur, name search matches a dot literally (finn.no misses because FINN was renamed), konsernstruktur (whole group, duplicate parents), annual-report copies + kunngjøringer links, live canary | `src/lib/brreg.ts`, `regnskap.ts`, `konsern.ts`, `aarsregnskap.ts`, `tests/live/` | `docs/notes/brreg-api.md`         |
| Build/tooling: Vite popup.html relocation, clipboard without `clipboardWrite` | `vite.config.ts`, `src/lib/copy-orgnr.ts` | `docs/notes/build.md`             |
| Trust view: answer priority, signals (deadline-aware regnskap, rekonstruksjon, NUF), merknader (påtegninger), endringer + the change feed | `src/lib/trust/*.ts`, `src/lib/brreg-endringer.ts`, `company-load.ts` | `docs/notes/trust.md`             |
| Stores: store-status probe + verdict rules, what AMO/CWS change in a package; listing text lives in `docs/amo-submission.md` / `docs/cws-submission.md` (the kit renders from their anchors) | `scripts/store-status*.mjs`, `.github/workflows/store-status.yml` | `docs/notes/stores.md`            |
| UI system (1.4): the loudness rule, tokens + type scale, font + CSP, the component inventory (module → API → markup), the a11y contract, the popup's 600 px budget, seat amendments, the panel's search view + compact head + tab landing, the badge rule, the welcome page | `src/styles/brreg.css`, `src/lib/view/{trust-view,dossier-view,copy}.ts`, `src/lib/view/components/*.ts`, `src/popup/views.ts`, `src/details/{painter,tabs}.ts`, `src/welcome/` | `docs/notes/ui.md`                |

UI work starts in `docs/notes/ui.md`. Three rules bite most often:
every user-facing string lives in `src/lib/view/copy.ts`; no `style`
attributes (CSP), so state is classes and `data-*` / `aria-*` and
computed widths go through `style.setProperty`; a signal whose fetch
failed is omitted, never rendered as "not filed".

### Docs conventions

- Cross-doc references read `path` § `slug`, where the slug is a
  `<!-- SECTION: slug -->` anchor in the target; `pnpm check:docs`
  (in `pnpm verify`) fails when a backticked repo path or an anchor
  doesn't resolve.
- Cite files, symbols or tags, never short commit hashes. History
  lives in git and `CHANGELOG.md`.
- Tracked docs are public: name the maintainer's role, not their
  machines, profiles or accounts (those go in `MAINTAINER.md`).

## No curated data

Every orgnr resolves via the live brreg API only — no static
hostname → orgnr table, even for hard cases (FINN.no, regulated
subsidiaries). Hosts brreg can't disambiguate fall through to the
inline manual search in both popup and sidebar empty states.

## Security constraints

These are the product differentiator, not preferences (`README.md`
§ Security model says it to users). Relaxing one is the maintainer's
product decision: it needs their explicit OK and an edited invariant,
never a workaround.

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

The `tabs` opt-in flow (a runtime request from the panel's
«Auto-oppdater» consent step, `permissions.remove` on off) is
`docs/notes/permissions-model.md` § tabs-runtime-optin; why the data
declarations read as they do is § data-collection-declaration there.

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
