# brreg API quirks

Source: `src/lib/brreg.ts`, `konsern.ts`, `aarsregnskap.ts`.

<!-- SECTION: regnskap-base-url -->
## Regnskap is on a different API base

Enhetsregisteret lives at `data.brreg.no/enhetsregisteret/api`, but
Regnskapsregisteret is on
`data.brreg.no/regnskapsregisteret/regnskap/<orgnr>` (no `/api/`,
different sub-host). Response is an array; the code defensively sorts by
`regnskapsperiode.tilDato` before picking "latest" and supports up to 3
rows for the trend table. 404 is normal: many small AS-er don't file
separately. Cache the empty array so refresh doesn't re-hit.

<!-- SECTION: regnskap-single-year-only -->
## The open endpoint returns ONLY the latest year (multi-year trend is dormant)

Empirically (verified 2026-06 across ~294 live companies plus the
`år` / `regnskapstype` / `size` params and the published OpenAPI spec)
the public endpoint returns exactly **one** filing per orgnr — the
latest accounting year, `regnskapstype: SELSKAP`. It never returns a
second year: `?år=2023` still returns the 2024 filing (the param does
not select history), and there is no structured-JSON path to prior
years (only the per-year PDF `kopi/{aar}` document endpoint, see
§ aarsregnskap-kopi).

Consequence: `renderNokkeltall`'s `figures.length >= 2` branch — the
multi-year trend table and its year-over-year deltas — is effectively
**unreachable in production**; every company falls through to the
single-year detail view (which still renders the new Gjeld /
Egenkapitalandel rows and red loss/negative-equity flagging). The
trend/YoY code is correct — unit tests and the preview harness exercise
it with synthetic multi-year data — but dormant against the live API.
This is NOT a bug to "fix" by probing harder; the data is simply not
exposed. Decided 2026-06-22: keep the dormant code as future-proofing
(the note above long assumed brreg returns one entry *per year*).

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
spesialregnskap», nothing filed gives «Mangler» or «Ingen»
(`regnskapSignal` in `src/lib/ui/verdict.ts`).

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
`fetchAarsregnskapYears`) keep their documented special cases — roller
404 → empty, regnskap 404 → empty, regnskap 500 → unavailable (above),
underenhet 404 → `undefined` (so an orgnr lookup can fall back without
try/catch), konsernstruktur 404 → `undefined` and aarsregnskap 404 →
`[]` (below) — and throw on everything else.
`loadCompany` in `src/lib/company-load.ts` is the one place that
turns a soft dependency's rejection into `undefined`; the renderers
then say "Kunne ikke hente …", never the empty state. It also owns the
enhet 404 → underenhet → parent fallback (`docs/notes/resolution.md`
§ orgnr-lookup).

`fetchUnderenheter` returns `{ items, total }`: one request, first 100
rows, with `total` from `page.totalElements` (Posten Bring 984661185:
133). A parent with none has no `_embedded` at all, only
`page.totalElements: 0`.

Every fetch in `brreg.ts` carries `AbortSignal.timeout(8000)`
(Firefox 100+ / Chrome 103+). A timeout aborts the fetch with a
rejection, which counts as a failure like any other. No retry logic.

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
  window is unknown. A 429 rejects like any other status.
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
## Brreg name search drops periods

`?navn=FINN.no` returns garbage — the search index normalises away
punctuation. There's no client-side workaround: quoting and escaping
both fail because the API drops the dot internally. Hostnames whose
legal name contains punctuation (FINN.no is the canonical case)
therefore don't resolve via brreg; the sidebar's manual search box
is the fallback. The extension does not carry a curated override
table to paper over this — see CLAUDE.md § "No curated data".

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
