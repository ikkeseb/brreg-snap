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
- **Domain match via `epostadresse` or acronyms** (nrk.no → NORSK
  RIKSKRINGKASTING AS). brreg refuses an `epostadresse` filter
  (checked 2026-05-16), and NRK has no `hjemmeside` (live, 2026-09-30),
  so no query puts it in the pool by domain; scoring can't promote a
  candidate that isn't there. The live corpus expects it in the picker
  today (`tests/live/resolver-corpus.test.ts`), and hjemmeside ties did ship
  (`docs/notes/resolution.md` § hjemmeside-normalization). Reopen if
  brreg adds an e-mail/domain filter, or a corpus host fails because
  its company never enters the pool.
