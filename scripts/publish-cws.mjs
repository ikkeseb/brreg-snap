// `node scripts/publish-cws.mjs X.Y.Z <assets-dir> [--dry-run]`
// Uploads the Chrome zip of the GitHub Release vX.Y.Z to the Chrome Web
// Store and submits it for review (scripts/lib/cws.mjs). Run by
// .github/workflows/publish.yml; see docs/release.md.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { publishCws } from './lib/cws.mjs';
import { setOutputs } from './lib/publish.mjs';
import { assetNames } from './lib/release.mjs';

const { values: opts, positionals } = parseArgs({
  options: { 'dry-run': { type: 'boolean', default: false } },
  allowPositionals: true,
});
const [version, dir] = positionals;
if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !dir || positionals.length > 2) {
  console.error('usage: node scripts/publish-cws.mjs X.Y.Z <assets-dir> [--dry-run]');
  process.exit(2);
}

try {
  const name = assetNames(version).chrome;
  const result = await publishCws({
    version,
    pkg: { name, bytes: readFileSync(join(dir, name)) },
    env: process.env,
    fetch: globalThis.fetch,
    dryRun: opts['dry-run'],
  });
  setOutputs({ submitted: String(result.status === 'submitted') });
} catch (err) {
  console.error(`CWS: ${err.message}`);
  process.exit(1);
}
