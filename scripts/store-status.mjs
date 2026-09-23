// `pnpm store-status [--deep] [--strict]`: what the stores serve right now
// versus what the repo has tagged. Store state is never written down in
// docs; this probe is the source. Public, unauthenticated endpoints only.
// Rules and store quirks: docs/notes/stores.md.
//
//   --deep    download the AMO .xpi and the CWS .crx and compare them file
//             by file with the GitHub Release zips of the served version
//   --strict  exit 1 on unknown rows (endpoint down, no Release) and on a
//             review older than REVIEW_WARN_DAYS, not only on a mismatch
//
// Exit codes: 0 all good (or only unknown/stale without --strict),
// 1 mismatch / package differs (always) or unknown/stale under --strict.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyStore,
  comparePackages,
  compareVersions,
  crxToZip,
  parseAmoAddon,
  parseUpdateCheck,
  readCwsItemId,
  readZip,
} from './store-status-core.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  console.log('usage: pnpm store-status [--deep] [--strict]');
  process.exit(0);
}
for (const a of args) {
  if (!['--deep', '--strict'].includes(a)) {
    console.error(`unknown argument: ${a}`);
    process.exit(2);
  }
}
const deep = args.has('--deep');
const strict = args.has('--strict');

// Any Chrome version at or above the manifest's minimum gets the current
// package; a high value keeps a future minimum_chrome_version bump from
// turning the answer into "noupdate".
const CHROME_PRODVERSION = '999.0';
const TIMEOUT_MS = 30_000;
const USER_AGENT = 'brreg-snap-store-status (+https://github.com/ikkeseb/brreg-snap)';

/** @typedef {import('./store-status-core.mjs').Verdict} Verdict */
/** @type {{ label: string, value: string, status?: string }[]} */
const rows = [];
/** @type {{ label: string, verdict: Verdict }[]} */
const verdicts = [];

/**
 * @param {string} label
 * @param {string} value
 * @param {Verdict} [verdict]
 * @param {string} [detail]
 */
function row(label, value, verdict, detail) {
  rows.push({ label, value, status: verdict && `${verdict}${detail ? `: ${detail}` : ''}` });
  if (verdict) verdicts.push({ label, verdict });
}

/** @param {unknown} e */
const reason = (e) => (e instanceof Error ? (e.cause instanceof Error ? `${e.message} (${e.cause.message})` : e.message) : String(e));

/** @param {string[]} gitArgs */
function git(gitArgs) {
  return execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * @param {string} name
 * @param {string} prefix  the part before the version, e.g. "v"
 * @returns {import('./store-status-core.mjs').TagInfo & { commit: string }}
 */
function tagInfo(name, prefix) {
  const [date, commit] = git(['log', '-1', '--format=%cI %H', `${name}^{commit}`]).split(' ');
  // Annotated tags carry their own date (when the submission happened);
  // lightweight ones fall back to the commit date.
  const tagger = git(['for-each-ref', '--format=%(taggerdate:iso-strict)', `refs/tags/${name}`]);
  return { name, version: name.slice(prefix.length), date: tagger || date, commit };
}

/** @param {string} prefix  e.g. "amo-submission-" */
function latestTag(prefix) {
  const names = git(['tag', '-l', `${prefix}*`]).split('\n')
    .filter((n) => /^\d+(\.\d+)*$/.test(n.slice(prefix.length)));
  if (!names.length) return null;
  names.sort((a, b) => compareVersions(b.slice(prefix.length), a.slice(prefix.length)));
  return tagInfo(names[0], prefix);
}

/**
 * @param {string} url
 * @returns {Promise<Response>}
 */
async function get(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res;
}

/** @param {string} url */
const getBytes = async (url) => new Uint8Array(await (await get(url)).arrayBuffer());

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {string} rel */
const readRepo = (rel) => readFileSync(join(root, rel), 'utf8');

// ---- repo side --------------------------------------------------------

const pkg = JSON.parse(readRepo('package.json'));
const repo = String(pkg.repository?.url ?? '').match(/github\.com\/([^/]+\/[^/.]+)/)?.[1];
const geckoId = JSON.parse(readRepo('public/manifest.firefox.json')).browser_specific_settings.gecko.id;
const cwsId = readCwsItemId(readRepo('docs/cws-submission.md'));

row('package.json', pkg.version);

/** @type {(ReturnType<typeof tagInfo>) | null} */
let vTag = null;
try {
  vTag = tagInfo(git(['describe', '--tags', '--match', 'v*', '--abbrev=0']), 'v');
  row('latest v tag', `${vTag.name} @ ${vTag.commit.slice(0, 7)} (${vTag.date.slice(0, 10)})`);
} catch (e) {
  row('latest v tag', 'unknown', 'unknown', reason(e).split('\n')[0]);
}

/** @type {Record<'amo' | 'cws', ReturnType<typeof latestTag>>} */
const submission = { amo: null, cws: null };
for (const store of /** @type {const} */ (['amo', 'cws'])) {
  try {
    submission[store] = latestTag(`${store}-submission-`);
    const t = submission[store];
    row(`${store}-submission`, t ? `${t.name} @ ${t.commit.slice(0, 7)} (${t.date.slice(0, 10)})` : 'none');
  } catch (e) {
    row(`${store}-submission`, 'unknown', 'unknown', reason(e).split('\n')[0]);
  }
}

const now = new Date();

// ---- AMO --------------------------------------------------------------

/** @type {{ version: string, url: string, hash: string } | null} */
let amoFile = null;
try {
  const amo = parseAmoAddon(await (await get(`https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(geckoId)}/`)).json());
  amoFile = { version: amo.version, url: amo.url, hash: amo.hash };
  const v = classifyStore({ storeVersion: amo.version, latestTag: vTag, submissionTag: submission.amo, now });
  row('AMO version', `${amo.version} (last_updated ${amo.lastUpdated})`, v.verdict, v.detail);
  row('AMO file', `${amo.url} ${amo.hash}`);
  row('AMO users', `${amo.users} average daily; rating ${amo.rating} from ${amo.ratings}`);
} catch (e) {
  row('AMO version', 'unknown', 'unknown', reason(e));
}

// ---- CWS --------------------------------------------------------------

/** @type {{ version: string, url: string, hash: string | null } | null} */
let cwsFile = null;
try {
  const xml = await (await get(
    'https://clients2.google.com/service/update2/crx?response=updatecheck&acceptformat=crx3' +
      `&prodversion=${CHROME_PRODVERSION}&x=${encodeURIComponent(`id=${cwsId}&uc`)}`,
  )).text();
  const uc = parseUpdateCheck(xml);
  if ('error' in uc) throw new Error(uc.error);
  cwsFile = { version: uc.version, url: uc.codebase, hash: uc.sha256 };
  const v = classifyStore({ storeVersion: uc.version, latestTag: vTag, submissionTag: submission.cws, now });
  row('CWS version', uc.version, v.verdict, v.detail);
  row('CWS file', `${uc.codebase} sha256:${uc.sha256 ?? 'not given'}`);
} catch (e) {
  row('CWS version', 'unknown', 'unknown', reason(e));
}

// The listing page is server-rendered; it shows "Updated <date>" and a
// user count only once the item has enough users. Informational: never
// affects the exit code.
try {
  const html = await (await get(`https://chromewebstore.google.com/detail/${cwsId}?hl=en`)).text();
  const updated = html.match(/>Updated<\/div><div>([^<]+)</)?.[1] ?? 'not found';
  const users = html.match(/>([\d,]+\+?) users?</)?.[1] ?? 'not shown';
  row('CWS listing', `updated ${updated}; users ${users}`);
} catch (e) {
  row('CWS listing', `unknown (${reason(e)})`);
}

// ---- deep: package contents vs the GitHub Release ---------------------

/** @type {string[]} */
const deepLines = [];

/**
 * @param {'amo' | 'cws'} store
 * @param {{ version: string, url: string, hash: string | null } | null} file
 */
async function deepCheck(store, file) {
  const label = store.toUpperCase();
  if (!file) {
    row(`${label} contents`, 'unknown', 'unknown', 'store version unknown');
    return;
  }
  const asset = store === 'amo' ? `brreg-snap-${file.version}.zip` : `brreg-snap-chrome-${file.version}.zip`;
  const assetUrl = `https://github.com/${repo}/releases/download/v${file.version}/${asset}`;
  let storeBytes;
  let releaseBytes;
  try {
    storeBytes = await getBytes(file.url);
    releaseBytes = await getBytes(assetUrl);
  } catch (e) {
    row(`${label} contents`, 'unknown', 'unknown', reason(e));
    return;
  }
  const got = sha256(storeBytes);
  const advertised = file.hash?.replace(/^sha256:/, '');
  if (advertised && advertised !== got) {
    row(`${label} contents`, `download sha256 ${got} != advertised ${advertised}`, 'mismatch');
    return;
  }
  let result;
  try {
    const storeFiles = readZip(store === 'cws' ? crxToZip(storeBytes) : storeBytes);
    result = comparePackages(storeFiles, readZip(releaseBytes), store);
  } catch (e) {
    row(`${label} contents`, 'unknown', 'unknown', reason(e));
    return;
  }
  const bad = result.files.filter((f) => f.status !== 'identical');
  row(
    `${label} contents`,
    `${file.version} vs Release v${file.version}/${asset}: ` +
      `${result.files.length - bad.length}/${result.files.length} identical`,
    bad.length ? 'mismatch' : 'ok',
    bad.length ? `${bad.length} file(s) differ or missing, see below` : undefined,
  );
  deepLines.push('', `${label} ${file.version} (${file.url.split('/').pop()}) vs ${asset}`);
  for (const f of result.files) deepLines.push(`  ${f.status.padEnd(16)} ${f.path}${f.note ? `  (${f.note})` : ''}`);
  if (result.ignored.length) deepLines.push(`  ignored (store signing data): ${result.ignored.join(', ')}`);
}

if (deep) {
  await deepCheck('amo', amoFile);
  await deepCheck('cws', cwsFile);
}

// ---- report -----------------------------------------------------------

const w = Math.max(...rows.map((r) => r.label.length));
console.log(`brreg-snap store status, ${now.toISOString()}${deep ? ' (--deep)' : ''}\n`);
for (const r of rows) {
  console.log(`${r.label.padEnd(w)}  ${r.value}`);
  if (r.status) console.log(`${''.padEnd(w)}  -> ${r.status}`);
}
for (const l of deepLines) console.log(l);

const failing = verdicts.filter(({ verdict: v }) =>
  v === 'mismatch' || (strict && (v === 'unknown' || v === 'stale-review')));
const summary = failing.map((f) => `${f.label} ${f.verdict}`).join(', ');
console.log(`\n${failing.length ? `FAIL: ${summary}` : 'OK'}${strict ? ' (--strict)' : ''}`);
process.exitCode = failing.length ? 1 : 0;
