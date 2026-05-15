# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This project uses **pnpm** (pinned via `packageManager` in
`package.json`). Don't run `npm install` — it will recreate
`package-lock.json` next to `pnpm-lock.yaml` and drift the dep tree.

```bash
pnpm typecheck                             # tsc --noEmit
pnpm lint:ts                               # ESLint on src/**/*.ts
pnpm lint:ext                              # web-ext lint on dist/ (run build first)
pnpm test                                  # vitest run
pnpm test:watch                            # vitest interactive
pnpm exec vitest run tests/orgnr.test.ts   # single file
pnpm exec vitest run -t "rejects cd=10"    # single test by name
pnpm build                                 # production build to dist/
pnpm watch                                 # vite build --watch
pnpm dev                                   # build + web-ext run (Firefox dev profile)
pnpm package                               # build + .xpi to web-ext-artifacts/
```

`pnpm dev` is the only way to exercise the popup — there is no Vite
dev server for popup-only extensions.

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

Targeted lookups:

```bash
# Pull a single gotcha by anchor:
grep -n 'SECTION: regnskap-500-unsupported-plan' docs/notes/brreg-api.md
# Or just read the topic file end-to-end — they're short.
```

## No curated domain table — pure brreg API

The extension resolves orgnrs only via URL/title regex and live
brreg lookups (`searchByHostname`'s multi-query pipeline with
3-band scoring). A static hostname → orgnr map used to live in
`src/lib/domains.ts`; it was removed because mod-11 validity is
**not** semantic correctness (caught in audit:
`sparebank1.no → 975966453` resolved to "KREDITTBANKEN ASA") and
hand-curation is a maintenance liability the product doesn't need.

Hosts brreg's own data can't disambiguate (e.g. `finn.no` — the
search index drops periods, so `?navn=FINN.no` returns garbage)
simply don't resolve. That's accepted — the sidebar's inline manual
search covers the gap and the user stays in control. Do **not**
re-introduce a curated table for "just the hard cases". Zero
curation is the principle, not a budget.

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
