import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AMO_API, publishAmo } from '../scripts/lib/amo.mjs';
import { CWS_SCOPE, cwsAuthKind, publishCws, TOKEN_URL } from '../scripts/lib/cws.mjs';

// The store publishers against a fake fetch: request order, URLs, bodies
// and auth headers, plus the skip and dry-run paths. Every credential
// here is a throwaway made up by the test; no real endpoint is called.

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = { status?: number; json?: unknown };

function fakeFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const fetch = vi.fn((url: string, init: { method: string; headers: Record<string, string>; body?: unknown }) => {
    calls.push({ method: init.method, url, headers: init.headers, body: init.body });
    const r = replies.shift();
    if (!r) throw new Error(`unexpected request ${init.method} ${url}`);
    const status = r.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(r.json === undefined ? '' : JSON.stringify(r.json)),
    });
  });
  return { fetch, calls };
}

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;

const quiet = { log: () => {}, sleep: () => Promise.resolve() };
const NOW = 1_800_000_000_000;

afterEach(() => vi.restoreAllMocks());

describe('publishAmo', () => {
  const secret = 'test-secret-not-real';
  const base = {
    version: '2.0.0',
    guid: 'brreg-snap@ikkeseb.github.io',
    pkg: { name: 'brreg-snap-2.0.0.zip', bytes: new Uint8Array([1, 2, 3]) },
    source: { name: 'brreg-snap-source-2.0.0.zip', bytes: new Uint8Array([4, 5]) },
    releaseNotes: { 'nb-NO': 'Norsk.', 'en-US': 'English.' },
    approvalNotes: 'Reviewer notes.',
    env: { AMO_JWT_ISSUER: 'user:1:2', AMO_JWT_SECRET: secret },
    now: () => NOW,
    ...quiet,
  };

  it('uploads, polls validation, creates the version, then attaches the source', async () => {
    const { fetch, calls } = fakeFetch([
      { status: 201, json: { uuid: 'u-1', processed: false } },
      { json: { uuid: 'u-1', processed: false } },
      { json: { uuid: 'u-1', processed: true, valid: true, validation: { messages: [] } } },
      { status: 201, json: { id: 42, version: '2.0.0', edit_url: 'https://amo/edit' } },
      { json: { id: 42 } },
    ]);
    const res = await publishAmo({ ...base, fetch, dryRun: false });
    expect(res).toEqual({ status: 'submitted', versionId: 42, editUrl: 'https://amo/edit' });

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${AMO_API}upload/`,
      `GET ${AMO_API}upload/u-1/`,
      `GET ${AMO_API}upload/u-1/`,
      `POST ${AMO_API}addon/brreg-snap@ikkeseb.github.io/versions/`,
      `PATCH ${AMO_API}addon/brreg-snap@ikkeseb.github.io/versions/42/`,
    ]);

    const upload = calls[0]!.body as FormData;
    expect(upload.get('channel')).toBe('listed');
    const file = upload.get('upload') as File;
    expect(file.name).toBe('brreg-snap-2.0.0.zip');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(base.pkg.bytes);

    expect(calls[3]!.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[3]!.body as string)).toEqual({
      upload: 'u-1',
      release_notes: { 'nb-NO': 'Norsk.', 'en-US': 'English.' },
      approval_notes: 'Reviewer notes.',
    });

    const source = (calls[4]!.body as FormData).get('source') as File;
    expect(source.name).toBe('brreg-snap-source-2.0.0.zip');
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(base.source.bytes);
  });

  it('signs a fresh HS256 JWT per request: iss, unique jti, exp = iat + 60', async () => {
    const { fetch, calls } = fakeFetch([
      { status: 201, json: { uuid: 'u', processed: true, valid: true } },
      { status: 201, json: { id: 7 } },
      { json: {} },
    ]);
    await publishAmo({ ...base, fetch, dryRun: false });
    const jtis = new Set();
    for (const c of calls) {
      const [scheme, jwt = ''] = (c.headers.Authorization ?? '').split(' ');
      expect(scheme).toBe('JWT');
      const [h = '', p = '', sig = ''] = jwt.split('.');
      expect(decode(h)).toEqual({ alg: 'HS256', typ: 'JWT' });
      const claims = decode(p);
      expect(claims).toMatchObject({ iss: 'user:1:2', iat: NOW / 1000, exp: NOW / 1000 + 60 });
      expect(sig).toBe(createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url'));
      jtis.add(claims.jti);
    }
    expect(jtis.size).toBe(calls.length);
  });

  it('stops before creating a version when validation fails', async () => {
    const { fetch, calls } = fakeFetch([
      {
        status: 201,
        json: { uuid: 'u', processed: true, valid: false, validation: { messages: [{ type: 'error', message: 'bad' }] } },
      },
    ]);
    await expect(publishAmo({ ...base, fetch, dryRun: false })).rejects.toThrow(/validation failed/);
    expect(calls).toHaveLength(1);
  });

  it('names the created version when only the source upload fails', async () => {
    const { fetch } = fakeFetch([
      { status: 201, json: { uuid: 'u', processed: true, valid: true } },
      { status: 201, json: { id: 9 } },
      { status: 400, json: { source: ['too big'] } },
    ]);
    await expect(publishAmo({ ...base, fetch, dryRun: false })).rejects.toThrow(/id 9\) exists.*source failed/s);
  });

  it('skips without a request when a secret is missing', async () => {
    const { fetch } = fakeFetch([]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await publishAmo({ ...base, env: { AMO_JWT_ISSUER: 'user:1:2' }, fetch, dryRun: false });
    expect(res).toEqual({ status: 'skipped', reason: 'AMO_JWT_SECRET not set in the store-publish environment' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('dry run prints the plan and sends nothing, secrets or not', async () => {
    for (const env of [base.env, {}]) {
      const { fetch } = fakeFetch([]);
      const lines: string[] = [];
      const res = await publishAmo({ ...base, env, fetch, dryRun: true, log: (l) => lines.push(l) });
      expect(res).toEqual({ status: 'planned' });
      expect(fetch).not.toHaveBeenCalled();
      const plan = lines.join('\n');
      expect(plan).toContain(`POST ${AMO_API}upload/`);
      expect(plan).toContain('"approval_notes": "Reviewer notes."');
      expect(plan).toContain(`PATCH ${AMO_API}addon/brreg-snap@ikkeseb.github.io/versions/`);
      expect(plan).not.toContain(secret);
      expect(plan).not.toContain('user:1:2');
    }
  });
});

describe('publishCws', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const sa = JSON.stringify({ type: 'service_account', client_email: 'ci@test.iam.gserviceaccount.com', private_key: pem });
  const config = { CWS_PUBLISHER_ID: 'pub-1', CWS_ITEM_ID: 'item-1' };
  const item = 'publishers/pub-1/items/item-1';
  const base = {
    version: '2.0.0',
    pkg: { name: 'brreg-snap-chrome-2.0.0.zip', bytes: new Uint8Array([9, 8, 7]) },
    now: () => NOW,
    ...quiet,
  };

  it('service account: token, upload, poll while in progress, publish', async () => {
    const { fetch, calls } = fakeFetch([
      { json: { access_token: 'at-1', expires_in: 3600 } },
      { json: { uploadState: 'IN_PROGRESS' } },
      { json: { lastAsyncUploadState: 'SUCCEEDED' } },
      { json: { state: 'PENDING_REVIEW' } },
    ]);
    const res = await publishCws({ ...base, env: { ...config, CWS_SERVICE_ACCOUNT_JSON: sa }, fetch, dryRun: false });
    expect(res).toEqual({ status: 'submitted', state: 'PENDING_REVIEW' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${TOKEN_URL}`,
      `POST https://chromewebstore.googleapis.com/upload/v2/${item}:upload`,
      `GET https://chromewebstore.googleapis.com/v2/${item}:fetchStatus`,
      `POST https://chromewebstore.googleapis.com/v2/${item}:publish`,
    ]);

    const form = new URLSearchParams(calls[0]!.body as string);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [h = '', p = '', sig = ''] = (form.get('assertion') ?? '').split('.');
    expect(decode(h)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(p)).toEqual({
      iss: 'ci@test.iam.gserviceaccount.com',
      scope: CWS_SCOPE,
      aud: TOKEN_URL,
      iat: NOW / 1000,
      exp: NOW / 1000 + 3600,
    });
    expect(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, sig, 'base64url')).toBe(true);

    for (const c of calls.slice(1)) expect(c.headers.Authorization).toBe('Bearer at-1');
    expect(calls[1]!.body).toEqual(base.pkg.bytes);
    expect(JSON.parse(calls[3]!.body as string)).toEqual({ publishType: 'DEFAULT_PUBLISH' });
  });

  it('refresh-token fallback posts the refresh grant', async () => {
    const { fetch, calls } = fakeFetch([
      { json: { access_token: 'at-2' } },
      { json: { uploadState: 'SUCCEEDED', crxVersion: '2.0.0' } },
      { json: { state: 'PENDING_REVIEW' } },
    ]);
    const env = { ...config, CWS_CLIENT_ID: 'cid', CWS_CLIENT_SECRET: 'csec', CWS_REFRESH_TOKEN: 'rt' };
    await publishCws({ ...base, env, fetch, dryRun: false });
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body as string))).toEqual({
      grant_type: 'refresh_token',
      client_id: 'cid',
      client_secret: 'csec',
      refresh_token: 'rt',
    });
    expect(calls).toHaveLength(3);
  });

  it('does not publish after a failed upload or a version mismatch', async () => {
    for (const upload of [{ uploadState: 'FAILED' }, { uploadState: 'SUCCEEDED', crxVersion: '1.9.0' }]) {
      const { fetch, calls } = fakeFetch([{ json: { access_token: 'a' } }, { json: upload }]);
      await expect(
        publishCws({ ...base, env: { ...config, CWS_SERVICE_ACCOUNT_JSON: sa }, fetch, dryRun: false }),
      ).rejects.toThrow(/FAILED|expected 2\.0\.0/);
      expect(calls).toHaveLength(2);
    }
  });

  it('never echoes the credential when the token exchange fails', async () => {
    const { fetch } = fakeFetch([{ status: 400, json: { error: 'invalid_grant' } }]);
    const env = { ...config, CWS_CLIENT_ID: 'cid', CWS_CLIENT_SECRET: 'csec-SECRET', CWS_REFRESH_TOKEN: 'rt-SECRET' };
    const message = await publishCws({ ...base, env, fetch, dryRun: false }).then(
      () => '',
      (e: unknown) => (e as Error).message,
    );
    expect(message).toMatch(/invalid_grant/);
    expect(message).not.toMatch(/SECRET/);
  });

  it('picks credentials, and skips when a secret or variable is missing', async () => {
    expect(cwsAuthKind({ ...config, CWS_SERVICE_ACCOUNT_JSON: sa }).kind).toBe('service-account');
    expect(cwsAuthKind({ ...config, CWS_CLIENT_ID: 'a', CWS_CLIENT_SECRET: 'b', CWS_REFRESH_TOKEN: 'c' }).kind).toBe(
      'refresh-token',
    );
    expect(cwsAuthKind({ ...config, CWS_CLIENT_ID: 'a' }).kind).toBeNull();
    expect(cwsAuthKind({ CWS_SERVICE_ACCOUNT_JSON: sa }).missing).toEqual(['CWS_PUBLISHER_ID', 'CWS_ITEM_ID']);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { fetch } = fakeFetch([]);
    const res = await publishCws({ ...base, env: { CWS_SERVICE_ACCOUNT_JSON: sa }, fetch, dryRun: false });
    expect(res.status).toBe('skipped');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('dry run prints the plan and sends nothing', async () => {
    const { fetch } = fakeFetch([]);
    const lines: string[] = [];
    const res = await publishCws({
      ...base,
      env: { ...config, CWS_SERVICE_ACCOUNT_JSON: sa },
      fetch,
      dryRun: true,
      log: (l) => lines.push(l),
    });
    expect(res).toEqual({ status: 'planned' });
    expect(fetch).not.toHaveBeenCalled();
    const plan = lines.join('\n');
    expect(plan).toContain(`upload/v2/${item}:upload`);
    expect(plan).toContain(`v2/${item}:publish`);
    expect(plan).not.toContain('PRIVATE KEY');
  });
});
