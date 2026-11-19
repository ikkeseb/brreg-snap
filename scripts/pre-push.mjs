// Pre-push hook entry point (invoked by .githooks/pre-push).
// Reads git's ref updates on stdin, delegates to scripts/lib/pre-push.mjs,
// and forwards the decision's message and exit code.

import { readFileSync } from 'node:fs';

import { runPrePush } from './lib/pre-push.mjs';

try {
  const result = runPrePush(readFileSync(0, 'utf8'));
  if (result.message) (result.code === 0 ? console.log : console.error)(result.message);
  process.exitCode = result.code;
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`pre-push: could not read ref updates: ${message}`);
  process.exitCode = 1;
}
