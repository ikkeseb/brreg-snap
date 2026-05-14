# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run typecheck                          # tsc --noEmit
npm run lint:ts                            # ESLint on src/**/*.ts
npm run lint:ext                           # web-ext lint on dist/ (run build first)
npm test                                   # vitest run
npm run test:watch                         # vitest interactive
npx vitest run tests/orgnr.test.ts         # single file
npx vitest run -t "rejects cd=10"          # single test by name
npm run build                              # production build to dist/
npm run watch                              # vite build --watch
npm run dev                                # build + web-ext run (Firefox dev profile)
npm run package                            # build + .xpi to web-ext-artifacts/
```

`npm run dev` is the only way to exercise the popup — there is no Vite
dev server for popup-only extensions.

## Architecture

The README covers the user-facing flow and security model. What it
doesn't cover, and what costs time to rediscover:

**`src/lib/mod11.ts` exists to break an ESM cycle.** `domains.ts`
runs a module-load invariant that every table entry passes mod-11,
which means it must import `isValidOrgnr`. `orgnr.ts` imports
`domainToOrgnr` for the fallback resolution cascade. If mod-11
lives in `orgnr.ts` directly, those modules cycle and the invariant
crashes with "isValidOrgnr is not a function" at test-run time. Keep
mod-11 in its own zero-dependency module.

**Resolution cascade.** `resolveOrgnr` in `src/lib/orgnr.ts:34` tries
URL regex → title regex → domain table, in that order. The regex
iterates every 9-digit run via `matchAll` and accepts the first
mod-11 valid candidate — needed because an upstream phone number or
article id can shadow a real orgnr in the same string.

**24h cache.** `src/lib/brreg.ts` wraps every API call in
`browser.storage.session` for 24 hours. `storage.session` is
in-memory, process-local, and cleared when the browser shuts down —
not `storage.local`. Cache writes are typed (`CacheEntry<T>` with
`expiresAt`) and reads validate the response shape via `isEnhet`
before returning (no blind `as Enhet` cast).

**Search debounce + race guard.** `src/popup/popup.ts` uses a
monotonic `searchRunId` token to drop stale `runSearch` results when
the user keeps typing — the network can land calls out of order
otherwise. Don't simplify this away.

**Sidebar sync = `runtime.sendMessage`, not `setPanel`.**
`sidebarAction.setPanel({panel: url})` *should* repaint an open
sidebar per MDN, but in Firefox 115+ it doesn't — the panel URL is
updated for the next open, the visible iframe stays put. The popup
therefore broadcasts a `{type:'sync', orgnr}` `runtime.sendMessage`
in addition to `setPanel`, and `src/details/details.ts` listens for
it, calls `history.replaceState`, and re-runs its loader.
`Promise.allSettled` over the two calls because a missing listener
(sidebar closed) rejects `sendMessage` — that's expected, not a
failure.

**Sidebar resolves the active tab on load.** `details.ts` `init()`
calls `tabs.query` first and only falls back to the `?orgnr=` URL
param if no orgnr could be resolved from the active tab. The
sidebar gets an `activeTab` grant when Firefox toggles it (clicking
the sidebar icon, the toolbar action, or a shortcut), so URL/title
are readable in that window. Without grant the call silently
returns empty fields and we fall through to the URL param — no
permission relaxation involved.

**Sidebar load-run-id guard.** `details.ts` uses a monotonic
`loadRunId` token (same pattern as `searchRunId` in the popup) so a
sync push that arrives while a previous `loadOrgnr` is still
fetching doesn't get overwritten by the older response. Keep it.

**Vite popup.html path quirk.** Vite emits HTML entries at the same
relative path they live at in the source (so
`src/popup/popup.html` → `dist/src/popup/popup.html`). The manifest
expects `popup/popup.html`. `vite.config.ts` `closeBundle` relocates
the file and deletes `dist/src/`. Removing this hook breaks the
packaged extension silently.

**No signatur fetcher — endpoint doesn't exist publicly.** The brreg
open API does not expose signaturrett/prokura on `/api/enheter/<orgnr>`
and the nested `/signatur` path returns 404. The data lives only
behind paid Foretaksregisteret endpoints. `src/lib/brreg.ts` has a
comment marking this; `details.html` keeps a hidden `#signatur` card
in case the field becomes available. Don't waste a session trying to
re-discover the gap.

**Regnskap is on a different API base.** Enhetsregisteret lives at
`data.brreg.no/enhetsregisteret/api`, but Regnskapsregisteret is on
`data.brreg.no/regnskapsregisteret/regnskap/<orgnr>` (no `/api/`,
different sub-host). Response is an array (one entry per filed
year, order is *not* guaranteed — sort by `regnskapsperiode.tilDato`
before picking "latest"). 404 is normal: many small AS-er don't
file separately. Cache the empty array so refresh doesn't re-hit.
**500 is its own category:** banks, insurance and similar regulated
sectors file under specialised oppstillingsplaner (`BANK`, `FORS`)
that the public endpoint refuses to serialise — DNB BANK ASA
(984851006) hits this. The body is JSON with
`"message": "Regnskapet inneholder en oppstillingsplan som ikke er
stottet (BANK)"` and a stack trace. `fetchRegnskap` returns
`RegnskapResponse = { items: Regnskap[]; unsupportedPlan?: string }`;
`parseUnsupportedPlan` extracts the `(BANK)` / `(FORS)` code from
the 500 body via `/\(([A-Z]+)\)/` and stores it. The UI renders a
distinct "Filer som bankregnskap (BANK) — ikke tilgjengelig i
offentlig API." line instead of pretending the company didn't file.
Both empty results and unsupported-plan results are cached so refresh
doesn't re-hit.

**Auto-sync on tab switch is blocked by the permission model — by
design.** `activeTab` grants extension UI access to *one* tab on
user gesture (popup click, sidebar toggle, shortcut). When the
sidebar is open and the user switches tabs in Firefox, no new
gesture fires against the extension, so `tabs.query` returns empty
URL/title for the new tab. `tabs.onActivated` fires without `tabs`
permission but its `Tab` object is stripped of URL/title for the
same reason. The permissionless paths out: (a) require a fresh
gesture against the *toolbar/shortcut* surface (click sidebar icon,
ctrl+shift+B), or (b) accept the limitation. Escalating to `tabs`
would relax the security differentiator — see the constraints
section. Don't burn cycles re-investigating `webNavigation`,
`tabs.onUpdated`, or focus events; they all need `tabs` or content
scripts.

**A button *inside the sidebar iframe* does NOT grant activeTab.**
Tested empirically: a sync button rendered inside the sidebar that
called `tabs.query({active:true, currentWindow:true})` got the same
empty `url`/`title` as `tabs.onActivated`. The user-gesture grant is
scoped to the toolbar/sidebar-action surface, not clicks inside the
already-loaded panel. There used to be a sync button in the sidebar
header for this — it was removed because the hypothesis was wrong.
Don't re-add it.

**Click-to-copy on orgnr lives in `src/lib/copy-orgnr.ts`.** Shared
helper used by the popup result row, sidebar header, and
underenheter table cells. `navigator.clipboard.writeText` works in
extension contexts without `clipboardWrite` in the manifest as long
as the call is in a user-gesture stack (i.e. inside a click handler)
— which it is. Don't add `clipboardWrite` to the permission list.

**Before curling brreg, check the official docs.** Enhetsregisteret
API is documented at
`https://data.brreg.no/enhetsregisteret/api/dokumentasjon/no/index.html`
(Norwegian; English at `/en/index.html`). The overall dataset and
API catalogue — including Regnskapsregisteret, Frivillighetsregister
and others — lives at
`https://www.brreg.no/bruke-data-fra-bronnoysundregistrene/datasett-og-api/`.
Reach for these before probing endpoints by trial-and-error — most
field shapes and pagination quirks are spelled out there.

## Curator discipline for `src/lib/domains.ts`

mod-11 validity is necessary but **not sufficient** — an orgnr can
pass mod-11 and still point at the wrong entity (caught in audit:
`sparebank1.no → 975966453` resolved to "KREDITTBANKEN ASA"). When
adding entries, always:

1. Verify via `GET https://data.brreg.no/enhetsregisteret/api/enheter/<orgnr>`
2. Confirm `navn` matches the company that owns the domain
3. Brreg's name search drops periods — `?navn=FINN.no` returns
   garbage. For domains with periods in the legal name, fall back
   to proff.no or manual register lookup.

The module-load invariant in `domains.ts` catches checksum typos.
Semantic correctness is on the curator.

## Security constraints (non-negotiable)

These are the product differentiator, not preferences. See
`README.md` § Security model and
`../the-vault/projects/portfolio/plan-brreg-now.md` § Architecture.

- No content scripts. `manifest.json` has none and must continue to.
- Only `data.brreg.no` in `host_permissions`. No new hosts.
- Permissions are `activeTab` + `storage`. No `tabs`, no
  `<all_urls>`, no `cookies`.
- CSP keeps `default-src 'self'` with `base-uri`, `form-action`, and
  `frame-ancestors` all `'none'`. Don't add `'unsafe-inline'`, remote
  script hosts, or relax these directives.
- No `eval`, no `Function()` constructor, no remote-loaded code.

PRs that relax any of the above will be rejected.

## Dependencies

Zero runtime dependencies in the shipped bundle (everything is
inlined TypeScript). `npm audit --omit=dev` should always return 0.
The advisories in `web-ext`'s transitive chain are dev-only and do
not enter the extension — defer the breaking `web-ext` 10.x upgrade
until something actually exercises a vulnerable path.
