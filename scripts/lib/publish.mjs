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
 *   Promise<{ ok: boolean, status: number, text: () => Promise<string> }>} Fetch
 */

/**
 * One HTTP call; JSON response, or an error that carries the status and
 * the response body (store APIs explain rejections there).
 * @param {Fetch} fetch
 * @param {string} method
 * @param {string} url
 * @param {{ headers?: Record<string, string>, body?: any }} [init]
 */
export async function call(fetch, method, url, init = {}) {
  const res = await fetch(url, { method, headers: init.headers ?? {}, body: init.body });
  const text = await res.text();
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
