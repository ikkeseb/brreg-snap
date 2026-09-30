// Turns the live canary's vitest JSON report into a markdown list of
// failing tests, for the issue the canary workflow opens or updates.
//
//   node scripts/canary-failures.mjs <vitest-json-report>
//
// Prints the list; under GitHub Actions it also sets the step output
// `failures`. A missing or unreadable report (install failed, vitest
// crashed) still yields a line, so the issue never comes out empty.

import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * @param {string} path
 * @returns {string[]}
 */
function failingTests(path) {
  /** @type {{ testResults?: { name: string, status?: string, message?: string,
   *   assertionResults?: { status: string, ancestorTitles?: string[], title: string }[] }[] }} */
  let report;
  try {
    report = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return ['- (no test report: the run failed before or outside the tests; see the run log)'];
  }
  const lines = [];
  for (const file of report.testResults ?? []) {
    const fileName = basename(file.name);
    const failed = (file.assertionResults ?? []).filter((t) => t.status === 'failed');
    for (const t of failed) {
      lines.push(`- \`${fileName}\` › ${[...(t.ancestorTitles ?? []), t.title].join(' › ')}`);
    }
    // A file that failed without a failing test: import error, hook error.
    if (failed.length === 0 && file.status === 'failed') {
      const first = (file.message ?? '').split('\n')[0];
      lines.push(`- \`${fileName}\` (file failed${first ? `: ${first}` : ''})`);
    }
  }
  return lines.length > 0 ? lines : ['- (the report shows no failing test; see the run log)'];
}

const [path = 'live-results.json'] = process.argv.slice(2);
const list = failingTests(path).join('\n');
console.log(list);

const out = process.env.GITHUB_OUTPUT;
if (out) {
  const delimiter = `EOF_${randomUUID()}`;
  appendFileSync(out, `failures<<${delimiter}\n${list}\n${delimiter}\n`);
}
