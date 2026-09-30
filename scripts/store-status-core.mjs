// Pure logic behind scripts/store-status.mjs: version rules, store
// response parsing, CRX/zip reading and the package comparison. No
// network, no git, no process state, so tests/store-status.test.ts can
// feed it recorded responses. See docs/notes/stores.md.

import { Buffer } from 'node:buffer';
import { inflateRawSync } from 'node:zlib';

/** A submission older than this without the store serving it is a warning. */
export const REVIEW_WARN_DAYS = 14;

/**
 * @param {string} v  dotted numeric version, e.g. "1.3.1"
 * @returns {number[]}
 */
export function parseVersion(v) {
  if (!/^\d+(\.\d+)*$/.test(v)) throw new Error(`not a dotted version: ${v}`);
  return v.split('.').map(Number);
}

/**
 * Numeric dotted-version compare; missing parts count as 0 (1.3 == 1.3.0).
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1}
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * @typedef {{ name: string, version: string, date: string }} TagInfo
 *   `date` is ISO 8601 (the tagger date for annotated tags).
 * @typedef {'ok' | 'in-review' | 'stale-review' | 'mismatch' | 'unknown'} Verdict
 */

/**
 * The mismatch rules for one store:
 * - store serves the latest v* tag                    -> ok
 * - store serves something older than the latest
 *   `<store>-submission-*` tag                        -> in review since the
 *   submission tag's date (stale-review after REVIEW_WARN_DAYS)
 * - anything else                                     -> mismatch
 * An unknown store version (endpoint down) or missing v tag -> unknown.
 *
 * @param {{ storeVersion: string | null, latestTag: TagInfo | null,
 *   submissionTag: TagInfo | null, now: Date }} input
 * @returns {{ verdict: Verdict, detail: string }}
 */
export function classifyStore({ storeVersion, latestTag, submissionTag, now }) {
  if (!storeVersion) return { verdict: 'unknown', detail: 'store did not answer' };
  if (!latestTag) return { verdict: 'unknown', detail: 'no v* tag in this checkout' };
  if (compareVersions(storeVersion, latestTag.version) === 0) {
    return { verdict: 'ok', detail: `serves ${latestTag.name}` };
  }
  if (submissionTag && compareVersions(storeVersion, submissionTag.version) < 0) {
    const days = Math.floor((now.getTime() - Date.parse(submissionTag.date)) / 86_400_000);
    const since = `${submissionTag.name} in review since ${submissionTag.date.slice(0, 10)} (${days} d)`;
    return days > REVIEW_WARN_DAYS
      ? { verdict: 'stale-review', detail: `${since}, over ${REVIEW_WARN_DAYS} d` }
      : { verdict: 'in-review', detail: since };
  }
  return {
    verdict: 'mismatch',
    detail: `serves ${storeVersion}, latest tag ${latestTag.name}` +
      (submissionTag ? `, latest submission ${submissionTag.name}` : ', no submission tag'),
  };
}

/**
 * The fields the probe reads from AMO's public add-on detail
 * (GET /api/v5/addons/addon/<guid or slug>/).
 * @param {any} addon
 * @returns {{ version: string, lastUpdated: string, url: string, hash: string,
 *   users: number, rating: number, ratings: number }}
 */
export function parseAmoAddon(addon) {
  const cv = addon?.current_version;
  if (typeof cv?.version !== 'string' || typeof cv.file?.url !== 'string') {
    throw new Error('AMO response has no current_version.file');
  }
  return {
    version: cv.version,
    lastUpdated: String(addon.last_updated),
    url: cv.file.url,
    hash: String(cv.file.hash),
    users: Number(addon.average_daily_users),
    rating: Number(addon.ratings?.average),
    ratings: Number(addon.ratings?.count),
  };
}

/**
 * Parse the Chrome update-check (gupdate protocol 2.0) XML for one app.
 * Regex, not a DOM: the response is a few flat, machine-generated
 * elements. An unknown id answers `<app status="error-unknownApplication"/>`
 * with no <updatecheck>.
 * @param {string} xml
 * @returns {{ version: string, codebase: string, sha256: string | null,
 *   size: number | null } | { error: string }}
 */
export function parseUpdateCheck(xml) {
  const app = attributes(xml, 'app');
  if (!app) return { error: 'no <app> in the update-check response' };
  if (app.status !== 'ok') return { error: `app status ${app.status}` };
  const uc = attributes(xml, 'updatecheck');
  if (!uc) return { error: 'no <updatecheck> in the update-check response' };
  if (uc.status !== 'ok' || !uc.version || !uc.codebase) {
    return { error: `updatecheck status ${uc.status ?? 'missing'}` };
  }
  return {
    version: uc.version,
    codebase: uc.codebase,
    sha256: uc.hash_sha256 ?? null,
    size: uc.size ? Number(uc.size) : null,
  };
}

/**
 * @param {string} xml
 * @param {string} element
 * @returns {Record<string, string> | null}
 */
function attributes(xml, element) {
  const tag = xml.match(new RegExp(`<${element}\\b([^>]*?)/?>`));
  if (!tag) return null;
  /** @type {Record<string, string>} */
  const attrs = {};
  for (const m of tag[1].matchAll(/([\w:]+)="([^"]*)"/g)) attrs[m[1]] = m[2].replace(/&amp;/g, '&');
  return attrs;
}

/**
 * Strip a CRX3 header and return the embedded zip. Format (Chromium
 * components/crx_file): "Cr24" magic, uint32 LE version (3), uint32 LE
 * header length, the protobuf header, then the zip archive.
 * @param {Uint8Array} bytes
 * @returns {Buffer}
 */
export function crxToZip(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.toString('latin1', 0, 4) !== 'Cr24') throw new Error('not a CRX (no Cr24 magic)');
  const version = buf.readUInt32LE(4);
  if (version !== 3) throw new Error(`unsupported CRX version ${version}`);
  return buf.subarray(12 + buf.readUInt32LE(8));
}

/**
 * Minimal zip reader (stored + deflate, no zip64, no encryption): enough
 * for web-ext, AMO and CWS packages. Directory entries are skipped.
 * @param {Uint8Array} bytes
 * @returns {Map<string, Buffer>}
 */
export function readZip(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error(`encrypted zip entry: ${name}`);
    if (compSize === 0xffffffff || local === 0xffffffff) throw new Error('zip64 not supported');
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`corrupt local header: ${name}`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compSize);
    if (method === 0) files.set(name, Buffer.from(raw));
    else if (method === 8) files.set(name, inflateRawSync(raw));
    else throw new Error(`unsupported zip method ${method}: ${name}`);
  }
  return files;
}

/**
 * Keys the stores add to manifest.json that the repo never ships
 * (observed live 2026-09-24, see docs/notes/stores.md § store-package-changes):
 * AMO adds none (it only re-serialises), CWS adds `update_url`. Only
 * removed when absent from the release manifest, so a key we ship is
 * still compared.
 * @type {Record<'amo' | 'cws', string[]>}
 */
export const STORE_ADDED_MANIFEST_KEYS = {
  amo: [],
  cws: ['update_url'],
};

/**
 * Parse a manifest and drop the keys the store adds, so the result can
 * be compared as data (AMO re-serialises the file, so bytes never match).
 * @param {Buffer | string} storeBytes
 * @param {Buffer | string} releaseBytes
 * @param {'amo' | 'cws'} store
 * @returns {{ store: unknown, release: unknown, added: string[] }}
 */
export function normalizeManifests(storeBytes, releaseBytes, store) {
  /** @type {Record<string, unknown>} */
  const s = JSON.parse(stripBom(storeBytes.toString()));
  /** @type {Record<string, unknown>} */
  const r = JSON.parse(stripBom(releaseBytes.toString()));
  const added = [];
  for (const key of STORE_ADDED_MANIFEST_KEYS[store]) {
    if (key in s && !(key in r)) {
      delete s[key];
      added.push(key);
    }
  }
  return { store: s, release: r, added };
}

/** @param {string} s */
function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Deep equality for parsed JSON; object key order ignored, array order kept.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function jsonEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return jsonEqual(ka, kb) &&
    ka.every((k) => jsonEqual(/** @type {any} */ (a)[k], /** @type {any} */ (b)[k]));
}

/** Store-only paths that are signing/verification data, never our code. */
const IGNORED_STORE_PATHS = /^(META-INF\/|_metadata\/)/;

/**
 * @typedef {{ path: string, status: 'identical' | 'differs' | 'missing in store'
 *   | 'extra in store', note?: string }} FileResult
 */

/**
 * Compare a store package with the GitHub Release zip it should equal.
 * @param {Map<string, Buffer>} storeFiles
 * @param {Map<string, Buffer>} releaseFiles
 * @param {'amo' | 'cws'} store
 * @returns {{ files: FileResult[], ignored: string[] }}
 */
export function comparePackages(storeFiles, releaseFiles, store) {
  /** @type {FileResult[]} */
  const files = [];
  const ignored = [];
  const paths = [...new Set([...storeFiles.keys(), ...releaseFiles.keys()])].sort();
  for (const path of paths) {
    const s = storeFiles.get(path);
    const r = releaseFiles.get(path);
    if (!r && IGNORED_STORE_PATHS.test(path)) { ignored.push(path); continue; }
    if (!s) { files.push({ path, status: 'missing in store' }); continue; }
    if (!r) { files.push({ path, status: 'extra in store' }); continue; }
    if (path === 'manifest.json') {
      let same;
      let note;
      try {
        const m = normalizeManifests(s, r, store);
        same = jsonEqual(m.store, m.release);
        note = m.added.length ? `as JSON, store-added keys ignored: ${m.added.join(', ')}` : 'as JSON';
      } catch (e) {
        same = false;
        note = `unparseable: ${e instanceof Error ? e.message : String(e)}`;
      }
      files.push({ path, status: same ? 'identical' : 'differs', note });
      continue;
    }
    if (s.equals(r)) { files.push({ path, status: 'identical' }); continue; }
    const crlfOnly = lf(s).equals(lf(r));
    files.push({ path, status: 'differs', ...(crlfOnly && { note: 'line endings only (CRLF build)' }) });
  }
  return { files, ignored };
}

/**
 * CRLF -> LF, to name a Windows-checkout build as the cause of a diff.
 * @param {Buffer} b
 */
function lf(b) {
  return Buffer.from(b.toString('latin1').replace(/\r+\n/g, '\n'), 'latin1');
}

/**
 * The CWS item id lives once, in docs/cws-submission.md under the
 * `<!-- SECTION: item-id -->` anchor. Ids are 32 letters a-p.
 * @param {string} markdown
 * @returns {string}
 */
export function readCwsItemId(markdown) {
  const at = markdown.indexOf('<!-- SECTION: item-id -->');
  if (at < 0) throw new Error('docs/cws-submission.md has no "SECTION: item-id" anchor');
  const m = markdown.slice(at).match(/`([a-p]{32})`/);
  if (!m) throw new Error('no 32-letter CWS item id in backticks after the item-id anchor');
  return m[1];
}
