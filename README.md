# brreg-now

Firefox extension that surfaces Norwegian company information from
[Brønnøysundregistrene](https://data.brreg.no/) — CEO, board members,
signaturrett, status flags, key figures — straight from the toolbar.

Click the icon while on a company website, get the brreg snapshot in a
popup. No content scripts, no page DOM access, no third-party calls.

## Security model

Popup-only architecture. The extension never injects code into the
pages you browse and never reads their DOM.

| Permission | Why |
|---|---|
| `activeTab` | Read URL + title of the current tab **only when you click the icon** |
| `storage` | Cache brreg responses locally (`storage.session`, 24h TTL) |
| `host_permissions: https://data.brreg.no/*` | Fetch from the public brreg API. Only domain we contact. |

What this rules out:

- No `<all_urls>` host permission
- No content scripts
- No `eval` or remote-loaded code
- No third-party analytics or telemetry
- No DOM access on the pages you visit

Total reviewable surface is intentionally small (~200 LOC core).

## Install — development

Requires Node 18+, [pnpm](https://pnpm.io/) 10.33+, and Firefox.

```bash
pnpm install
pnpm dev             # builds + launches Firefox dev profile with the extension loaded
```

To produce a distributable `.xpi`:

```bash
pnpm build
pnpm package         # produces web-ext-artifacts/brreg-now-X.Y.Z.xpi
```

Load the `.xpi` via `about:debugging` → "This Firefox" → "Load Temporary
Add-on". For permanent install you need the AMO-signed build (see
[Distribution](#distribution)).

## How it works

When you click the toolbar icon:

1. Popup opens and reads the current tab's URL + title (`activeTab`).
2. Extract an organisation number using:
   - **Org-nr regex** — 9-digit pattern in URL path/query or title
   - **Domain → orgnr table** — curated list of common Norwegian
     companies (`src/lib/domains.ts`)
   - **Free-text search fallback** — if neither matches, the popup
     shows a search box that hits brreg's search endpoint
3. Fetch the entity from `data.brreg.no/enhetsregisteret/api/enheter/<orgnr>`.
4. Render the result in the popup. Nothing else is touched.

Responses are cached in `storage.session` for 24 hours, so repeated
lookups don't hammer the API.

## Project layout

```
src/
  background/           service worker (popup wake-up only)
  popup/                popup.html + popup.ts + popup.css
  lib/
    brreg.ts            data.brreg.no API client
    orgnr.ts            URL/title → orgnr extraction
    domains.ts          domain → orgnr lookup table
  types/
    brreg.ts            response type definitions
public/
  manifest.json         MV3 manifest
  icons/                toolbar icon set
tests/
  *.test.ts             Vitest unit tests
```

## Distribution

- **GitHub release with signed `.xpi`** — primary, immediate.
- **AMO submission** — under evaluation post-v0.1.

## Contributing

Open an issue first for non-trivial changes. The popup-only security
model is non-negotiable — PRs that add content scripts, third-party
hosts, or relax CSP will be closed.

## License

[MIT](LICENSE).
