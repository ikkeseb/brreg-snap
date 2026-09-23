# store fixtures

Live captures (2026-09-24) for `tests/store-status.test.ts`, while both
stores served 1.3.0:

- `amo-addon-1.3.0.json`: AMO `/api/v5/addons/addon/<guid>/`, trimmed to
  the fields the probe reads.
- `cws-updatecheck-*.xml`: the Chrome update-check response for our item
  id and for an unknown id, verbatim.
- `*-manifest.json`: `manifest.json` as served inside the AMO `.xpi`
  and the CWS `.crx`, and as shipped in the v1.3.0 GitHub Release zips.
  Compare them as JSON only: the CWS copy was CRLF (the 1.3.0 upload
  was a Windows build) and `.gitattributes` stores it as LF.

Re-capture when a store changes what it adds (docs/notes/stores.md).
