import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  REVIEW_WARN_DAYS,
  classifyStore,
  comparePackages,
  compareVersions,
  crxToZip,
  jsonEqual,
  normalizeManifests,
  parseAmoAddon,
  parseUpdateCheck,
  readCwsItemId,
  readZip,
} from '../scripts/store-status-core.mjs';

// scripts/store-status.mjs's pure half, fed with live captures from
// 2026-09-24 (tests/fixtures/stores/README.md).

const fixture = (name: string) => readFileSync(new URL(`./fixtures/stores/${name}`, import.meta.url));

const tag = (name: string, date: string) => ({
  name,
  version: name.replace(/^[a-z-]*?(?=\d)/, ''),
  date,
});

describe('compareVersions', () => {
  it('compares numerically, not as strings', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.3.0', '1.3.1')).toBe(-1);
    expect(compareVersions('1.3.1', '1.3.1')).toBe(0);
  });

  it('treats missing parts as zero', () => {
    expect(compareVersions('1.3', '1.3.0')).toBe(0);
    expect(compareVersions('2', '1.99.99')).toBe(1);
  });

  it('rejects non-numeric versions instead of guessing', () => {
    expect(() => compareVersions('1.3.0-beta', '1.3.0')).toThrow(/dotted version/);
  });
});

describe('classifyStore', () => {
  const now = new Date('2026-09-24T12:00:00Z');
  const v131 = tag('v1.3.1', '2026-09-23T23:46:36+02:00');
  const sub131 = tag('amo-submission-1.3.1', '2026-09-24T00:17:09+02:00');

  it('is ok when the store serves the latest v tag', () => {
    const r = classifyStore({ storeVersion: '1.3.1', latestTag: v131, submissionTag: sub131, now });
    expect(r.verdict).toBe('ok');
  });

  it('is in review while the store serves an older version than the latest submission', () => {
    const r = classifyStore({ storeVersion: '1.3.0', latestTag: v131, submissionTag: sub131, now });
    expect(r).toEqual({
      verdict: 'in-review',
      detail: 'amo-submission-1.3.1 in review since 2026-09-24 (0 d)',
    });
  });

  it(`turns into a warning after ${REVIEW_WARN_DAYS} days`, () => {
    const later = new Date('2026-10-09T12:00:00Z');
    const r = classifyStore({ storeVersion: '1.3.0', latestTag: v131, submissionTag: sub131, now: later });
    expect(r.verdict).toBe('stale-review');
    expect(r.detail).toContain('(15 d)');
    const edge = new Date('2026-10-07T23:00:00Z'); // 14 whole days
    expect(classifyStore({ storeVersion: '1.3.0', latestTag: v131, submissionTag: sub131, now: edge }).verdict)
      .toBe('in-review');
  });

  it('is a mismatch when a tagged release was never submitted', () => {
    const sub130 = tag('amo-submission-1.3.0', '2026-07-05T01:25:00+02:00');
    const r = classifyStore({ storeVersion: '1.3.0', latestTag: v131, submissionTag: sub130, now });
    expect(r.verdict).toBe('mismatch');
  });

  it('is a mismatch when the store serves something newer than any tag', () => {
    const r = classifyStore({ storeVersion: '1.4.0', latestTag: v131, submissionTag: sub131, now });
    expect(r.verdict).toBe('mismatch');
  });

  it('is unknown without a store answer or a v tag', () => {
    expect(classifyStore({ storeVersion: null, latestTag: v131, submissionTag: sub131, now }).verdict)
      .toBe('unknown');
    expect(classifyStore({ storeVersion: '1.3.0', latestTag: null, submissionTag: sub131, now }).verdict)
      .toBe('unknown');
  });
});

describe('store responses', () => {
  it('reads version, file and users from the AMO add-on detail', () => {
    const amo = parseAmoAddon(JSON.parse(fixture('amo-addon-1.3.0.json').toString()));
    expect(amo).toEqual({
      version: '1.3.0',
      lastUpdated: '2026-07-04T23:30:55Z',
      url: 'https://addons.mozilla.org/firefox/downloads/file/4882803/brreg_snap-1.3.0.xpi',
      hash: 'sha256:d59fdabccbd68685fae5b5dab68f243485248b647e50ebb71eccb07870ea723f',
      users: 0,
      rating: 0,
      ratings: 0,
    });
    expect(() => parseAmoAddon({ detail: 'Not found.' })).toThrow(/current_version/);
  });

  it('reads the served version and crx url from the CWS update check', () => {
    const uc = parseUpdateCheck(fixture('cws-updatecheck-1.3.0.xml').toString());
    expect(uc).toMatchObject({
      version: '1.3.0',
      sha256: '375c112ed1f36a3edd3a96529f5b2e6f5ee30af2950822300eb2a51a1bad72e6',
      size: 53257,
    });
    expect('codebase' in uc && uc.codebase).toMatch(/^https:\/\/clients2\.googleusercontent\.com\/crx\/blobs\/.+_1_3_0_0\.crx$/);
  });

  it('reports an unknown CWS id as an error, not a version', () => {
    expect(parseUpdateCheck(fixture('cws-updatecheck-unknown-id.xml').toString()))
      .toEqual({ error: 'app status error-unknownApplication' });
  });

  it('reads the CWS item id from its one home in docs/cws-submission.md', () => {
    const doc = readFileSync(new URL('../docs/cws-submission.md', import.meta.url), 'utf8');
    expect(readCwsItemId(doc)).toBe('mccggmiialopdaaokhakeijmbafhdmli');
    expect(() => readCwsItemId('no anchor here')).toThrow(/item-id/);
  });
});

describe('manifest normalisation', () => {
  it('AMO: re-serialised bytes, same JSON, no added keys', () => {
    const store = fixture('amo-1.3.0-manifest.json');
    const release = fixture('release-firefox-1.3.0-manifest.json');
    expect(store.equals(release)).toBe(false);
    const m = normalizeManifests(store, release, 'amo');
    expect(m.added).toEqual([]);
    expect(jsonEqual(m.store, m.release)).toBe(true);
  });

  it('CWS: drops the update_url the store adds, then equal', () => {
    const store = fixture('cws-1.3.0-manifest.json');
    const release = fixture('release-chrome-1.3.0-manifest.json');
    expect(JSON.parse(store.toString())).toHaveProperty('update_url');
    const m = normalizeManifests(store, release, 'cws');
    expect(m.added).toEqual(['update_url']);
    expect(jsonEqual(m.store, m.release)).toBe(true);
  });

  it('still catches a real manifest change', () => {
    const release = JSON.parse(fixture('release-chrome-1.3.0-manifest.json').toString());
    const store = { ...release, update_url: 'https://clients2.google.com/service/update2/crx',
      permissions: [...release.permissions, 'tabs'] };
    const m = normalizeManifests(JSON.stringify(store), JSON.stringify(release), 'cws');
    expect(jsonEqual(m.store, m.release)).toBe(false);
  });

  it('never strips a key the release ships itself', () => {
    const release = { name: 'x', update_url: 'https://ours.example/' };
    const store = { name: 'x', update_url: 'https://theirs.example/' };
    const m = normalizeManifests(JSON.stringify(store), JSON.stringify(release), 'cws');
    expect(m.added).toEqual([]);
    expect(jsonEqual(m.store, m.release)).toBe(false);
  });
});

// A tiny zip writer (deflate) so the reader and the CRX3 header skip are
// tested on real archive bytes.
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = deflateRawSync(Buffer.from(text));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(text.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(text.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

function makeCrx(zip: Buffer): Buffer {
  const header = Buffer.from('opaque protobuf header with signatures');
  const prefix = Buffer.alloc(12);
  prefix.write('Cr24', 0, 'latin1');
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, zip]);
}

describe('package comparison', () => {
  const manifest = JSON.stringify({ name: 'brreg-snap', version: '1.3.0' });
  const release = {
    'manifest.json': manifest,
    'popup/popup.html': '<!doctype html>\n<p>x</p>\n',
    'popup/popup.js': 'console.log(1);\n',
  };

  it('reads a CRX3 by skipping its header', () => {
    const crx = makeCrx(makeZip(release));
    const files = readZip(crxToZip(crx));
    expect([...files.keys()]).toEqual(Object.keys(release));
    expect(files.get('popup/popup.js')?.toString()).toBe('console.log(1);\n');
    expect(() => crxToZip(makeZip(release))).toThrow(/Cr24/);
  });

  it('reports identical / differs / missing per file and ignores store signing data', () => {
    const store = {
      'manifest.json': JSON.stringify({ version: '1.3.0', name: 'brreg-snap', update_url: 'u' }, null, 2),
      'popup/popup.html': '<!doctype html>\r\n<p>x</p>\r\r\n',
      'details/extra.js': '',
      '_metadata/verified_contents.json': '[]',
    };
    const r = comparePackages(readZip(makeZip(store)), readZip(makeZip(release)), 'cws');
    expect(r.ignored).toEqual(['_metadata/verified_contents.json']);
    expect(r.files).toEqual([
      { path: 'details/extra.js', status: 'extra in store' },
      { path: 'manifest.json', status: 'identical', note: 'as JSON, store-added keys ignored: update_url' },
      { path: 'popup/popup.html', status: 'differs', note: 'line endings only (CRLF build)' },
      { path: 'popup/popup.js', status: 'missing in store' },
    ]);
  });

  it('does not ignore META-INF/ when the release ships it too', () => {
    const r = comparePackages(
      readZip(makeZip({ 'META-INF/x': 'a' })),
      readZip(makeZip({ 'META-INF/x': 'b' })),
      'amo',
    );
    expect(r.files).toEqual([{ path: 'META-INF/x', status: 'differs' }]);
  });
});
