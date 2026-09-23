// `pnpm lint:ext`: web-ext lint (addons-linter) on dist-firefox/ that
// fails on any error and on any warning not listed below. Plain
// `web-ext lint` exits 0 on warnings, so a new one would slip through.
//
// Firefox only: addons-linter structurally rejects the Chrome MV3
// manifest (background.service_worker, no gecko id); dist-chrome is
// covered by verify:dist.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Expected since strict_min_version stays 115 (plan Decisions: Firefox
// data consent) while data_collection_permissions needs Firefox 140 /
// Firefox for Android 142. Older versions ignore the key.
const ALLOWED_WARNINGS = [
  'KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION',
  'KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION',
];

const bin = join('node_modules', 'web-ext', 'bin', 'web-ext.js');
const run = spawnSync(
  process.execPath,
  [bin, 'lint', '--source-dir', 'dist-firefox', '--output', 'json', '--no-config-discovery'],
  { encoding: 'utf8' },
);

let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  process.stderr.write(run.stdout + run.stderr);
  console.error('lint:ext: web-ext lint produced no JSON report (run build:firefox first?)');
  process.exit(1);
}

const errors = report.errors ?? [];
const warnings = report.warnings ?? [];
const unexpected = warnings.filter((w) => !ALLOWED_WARNINGS.includes(w.code));
const line = (m) => `  ${m.code} ${m.file ?? ''}: ${m.message}`;

for (const e of errors) console.error(`error${line(e)}`);
for (const w of unexpected) console.error(`warning${line(w)}`);
const allowed = warnings.length - unexpected.length;
console.log(
  `web-ext lint: ${errors.length} errors, ${unexpected.length} unexpected warnings, ` +
    `${allowed} allowed warnings, ${(report.notices ?? []).length} notices`,
);
if (errors.length || unexpected.length) process.exit(1);
