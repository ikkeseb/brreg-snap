# brreg fixtures

Trimmed live captures from `data.brreg.no` (2026-09-23; the Komplett and
BBC enheter and the trust-view files — rekonstruksjon, påtegning, nytt
navn, NUF, ENK and the `oppdateringer-*` change feeds — 2026-09-24;
`enhet-999288774-nuf-utenlandsk.json`, a foreign-address NUF with no
person data, is a full capture from 2026-09-24). Each file keeps the
exact JSON shape of the live response; personal names, birth dates,
mobile numbers and small-company street addresses are replaced with
fictitious values, in a change feed too (the same fictitious value as
in the enhet). A company named after a person also gets a fictitious
orgnr (999999999, 999999998): its real orgnr leads straight back to the
name.
Tests import these so a brreg shape change shows up as a fixture diff,
not a silent UI bug. Re-capture (and re-anonymize) when brreg changes a
response.
