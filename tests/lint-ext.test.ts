import { describe, expect, it } from 'vitest';

import { judgeLint } from '../scripts/lint-ext-judge.mjs';

// The pass/fail decision of `pnpm lint:ext`, fed fake spawnSync results.
// It must fail closed: a validator that did not run to a clean exit
// passes nothing, whatever its stdout looks like.

const report = (r: Record<string, unknown>): string => JSON.stringify(r);
const clean = report({ errors: [], warnings: [], notices: [] });
const run = (over: Record<string, unknown>) => ({
  status: 0,
  signal: null,
  stdout: clean,
  stderr: '',
  ...over,
});
const allowedWarning = { code: 'KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION', message: 'm' };

describe('lint:ext decision', () => {
  it('passes a clean run', () => {
    expect(judgeLint(run({})).ok).toBe(true);
  });

  it('passes a clean run with an allowed warning', () => {
    const r = judgeLint(run({ stdout: report({ errors: [], warnings: [allowedWarning] }) }));
    expect(r.ok).toBe(true);
    expect(r.summary).toContain('1 allowed warnings');
  });

  it.each([
    ['a spawn error', { error: new Error('ENOENT'), status: null, stdout: '' }, 'could not run'],
    ['a signal', { signal: 'SIGKILL', status: null, stdout: clean }, 'SIGKILL'],
    ['a non-zero status with a clean-looking report', { status: 1 }, 'status 1'],
    ['a non-zero status with an empty report', { status: 1, stdout: '{}' }, 'status 1'],
    ['no JSON', { stdout: 'not json' }, 'no JSON report'],
    ['JSON that is not a report', { stdout: 'null' }, 'no JSON report'],
    ['a report without arrays', { stdout: '{}' }, 'errors and warnings arrays'],
    ['a report with non-array errors', { stdout: report({ errors: 0, warnings: [] }) }, 'errors and warnings arrays'],
    ['an error', { status: 1, stdout: report({ errors: [{ code: 'E', message: 'bad' }], warnings: [] }) }, 'E'],
    ['an unlisted warning', { stdout: report({ errors: [], warnings: [{ code: 'NEW_WARNING', message: 'w' }] }) }, 'NEW_WARNING'],
  ])('fails on %s', (_name, over, text) => {
    const r = judgeLint(run(over));
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toContain(text);
  });
});
