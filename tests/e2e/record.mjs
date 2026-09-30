// Re-records tests/e2e/fixtures/ from the live brreg API:
//
//   pnpm build:chrome && pnpm smoke:record
//
// Starts the preview server in live mode, visits every state in
// states.mjs with headless Chromium, and saves each data.brreg.no
// response the page made. Bodies are anonymised and trimmed on the way
// out (rules in fixtures/README.md). The git diff after a re-record is
// the API drift report: review it before committing.
import { spawn } from 'node:child_process';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { normalizeRequest } from '../../scripts/preview/fixtures.mjs';
import { STATES } from './states.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = join(here, 'fixtures');
const serveScript = join(here, '..', '..', 'scripts', 'preview', 'serve.mjs');

const FIRST = ['Kari', 'Ola', 'Ingrid', 'Lars', 'Anne', 'Per', 'Marte', 'Nils'];
const LAST = ['Nordmann', 'Hansen', 'Berg', 'Moe', 'Dahl', 'Lie', 'Strand', 'Bakke'];
const UNDERENHETER_KEPT = 5;

/** Fictitious people, contact data and street addresses, in place. */
function anonymise(node, counter = { n: 0 }) {
  if (Array.isArray(node)) {
    for (const item of node) anonymise(item, counter);
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (node.person && typeof node.person === 'object') {
    const i = counter.n++;
    node.person.navn = { fornavn: FIRST[i % FIRST.length], etternavn: LAST[(i * 3) % LAST.length] };
    if ('fodselsdato' in node.person) node.person.fodselsdato = '1970-01-01';
  }
  if (node.bostyrer && typeof node.bostyrer === 'object') {
    node.bostyrer.navn = 'Adv. Ola Nordmann';
  }
  // An ENK's name and orgnr lead straight to its owner.
  if (node.organisasjonsnummer && node.organisasjonsform?.kode === 'ENK') {
    node.organisasjonsnummer = '999999999';
    node.navn = Array.isArray(node.navn) ? ['EKSEMPEL ENK'] : 'EKSEMPEL ENK';
    if ('historiskeNavn' in node) node.historiskeNavn = [];
    // Keep the host (scoring reads it); a path can carry the name.
    if (typeof node.hjemmeside === 'string' && node.hjemmeside.includes('/')) {
      node.hjemmeside = node.hjemmeside.split('/')[0] + '/eksempel';
    }
    for (const text of ['aktivitet', 'vedtektsfestetFormaal']) {
      if (text in node) node[text] = ['Eksempelaktivitet.'];
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'epostadresse') node[key] = 'post@example.no';
    else if (key === 'telefon' || key === 'mobil') node[key] = '00000000';
    else if (key === 'adresse' && Array.isArray(value)) node[key] = ['Eksempelveien 1'];
    else anonymise(value, counter);
  }
}

/** Drops the hypermedia `_links` the extension never reads. */
function dropLinks(node) {
  if (!node || typeof node !== 'object') return;
  if (!Array.isArray(node)) delete node._links;
  for (const value of Object.values(node)) dropLinks(value);
}

/**
 * Keeps a few underenheter per page (`page.totalElements` stays real),
 * drops `_links`, and pins per-call noise in error bodies so a
 * re-record diffs clean.
 */
function trim(body) {
  dropLinks(body);
  if (body && typeof body === 'object' && 'trace' in body) {
    body.timestamp = '2026-01-01T00:00:00.000+0000';
    body.trace = 'recorded';
  }
  const list = body?._embedded?.underenheter;
  if (Array.isArray(list)) body._embedded.underenheter = list.slice(0, UNDERENHETER_KEPT);
}

function fileName(request) {
  const slug = request
    .replace(/^\/(enhetsregisteret\/api|regnskapsregisteret)\//, '')
    .replace(/%2C/gi, ',')
    .replace(/[^A-Za-z0-9.,=-]+/g, '_');
  return slug.slice(0, 160) + '.json';
}

async function startServer() {
  const child = spawn(process.execPath, [serveScript, '--port', '0'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const origin = await new Promise((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`serve.mjs exited ${code}`)));
    child.stdout.on('data', (chunk) => {
      const m = /http:\/\/127\.0\.0\.1:\d+/.exec(String(chunk));
      if (m) resolve(m[0]);
    });
  });
  return { origin, stop: () => child.kill() };
}

const server = await startServer();
const browser = await chromium.launch();
// The browser only discovers which requests each state makes; Node
// fetches the bodies (the page may never read an error body).
/** @type {Set<string>} */
const requests = new Set();
try {
  for (const s of STATES) {
    if (s.offline) continue;
    const page = await browser.newPage();
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.pathname.startsWith('/brreg/')) {
        requests.add(url.pathname.slice('/brreg'.length) + url.search);
      }
    });
    await page.goto(server.origin + s.path);
    await page.locator('main#app:not([data-state="loading"])').waitFor();
    await page.waitForLoadState('networkidle');
    for (const a of s.actions ?? []) {
      // The load state is sticky: 'networkidle' resolves at once when
      // the page was already idle, so wait for the action's first
      // request instead, then for the page to settle again.
      const first = page.waitForRequest((r) => r.url().includes('/brreg/'), { timeout: 5000 }).catch(() => {});
      if (a.type === 'click') await page.click(a.selector);
      else await page.fill(a.selector, a.text ?? '');
      await first;
      await page.locator('main#app:not([data-state="loading"])').waitFor();
      await page.waitForTimeout(1500);
    }
    const state = await page.locator('main#app').getAttribute('data-state');
    console.log(`${s.name}: ${state}${state === s.state ? '' : ` (expected ${s.state})`}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.stop();
}

for (const name of await readdir(outDir)) {
  if (name.endsWith('.json')) await rm(join(outDir, name));
}
// One fixture per normalised request: the change feed's `dato=` differs
// per load, so the file is keyed on the placeholder form and fetched
// with the first value seen.
/** @type {Map<string, string>} */
const byKey = new Map();
for (const request of [...requests].sort()) {
  const key = normalizeRequest(request);
  if (!byKey.has(key)) byKey.set(key, request);
}
for (const [key, request] of [...byKey].sort()) {
  const resp = await fetch('https://data.brreg.no' + request, {
    headers: { accept: 'application/json' },
  });
  const status = resp.status;
  const text = await resp.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // non-JSON body: keep the string
  }
  anonymise(body);
  trim(body);
  const file = fileName(key);
  await writeFile(join(outDir, file), JSON.stringify({ request: key, status, body }, null, 2) + '\n');
  console.log(`  ${status} ${file}`);
}
