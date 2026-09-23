# Resolution cascade

Source: `src/lib/orgnr.ts`, `src/lib/mod11.ts`, `src/lib/hostname-score.ts`,
`src/lib/hostname-search.ts`, `src/lib/company-load.ts`.

<!-- SECTION: cascade -->
## Cascade order

`resolveOrgnr` (sync) in `src/lib/orgnr.ts` tries:

1. An orgnr named EXPLICITLY in a query param (`?orgnr=`,
   `?organisasjonsnummer=` …) — author intent, wins outright.
2. A single distinct valid candidate in the URL.
3. A single distinct valid candidate in the title.

A candidate is either a contiguous 9-digit run or the canonical
display format — three groups of three digits with ONE consistent
separator from {space, dot, U+00A0} ("982 463 718", "982.463.718").
Mixed separators and groups embedded in longer digit sequences
("1982 463 718") are rejected; spaced matches normalize to 9 digits
and share the same candidate set as contiguous runs, so the same
orgnr in both formats counts once.

`resolveOrgnrAsync` runs the same sync cascade then falls back to a
hostname-based brreg search (`searchByHostname` in
`hostname-search.ts`). There is no static domain → orgnr table —
every resolution decision is a live brreg API call. Hosts brreg's
data can't disambiguate (e.g. `finn.no`, whose legal name "FINN.no"
loses its period in the search index) simply don't resolve, and the
sidebar falls back to inline manual search.

**Ambiguity → abstain (anti-shadowing).** `extractOrgnrFromText`
trusts a 9-digit run ONLY when it is the *single* distinct mod-11-valid
candidate in the text; with two or more distinct valid candidates it
returns `undefined`. ~9% of arbitrary 9-digit numbers pass mod-11, so a
chance-valid tracking id / product id / timestamp positionally before
the real orgnr used to win and silently resolve the WRONG company
(the pre-2026-06 "first valid run wins" behaviour). A bare 9-digit
*path* segment is deliberately NOT authoritative — it is as likely a
product id — so it rides the same single-candidate rule; only a *named*
param wins amid other digits (abstaining if two named values disagree).
Abstaining drops through to the hostname pipeline / picker: better no
answer than a confidently wrong one. The named-param + ambiguity cases
are pinned in `tests/orgnr.test.ts`.

<!-- SECTION: orgnr-lookup -->
## An orgnr in hand: enhet, else underenhet → parent

Every company view on both surfaces loads its orgnr through
`loadCompany` in `src/lib/company-load.ts`, wherever the orgnr came
from: URL, title, panel hint, sync message, recents, drill-in, and
the manual search box (which calls `lookupOrgnr` directly).
`/enheter/{orgnr}` 404s for an underenhet (a branch: the number on a
receipt or a branch page, e.g. 973160834 DNB BANK ASA AVD ALTA), so a
404 retries `/underenheter/{orgnr}` and shows its `overordnetEnhet`,
with an «Avdeling: <navn> (<orgnr>)» line above the verdict on both
surfaces. A deleted underenhet (`SlettetUnderEnhet`, no parent) and an
orgnr that is neither are permanent answers: the error state offers no
«Prøv igjen».

The manual search box takes the same route for orgnr-shaped input:
brreg's `navn=` search can't find a company by its number (0 hits for
`923609016`, unrelated names for `923 609 016`). `parseOrgnrQuery`
accepts the digits with spaces, dots, U+00A0, the invoice form
`NO 923 609 016 MVA`, and the label a site footer prints in front
(`Org.nr.`, `Org nr:`, `Orgnr`, any case). A valid orgnr is looked up directly and shown as
the one hit. An underenhet row reads «<navn> — avdeling av <parent>»,
and selecting it loads the branch orgnr through the fallback above.
Nine digits that fail mod-11 get «… er ikke et gyldig
organisasjonsnummer.» without a request. Pinned in
`tests/company-load.test.ts` and `tests/manual-search.test.ts`.

<!-- SECTION: mod11-module -->
## Why `mod11.ts` is its own module

`isValidOrgnr` is consumed by `orgnr.ts` (URL/title cascade) and
`details.ts` (validating the `?orgnr=` URL param before fetching).
Keeping it in a zero-dependency module means new callers can pull
it in without dragging the rest of `orgnr.ts` along and without
risking an import cycle.

<!-- SECTION: first-digit-89 -->
## First digit must be 8 or 9

`isValidOrgnr` requires the first digit to be 8 or 9 on top of the
mod-11 check. Empirical, not documented: the lowest registered orgnr
is 810034882 (lowest underenhet 811545082, verified against the live
API 2026-06-10 across all 1,164,034 enheter) — an artifact of the
1995 conversion from 7-digit numbers. Brreg only documents "9 digits
+ mod-11", so if a new series ever opens the check must be relaxed
in `mod11.ts`; the failure mode is graceful (extraction misses →
hostname/name-search fallback). Until then it rejects most
chance-valid junk ids that mod-11 alone lets through (~9% of
arbitrary 9-digit runs).

<!-- SECTION: sync-vs-async -->
## Sync vs async — when to call which

`resolveOrgnr` / `deriveSync` are still exported because some callers
run inside a user-gesture stack and can't await before the next
browser API call (`sidebarAction.open`, `permissions.request`). The
context menu handler is the canonical example: it sync-resolves for
`setPanel + open`; on a miss it hands the host to the panel, which
runs the async search itself.

Everything else (popup init, the panel's startup and auto-sync tab
events) goes through `resolveTabContext`, which calls
`searchByHostnameDetailed` so it can branch on the resolution band
(see § bands below) and render the picker for ambiguous hosts.

<!-- SECTION: bands -->
## Resolution bands

`hostname-search.ts` exposes two entry points:

- `searchByHostname(host)` returns `string | undefined` — only AUTO
  matches resolve. Used by `resolveOrgnrAsync` in `orgnr.ts`.
- `searchByHostnameDetailed(host)` returns `{band, candidates, choice?}`
  — used by the sidebar so it can render the picker UI for the
  `'picker'` band.

Bands are decided in `hostname-score.ts:decideBand`:

| Band | Condition | Outcome |
|---|---|---|
| `auto` | top ≥ 75 AND top − runner-up ≥ 10 AND top has a hjemmeside tie | resolve to top candidate |
| `picker` | top ≥ 45 | popup + sidebar show top-N + "Ingen av disse" |
| `none` | otherwise | sidebar shows empty state |

The AUTO margin requirement is what prevents kjedebutikker (ELKJØP
LEKNES vs ELKJØP SVOLVÆR, both 111 via hjemmeside-exact) from
auto-resolving.

**AUTO needs a hjemmeside tie.** The top candidate's registered
hjemmeside must be the visited site, a page on it or a subdomain of
it (`ScoreResult.hjemmesideTie`, see § hjemmeside-normalization). A
name match alone is a guess: medium.com and bbc.co.uk scored 81 on
unrelated Norwegian namesakes, and the UI renders an AUTO result like
a verified one. So name-only winners go to the picker, even well-known
ones whose registered site is elsewhere (orkla.com: no hjemmeside;
equinor.no: equinor.com; komplett.no: komplettgroup.com) — the right
answer is then the picker's first row.

The picker row count is `MAX_PICKER_CANDIDATES` exported from
`hostname-search.ts` — currently 4. The constant is tied to the
keyboard shortcuts (1-4 select the corresponding row, 0/Esc triggers
"Ingen av disse") both popup and sidebar register at module load.
Bumping the constant requires extending the digit-key handler in
`popup.ts` and `details.ts`.

<!-- SECTION: label-extraction -->
## Registrable domain and label (suffixes, platforms, punycode)

`registrableDomain` in `hostname-score.ts` reduces the visited host
to the part a company registers (`nettbank.dnb.no` → `dnb.no`); Q1
queries it and scoring compares hjemmeside against it.
`hostnameLabel` takes its leftmost label to seed the name search.
The traps they handle:

- **Hosts that never reach brreg.** IPv4/IPv6 literals, single-label
  hosts (`localhost`, `intranet`) and special-use/intranet TLDs
  (`.local`, `.internal`, `.lan`, `.home.arpa`, `.corp`, `.test`, …)
  return `undefined`. `resolveInternal` then answers band `none`
  without a request and without a cache write — internal host names
  used to go out as `hjemmeside=`/`navn=` queries.
- **Multi-part public suffixes.** A small static list (`co.uk`,
  `com.au`, `kommune.no`, … — intentionally non-exhaustive, generic
  TLD knowledge, NOT curated company data) shifts the label one part
  left so `company.co.uk` → "company" and `oslo.kommune.no` → "oslo"
  instead of "co"/"kommune".
- **Hosting platforms.** A second short list (`github.io`,
  `pages.dev`, `netlify.app`, `myshopify.com`, `wixsite.com`, …)
  treats the platform as a suffix, so the tenant is the brand
  (`firma.pages.dev` → "firma", not "pages"). `sites.google.com` is
  on it so the bare host abstains: its tenant lives in the path.
- **Punycode.** `new URL().hostname` returns IDN labels in ACE form
  (`blåbær.no` → `xn--blbr-roah.no`). A minimal RFC 3492 decoder
  (`src/lib/punycode.ts`, decode only) restores the human label so
  the Nordic-variant machinery can actually match æ/ø/å brands. A
  label that fails to decode returns `undefined` — the abstain
  signal: `resolveInternal` treats a falsy label as band `none`, so
  the sidebar falls to manual search instead of querying a raw
  `xn--` string that can never match.

<!-- SECTION: queries -->
## Brreg queries

`runPipeline` in `hostname-search.ts` sends, in parallel: Q1
`hjemmeside=<registrable domain>&sort=antallAnsatte,DESC&size=20`,
and Q2 `navn=<variant>` (FORTLOEPENDE, org forms
`AS,ASA,SA,BBL,ORGL,SF`, sorted by headcount) per Nordic variant of
the label. Q3 drops the org-form filter only when Q1+Q2 return
nothing.

Brreg matches `hjemmeside` as a **substring** (live, 2026-09-23):
`hjemmeside=nrk.no` also returns `www.nrk.no/...` rows, and
`hjemmeside=sbanken.no` returns `www.tidsbanken.no`. So one query
covers the `www.` form, and precision comes from scoring (§ below),
not from the query. A popular domain returns hundreds of rows
(obos.no: 600+ borettslag on `www.obos.no`); unsorted, the first page
never reached OBOS BBL, so Q1 sorts by headcount. Trade-off: a short
domain that is a substring of many others (`if.no` → `*if.no` sports
clubs) fills the 20 rows with bigger unrelated organisations.

<!-- SECTION: hjemmeside-normalization -->
## Hjemmeside matching

Brreg's `hjemmeside` field is free text ("http://www.equinor.com",
"https://orkla.com/", "www.storebrand.no/eiendom"). Each entry (the
field is split on commas, semicolons and whitespace first) is
reduced by `normalizeHjemmeside` to a bare lowercase host (strip
scheme, `www.`, path/port/query/fragment, trailing dots), then
compared on domain-label boundaries only:

| Relation | Example (visiting `storebrand.no`) | Points |
|---|---|---|
| exact — the site itself, no path | `https://www.storebrand.no/` | +35 |
| page — a path on the site | `www.storebrand.no/eiendom` | +12 |
| subdomain of the registrable domain | `kunde.storebrand.no` | +12 |
| none — plain substring | `www.tidsbanken.no` for `sbanken.no` | 0 |

"The site" is the visited host or its registrable domain, so
`nettbank.dnb.no` ties to `www.dnb.no`. Page ties are weaker than
exact because a big site has far more satellites registered on its
pages (funds on `/fond`, property SPVs on `/eiendom`, NRK Urørt
artists) than owners; scored as exact, Storebrand's SPVs pushed
STOREBRAND ASA out of the picker. Any of the three relations counts as
the hjemmeside tie AUTO needs (§ bands).

The konkurs/avvikling penalty (−30) skips an exact tie: then the
registry says this is the site's own company, and its status is the
warning the user needs, not noise to rank away. It still applies to
name-only and page/subdomain matches. Search never returns deleted
entities, so there is no slettet case.

<!-- SECTION: picker-choice -->
## Picker choice cache

When the user picks from the sidebar's "Mente du…?" list,
`setPickerChoice(host, orgnr)` writes a 24h entry under
`picker-choice:<host>`. The next visit short-circuits both bands and
the network — `searchByHostnameDetailed` returns `{band:'auto',
candidates:[], choice}`. `setPickerChoice(host, null)` ("Ingen av
disse") caches a negative choice that returns `{band:'none'}` on the
next visit. Clears with the existing `storage.session` lifetime.

Only a deliberate decline stores the negative choice: the «Ingen av
disse» button or its `0` shortcut. Escape is not a shortcut. It is
the reflex key for leaving a popup, the stored "no" has no undo in
the UI, so the picker leaves Escape to the browser and persists
nothing (`src/lib/ui/picker.ts`, pinned in `tests/picker.test.ts`).

<!-- SECTION: reject-override -->
## Reject override (`Feil bedrift?` / `Feil treff?`)

Both popup ("Feil treff? Vis alternativer") and sidebar ("Feil
bedrift? Vis alternativer") expose this link on the result panel
whenever the current orgnr was resolved by hostname search
(`host-auto` or `host-pick` resolution method). Clicking it calls
`addRejectedChoice(host, orgnr)` which:

1. Appends the orgnr to `rejected:<host>` (24h TTL).
2. Clears `picker-choice:<host>` if it equals the rejected orgnr.

The next `searchByHostnameDetailed` reads the rejected list, passes
it through `runPipeline` which filters rejected candidates before
scoring, and stores the result under
`hostname:<host>:rej:<sorted>` so the pre-rejection cache entry
isn't served. The picker then opens over the remaining candidates
(even when filtering leaves a single AUTO winner — the user just
expressed doubt, the picker requires explicit confirmation). Empty
after filtering → empty state with inline manual search.

URL-derived orgnrs (regex hit in path or title) do not show the
override — they're authoritative for the domain.
