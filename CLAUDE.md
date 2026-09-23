# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Active work + release rules

Active work is driven by `docs/plans/2026-09-23-plan.md` — read its
Decisions and Progress first; evidence per item is in
`docs/plans/2026-09-23-findings.md`. Release state is not restated
here: it lives in git tags (`v*` = tagged release, `amo-submission-*`
= what was uploaded to the stores) and GitHub Releases.

- `main` is the only long-running branch. Docs-only changes that don't
  affect the `.xpi` may land on `main` directly.
- Support email everywhere: `sebastian@nuez.no`.
- Store submission kit: when prepping a store submission, generate a
  **committed** kit in `docs/submission-kit/<version>/` — one file per
  destination (amo.md, cws.md) with the EXACT copy-paste text for every
  store form field plus release notes, topped with a short numbered
  upload recipe. Source the content from `docs/amo-submission.md`,
  `docs/cws-submission.md` and `CHANGELOG.md`; those stay canonical.
- Chrome-port history + decision log (D1–D15): `docs/chrome-port.md`
  (historical).

Standing gotchas that survive releases:

- **Dormant by API shape:** the multi-year Nøkkeltall trend table
  never renders — brreg's open regnskap API returns only the latest
  year, so `renderNokkeltall`'s `figures.length >= 2` branch is
  unreachable. Decided 2026-06-22: keep as future-proofing. See
  `docs/notes/brreg-api.md` § `regnskap-single-year-only`.
- Lesson from that feature: data-dependent rendering must be checked
  against the **live** API — synthetic fixtures and a hand-built
  preview harness both passed while the live data shape broke it.
- `renderParent` is the one render module that self-fetches and so
  needs its own run-id guard (kept since commit `024beec`).

## Commands

This project uses **pnpm** (pinned via `packageManager` in
`package.json`). Don't run `npm install` — it will recreate
`package-lock.json` next to `pnpm-lock.yaml` and drift the dep tree.

The gate is `pnpm verify` (CI, the release workflow and the pre-push
hook all run it): `verify:fast` (typecheck + lint + test), both builds,
`verify:dist`, `lint:ext`. `pnpm install` points git at the committed
hook (`prepare` sets `core.hooksPath .githooks`); `git push --no-verify`
is the conscious bypass.

```bash
pnpm verify                                # the full gate (about 12 s)
pnpm verify:fast                           # typecheck + lint + test
pnpm typecheck                             # tsc: src, tests/, tsconfig.node.json projects
pnpm lint                                  # ESLint on src, tests, scripts, configs; 0 warnings
pnpm lint:ext                              # web-ext lint on dist-firefox/ (run build first)
pnpm verify:dist                           # dist manifest invariants (run both builds first)
pnpm test                                  # vitest run
pnpm test:watch                            # vitest interactive
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
```

`pnpm dev` is the only way to exercise the popup — there is no Vite
dev server for popup-only extensions. Chrome has no `web-ext run`
parity for the side panel; load `dist-chrome/` unpacked via
`chrome://extensions` → Developer mode → "Load unpacked" instead.

### Dual-browser build (chrome-port)

One source tree, two targets via `vite build --mode firefox|chrome`. Outputs go
to `dist-firefox/` and `dist-chrome/`; the matching
`public/manifest.<browser>.json` is copied to `manifest.json` by the
`copy-static-assets` plugin in `vite.config.ts` (`publicDir` is
disabled so the source manifests don't leak). Engine differences are
isolated in `src/lib/platform/` — see `docs/chrome-port.md`. Store
uploads are the CI release artifacts only (`.gitattributes` forces LF
so local and CI builds match; AMO re-serialises the manifest when it
signs, so the shipped one is never byte-identical anyway).

## Architecture — routing table

Topic notes live in `docs/notes/`. Each note has stable
`<!-- SECTION: ... -->` anchors that `Grep` can target. Hit the
note before reading the source file.

| Concern                                       | Source                          | Note                              |
| --------------------------------------------- | ------------------------------- | --------------------------------- |
| Resolution cascade, scoring bands + hjemmeside ties, registrable domain, picker-choice cache, orgnr → underenhet fallback | `src/lib/orgnr.ts`, `mod11.ts`, `hostname-search.ts`, `hostname-score.ts`, `company-load.ts` | `docs/notes/resolution.md`        |
| Session cache (TTL, sweep, data age), failures never cached, race guards (manual search `runId`, popup `loadRunId`, the panel's load token) | `src/lib/session-cache.ts`, `brreg.ts`, `hostname-search.ts`, `ui/manual-search.ts`, `panel-follow.ts`, `src/popup/popup.ts`, `src/details/details.ts` | `docs/notes/cache.md`             |
| Sidebar sync: panel-hosted auto-sync, window-scoped messages, same-view keep | `src/details/details.ts`, `src/lib/panel-protocol.ts`, `panel-follow.ts`, `tab-sync.ts`, `popup/popup.ts`, `background/background.ts` | `docs/notes/sidebar-sync.md`      |
| Permissions: `activeTab` limits, runtime `tabs` opt-in + consent step, gesture-stack rules, background wake-up, `browsingActivity` declaration | `public/manifest.*.json`, `src/background/background.ts`, `src/details/details.ts`, `src/lib/auto-sync-*.ts` | `docs/notes/permissions-model.md` |
| brreg API: regnskap base URL + latest year only, regnskap 500 = not in the open API, error contract (search throws, `[]` = real empty), no signatur, search drops dots | `src/lib/brreg.ts`, `regnskap.ts` | `docs/notes/brreg-api.md`         |
| Build/tooling: Vite popup.html relocation, clipboard without `clipboardWrite` | `vite.config.ts`, `src/lib/copy-orgnr.ts` | `docs/notes/build.md`             |

Sidebar render functions are pure DOM writers in `src/details/render/*.ts`
(one module per section: header, overview, roles, parent, underenheter,
nokkeltall, plus shared helpers in `dom.ts`). No gotchas worth a topic
note — grep the source.

Frontend system (since Phase 3, 2026-07-04): design tokens + all shared
components live in `src/styles/shared.css` (dark base, light theme via
`prefers-color-scheme`); the surface CSS files keep layout/scale only.
The verdict strip (`src/lib/ui/verdict.ts`) synthesizes status / alder /
ansatte / regnskap under the company name on both surfaces — a signal
whose fetch failed is OMITTED, never rendered as "not filed". Visual
dev loop: `scripts/preview/` runs the real bundles against the live API
in a plain browser tab (see its README for limits).

Targeted lookups:

```bash
# Pull a single gotcha by anchor:
grep -n 'SECTION: regnskap-500-unsupported-plan' docs/notes/brreg-api.md
# Or just read the topic file end-to-end — they're short.
```

## No curated data

Every orgnr resolves via the live brreg API only — no static
hostname → orgnr table, even for hard cases (FINN.no, regulated
subsidiaries). Hosts brreg can't disambiguate fall through to the
inline manual search in both popup and sidebar empty states. Both
empty states also surface a `storage.session`-scoped recents list
(`src/lib/ui/recent.ts`, max 5) so the user can re-open a recently
viewed orgnr without re-typing.

## Security constraints (non-negotiable)

These are the product differentiator, not preferences. See
`README.md` § Security model.

- No content scripts. `manifest.json` has none and must continue to.
- Only `data.brreg.no` in `host_permissions`. No new hosts.
- Install-time permissions are `activeTab` + `storage` + `menus`.
  `tabs` lives in `optional_permissions` and is *runtime opt-in only*:
  the user must flip "Auto-oppdater ved fane-bytte" in the sidebar and
  confirm the inline disclosure, whose «Slå på» click calls
  `permissions.request({permissions: ['tabs']})`. Flipping off calls
  `permissions.remove`. No `<all_urls>`, no `cookies`, no
  `webRequest`. `menus` is on Mozilla's no-prompt list (silent at
  install). The install dialog therefore advertises only `activeTab` +
  storage + brreg host (plus, on Firefox 140+, the declared
  `browsingActivity` data collection) — `tabs` does not appear until
  the user explicitly grants it.
- Data declarations stay honest: the visited site's domain goes to
  data.brreg.no, so Firefox declares `browsingActivity` as required
  and the CWS privacy tab discloses web history. Pinned by
  `tests/manifest.test.ts`.
- CSP keeps `default-src 'self'` with `base-uri`, `form-action`, and
  `frame-ancestors` all `'none'`. Don't add `'unsafe-inline'`, remote
  script hosts, or relax these directives.
- No `eval`, no `Function()` constructor, no remote-loaded code.

PRs that relax any of the above will be rejected.

## Dependencies

Zero runtime dependencies in the shipped bundle (everything is
inlined TypeScript). `pnpm audit --prod` should always return 0.
The advisories in `web-ext`'s transitive chain are dev-only and do
not enter the extension — defer the breaking `web-ext` 10.x upgrade
until something actually exercises a vulnerable path.
