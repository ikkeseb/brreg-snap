// The pass/fail decision behind `pnpm lint:ext` (scripts/lint-ext.mjs),
// split out so tests/lint-ext.test.ts can feed it fake spawn results.
// Fails closed: a web-ext run that did not start, was killed or exited
// non-zero fails even when its stdout parses as a clean report.

// Expected since strict_min_version stays 115 (plan Decisions: Firefox
// data consent) while data_collection_permissions needs Firefox 140 /
// Firefox for Android 142. Older versions ignore the key.
export const ALLOWED_WARNINGS = [
  'KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION',
  'KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION',
];

const line = (kind, m) => `${kind} ${m?.code} ${m?.file ?? ''}: ${m?.message}`;

/**
 * @param {{ error?: Error, signal?: string | null, status: number | null,
 *   stdout?: string | null, stderr?: string | null }} run spawnSync result
 * @param {string[]} [allowed] warning codes that don't fail the lint
 * @returns {{ ok: boolean, problems: string[], summary?: string }}
 */
export function judgeLint(run, allowed = ALLOWED_WARNINGS) {
  if (run.error) return { ok: false, problems: [`could not run web-ext: ${run.error.message}`] };
  if (run.signal) return { ok: false, problems: [`web-ext lint was killed by ${run.signal}`] };

  const problems = [];
  if (run.status !== 0) problems.push(`web-ext lint exited with status ${run.status}`);

  let report;
  try {
    report = JSON.parse(run.stdout ?? '');
  } catch {
    report = undefined;
  }
  if (report === null || typeof report !== 'object') {
    const raw = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
    problems.push('web-ext lint produced no JSON report (run build:firefox first?)');
    if (raw) problems.push(raw);
    return { ok: false, problems };
  }
  if (!Array.isArray(report.errors) || !Array.isArray(report.warnings)) {
    problems.push('the web-ext report has no errors and warnings arrays');
    return { ok: false, problems };
  }

  const unexpected = report.warnings.filter((w) => !allowed.includes(w?.code));
  problems.push(...report.errors.map((e) => line('error', e)));
  problems.push(...unexpected.map((w) => line('warning', w)));
  if (run.status !== 0 && run.stderr?.trim()) problems.push(run.stderr.trim());

  const notices = Array.isArray(report.notices) ? report.notices.length : 0;
  const summary =
    `web-ext lint: ${report.errors.length} errors, ${unexpected.length} unexpected warnings, ` +
    `${report.warnings.length - unexpected.length} allowed warnings, ${notices} notices`;
  return { ok: problems.length === 0, problems, summary };
}
