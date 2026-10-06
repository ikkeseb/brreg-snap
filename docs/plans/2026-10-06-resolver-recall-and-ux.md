# Spec — resolver recall, an honest picker, UX fixes, native smoke (2026-10-06)

Work order under `docs/plans/2026-09-23-plan.md`. It came out of the
real-extension check of 1.4.2 and a survey of the real popup on live
sites. Nothing here is built yet. Three parts, in this order: the
resolver (§ resolver), the UX fixes (§ ux), the smoke (§ smoke). Delete
this file when its parts have shipped; `CHANGELOG.md` and the notes
under `docs/notes/` carry what remains true.

<!-- SECTION: evidence -->
## Evidence

**The first click on a well-known site is usually a picker.** The
released 1.4.2 Chrome package, loaded unpacked, toolbar click on eight
live sites: one direct answer (kleins.no), seven pickers (elkjop.no,
power.no, xxl.no, vg.no, nrk.no, finn.no, sbanken.no). Every popup
settled in under half a second and stayed within 600 px. The live
corpus (`tests/live/resolver-corpus.test.ts`, 34 hosts) read 16
auto-correct, 7 picker-with-right, 3 picker-without-right, 2 missed,
6 refused, 0 AUTO-WRONG the same day.

**The corpus flatters the resolver.** Its SMB hosts were picked by hand
and all carry the company name as the domain. Measured instead on a
drawn sample:

- *Own-site sample.* 400 entities drawn from brreg (the `hjemmeside`
  filter with `.no`, one organisasjonsform at a time, pages spread over
  the result set) whose registered hjemmeside is the root of a site.
  For each, the shipped `searchByHostnameDetailed` ran on that site
  with no tab title, and every search hit its queries returned (the
  pool) was recorded with the band it decided.
- *Known-site sample.* 164 well-known hosts (news, banks, retail,
  transport, public sector, global brands, the corpus hosts), recorded
  the same way.
- The pools were then replayed offline through today's banding and two
  rule variants (§ resolver).

Share of sites where the sampled company is the direct answer:

| Sample (n) | Today | Variant A | Variant C |
| --- | --- | --- | --- |
| AS (150) | 50 % | 84 % | 69 % |
| ENK (120) | 2 % | 78 % | 11 % |
| FLI (40) | 0 % | 95 % | 35 % |
| DA, ANS (30) | 43 % | 83 % | 73 % |
| NUF (20) | 30 % | 75 % | 30 % |
| STI (20) | 0 % | 45 % | 20 % |
| SA, BA (20) | 15 % | 85 % | 50 % |

Today the resolver also answers «Fant ikke selskapet» (band `none`) on
66 % of the ENK sites, 90 % of the FLI sites and 50 % of the STI sites,
although the registry ties the site to the entity. Both variants bring
that to zero: the entity is at least a picker row.

Why today's rule misses, each seen in the pools:

1. **Run-together names score nothing.** `scoreCandidate` matches the
   label against whole words, so `alnaregnskap` earns ALNA REGNSKAP AS
   no name points: 68, under the AUTO threshold, a one-row picker.
2. **Form weights sink the holder.** An ENK with an exact tie and no
   name match scores 22, under the picker threshold: band `none`.
3. **The margin counts name look-alikes.** vg.no: VERDENS GANG AS (83,
   the only company with the site registered) against VG CONSULT AS
   (76, name only): seven points apart, so a picker.
4. **Among several holders the pick is arbitrary.** brekke-eiendom.no
   is registered by a row of property companies; the one with a
   two-word name gets ten bonus points, which is exactly the margin,
   and auto-resolves. bunnpris.no, held by two local grocers, resolves
   to the one with the shorter name the same way.

Limits of the measurement. No tab title, so title segmentation never
ran: the shipped popup does better on run-together names when the page
title spells the name. «Direct answer to the sampled company» counts a
satellite that registered someone else's site as correct. The sample
only holds sites some entity registered. The recorded pools hold sole
proprietors' names: they stay off the repository, and a new recording
replaces them.

<!-- SECTION: decisions -->
## Decisions

- **A name-only winner stays in the picker** (Seb, 2026-10-06). The
  plan had this down for a revisit once Kobling could label a guess.
  Shown as an answer, equinor.no or ikea.no would carry an amber
  warning on a legitimate site, against the loudness rule
  (`docs/notes/ui.md` § loudness), and equinor.top would be handed
  Equinor's name. The `name-guess` and `other-site` Kobling kinds stay
  unreachable.
- **Order of work** (Seb, 2026-10-06): resolver, UX fixes, smoke. No
  release until he asks for one.
- **Open, Seb's call: variant A or C** (§ resolver). He approved «one
  company alone with the site registered is shown directly» before the
  replay existed. The replay then showed what that does on well-known
  sites. Recommendation: C.

<!-- SECTION: resolver -->
## Resolver

Terms. A *holder* is a candidate whose registered hjemmeside is the
site itself (`hjemmesideKind` `exact`). A candidate *is named after the
site* when its name, minus the legal form, run together and folded,
equals the label (ALNA REGNSKAP AS for alnaregnskap, TV 2 AS for tv2,
EQUINOR ASA for equinor), or when the label is the initials of that
name's words (VERDENS GANG for vg, UNIVERSITETET I OSLO for uio).

**Variant A (a lone holder is the answer).** One holder: AUTO, unless a
candidate with a whole-word name match outscores it (ikea.no, where an
employees' association holds the site and IKEA AS does not). Several
holders: AUTO only to one with a whole-word name match and today's
margin. Run-together names earn the prefix points. Replayed on the
known sites it adds twelve direct answers, four of them wrong: if.no
resolves to AKERSHUS FORSIKRINGSSENTER AS, adressa.no to
REDAKSJONSKLUBBEN ADRESSEAVISEN, sparebank1.no to SPAREBANK 1
FACTORING AS (one of many holders there, lifted by the new name
points), lieoverflate.no to LIE KOMPETANSE AS. A confident wrong
company is the one outcome the user cannot see through.

**Variant C (two signals agree).** Recommended.

1. A holder named after the site: AUTO to it. Two or more such holders
   need today's margin between them, else picker. A candidate that is
   named after the site, holds no tie and outscores the holder also
   sends it to the picker.
2. No holder is named after the site: today's score rule decides, with
   one restriction. When several holders share the site and the top one
   has no whole-word name match, the band is picker, never AUTO.
3. A holder is never dropped. Any holder in the pool makes the band at
   least picker, and the picker rows include the holders even when
   their score is zero or negative.
4. Scores, weights and thresholds do not change. Page and subdomain
   ties and name-only candidates band as they do today.

Replayed on the known sites, C changes seven answers: vg.no,
danskebank.no, uio.no and xxl.no (XXL AS) become direct; adressa.no
goes from `none` to a picker; bunnpris.no and vitusapotek.no go from
direct to a picker. The last one is a loss: NORSK MEDISINALDEPOT AS
(3 777 employees) holds vitusapotek.no beside a few single pharmacies
and is today's answer. A narrower restriction is worth a replay:
ignore the name-length bonus, not the whole score, when the top holder
has no name match. On the own-site sample 13 % of the AS sites and
67 % of the ENK sites become a one-row picker holding the holder: one
click instead of «Fant ikke». That state gets its own wording (§ ux,
item 3).

Acceptance:

- The banding is a pure, exported function over scored hits, with unit
  tests built from the shapes above: run-together name, initials, a
  lone holder with no name match, several holders with and without a
  name match, a holder with a non-positive score, a name-only candidate
  that outranks an association holding the site.
- `tests/live/resolver-corpus.test.ts` gains the hosts this spec names,
  each expectation checked against brreg's own record first: vg.no
  auto; if.no, adressa.no, sparebank1.no and brekke-eiendom.no must not
  auto to the satellite; bunnpris.no a picker holding both grocers;
  xxl.no XXL AS or a picker holding it and XXL SPORT & VILLMARK AS;
  vitusapotek.no NORSK MEDISINALDEPOT AS or a picker holding it; a
  handful of run-together SMB sites from a fresh draw. lieoverflate.no's expectation is stale (the
  company it names no longer registers the site, and the pool lacks it
  without a title): re-verify or drop it. AUTO-WRONG stays 0.
- A new recording of both samples, replayed before and after: the
  table above reproduced within sampling noise, and every known site
  whose answer changes read one by one.
- The band cache holds 24 h of old answers per site
  (`docs/notes/cache.md`): say in the change whether the key moves.
- `docs/notes/resolution.md` § bands is rewritten to the rule that
  ships, and the plan's resolver decision is updated.
- The rule is this spec's design and has had no second reader. It gets
  a counter-case from outside the author's model family before the
  build rests on it.

Unknown: how the rule meets title segmentation (`worthSegmenting` and
the re-score in `src/lib/hostname-search.ts`), and how many FLI and STI
holders are satellites rather than the site's own organisation.

<!-- SECTION: ux -->
## UX fixes

Found by five independent readers of the smoke and live screenshots
plus the maintainer session's own read; each was checked against the
screen and the code before it got on this list. Strings go in
`src/lib/view/copy.ts` unless they are a trust derivation's own wording.

1. **«Endret nylig» is not a warning.** `src/lib/view/components/notes.ts`
   gives its heading the amber «!» that a merknad gets, straight under
   «Ingen varsler i registeret». `docs/notes/trust.md`
   § answer-priority already says changes never raise the tone. The
   heading gets the neutral glyph; the notes block is warn-toned only
   when it holds a merknad.
2. **The error state.** The supporting line repeats the headline
   («Fikk ikke svar fra …» / «Fikk ikke kontakt med …»,
   `src/lib/ui/error-message.ts`): it becomes «Sjekk
   nettverkstilkoblingen og prøv igjen. Det sier ingenting om
   selskapet.» A failed lookup has no match to report, so the footer
   drops «Rapporter feil treff» in the error state on both surfaces.
3. **The picker says what it has.**
   - No row with the site as registered hjemmeside: head «Fant ikke
     selskapet bak ‹site›», sub «Ingen har ‹site› som registrert
     hjemmeside. Dette er de nærmeste treffene.» Today it says «Mulige
     selskaper bak sbanken.no» over four name look-alikes.
   - One row, and it is the holder: head «Står dette selskapet bak
     ‹site›?», sub «Det har ‹site› som registrert hjemmeside.»
   - Several holders: sub «Flere selskaper har ‹site› som registrert
     hjemmeside. Velg den som stemmer.»
   - Otherwise as today.
   - Each evidence chip carries a `title` that spells it out; only
     «underside» has one today.
4. **A filed year without figures says why.** DNB and Telenor read
   «2025 levert» where Equinor shows omsetning and resultat. When the
   regnskap fetch succeeded and no figures belong to the year the
   signal names (the 500 answer for special accounts, or the open API
   being a year behind the Enhet), the ledger row gets a quiet second
   line: «tall ikke i åpne data». In Økonomi, when the Enhet's filed
   year is newer than the figures: status «‹år› er levert. Tallene er
   ikke i åpne data ennå.», and the closing line «Viser tallene for
   ‹år›.» with « Andre år finnes som PDF.» when copies exist. Today
   that view calls 2024 «Siste innsendte årsregnskap» beside «2025
   levert». Rare: 0 of 176 sampled companies; Telenor ASA is one.
5. **Late accounts say what is missing.** An amber regnskap row reads
   «2024 · siste innsendte». The signal knows the year it expected
   (`expectedLatestFiledYear`): the row reads «‹forventet år› ikke
   levert · siste er ‹år›», and the answer headline for that finding
   «Regnskap for ‹forventet år› er ikke levert». Only the warn tone;
   the neutral row keeps its wording.
6. **Long words break mid-word at 360 px**, the width Chrome gives its
   side panel: «Telekommunikasjonsvirksomh / et.» The value cells get
   `hyphens: auto` (the pages are `lang="nb"`). Whether the test
   Chromium carries the Norwegian dictionary is unknown: check it, and
   name the real browser as the surface if it does not.
7. **The panel's footer floats** under short states (empty, error)
   with most of the panel blank below it. It sits at the bottom of the
   panel, without disturbing the tab landing (`docs/notes/ui.md`
   § panel-search-and-head).
8. **One person, one line.** When daglig leder and styreleder are the
   same person the identity shows two lines with the same name: one
   line, «Daglig leder og styreleder ‹navn›».
9. **«Org.nr funnet i adressen»** reads as a street address: «Org.nr
   funnet i nettadressen».
10. **Two counts for one konsern.** The overview says «konsern med 55
    selskaper», the Enheter tab lists «Datterselskaper» and «Vis alle
    34». The heading says «34 direkte datterselskaper».
11. **«Rapporter feil treff» twice** on a spoofed site (the Kobling row
    and the footer): the footer drops it when the ledger carries it.
    Only if it stays a local change.

Acceptance: `pnpm verify` and `pnpm smoke` green; a test per item where
the behaviour is a rule (1, 2, 3, 4, 5, 8); `docs/notes/ui.md` and
`docs/notes/trust.md` say what ships; every popup state measured at or
under 600 px, with the heights listed (Equinor's popup is at 600 today
because the USD line wraps, so nothing may add a line there); the
changed states looked at in both themes at 320, 360 and 400 px against
the live API.

<!-- SECTION: smoke -->
## Smoke

1. **The real flow.** A test in `tests/e2e/extension.spec.ts` that
   triggers the toolbar action on a stubbed dnb.no tab (CDP
   `Extensions.triggerAction`), asserts the popup's result from the
   recorded fixtures, clicks «Åpne i sidepanel» with a trusted input
   event and asserts the side panel. Written by a delegated worker,
   reported green; not reviewed and not landed. It ran on the Windows
   build of the test Chromium only, and CI is Linux: run it there
   before trusting it. Reviewing it includes reading the helper that
   answers brreg requests over CDP and proving the test fails without
   a fixture. Once landed, these lines understate the smoke: the
   «Maintainer only» rung and the `pnpm smoke` comment in `AGENTS.md`,
   the smoke comment in `.github/workflows/ci.yml` and
   `playwright.config.ts`, the smoke sentence in
   `docs/notes/platform.md`, and `tests/e2e/fixtures/README.md` (the
   test leans on the `popup-dnb` and `dnb-bank` fixtures without being
   a state).
2. **360 px.** A third panel width in `playwright.config.ts`: it is
   the width Chrome's side panel opens at, and item 6 above only shows
   there.

<!-- SECTION: parked -->
## Parked and rejected

Parked, Seb's call:

- **«Auto-oppdater» as a name.** Two readers took it for a data
  refresh; «Følg fanen» was suggested. It is also the consent text the
  stores reviewed and it is in the listings.
- **Manual search order.** brreg's own order puts BOLIGSAMEIET KIWI TAU
  over KIWI NORGE AS; sorting by headcount would bury exact matches of
  small companies.
- **«omsetning» in the ledger, «Driftsinntekter» in Økonomi** for the
  same figure. The longer word wraps the popup past 600 px.
- **A popup on a short screen** (about 500 px of room under the
  toolbar) is clipped by the browser and its actions scroll under the
  sticky footer. Seen only in a headless 800×600 run.

Rejected:

- **«The side panel shows no site and no Kobling.»** The readers saw
  fixture pages loaded by orgnr. In the real extension the panel
  opened from the popup carries the Kobling row, and a spoofed site's
  panel carries the stamp (checked 2026-10-06).
- **Hiding «Feil bedrift?» on a registered match.** Every site-derived
  answer can be undone: plan Phase 4, item 0.
- **The spoof and konkurs readings** that want the company's facts
  gone or the stamp softened: the stamp and the «Om selskapet» line
  are the 1.4 design (`docs/notes/ui.md` § loudness).
