# brreg API quirks

Source: `src/lib/brreg.ts`.

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
years (only the per-year PDF `kopi/{aar}` document endpoint).

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
`fetchUnderenheter`, `fetchRegnskap`) keep their documented special
cases — roller 404 → empty, regnskap 404 → empty, regnskap 500 →
unavailable (above), underenhet 404 → `undefined` (so an orgnr lookup
can fall back without try/catch) — and throw on everything else.
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
curated override table to paper over this. See CLAUDE.md § "No
curated data".

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
`.github/workflows/keepalive.yml`, which re-enables every scheduled
workflow so GitHub's 60-day inactivity rule doesn't switch them off.

To run it locally, use `pnpm test:live`, or pass one file:
`pnpm test:live tests/live/resolver-corpus.test.ts`. When brreg
changes on purpose, update the test and this note in the same commit.
