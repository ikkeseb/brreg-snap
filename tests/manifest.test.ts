import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The security model IS the product differentiator (CLAUDE.md
// § Security constraints): no content scripts, data.brreg.no as the
// only host, install-time permissions limited to activeTab/storage/
// menus (+ Chrome's contextMenus/sidePanel equivalents), `tabs` as
// runtime opt-in only, and a strict CSP. These tests pin the SOURCE
// manifests so a violating change fails `pnpm test` locally; CI
// additionally re-checks the stamped dist manifests after build.

interface Manifest {
  version: string;
  permissions?: string[];
  optional_permissions?: string[];
  host_permissions?: string[];
  content_scripts?: unknown;
  content_security_policy?: { extension_pages?: string };
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
const EXPECTED_PERMISSIONS = {
  firefox: ['activeTab', 'storage', 'menus'],
  chrome: ['activeTab', 'storage', 'contextMenus', 'sidePanel'],
};

const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; " +
  "img-src 'self' data:; object-src 'self'; " +
  'connect-src https://data.brreg.no; ' +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

describe.each(['firefox', 'chrome'] as const)('manifest.%s', (target) => {
  const m = manifests[target];

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
