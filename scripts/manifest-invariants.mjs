// The manifest security invariants, in one place (CLAUDE.md § Security
// constraints). Used by tests/manifest.test.ts for the SOURCE manifests
// and by scripts/verify-dist.mjs for the STAMPED dist manifests.
//
// Every list is exact, order included: a reordering is suspicious enough
// to want a human look, and exactness closes the "add cookies and still
// pass" hole a subset check would leave. Widening any of these is a
// security-model change, not a refactor.

/** @typedef {'firefox' | 'chrome'} Target */

/**
 * Top-level keys each manifest may have, and must have. One rule that
 * closes content_scripts, web_accessible_resources,
 * externally_connectable and any key added in the future.
 * @type {Record<Target, string[]>}
 */
export const TOP_LEVEL_KEYS = {
  firefox: [
    'manifest_version',
    'name',
    'version',
    'description',
    'browser_specific_settings',
    'action',
    'sidebar_action',
    'icons',
    'permissions',
    'optional_permissions',
    'host_permissions',
    'background',
    'content_security_policy',
  ],
  chrome: [
    'manifest_version',
    'name',
    'version',
    'description',
    'minimum_chrome_version',
    'action',
    'side_panel',
    'icons',
    'permissions',
    'optional_permissions',
    'host_permissions',
    'background',
    'content_security_policy',
  ],
};

/** Install-time permissions. @type {Record<Target, string[]>} */
export const PERMISSIONS = {
  firefox: ['activeTab', 'storage', 'menus'],
  chrome: ['activeTab', 'storage', 'contextMenus', 'sidePanel'],
};

/** `tabs` is runtime opt-in only. */
export const OPTIONAL_PERMISSIONS = ['tabs'];

export const HOST_PERMISSIONS = ['https://data.brreg.no/*'];

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; " +
  "img-src 'self' data:; object-src 'self'; " +
  'connect-src https://data.brreg.no; ' +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * Firefox's install prompt shows this; it must say what PRIVACY.md and
 * the store forms say (the visited site's domain goes to data.brreg.no).
 * `required`, not `optional`: every click lookup sends the domain.
 * Chrome has no gecko block (the CWS privacy form declares it).
 * @type {Record<Target, unknown>}
 */
export const DATA_COLLECTION = {
  firefox: { required: ['browsingActivity'] },
  chrome: undefined,
};

const ICONS_TOOLBAR = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
};

/**
 * The structural blocks, exact per target: what makes the package start
 * and which local page each surface opens. Chrome's worker must be
 * `type: 'module'` (the built worker has imports; the default is a
 * classic script), and no surface may point at a URL.
 * @type {Record<Target, Record<string, unknown>>}
 */
export const STRUCTURE = {
  firefox: {
    manifest_version: 3,
    background: { scripts: ['background/background.js'], type: 'module' },
    action: {
      default_title: 'brreg-snap',
      default_popup: 'popup/popup.html',
      default_icon: ICONS_TOOLBAR,
    },
    sidebar_action: {
      default_title: 'brreg-snap',
      default_panel: 'details/details.html',
      default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' },
      open_at_install: false,
    },
    icons: { ...ICONS_TOOLBAR, 128: 'icons/icon-128.png' },
  },
  chrome: {
    manifest_version: 3,
    background: { service_worker: 'background/background.js', type: 'module' },
    action: {
      default_title: 'brreg-snap',
      default_popup: 'popup/popup.html',
      default_icon: ICONS_TOOLBAR,
    },
    side_panel: { default_path: 'details/details.html' },
    icons: { ...ICONS_TOOLBAR, 128: 'icons/icon-128.png' },
  },
};

/**
 * Every package file the manifest points at, deduplicated, in manifest
 * order. verify:dist checks each exists in dist-<target>/.
 * @param {Record<string, any>} manifest
 * @returns {string[]}
 */
export function referencedFiles(manifest) {
  const bg = manifest.background ?? {};
  const panel = manifest.sidebar_action ?? {};
  const files = [
    ...(bg.scripts ?? []),
    bg.service_worker,
    manifest.action?.default_popup,
    ...Object.values(manifest.action?.default_icon ?? {}),
    panel.default_panel,
    manifest.side_panel?.default_path,
    ...Object.values(panel.default_icon ?? {}),
    ...Object.values(manifest.icons ?? {}),
  ];
  return [...new Set(files.filter((f) => typeof f === 'string'))];
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (v) => (v === undefined ? 'undefined' : JSON.stringify(v));

/**
 * @param {Record<string, any>} manifest parsed manifest.json
 * @param {Target} target
 * @param {{ version: string }} pkg parsed package.json
 * @returns {string[]} violations; empty when every invariant holds
 */
export function check(manifest, target, pkg) {
  const out = [];
  const exact = (key, want) => {
    if (!same(manifest[key], want)) {
      out.push(`${key} must be exactly ${show(want)}, got ${show(manifest[key])}`);
    }
  };

  const allowed = TOP_LEVEL_KEYS[target];
  for (const key of Object.keys(manifest)) {
    if (!allowed.includes(key)) out.push(`top-level key "${key}" is not allowed`);
  }
  for (const key of allowed) {
    if (!(key in manifest)) out.push(`top-level key "${key}" is missing`);
  }

  for (const [key, want] of Object.entries(STRUCTURE[target])) exact(key, want);
  exact('permissions', PERMISSIONS[target]);
  exact('optional_permissions', OPTIONAL_PERMISSIONS);
  exact('host_permissions', HOST_PERMISSIONS);

  if (!same(manifest.content_security_policy, { extension_pages: CSP })) {
    out.push(
      `content_security_policy must be exactly ${show({ extension_pages: CSP })}, ` +
        `got ${show(manifest.content_security_policy)}`,
    );
  }

  const dcp = manifest.browser_specific_settings?.gecko?.data_collection_permissions;
  if (!same(dcp, DATA_COLLECTION[target])) {
    out.push(
      `data_collection_permissions must be exactly ${show(DATA_COLLECTION[target])}, got ${show(dcp)}`,
    );
  }

  if (manifest.version !== pkg.version) {
    out.push(`version ${show(manifest.version)} != package.json version ${show(pkg.version)}`);
  }
  return out;
}
