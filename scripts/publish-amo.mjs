// `node scripts/publish-amo.mjs X.Y.Z <assets-dir> [--kit <file>] [--dry-run]`
// Submits the GitHub Release assets of vX.Y.Z to AMO (scripts/lib/amo.mjs).
// Run by .github/workflows/publish.yml; see docs/release.md.
//
// Release notes and reviewer notes come from the submission kit as
// committed at the tag (`git show vX.Y.Z:docs/submission-kit/X.Y.Z/amo.md`),
// so what goes to AMO is what was reviewed and tagged; `--kit` reads a
// file instead (local dry runs). The add-on id is read from the package's
// own manifest.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { publishAmo } from './lib/amo.mjs';
import { setOutputs } from './lib/publish.mjs';
import { assetNames, findTodos, kitFields, reflowForAmo } from './lib/release.mjs';
import { readZip } from './lib/zip.mjs';

const { values: opts, positionals } = parseArgs({
  options: { kit: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
  allowPositionals: true,
});
const [version, dir] = positionals;
const kitPath = opts.kit ?? null;
const dryRun = opts['dry-run'];
if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !dir || positionals.length > 2) {
  console.error('usage: node scripts/publish-amo.mjs X.Y.Z <assets-dir> [--kit <file>] [--dry-run]');
  process.exit(2);
}

try {
  const names = assetNames(version);
  const pkg = { name: names.firefox, bytes: readFileSync(join(dir, names.firefox)) };
  const source = { name: names.source, bytes: readFileSync(join(dir, names.source)) };
  const manifestEntry = readZip(pkg.bytes).find((e) => e.name === 'manifest.json');
  const guid = manifestEntry && JSON.parse(manifestEntry.data().toString('utf8')).browser_specific_settings?.gecko?.id;
  if (!guid) throw new Error(`${pkg.name}: no browser_specific_settings.gecko.id in manifest.json`);

  const kitRef = `v${version}:docs/submission-kit/${version}/amo.md`;
  const kit = kitPath
    ? readFileSync(kitPath, 'utf8')
    : execFileSync('git', ['show', kitRef], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const todos = findTodos(kit);
  if (todos.length) throw new Error(`${kitPath ?? kitRef}: TODO(store-notes) left on lines ${todos.join(', ')}`);
  const fields = kitFields(kit);
  for (const f of ['release_notes.nb-NO', 'release_notes.en-US', 'approval_notes']) {
    if (!fields[f]) throw new Error(`${kitPath ?? kitRef}: field ${f} is missing or empty`);
  }

  const result = await publishAmo({
    version,
    guid,
    pkg,
    source,
    // AMO keeps every newline, so the kit's hard-wrapped paragraphs are
    // sent as one line each (the 1.3.0 notes on AMO broke mid-sentence).
    releaseNotes: {
      'nb-NO': reflowForAmo(fields['release_notes.nb-NO']),
      'en-US': reflowForAmo(fields['release_notes.en-US']),
    },
    approvalNotes: reflowForAmo(fields.approval_notes),
    env: process.env,
    fetch: globalThis.fetch,
    dryRun,
  });
  setOutputs({ submitted: String(result.status === 'submitted') });
  if (result.editUrl) console.log(`Edit page: ${result.editUrl}`);
} catch (err) {
  console.error(`AMO: ${err.message}`);
  process.exit(1);
}
