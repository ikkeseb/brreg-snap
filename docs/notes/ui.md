# UI system: «Dossier, stamped» (1.4)

Source: `src/styles/brreg.css` (tokens + every component),
`src/lib/view/trust-view.ts` + `dossier-view.ts` (the view models),
`src/lib/view/components/*.ts` (the DOM writers), `src/lib/view/copy.ts`
(every UI string), `src/popup/{popup,views}.ts`,
`src/details/{painter,tabs}.ts`, `src/welcome/*`. Design sources
(outside the repo): `~/design/brreg-1.4/final/{SPEC,SYNTHESIS}.md`.
Visual loop: `scripts/preview/` (its README).

<!-- SECTION: loudness -->
## The loudness rule

Loudness is proportional to severity. A trust tool that shouts on every
normal company trains people to ignore it, so when nothing is wrong the
view is a calm registry extract (paper, ink, hairlines), and it
escalates only with the answer's tone:

- **ok** — a quiet band: 3 px tone rule, 5 % tint, a seal, «Ingen
  varsler i registeret», no supporting line.
- **warn** — a firmer band: 4 px rule, 12 % tint, headline at 800, an
  optional supporting line, and the way out INSIDE the band as a
  hairline button in the tone («Feil bedrift? Velg en annen»).
- **danger** — the stamp: a solid fill with a 1 px seal rule inset 5 px,
  the key word in 900 caps (KONKURS, SLETTET, TVANGSAVVIKLING, IKKE
  KOBLET), the rest of the sentence at lead size, a hairline, the
  supporting line. Actions live inside it (`.btn--on-fill`,
  `.text-btn--on-fill`).

Everything else follows from the tone: under `data-answer="danger"`
the ledger's ok glyphs go grey (true, but not comfort), the popup
drops its leaders line, and the konsern line is dropped on a spoof.
Errors are always a warn band, never a stamp: a failed lookup says
nothing about the company. The tone comes from `deriveAnswer`
(docs/notes/trust.md § answer-priority); the surfaces only paint it.

A part whose fetch failed is named, never presented as absent.
`buildTrustView` carries a typed `failed` list (roller, regnskap,
konsern when the Enhet says erIKonsern, endringer on the panel). The
popup's ok and warn bands get one quiet line under the headline,
«Noe kunne ikke hentes: roller, regnskapstall» (`answer.note`,
`.answer__note`); a stamp has no room for it (§ popup-budget). The
panel says it where the part lives: «Kunne ikke hente roller» /
«… regnskapstallene» in their tabs, «Konsernet kunne ikke hentes.
Trykk «Oppdater» …» as the Konsern section, «Endringer kunne ikke
hentes.» under «Endret nylig». The notes block is warn-toned only when
it holds a merknad: «Endret nylig» carries the neutral glyph, since
changes never raise the tone (`docs/notes/trust.md` § answer-priority).

<!-- SECTION: tokens -->
## Tokens and the type scale

All in `brreg.css`. Light is the default, dark comes from
`prefers-color-scheme` and, with the same values, `.theme-dark` /
`.theme-light` (tests, the gallery). Colour: `--paper`, `--paper-2`
(sunk: inputs, kbd, hover), `--ink`, `--ink-2` (labels, details),
`--ink-3` (captions, neutral glyphs), `--rule` (hairline, decorative),
`--rule-strong` (UI boundaries), `--ok`, `--warn`, `--danger` (text
tone), `--danger-fill` + `--on-danger` (the stamp), `--amber` (the
focus ring only), `--brand` (the mark only), `--skel` / `--skel-hi`.
Every text/paper pair measures ≥ 4.5:1 in both themes, the stamp
included (the table is in SPEC.md § Contrast).

Type: four steps and the stamp word, nothing else — `--t-cap` (600
11px, uppercase + `--track-cap` for section heads and micro labels),
`--t-body` (400 13px, everything readable), `--t-lead` (700 16px, the
answer, empty-state heads), `--t-name` (800 26px, the company name;
23px below 340 px), `--stamp-size` (30px popup, `clamp(26px, 9cqi,
36px)` panel). Space is a 4 px grid (`--s1`…`--s5`); `--gut` is 20 px
in the popup, 16 px in the panel. Shape: no elevation anywhere, rules
separate and fills escalate; `--r` 2 px for inputs, buttons, kbd and
tags, `--r-stamp` 3 px for the stamp only. Motion: `--ease`,
`--t-fast`; every animation and transition is off under
`prefers-reduced-motion`. `.app` is a container (`inline-size`) and
the one breakpoint is 340 px (def-row columns stack, tab counts hide,
the search icon hides).

<!-- SECTION: font-and-csp -->
## Font and CSP

The bundled variable Schibsted Grotesk (OFL, `public/fonts/`, copied
unhashed to the extension root so both surfaces resolve
`/fonts/schibsted-grotesk-var.woff2`) with `font-display: swap`; each
HTML preloads it. A size-adjusted local fallback face (`Schibsted
Fallback`: Arial / Liberation Sans at 101.5 %, overridden vertical
metrics) keeps the swap from reflowing. The panel's tab landing waits
for `document.fonts.ready` before it measures, for the same reason.

The stylesheet needs no `style` attribute anywhere: state is classes,
`aria-*` and `data-*` attributes, and the two computed widths (the
equity bar's `--share`, the tab region's `--land`) go through
`el.style.setProperty` (CSSOM, allowed under the shipped CSP; markup
`style=""` is not). Icons are one inlined `<svg class="sprite">` of
`<symbol>`s per page, referenced with `<use href="#id">` (plus the
`xlink:href` form for older engines), so nothing is fetched. ESLint
bans the HTML sinks; every node is `createElement` + `textContent`.

<!-- SECTION: components -->
## Component inventory (module → API → markup)

Every component is a pure DOM writer: it takes view data and handlers,
returns elements, and holds no state beyond the element it made. `dom.ts`
is the toolbox: `el`, `button`, `svgUse` / `icon` / `glyph(tone)`,
`link(text, href, {external})` (adds `target=_blank`, `rel`, the
decorative «↗»), `appendParts(container, TextPart[])` (strong → `<b>`,
negative → `.num--neg`, nowrap → `.nw`), `section(label, count?)`,
`uniqueId`, `appendName` / `baseName` (§ amendments).

| Module | API | Markup contract |
|---|---|---|
| `masthead.ts` | `renderMasthead(container, {kind:'popup', host?, search} \| {kind:'panel', query?, autoSync}, handlers)` → `{input?, toggle?, searchButton?}`; `appendSiteLabel` | `header.mast > svg.mast__mark[role=img]` + popup `span.mast__site` (`<b>` = registrable domain) + `button.icon-btn[aria-label]`; panel `label.search > svg.icon + input[type=search][aria-label]` + `button.toggle[role=switch][aria-checked] > span.toggle__track` |
| `identity.ts` | `renderIdentity(container, IdentityView, CopyHandlers)` → `{heading}`; `buildOrgnrButton(orgnr, handlers, {small})` | `div.ident > p.ident__over` (form · city) OR `p.ident__eyebrow` (provenance, `i-link`) · `h1.ident__name(--claim)` · `p.ident__line > button.orgnr + a.link` (with an eyebrow: `span.ident__rest > span.ident__meta` carries form · city, the link glued to its last word by `.nw`) · popup `p.ident__leaders > span × n` · `p.ident__note` (avdeling). Panel: the painter adds `div.ident__row > p.ident__flags + button.text-btn` (Kopier sammendrag) |
| `copy-feedback.ts` | `attachCopy(button, () => text, {done, label?}, {copy, announce})`, `COPY_FEEDBACK_MS` = 1400 | adds `.is-copied` (icon `.icon--copy` ⇄ `.icon--done`, the label swaps to «Kopiert») or `.is-failed`; announces «Org.nr kopiert» / «Kunne ikke kopiere» in the live region |
| `answer.ts` | `buildAnswer(AnswerView, {onReject})` → `{section, heading}`; `buildErrorAnswer({head, support, retry}, {onRetry})`; `buildAnswerLoading()` | `section.answer.answer--ok\|--warn\|--danger[aria-labelledby] > span.answer__seal > svg.glyph` + `h2.answer__head` + `p.answer__support` + `div.answer__actions`. Danger: `role=alert`, no seal, the head is prose `span.stamp-pre? · strong.stamp-word > svg.glyph + word · span.stamp-rest` |
| `ledger.ts` | `buildLedger(rows, {onReject, onForget, reportHref})`, `buildLedgerRow`, `buildFacts(TextPart[])` (spoof) | `dl.ledger > div.ledger-row[data-tone][data-key](--inline, --danger-value) > dt (svg.glyph + label + span.sr-only «, ok / advarsel / alvorlig») + dd (value, `.ledger-row__aux`, `.ledger-row__detail`, `.ledger-row__act`)`. Spoof: `p.ledger-cap` + `p.facts`. A `report` action without a mailto is left out |
| `konsern.ts` | `buildKonsernRow(KonsernView, {onOpen})` | `button.konsern > svg.icon + span.konsern__text + svg.konsern__chev` |
| `actions.ts` | `buildActions({summary, panelHref?}, handlers)` → `{container}` (popup) | `div.actions > a.btn.btn--primary[href]` (Åpne i sidepanel) + `button.btn` (Kopier sammendrag) |
| `footer.ts` | `renderFooter(container, {fetchedAt?, now?, loading?, reportHref?}, {onRefresh})` | `footer.foot > div.foot__row` (freshness «Hentet … · Oppdater», the mailto) + `div.foot__row` (NLOD attribution; the mailto joins it when there is no freshness row). No mailto in the error state (no match to report) or when the Kobling row carries it (`TrustView.footReportHref`). In the panel the footer sits at the bottom of a short state: `details.css` makes the body a column and `main` takes the spare room |
| `notes.ts` | `buildNotes(merknader, endringer)` | `div.notes[data-tone=warn] > figure.merknad > figcaption.note-head + blockquote.quote > p + p.quote__date > time`; `section > h3.note-head + ul.changes > li > time + span` |
| `oversikt.ts` | `buildOversikt(dossier, {onDrill})`, `buildDefs`, `buildDefRow`, `buildClamp(lines)` | `section.section > h3.section__head + dl > div.def-row > dt + dd` (plain lines, `button.ent` drill-in, `a.ent` link, `span.def-row__sub`). A `clamp` row: `dd > div.clamp-wrap > p.clamp#id + button.text-btn.clamp__btn[aria-expanded][aria-controls][hidden]` — four lines by CSS `line-clamp`, «Vis mer» only once a ResizeObserver has measured an overflow, `.is-open` lifts the clamp |
| `personer.ts` | `buildPersoner(groups \| 'failed', {onDrill})`, `buildEntityRow(name, note, onOpen, {nameNode})` | `section > div.person(--gone) > b + span.person__role`; `button.entity-row > b + small + svg.icon` |
| `okonomi.ts` | `buildOkonomi(OkonomiView)` | `section[data-tone] > div.fig-head > h2 + span.cap` · `p.fig-status` · `div.figs > h3.fig-group + dl > div.fig-row(--total)[data-tone] > dt + dd > span.fig-row__unit` · `div.equity > .equity__track > .equity__fill` (`--share`) + `.equity__legend` · `p.honest` · Dokumenter: `div.doc-row > .years`, `div.ext-row` |
| `enheter.ts` | `buildEnheter(EnheterView, parentName, {onDrill, copy, announce})`, `KONSERN_CHILDREN_SHOWN` = 20 | Konsern: `ul.konsern-path > li` (`--depth`) with `.entity-row(--self)`; `p.konsern-sub.cap` + `ul > li > button.entity-row` (hidden past 20, `p.show-all`). Underenheter: `p.units-count`, `ul > li.unit(--gone) > span > .unit__name + .unit__meta` + `button.orgnr.orgnr--sm` |
| `picker.ts` | `renderPicker(container, {site, candidates, query}, {onPick, onNone, onSearchSelect, announce})` → `{heading, firstRow, input, search}` | `div.pick-head > h1 + p`; `ol.picker > li > button.pick[aria-keyshortcuts] > span.kbd + span > .pick__name + .pick__sub + span.pick__right > (.status-mark \| «N ansatte») + span.evidence(--strong hjemmeside \| --weak underside / navnetreff)`; `button.pick.pick--none > span.kbd + span.pick__label`; `div.pick-search > label.field-label + label.search--lg`. Digit keys 1–4 / 0 on one document listener per document (§ lifecycle below). `pickerHead` words the head by what the rows are: no row with the site registered («Fant ikke selskapet bak …»), one row that has it («Står dette selskapet bak …?»), several that have it, or one among name matches («Mulige selskaper bak …»); every evidence chip has a `title` |
| `search.ts` | `buildSearchField`, `buildEntryRow`, `searchPainter`, `buildListSection(head)`, `renderRecents`, `renderSearchView(container, data, handlers)` | `div.empty > h1 + p + label.search--lg + p.hint`; `section.section > h3.section__head + ul.results \| ul > li > button.recent > span.recent__name > b (+ .status-mark, .recent__sub) + span.recent__on`; `li.results__note`; `button.back > svg.icon + b` |
| `skeleton.ts` | `buildSkeleton(surface)`, `renderSkeleton` | the loaded geometry with real labels and `.sk.sk--*` values, `aria-hidden`; `main` is `inert` + `aria-busy` meanwhile |
| `live.ts` | `liveRegionOf(el)` → `{el, announce}`, `focusElement(target)` | the one `p.sr-only[aria-live=polite]` per document; `focusElement` gives a heading `tabindex=-1` |
| `details/tabs.ts` | `setupTabs(tablist, {initial, onSelect})` → `{activateByKey}` | `div.tabs[role=tablist][aria-label] > button.tab[role=tab][aria-selected][aria-controls] > span.tab__count`; roving tabindex, arrows / Home / End; the panels are `div[role=tabpanel][aria-labelledby][hidden]` inside `div.tab-panels` |

The surfaces compose these: `popup/views.ts` has one paint per popup
state (`paintLoading` / `paintResult` / `paintPicker` / `paintEmpty` /
`paintError`); `details/painter.ts` is the panel's painter behind the
`PanelPainter` seam (docs/notes/sidebar-sync.md). Both set
`body[data-answer]` (ok | warn | danger | pick | empty | loading) and
`main#app[data-state]` (loading | result | picker | empty | error |
search): the smoke and the tests key on those, not on classes.

<!-- SECTION: a11y -->
## The a11y contract

- One `aria-live="polite"` region per document (`#live`), and every
  announcement goes through it: load progress («Henter … fra
  Brønnøysundregistrene»), copy outcomes, search result counts. A
  second region would make screen readers race.
- `role="alert"` only on the danger stamp; the ok and warn bands are
  labelled sections. Errors are never alerts.
- Tone is never colour alone: the glyph shape (✓ ! ✕ ·) is the first
  channel, the ledger's `span.sr-only` text («, ok», «, advarsel», «,
  alvorlig») the second, colour the third. Forced colours keep the
  rules, the seals and the stamp border.
- Focus moves only on a user-initiated transition (a pick, a search, a
  retry, a drill-in), to the result heading or the first picker row;
  a background repaint (auto-sync) never moves it. One focus style
  everywhere: the amber ring on `:focus-visible`; the search box
  carries it for its input.
- A background rebuild must not drop focus either: the panel's 30 s
  freshness tick rewrites the footer's text node in place
  (`renderFooter(...).tick`), and a same-view keep (provenance) that
  rebuilds the top and the footer puts focus back on the equivalent
  control — same tag, same accessible text (`rebuildKeepingFocus` in
  painter.ts) — or leaves it where the browser dropped it when the
  control is gone.
- The stamp's DOM stays one sentence («Nettstedet er ikke koblet til
  selskapet») so a screen reader hears it, whatever the caps say.
- The tablist is a real tablist (roving tabindex, arrow keys); the
  skeleton is `inert` and hidden from AT; `[hidden]` always renders
  `display: none` (the smoke asserts no hidden element paints).
- Every copy and drill action is a `<button>`; external links say so
  (`target=_blank`, `rel=noopener noreferrer`, the «↗» is
  `aria-hidden`). The org.nr button's name is «Kopier org.nr 923 609
  016».
- Popup Escape closes the search view only; the picker leaves Escape
  to the browser (a reflex key must not be remembered as «Ingen av
  disse»). Digit keys are off while typing in a field and with any
  modifier.
- A search view that closes (Escape, the back bar) resets its search
  controller, so a response still in flight can neither paint nor
  announce into the restored view; the popup does the same to the
  search on screen whenever another state paints. In the panel the
  search view opened over a load lifts `inert`/`aria-busy` from main
  (the results must be operable) and puts them back with the skeleton.

<!-- SECTION: popup-budget -->
## The popup's 600 px budget

Firefox caps a popup at 600 px; the design fixes the width at 380 px
and measures every state against the cap (`node measure.mjs` in the
design folder; the harness re-measures with `document.body` height).
Measured 2026-09-30 against the live API: dnb 562, spoof 588, nrk
picker 592, konkurs 596, no-site 386 — all under 600. With the
«Noe kunne ikke hentes» line (a failed part drops a row too): dnb with
roller + regnskap + konsern failed 506, equinor with only konsern
failed 586; a stamp gets no line, because konkurs (596) or the spoof
(588) plus a line would pass the cap. What keeps them there:

- Identity uses one compact leaders line («Daglig leder X · Styreleder
  Y», wrapping whole pairs) instead of a two-column block; one person
  in both roles is one pair, «Daglig leder og styreleder X».
- Under a stamp the leaders line is dropped (reassurance next to a
  konkurs), the regnskap row names the year only (the money lives in
  the panel's Økonomi tab), and the Kobling row is short («Registrert
  hjemmeside»: the host is already in the masthead, the date already
  in the stamp).
- Under a warn band the popup's regnskap row names the year only too
  (`signalRow`'s `roomForMoney`): a url-param company with a merknad,
  a provenance line and two leaders measured 610 px with the money.
  The panel keeps the money under a warn band; only a stamp drops it
  there.
- On a spoof the company's ledger becomes one prose line under «Om
  selskapet — sier ingenting om dette nettstedet» (`.facts`); four
  rows put P4 at 660 px.
- A merknad in the answer is carried as a count («1 merknad i
  registeret») on both surfaces: the popup has no room for the quote,
  and the panel quotes it in full in the notes block right under the
  ledger, so the headline must not say it twice.
- The footer is sticky in the popup, so the NLOD attribution (a licence
  condition) stays visible under a long name.

<!-- SECTION: amendments -->
## Seat amendments (differences from the design deliverable)

- **No copy toast.** Copy feedback is the button itself: the icon swaps
  to the check, the number tints ok (or the label reads «Kopiert») for
  1.4 s, and the live region says it. The design's floating
  `.orgnr__toast` is gone.
- **Flush inline actions.** `.ledger-row--inline dd` is a flex-wrap row
  with a column gap, never a leading margin: when «Feil bedrift?» wraps
  it starts flush with the value's left edge.
- **Org.nr line under an eyebrow.** With a provenance eyebrow («Org.nr
  funnet i sidetittelen») the org.nr owns its line and «form · city»
  takes the next, the brreg.no link glued to its last word (`.nw`) so
  it never lands alone.
- **Prefix muting.** A child or branch named after its parent
  («EQUINOR ASA AVD FORUS», «EQUINOR ALGERIA AS») gets the shared
  prefix in a quieter `span.name-prefix` so the distinguishing part
  reads first (`appendName` in dom.ts). The prefix is the parent's full
  name or its base name — the name minus a legal-form suffix (AS, ASA,
  SA, DA, ANS, BA, NUF, KS, SE, IKS, BBL, SF, …; `baseName`) — matched
  as whole words at the start, and what is left must say something of
  its own (at least one word that is not a legal form): «EQUINOR AS»
  under «EQUINOR ASA» keeps its whole name. The text stays the full
  name; only the node shape changes.
- **Konsern rows are not underlined by default.** The chevron already
  says «drill in»; the underline appears on hover and keyboard focus,
  and the focus ring stays.
- **Picker rows have no hover fill.** Hover and keyboard focus underline
  the name and invert the digit key, and the focus ring keeps the global
  outward offset: a fill or an inset ring ran flush against the key.
- **Place names are title-cased everywhere.** brreg writes poststed in
  caps («4035 STAVANGER»); `titleCasePlace` (format.ts, re-exported by
  trust-view.ts) renders «Stavanger», «Mo i Rana» in the identity line,
  the Kontakt rows, the underenhet rows, the bostyrer address and the
  invoice block. Street lines stay as brreg writes them; a mixed-case
  foreign poststed («DE-92711 Parkstein») is left alone.
- **Formål only when it adds something.** Registrering shows
  vedtektsfestet formål only when it differs from aktivitet (compared
  case-, punctuation- and whitespace-insensitively, `sameText`). Both
  are clamped to four lines with a measured «Vis mer» / «Vis mindre».

<!-- SECTION: panel-search-and-head -->
## The panel's search view and compact head

The masthead field is the manual search from every state. Typing moves
main's children into a fragment (live DOM, listeners intact), shows
`div.search-view` (a back bar «Tilbake til <name>», the results, or
«Nylig sett» while the field is empty) and sets `main[data-state=
search]`; the footer keeps only its attribution meanwhile, since
«Hentet … · Oppdater» describes the result kept aside. Escape or the
back bar puts everything back untouched — no refetch, the open tab, a
half-read page and the picker's digit keys survive (the picker's key
listener bails while its list is detached instead of removing itself;
one listener per document, replaced by the next picker rendered).
Any paint from the controller discards the aside. The popup has the
same view (`{kind:'search'}` in `paintEmpty`) painted over its state,
with `repaint` as the way back.

The compact head (`#stick`: seal · name · org.nr) sits in a zero-height
sticky wrapper so showing it never moves the page; an
IntersectionObserver on the identity block shows it once the identity
is scrolled past. A deep link (`?tab=<key>`, the popup's konsern row
opening Enheter) lands on the tabs: after `document.fonts.ready` the
painter shows the head, gives the tab region (`div.tab-panels`) the
height the landing leaves it (`--land` = head + tablist + what follows
the region, i.e. the footer; details.css sets `min-height:
calc(100dvh - var(--land))`) and scrolls the tablist to sit right
under the head. The min-height is what makes a short tab (Økonomi at
320 px) scroll that far, and it keeps the tablist put when switching
from a long tab to a short one.

<!-- SECTION: badge -->
## The toolbar badge

Both surfaces set the followed tab's toolbar badge from the same rule
(`view.badgeTone`, `platform/badge.ts`): the answer's tone when the
company on screen is the tab's own (host-derived: URL, title or
hostname) and it is warn or danger; cleared for everything else — an
ok answer, a manual pick, a drill-in, a picker, an empty or error
state. The popup uses the tab it opened on; the panel the tab it
resolved at startup or on a tab event (`tabId` on every paint, kept
across messages, never set by a message or a probe). No permission:
`action.setBadgeText` needs only the manifest's `action` key.

<!-- SECTION: welcome -->
## The welcome page

`src/welcome/` is opened once by the install hook: one screen at
1280×800, no network, nothing stored. The two example cards are the
real components on fictional data (`figure.example[data-answer]`, the
card `aria-hidden`, the caption is what a screen reader gets, no
`role=alert`, nothing focusable). The cards share one height and their
content is balanced — the calm one carries the leaders line and four
rows, the loud one the stamp — so neither ends in a blank. The only
browser API read is `commands.getAll()` for the shortcut keys; the pin
instruction and the way to change shortcuts come from
`platform/engine.ts`. The page composes `welcome.css` on top of
`brreg.css` (a display size for the headline, a lead size, the card
frame, the key caps).
