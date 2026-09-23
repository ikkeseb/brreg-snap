// `pnpm verify:dist`: checks what the builds actually produced, after
// `build:firefox` and `build:chrome`. The source manifests are checked
// with the same module in tests/manifest.test.ts; this catches a build
// step that mangles them, and whatever else lands in dist-*/.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { check } from './manifest-invariants.mjs';

// What a package may contain at its root. .map files sit inside these
// directories and are stripped at packaging (package:* --ignore-files).
const DIST_ROOT = ['manifest.json', 'background', 'popup', 'details', 'chunks', 'icons', 'assets'];

// Runtime code generation, forbidden by CLAUDE.md § Security constraints.
const CODEGEN = [/(?<![\w$])eval\s*\(/, /(?<![\w$.])(?:new\s+)?Function\s*\(/];

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);

// Zero runtime dependencies: the real invariant is that there are none
// to install. (A dev dependency imported from src/ is caught by ESLint's
// bare-import ban.)
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if ('dependencies' in pkg) fail('package.json', 'a "dependencies" field is not allowed (zero runtime deps)');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

for (const target of ['firefox', 'chrome']) {
  const dist = `dist-${target}`;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  } catch (err) {
    fail(dist, `cannot read manifest.json (run build:${target} first): ${err.message}`);
    continue;
  }
  for (const v of check(manifest, target, pkg)) fail(`${dist}/manifest.json`, v);

  for (const name of readdirSync(dist)) {
    if (!DIST_ROOT.includes(name)) fail(dist, `unexpected entry "${name}" at the package root`);
  }
  for (const file of walk(dist)) {
    if (!file.endsWith('.js')) continue;
    const code = readFileSync(file, 'utf8');
    for (const re of CODEGEN) {
      if (re.test(code)) fail(relative('.', file), `runtime code generation (${re.source})`);
    }
  }
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(
    '\nDist invariants violated. These are the security non-negotiables from' +
      '\nCLAUDE.md: exact manifest keys and permissions, tabs as runtime opt-in,' +
      '\ndata.brreg.no as the only host, the exact CSP, an honest Firefox' +
      '\ndata-collection declaration, no eval, zero runtime dependencies.',
  );
  process.exit(1);
}
console.log('OK dist-firefox, dist-chrome: manifest invariants, file set, no eval; no runtime deps.');
