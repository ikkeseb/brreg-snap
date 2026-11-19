import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { decidePush, runPrePush, type RunResult } from '../scripts/lib/pre-push.mjs';

// Unit checks for ref decisions and subprocess handling (fakes only), plus an
// integration suite that drives `.githooks/pre-push` through real git.

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const TAG = 'c'.repeat(40);
const update = (sha = HEAD, ref = 'refs/heads/main', remote = OTHER) => `${ref} ${sha} ${ref} ${remote}\n`;
const deletion = (length = 40) => update('0'.repeat(length), '(delete)');
const peel = (sha: string) => (sha === TAG ? HEAD : sha);
const gateCall = { command: 'pnpm verify', args: [], options: { stdio: 'inherit', shell: true } };

interface RecordedCall {
  command: string;
  args: readonly string[];
  options: Record<string, unknown>;
}

interface ExerciseOptions {
  head?: string;
  status?: string;
  resolve?: (sha: string) => string;
  gitFailure?: 'head' | 'status' | 'peel';
  gitResult?: RunResult;
  gateResult?: RunResult;
}

function exercise(
  stdin: string,
  {
    head = HEAD,
    status = '',
    resolve = peel,
    gitFailure,
    gitResult = { status: 1, stdout: '' },
    gateResult = { status: 0 },
  }: ExerciseOptions = {},
) {
  const calls: RecordedCall[] = [];
  const result = runPrePush(stdin, (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'pnpm verify') return gateResult;
    if (command !== 'git') throw new Error(`unexpected command: ${command}`);
    const operation = args[0] === 'status' ? 'status' : args[1] === 'HEAD' ? 'head' : 'peel';
    if (operation === gitFailure) return gitResult;
    if (operation === 'head') return { status: 0, stdout: `${head}\n` };
    if (operation === 'status') return { status: 0, stdout: status };
    return { status: 0, stdout: resolve((args[2] ?? '').replace(/\^\{commit\}$/, '')) };
  });
  return { result, calls, gates: calls.filter(({ command }) => command === 'pnpm verify') };
}

function checkedRefs(calls: RecordedCall[], shas: string[]) {
  const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] };
  expect(calls.filter(({ command }) => command === 'git')).toEqual([
    { command: 'git', args: ['rev-parse', 'HEAD'], options },
    { command: 'git', args: ['status', '--porcelain', '--untracked-files=all'], options },
    ...shas.map((sha) => ({ command: 'git', args: ['rev-parse', '--verify', `${sha}^{commit}`], options })),
  ]);
}

function refused(stdin: string, options: ExerciseOptions, reason: RegExp) {
  const decision = decidePush(stdin, HEAD, options.resolve ?? peel, options.status ?? '');
  expect(decision.action).toBe('refuse');
  expect(decision.message).toMatch(reason);
  const { result, gates } = exercise(stdin, options);
  expect(result.code).toBe(1);
  expect(result.message).toMatch(reason);
  expect(result.message).toMatch(/clean checkout of its commit/);
  expect(gates).toEqual([]);
}

describe('pre-push decision and runner', () => {
  for (const length of [40, 64]) {
    it(`delete-only push with ${length}-digit SHA skips all subprocesses, even when dirty`, () => {
      const stdin = deletion(length);
      expect(
        decidePush(
          stdin,
          HEAD,
          () => {
            throw new Error('must not peel deletion');
          },
          '?? new.txt\n',
        ).action,
      ).toBe('nothing');
      const { result, calls } = exercise(stdin, { status: '?? new.txt\n' });
      expect(result.code).toBe(0);
      expect(calls).toEqual([]);
    });
  }

  it('empty stdin skips the gate', () => {
    expect(decidePush('', HEAD, peel, '').action).toBe('nothing');
    const { result, calls } = exercise('');
    expect(result.code).toBe(0);
    expect(calls).toEqual([]);
  });

  for (const [name, stdin, shas] of [
    ['single clean HEAD ref', update(), [HEAD]],
    ['two refs at HEAD', update() + update(HEAD, 'refs/heads/dev'), [HEAD, HEAD]],
    ['annotated tag peeling to HEAD', update(TAG, 'refs/tags/v1'), [TAG]],
    ['deletion mixed with HEAD and a tag', deletion() + update() + update(TAG, 'refs/tags/v1'), [HEAD, TAG]],
    ['CRLF updates', (deletion() + update()).replaceAll('\n', '\r\n'), [HEAD]],
    ['new ref with zero remote SHA', update(HEAD, 'refs/heads/new', '0'.repeat(40)), [HEAD]],
  ] as const) {
    it(`${name} checks pushed commits and runs pnpm verify once`, () => {
      expect(decidePush(stdin, HEAD, peel, '').action).toBe('gate');
      const { result, calls, gates } = exercise(stdin);
      expect(result.code).toBe(0);
      checkedRefs(calls, [...shas]);
      expect(gates).toEqual([gateCall]);
    });
  }

  it('64-digit commit at HEAD runs the gate once', () => {
    const head = 'd'.repeat(64);
    const stdin = update(head, 'refs/heads/main', 'e'.repeat(64));
    expect(decidePush(stdin, head, peel, '').action).toBe('gate');
    const { result, calls, gates } = exercise(stdin, { head });
    expect(result.code).toBe(0);
    checkedRefs(calls, [head]);
    expect(gates).toEqual([gateCall]);
  });

  it('a ref at another commit refuses without a gate', () => {
    refused(update(OTHER, 'refs/heads/other'), {}, /refs\/heads\/other.*not HEAD/);
  });

  it('HEAD plus a ref at another commit refuses the whole push', () => {
    refused(update() + update(OTHER, 'refs/heads/other'), {}, /not HEAD/);
  });

  for (const status of [' M tracked.txt\n', 'M  staged.txt\n', '?? untracked.txt\n']) {
    it(`dirty status ${status.trim()} refuses without a gate`, () => {
      refused(update(), { status }, /working tree or index is not clean/);
    });
  }

  for (const [name, stdin] of [
    ['three fields', `refs/heads/main ${HEAD} refs/heads/main\n`],
    ['five fields', `${update().trimEnd()} extra\n`],
    ['invalid local SHA', update('not-a-sha')],
    ['invalid remote SHA', update(HEAD, 'refs/heads/main', 'not-a-sha')],
    ['short zero SHA', update('0')],
    ['deletion missing a field', `(delete) ${'0'.repeat(40)} refs/heads/main\n`],
    ['deletion with invalid remote SHA', update('0'.repeat(40), '(delete)', 'bad')],
  ] as const) {
    it(`malformed update with ${name} refuses without a gate`, () => {
      refused(stdin, {}, /invalid ref update/);
    });
  }

  it('peel failure refuses without a gate', () => {
    refused(
      update(TAG, 'refs/tags/tree'),
      {
        resolve: () => {
          throw new Error('not a commit');
        },
      },
      /could not be peeled to a commit/,
    );
  });

  it('empty peel result refuses without a gate', () => {
    refused(update(), { resolve: () => '' }, /could not be peeled to a commit/);
  });

  for (const operation of ['head', 'status', 'peel'] as const) {
    for (const [name, gitResult] of [
      ['non-zero exit', { status: 1, stdout: '' }],
      ['spawn error despite status zero', { error: new Error('EIO'), status: 0, stdout: `${HEAD}\n` }],
    ] as [string, RunResult][]) {
      it(`git ${operation} ${name} refuses without a gate`, () => {
        const { result, gates } = exercise(update(), { gitFailure: operation, gitResult });
        expect(result.code).toBe(1);
        expect(result.message).toMatch(/failed|could not be peeled/);
        expect(gates).toEqual([]);
      });
    }
  }

  for (const [name, gateResult, code] of [
    ['non-zero exit', { status: 7 }, 7],
    ['signal', { status: null, signal: 'SIGTERM' }, 1],
    ['spawn error', { error: new Error('ENOENT'), status: null }, 1],
    ['spawn error despite status zero', { error: new Error('EIO'), status: 0 }, 1],
  ] as [string, RunResult, number][]) {
    it(`gate ${name} refuses after checking refs`, () => {
      const { result, calls, gates } = exercise(update(), { gateResult });
      checkedRefs(calls, [HEAD]);
      expect(gates).toEqual([gateCall]);
      expect(result.code).toBe(code);
      if (gateResult.error) expect(result.message).toMatch(/could not start pnpm verify/);
    });
  }

  it('the installed entry point refuses a malformed update read from stdin', () => {
    const entry = new URL('../scripts/pre-push.mjs', import.meta.url);
    const result = spawnSync(process.execPath, [fileURLToPath(entry)], {
      input: 'not a ref update\n',
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toMatch(/invalid ref update/);
  });
});

describe.skipIf(process.platform === 'win32')('pre-push hook git integration', () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  function setupRepo(pnpmExit = 0) {
    tempDir = mkdtempSync(join(tmpdir(), 'brreg-snap-pre-push-'));
    const work = join(tempDir, 'work');
    const bare = join(tempDir, 'remote.git');
    const bin = join(tempDir, 'bin');
    const marker = join(tempDir, 'pnpm.log');
    mkdirSync(work, { recursive: true });
    mkdirSync(bare, { recursive: true });
    mkdirSync(bin, { recursive: true });

    const baseEnv: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k.startsWith('GIT_')) continue;
      if (v !== undefined) baseEnv[k] = v;
    }
    const env: NodeJS.ProcessEnv = {
      ...baseEnv,
      PATH: [bin, dirname(process.execPath), process.env.PATH].filter(Boolean).join(':'),
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      FAKE_PNPM_LOG: marker,
      FAKE_PNPM_EXIT: String(pnpmExit),
    };

    const fakePnpm = join(bin, 'pnpm');
    writeFileSync(fakePnpm, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$FAKE_PNPM_LOG"\nexit "${FAKE_PNPM_EXIT:-0}"\n');
    chmodSync(fakePnpm, 0o755);

    const git = (args: string[], cwd = work) =>
      spawnSync(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args],
        { cwd, env, encoding: 'utf8' },
      );

    const mustGit = (args: string[], cwd = work) => {
      const r = git(args, cwd);
      if (r.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed (${r.status}): ${r.stderr}`);
      }
      return r.stdout;
    };

    mustGit(['-c', 'init.defaultBranch=main', 'init'], work);
    mustGit(['init', '--bare'], bare);

    for (const rel of ['.githooks/pre-push', 'scripts/pre-push.mjs', 'scripts/lib/pre-push.mjs']) {
      const src = join(repoRoot, rel);
      const dst = join(work, rel);
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      chmodSync(dst, statSync(src).mode);
    }
    writeFileSync(join(work, 'tracked.txt'), 'initial\n');

    mustGit(['add', '.']);
    mustGit(['commit', '-m', 'initial']);
    mustGit(['remote', 'add', 'origin', bare]);
    mustGit(['config', 'core.hooksPath', '.githooks']);

    const headSha = () => mustGit(['rev-parse', 'HEAD']).trim();
    const remoteRef = (branch: string) => {
      const r = git(['--git-dir', bare, 'rev-parse', '--verify', `refs/heads/${branch}`], tempDir);
      return r.status === 0 ? r.stdout.trim() : null;
    };
    const gateRuns = () => (existsSync(marker) ? readFileSync(marker, 'utf8').split('\n').filter(Boolean) : []);

    return { work, bare, git, mustGit, headSha, remoteRef, gateRuns };
  }

  it('clean checkout, push HEAD branch succeeds, runs gate once, and updates remote to HEAD', () => {
    const { git, headSha, remoteRef, gateRuns } = setupRepo();
    const head = headSha();
    const push = git(['push', 'origin', 'main']);
    expect(push.status, push.stderr).toBe(0);
    expect(gateRuns()).toEqual(['verify']);
    expect(remoteRef('main')).toBe(head);
  });

  it('modified tracked file refuses without running gate and leaves remote unchanged', () => {
    const { work, git, remoteRef, gateRuns } = setupRepo();
    writeFileSync(join(work, 'tracked.txt'), 'modified\n');
    const push = git(['push', 'origin', 'main']);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toMatch(/working tree or index is not clean/);
    expect(gateRuns()).toEqual([]);
    expect(remoteRef('main')).toBeNull();
  });

  it('untracked file refuses without running gate and leaves remote unchanged', () => {
    const { work, git, remoteRef, gateRuns } = setupRepo();
    writeFileSync(join(work, 'untracked.txt'), 'untracked\n');
    const push = git(['push', 'origin', 'main']);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toMatch(/working tree or index is not clean/);
    expect(gateRuns()).toEqual([]);
    expect(remoteRef('main')).toBeNull();
  });

  it('staged change refuses without running gate and leaves remote unchanged', () => {
    const { work, git, mustGit, remoteRef, gateRuns } = setupRepo();
    writeFileSync(join(work, 'tracked.txt'), 'staged\n');
    mustGit(['add', 'tracked.txt']);
    const push = git(['push', 'origin', 'main']);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toMatch(/working tree or index is not clean/);
    expect(gateRuns()).toEqual([]);
    expect(remoteRef('main')).toBeNull();
  });

  it('push of another branch not at HEAD refuses without running gate and creates no remote branch', () => {
    const { work, git, mustGit, remoteRef, gateRuns } = setupRepo();
    mustGit(['checkout', '-b', 'other']);
    writeFileSync(join(work, 'other.txt'), 'other\n');
    mustGit(['add', 'other.txt']);
    mustGit(['commit', '-m', 'other commit']);
    mustGit(['checkout', 'main']);

    const push = git(['push', 'origin', 'other']);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toMatch(/refs\/heads\/other .* not HEAD/);
    expect(gateRuns()).toEqual([]);
    expect(remoteRef('other')).toBeNull();
  });

  it('release push of the branch and its annotated tag at HEAD runs the gate once', () => {
    const { bare, git, mustGit, headSha, gateRuns } = setupRepo();
    const head = headSha();
    mustGit(['tag', '-a', 'v1.0.0', '-m', 'release']);
    const push = git(['push', '--atomic', 'origin', 'main', 'v1.0.0']);
    expect(push.status, push.stderr).toBe(0);
    expect(gateRuns()).toEqual(['verify']);
    expect(git(['--git-dir', bare, 'rev-parse', '--verify', 'v1.0.0^{commit}']).stdout.trim()).toBe(head);
    expect(git(['--git-dir', bare, 'rev-parse', '--verify', 'refs/heads/main']).stdout.trim()).toBe(head);
  });

  it('fake pnpm exiting 3 on a clean HEAD push fails the push and leaves remote unchanged', () => {
    const { git, remoteRef, gateRuns } = setupRepo(3);
    const push = git(['push', 'origin', 'main']);
    expect(push.status).not.toBe(0);
    expect(gateRuns()).toEqual(['verify']);
    expect(remoteRef('main')).toBeNull();
  });
});
