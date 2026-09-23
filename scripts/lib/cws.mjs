// Chrome Web Store submission through the Chrome Web Store API v2, with
// the exact bytes of the GitHub Release asset:
//
//   0. POST oauth2.googleapis.com/token   access token (service account JWT,
//                                         or an OAuth refresh token)
//   1. POST .../upload/v2/publishers/<P>/items/<I>:upload   body = the zip
//      GET  .../v2/publishers/<P>/items/<I>:fetchStatus     while IN_PROGRESS
//   2. POST .../v2/publishers/<P>/items/<I>:publish         submit for review
//
// Docs: https://developer.chrome.com/docs/webstore/using-api,
// https://developer.chrome.com/docs/webstore/service-accounts, and the v2
// REST reference (media.upload, publishers.items.fetchStatus/publish).
// A service account is preferred: an OAuth client whose consent screen is
// in "Testing" gets refresh tokens that expire after 7 days
// (https://developers.google.com/identity/protocols/oauth2#expiration).
import { call, indent, notice, sha256, signRs256 } from './publish.mjs';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const CWS_SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const API = 'https://chromewebstore.googleapis.com';

/**
 * @typedef {{
 *   version: string,
 *   pkg: { name: string, bytes: Uint8Array },
 *   env: Record<string, string | undefined>,
 *   fetch: import('./publish.mjs').Fetch,
 *   dryRun: boolean,
 *   log?: (line: string) => void,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 *   pollMs?: number,
 *   timeoutMs?: number,
 * }} CwsOptions
 * @typedef {{ status: 'skipped' | 'planned' | 'submitted', reason?: string, state?: string }} Result
 */

/**
 * Which credentials are usable, or why none are.
 * @param {CwsOptions['env']} env
 * @returns {{ kind: 'service-account' | 'refresh-token' | null, missing: string[] }}
 */
export function cwsAuthKind(env) {
  const config = ['CWS_PUBLISHER_ID', 'CWS_ITEM_ID'].filter((k) => !env[k]);
  if (env.CWS_SERVICE_ACCOUNT_JSON) return { kind: config.length ? null : 'service-account', missing: config };
  const oauth = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN'].filter((k) => !env[k]);
  if (!oauth.length) return { kind: config.length ? null : 'refresh-token', missing: config };
  return { kind: null, missing: [...config, 'CWS_SERVICE_ACCOUNT_JSON (or CWS_CLIENT_ID + CWS_CLIENT_SECRET + CWS_REFRESH_TOKEN)'] };
}

/**
 * @param {CwsOptions} o
 * @returns {Promise<Result>}
 */
export async function publishCws(o) {
  const log = o.log ?? console.log;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pollMs = o.pollMs ?? 5000;
  const timeoutMs = o.timeoutMs ?? 10 * 60_000;
  const { kind, missing } = cwsAuthKind(o.env);
  const item = `publishers/${o.env.CWS_PUBLISHER_ID ?? '<CWS_PUBLISHER_ID>'}/items/${o.env.CWS_ITEM_ID ?? '<CWS_ITEM_ID>'}`;
  const publishBody = { publishType: 'DEFAULT_PUBLISH' };
  const described = `${o.pkg.name} (${o.pkg.bytes.length} bytes, sha256 ${sha256(o.pkg.bytes)})`;

  log(`CWS ${o.version} — ${item}`);
  if (o.dryRun) {
    log(`  credentials: ${kind ?? `${missing.join(', ')} not set (a real run would skip CWS)`}`);
    log('  plan (dry run: no request is sent):');
    log(`   0. POST ${TOKEN_URL}`);
    log(
      kind === 'refresh-token'
        ? '      form: grant_type=refresh_token, client_id, client_secret, refresh_token'
        : `      form: grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer, assertion=<RS256 {iss: client_email, scope: ${CWS_SCOPE}, aud: ${TOKEN_URL}, iat, exp: iat+3600}>`,
    );
    log(`   1. POST ${API}/upload/v2/${item}:upload`);
    log('      Authorization: Bearer <access token>');
    log(`      body: ${described}`);
    log(`      then GET ${API}/v2/${item}:fetchStatus every ${pollMs / 1000} s while the upload is IN_PROGRESS`);
    log(`   2. POST ${API}/v2/${item}:publish`);
    log('      Content-Type: application/json');
    log(indent(JSON.stringify(publishBody, null, 2)));
    return { status: 'planned' };
  }
  if (!kind) {
    const reason = `${missing.join(', ')} not set in the store-publish environment`;
    notice(`CWS skipped: ${reason}.`);
    return { status: 'skipped', reason };
  }

  // 0. Access token.
  let form;
  if (kind === 'service-account') {
    let key;
    try {
      key = JSON.parse(/** @type {string} */ (o.env.CWS_SERVICE_ACCOUNT_JSON));
    } catch {
      throw new Error('CWS_SERVICE_ACCOUNT_JSON is not valid JSON (paste the whole key file as the secret)');
    }
    if (!key.client_email || !key.private_key) {
      throw new Error('CWS_SERVICE_ACCOUNT_JSON has no client_email/private_key (is it a service account key?)');
    }
    const iat = Math.floor(now() / 1000);
    const assertion = signRs256(
      { iss: key.client_email, scope: CWS_SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 },
      key.private_key,
    );
    form = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
  } else {
    form = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: /** @type {string} */ (o.env.CWS_CLIENT_ID),
      client_secret: /** @type {string} */ (o.env.CWS_CLIENT_SECRET),
      refresh_token: /** @type {string} */ (o.env.CWS_REFRESH_TOKEN),
    });
  }
  let token;
  try {
    token = await call(o.fetch, 'POST', TOKEN_URL, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
  } catch (err) {
    // The message is the URL, status and Google's response; never the
    // request body (which holds the credential).
    throw new Error(`CWS token exchange (${kind}) failed: ${err.message}`, { cause: err });
  }
  if (!token.access_token) throw new Error(`CWS token exchange (${kind}): no access_token in the response`);
  log(`  0. access token (${kind})`);
  const auth = { Authorization: `Bearer ${token.access_token}` };

  // 1. Upload.
  log(`  1. upload ${described}`);
  const up = await call(o.fetch, 'POST', `${API}/upload/v2/${item}:upload`, { headers: auth, body: o.pkg.bytes });
  let state = String(up.uploadState ?? '');
  const deadline = now() + timeoutMs;
  while (state === 'IN_PROGRESS' || state === 'UPLOAD_IN_PROGRESS') {
    if (now() > deadline) throw new Error(`CWS upload still in progress after ${timeoutMs / 60_000} min`);
    await sleep(pollMs);
    const st = await call(o.fetch, 'GET', `${API}/v2/${item}:fetchStatus`, { headers: auth });
    state = String(st.lastAsyncUploadState ?? '');
  }
  if (state !== 'SUCCEEDED') throw new Error(`CWS upload ended in state ${state || '(none)'}: ${JSON.stringify(up)}`);
  if (up.crxVersion && up.crxVersion !== o.version) {
    throw new Error(`CWS reports uploaded version ${up.crxVersion}, expected ${o.version}`);
  }
  log(`  1. uploaded (${state}${up.crxVersion ? `, version ${up.crxVersion}` : ''})`);

  // 2. Submit for review; published when it passes.
  const pub = await call(o.fetch, 'POST', `${API}/v2/${item}:publish`, {
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(publishBody),
  });
  for (const w of pub.warningInfo?.warnings ?? []) log(`     warning: ${w.reason ?? ''} ${w.description ?? ''}`.trimEnd());
  log(`  2. submitted for review (state ${pub.state ?? 'unknown'})`);
  return { status: 'submitted', state: pub.state };
}
