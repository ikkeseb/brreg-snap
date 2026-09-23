// `pnpm lint:ext`: web-ext lint (addons-linter) on dist-firefox/ that
// fails on any error, on any warning not allowed in lint-ext-judge.mjs,
// and on a web-ext run that did not exit cleanly. Plain `web-ext lint`
// exits 0 on warnings, so a new one would slip through.
//
// Firefox only: addons-linter structurally rejects the Chrome MV3
// manifest (background.service_worker, no gecko id); dist-chrome is
// covered by verify:dist.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { judgeLint } from './lint-ext-judge.mjs';

const bin = join('node_modules', 'web-ext', 'bin', 'web-ext.js');
const run = spawnSync(
  process.execPath,
  [bin, 'lint', '--source-dir', 'dist-firefox', '--output', 'json', '--no-config-discovery'],
  { encoding: 'utf8' },
);

const { ok, problems, summary } = judgeLint(run);
for (const p of problems) console.error(p);
if (summary) console.log(summary);
if (!ok) {
  console.error('lint:ext: FAILED');
  process.exit(1);
}
