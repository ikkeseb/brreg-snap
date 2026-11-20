// Logic for the pre-push hook (scripts/pre-push.mjs, invoked by .githooks/pre-push).
// Gates refs that peel to a clean HEAD so `pnpm verify:fast` checks the commit actually
// being pushed; the full `pnpm verify` is CI's. Git supplies updates on stdin; deletions need no gate and remote
// arguments are unused.

import { spawnSync } from 'node:child_process';

/**
 * @typedef {{ action: 'nothing', message: string }
 *   | { action: 'refuse', message: string }
 *   | { action: 'gate', message?: undefined }} PushDecision
 */

/**
 * @typedef {{
 *   status: number | null,
 *   stdout?: string,
 *   error?: Error,
 *   signal?: NodeJS.Signals | null,
 * }} RunResult
 */

/**
 * @typedef {(command: string, args: readonly string[], options: Record<string, unknown>) => RunResult} Runner
 */

/**
 * @typedef {{ code: number, message?: string }} PrePushResult
 */

/** @param {string} stdin */
function pushedRefs(stdin) {
  const validSha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
  const refs = stdin
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter(Boolean)
    .map((line) => line.split(' '));
  for (const fields of refs) {
    const isDelete = fields[0] === '(delete)';
    const isZero = /^0+$/.test(fields[1] ?? '');
    if (
      fields.length !== 4 ||
      !fields[0] ||
      !fields[2] ||
      !validSha.test(fields[1]) ||
      !validSha.test(fields[3]) ||
      isDelete !== isZero
    ) {
      throw new Error(`invalid ref update: ${fields.join(' ')}`);
    }
  }
  return refs.filter((fields) => fields[0] !== '(delete)');
}

/**
 * @param {string} reason
 * @returns {{ action: 'refuse', message: string }}
 */
function refusal(reason) {
  return { action: 'refuse', message: `pre-push: ${reason}\nPush each ref from a clean checkout of its commit.` };
}

/**
 * Decide whether the push described on stdin should skip the gate, be refused,
 * or run the gate. Tests supply HEAD, status, ls-files -v output and a peel
 * function without starting git.
 * @param {string} stdin
 * @param {string} head
 * @param {(sha: string) => string} peel
 * @param {string} status
 * @param {string} [lsFiles]
 * @returns {PushDecision}
 */
export function decidePush(stdin, head, peel, status, lsFiles = '') {
  let refs;
  try {
    refs = pushedRefs(stdin);
  } catch (e) {
    return refusal(e instanceof Error ? e.message : String(e));
  }
  if (refs.length === 0) return { action: 'nothing', message: 'pre-push: nothing is pushed that needs the gate.' };
  for (const fields of refs) {
    const [ref, sha] = fields;
    let commit;
    try {
      commit = peel(sha);
    } catch {
      return refusal(`${ref} (${sha}) could not be peeled to a commit.`);
    }
    if (!commit) return refusal(`${ref} (${sha}) could not be peeled to a commit.`);
    if (commit !== head) return refusal(`${ref} (${sha}) points to commit ${commit}, not HEAD ${head}.`);
  }
  const dirty = status.split(/\r?\n/).filter(Boolean);
  if (dirty.length) {
    const more = dirty.length > 5 ? `\n... ${dirty.length - 5} more status lines` : '';
    return refusal(`working tree or index is not clean:\n${dirty.slice(0, 5).join('\n')}${more}`);
  }
  // git status cannot see edits to these, so the gate cannot vouch for them
  // even when they happen to be unchanged: refuse rather than guess.
  const hidden = lsFiles
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => /^[a-zS] /.test(line))
    .map((line) => line.slice(2));
  if (hidden.length) {
    const more = hidden.length > 5 ? `\n... ${hidden.length - 5} more paths` : '';
    return refusal(
      `tracked files marked assume-unchanged or skip-worktree, whose edits git status cannot see:\n` +
        `${hidden.slice(0, 5).join('\n')}${more}\n` +
        'Clear the marks (git update-index --no-assume-unchanged / --no-skip-worktree <path>) to push through the gate.',
    );
  }
  return { action: 'gate' };
}

/**
 * Run git checks against stdin ref updates and invoke `pnpm verify:fast` when gated.
 * Tests inject subprocess results; the installed hook uses spawnSync.
 * @param {string} stdin
 * @param {Runner} [run]
 * @returns {PrePushResult}
 */
export function runPrePush(stdin, run = spawnSync) {
  try {
    let decision;
    if (pushedRefs(stdin).length === 0) {
      decision = decidePush(stdin, '', () => '', '', '');
    } else {
      /** @param {string[]} args */
      const git = (args) => {
        const result = run('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
        if (result.error || result.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
        return result.stdout ?? '';
      };
      const head = git(['rev-parse', 'HEAD']).trim();
      const status = git(['status', '--porcelain', '--untracked-files=all']);
      const lsFiles = git(['ls-files', '-v']);
      decision = decidePush(
        stdin,
        head,
        (sha) => git(['rev-parse', '--verify', `${sha}^{commit}`]).trim(),
        status,
        lsFiles,
      );
    }
    if (decision.action !== 'gate') return { code: decision.action === 'nothing' ? 0 : 1, message: decision.message };
    // One command string through the shell: `.cmd` shims need it on Windows, and Node 24 warns
    // (DEP0190) when an argument list goes through one.
    const result = run('pnpm verify:fast', [], { stdio: 'inherit', shell: true });
    if (result.error) return { code: 1, message: `pre-push: could not start pnpm verify:fast: ${result.error.message}` };
    return { code: result.status ?? 1 };
  } catch (e) {
    return { code: 1, message: refusal(e instanceof Error ? e.message : String(e)).message };
  }
}
