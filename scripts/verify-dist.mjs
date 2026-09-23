// Checks the STAMPED dist manifests after both builds (moved from the
// inline CI step so `pnpm verify` runs it everywhere). The same
// invariants are pinned against the SOURCE manifests in
// tests/manifest.test.ts.
import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if ('dependencies' in pkg) {
  console.error('FAIL package.json: no "dependencies" field allowed (zero runtime deps)');
  process.exit(1);
}
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'self'; connect-src https://data.brreg.no; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const PERMISSIONS = {
  'dist-firefox/manifest.json': ['activeTab', 'storage', 'menus'],
  'dist-chrome/manifest.json': ['activeTab', 'storage', 'contextMenus', 'sidePanel'],
};
// Firefox's install prompt shows this; it must match PRIVACY.md
// and the store forms. Chrome must not carry a gecko block.
const DATA_COLLECTION = {
  'dist-firefox/manifest.json': { required: ['browsingActivity'] },
  'dist-chrome/manifest.json': undefined,
};
let failed = false;
const fail = (file, msg) => { console.error(`FAIL ${file}: ${msg}`); failed = true; };
for (const [file, permissions] of Object.entries(PERMISSIONS)) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const exact = (key, want) => {
    if (JSON.stringify(m[key]) !== JSON.stringify(want))
      fail(file, `${key} must be exactly ${JSON.stringify(want)}, got ${JSON.stringify(m[key])}`);
  };
  if ('content_scripts' in m) fail(file, 'content_scripts must not exist');
  exact('permissions', permissions);
  exact('optional_permissions', ['tabs']);
  exact('host_permissions', ['https://data.brreg.no/*']);
  const csp = m.content_security_policy?.extension_pages ?? '';
  if (csp !== CSP)
    fail(file, `CSP must be the exact policy string, got "${csp}"`);
  if (/unsafe-inline|unsafe-eval/.test(csp))
    fail(file, 'CSP contains unsafe-inline/unsafe-eval');
  if (m.version !== pkg.version)
    fail(file, `manifest version ${m.version} != package.json version ${pkg.version}`);
  const dcp = m.browser_specific_settings?.gecko?.data_collection_permissions;
  if (JSON.stringify(dcp) !== JSON.stringify(DATA_COLLECTION[file]))
    fail(file, `data_collection_permissions must be exactly ${JSON.stringify(DATA_COLLECTION[file])}, got ${JSON.stringify(dcp)}`);
  if (DATA_COLLECTION[file] === undefined && 'browser_specific_settings' in m)
    fail(file, 'browser_specific_settings must not exist');
  if (!failed) console.log(`OK ${file}`);
}
if (failed) {
  console.error('\nManifest invariants violated. These are the security');
  console.error('non-negotiables from CLAUDE.md: no content scripts, only');
  console.error('data.brreg.no as host, install-time permissions frozen,');
  console.error('tabs as runtime opt-in only, exact strict CSP, and an');
  console.error('honest Firefox data-collection declaration.');
  process.exit(1);
}
console.log('All manifest security invariants hold for both targets.');
