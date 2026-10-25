import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const wrapper = readFileSync('.githooks/public-hygiene.sh', 'utf8');
let root: string;
let env: NodeJS.ProcessEnv;
function run(cwd: string, command: string, args: string[]) {
  // Git finds its bundled shell on Windows even when sh is absent from PATH.
  const result = command === 'sh'
    ? spawnSync('git', ['-c', 'alias.test-shell=!sh', 'test-shell', ...args], { cwd, env, encoding: 'utf8' })
    : spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  expect(result.error).toBeUndefined();
  return result;
}
function git(cwd: string, ...args: string[]) {
  const result = run(cwd, 'git', args);
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}
function init(name: string, separate = false) {
  const tree = join(root, name);
  git(root, 'init', '-q', ...(separate ? ['--separate-git-dir', join(root, `${name}-metadata`)] : []), tree);
  git(tree, 'config', 'user.name', 'Tester');
  git(tree, 'config', 'user.email', 'test@example.invalid');
  git(tree, 'config', 'commit.gpgsign', 'false');
  git(tree, 'config', 'core.hooksPath', '/dev/null');
  git(tree, 'commit', '-q', '--allow-empty', '-m', 'baseline');
  return tree;
}
function install(tree: string) {
  const hooks = join(tree, 'maintainer/hooks');
  mkdirSync(hooks, { recursive: true });
  // A distinct exit code proves dispatch, independent of the private check.
  writeFileSync(join(hooks, 'check.sh'), '#!/bin/bash\nprintf "dispatched:%s:%s\\n" "$1" "$2"\nexit 23\n');
}
function check(tree: string) {
  return run(tree, 'sh', [join(root, 'wrapper.sh'), 'msg', 'message-file']);
}
function dispatched(tree: string) {
  const result = check(tree);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe('dispatched:msg:message-file\n');
  expect(result.status).toBe(23);
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hygiene-wrapper-'));
  env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  writeFileSync(join(root, 'wrapper.sh'), wrapper);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('optional maintainer hook discovery', () => {
  it('silently skips absent setup and warns about an incomplete setup', () => {
    const tree = init('ordinary');
    expect(check(tree).status).toBe(0);
    expect(check(tree).stderr).toBe('');
    mkdirSync(join(tree, 'maintainer'));
    expect(check(tree).status).toBe(0);
    expect(check(tree).stderr).toContain('check is missing');
  });
  it('dispatches from the main checkout and a linked worktree', () => {
    const tree = init('main tree');
    install(tree);
    const linked = join(root, 'linked tree');
    git(tree, 'worktree', 'add', '-q', '-b', 'linked', linked);
    dispatched(tree);
    dispatched(linked);
  });
  it.skipIf(process.platform === 'win32').each(['main\ncheckout', 'main\n'])(
    'preserves newlines in the main checkout path: %j',
    (name) => {
      // Windows filenames cannot contain LF; POSIX linked worktrees can.
      const tree = init(name);
      install(tree);
      const linked = join(root, 'linked');
      git(tree, 'worktree', 'add', '-q', '-b', 'linked', linked);
      dispatched(tree);
      dispatched(linked);
    },
  );
  it('dispatches from a checkout with a separate git directory', () => {
    const tree = init('separate tree', true);
    install(tree);
    dispatched(tree);
  });
  it('dispatches from a submodule checkout', () => {
    const source = init('source');
    const parent = init('parent');
    git(parent, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'child');
    const child = join(parent, 'child');
    install(child);
    dispatched(child);
  });
  it('supports Git without the path-format option in both worktrees', () => {
    const tree = init('legacy');
    install(tree);
    const linked = join(root, 'legacy linked');
    git(tree, 'worktree', 'add', '-q', '-b', 'linked', linked);
    const realGit = run(root, 'sh', ['-c', 'command -v git']).stdout.trim();
    expect(realGit).toBeTruthy();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'git'), `#!/bin/sh\nif [ "$1" = rev-parse ] && [ "$2" = --path-format=absolute ]; then\n  printf '%s\\n' --path-format=absolute .git\n  exit 0\nfi\nexec "$REAL_GIT" "$@"\n`);
    chmodSync(join(bin, 'git'), 0o755);
    env.REAL_GIT = realGit;
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
    env[pathKey] = `${bin}${delimiter}${env[pathKey] ?? ''}`;
    dispatched(tree);
    dispatched(linked);
  });
  it('warns when repository discovery fails', () => {
    const result = check(root);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('cannot locate the repository metadata');
  });
  it('warns for a linked tree whose separate main checkout Git cannot locate', () => {
    const tree = init('separate', true);
    install(tree);
    const linked = join(root, 'separate linked');
    git(tree, 'worktree', 'add', '-q', '-b', 'linked', linked);
    const result = check(linked);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('warning:');
  });
});
