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
name. `regnskap-923609016-usd.json` is a full capture from 2026-10-06:
three years of the group's consolidated rows (`KONSERN`) before the
company's own (`SELSKAP`), the order the callers must not trust.
`regnskap-910747711-orkla.json` and `regnskap-927124238-tomra-eur.json`
are full captures from 2026-10-16: three `KONSERN` and three `SELSKAP`
years each, Tomra's 2024 and 2025 group rows in EUR.
`roller-999999998-enk.json` is a live ENK roller response's shape
(2026-10-15: an `INNH` group, no daglig leder or styre, an accountant)
with a fictitious owner and accountant.
Tests import these so a brreg shape change shows up as a fixture diff,
not a silent UI bug. Re-capture (and re-anonymize) when brreg changes a
response.
