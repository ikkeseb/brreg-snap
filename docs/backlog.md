# Backlog

Work that `docs/plans/2026-09-23-plan.md` does not schedule, and ideas
that were rejected. The plan owns scheduled work; CHANGELOG.md owns
what shipped. An item moves into the plan when it gets scheduled, and
out of here when it ships or is dropped.

<!-- SECTION: open -->
## Open, unscheduled

- **Picker «show more» beyond four rows.** The picker caps at
  `MAX_PICKER_CANDIDATES` (4, `src/lib/hostname-search.ts`). Not now:
  the prefilled «Eller søk selv» field already reaches the rest, and the
  popup has no height to spare (`docs/notes/ui.md` § popup-budget).
  Revisit when the resolver corpus or a user report shows the right
  company in the pool but ranked below four.
- **Last-used company first in the picker.** The picker orders
  candidates by score only (`src/lib/hostname-search.ts`,
  `src/lib/view/components/picker.ts`); a remembered choice for the
  site skips the picker instead of reordering it, and the recents list
  lives in the empty states. Not now: no evidence the score order
  hides the company people pick. Revisit on a user report or a corpus
  host where the right company sits below a stranger.
- **`@types/chrome`.** Chrome-only APIs are typed inline
  (`ChromeSidePanel` in `src/lib/platform/sidebar.ts`, the one cast).
  Not now: that typing is a few lines. Revisit when Chrome-only casts
  spread beyond that module.

- **Multi-year trend in Økonomi.** brreg's open API now returns
  several years of accounts (`docs/notes/brreg-api.md`
  § regnskap-years-and-types), so omsetning and resultat over time are
  possible without a new request. Not now: the view shows the latest
  year by design, and how many years brreg keeps serving is unknown.
  Revisit as a product decision once the shape has held for a while.
- **Popup states over 600 px.** Measured in the real popup against the
  live API (2026-10-06): VERDENS GANG AS on vg.no is 618 px (the
  omsetning line and the konsern row both wrap), and a tvangsavvikling
  with a bostyrer, a two-line name and an org.nr from the URL is
  623 px; the actions then sit under the sticky footer. The smoke does
  not measure the budget (`docs/notes/ui.md` § popup-budget). Revisit
  with the next popup change: vg.no is now a direct answer, so this is
  a first screen.
- **An answer from an incomplete run.** When a constituent query fails
  the band is still decided from what came back and may be `auto`
  (uncached, `docs/notes/cache.md` § failure-no-cache); a rival
  the failed query would have returned is then missing. Unchanged by
  the two-signal rule. Not now: no report of it. Revisit if a wrong
  answer is traced to a failed query.
- **The title pass sees only the picker's rows.** The spaced run
  re-decides from at most four first-pass candidates
  (`docs/notes/resolution.md` § title-segmentation), so after a capped
  first pass it may add rows but not answer. Carrying the whole pool
  would lift that; the band cache would grow with it.
- **Wording and order, the maintainer's call** (from the 2026-10-06
  screenshot review): «Auto-oppdater» was read as a data refresh by two
  readers («Følg fanen» was suggested; it is also the consent text the
  stores reviewed); manual search follows brreg's own order
  (BOLIGSAMEIET KIWI TAU above KIWI NORGE AS; sorting by headcount
  would bury small exact matches); the ledger says «omsetning» where
  Økonomi says «Driftsinntekter» (the longer word wraps the popup past
  600 px); a popup with about 500 px of room under the toolbar is
  clipped by the browser, seen only in a headless 800×600 run.

<!-- SECTION: rejected -->
## Rejected

- **Omnibox keyword** (`brreg <name>` in the address bar). Duplicates
  the manual search with worse ergonomics and reserves a keyword for
  good; fails the minimal-surface bar. Reopen on explicit user demand.
- **Curated host → orgnr table**, even for hard hosts. Every orgnr
  comes from the live API; misses fall through to the manual search
  (`AGENTS.md` § "No curated data"). Not reopened by a single hard
  case; that is what the manual search is for.
- **A sync button inside the sidebar.** Falsified empirically: a click
  inside the panel is not an `activeTab` gesture
  (`docs/notes/permissions-model.md` § iframe-not-a-gesture-surface).
  Don't re-investigate.
- **`webNavigation` instead of `tabs` for auto-sync.** It fires on
  navigation, not on switching to an already-loaded tab, and costs a
  prompt of its own for a partial fit; the runtime `tabs` opt-in
  covers the case (`docs/notes/permissions-model.md`
  § tabs-runtime-optin). Reopen only if `tabs`
  itself has to go.
- **Domain match via `epostadresse` or acronyms alone** (nrk.no →
  NORSK RIKSKRINGKASTING AS). Initials do confirm a company that holds
  the site (vg.no, `docs/notes/resolution.md` § bands); they never put
  one in the pool. brreg refuses an `epostadresse` filter
  (checked 2026-05-16), and NRK has no `hjemmeside` (live, 2026-09-30),
  so no query puts it in the pool by domain; scoring can't promote a
  candidate that isn't there. The live corpus expects it in the picker
  today (`tests/live/resolver-corpus.test.ts`), and hjemmeside ties did ship
  (`docs/notes/resolution.md` § hjemmeside-normalization). Reopen if
  brreg adds an e-mail/domain filter, or a corpus host fails because
  its company never enters the pool.
