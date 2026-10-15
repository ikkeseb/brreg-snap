// `node scripts/publish-amo.mjs X.Y.Z <assets-dir> [--listing] [--kit <file>] [--dry-run]`
// Submits the GitHub Release assets of vX.Y.Z to AMO (scripts/lib/amo.mjs);
// with `--listing`, sends the listing text instead (name, summary,
// description, categories, privacy policy) and touches no version.
// Run by .github/workflows/publish.yml; see docs/release.md.
//
// Every text comes from the submission kit as committed at the tag
// (`git show vX.Y.Z:docs/submission-kit/X.Y.Z/amo.md`), so what goes to
// AMO is what was reviewed and tagged. `--kit` reads a file instead: a
// local dry run, or the workflow's `kit_from_main`, which sends a kit
// corrected on main for an already tagged version and shows its diff
// against the tag's first. The texts are checked against AMO's length
// limits before any request. The add-on id and name are read from the
// package's own manifest.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { amoLengthErrors, amoListingTexts, amoTextLengths, amoVersionTexts, publishAmo, syncAmoListing } from './lib/amo.mjs';
import { setOutputs } from './lib/publish.mjs';
import { assetNames, findTodos, kitFields } from './lib/release.mjs';
import { readZip } from './lib/zip.mjs';

const USAGE = 'usage: node scripts/publish-amo.mjs X.Y.Z <assets-dir> [--listing] [--kit <file>] [--dry-run]';
const { values: opts, positionals } = parseArgs({
  options: {
    kit: { type: 'string' },
    listing: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
  allowPositionals: true,
});
const [version, dir] = positionals;
const kitPath = opts.kit ?? null;
const dryRun = opts['dry-run'];
if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !dir || positionals.length > 2) {
  console.error(USAGE);
  process.exit(2);
}

try {
  const names = assetNames(version);
  const pkg = { name: names.firefox, bytes: readFileSync(join(dir, names.firefox)) };
  const manifestEntry = readZip(pkg.bytes).find((e) => e.name === 'manifest.json');
  const manifest = manifestEntry ? JSON.parse(manifestEntry.data().toString('utf8')) : {};
  const guid = manifest.browser_specific_settings?.gecko?.id;
  if (!guid) throw new Error(`${pkg.name}: no browser_specific_settings.gecko.id in manifest.json`);

  const kitRef = `v${version}:docs/submission-kit/${version}/amo.md`;
  const kitLabel = kitPath ?? kitRef;
  const kit = kitPath
    ? readFileSync(kitPath, 'utf8')
    : execFileSync('git', ['show', kitRef], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const todos = findTodos(kit);
  if (todos.length) throw new Error(`${kitLabel}: TODO(store-notes) left on lines ${todos.join(', ')}`);
  const fields = kitFields(kit);
  console.log(`Kit: ${kitLabel}`);

  /** Fail before any request when a text is over AMO's limit. @param {Record<string, unknown>[]} bodies */
  const guard = (...bodies) => {
    const errors = bodies.flatMap(amoLengthErrors);
    if (errors.length) throw new Error(`${kitLabel}: too long for AMO:\n  ${errors.join('\n  ')}`);
    const report = bodies.flatMap(amoTextLengths).map((t) => `${t.field} ${t.length}/${t.limit}`);
    console.log(`Lengths (AMO limit): ${report.join(', ')}`);
  };

  if (opts.listing) {
    const listing = amoListingTexts(fields, manifest.name);
    guard(listing.addon, listing.policy);
    await syncAmoListing({ guid, listing, env: process.env, fetch: globalThis.fetch, dryRun });
  } else {
    const texts = amoVersionTexts(fields);
    guard(texts);
    const source = { name: names.source, bytes: readFileSync(join(dir, names.source)) };
    const result = await publishAmo({
      version,
      guid,
      pkg,
      source,
      releaseNotes: texts.release_notes,
      approvalNotes: texts.approval_notes,
      env: process.env,
      fetch: globalThis.fetch,
      dryRun,
    });
    setOutputs({ submitted: String(result.status === 'submitted') });
    if (result.editUrl) console.log(`Edit page: ${result.editUrl}`);
  }
} catch (err) {
  console.error(`AMO${opts.listing ? ' listing' : ''}: ${err.message}`);
  process.exit(1);
}
