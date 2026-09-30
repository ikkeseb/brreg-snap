import { describe, expect, it } from 'vitest';

import { checkDocs, selectDocFiles } from '../scripts/lib/docs-check.mjs';

const BASE = {
  'README.md': '',
  'CLAUDE.md': '# No curated data\n',
  'package.json': '{}',
  'src/lib/brreg.ts': '',
  'src/details/controller.ts': '',
  'public/manifest.firefox.json': '{}',
  'public/manifest.chrome.json': '{}',
  'scripts/preview/README.md': '',
  'scripts/preview/fixtures.mjs': 'function normalizeRequest() {}',
  'docs/notes/api.md': '<!-- SECTION: latest-year -->\n## Latest `year`\n',
};

function scan(text: string, options: {
  files?: Record<string, string>;
  ignored?: string[];
  missing?: string[];
  source?: string;
} = {}) {
  const files: Record<string, string> = { ...BASE, ...options.files };
  const source = options.source ?? 'README.md';
  files[source] = text;
  const trackedFiles = Object.keys(files);
  const ignored = new Set(options.ignored);
  const missing = new Set(options.missing);
  return checkDocs({
    trackedFiles,
    readFile: (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`Unexpected read: ${path}`);
      return content;
    },
    exists: (path: string) => !missing.has(path) && (path in files ||
      trackedFiles.some((file) => file.startsWith(path.endsWith('/') ? path : `${path}/`))),
    isIgnored: (path: string) => ignored.has(path),
  });
}

describe('docs paths', () => {
  it('checks an existing inline path and a tracked root file', () => {
    const result = scan('`src/lib/brreg.ts` and `package.json`.');
    expect(result.hits).toEqual([]);
    expect(result.referencesChecked).toBe(2);
  });

  it('reports a missing path with source line and reason', () => {
    expect(scan('Intro.\n\n`src/lib/missing.ts`').hits).toEqual([
      { file: 'README.md', line: 3, message: '"src/lib/missing.ts": missing path "src/lib/missing.ts"' },
    ]);
  });

  it('checks physical existence even for a tracked file', () => {
    expect(scan('`src/lib/brreg.ts`', { missing: ['src/lib/brreg.ts'] }).hits[0]?.message).toContain('missing path');
  });

  it('rejects ignored paths even when they exist or are missing', () => {
    for (const path of ['src/lib/brreg.ts', 'docs/secret.md']) {
      const result = scan(`\`${path}\``, { ignored: [path] });
      expect(result.hits[0]?.message).toContain(`gitignored path "${path}"`);
    }
  });

  it('strips line and fragment suffixes on directory paths and root files', () => {
    const result = scan('`src/details/controller.ts:42` `src/lib/brreg.ts:2-9#code` `CLAUDE.md:1-5`');
    expect(result.hits).toEqual([]);
    expect(result.referencesChecked).toBe(3);
  });

  it('expands braces and fails when one alternative is missing', () => {
    expect(scan('`public/manifest.{firefox,chrome}.json`').hits).toEqual([]);
    expect(scan('`public/manifest.{firefox,missing}.json`').hits[0]?.message).toContain('missing path "public/manifest.missing.json"');
    expect(scan('`src/{lib,details}/{brreg,missing}.ts`').hits).toHaveLength(3);
  });

  it('requires a tracked glob match and respects path segments', () => {
    expect(scan('`public/manifest.*.json` `src/**/*.ts`').hits).toEqual([]);
    expect(scan('`src/lib/*.json`').hits[0]?.message).toContain('no tracked matches');
    expect(scan('`src/*.ts`').hits[0]?.message).toContain('no tracked matches');
  });

  it('checks existence and ignore rules for glob matches', () => {
    expect(scan('`public/manifest.*.json`', { ignored: ['public/manifest.chrome.json'] }).hits[0]?.message).toContain('gitignored path');
    expect(scan('`public/manifest.*.json`', { missing: ['public/manifest.chrome.json'] }).hits[0]?.message).toContain('missing path');
  });

  it('requires tracked contents and physical existence for a trailing slash', () => {
    expect(scan('`scripts/preview/`').hits).toEqual([]);
    expect(scan('`scripts/missing/`').hits[0]?.message).toContain('no tracked files in directory');
    expect(scan('`scripts/preview/`', { missing: ['scripts/preview/'] }).hits[0]?.message).toContain('missing directory');
  });

  it.each([
    'docs/submission-kit/X.Y.Z/amo.md', 'src/<module>.ts', 'src/…/api.ts', 'src/.../api.ts',
    'public/manifest.${browser}.json', 'docs/{{version}}/amo.md', 'docs/screenshots/01..03.png',
    'https://example.com/src/missing.ts', 'mailto:someone@example.com',
    'dist-firefox/', 'dist-chrome/manifest.json', 'web-ext-artifacts/', 'test-results/', 'node_modules/', 'coverage/',
    'src/lib/brreg.ts --flag', 'not-a-root/file.ts',
  ])('skips non-literal or non-repo reference %s', (reference) => {
    const result = scan(`\`${reference}\``);
    expect(result.hits).toEqual([]);
    expect(result.referencesChecked).toBe(0);
  });

  it('skips output directories even if they occur in the tracked inventory', () => {
    expect(scan('`dist-chrome/missing.js`', { files: { 'dist-chrome/README.md': '' } }).referencesChecked).toBe(0);
  });

  it('checks relative Markdown links, resolving from the source file', () => {
    expect(scan('[API](docs/notes/api.md#latest-year) [source](src/lib/brreg.ts)').hits).toEqual([]);
    expect(scan('[missing](docs/notes/gone.md)').hits[0]?.message).toContain('missing path');
    const result = scan('[API](notes/api.md) [root](../CLAUDE.md#heading)', { source: 'docs/guide.md' });
    expect(result.hits).toEqual([]);
    expect(result.referencesChecked).toBe(2);
  });

  it('ignores external links, fragment-only links, comments and fenced examples', () => {
    const result = scan('[web](https://example.com/docs/missing.md) [local](#heading)\n' +
      '<!-- `src/missing.ts` § bad -->\n```md\n`src/missing.ts` § bad\n```\n' +
      '~~~md\n[bad](src/missing.ts)\n~~~\n`[bad](src/missing.ts)`');
    expect(result.hits).toEqual([]);
    expect(result.referencesChecked).toBe(0);
    expect(result.sectionRefsSkipped).toBe(0);
  });
});

describe('docs sections', () => {
  it.each([
    '`docs/notes/api.md` § `latest-year`',
    '`docs/notes/api.md` § latest-year.',
    '`docs/notes/api.md § latest-year`',
    '(docs/notes/api.md\n§ latest-year).',
  ])('checks a present SECTION anchor: %s', (reference) => {
    const result = scan(reference);
    expect(result.hits).toEqual([]);
    expect(result.sectionRefsSkipped).toBe(0);
    expect(result.referencesChecked).toBeGreaterThan(0);
  });

  it.each([
    '`docs/notes/api.md` § `missing-anchor`',
    '`docs/notes/api.md` § missing-anchor.',
    '`docs/notes/api.md § missing-anchor`',
  ])('reports a missing SECTION anchor: %s', (reference) => {
    expect(scan(reference).hits).toHaveLength(1);
    expect(scan(reference).hits[0]?.message).toContain('missing SECTION anchor "missing-anchor"');
  });

  it.each(['CLAUDE.md § "No curated data".', '`CLAUDE.md` § No curated data.', 'CLAUDE.md § "No\ncurated data".'])('checks a heading reference: %s', (reference) => {
    expect(scan(reference).hits).toEqual([]);
    expect(scan(reference).sectionRefsSkipped).toBe(0);
  });

  it.each(['CLAUDE.md § "No curated domain table".', '`CLAUDE.md` § Missing heading.'])('reports a missing heading: %s', (reference) => {
    expect(scan(reference).hits).toHaveLength(1);
    expect(scan(reference).hits[0]?.message).toContain('missing heading');
  });

  it('ignores heading case, backticks and quotes', () => {
    expect(scan('`docs/notes/api.md` § "LATEST YEAR".').hits).toEqual([]);
    expect(scan('CLAUDE.md § "no curated data".', { files: { 'CLAUDE.md': '# "No" `curated` data ###\n' } }).hits).toEqual([]);
    expect(scan('CLAUDE.md § no curated data.').hits).toEqual([]);
  });

  it('reads setext headings and ignores headings in fenced examples', () => {
    expect(scan('CLAUDE.md § "No curated data".', { files: { 'CLAUDE.md': 'No curated data\n===\n' } }).hits).toEqual([]);
    expect(scan('CLAUDE.md § "No curated data".', { files: { 'CLAUDE.md': '```md\n# No curated data\n```' } }).hits[0]?.message).toContain('missing heading');
  });

  it('counts local, legal, symbolic and otherwise ambiguous § references as skipped', () => {
    const result = scan('See § local. Law § 1-2. SPEC.md § Contrast.\n' +
      '`scripts/preview/fixtures.mjs` § normalizeRequest)\n' +
      'CLAUDE.md § No\ncurated data.\n`CLAUDE.md` § [{{version}}].');
    expect(result.hits).toEqual([]);
    expect(result.sectionRefsSkipped).toBe(6);
  });

  it('skips a heading followed by prose when its end is ambiguous', () => {
    const result = scan('CLAUDE.md § No curated data for the rule that actually shipped.');
    expect(result.hits).toEqual([]);
    expect(result.sectionRefsSkipped).toBe(1);
    expect(scan('CLAUDE.md § "No curated data extra".').hits[0]?.message).toContain('missing heading');
  });

  it('reports a missing section target once and checks its path before reading it', () => {
    const result = scan('`docs/missing.md` § missing-anchor.');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.message).toContain('missing path');
    expect(result.referencesChecked).toBe(1);
  });
});

describe('live corpus', () => {
  it('selects exactly the allowed tracked document families', () => {
    const live = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'BUILD.md', 'PRIVACY.md',
      'docs/guide.md', 'docs/notes/api.md', 'docs/submission-kit/templates/amo.md',
      'scripts/tool/README.md', 'tests/fixtures/deep/README.md', 'public/README.md', 'docs/screenshots/README.md'];
    const excluded = ['CHANGELOG.md', 'backlog.md', 'docs/plans/README.md', 'docs/plans/old.md',
      'docs/submission-kit/1.4.0/README.md', 'docs/submission-kit/1.4.0/amo.md',
      'docs/submission-kit/1.4.0-beta.1/README.md', 'tests/note.md', 'docs/other/note.md', 'other/README.md'];
    expect(selectDocFiles([...live, ...excluded])).toEqual(live);
  });

  it('does not scan excluded files or ask for an absent AGENTS.md', () => {
    const result = scan('', { files: {
      'CHANGELOG.md': '`src/missing.ts`',
      'docs/plans/README.md': '`src/missing.ts`',
      'docs/submission-kit/1.4.0/amo.md': '`src/missing.ts`',
    } });
    expect(result.hits).toEqual([]);
    expect(result.filesScanned).toBe(4);
  });
});
