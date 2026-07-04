# Browser preview harness

Runs the REAL built popup/details pages in a plain browser tab against
the LIVE brreg API — no extension loading, no fixtures. This is the
fast visual dev loop for frontend work (and screenshot automation via
playwright-cli), not a substitute for `pnpm dev` before shipping.

```bash
pnpm build:chrome
node scripts/preview/serve.mjs   # http://localhost:8123
```

`serve.mjs` serves `dist-chrome/` directly, injects `shim.js` (an in-memory
`browser.*` stand-in) into the HTML entries, and proxies
`regnskapsregisteret` server-side (that API sends no CORS headers —
the extension bypasses CORS via host_permissions, a plain tab can't).

Drive the pages with URL params:

- `popup/popup.html?taburl=https://www.dnb.no&tabtitle=DNB` — the real
  resolution cascade runs against the live API
- `details/details.html?orgnr=984851006` — direct load
- `details/details.html?nomatch=example.com` — empty state
- `&seedrecents=1` — seed three fake entries into the recents stack

Caveats: storage is per-page-load (no persistence across navigations),
`permissions.contains` is always false (auto-sync toggle renders off),
and sidebar/side-panel APIs are no-ops. Data-dependent rendering must
still be checked against the live API in a real extension load — this
harness shares that live data path by design.
