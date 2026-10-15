// Shared by the store publishers (scripts/lib/amo.mjs, scripts/lib/cws.mjs):
// JWT signing with node:crypto, one fetch wrapper, GitHub Actions output.
// Nothing here logs a credential: tokens only ever go into headers.
import { createHash, createHmac, createSign, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';

/** @param {string | Buffer} v */
export const b64url = (v) => Buffer.from(v).toString('base64url');

/** @param {Uint8Array} bytes */
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * @param {Record<string, unknown>} payload
 * @param {string} secret
 */
export function signHs256(payload, secret) {
  const input = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} privateKeyPem
 */
export function signRs256(payload, privateKeyPem) {
  const input = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  return `${input}.${createSign('RSA-SHA256').update(input).sign(privateKeyPem, 'base64url')}`;
}

export const newJti = () => randomUUID();

/**
 * @typedef {(url: string, init: { method: string, headers: Record<string, string>, body?: any }) =>
 *   Promise<{ ok: boolean, status: number, text: () => Promise<string>,
 *     headers?: { get: (name: string) => string | null } }>} Fetch
 */

/** A throttled request (HTTP 429) waits and retries at most this often. */
export const THROTTLE_RETRIES = 3;
/** The longest wait a 429 may name before the call gives up instead. */
export const THROTTLE_MAX_S = 120;
/** The wait when a 429 names none. */
export const THROTTLE_DEFAULT_S = 30;

/**
 * The wait in seconds a 429 names: the `Retry-After` header
 * (delta-seconds or an HTTP-date), else AMO's body text
 * «Expected available in N seconds»; null when it names none.
 * @param {string | null | undefined} retryAfter
 * @param {string} body
 * @param {number} nowMs
 */
export function throttleDelay(retryAfter, body, nowMs) {
  const header = retryAfter?.trim();
  if (header) {
    if (/^\d+$/.test(header)) return Number(header);
    const at = Date.parse(header);
    if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - nowMs) / 1000));
  }
  const m = /Expected available in (\d+) seconds?/i.exec(body);
  return m ? Number(m[1]) : null;
}

/**
 * One HTTP call; JSON response, or an error that carries the status and
 * the response body (store APIs explain rejections there). A throttled
 * request (HTTP 429) is sent again after the wait the store names, up to
 * THROTTLE_RETRIES times and never for a wait over THROTTLE_MAX_S. A 429
 * means the request was not processed, so a retried POST/PATCH is safe;
 * every body the publishers send (string, bytes, FormData of Files) can
 * be sent twice. `headers` may be a function, called per attempt, so a
 * retry carries a fresh JWT.
 * @param {Fetch} fetch
 * @param {string} method
 * @param {string} url
 * @param {{ headers?: Record<string, string> | (() => Record<string, string>), body?: any,
 *   sleep?: (ms: number) => Promise<void>, now?: () => number }} [init]
 */
export async function call(fetch, method, url, init = {}) {
  const wait = init.sleep ?? sleep;
  const now = init.now ?? Date.now;
  let res;
  let text;
  for (let attempt = 0; ; attempt++) {
    const headers = typeof init.headers === 'function' ? init.headers() : (init.headers ?? {});
    res = await fetch(url, { method, headers, body: init.body });
    text = await res.text();
    if (res.status !== 429 || attempt === THROTTLE_RETRIES) break;
    const named = throttleDelay(res.headers?.get('retry-after'), text, now());
    const seconds = named ?? THROTTLE_DEFAULT_S;
    if (seconds > THROTTLE_MAX_S) break;
    notice(`${method} ${url} throttled (HTTP 429): retrying in ${seconds} s (${attempt + 1}/${THROTTLE_RETRIES})`);
    await wait(seconds * 1000);
  }
  if (!res.ok) {
    throw new Error(`${method} ${url} -> HTTP ${res.status}\n${text.slice(0, 4000)}`);
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${method} ${url} -> HTTP ${res.status}, not JSON:\n${text.slice(0, 500)}`);
  }
}

/** Step outputs for the workflow (no-op outside GitHub Actions). */
export function setOutputs(/** @type {Record<string, string>} */ values) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  appendFileSync(file, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(''));
}

/** A notice that shows on the Actions run page, or a plain line locally. */
export function notice(/** @type {string} */ msg) {
  console.log(process.env.GITHUB_ACTIONS ? `::notice::${msg}` : `NOTICE ${msg}`);
}

/** @param {number} ms */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Indent a multi-line value under a plan line. */
export const indent = (/** @type {string} */ s, n = 6) => s.replace(/^/gm, ' '.repeat(n));

/**
 * A line diff of `a` → `b` (longest common subsequence): each line
 * prefixed `-` (only in a), `+` (only in b) or ` ` (both). Small texts
 * only: it is O(lines²).
 * @param {string} a
 * @param {string} b
 * @returns {string[]}
 */
export function diffLines(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  /** @type {number[][]} */
  const lcs = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      out.push(` ${x[i++]}`);
      j++;
    } else if (i < x.length && (j === y.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      out.push(`-${x[i++]}`);
    } else {
      out.push(`+${y[j++]}`);
    }
  }
  return out;
}
