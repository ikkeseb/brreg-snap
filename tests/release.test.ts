import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  changelogSection,
  compareVersions,
  extractSection,
  findTodos,
  kitFields,
  promoteUnreleased,
  reflowForAmo,
  renderTemplate,
  setJsonVersion,
  staleKitFiles,
  unreleasedBody,
} from '../scripts/lib/release.mjs';
import { amoLengthErrors, amoListingTexts, amoTextLengths, amoVersionTexts } from '../scripts/lib/amo.mjs';

// The pure half of `pnpm release` (scripts/release.mjs) and of the kit the
// store publisher reads. The real canonical docs and templates are used
// where it matters: a renamed anchor must fail here, not at release time.

const read = (p: string) => readFileSync(p, 'utf8');

const CHANGELOG = `# Changelog

Intro.

## [Unreleased]

### Fixed

- A thing.

## [1.3.1] — 2026-09-23

Patch.

### Fixed

- Old thing.

## [1.3.0] — 2026-07-05

- Older.
`;

describe('versions', () => {
  it('compares numerically, not as strings', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.3.1', '1.3.1')).toBe(0);
    expect(compareVersions('1.3.0', '1.3.1')).toBeLessThan(0);
  });

  it('bumps exactly one "version" field and keeps every other byte', () => {
    const src = '{\n  "name": "x",\n  "version":  "1.3.1",\n  "list": ["a"]\n}\n';
    expect(setJsonVersion(src, '1.4.0', 'f')).toBe(src.replace('1.3.1', '1.4.0'));
  });

  it('refuses a file with zero or two version fields', () => {
    expect(() => setJsonVersion('{"name":"x"}', '1.0.0', 'a.json')).toThrow(/a\.json.*found 0/);
    expect(() => setJsonVersion('{"version":"1","x":{"version":"2"}}', '1.0.0', 'b')).toThrow(/found 2/);
  });

  it('bumps the real package.json and both source manifests', () => {
    for (const f of ['package.json', 'public/manifest.firefox.json', 'public/manifest.chrome.json']) {
      const bumped = JSON.parse(setJsonVersion(read(f), '99.0.0', f)) as { version: string };
      expect(bumped.version).toBe('99.0.0');
    }
  });
});

describe('CHANGELOG', () => {
  it('reads the Unreleased body and a version section', () => {
    expect(unreleasedBody(CHANGELOG)).toBe('### Fixed\n\n- A thing.');
    expect(changelogSection(CHANGELOG, '1.3.1')).toBe('Patch.\n\n### Fixed\n\n- Old thing.');
    expect(changelogSection(CHANGELOG, '1.3')).toBeNull();
    expect(changelogSection(CHANGELOG, '9.9.9')).toBeNull();
  });

  it('promotes Unreleased to a dated section under a fresh empty Unreleased', () => {
    const out = promoteUnreleased(CHANGELOG, '1.4.0', '2026-10-01');
    expect(out).toContain('## [Unreleased]\n\n## [1.4.0] — 2026-10-01\n\n### Fixed\n\n- A thing.\n\n## [1.3.1]');
    expect(unreleasedBody(out)).toBe('');
    expect(changelogSection(out, '1.4.0')).toBe('### Fixed\n\n- A thing.');
  });

  it('refuses an empty or missing Unreleased and a duplicate version', () => {
    const empty = CHANGELOG.replace('### Fixed\n\n- A thing.\n\n', '');
    expect(unreleasedBody(empty)).toBe('');
    expect(() => promoteUnreleased(empty, '1.4.0', 'd')).toThrow(/empty/);
    expect(() => promoteUnreleased(CHANGELOG.replace('## [Unreleased]\n', ''), '1.4.0', 'd')).toThrow(
      /no "## \[Unreleased\]"/,
    );
    expect(() => promoteUnreleased(CHANGELOG, '1.3.1', 'd')).toThrow(/already has/);
  });

  it('stops a section at the link definitions and moves the compare links on promotion', () => {
    const repo = 'https://github.com/o/r';
    const linked = `${CHANGELOG}
[Unreleased]: ${repo}/compare/v1.3.1...HEAD
[1.3.1]: ${repo}/compare/v1.3.0...v1.3.1
[1.3.0]: ${repo}/releases/tag/v1.3.0
`;
    expect(changelogSection(linked, '1.3.0')).toBe('- Older.');
    const out = promoteUnreleased(linked, '1.4.0', '2026-10-01');
    expect(changelogSection(out, '1.4.0')).toBe('### Fixed\n\n- A thing.');
    expect(out).toContain(
      `[Unreleased]: ${repo}/compare/v1.4.0...HEAD\n[1.4.0]: ${repo}/compare/v1.3.1...v1.4.0\n[1.3.1]:`,
    );
    expect(unreleasedBody(`## [Unreleased]\n\n[Unreleased]: ${repo}/compare/v1.3.1...HEAD\n`)).toBe('');
  });

  it('the real CHANGELOG has an Unreleased heading and a 1.3.1 section', () => {
    const real = read('CHANGELOG.md');
    expect(unreleasedBody(real)).not.toBeNull();
    expect(changelogSection(real, '1.3.1')).toMatch(/^Correctness and privacy patch/);
    expect(changelogSection(real, '1.0.0')).not.toContain('[1.0.0]:');
  });
});

describe('anchored sections', () => {
  const DOC = `# T

<!-- SECTION: a -->
## A

> quoted
> text
>
> more

Trailing note.

### Sub

In A.

---

<!-- SECTION: b -->
### B

Body B.
## C
`;

  it('runs from the heading to the next same-or-higher heading or anchor', () => {
    expect(extractSection(DOC, 'a')).toBe('> quoted\n> text\n>\n> more\n\nTrailing note.\n\n### Sub\n\nIn A.');
    expect(extractSection(DOC, 'b')).toBe('Body B.');
  });

  it('throws on a missing, duplicated or headless anchor', () => {
    expect(() => extractSection(DOC, 'zz', 'doc.md')).toThrow(/doc\.md.*found 0/);
    expect(() => extractSection(`${DOC}\n<!-- SECTION: a -->\n## again`, 'a')).toThrow(/found 2/);
    expect(() => extractSection('<!-- SECTION: x -->\ntext', 'x')).toThrow(/above a heading/);
  });
});

describe('renderTemplate', () => {
  const ctx = {
    version: '2.0.0',
    values: { version: '2.0.0', changelog: '### Fixed\n\n- x' },
    docs: { d: '<!-- SECTION: notes -->\n## Notes\n\n> Tag `v<version>`\n> line two\n\nnot quoted\n' },
  };

  it('fills values, sections and filters', () => {
    expect(renderTemplate('v{{version}} {{ d:notes | unquote }}', ctx)).toBe('v2.0.0 Tag `v2.0.0`\nline two');
    expect(renderTemplate('{{ changelog | blockquote }}', ctx)).toBe('> ### Fixed\n>\n> - x');
    expect(renderTemplate('{{d:notes}}', ctx)).toContain('not quoted');
  });

  it('throws on unknown names, documents and filters', () => {
    expect(() => renderTemplate('{{nope}}', ctx)).toThrow(/unknown placeholder "nope"/);
    expect(() => renderTemplate('{{x:notes}}', ctx)).toThrow(/unknown document "x"/);
    expect(() => renderTemplate('{{version|shout}}', ctx)).toThrow(/unknown filter/);
    expect(() => renderTemplate('{{d:gone}}', ctx)).toThrow(/found 0/);
  });
});

describe('the real kit templates', () => {
  const version = '9.9.9';
  const ctx = {
    version,
    values: { version, changelog: '### Fixed\n\n- x', privacy_amo: reflowForAmo(read('PRIVACY.md')) },
    docs: { amo: read('docs/amo-submission.md'), cws: read('docs/cws-submission.md') },
  };
  const amo = renderTemplate(read('docs/submission-kit/templates/amo.md'), ctx);
  const cws = renderTemplate(read('docs/submission-kit/templates/cws.md'), ctx);

  it('render against the canonical docs with no placeholder or <version> left', () => {
    for (const kit of [amo, cws]) {
      expect(kit).not.toMatch(/\{\{|\}\}/);
      expect(kit).not.toContain('<version>');
    }
    expect(amo).toContain('attached source zip is `git archive` of tag `v9.9.9`');
  });

  it('leave exactly the two store-notes TODOs, in the release-notes fields', () => {
    expect(findTodos(amo)).toHaveLength(2);
    expect(findTodos(cws)).toEqual([]);
    const fields = kitFields(amo);
    expect(Object.keys(fields).sort()).toEqual([
      'approval_notes',
      'categories',
      'description.en-US',
      'description.nb-NO',
      'privacy_policy',
      'release_notes.en-US',
      'release_notes.nb-NO',
      'summary.en-US',
      'summary.nb-NO',
    ]);
    expect(fields['release_notes.nb-NO']).toContain('TODO(store-notes)');
    expect(fields.approval_notes).toMatch(/^A popup and sidebar company lookup/);
    expect(fields.privacy_policy).toBe(reflowForAmo(read('PRIVACY.md')).trim());
  });

  // The 1.6.0 submission failed at AMO on 3078 characters of reviewer
  // notes: an over-long canonical text fails here, before a release.
  it("fit AMO's length limits as sent, with the manifest name", () => {
    const fields = kitFields(amo);
    const name = JSON.parse(read('public/manifest.firefox.json')).name as string;
    const listing = amoListingTexts(fields, name);
    const bodies = [amoVersionTexts(fields), listing.addon, listing.policy];
    expect(bodies.flatMap(amoLengthErrors)).toEqual([]);
    expect(bodies.flatMap(amoTextLengths).map((t) => t.field)).toEqual([
      'release_notes.nb-NO',
      'release_notes.en-US',
      'approval_notes',
      'name.nb-NO',
      'name.en-US',
      'summary.nb-NO',
      'summary.en-US',
      'description.nb-NO',
      'description.en-US',
      'privacy_policy.nb-NO',
    ]);
  });
});

describe('one kit on main', () => {
  it('lists every earlier kit file and keeps the templates and the new kit', () => {
    const tracked = [
      'docs/submission-kit/templates/amo.md',
      'docs/submission-kit/1.4.2/amo.md',
      'docs/submission-kit/1.4.2/cws.md',
      'docs/submission-kit/1.5.0-beta.1/amo.md',
      'docs/submission-kit/1.5.0/amo.md',
      'docs/amo-submission.md',
    ];
    expect(staleKitFiles(tracked, '1.5.0')).toEqual([
      'docs/submission-kit/1.4.2/amo.md',
      'docs/submission-kit/1.4.2/cws.md',
      'docs/submission-kit/1.5.0-beta.1/amo.md',
    ]);
    expect(staleKitFiles(['docs/submission-kit/templates/cws.md'], '1.5.1')).toEqual([]);
  });

  it('the tree holds exactly the kit of the current version', () => {
    const current = (JSON.parse(read('package.json')) as { version: string }).version;
    expect(readdirSync('docs/submission-kit').sort()).toEqual([current, 'templates'].sort());
    expect(readdirSync(`docs/submission-kit/${current}`)).toEqual(expect.arrayContaining(['amo.md', 'cws.md']));
  });
});

describe('findTodos / kitFields', () => {
  it('reports 1-based lines', () => {
    expect(findTodos('a\nTODO(store-notes): x\nb\n TODO(store-notes)')).toEqual([2, 4]);
    expect(findTodos('TODO: something else')).toEqual([]);
  });

  it('reads the fenced block after each field marker', () => {
    const kit = '<!-- field: a -->\n\n```text\nline 1\nline 2\n```\n\n<!-- field: b -->\n````\nx ``` y\n````\n';
    expect(kitFields(kit)).toEqual({ a: 'line 1\nline 2', b: 'x ``` y' });
  });

  it('rejects a marker without a block, an unclosed fence and a duplicate', () => {
    expect(() => kitFields('<!-- field: a -->\ntext')).toThrow(/fenced block/);
    expect(() => kitFields('<!-- field: a -->\n```\nopen')).toThrow(/unclosed/);
    expect(() => kitFields('<!-- field: a -->\n```\n1\n```\n<!-- field: a -->\n```\n2\n```')).toThrow(/twice/);
  });
});

describe('reflowForAmo', () => {
  it('joins paragraphs and list items, bolds headings, drops the title', () => {
    const md = '# Title\n\n_Updated._\n\nOne\ntwo.\n\n## Head\n\n- item\n  continued\n- next\n\n1. a\n2. b\n   c';
    expect(reflowForAmo(md)).toBe('_Updated._\n\nOne two.\n\n**Head**\n\n- item continued\n- next\n\n1. a\n2. b c');
  });

  it('turns tables into key: value list items', () => {
    const md = '| Permission | Why |\n|---|---|\n| `tabs` | Auto-sync. |\n| `storage` | Cache. |';
    expect(reflowForAmo(md)).toBe('- `tabs`: Auto-sync.\n- `storage`: Cache.');
    const wide = '| Data | Example | Why |\n|:--|--|--:|\n| Domain | `dnb.no` | Finds it |';
    expect(reflowForAmo(wide)).toBe('- Domain — Example: `dnb.no`; Why: Finds it');
  });

  it('leaves no heading, table or wrapped line in the real PRIVACY.md copy', () => {
    const out = reflowForAmo(read('PRIVACY.md'));
    expect(out).not.toMatch(/^#/m);
    expect(out).not.toMatch(/^\|/m);
    expect(out).toContain('**What is sent**');
    expect(out).toContain('- `activeTab`: Read the address and title of the current tab');
    // Every line is a whole paragraph, heading or item: none starts mid-sentence.
    for (const line of out.split('\n').filter(Boolean)) {
      expect(line).toMatch(/^(\*\*|_|- |\d+\. |[A-Z«]|brreg-snap)/);
    }
  });
});
