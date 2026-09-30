# Browser preview harness

Runs the REAL built popup/details pages in a plain browser tab against
the LIVE brreg API (default) or recorded fixtures — no extension
loading. This is the fast visual dev loop for frontend work and the
base of the browser smoke (`pnpm smoke`, tests/e2e/), not a substitute
for `pnpm dev` before shipping.

```bash
pnpm build:chrome
node scripts/preview/serve.mjs                               # live API, http://127.0.0.1:8123
node scripts/preview/serve.mjs --fixtures tests/e2e/fixtures # recorded smoke states
node scripts/preview/serve.mjs --port 0                      # any free port (printed)
```

`serve.mjs` binds 127.0.0.1 only, serves `dist-chrome/` directly,
injects `shim.js` (an in-memory `browser.*` stand-in) into the HTML
entries, and sends the built manifest's extension-page CSP as a
`Content-Security-Policy` header. The shim reroutes every
`https://data.brreg.no/…` fetch to the server's `/brreg/…` path, which
answers from the live API or, with `--fixtures`, from recorded files
(tests/e2e/fixtures/README.md). One path keeps both modes identical:
regnskapsregisteret sends no CORS headers (the extension bypasses CORS
via host_permissions, a plain tab can't), and a same-origin path is why
the harness CSP's `connect-src` also allows `'self'` — its only
deviation from the shipped policy.

Drive the pages with URL params:

- `popup/popup.html?taburl=https://www.dnb.no&tabtitle=DNB` — the real
  resolution cascade runs against the live API
- `details/details.html?orgnr=984851006` — direct load
- `details/details.html?nomatch=example.com` — empty state
- `&seedrecents=1` — seed three fake entries into the recents stack

With `--fixtures`, only the requests the smoke states make are
recorded; anything else answers 404 (see the fixtures README to add a
state).

Caveats: storage is per-page-load (no persistence across navigations),
`permissions.contains` is always false (auto-sync toggle renders off),
and sidebar/side-panel APIs are no-ops. Data-dependent rendering must
still be checked against the live API in a real extension load — this
harness shares that live data path by design.
