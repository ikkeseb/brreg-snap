// AMO submission through the addons.mozilla.org API v5, with the exact
// bytes of the GitHub Release assets:
//
//   1. POST upload/                    multipart: upload=<package zip>, channel=listed
//   2. GET  upload/<uuid>/             poll until processed; stop unless valid
//   3. POST addon/<guid>/versions/     JSON: upload, release_notes {nb-NO, en-US}, approval_notes
//   4. PATCH addon/<guid>/versions/<id>/  multipart: source=<source zip>
//
// Step 4 is separate because the API takes the source file only as
// multipart form data, and release_notes (an object) only as JSON
// (docs: https://mozilla.github.io/addons-server/topics/api/addons.html
// § Version Sources). Every request carries a fresh JWT (HS256,
// iss/jti/iat/exp, exp = iat + 60 s):
// https://mozilla.github.io/addons-server/topics/api/auth.html
import { File } from 'node:buffer';

import { call, indent, newJti, notice, sha256, signHs256 } from './publish.mjs';

export const AMO_API = 'https://addons.mozilla.org/api/v5/addons/';

/**
 * @typedef {{ name: string, bytes: Uint8Array }} Asset
 * @typedef {{
 *   version: string,
 *   guid: string,
 *   pkg: Asset,
 *   source: Asset,
 *   releaseNotes: { 'nb-NO': string, 'en-US': string },
 *   approvalNotes: string,
 *   env: Record<string, string | undefined>,
 *   fetch: import('./publish.mjs').Fetch,
 *   dryRun: boolean,
 *   log?: (line: string) => void,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 *   pollMs?: number,
 *   timeoutMs?: number,
 * }} AmoOptions
 * @typedef {{ status: 'skipped' | 'planned' | 'submitted', reason?: string, versionId?: number, editUrl?: string }} Result
 */

/** @param {AmoOptions['env']} env */
export function missingAmoSecrets(env) {
  return ['AMO_JWT_ISSUER', 'AMO_JWT_SECRET'].filter((k) => !env[k]);
}

/**
 * @param {AmoOptions} o
 * @returns {Promise<Result>}
 */
export async function publishAmo(o) {
  const log = o.log ?? console.log;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pollMs = o.pollMs ?? 5000;
  const timeoutMs = o.timeoutMs ?? 15 * 60_000;
  const missing = missingAmoSecrets(o.env);

  const versionBody = {
    upload: '<uuid from step 1>',
    release_notes: o.releaseNotes,
    approval_notes: o.approvalNotes,
  };
  const describe = (/** @type {Asset} */ a) => `${a.name} (${a.bytes.length} bytes, sha256 ${sha256(a.bytes)})`;
  const auth = 'Authorization: JWT <HS256 {iss: AMO_JWT_ISSUER, jti, iat, exp: iat+60}>, fresh per request';

  log(`AMO ${o.version} — add-on ${o.guid}`);
  if (o.dryRun) {
    log(`  credentials: ${missing.length ? `${missing.join(', ')} not set (a real run would skip AMO)` : 'set'}`);
    log('  plan (dry run: no request is sent):');
    log(`   1. POST ${AMO_API}upload/`);
    log(`      ${auth}`);
    log(`      multipart: upload=${describe(o.pkg)}, channel=listed`);
    log(`   2. GET ${AMO_API}upload/<uuid>/ every ${pollMs / 1000} s until processed (max ${timeoutMs / 60_000} min); stop unless valid`);
    log(`   3. POST ${AMO_API}addon/${o.guid}/versions/`);
    log('      Content-Type: application/json');
    log(indent(JSON.stringify(versionBody, null, 2)));
    log(`   4. PATCH ${AMO_API}addon/${o.guid}/versions/<id from step 3>/`);
    log(`      multipart: source=${describe(o.source)}`);
    return { status: 'planned' };
  }
  if (missing.length) {
    const reason = `${missing.join(', ')} not set in the store-publish environment`;
    notice(`AMO skipped: ${reason}.`);
    return { status: 'skipped', reason };
  }

  const issuer = /** @type {string} */ (o.env.AMO_JWT_ISSUER);
  const secret = /** @type {string} */ (o.env.AMO_JWT_SECRET);
  const headers = (/** @type {Record<string, string>} */ extra = {}) => {
    const iat = Math.floor(now() / 1000);
    const jwt = signHs256({ iss: issuer, jti: newJti(), iat, exp: iat + 60 }, secret);
    return { Authorization: `JWT ${jwt}`, Accept: 'application/json', ...extra };
  };

  // 1. Upload. The file name must end in .zip/.xpi or AMO rejects it.
  const up = new FormData();
  up.set('upload', new File([o.pkg.bytes], o.pkg.name, { type: 'application/zip' }));
  up.set('channel', 'listed');
  log(`  1. upload ${describe(o.pkg)}`);
  const upload = await call(o.fetch, 'POST', `${AMO_API}upload/`, { headers: headers(), body: up });
  const uuid = String(upload.uuid ?? '');
  if (!uuid) throw new Error(`AMO upload: no uuid in the response: ${JSON.stringify(upload)}`);

  // 2. Validation.
  const deadline = now() + timeoutMs;
  let detail = upload;
  while (!detail.processed) {
    if (now() > deadline) throw new Error(`AMO validation of upload ${uuid} did not finish in ${timeoutMs / 60_000} min`);
    await sleep(pollMs);
    detail = await call(o.fetch, 'GET', `${AMO_API}upload/${uuid}/`, { headers: headers() });
  }
  const messages = detail.validation?.messages ?? [];
  for (const m of messages) log(`     ${m.type ?? 'message'}: ${stripTags(m.message)}${m.file ? ` (${m.file})` : ''}`);
  if (!detail.valid) throw new Error(`AMO validation failed for upload ${uuid} (${messages.length} messages above)`);
  log(`  2. validated (${messages.length} messages)`);

  // 3. Version.
  const created = await call(o.fetch, 'POST', `${AMO_API}addon/${o.guid}/versions/`, {
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ...versionBody, upload: uuid }),
  });
  const versionId = Number(created.id);
  if (!versionId) throw new Error(`AMO version create: no id in the response: ${JSON.stringify(created)}`);
  log(`  3. version ${created.version ?? o.version} created (id ${versionId})`);

  // 4. Source for review.
  const src = new FormData();
  src.set('source', new File([o.source.bytes], o.source.name, { type: 'application/zip' }));
  try {
    await call(o.fetch, 'PATCH', `${AMO_API}addon/${o.guid}/versions/${versionId}/`, { headers: headers(), body: src });
  } catch (err) {
    throw new Error(
      `AMO version ${o.version} (id ${versionId}) exists, but attaching the source failed. ` +
        `Upload ${o.source.name} on the version's edit page by hand.\n${err.message}`,
      { cause: err },
    );
  }
  log(`  4. source attached: ${describe(o.source)}`);
  return { status: 'submitted', versionId, editUrl: created.edit_url };
}

/** @param {unknown} s */
const stripTags = (s) => String(s ?? '').replace(/<[^>]+>/g, '');

