# UI system

Source: `src/styles/brreg.css` (tokens + every component),
`src/lib/view/trust-view.ts` + `dossier-view.ts` (the view models),
`src/lib/view/components/*.ts` (the DOM writers), `src/lib/view/copy.ts`
(every UI string), `src/popup/{popup,views}.ts`,
`src/details/{painter,tabs}.ts`, `src/welcome/*`. Visual loop:
`scripts/preview/` (its README).

<!-- SECTION: loudness -->
## The loudness rule

Loudness is proportional to severity. A trust tool that shouts on every
normal company trains people to ignore it, so when nothing is wrong the
view is a calm registry extract (paper, ink, hairlines), and it
escalates only with the answer's tone:

- **ok** — not a band: a 1 px divider in `--rule-ink`, no tint, the
  green seal, «Ingen varsler i registeret», no supporting line. Colour
  as a field (a tint, a tone rule) is reserved for warn and danger, so
  on a normal company the only green is the seal.
- **warn** — a firmer band: 4 px rule, 12 % tint, headline at 800, an
  optional supporting line, and the way out INSIDE the band as a
  hairline button in the tone («Feil bedrift? Velg en annen»).
- **danger** — the stamped verdict: not a band across the page but a
  field placed on it, inset by the gutter, held by a 2 px frame in the
  danger red and a 7 % tint. Inside it the voice is a statement, not an
  alarm: a red kicker («✕ Alvorlig», `.answer__kicker`,
  `COPY.verdictKicker`), then the whole sentence in the largest type on
  the page (`--t-verdict`) in ink with only the key word in red
  (`.stamp-word`: Konkurs, Slettet, Tvangsavvikling, ikke koblet), a
  hairline, the supporting line. The red is precise: the frame, the
  kicker and the key word, no fill, so it is loudest by containment,
  colour and type, never by flood. Actions live inside it like a warn
  band's: the site link is a `.btn--sm.btn--tone`, the way out a plain
  `.text-btn` beside it so the two keep to one line.

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
`.answer__note`); a verdict has no room for it (§ popup-budget). The
panel says it where the part lives, as a sentence, never as a row that
reads like data: «Kunne ikke hente roller» under Ledelse and in
Personer, «… regnskapstallene» in Økonomi, «Konsernet kunne ikke hentes.
Trykk «Oppdater» …» as the Konsern section, «Endringer kunne ikke
hentes.» under «Endret nylig». The notes block is warn-toned only when
it holds a merknad: «Endret nylig» carries the neutral glyph, since
changes never raise the tone (`docs/notes/trust.md` § answer-priority).

<!-- SECTION: tokens -->
## Tokens and the type scale

All in `brreg.css`. Light is the default, dark comes from
`prefers-color-scheme` (the smoke sets it through Playwright's
`colorScheme`). Colour: `--paper`, `--paper-2`
(sunk: inputs, kbd, hover), `--ink`, `--ink-2` (labels, details),
`--ink-3` (captions, neutral glyphs), `--rule` (hairline, decorative),
`--rule-ink` (the rule that opens a table: the ledger, a section head,
the figures, the picker; ink in light, a mid-grey in dark, where ink
would be the brightest line on the page and read as a glow under the
answer band), `--rule-strong` (UI boundaries), `--ok`, `--warn`, `--danger` (text
tone and the verdict's frame, kicker and key word), `--amber` (the
focus ring only), `--brand` (the mark only: the logo's one blue in
both themes, § masthead-mark), `--skel` / `--skel-hi`.
Every text/paper pair measures ≥ 4.5:1 in both themes; each token's
ratio against `--paper` sits beside it in `brreg.css`. The verdict's tint is `color-mix` of 7 %
`--danger` into `--paper` (resolves to #F2E5DB light / #1C1718 dark),
and on it `--danger` measures 5.4 / 7.0, `--ink` 14.2 / 14.7, `--ink-2`
7.3 / 8.5, the amber focus ring 4.8 / 8.2 (3.9 / 6.7 on the
`.btn--tone` hover fill); the frame against `--paper` is 6.0 / 7.5.
The light paper is warm (a registry extract); the dark one is a cool
graphite, since a warm dark reads brown beside the browser's own
chrome.

Type: four steps and the verdict, nothing else — `--t-cap` (600
11px, uppercase + `--track-cap` for section heads and micro labels),
`--t-body` (400 13px, everything readable), `--t-lead` (700 16px, the
answer, empty-state heads), `--t-name` (800 26px, the company name;
23px below 340 px), `--t-verdict` (800 22px/1.1, the danger sentence;
`--verdict-size` is `clamp(22px, 6cqi, 24px)` in the panel: «Konkurs
siden 26. aug. 2026» stays one line inside the frame at 400 px, and
Tvangsavvikling fits as one word at 320 px, 166 px of the frame's 252). Space is a 4 px grid (`--s1`…`--s5`); `--gut` is 20 px
in the popup, 16 px in the panel. Shape: no elevation anywhere, rules
separate and fills escalate; `--r` 2 px for inputs, buttons, kbd and
tags. Motion: `--ease`,
`--t-fast`; every animation and transition is off under
`prefers-reduced-motion`. `.app` is a container (`inline-size`) and
the one breakpoint is 340 px (def-row columns stack, tab counts hide,
the search icon hides, underenhet rows stack).

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
`xlink:href` form for older engines), so nothing is fetched; the
brand mark is the one exception (§ masthead-mark). ESLint
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
| `masthead.ts` | `renderMasthead(container, {kind:'popup', host?, search, markOnly?} \| {kind:'panel', query?, autoSync}, handlers)` → `{input?, toggle?, searchButton?}`; `appendSiteLabel`; `brandMark()` (the 16×15 slot, § masthead-mark) | `header.mast > svg.mast__mark[role=img][width=16][height=15] > svg.mark--x1 + svg.mark--x2` + popup `span.mast__site` (`<b>` = registrable domain; «Ingen nettside» without a host; left out on the no-site empty state, `markOnly`, whose heading says it) + `button.icon-btn[aria-label]` (pinned right); panel `label.search > svg.icon + input[type=search][aria-label]` + `button.toggle[role=switch][aria-checked] > span.toggle__track` |
| `identity.ts` | `renderIdentity(container, IdentityView, CopyHandlers)` → `{heading}`; `buildOrgnrButton(orgnr, handlers, {small})` | `div.ident > p.ident__over` (form · city) OR `p.ident__eyebrow` (provenance, `i-link`) · `h1.ident__name(--claim)` · `p.ident__line > button.orgnr + a.link` (with an eyebrow: `span.ident__rest > span.ident__meta` carries form · city, the link glued to its last word by `.nw`) · popup `p.ident__leaders > span × n` · `p.ident__note` (avdeling: «Avdeling: » + `b` (the branch name in ink, `appendName` against the parent) + « (org.nr)»). Panel: the painter adds `div.ident__row > p.ident__flags + button.text-btn` (Kopier sammendrag, pinned right with or without flags) |
| `copy-feedback.ts` | `attachCopy(button, () => text, {done, label?}, {copy, announce})`, `COPY_FEEDBACK_MS` = 1400 | adds `.is-copied` (icon `.icon--copy` ⇄ `.icon--done`, the label swaps to «Kopiert») or `.is-failed`; announces «Org.nr kopiert» / «Kunne ikke kopiere» in the live region |
| `answer.ts` | `buildAnswer(AnswerView, {onReject})` → `{section, heading}`; `buildErrorAnswer({head, support, retry}, {onRetry})`; `buildAnswerLoading()` | `section.answer.answer--ok\|--warn\|--danger[aria-labelledby] > span.answer__seal > svg.glyph` + `h2.answer__head` + `p.answer__support` + `div.answer__actions`. Danger (the framed field): `role=alert`, no seal, `span.answer__kicker > svg.glyph + «Alvorlig»` before the head, and the head is prose `span.stamp-pre? · strong.stamp-word · span.stamp-rest` |
| `ledger.ts` | `buildLedger(rows, {onReject, onForget, reportHref})`, `buildLedgerRow`, `buildFacts(TextPart[])` (spoof) | `dl.ledger > div.ledger-row[data-tone][data-key](--inline, --danger-value) > dt (svg.glyph + label + span.sr-only «, ok / advarsel / alvorlig») + dd (value, `.ledger-row__aux`, `.ledger-row__detail`, `.ledger-row__act`)`. Spoof: `p.ledger-cap` + `p.facts`. A `report` action without a mailto is left out |
| `konsern.ts` | `buildKonsernRow(KonsernView, {onOpen})` | `button.konsern > svg.icon + span.konsern__text + svg.konsern__chev` |
| `actions.ts` | `buildActions({summary, panelHref?}, handlers)` → `{container}` (popup) | `div.actions > a.btn.btn--primary[href]` (Åpne i sidepanel) + `button.btn` (Kopier sammendrag) |
| `footer.ts` | `renderFooter(container, {fetchedAt?, now?, loading?, reportHref?}, {onRefresh})` | `footer.foot > div.foot__row` (freshness «Hentet … · Oppdater», the mailto) + `div.foot__row` (NLOD attribution; the mailto joins it when there is no freshness row). No mailto in the error state (no match to report) or when the Kobling row carries it (`TrustView.footReportHref`). In the panel the footer sits at the bottom of a short state: `details.css` makes the body a column and `main` takes the spare room |
| `notes.ts` | `buildNotes(merknader, endringer)` | `div.notes[data-tone=warn\|neutral] > figure.merknad > figcaption.note-head + blockquote.quote > p + p.quote__date > time`; `section[data-tone=neutral] > h3.note-head + ul.changes > li > time + span` (its own tone, so a merknad's warn never reaches its glyph) |
| `oversikt.ts` | `buildOversikt(dossier, {onDrill})`, `buildDefs`, `buildDefRow`, `buildClamp(lines)` | `section.section > h3.section__head + dl > div.def-row > dt + dd` (plain lines, `button.ent` drill-in, `a.ent` link, `span.def-row__sub`); Ledelse is `p.section__text` when the roller fetch failed. Ledelse lists Innehaver (an ENK's owner), daglig leder, styreleder, revisor, regnskapsfører, bostyrer; the popup's leaders line names the Innehaver too. A `clamp` row: `dd > div.clamp-wrap > p.clamp#id + button.text-btn.clamp__btn[aria-expanded][aria-controls][hidden]` — four lines by CSS `line-clamp`, «Vis mer» only once a ResizeObserver has measured an overflow, `.is-open` lifts the clamp |
| `personer.ts` | `buildPersoner(groups \| 'failed', {onDrill})`, `buildEntityRow(name, note, onOpen, {nameNode})` | `section > div.person(--gone) > b + span.person__role`; `button.entity-row > b + small + svg.icon` |
| `okonomi.ts` | `buildOkonomi(OkonomiView)` | `section[data-tone] > div.fig-head > h2 + span.cap` · `p.fig-status` · `div.figs > h3.fig-group + dl > div.fig-row(--total)[data-tone] > dt + dd > span.fig-row__unit` · `div.equity > .equity__track[aria-hidden] > .equity__fill` (`--share`) + `.equity__legend` (read: the only place Gjeld is said) · `div.trend > h3.fig-group.trend__head (+ `span.trend__cur` when no head above names the currency) + table.trend__table[aria-labelledby] > thead (years) + tbody > tr > th[scope=row][aria-label] (label, a space, `span.fig-row__unit`) + td (number only, `.num--neg`, `span.trend__comma`; `[title][aria-label]` on a «<0,1» cell)` + `p.trend__read` × rows (§ okonomi-trend) · `p.honest`. With no latest figures the section is `section__text` lines, then the same trend and honest line · Dokumenter: `div.doc-row > .years`, `div.ext-row` |
| `enheter.ts` | `buildEnheter(EnheterView, parentName, {onDrill, copy, announce})`, `KONSERN_CHILDREN_SHOWN` = 20 | Konsern: `ul.konsern-path > li` (`--depth`) with `.entity-row(--self)`; `p.konsern-sub.cap` + `ul > li > button.entity-row` (hidden past 20, `p.show-all`). Underenheter: `p.units-count`, `ul > li.unit(--gone) > span.unit__text > .unit__name + .unit__meta` + `button.orgnr.orgnr--sm`; the org.nr is a right column, and below 340 px the row stacks name, org.nr, meta (`.unit__text` is `display: contents`, the meta reordered after the button; the DOM still reads name, meta, button) |
| `picker.ts` | `renderPicker(container, {site, candidates}, {onPick, onNone, onSearchSelect, announce})` → `{heading, firstRow, input, search}` | `div.pick-head > h1 + p`; `ol.picker > li > button.pick[aria-keyshortcuts] > span.kbd + span > .pick__name + .pick__sub + span.pick__right > span.evidence(--strong hjemmeside \| --weak underside / navnetreff) + (.status-mark \| «N ansatte»)` (the chip on the name's line in every row, what the row adds under it); `button.pick.pick--none > span.kbd + span.pick__label`; `div.pick-search > label.field-label + label.search--lg` (empty: the rows already are the search for the site's name, and a filled box with no hits under it reads as a search that found nothing). Digit keys 1–4 / 0 on one document listener per document (§ lifecycle below). `pickerHead` words the head by what the rows are: no row with the site registered («Fant ikke selskapet bak …»), one row that has it («Står dette selskapet bak …?»), several that have it, or one among name matches («Mulige selskaper bak …»); every evidence chip has a `title` |
| `search.ts` | `buildSearchField` (one placeholder for every field, the masthead's too: «Navn eller org.nr»; no engine clear «×»; Escape is in the a11y contract below), `buildEntryRow`, `searchPainter`, `buildListSection(head)`, `renderRecents`, `renderSearchView(container, data, handlers)` | `div.empty > h1 + p + label.search--lg + p.hint`; a failed host check (degraded) leads with the error band instead of the h1 (its head is the answer; popup: focus lands on its h2), then one line «Søk etter et selskap i stedet.» and the field, in the panel the same band over «… i feltet over …»; `section.section > h3.section__head + ul.results \| ul > li > button.recent > span.recent__name > b (+ .status-mark, .recent__sub) + span.recent__on`; `li.results__note`; `button.back > svg.icon + b` |
| `skeleton.ts` | `buildSkeleton(surface, {kobling})`, `renderSkeleton` | the loaded geometry with real labels and `.sk.sk--*` values, `aria-hidden`; `main` is `inert` + `aria-busy` meanwhile. The panel's ledger has the Kobling row only when the result will (`koblingInPlay`, `src/lib/trust/kobling.ts`); the popup keeps five rows (næring fills in). The popup paints it as soon as it has read the tab's host, before the resolution cascade's network round trip |
| `live.ts` | `liveRegionOf(el)` → `{el, announce}`, `focusElement(target)` | the one `p.sr-only[aria-live=polite]` per document; `focusElement` gives a heading `tabindex=-1` |
| `details/tabs.ts` | `setupTabs(tablist, {initial, onSelect})` → `{activateByKey}` | `div.tabs[role=tablist][aria-label] > button.tab[role=tab][aria-selected][aria-controls] > span.tab__count`; roving tabindex, arrows / Home / End; the panels are `div[role=tabpanel][aria-labelledby][hidden]` inside `div.tab-panels` |

The surfaces compose these: `popup/views.ts` has one paint per popup
state (`paintLoading` / `paintResult` / `paintPicker` / `paintEmpty` /
`paintError`); `details/painter.ts` is the panel's painter behind the
`PanelPainter` seam (docs/notes/sidebar-sync.md). Both set
`body[data-answer]` (ok | warn | danger | pick | empty | loading) and
`main#app[data-state]` (loading | result | picker | empty | error |
search): the smoke and the tests key on those, not on classes.

<!-- SECTION: masthead-mark -->
## The brand mark in the UI

The overhand knot, both tails level, in a 16×15 slot at the start of
every masthead (popup, panel, the welcome page and its example cards).
`brandMark()` in `masthead.ts` builds it with `createElementNS`, no
sprite: one `svg.mast__mark` holding a nested `<svg>` per drawing from
`src/lib/view/mark-data.ts`, which `pnpm icons` generates from the
masters (`assets/brand/README.md`), each drawing cropped to its ink in
whole units. `mark--x1` is the 16 px icon's drawing (rows 0–14, so
16×15) at one CSS px per unit; `mark--x2` is the 32 px drawing (rows
3–28, so 16×13 CSS px, placed 1 px down to centre it) at half that,
shown from `1.5dppx` up (the masthead block in `src/styles/brreg.css`),
the same drawing a 2x toolbar shows. The slot's height is odd on
purpose: every masthead is a fixed height (popup 40, panel 44, welcome
48 px) less its 1 px rule, so its content box is odd and only an odd
slot centres on a whole CSS px (y 12, 14 and 16). The mark therefore
lands on whole device pixels vertically at 1x and at 2x in every
masthead; `tests/brand.test.ts` fails when a regenerated slot is even
or a drawing is off its pixel grid. Horizontally the popup and panel
start at a fixed padding, but the welcome page's gutter scales with
the viewport (`--page-gut`, `src/welcome/welcome.css`), so at some
window widths its mark starts on a fraction of a pixel; nothing tests
that. The welcome page's example cards sit
wherever the text above them ends, so there the mark can land on a
fraction of a pixel. Fractional scales (125 %, 150 %, browser zoom)
get the nearer drawing, scaled, so there it is not pixel-crisp. Width
and height are SVG attributes, not `style` (CSP). Colour is `--brand`, the
masters' `#4A74FF` in both themes (3.6 light, 4.7 dark: a graphic, so
3:1); `tests/brand.test.ts` fails when the two drift. The popup and
panel masthead name it (`role="img"`, `aria-label` «brreg-snap»); on
the welcome page it is `aria-hidden`, beside the brand name in text.

<!-- SECTION: a11y -->
## The a11y contract

- One `aria-live="polite"` region per document (`#live`), and every
  announcement goes through it: load progress («Henter … fra
  Brønnøysundregistrene»), copy outcomes, search result counts. A
  second region would make screen readers race.
- `role="alert"` only on the danger verdict; the ok and warn bands are
  labelled sections. Errors are never alerts.
- Tone is never colour alone: the glyph shape (✓ ! ✕ ·) is the first
  channel, the ledger's `span.sr-only` text («, ok», «, advarsel», «,
  alvorlig») the second, colour the third. Forced colours keep the
  rules, the seals and the verdict's frame (`CanvasText`); the key
  word loses its red there, so the kicker's ✕ and word are what mark
  the verdict.
- Focus moves only on a user-initiated transition (a pick, a search, a
  retry, a drill-in), to the result heading (the error band's when the
  load fails) or the first picker row, and in the panel only while its
  window has focus; a background repaint (auto-sync) never moves it.
  One focus style everywhere: the amber ring on `:focus-visible`; the
  search box carries it for its input, the verdict too (on its tint the
  ring measures 4.8 light / 8.0 dark against WCAG 1.4.11's 3:1,
  § tokens).
- A background rebuild must not drop focus either: the panel's 30 s
  freshness tick rewrites the footer's text node in place
  (`renderFooter(...).tick`), and a same-view keep (provenance) that
  rebuilds the top and the footer puts focus back on the equivalent
  control — same tag, same accessible text (`rebuildKeepingFocus` in
  painter.ts) — or leaves it where the browser dropped it when the
  control is gone.
- The verdict's DOM stays one sentence («Nettstedet er ikke koblet til
  selskapet») so a screen reader hears it, whatever the colour marks.
- The tablist is a real tablist (roving tabindex, arrow keys); the
  skeleton is `inert` and hidden from AT; `[hidden]` always renders
  `display: none` (the smoke asserts no hidden element paints). The
  panel's `nav.back-nav` hides with its drill-in button, so no empty
  landmark lists.
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

Firefox and Chrome cap a popup at 600 px; the design fixes the width at
380 px and measures every state against the cap (the harness measures
`document.body` height; the real popup's viewport reads 1 px under its
content, a rounding, not an overflow). Measured 2026-10-06 against the
live API, Chromium and Gecko alike: dnb 581, equinor 600 (no line to
spare), nrk picker 592, sbanken picker 559; the two verdict states
re-measured 2026-10-14 with the stamped verdict (live API and the smoke
fixtures agree, Chromium through the preview harness): spoof 581,
konkurs 586, nothing shed. With the «Noe kunne ikke hentes» line (a
failed part drops a row too): dnb with roller + regnskap + konsern
failed 506, equinor with only konsern failed 586; a verdict gets no
line, because konkurs (586) or the spoof (581) plus a line would sit
too close to the cap for a longer name.

The design rules below keep the common states under the cap. Names,
leaders and parent companies are as long as the registry has them, so
the popup also fits itself: after every paint and the font swap,
`fitBudget` (`src/popup/views.ts`) measures the body and, while it
passes 600 px, adds the next shed class to `<body>` (CSS in
`src/styles/brreg.css`). The order: (1) the regnskap row's money and a
picker row's activity past one line, (2) the provenance eyebrow, (3) a
neutral Kobling row's note («ingen hjemmeside registrert»). A warn or
danger Kobling note is the finding and never sheds. A state that fits
sheds nothing; the panel never sheds. The smoke asserts every popup
state within 600 px and every verdict's key word inside its frame (the
word's box against the answer's content box, since an `inline-block`
word pokes out of a line without any scroll overflow).

- Identity uses one compact leaders line («Daglig leder X · Styreleder
  Y», wrapping whole pairs) instead of a two-column block; one person
  in both roles is one pair, «Daglig leder og styreleder X».
- Under a verdict the leaders line is dropped (reassurance next to a
  konkurs), the regnskap row names the year only (the money lives in
  the panel's Økonomi tab), and the Kobling row is short («Registrert
  hjemmeside»: the host is already in the masthead, the date already
  in the verdict).
- Under a warn band the popup's regnskap row names the year only too
  (`signalRow`'s `roomForMoney`): a url-param company with a merknad,
  a provenance line and two leaders measured 610 px with the money.
  The panel keeps the money under a warn band; only a verdict drops it
  there.
- On a spoof the company's ledger becomes one prose line under «Om
  selskapet — sier ingenting om dette nettstedet» (`.facts`); four
  rows put the spoof popup at 660 px.
- A merknad in the answer is carried as a count («1 merknad i
  registeret») on both surfaces: the popup has no room for the quote,
  and the panel quotes it in full in the notes block right under the
  ledger, so the headline must not say it twice.
- The footer is sticky in the popup, so the NLOD attribution (a licence
  condition) stays visible under a long name.

<!-- SECTION: amendments -->
## Design decisions

- **No copy toast.** Copy feedback is the button itself: the icon swaps
  to the check, the number tints ok (or the label reads «Kopiert») for
  1.4 s, and the live region says it.
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
  reads first (`appendName` in dom.ts): in Enheter, and in the
  identity's «Avdeling: …» note under the parent's name on both
  surfaces. The prefix is the parent's full
  name or its base name — the name minus a legal-form suffix (AS, ASA,
  SA, DA, ANS, BA, NUF, KS, SE, IKS, BBL, SF, …; `baseName`) — matched
  as whole words at the start, and what is left must say something of
  its own (at least one word that is not a legal form): «EQUINOR AS»
  under «EQUINOR ASA» keeps its whole name. The text stays the full
  name; only the node shape changes.
- **No orphan at a line break.** A legal-form suffix stays with the
  word before it wherever a name is written through `appendName` (a
  no-break space, not `.nw`, so `.app`'s overflow-wrap can still break
  a pair wider than its column), the konsern row's «55 selskaper» stays together, an
  underenhet's «postnr sted» is joined by no-break spaces, the PDF
  years' «·» trails the year before it so no line starts with one, and
  a footer row's second item stays right when it wraps.
- **Konsern rows are not underlined by default.** The chevron already
  says «drill in»; the underline appears on hover and keyboard focus,
  and the focus ring stays.
- **The back bar underlines on hover**, like the recents and the
  entity rows: its `<b>` (the name it returns to) takes the underline.
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
with `repaint` as the way back: the head «Søk i Brønnøysundregistrene»,
the field and its hint, no sub line (the placeholder says what to
type).

The compact head (`#stick`: seal · name · org.nr) sits in a zero-height
sticky wrapper so showing it never moves the page; an
IntersectionObserver on the identity block shows it once the identity
is scrolled past. A deep link (`?tab=<key>`, the popup's konsern row
opening Enheter) lands on the tabs: after `document.fonts.ready` the
painter shows the head, gives the tab region (`div.tab-panels`) the
height the landing leaves it (`--land` = head + tablist + what follows
the region, i.e. the footer; details.css sets `min-height:
calc(100dvh - var(--land))` on `.tab-panels--held`) and scrolls the
tablist to sit right under the head. The min-height is what makes a
short tab (Økonomi at 320 px) scroll that far, and it keeps the tablist
put when switching from a long tab to a short one, so the painter adds
`--held` only once the tabs are in use: a landing, a tab switch, or a
Back/Forward restore (a tab selected while loading holds the result
that follows). A plain load of a short dossier (a deleted company's
Registrering) has no scrollbar; the footer stays pinned to the bottom,
so blank paper can remain under a short tab.

<!-- SECTION: okonomi-trend -->
## The Økonomi trend

`src/lib/view/trend.ts` builds «Utvikling <first>–<last>» from the
company's own filings (`companyRegnskapByYear`): driftsinntekter and
årsresultat, at most the last three years (three columns fit 320 px),
only years in the currency of the newest year that holds a trend
figure. It stands apart from the latest year's figures, so a latest
filing without figures still shows the years before it. One year with
figures: no block.

Alignment: each row names its magnitude word once, beside its label
(`formatAmountsIn`: the unit of the row's largest value; a non-zero
value that rounds to zero in it reads «<0,1», «-<0,1» for a loss,
«<1» in tusen, with the exact amount as the cell's `title` and
accessible name), so the cells are short numbers however wide the
row's spread, right-aligned in equal fixed-width columns,
`tabular-nums`, `nowrap`. The decimal comma sits in its own
proportional span: Schibsted's tabular comma is digit-wide. The row
header has a real space before the unit and an accessible name in
words with the currency («Driftsinntekter, milliarder NOK»).

One sentence per row, read for the period the heading names:

- An end year without the figure: no sentence for that row.
- No loss year: first to last. «uendret» (equal), «opp/ned N %» from a
  first year above zero (under 1 % is «omtrent uendret»), bare
  «opp»/«ned» otherwise and from 1000 % up (`PCT_CAP`: a tiny base).
  A middle year that leaves the ends' range by
  more than a tenth of the larger end is named: «Driftsinntekter ned
  26 %, høyest i 2024.»
- Årsresultat with a loss, first match wins: every year a loss («i
  underskudd begge år, like stort / omtrent like stort / større sist /
  mindre sist», or «alle år, størst i 2024» for a deep middle); one
  clean sign change («snudde fra underskudd til overskudd i 2025»; the
  year only when the held years either side are back to back, else no
  year); profit at both ends with a loss between («opp 12 %, men underskudd i
  2024»); otherwise the loss years («Årsresultat: underskudd i 2023 og
  2025.»).

The honest line under it, a plain sentence like the trend's (no glyph:
it has no tone), takes the trend's span («Åpne data dekker
2023–2024.»); when the Enhet names a newer filed year than the API
holds, that stays in the status line and the PDF note reads «Andre
år» instead of «Eldre år».

Tone never changes: hairlines and ink, a negative cell is
`.num--neg`, and the section's `data-tone` is the regnskap signal's.

<!-- SECTION: badge -->
## The toolbar badge

Both surfaces set the followed tab's toolbar badge from the same rule
(`view.badgeTone`, `platform/badge.ts`): the answer's tone when the
company on screen is the tab's own (host-derived: URL, title or
hostname) and it is warn or danger; cleared for everything else — an
ok answer, a manual pick, a drill-in, a picker, an empty or error
state. The popup uses the tab it opened on; the panel the tab it
follows (`tabId` on every paint): the one it read at startup, the last
tab event's, or the one the last message named (`PanelMessage.tabId`).
A message that names none leaves it following none, so it never touches
another tab's badge; a drill-in and the panel's own re-resolves
(«Prøv igjen», «Glem valget») keep it. Back / Forward keep it only when
the entry was painted for that same tab (stamped in `history.state`),
else follow none. A kept picker or empty state that now follows another
tab clears that tab's badge without repainting. Known limit: with
auto-sync off the panel can't see its followed tab navigate, so a later
paint can still badge that tab's new page. No permission:
`action.setBadgeText` needs only the manifest's `action` key.

<!-- SECTION: welcome -->
## The welcome page

`src/welcome/` is opened once by the install hook: one screen at
1280×800, no network, nothing stored. The two example cards are the
real components on fictional data (`figure.example[data-answer]`, the
card `aria-hidden`, the caption is what a screen reader gets, no
`role=alert`, nothing focusable). The cards share one height and their
content is balanced — the calm one carries the leaders line and four
rows, the loud one the verdict — so neither ends in a blank. The only
browser API read is `commands.getAll()` for the shortcut keys; the pin
instruction and the way to change shortcuts come from
`platform/engine.ts`. The page composes `welcome.css` on top of
`brreg.css` (a display size for the headline, a lead size, the card
frame, the key caps).
