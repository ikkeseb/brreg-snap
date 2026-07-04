# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Release state + active work

**`v1.2.0` is tagged on `main`** (side-panel UX batch + slettedato
status fix, 2026-07-04) but **deliberately not store-submitted**: the
frontend overhaul (audit-plan Phase 3) lands first and ships to
AMO/CWS as **v1.3.0**. Until then **stores run `v1.1.0`** and
`amo-submission-1.1.0` remains the canonical reference for what AMO
reviewed. `main` is the only long-running branch. Docs-only changes
that don't affect the `.xpi` may land on `main` directly.

Active work is driven by `docs/plans/2026-07-04-fresh-eyes-audit.md`
(six phases; see its Progress block — Phases 1–2 done, Phase 3 next).
Support email everywhere: `sebastian@nuez.no`. When prepping a store
submission, generate a committed copy-paste kit in
`docs/submission-kit/<version>/` (recipe in the plan's Progress
block).
Chrome-port history + decision log (D1–D15): `docs/chrome-port.md`
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

```bash
pnpm typecheck                             # tsc --noEmit
pnpm lint:ts                               # ESLint on src/**/*.ts
pnpm lint:ext                              # web-ext lint on dist-firefox/ (run build first)
pnpm test                                  # vitest run
pnpm test:watch                            # vitest interactive
pnpm exec vitest run tests/orgnr.test.ts   # single file
pnpm exec vitest run -t "rejects cd=10"    # single test by name
pnpm build                                 # = build:firefox (default target)
pnpm build:firefox                         # BROWSER=firefox -> dist-firefox/
pnpm build:chrome                          # BROWSER=chrome   -> dist-chrome/
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

One source tree, two targets via `BROWSER=firefox|chrome`. Outputs go
to `dist-firefox/` and `dist-chrome/`; the matching
`public/manifest.<browser>.json` is copied to `manifest.json` by the
`copy-static-assets` plugin in `vite.config.ts` (`publicDir` is
disabled so the source manifests don't leak). The Firefox
`manifest.json` stays byte-identical to the AMO submission. Engine
differences are isolated in `src/lib/platform/` — see
`docs/chrome-port.md`.

## Architecture — routing table

Topic notes live in `docs/notes/`. Each note has stable
`<!-- SECTION: ... -->` anchors that `Grep` can target. Hit the
note before reading the source file.

| Concern                                       | Source                          | Note                              |
| --------------------------------------------- | ------------------------------- | --------------------------------- |
| Resolution cascade, sync↔async, scoring bands, picker-choice cache | `src/lib/orgnr.ts`, `mod11.ts`, `hostname-search.ts`, `hostname-score.ts` | `docs/notes/resolution.md`        |
| 24h cache, race guards (`searchRunId`, `loadRunId`) | `src/lib/brreg.ts`, `popup.ts`, `details.ts` | `docs/notes/cache.md`             |
| Sidebar sync (`sendMessage` vs `setPanel`, `no-match`) | `src/details/details.ts`, `popup/popup.ts`, `background/background.ts` | `docs/notes/sidebar-sync.md`      |
| Permissions: `activeTab` limits, runtime `tabs` opt-in, gesture-stack rules | `manifest.json`, `src/background/background.ts`, `src/details/details.ts`, `src/lib/auto-sync-*.ts` | `docs/notes/permissions-model.md` |
| brreg API: regnskap base URL, 500 = unsupported plan, no signatur, search drops dots | `src/lib/brreg.ts`              | `docs/notes/brreg-api.md`         |
| Build/tooling: Vite popup.html relocation, clipboard without `clipboardWrite` | `vite.config.ts`, `src/lib/copy-orgnr.ts` | `docs/notes/build.md`             |

Sidebar render functions are pure DOM writers in `src/details/render/*.ts`
(one module per section: header, overview, roles, parent, underenheter,
nokkeltall, plus shared helpers in `dom.ts`). No gotchas worth a topic
note — grep the source.

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
inline manual search in both popup and sidebar empty states. The
popup empty state also surfaces a `storage.session`-scoped recents
list (`src/popup/recent.ts`, max 5) so the user can re-open a
recently viewed orgnr without re-typing.

## Security constraints (non-negotiable)

These are the product differentiator, not preferences. See
`README.md` § Security model.

- No content scripts. `manifest.json` has none and must continue to.
- Only `data.brreg.no` in `host_permissions`. No new hosts.
- Install-time permissions are `activeTab` + `storage` + `menus`.
  `tabs` lives in `optional_permissions` and is *runtime opt-in only*:
  the user must flip "Auto-oppdater ved fane-bytte" in the sidebar,
  which calls `permissions.request({permissions: ['tabs']})` on
  click. Flipping off calls `permissions.remove`. No `<all_urls>`,
  no `cookies`, no `webRequest`. `menus` is on Mozilla's no-prompt
  list (silent at install). The install dialog therefore advertises
  only `activeTab` + storage + brreg host — `tabs` does not appear
  until the user explicitly grants it.
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
