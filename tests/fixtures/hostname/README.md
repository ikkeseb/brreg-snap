# hostname replay fixtures

Live `/enheter` search responses recorded 2026-09-23, keyed by the exact
query string `hostname-search.ts` sends, and replayed through the real
`brreg.ts` + `hostname-search.ts` by `tests/hostname-regressions.test.ts`
(an unrecorded request fails the test).

The JSON shape is kept exactly; personal data is not. Every
`epostadresse`, `telefon` and `mobil` is fictitious, every c/o address
(the named person and the street beside it) is replaced, personal forms
(ENK, DA, ANS) carry a fictitious street address, and an ENK that no test
asserts carries the fictitious orgnr 999999999 — a real ENK orgnr leads
straight to its owner. Scoring reads none of these fields. Apply the same
rule when re-recording.
