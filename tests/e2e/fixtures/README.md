# Browser smoke fixtures

Recorded `data.brreg.no` responses for the states in `../states.mjs`,
one file per request (`{ request, status, body }`; `request` is the path
and query the extension sends). `scripts/preview/serve.mjs --fixtures`
and the real-extension spec answer from these files; a request with no
file answers 404 with `x-fixture-miss`, and the smoke fails naming it.

A new state goes into `../states.mjs`; then re-record. Re-record from
the live API (the git diff is the drift report):

```bash
pnpm build:chrome && pnpm smoke:record
```

`record.mjs` visits every state, then fetches each request the page
made. It applies these rules on the way out, so a re-record never
commits personal data:

- every role-holder `person` gets a fictitious name and the birth date
  1970-01-01; every `bostyrer` is «Adv. Ola Nordmann»
- every `epostadresse`, `telefon`, `mobil` and street `adresse` line is
  fictitious (company addresses too; the smoke asserts none of them)
- an ENK gets orgnr 999999999, the name «EKSEMPEL ENK», no historical
  names or activity text, and a hjemmeside path of `/eksempel` (its
  host stays: scoring reads it)
- trimmed: `_links` dropped, underenhet lists cut to 5 entries
  (`page.totalElements` stays real), error-body timestamp/trace pinned
- keyed on the normalised request: a per-load query value (the change
  feed's `dato=`) is stored and matched as `*`
  (`scripts/preview/fixtures.mjs` § normalizeRequest)
