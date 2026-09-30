# brreg API quirks

Source: `src/lib/brreg.ts`, `konsern.ts`, `aarsregnskap.ts`.

<!-- SECTION: regnskap-base-url -->
## Regnskap is on a different API base

Enhetsregisteret lives at `data.brreg.no/enhetsregisteret/api`, but
Regnskapsregisteret is on
`data.brreg.no/regnskapsregisteret/regnskap/<orgnr>` (no `/api/`,
different sub-host). Response is an array; the code defensively sorts by
`regnskapsperiode.tilDato` before picking "latest"
(`sortRegnskapDesc`). 404 is normal: many small AS-er don't file
separately. Cache the empty array so refresh doesn't re-hit.

<!-- SECTION: regnskap-single-year-only -->
## The open endpoint returns ONLY the latest year

Empirically (verified 2026-06 across ~294 live companies plus the
`år` / `regnskapstype` / `size` params and the published OpenAPI spec)
the public endpoint returns exactly **one** filing per orgnr — the
latest accounting year, `regnskapstype: SELSKAP`. It never returns a
second year: `?år=2023` still returns the 2024 filing (the param does
not select history), and there is no structured-JSON path to prior
years (only the per-year PDF `kopi/{aar}` document endpoint, see
§ aarsregnskap-kopi).

Consequence: the Økonomi tab shows the latest filing only, says so,
and points at the annual-report copies for older years
(`src/lib/view/dossier-view.ts`, `src/lib/view/components/okonomi.ts`;
§ aarsregnskap-kopi). There is no multi-year trend view. This is NOT a
bug to "fix" by probing harder; the data is simply not exposed. The
live canary's tripwire (`tests/live/contracts.test.ts`) fails if brreg
starts serving more than one filing, which would make a trend view
possible.

<!-- SECTION: regnskap-500-unsupported-plan -->
## 500 from regnskap = "not in the open API", not a network failure

500 is its own outcome: banks, insurers and similar regulated sectors
file under specialised oppstillingsplaner (`BANK`, `FORS`) that the
open endpoint can't serialise, and it answers 500 for them every time.
Live 2026-09-23: DNB BANK ASA 984851006, SpareBank 1 SMN 937901003,
Storebrand Liv 958995369, Gjensidige 995568217 (NACE 64.190 / 64.190 /
65.110 / 65.120).

The body used to name the plan (`"message": "Regnskapet inneholder en
oppstillingsplan som ikke er stottet (BANK)"`, documented 2026-06-22).
By 2026-09-23 it is generic: `"message": "An error occurred while
processing the request."` (fixture:
`tests/fixtures/brreg/regnskap-984851006-500.json`). When it changed
is unknown. Don't depend on the body.

`fetchRegnskap` therefore maps the answers explicitly
(`RegnskapResponse` in `src/types/brreg.ts`):

- 2xx → `items`; 404 → `items: []` (nothing filed), cached 24h.
- 500 → `{ items: [], unavailable: true }`, plus `unsupportedPlan` if
  the body still names one. Cached **6h**: stable for banks, but also
  what a real outage looks like.
- network failure / other status → rejects; callers map it to
  `undefined` ("couldn't ask").

The UI never says "prøv igjen senere" for a 500. Nøkkeltall explains
the gap via `regnskapGap()` (`src/lib/regnskap.ts`): NACE 64.1x / 65.x
(or a named plan) → banks and insurers file special accounts the open
API doesn't show; anything else → "brreg sitt åpne API ga feil". It
also shows `Enhet.sisteInnsendteAarsregnskap` and links the company's
brreg page. The verdict strip reads the filing year from that Enhet
field first, so a 500 no longer blanks the cell. Only when the Enhet
has no year does the regnskap response decide it: no response or a
bare 500 omits the cell, a 500 naming its plan gives «Levert ·
spesialregnskap», nothing filed gives «Mangler», «Ingen» or «Ikke pliktig»
(`regnskapSignal` in `src/lib/trust/signals.ts`; staleness and the
ENK case: `docs/notes/trust.md` § signals).

<!-- SECTION: error-contract -->
## Error contract: search throws, [] means a real empty result

`searchEnheter` and `searchEnheterWithParams` throw on network
failure, timeout, and every non-2xx response (429/503 included).
They return `[]` only for a genuine 2xx response with zero hits.
Don't reintroduce a swallow-and-return-`[]` catch: the resolution
pipeline caches its outcome for 24h, and an offline moment disguised
as "no hits" gets pinned as a day-long "no match" (see
`docs/notes/cache.md` § failure-no-cache for the caching rule).

The detail fetchers (`fetchEnhet`, `fetchUnderenhet`, `fetchRoller`,
`fetchUnderenheter`, `fetchRegnskap`, `fetchKonsernstruktur`,
`fetchAarsregnskapYears`, and `fetchEndringer` in
`src/lib/brreg-endringer.ts`, see `docs/notes/trust.md` § endringer)
keep their documented special cases — roller 404 → empty, regnskap 404
→ empty, regnskap 500 → unavailable (above), underenhet 404 →
`undefined` (so an orgnr lookup can fall back without try/catch),
konsernstruktur 404 → `undefined` and aarsregnskap 404 → `[]` (below)
— and throw on everything else.
`loadCompany` in `src/lib/company-load.ts` is the one place that
turns a soft dependency's rejection into `undefined`; the renderers
then say "Kunne ikke hente …", never the empty state. It also owns the
enhet 404 → underenhet → parent fallback (`docs/notes/resolution.md`
§ orgnr-lookup).

`fetchUnderenheter` returns `{ items, total }`: one request, first 100
rows, with `total` from `page.totalElements` (Posten Bring 984661185:
133). A parent with none has no `_embedded` at all, only
`page.totalElements: 0`.

Every brreg fetch goes through `brregFetch` in `brreg.ts` (the change
feed, `konsern.ts` and `aarsregnskap.ts` too) and carries
`AbortSignal.timeout(8000)` (Firefox 100+ / Chrome 103+). A timeout
aborts the fetch with a rejection, which counts as a failure like any
other. The only retry is the one below.

<!-- SECTION: rate-limit -->
## 429: one retry when Retry-After allows it

`brregFetch` retries a 429 exactly once, after the wait its
`Retry-After` asks for (delay-seconds or an HTTP-date,
`parseRetryAfter`), but only when that wait is at most 5 s
(`MAX_RETRY_AFTER_MS`). No header, an unparsable one, a longer wait or
a second 429 hands the 429 back, and the caller throws its usual
`… returned 429.` — a transient failure: never cached, «Prøv igjen»
offered (`describeLoadError`). Whether brreg actually sends
Retry-After is unknown: its API docs don't mention rate limits, and no
429 was provoked live. Per-host coalescing in the hostname pipeline
(`docs/notes/resolution.md` § coalescing) keeps the fan-out from
multiplying in the first place.

<!-- SECTION: konsernstruktur -->
## /konsernstruktur returns the whole group, rooted at the top parent

`GET /enhetsregisteret/api/konsernstruktur/{orgnr}` (brreg changelog
2026-06-24). Verified live 2026-09-24:

- The answer is the WHOLE group rooted at its top parent, whichever
  member was asked: 990888213 (EQUINOR ENERGY AS) returns the same
  bytes as 923609016 (EQUINOR ASA), 55 nodes.
- The root has `organisasjonsnummer`, `navn`, `organisasjonsform`,
  `children`. Every other node adds `nivaa`, `knytningsform {kode,
  beskrivelse}`, `grunnlag`, `dato`, `parentOrganisasjonsnummer`,
  `parentNavn`. A leaf has no `children` key (never `[]`).
- `knytningsform`: `KDAT` «Konsern datter» (900 of 922 links across
  the 14 groups fetched), `KMOR` «Konsern mor» (a mid-level parent,
  e.g. HYDRO ALUMINIUM AS under Norsk Hydro ASA), `KGRL` «Konsern
  grunnlag» (a partial stake).
- `grunnlag` has no fixed format: `100%`, `100 %`, `99,99%`, `95,0%`,
  `95,00%`, or text: `Indirekte mor`. `formatGrunnlag` reads the
  numbers and keeps two decimals (99,99 % must not round to 100 %).
- `nivaa` is not reliable: 51 of 937 nodes had a `nivaa` other than
  their depth. Derive depth from the tree.
- Not in a group → 404 with an empty body (STATKRAFT AS 987059699,
  whose Enhet says `erIKonsern: false`; also a deleted enhet). An
  invalid orgnr (`/123`) → 400. `erIKonsern` is on every live Enhet
  and gates the fetch.
- Sizes seen: NorgesGruppen (asked as 819731322, rooted at JOH
  JOHANNSON HANDEL AS) 250 companies, depth 5, 80 KB, 0.8 s — the
  largest; REITAN AS 199 nodes (194 companies); AF GRUPPEN 109; Aker
  96 nodes (52 companies); widest single
  parent AMEDIA NORGE AS, 45 children. The panel caps the children list;
  `deriveKonsern` returns direct children only.

`fetchKonsernstruktur` caches the tree 24 h under `konsern:<orgnr>`
(the asked orgnr), a 404 as `{ root: null }`; a root without children
also reads as «not in a group». `loadCompany({ konsern: true })` runs
it only when `erIKonsern` is true and hands the panel the derived
`Konsern` (`null` = in no group, `undefined` = couldn't ask).

<!-- SECTION: konsernstruktur-duplicates -->
### A company can sit under several parents

It is a tree in JSON only: a company owned through more than one link
appears once under each parent, with its whole subtree repeated.
Live: AKER ASA sits under TRG HOLDING AS (`KMOR`, 66,99%) and directly
under THE RESOURCE GROUP TRG AS (`KGRL`, 1,19%) — 37 companies appear
more than once in that group. BJØRVIKA IKT AS is `KGRL` 33,33% under TELENOR
NORGE AS and `KMOR` «Indirekte mor» directly under TELENOR ASA. THE
QRILL COMPANY AS is `KDAT` 60% under one parent and `KGRL` 40% under
another.

`deriveKonsern` therefore picks one parent per company: a controlling
link (anything but `KGRL`) beats a partial stake, then the larger
stake, then the first listed. The path follows those chosen parents
(so it agrees with the parent shown), `groupSize` counts each company
once, and children are deduplicated. A parent's children still list
companies it holds only a partial stake in, with that stake.

<!-- SECTION: aarsregnskap-kopi -->
## Annual-report copies: a year list (fetched) and PDFs (linked only)

Regnskapsregisteret's OpenAPI lists
`/regnskapsregisteret/regnskap/aarsregnskap/kopi/{orgnr}/aar` and
`…/kopi/{orgnr}/{aar}`, both on data.brreg.no (the only host
permission and CSP `connect-src`). Verified live 2026-09-24:

- `/aar` answers `application/json`, a string array OLDEST first:
  `["2011", …, "2025"]` for Equinor, DNB and Hydro; `["2023"]` for
  931744682. An unknown orgnr (923609024) or a malformed one (`123`)
  answers 200 `[]`, not 404.
- The list starts at 2011 even where older copies exist: Equinor
  `/kopi/923609016/2009` returned a 6.5 MB PDF. A year not on the list
  is not proof there is no copy.
- `/kopi/{orgnr}/{aar}` answers `application/pdf` with
  `Content-Disposition: attachment; filename=aarsregnskap-<aar>_<orgnr>.pdf`:
  a click downloads the file instead of opening it in a tab. brreg
  builds the PDF before answering — a HEAD for Equinor 2025 took 23 s —
  and ignores `Range` (a `-r 0-1023` request got the whole 92 KB
  file). A malformed year (`/abcd`) → 404. Never fetch these; link them.
- Regnskapsregisteret sends `x-rate-limit-remaining` (24–29 seen); the
  window is unknown. A 429 gets the one retry in § rate-limit, then
  rejects like any other status.
- Kunngjøringer: `https://w2.brreg.no/kunngjoring/hent_nr.jsp?orgnr=<orgnr>`
  answers 200 `text/html` (ISO-8859-1), title «Kunngjøringer -
  Brønnøysundregistrene»; an orgnr with none says «Det finnes ingen
  kunngjøringer på dette organisasjonsnummeret.» It is a plain link on
  w2.brreg.no, never fetched.

`fetchAarsregnskapYears` returns the years newest first, drops
anything that isn't a 4-digit year, caches 24 h under
`aarsregnskap:<orgnr>` (a 404 as `[]`) and rejects on other failures;
`loadCompany({ aarsregnskapYears: true })` maps that to `undefined`.
`aarsregnskapPdfUrl` / `kunngjoringerUrl` only build URLs.

<!-- SECTION: no-signatur -->
## No `fetchSignatur` — endpoint doesn't exist publicly

The brreg open API does not expose signaturrett/prokura on
`/api/enheter/<orgnr>` and the nested `/signatur` path returns 404.
The data lives only behind paid Foretaksregisteret endpoints. The
project used to carry a `SignaturResponse` type and a hidden
`#signatur` card in `details.html` as scaffolding; both were deleted
in `4ec8d12` since they were dead code. Don't reintroduce them — and
don't waste a session trying to re-discover the gap.

<!-- SECTION: search-drops-dots -->
## Name search and dots: the dot is matched literally

The anchor name is historical: this note used to say the index drops
periods. Measured 2026-09-24 (and asserted weekly by the canary), it
doesn't. `?navn=APOTERA.NO` finds APOTERA.NO AS and `?navn=APOTERANO`
finds nothing, so a legal name with a dot is found by exactly that
name. `?navn=FINN.no` returns 0 hits because no entity is registered
under that name. finn.no's company is VEND MARKETPLACES AS, formerly
FINN NO AS with no dot. The default search method ORs the words
instead: `?navn=FINN.NO AS` returns ~440,000 hits via "AS".

The hostname resolver never sends a dot: it searches the label
(`finn`), not the host. When a brand's legal name differs from its
domain, as with finn.no, brreg can't bridge it, and the sidebar's
manual search box is the fallback. The extension does not carry a
curated override table to paper over this. See `AGENTS.md` § No
curated data.

<!-- SECTION: docs-links -->
## Check the docs before curling

Enhetsregisteret API:
`https://data.brreg.no/enhetsregisteret/api/dokumentasjon/no/index.html`
(English: `/en/index.html`).

Dataset and API catalogue (Regnskapsregisteret,
Frivillighetsregister, etc.):
`https://www.brreg.no/bruke-data-fra-bronnoysundregistrene/datasett-og-api/`.

Reach for these before probing endpoints by trial-and-error — most
field shapes and pagination quirks are spelled out there.

<!-- SECTION: live-canary -->
## The live canary checks these facts weekly

`pnpm test:live` runs `tests/live/**` against the live API, using its
own `vitest.live.config.ts`. `pnpm test` and `pnpm verify` never run it.
It has two files:

- `contracts.test.ts` runs one test per SECTION anchor in this note,
  named after the anchor, plus a meta-test that fails when an anchor
  has no test. It also checks the entity shapes the code reads (DNB,
  Equinor in USD, a konkurs AS with a BOBE bostyrer, a slettet entity,
  an ENK, a NUF, an underenhet, roller with `avregistrert` and no
  `fratraadt`), the search semantics the resolver depends on (no Nordic
  folding, hjemmeside substring, `organisasjonsnummer=`), and the 1.4
  endpoints (konsernstruktur, oppdateringer, `kopi/{orgnr}/aar`). Two
  tests are deliberate tripwires. `regnskap-single-year-only` fails when
  Equinor's regnskap returns more than one year. The Endringslogg test
  fails when brreg adds a changelog entry: read the entry, then bump
  `ENDRINGSLOGG_NEWEST`. Responses go through the shipped fetchers and
  helpers. About 40 requests, sequential, with a 250 ms pause.
- `resolver-corpus.test.ts` runs the shipped `searchByHostnameDetailed`
  over about 35 hosts, each with an expected outcome. Only an auto
  resolution to the wrong company fails a test. The ledger (band,
  candidates, verdict per host, request count) is printed after the
  run. About 120 requests.

It runs in CI via `.github/workflows/canary.yml`, weekly (Mondays
04:23 UTC) and on `workflow_dispatch`. A failure opens the one open
issue labelled `canary`, or comments on it if one is open, with the
failing test names and a run link. The same workflow runs `pnpm audit
--audit-level high` as a report-only step. It also calls
`.github/workflows/keepalive.yml` on scheduled runs, as
`store-status.yml` does: it re-enables every scheduled workflow so
GitHub's 60-day inactivity rule doesn't switch them off.

To run it locally, use `pnpm test:live`, or pass one file:
`pnpm test:live tests/live/resolver-corpus.test.ts`. When brreg
changes on purpose, update the test and this note in the same commit.
