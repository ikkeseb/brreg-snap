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
exposed. Whether to keep the dormant code as future-proofing (the note
above long assumed brreg returns one entry *per year*) or remove it is
an open decision.

<!-- SECTION: regnskap-500-unsupported-plan -->
## 500 from regnskap = unsupported oppstillingsplan, not a bug

500 is its own category: banks, insurance and similar regulated
sectors file under specialised oppstillingsplaner (`BANK`, `FORS`)
that the public endpoint refuses to serialise — DNB BANK ASA
(984851006) hits this. The body is JSON with
`"message": "Regnskapet inneholder en oppstillingsplan som ikke er
stottet (BANK)"` and a stack trace.

`fetchRegnskap` returns
`RegnskapResponse = { items: Regnskap[]; unsupportedPlan?: string }`;
`parseUnsupportedPlan` extracts the `(BANK)` / `(FORS)` code from the
500 body via `/\(([A-Z]+)\)/` and stores it. The UI renders a
distinct "Filer som bankregnskap (BANK) — ikke tilgjengelig i
offentlig API." line instead of pretending the company didn't file.
Both empty results and unsupported-plan results are cached so refresh
doesn't re-hit.

<!-- SECTION: error-contract -->
## Error contract: search throws, [] means a real empty result

`searchEnheter` and `searchEnheterWithParams` throw on network
failure, timeout, and every non-2xx response (429/503 included).
They return `[]` only for a genuine 2xx response with zero hits.
Don't reintroduce a swallow-and-return-`[]` catch: the resolution
pipeline caches its outcome for 24h, and an offline moment disguised
as "no hits" gets pinned as a day-long "no match" (see
`docs/notes/cache.md` § failure-no-cache for the caching rule).

The detail fetchers (`fetchEnhet`, `fetchRoller`, `fetchUnderenheter`,
`fetchRegnskap`) keep their documented special cases — roller 404 →
empty, regnskap 404 → empty, regnskap 500 → unsupported plan (above) —
and throw on everything else.

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
in `db2f24e` since they were dead code. Don't reintroduce them — and
don't waste a session trying to re-discover the gap.

<!-- SECTION: search-drops-dots -->
## Brreg name search drops periods

`?navn=FINN.no` returns garbage — the search index normalises away
punctuation. There's no client-side workaround: quoting and escaping
both fail because the API drops the dot internally. Hostnames whose
legal name contains punctuation (FINN.no is the canonical case)
therefore don't resolve via brreg; the sidebar's manual search box
is the fallback. The extension does not carry a curated override
table to paper over this — see CLAUDE.md § "No curated domain table".

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
