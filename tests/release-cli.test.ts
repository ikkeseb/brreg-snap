import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { readZip } from '../scripts/lib/zip.mjs';

// CLI contract tests for scripts/release-notes.mjs, scripts/package-source.mjs,
// and scripts/canary-failures.mjs. Each script runs top-level I/O against
// process.argv, process.env, and cwd, so each test invokes it as a Node child
// process inside an isolated temporary directory.

const tempDirs: string[] = [];

const baseEnv: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'GITHUB_OUTPUT'),
);

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runCli(script: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = baseEnv) {
  const path = fileURLToPath(new URL(`../scripts/${script}.mjs`, import.meta.url));
  const result = spawnSync(process.execPath, [path, ...args], { cwd, env, encoding: 'utf8' });
  expect(result.error).toBeUndefined();
  return result;
}

function initGitRepo(tag?: string) {
  const dir = makeTempDir('brreg-snap-pkg-');
  const repo = join(dir, 'repo');
  const gitconfig = join(dir, 'gitconfig');
  mkdirSync(repo);
  writeFileSync(gitconfig, '');

  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(baseEnv).filter(([k]) => !k.toUpperCase().startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@example.invalid',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@example.invalid',
  };

  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' });

  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'package.json'), '{"version":"4.5.6"}\n');
  writeFileSync(join(repo, 'tagged.txt'), 'at tag\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'release');
  if (tag) {
    git('tag', tag);
  }
  writeFileSync(join(repo, 'after-tag.txt'), 'post-tag\n');
  writeFileSync(join(repo, 'tagged.txt'), 'after tag\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'post-tag');
  writeFileSync(join(repo, 'later.txt'), 'later\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'later');

  return { repo, env };
}

describe('scripts/release-notes.mjs', () => {
  it('prints the requested section from cwd CHANGELOG.md with a trailing newline and exits 0', () => {
    const dir = makeTempDir('brreg-snap-notes-');
    writeFileSync(
      join(dir, 'CHANGELOG.md'),
      [
        '# Changelog',
        '',
        '## [Unreleased]',
        '',
        '- Pending.',
        '',
        '## [2.4.0] — 2026-05-01',
        '',
        'Summary.',
        '',
        '### Fixed',
        '',
        '- First fix.',
        '- Second fix.',
        '',
        '## [2.3.0] — 2026-04-01',
        '',
        '- Older.',
        '',
      ].join('\n'),
    );

    const r = runCli('release-notes', ['2.4.0'], dir);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('Summary.\n\n### Fixed\n\n- First fix.\n- Second fix.\n');
  });

  it('exits 2 with usage on stderr when no version argument is passed', () => {
    const dir = makeTempDir('brreg-snap-notes-');
    const r = runCli('release-notes', [], dir);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('usage: node scripts/release-notes.mjs X.Y.Z\n');
  });

  it('exits 2 with usage on stderr when the version argument is invalid', () => {
    const dir = makeTempDir('brreg-snap-notes-');
    for (const bad of ['1.2', 'v1.2.3']) {
      const r = runCli('release-notes', [bad], dir);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe('usage: node scripts/release-notes.mjs X.Y.Z\n');
    }
  });

  it('exits 1 with empty stdout when the version is missing from CHANGELOG.md', () => {
    const dir = makeTempDir('brreg-snap-notes-');
    writeFileSync(join(dir, 'CHANGELOG.md'), '## [1.0.0] — 2026-01-01\n\n- Initial.\n');

    const r = runCli('release-notes', ['9.9.9'], dir);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('CHANGELOG.md has no non-empty "## [9.9.9]" section\n');
  });

  it('exits 1 with empty stdout when the section is present but empty', () => {
    const dir = makeTempDir('brreg-snap-notes-');
    writeFileSync(
      join(dir, 'CHANGELOG.md'),
      ['## [2.4.0] — 2026-05-01', '## [2.3.0] — 2026-04-01', '', '- Earlier.', ''].join('\n'),
    );

    const r = runCli('release-notes', ['2.4.0'], dir);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('CHANGELOG.md has no non-empty "## [2.4.0]" section\n');
  });
});

describe('scripts/package-source.mjs', () => {
  it('archives the tagged tree into web-ext-artifacts and excludes post-tag commits', () => {
    const { repo, env } = initGitRepo('v4.5.6');
    const r = runCli('package-source', [], repo, env);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('Wrote web-ext-artifacts/brreg-snap-source-4.5.6.zip from v4.5.6\n');

    const zipPath = join(repo, 'web-ext-artifacts', 'brreg-snap-source-4.5.6.zip');
    expect(existsSync(zipPath)).toBe(true);

    const entries = readZip(readFileSync(zipPath));
    expect(entries.map((e) => e.name).sort()).toEqual(['package.json', 'tagged.txt']);
    expect(entries.find((e) => e.name === 'package.json')?.data().toString('utf8')).toBe('{"version":"4.5.6"}\n');
    expect(entries.find((e) => e.name === 'tagged.txt')?.data().toString('utf8')).toBe('at tag\n');
  });

  it('exits 1, names the missing tag on stderr, and writes no zip when the tag is absent', () => {
    const { repo, env } = initGitRepo('v4.5.5');
    const r = runCli('package-source', [], repo, env);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('package:source: tag v4.5.6 not found — tag the release first.\n');
    expect(existsSync(join(repo, 'web-ext-artifacts'))).toBe(false);
  });
});

describe('scripts/canary-failures.mjs', () => {
  it('lists failed assertions with ancestor titles across files in order and omits passed tests', () => {
    const dir = makeTempDir('brreg-snap-canary-');
    writeFileSync(
      join(dir, 'report.json'),
      JSON.stringify({
        testResults: [
          {
            name: '/repo/tests/live/alpha.live.test.ts',
            status: 'failed',
            assertionResults: [
              { status: 'passed', ancestorTitles: ['suite'], title: 'passes quietly' },
              { status: 'failed', ancestorTitles: ['suite', 'nested'], title: 'breaks deeply' },
              { status: 'skipped', ancestorTitles: ['suite'], title: 'skipped one' },
              { status: 'failed', ancestorTitles: [], title: 'top-level failure' },
            ],
          },
          {
            name: '/repo/tests/live/beta.live.test.ts',
            status: 'passed',
            assertionResults: [{ status: 'passed', ancestorTitles: ['ok'], title: 'all good' }],
          },
          {
            name: '/repo/tests/live/gamma.live.test.ts',
            status: 'failed',
            assertionResults: [{ status: 'failed', ancestorTitles: ['canary'], title: 'second file failure' }],
          },
        ],
      }),
    );

    const r = runCli('canary-failures', ['report.json'], dir);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe(
      [
        '- `alpha.live.test.ts` › suite › nested › breaks deeply',
        '- `alpha.live.test.ts` › top-level failure',
        '- `gamma.live.test.ts` › canary › second file failure',
        '',
      ].join('\n'),
    );
  });

  it('formats file-level failures using only the first message line or omitting empty messages', () => {
    const dir = makeTempDir('brreg-snap-canary-');
    writeFileSync(
      join(dir, 'report.json'),
      JSON.stringify({
        testResults: [
          {
            name: '/repo/tests/live/import-err.test.ts',
            status: 'failed',
            message: 'SyntaxError: unexpected token\n    at foo.ts:1:1\n    at bar.ts:2:2',
            assertionResults: [],
          },
          {
            name: '/repo/tests/live/empty-msg.test.ts',
            status: 'failed',
            message: '',
            assertionResults: [],
          },
          {
            name: '/repo/tests/live/no-msg.test.ts',
            status: 'failed',
          },
        ],
      }),
    );

    const r = runCli('canary-failures', ['report.json'], dir);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe(
      [
        '- `import-err.test.ts` (file failed: SyntaxError: unexpected token)',
        '- `empty-msg.test.ts` (file failed)',
        '- `no-msg.test.ts` (file failed)',
        '',
      ].join('\n'),
    );
  });

  it('prints the no-failing-test fallback when every test passes', () => {
    const dir = makeTempDir('brreg-snap-canary-');
    writeFileSync(
      join(dir, 'report.json'),
      JSON.stringify({
        testResults: [
          {
            name: '/repo/tests/live/ok.test.ts',
            status: 'passed',
            assertionResults: [{ status: 'passed', ancestorTitles: ['suite'], title: 'ok' }],
          },
        ],
      }),
    );

    const r = runCli('canary-failures', ['report.json'], dir);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('- (the report shows no failing test; see the run log)\n');
  });

  it('prints the no-test-report fallback when the report file is missing', () => {
    const dir = makeTempDir('brreg-snap-canary-');
    const r = runCli('canary-failures', ['missing.json'], dir);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('- (no test report: the run failed before or outside the tests; see the run log)\n');
  });

  it('prints the no-test-report fallback when the report file contains malformed JSON', () => {
    const dir = makeTempDir('brreg-snap-canary-');
    writeFileSync(join(dir, 'bad.json'), '{not valid json');

    const r = runCli('canary-failures', ['bad.json'], dir);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('- (no test report: the run failed before or outside the tests; see the run log)\n');
  });

  it('reads live-results.json from cwd by default when no path argument is passed', () => {
    const dir = makeTempDir('brreg-snap-canary-');
    writeFileSync(
      join(dir, 'live-results.json'),
      JSON.stringify({
        testResults: [
          {
            name: '/repo/tests/live/default.test.ts',
            status: 'failed',
            assertionResults: [{ status: 'failed', ancestorTitles: ['default'], title: 'boom' }],
          },
        ],
      }),
    );

    const r = runCli('canary-failures', [], dir);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('- `default.test.ts` › default › boom\n');
  });

  it('omits ancestor separators when a failed assertion has no ancestorTitles key', () => {
    const dir = makeTempDir('brreg-snap-canary-');
    writeFileSync(
      join(dir, 'report.json'),
      JSON.stringify({
        testResults: [
          {
            name: '/repo/tests/live/flat.test.ts',
            status: 'failed',
            assertionResults: [{ status: 'failed', title: 'bare failure' }],
          },
        ],
      }),
    );

    const r = runCli('canary-failures', ['report.json'], dir);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('- `flat.test.ts` › bare failure\n');
  });

  it('prints the no-failing-test fallback when the report omits testResults', () => {
    const dir = makeTempDir('brreg-snap-canary-');
    writeFileSync(join(dir, 'report.json'), JSON.stringify({}));

    const r = runCli('canary-failures', ['report.json'], dir);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('- (the report shows no failing test; see the run log)\n');
  });

  it('formats a failed file whose assertionResults all passed using the first message line', () => {
    const dir = makeTempDir('brreg-snap-canary-');
    writeFileSync(
      join(dir, 'report.json'),
      JSON.stringify({
        testResults: [
          {
            name: '/repo/tests/live/hook.test.ts',
            status: 'failed',
            message: 'Error: afterAll hook threw\n    at hook.ts:4:1',
            assertionResults: [{ status: 'passed', ancestorTitles: ['suite'], title: 'passes' }],
          },
        ],
      }),
    );

    const r = runCli('canary-failures', ['report.json'], dir);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('- `hook.test.ts` (file failed: Error: afterAll hook threw)\n');
  });

  it('appends distinct UUID-delimited failures blocks to GITHUB_OUTPUT without overwriting existing content', () => {
    const dir = makeTempDir('brreg-snap-canary-');
    writeFileSync(
      join(dir, 'live-results.json'),
      JSON.stringify({
        testResults: [
          {
            name: '/repo/tests/live/a.test.ts',
            status: 'failed',
            assertionResults: [{ status: 'failed', ancestorTitles: ['s'], title: 'first' }],
          },
          {
            name: '/repo/tests/live/b.test.ts',
            status: 'failed',
            assertionResults: [{ status: 'failed', ancestorTitles: [], title: 'second' }],
          },
        ],
      }),
    );
    const outFile = join(dir, 'github-output.txt');
    writeFileSync(outFile, 'prior=1\n');

    const expectedList = '- `a.test.ts` › s › first\n- `b.test.ts` › second';
    let prior = 'prior=1\n';
    const delimiters: string[] = [];

    for (let i = 0; i < 2; i += 1) {
      const r = runCli('canary-failures', [], dir, { ...baseEnv, GITHUB_OUTPUT: outFile });
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(r.stdout).toBe(`${expectedList}\n`);

      const content = readFileSync(outFile, 'utf8');
      expect(content.startsWith(prior)).toBe(true);
      const appended = content.slice(prior.length);
      const header = /^failures<<(EOF_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\n/.exec(appended);
      expect(header).not.toBeNull();
      const delimiter = header?.[1] ?? '';
      expect(appended).toBe(`failures<<${delimiter}\n${expectedList}\n${delimiter}\n`);
      delimiters.push(delimiter);
      prior = content;
    }

    expect(delimiters[0]).not.toBe(delimiters[1]);
  });

  it('creates no output file when GITHUB_OUTPUT is unset', () => {
    const dir = makeTempDir('brreg-snap-canary-');
    writeFileSync(join(dir, 'live-results.json'), JSON.stringify({ testResults: [] }));

    const r = runCli('canary-failures', [], dir, baseEnv);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('- (the report shows no failing test; see the run log)\n');
    expect(readdirSync(dir)).toEqual(['live-results.json']);
  });
});
