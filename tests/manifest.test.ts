import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  check,
  CSP as EXPECTED_CSP,
  DATA_COLLECTION,
  PERMISSIONS as EXPECTED_PERMISSIONS,
  referencedFiles,
} from '../scripts/manifest-invariants.mjs';

// The security model IS the product differentiator (CLAUDE.md
// § Security constraints): no content scripts, data.brreg.no as the
// only host, install-time permissions limited to activeTab/storage/
// menus (+ Chrome's contextMenus/sidePanel equivalents), `tabs` as
// runtime opt-in only, and a strict CSP. The invariants live in
// scripts/manifest-invariants.mjs; these tests pin the SOURCE manifests
// with it so a violating change fails `pnpm test` locally, and
// `pnpm verify:dist` re-checks the stamped dist manifests after build.
//
// The Firefox data-collection declaration is pinned too: it is what
// the install prompt tells users, and it must say the same thing as
// PRIVACY.md and the store privacy forms (the visited site's domain
// goes to data.brreg.no = `browsingActivity`). A silent flip back to
// "none" would be a false claim to every user.

interface Manifest {
  version: string;
  permissions?: string[];
  optional_permissions?: string[];
  host_permissions?: string[];
  content_scripts?: unknown;
  content_security_policy?: { extension_pages?: string };
  browser_specific_settings?: {
    gecko?: { data_collection_permissions?: unknown };
  };
}

const load = (file: string): Manifest =>
  JSON.parse(readFileSync(file, 'utf8')) as Manifest;

const pkg = load('package.json');
const manifests = {
  firefox: load('public/manifest.firefox.json'),
  chrome: load('public/manifest.chrome.json'),
};

// Exact-match, order included — a reordering is suspicious enough to
// want a human look, and exactness is what closes the "add cookies
// and still pass" hole a subset/includes check would leave open.

describe.each(['firefox', 'chrome'] as const)('manifest.%s', (target) => {
  const m = manifests[target];

  it('holds every invariant in scripts/manifest-invariants.mjs', () => {
    expect(check(m, target, pkg)).toEqual([]);
  });

  it('has no content scripts', () => {
    expect(m).not.toHaveProperty('content_scripts');
  });

  it('install-time permissions are exactly the approved set', () => {
    expect(m.permissions).toEqual(EXPECTED_PERMISSIONS[target]);
  });

  it('tabs is runtime opt-in only (optional_permissions)', () => {
    expect(m.optional_permissions).toEqual(['tabs']);
  });

  it('data.brreg.no is the only host permission', () => {
    expect(m.host_permissions).toEqual(['https://data.brreg.no/*']);
  });

  it('CSP is the exact strict policy string', () => {
    expect(m.content_security_policy?.extension_pages).toBe(EXPECTED_CSP);
  });

  it('CSP has no unsafe-inline / unsafe-eval / remote script hosts', () => {
    const csp = m.content_security_policy?.extension_pages ?? '';
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    // The only remote origin anywhere in the policy is the brreg API
    // in connect-src.
    expect(csp.match(/https?:\/\/[^\s;]+/g)).toEqual([
      'https://data.brreg.no',
    ]);
  });

  it('version matches package.json', () => {
    expect(m.version).toBe(pkg.version);
  });
});

// `required`, not `optional`: every click lookup sends the domain, so
// there is no opt-out that leaves the extension useful. Exact match —
// an extra type, an `optional` list or `has_previous_consent` must be a
// deliberate, reviewed change.
const EXPECTED_FIREFOX_DATA_COLLECTION = DATA_COLLECTION.firefox;

describe('data collection declaration', () => {
  it('Firefox declares browsingActivity as required data collection', () => {
    expect(
      manifests.firefox.browser_specific_settings?.gecko
        ?.data_collection_permissions,
    ).toEqual(EXPECTED_FIREFOX_DATA_COLLECTION);
  });

  it('Chrome ships no gecko block (the CWS privacy form declares it)', () => {
    expect(manifests.chrome).not.toHaveProperty('browser_specific_settings');
  });
});

// check() must fail closed: each escape hatch below is one violation.
describe('manifest invariants catch escape hatches', () => {
  const clone = (target: 'firefox' | 'chrome'): Record<string, unknown> =>
    structuredClone(manifests[target]) as unknown as Record<string, unknown>;

  it.each(['content_scripts', 'web_accessible_resources', 'externally_connectable'])(
    'rejects a new top-level key: %s',
    (key) => {
      const m = clone('chrome');
      m[key] = [];
      expect(check(m, 'chrome', pkg)).toEqual([`top-level key "${key}" is not allowed`]);
    },
  );

  it('rejects an extra install-time permission and a relaxed CSP', () => {
    const m = clone('firefox');
    m.permissions = ['activeTab', 'storage', 'menus', 'cookies'];
    m.content_security_policy = { extension_pages: `${EXPECTED_CSP}; script-src 'unsafe-eval'` };
    expect(check(m, 'firefox', pkg)).toHaveLength(2);
  });

  it('rejects a gecko block on Chrome and a version drift', () => {
    const m = clone('chrome');
    m.browser_specific_settings = manifests.firefox.browser_specific_settings;
    m.version = '0.0.0';
    const violations = check(m, 'chrome', pkg);
    expect(violations).toContain('top-level key "browser_specific_settings" is not allowed');
    expect(violations.some((v) => v.startsWith('data_collection_permissions'))).toBe(true);
    expect(violations.some((v) => v.startsWith('version'))).toBe(true);
  });
});

// Structure: a manifest can keep every permission right and still not
// start (Chrome's worker defaults to a classic script, which can't run
// the built ES-module worker) or point a surface at a remote page.
describe('manifest invariants pin the structural blocks', () => {
  type Mutable = Record<string, Record<string, unknown>>;
  const clone = (target: 'firefox' | 'chrome'): Mutable =>
    structuredClone(manifests[target]) as unknown as Mutable;
  const violations = (target: 'firefox' | 'chrome', mutate: (m: Mutable) => void): string[] => {
    const m = clone(target);
    mutate(m);
    return check(m, target, pkg);
  };

  interface Mutation {
    target: 'firefox' | 'chrome';
    key: string;
    mutate: (m: Mutable) => void;
  }
  const mutations: Record<string, Mutation> = {
    'chrome: background.type dropped': {
      target: 'chrome',
      key: 'background',
      mutate: (m) => void delete m.background!.type,
    },
    'chrome: service_worker points at a missing file': {
      target: 'chrome',
      key: 'background',
      mutate: (m) => void (m.background!.service_worker = 'background/missing.js'),
    },
    'chrome: service_worker is a URL': {
      target: 'chrome',
      key: 'background',
      mutate: (m) => void (m.background!.service_worker = 'https://evil.example/sw.js'),
    },
    'chrome: side_panel.default_path is a URL': {
      target: 'chrome',
      key: 'side_panel',
      mutate: (m) => void (m.side_panel!.default_path = 'https://evil.example/panel.html'),
    },
    'chrome: manifest_version 2': {
      target: 'chrome',
      key: 'manifest_version',
      mutate: (m) => void ((m as Record<string, unknown>).manifest_version = 2),
    },
    'firefox: manifest_version 2': {
      target: 'firefox',
      key: 'manifest_version',
      mutate: (m) => void ((m as Record<string, unknown>).manifest_version = 2),
    },
    'firefox: background.type dropped': {
      target: 'firefox',
      key: 'background',
      mutate: (m) => void delete m.background!.type,
    },
    'firefox: background.scripts is a URL': {
      target: 'firefox',
      key: 'background',
      mutate: (m) => void (m.background!.scripts = ['https://evil.example/bg.js']),
    },
    'firefox: sidebar_action.default_panel is a URL': {
      target: 'firefox',
      key: 'sidebar_action',
      mutate: (m) => void (m.sidebar_action!.default_panel = 'https://evil.example/'),
    },
    'chrome: action.default_popup moved': {
      target: 'chrome',
      key: 'action',
      mutate: (m) => void (m.action!.default_popup = 'popup/other.html'),
    },
    'firefox: an extra icon': {
      target: 'firefox',
      key: 'icons',
      mutate: (m) => void (m.icons!['256'] = 'icons/icon-256.png'),
    },
  };

  it.each(Object.entries(mutations))('rejects %s', (_name, { target, key, mutate }) => {
    const v = violations(target, mutate);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(new RegExp(`^${key} must be exactly`));
  });

  it('lists every package file the manifest points at (verify:dist checks they exist)', () => {
    expect(referencedFiles(manifests.chrome)).toEqual([
      'background/background.js',
      'popup/popup.html',
      'icons/icon-16.png',
      'icons/icon-32.png',
      'icons/icon-48.png',
      'details/details.html',
      'icons/icon-128.png',
    ]);
    expect(referencedFiles(manifests.firefox)).toEqual([
      'background/background.js',
      'popup/popup.html',
      'icons/icon-16.png',
      'icons/icon-32.png',
      'icons/icon-48.png',
      'details/details.html',
      'icons/icon-128.png',
    ]);
  });
});
