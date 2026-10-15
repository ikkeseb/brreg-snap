import { spawnSync } from 'node:child_process';
import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AMO_API,
  amoLengthErrors,
  amoListingTexts,
  amoVersionTexts,
  listingChanges,
  parseAmoCategories,
  publishAmo,
  syncAmoListing,
} from '../scripts/lib/amo.mjs';
import { CWS_SCOPE, cwsAuthKind, publishCws, TOKEN_URL } from '../scripts/lib/cws.mjs';
import { diffLines } from '../scripts/lib/publish.mjs';

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

describe('AMO texts from the kit', () => {
  const kit = {
    'release_notes.nb-NO': 'Første linje\nfortsetter.\n\nNytt avsnitt.',
    'release_notes.en-US': 'English.',
    approval_notes: 'Notes\nwrapped.',
    'summary.nb-NO': 'Kort.',
    'summary.en-US': 'Short.',
    'description.nb-NO': 'Avsnitt.\n\n• Punkt en.\n• Punkt to.',
    'description.en-US': 'Paragraph.\n\n• One.\n• Two.',
    privacy_policy: '**Policy**\n\nText.',
    categories: 'search-tools\nprivacy-security',
  };

  it('version texts are reflowed per locale, as publishAmo sends them', () => {
    expect(amoVersionTexts(kit)).toEqual({
      release_notes: { 'nb-NO': 'Første linje fortsetter.\n\nNytt avsnitt.', 'en-US': 'English.' },
      approval_notes: 'Notes wrapped.',
    });
    expect(() => amoVersionTexts({ ...kit, approval_notes: '' })).toThrow(/approval_notes missing or empty/);
  });

  it('listing texts: the manifest name for both locales, kit text as is, nb-NO policy', () => {
    expect(amoListingTexts(kit, 'brreg-snap – oppslag')).toEqual({
      addon: {
        name: { 'nb-NO': 'brreg-snap – oppslag', 'en-US': 'brreg-snap – oppslag' },
        summary: { 'nb-NO': 'Kort.', 'en-US': 'Short.' },
        description: { 'nb-NO': 'Avsnitt.\n\n• Punkt en.\n• Punkt to.', 'en-US': 'Paragraph.\n\n• One.\n• Two.' },
        categories: ['search-tools', 'privacy-security'],
      },
      policy: { privacy_policy: { 'nb-NO': '**Policy**\n\nText.' } },
    });
    const { 'summary.en-US': _, ...old } = kit;
    expect(() => amoListingTexts(old, 'x')).toThrow(/summary\.en-US missing.*use the kit from main/);
    const { categories: __, ...noCategories } = kit;
    expect(() => amoListingTexts(noCategories, 'x')).toThrow(/categories missing/);
  });

  it('the kit decides the categories, checked as AMO checks them', () => {
    expect(amoListingTexts({ ...kit, categories: 'shopping' }, 'x').addon.categories).toEqual(['shopping']);
    expect(parseAmoCategories(' search-tools\n\nprivacy-security \n')).toEqual(['search-tools', 'privacy-security']);
    expect(() => parseAmoCategories('search-tools\nSearch Tools')).toThrow(/unknown slug Search, Tools/);
    expect(() => parseAmoCategories('')).toThrow(/1 to 3 slugs, got 0/);
    expect(() => parseAmoCategories('tabs bookmarks shopping appearance')).toThrow(/1 to 3 slugs, got 4/);
    expect(() => parseAmoCategories('tabs tabs')).toThrow(/twice/);
    expect(() => parseAmoCategories('other\ntabs')).toThrow(/"other" only alone/);
    expect(parseAmoCategories('other')).toEqual(['other']);
  });

  it('the length guard names field, length and limit, per locale, in code points', () => {
    const ok = 'a'.repeat(3000);
    expect(amoLengthErrors({ approval_notes: ok, categories: ['x'.repeat(9999)] })).toEqual([]);
    expect(amoLengthErrors({ approval_notes: `${ok}b` })).toEqual(['approval_notes: 3001 characters, AMO allows 3000']);
    // 50 code points, 100 UTF-16 units: AMO counts like Python's len().
    expect(amoLengthErrors({ name: { 'nb-NO': '𝔟'.repeat(50) } })).toEqual([]);
    expect(amoLengthErrors({ name: { 'nb-NO': 'ø'.repeat(51), 'en-US': 'ok' }, summary: { 'en-US': 's'.repeat(251) } })).toEqual([
      'name.nb-NO: 51 characters, AMO allows 50',
      'summary.en-US: 251 characters, AMO allows 250',
    ]);
  });
});

describe('syncAmoListing', () => {
  const secret = 'test-secret-not-real';
  const listing = {
    addon: {
      name: { 'nb-NO': 'Navn', 'en-US': 'Navn' },
      summary: { 'nb-NO': 'Kort.', 'en-US': 'Short.' },
      description: { 'nb-NO': 'Ny tekst.\n\n• Punkt.', 'en-US': 'Text.' },
      categories: ['search-tools', 'privacy-security'],
    },
    policy: { privacy_policy: { 'nb-NO': 'Policy.' } },
  };
  const live = {
    name: { 'nb-NO': 'Navn', 'en-US': 'Gammelt' },
    summary: { 'nb-NO': 'Kort.', 'en-US': 'Short.' },
    description: { 'nb-NO': 'Gammel <a href="https://outgoing/x" rel="nofollow">tekst</a>.\n\n• Punkt.', 'en-US': 'Text.' },
    categories: ['search-tools'],
  };
  const base = {
    guid: 'brreg-snap@ikkeseb.github.io',
    listing,
    env: { AMO_JWT_ISSUER: 'user:1:2', AMO_JWT_SECRET: secret },
    now: () => NOW,
    log: () => {},
  };
  const addonUrl = `${AMO_API}addon/brreg-snap@ikkeseb.github.io/`;

  it('reads the live listing, then patches the add-on and the privacy policy as JSON', async () => {
    const { fetch, calls } = fakeFetch([
      { json: live },
      { json: { eula: null, privacy_policy: { 'nb-NO': 'Policy.' } } },
      { json: {} },
      { json: {} },
    ]);
    expect(await syncAmoListing({ ...base, fetch, dryRun: false })).toEqual({ status: 'synced' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${addonUrl}`,
      `GET ${addonUrl}eula_policy/`,
      `PATCH ${addonUrl}`,
      `PATCH ${addonUrl}eula_policy/`,
    ]);
    for (const c of calls.slice(0, 2)) expect(c.headers.Authorization).toBeUndefined();
    for (const c of calls.slice(2)) {
      expect(c.headers.Authorization).toMatch(/^JWT [\w-]+\.[\w-]+\.[\w-]+$/);
      expect(c.headers['Content-Type']).toBe('application/json');
    }
    expect(JSON.parse(calls[2]!.body as string)).toEqual(listing.addon);
    expect(JSON.parse(calls[3]!.body as string)).toEqual(listing.policy);
  });

  it('dry run: plan and diff from public GETs only, no write, no credential', async () => {
    for (const env of [base.env, {}]) {
      const { fetch, calls } = fakeFetch([{ json: live }, { json: { privacy_policy: null } }]);
      const lines: string[] = [];
      const res = await syncAmoListing({ ...base, env, fetch, dryRun: true, log: (l) => lines.push(l) });
      expect(res).toEqual({ status: 'planned' });
      expect(calls.map((c) => c.method)).toEqual(['GET', 'GET']);
      for (const c of calls) expect(c.headers.Authorization).toBeUndefined();
      const plan = lines.join('\n');
      expect(plan).toContain(`PATCH ${addonUrl}`);
      expect(plan).toContain('lengths (AMO limit): name.nb-NO 4/50, name.en-US 4/50, summary.nb-NO 5/250');
      expect(plan).toContain('"categories": [');
      expect(plan).toContain('categories: search-tools → search-tools, privacy-security');
      expect(plan).toMatch(/name\.en-US:\n\s+-Gammelt\n\s+\+Navn/);
      expect(plan).toContain('summary.nb-NO: unchanged');
      expect(plan).toContain('-Gammel tekst.');
      expect(plan).toContain('privacy_policy.nb-NO: (not set on AMO)');
      expect(plan).not.toContain(secret);
      expect(plan).not.toContain('user:1:2');
    }
  });

  it('a failed read of the live listing stops before any PATCH, dry run or not', async () => {
    for (const dryRun of [true, false]) {
      // 4xx from the add-on GET, then from the eula_policy GET.
      for (const replies of [[{ status: 403, json: { detail: 'no' } }], [{ json: live }, { status: 404, json: {} }]]) {
        const sent = replies.length;
        const { fetch, calls } = fakeFetch(replies);
        await expect(syncAmoListing({ ...base, fetch, dryRun })).rejects.toThrow(
          /could not read the live listing, so nothing was sent\.\nGET .* HTTP 40[34]/,
        );
        expect(calls.every((c) => c.method === 'GET')).toBe(true);
        expect(calls).toHaveLength(sent);
      }
    }
  });

  it('skips without a request when a secret is missing', async () => {
    const { fetch } = fakeFetch([]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await syncAmoListing({ ...base, env: { AMO_JWT_SECRET: secret }, fetch, dryRun: false });
    expect(res).toEqual({ status: 'skipped', reason: 'AMO_JWT_ISSUER not set in the store-publish environment' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says so when the text went up but the privacy policy did not', async () => {
    const { fetch } = fakeFetch([{ json: live }, { json: {} }, { json: {} }, { status: 400, json: { privacy_policy: ['bad'] } }]);
    await expect(syncAmoListing({ ...base, fetch, dryRun: false })).rejects.toThrow(/updated, but the privacy policy was not/);
  });

  it('listingChanges reads v5 flat categories and the older per-app object', () => {
    const sent = { categories: ['search-tools'] };
    expect(listingChanges({ categories: ['search-tools'] }, sent)).toEqual(['categories: unchanged']);
    expect(listingChanges({ categories: { firefox: ['other'] } }, sent)).toEqual(['categories: other → search-tools']);
  });
});

it('diffLines marks removed, added and shared lines', () => {
  expect(diffLines('a\nb\nc', 'a\nB\nc\nd')).toEqual([' a', '-b', '+B', ' c', '+d']);
  expect(diffLines('same', 'same')).toEqual([' same']);
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

// publish.yml's `publish` job holds the store keys and installs no
// dependencies, so the publishers may import only node: builtins and
// scripts that do the same. ESM links every import before the first line
// runs: run without arguments from a copy outside the repo (no
// node_modules to find), a clean graph prints the usage and exits 2.
it.each(['publish-amo.mjs', 'publish-cws.mjs'])('%s loads without node_modules', (script) => {
  const dir = mkdtempSync(join(tmpdir(), 'brreg-snap-publish-'));
  try {
    cpSync(fileURLToPath(new URL('../scripts', import.meta.url)), join(dir, 'scripts'), { recursive: true });
    const r = spawnSync(process.execPath, [join(dir, 'scripts', script)], { encoding: 'utf8' });
    expect(r.stderr).toMatch(/^usage:/);
    expect(r.status).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
