# Trust view: answer, signals, merknader, endringer

Source: `src/lib/trust/` (`types.ts` is the shared vocabulary;
`signals.ts`, `merknader.ts`, `endringer.ts`, `answer.ts` derive it),
`src/lib/brreg-endringer.ts` (the change feed), `src/lib/company-load.ts`
(`opts.endringer`). Every derivation is pure; the surfaces only render
what it returns. Fixtures: `tests/fixtures/brreg/` (see its README for
the anonymisation rule).

House rules for every item here: facts, not accusations; Norwegian
bokmål; a signal whose data couldn't be fetched is omitted, never shown
as «Ingen».

<!-- SECTION: answer-priority -->
## Answer priority

`deriveAnswer({ enhet, roller, signals, kobling, merknader, now })`
returns one headline, in this order of precedence:

1. **Danger status** (konkurs, slettet, tvangsavvikling): «Konkurs
   siden 26. aug. 2026», «Slettet 15. sep. 2026», «Tvangsavvikling –
   mangler regnskap». An undated status drops «siden». Supporting line
   «Bostyrer: <navn>» when a current BOBE role exists (konkurs and
   forced dissolution both have one; `roller` undefined → no line).
2. **Kobling `mismatch`**: «Nettstedet er ikke koblet til selskapet»,
   supporting «Registrert hjemmeside er <domene>. Hvem som helst kan
   skrive et org.nr på siden sin.» Tone: `kobling.tone` if it is danger,
   else warn (`kobling.ts` owns how loud a mismatch is).
3. **Warn findings**, in this fixed order: status warn (avvikling,
   rekonstruksjon), each merknad (first sentence only; the full text
   stays in `deriveMerknader`), kobling `name-guess` («Usikker kobling
   til <host>») / `other-site` («Registrert hjemmeside er <domene>»),
   alder under a year («Stiftet for 5 måneder siden», «Registrert for
   …» without a stiftelsesdato), regnskap warn («Regnskap for 2025 er
   ikke levert»: the year whose deadline has passed, not the last one
   seen; «Ingen årsregnskap er sendt inn»). One →
   it is the headline. Two or more → «<n> ting å merke seg», with the
   first as the supporting line.
4. Otherwise **ok**: «Ingen varsler i registeret», `findings: []`.

`findings` lists every warn/danger finding in that order (danger status,
mismatch, then the warns). Alder and regnskap findings follow the
signals' tones, so an omitted signal can't produce one.

Endringer are neutral information and are not an input: a big
company's board changes all the time (Equinor's STYR changed
2026-09-04; its answer stays «Ingen varsler»).

<!-- SECTION: signals -->
## Signals

`deriveSignals(enhet, regnskap, now)` → status, alder, ansatte, regnskap
(the kobling row comes from `kobling.ts`); the surfaces paint them as
the ledger (`src/lib/view/components/ledger.ts`).

- **Status** is `primaryStatusFlag` (`src/lib/ui/flags.ts`): slettet
  first (a SlettetEnhet has no konkurs/avvikling fields), then konkurs,
  under avvikling, tvangsavvikling, rekonstruksjon. Rekonstruksjon is a
  warn read from `underRekonstruksjonsforhandlingDato` alone: brreg has
  no boolean for it (docs, 2025 changelog; live RUTA ENTREPRENØR AS
  983830196, 2026-09-02). Found via the change feed; the search API has
  no filter for it (400). Detail: the tvang reason, else «siden
  dd.mm.yyyy», slettet just the date.
- **NUF / UTLA**: an ok status gets the detail «utenlandsk foretak
  (<land>)» from `underlagtLovgivningLandKode` (UTLA carries it), else
  `forretningsadresse.landkode`. Live NUFs (200 sampled 2026-09-24)
  carry no governing-law field and their forretningsadresse is often the
  Norwegian branch (NO) or absent — then just «utenlandsk foretak».
- **Alder** counts from `stiftelsesdato`, else the earliest registration
  (Enhetsregisteret starts in 1995). Under a year is a warn.
- **Ansatte**: `ansatteLine`; omitted for a SlettetEnhet, which carries
  no employee data. Never judged (neutral).
- **Regnskap**: latest year from `Enhet.sisteInnsendteAarsregnskap` or
  the regnskap response, whichever is newer. **Deadline-aware**: annual
  accounts are due 31 July the year after, so the expected latest year
  is `month >= August ? year − 1 : year − 2`; an older latest year is a
  warn only for the forms with an unconditional duty (AS, ASA, SE, ASV,
  SPA), and the row then names what is missing («2025 ikke levert ·
  siste er 2023», worded in `signalRow`). For the rest the duty
  depends on size, so it stays neutral («2023 · siste innsendte»).
  A filed year whose money the open API doesn't carry (special
  accounts, or the API a year behind the Enhet) gets «tall ikke i åpne
  data» under it; a failed lookup and any other 500 get no line. Assumes a calendar accounting
  year. With nothing filed: an ENK with at most 20 registered employees
  (or none) → neutral «Ikke pliktig · enkeltpersonforetak»; an ENK files
  only above 20 MNOK in assets or 20 årsverk (regnskapsloven § 1-2
  nr. 11, § 8-2 (1); live, 13 of the 100 largest ENKs have filed), and
  the assets test can't be checked from the register. AS/ASA/SE/ASV/SPA
  → warn «Mangler» once their founding year is older than the expected
  year (the first, partial year gets the benefit of the doubt); other
  forms → neutral «Ingen · ikke innsendt». A failed regnskap fetch with no Enhet year →
  omitted; a 500 naming its plan → «Levert · spesialregnskap».
- Under a danger status, the other rows lose their green (ok → neutral).

<!-- SECTION: merknader -->
## Merknader (påtegninger)

`deriveMerknader(enhet)` quotes `Enhet.paategninger` verbatim (trimmed),
skips empty texts, newest `innfoertDato` first (undated last). Live
shapes: `{infotype: "FADR", tekst: "Foretaksregisteret har grunn til å
anta at forretningsadressen er feil. Foretaket har fått pålegg om å
melde endring.", innfoertDato}` (SCAN TRANSPORT AS 935864879, an active
AS), `DAGL`/`KONT` «Kontaktperson mangler. …», `NAVN` «Foretaksnavnet
inneholder feil etternavn. …». Most companies have `paategninger: []`;
a SlettetEnhet has no field. Finding a sample: search
`enheter?underTvangsavviklingEllerTvangsopplosning=true&organisasjonsform=AS`
or the change feed (`/paategninger/-` adds). `firstSentence` cuts a
merknad for the answer at `.`/`!`/`?` + whitespace + capital letter.

<!-- SECTION: endringer -->
## Endringer

`fetchEndringer(orgnr, sinceIso)` asks
`/enhetsregisteret/api/oppdateringer/enheter?organisasjonsnummer=<orgnr>&dato=<iso>&includeChanges=true&size=100&sort=id,DESC`.

- `dato` must be the full `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'` form
  (`Date.toISOString()`); a bare date is a 400. An unknown orgnr format
  is also a 400.
- Nothing changed → 200 with `page` and no `_embedded` → `[]`.
- Events: `{oppdateringsid, dato (UTC), endringstype, endringer}`. Only
  `Endring` events carry `endringer` (JSON Patch); `Ny`, `Sletting`,
  `Fjernet` have none. The fetcher keeps `op` + `path` only.
- Error contract as in `docs/notes/brreg-api.md` § error-contract:
  non-2xx, network failure and an unexpected shape reject; `loadCompany`
  (`opts.endringer`, off by default) maps that to `undefined`. Cached
  24 h under `endringer:<orgnr>` as `{since, events}`; a later window
  reuses a cached one that covers it. `invalidateCache` drops it.

`deriveEndringer({ enhet, roller, feed, now })`, at most one item per
kind (the newest), newest first:

- **navn**: `historiskeNavn` entry whose `tilDato` is within 183 days →
  «Nytt navn 1. sep. 2026 (tidligere OPULENS NÆRING 4 AS)».
  `historiskeNavn` dates are `"2026-09-01 12:29:08"` (space, local time).
- **adresse**: a feed event within 183 days that changes
  `/forretningsadresse` street, postcode or place (or adds the
  address) → «Ny forretningsadresse <dato>». A kommune renumbering alone
  isn't a move; the whole-address `remove` is the deletion event.
- **daglig-leder** / **styre**: the DAGL / STYR rollegruppe `sistEndret`
  within 90 days → «Daglig leder endret <dato>» / «Styret endret <dato>».
- A change dated on or before the company's registration is the setup,
  not a change. `feed` undefined → no address item; `roller` undefined →
  no role items.
- Ignored on purpose: the monthly `antallAnsatte` +
  `registreringsdatoAntallAnsatte*` update (Equinor: 6 of its 8 events
  in six months), `kapital`, `sisteInnsendteAarsregnskap`,
  `naeringskode*`, `postadresse`.
