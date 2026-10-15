import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// scripts/release.mjs end to end, in copies of one throwaway repo with a
// bare origin. A stub `pnpm` on PATH (sh and cmd) stands in for
// `pnpm verify` and exits with FAKE_VERIFY_STATUS. tests/release.test.ts
// holds the pure half.

const NEXT = '99.0.0';
const current = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
const OLD = `docs/submission-kit/${current}`;
// A second earlier kit with nothing but tracked files: it goes entirely.
const OLDER = 'docs/submission-kit/0.0.1';

let base = '';
let env: NodeJS.ProcessEnv = {};

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'brreg-snap-release-'));
  const repo = join(base, 'repo');
  for (const p of [
    'scripts',
    'package.json',
    'public/manifest.firefox.json',
    'public/manifest.chrome.json',
    'PRIVACY.md',
    'docs/amo-submission.md',
    'docs/cws-submission.md',
    'docs/submission-kit',
  ]) {
    cpSync(p, join(repo, p), { recursive: true });
  }
  cpSync(OLD, join(repo, OLDER), { recursive: true });
  // A tracked name git quotes in plain output (core.quotePath).
  writeFileSync(join(repo, OLDER, 'notater-\u00e6.md'), 'notes\n');
  writeFileSync(
    join(repo, 'CHANGELOG.md'),
    readFileSync('CHANGELOG.md', 'utf8').replace('## [Unreleased]\n', '## [Unreleased]\n\n### Fixed\n\n- A thing.\n'),
  );
  writeFileSync(join(repo, '.gitignore'), '*.log\n');

  const bin = join(base, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexit "$FAKE_VERIFY_STATUS"\n');
  chmodSync(join(bin, 'pnpm'), 0o755);
  writeFileSync(join(bin, 'pnpm.cmd'), '@exit /b %FAKE_VERIFY_STATUS%\r\n');
  writeFileSync(join(base, 'gitconfig'), '');
  // No GIT_* from a hook, no user config (signing, hooks), and process.env
  // is case-insensitive on Windows where a plain copy is not: drop Path too.
  env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k.toUpperCase() !== 'PATH'),
  );
  Object.assign(env, {
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: join(base, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@example.invalid',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@example.invalid',
  });

  const git = gitIn(repo);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('init', '-q', '--bare', join(base, 'origin.git'));
  git('remote', 'add', 'origin', '../origin.git');
  git('push', '-q', 'origin', 'main');
  // An ignored file in the earlier kit: git has no copy of it.
  writeFileSync(join(repo, OLD, 'review.log'), 'local notes\n');
}, 60_000);

afterAll(() => {
  if (base) rmSync(base, { recursive: true, force: true });
});

const gitIn = (cwd: string) => (...a: string[]) => execFileSync('git', a, { cwd, env, encoding: 'utf8' }).trim();

/** A fresh copy of the base repo and its origin. */
function scratch(name: string) {
  const dir = join(base, name);
  cpSync(join(base, 'repo'), join(dir, 'repo'), { recursive: true });
  cpSync(join(base, 'origin.git'), join(dir, 'origin.git'), { recursive: true });
  const repo = join(dir, 'repo');
  const release = (verifyStatus: number, ...a: string[]) =>
    spawnSync(process.execPath, ['scripts/release.mjs', NEXT, ...a], {
      cwd: repo,
      env: { ...env, FAKE_VERIFY_STATUS: String(verifyStatus) },
      encoding: 'utf8',
    });
  return { repo, git: gitIn(repo), release };
}

describe('pnpm release in a scratch repo', () => {
  it('keeps an ignored file in an earlier kit when verify fails', () => {
    const { repo, release } = scratch('fail');
    expect(release(1, '--skip-ci-check').status).toBe(1);
    expect(existsSync(join(repo, OLD, 'review.log'))).toBe(true);
    expect(existsSync(join(repo, OLD, 'amo.md'))).toBe(false);
  });

  it('deletes only tracked kit files, and tags only once each is deleted', () => {
    const { repo, git, release } = scratch('pass');
    const r = release(0, '--skip-ci-check');
    expect(r.stdout).not.toContain('FAIL');
    expect(r.status).toBe(0);
    expect(existsSync(join(repo, OLD, 'review.log'))).toBe(true);
    expect(existsSync(join(repo, OLD, 'amo.md'))).toBe(false);
    expect(existsSync(join(repo, OLD, 'cws.md'))).toBe(false);
    expect(existsSync(join(repo, OLDER))).toBe(false);

    const kit = join(repo, `docs/submission-kit/${NEXT}/amo.md`);
    writeFileSync(kit, readFileSync(kit, 'utf8').replace(/^.*TODO\(store-notes\).*$/gm, 'Notes.'));

    // An earlier kit file brought back and edited is not a deletion.
    git('checkout', '--', `${OLD}/cws.md`);
    appendFileSync(join(repo, OLD, 'cws.md'), 'edit\n');
    const head = git('rev-parse', 'HEAD');
    const refused = release(0, '--tag');
    expect(refused.stdout).toContain(`FAIL every earlier kit file is deleted (still there: ${OLD}/cws.md)`);
    expect(refused.status).toBe(1);
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(git('tag', '--list')).toBe('');

    rmSync(join(repo, OLD, 'cws.md'));
    // Staged, git sees the kit move as renames: the preflight must not
    // misread them.
    git('add', '-A');
    const tagged = release(0, '--tag');
    expect(tagged.stdout).not.toContain('FAIL');
    expect(tagged.status).toBe(0);
    expect(git('tag', '--list')).toBe(`v${NEXT}`);
    expect(git('ls-tree', '-r', '--name-only', 'HEAD', '--', 'docs/submission-kit').split('\n')).toEqual([
      `docs/submission-kit/${NEXT}/amo.md`,
      `docs/submission-kit/${NEXT}/cws.md`,
      'docs/submission-kit/templates/amo.md',
      'docs/submission-kit/templates/cws.md',
    ]);
    expect(existsSync(join(repo, OLD, 'review.log'))).toBe(true);
  });
});
