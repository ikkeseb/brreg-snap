# Fresh-eyes audit — execution plan (2026-07-04)

Product north star agreed with Seb: **a real product with real Norwegian
users** — not a portfolio piece. Frontend may be rethought freely; the
minimal-permissions security model may be challenged when the win is
large and the opt-in is clean.

Status when this plan was written: `feat/improvements` (v1.2.0 batch)
has just been fast-forward-merged into `main` and verified (typecheck,
lint, 279 tests, both builds green). **v1.2.0 is NOT yet tagged or
submitted to AMO/CWS.**

Work the phases top-down. Each phase is independently shippable.

## Progress (updated 2026-07-04, same day)

- **Phase 1: DONE**, with one deliberate deviation — v1.2.0 is tagged,
  packaged (`web-ext-artifacts/`, incl. lean source zip) and pushed,
  but **Seb decided to skip the 1.2.0 store submission**: Phase 3
  (frontend overhaul) lands first and ships to AMO/CWS as **v1.3.0**.
  Stores stay on 1.1.0 until then. No `amo-submission-1.2.0` tag will
  exist. No GitHub Release for v1.2.0 either (optional, can be added
  any time); v1.3.0 gets one automatically from the release workflow.
- **Phase 2: DONE** (same day): `tests/manifest.test.ts`, exact-match
  CI invariants, actions bumped to current majors (checkout@v7,
  setup-node@v6, pnpm/action-setup@v6 — the "@v5" below was stale),
  tag-triggered release workflow, `package:source`, dependabot.
- **Phase 3: CORE DONE** (2026-07-04, commit `331ec3b`): shared token
  layer (`src/styles/shared.css`), light+dark theme
  (prefers-color-scheme), system font stack (Inter dropped — was never
  bundled), dead accent variants deleted, **verdict strip** (status /
  alder / ansatte / regnskap — `src/lib/ui/verdict.ts`, popup now also
  fetches regnskap), flag unification (`primaryStatusFlag`,
  `deriveRegistryFlags`, `renderFlags`), Norwegian error mapping
  (`src/lib/ui/error-message.ts`), recents in the sidebar empty state
  (moved to `src/lib/ui/recent.ts`), real-button rows + aria-live in
  manual search, picker digit badges, copy-failure feedback, stale
  placeholder removed, dates/counts nb-NO-formatted. 336 tests.
  Items found ALREADY DONE pre-phase (plan was stale): amber accent is
  the shipped default, popup has a skeleton, both surfaces render the
  same four registry flags.
  **Verified via `scripts/preview/` harness** (real bundles, live API,
  screenshots light+dark). **Remaining before v1.3.0:** real-extension
  smoke (`pnpm dev` + Chrome unpacked — harness can't cover
  permissions/sidebar APIs), visual pass on error/konkurs/nyregistrert
  states, CHANGELOG + release prep per the standing instruction below.
- **Phase 5 item 4: DECIDED** — the durable support email is
  `sebastian@nuez.no` (updated in both submission docs).
- **Standing instruction for the release session:** when prepping the
  v1.3.0 store submission, generate a **submission kit** under
  `docs/submission-kit/<version>/` — **committed**, so it follows Seb
  across machines and doubles as an audit trail of exactly what was
  pasted into each store (same role as the `amo-submission` tags).
  One file per destination with the EXACT copy-paste text for every
  AMO/CWS form field + release notes, topped with a short numbered
  upload recipe. Source the content from `docs/amo-submission.md` /
  `docs/cws-submission.md` / `CHANGELOG.md`; keep those canonical.

---

## Phase 1 — Ship v1.2.0

1. **Fix the slettedato bug first (tag blocker by decision of this
   plan).** A dissolved entity renders a green "Aktiv" flag:
   `src/details/render/header.ts` and `src/popup/popup.ts` compute
   status from konkurs/avvikling only and ignore `slettedato`.
   Live-verified on orgnr `933004708` (slettedato 2024-05-31, API 200).
   Fix = treat `slettedato` as terminal negative status in both render
   paths ("Slettet" danger flag, suppress "Aktiv"). Add a test.
   Details: CLAUDE.md § Active long-running branches (Backlog bullet).
2. Tag `v1.2.0`, run `pnpm package` + `pnpm package:chrome`, submit to
   AMO + CWS, tag `amo-submission-1.2.0` per existing release habit
   (see docs/amo-submission.md, docs/cws-submission.md).
3. Post-release doc sweep — these all still describe pre-1.1.0 state
   as current and will mislead any future session or AMO reviewer:
   - `BUILD.md:54` + § "Known intentional skew" (claims 1.0.0/1.0.1
     skew that no longer exists; delete the section).
   - `vite.config.ts:85-88` comment (same stale skew claim).
   - `docs/chrome-port.md:29-40` ("Next: a Firefox v1.1.0 release" —
     shipped long ago) and `:84-135` (Architecture section describes
     the polyfill/alias design its own decision log D8/D9/D10
     reversed — mark superseded, point at README § Project layout).
   - CLAUDE.md § Active long-running branches — rewrite to reflect
     v1.2.0 shipped; trim to a few lines (it is always-loaded context).
   - `package.json:4` description still says "Firefox-utvidelse" —
     mention both browsers.

## Phase 2 — Lock the differentiator (CI + docs integrity)

1. **Close the manifest-invariant gaps** in `.github/workflows/ci.yml`
   (lines ~40-73). Current holes: install-time `permissions` array is
   not checked at all (a PR adding `cookies`/`scripting` passes green);
   CSP check is substring-based (`includes`), so
   `default-src 'self' https://evil.com` passes. Fix: exact-match
   `permissions` per target (FF: activeTab/storage/menus; Chrome:
   activeTab/storage/contextMenus/sidePanel), exact-match the full CSP
   string per target, explicitly fail on `unsafe-inline`/`unsafe-eval`.
2. **Move the invariants into a vitest test** (`tests/manifest.test.ts`
   reading both `public/manifest.*.json`) so they run locally in
   `pnpm test`, not only in a CI heredoc. CI keeps validating the
   stamped dist manifests.
3. Bump `actions/checkout`, `actions/setup-node`, `pnpm/action-setup`
   to @v5 — the roadmap deadline (2026-06-16, Node 20→24 runner
   migration) has already passed. Close the roadmap item.
4. Add a tag-triggered release workflow: build + package both targets +
   source zip, attach to a GitHub Release. Kills the manual-release
   version-skew class of error. While at it: add a `package:source`
   script (`git archive`), and `.gitattributes export-ignore` on
   `docs/screenshots/` — current source zip is 8.5 MB of which ~6 MB
   is screenshots AMO reviewers don't need.
5. Add `.github/dependabot.yml` (npm + github-actions, grouped).

## Phase 3 — Frontend overhaul

Do in this order; each step builds on the previous.

1. **Shared token layer.** `src/popup/popup.css` and
   `src/details/details.css` duplicate all design tokens and have
   already drifted (`--bg` #0a0e1a vs #080b14, `--bg-card` #131922 vs
   #11151f) plus copy-pasted components (.flag, .picker-*, .manual-*,
   .orgnr-copy, .ghost-link, .retry-button). Extract one shared
   tokens/components stylesheet; surfaces override only width/scale.
2. **Light + dark theme** via `prefers-color-scheme` (currently
   hardcoded dark-only — the single biggest "real product" gap; most
   Norwegian users run light browser themes). Requires semantic tokens
   from step 1. Set `color-scheme: light dark`.
3. **Brand decision:** logo PNG is amber, both HTML files hardcode
   `data-accent="teal"` (`:root` amber default never used). Pick ONE
   accent (recommend: match the logo), delete the dead accent variants.
4. **Typography decision:** Inter is first in the font stack with
   Inter-specific `cv` feature settings, but no font is bundled and CSP
   blocks external fonts — it renders for almost nobody. Either bundle
   a self-hosted woff2 or design for the system font stack and drop the
   cv settings.
5. **Verdict header (the big product idea).** Users' actual job is a
   trust assessment ("can I trust this company?"), but the UI is flat
   data rows. Add a synthesized judgment zone under the company name:
   status (aktiv/konkurs/slettet), company age (from
   registreringsdato), size band, "leverer regnskap?" —
   all derivable from data already fetched. Details stay below.
6. **Unify the duplicated render logic:** `makeFlag` exists in
   `src/lib/ui/flags.ts` AND privately in
   `src/details/render/header.ts`; flag sets differ (header adds
   Stiftelsesregistret + Frivillighetsregistret, popup doesn't) so
   popup and sidebar can show different status pills for the same
   company. One shared derive-flags-from-Enhet function.
7. Smaller fixes, all confirmed in code:
   - Sidebar empty-state message uses `--danger` red for a neutral
     hint (`details.css` .empty-message); popup uses muted. Use muted.
   - Raw `err.message` shown to users (`popup.ts` showError,
     `details.ts` equivalent) — map to Norwegian messages (offline /
     brreg down / unknown orgnr).
   - Manual-search results + recents are `<li tabIndex=0>` with
     Enter-only keydown — make them real `<button>`s (picker rows
     already are), announce result counts via aria-live.
   - Picker digit shortcuts (1-4/0/Esc in `src/lib/ui/picker.ts`) are
     invisible — show number badges.
   - Silent copy failure in `src/lib/copy-orgnr.ts` — show feedback.
   - Stale "Regnskapsdata kommer snart." placeholder in
     `details.html`.
   - Popup has no skeleton (sidebar does) — pick one loading pattern.
   - Consider recents in the sidebar empty state too (popup-only now).

## Phase 4 — Resolution accuracy (the long tail)

1. **Verify the hjemmeside-param assumption live**: does brreg's
   `?hjemmeside=` do substring matching against stored values like
   `https://www.telenor.no`? One manual API call. If exact-match, the
   strongest precision signal is silently broken exactly where it's
   the only bridge (domain ≠ legal name). Document the answer in
   `docs/notes/resolution.md`.
2. **Underenhet fallback:** a resolved underenhet orgnr (common on
   store/branch sites) 404s hard — `fetchEnhet` only hits
   `/enheter/{orgnr}`. On 404, try `/underenheter/{orgnr}`, then show
   the parent via `overordnetEnhet` with an "avdeling av …" line.
3. **Title-parsing** (backlog.md "Still open", ~line 103): fixes known
   real failures — rema1000.no, detnorsketeatret.no, Finansavisen →
   Hegnar Media. Highest user-visible resolution win available.
4. **SMB benchmark:** `scripts/benchmark-hostname.mjs` has 17 hosts,
   nearly all mega-brands; scoring thresholds (75/45/margin 10) and the
   antallAnsatte weight (up to +20) are tuned for them and biased
   against small correct companies. Build a 30-50 SMB host set with
   verified answers; consider capping the ansatte weight (~+8).
5. Cache-key normalization: strip leading `www.` + lowercase in
   `bandCacheKey` and picker-choice/rejected keys
   (`src/lib/hostname-search.ts`) so user choices carry across host
   variants.
6. Surface free API fields already in the fetched response but dropped
   by `src/types/brreg.ts`: `aktivitet` / `vedtektsfestetFormaal`
   (render as "Virksomhet" line, fall back to næringskode),
   `stiftelsesdato`, `sisteInnsendteAarsregnskap`.
7. Nice-to-haves: Retry-After-aware backoff on 429, in-flight
   resolution coalescing per host, `sort=antallAnsatte,DESC` on the Q3
   fallback query too.

## Phase 5 — Growth loop

1. **Landing page** (GitHub Pages, self-contained): hero use-case, GIF
   of the one-click flow, store badges, proper privacy-policy URL
   (closes the open action item in docs/cws-submission.md ~line 52).
2. **Persona-led copy:** README + store listings currently lead with a
   feature list and the security model. Rewrite around one wedge
   persona — professionals who look up companies repeatedly (sales,
   journalism, procurement, accounting). Privacy stays as
   differentiator, not headline.
3. **"Fant vi ikke bedriften?"-link** in both empty states:
   pre-filled GitHub issue with the hostname, user presses send —
   quality feedback loop with zero telemetry.
4. ~~Pick ONE durable support email~~ **DECIDED 2026-07-04:
   `sebastian@nuez.no`** (recorded in both submission docs). Remaining:
   use it consistently wherever a contact surfaces (README/PRIVACY
   currently point at GitHub issues, which is fine to keep).

## Phase 6 — Tests + housekeeping (fill in around the above)

- brreg client: `fetchEnhet`/`fetchRoller`/`fetchUnderenheter` and the
  24h TTL eviction are untested (brreg.test.ts covers only search +
  regnskap). Same fetchMock pattern, plus one fake-timers TTL test.
- `src/lib/ui/resolve-tab.ts` is pure logic (method decision
  host-auto/host-pick/url/picker) with zero tests — table-test it.
- Contract fixtures: capture 3-5 real brreg responses (e.g. DNB
  984851006 full set; a bank with unsupportedPlan-500; a small AS with
  no regnskap) under `tests/fixtures/`; run parsers/renderers against
  them. Guards against silent brreg schema drift.
- Add happy-dom + vitest environment config to make picker/manual-search
  testable; extract the 6+ duplicated `installStorageMock` copies into
  `tests/helpers/browser-mock.ts`.
- Dead code: remove `attachListeners`/`detachListeners` from
  `decideToggle` (src/lib/auto-sync-controller.ts) — only tests read
  them.
- Background perf: await a stored seed promise instead of two async
  lookups per tab switch when auto-sync is off (background.ts ~216,
  ~236); early-return `storage.onChanged` unless
  `settings.autoSyncOnTabSwitch` is in `changes` (~273).
- Branch/dir cleanup: delete local `feature/sidebar-frontend`
  (superseded; its only unique content is the deliberately-removed
  curated domains table), delete merged remotes `chrome-port`,
  `chrome-port-mvp`, `feat/chrome-auto-sync`; remove orphaned local
  `dist/` and the dead `outDir` in tsconfig.json.
- Toolchain (low priority): ESLint 9 flat config + typescript-eslint
  v8; widen lint glob beyond `src/**`; raise `engines.node` to >=20.

## Open decision for Seb (do not implement without explicit go)

**Opt-in deep detection:** on explicit user action, use `activeTab` +
one-shot `scripting.executeScript` to read the orgnr from the page
footer when the cascade misses (Norwegian companies are legally
required to display it). Dramatically lifts the hit rate on hard
cases with no persistent content script, no new hosts, no install
warning — but it contradicts the letter of CLAUDE.md § Security
constraints ("No content scripts"). Owner call. Broad `tabs` or
`<all_urls>` remains off the table regardless.
