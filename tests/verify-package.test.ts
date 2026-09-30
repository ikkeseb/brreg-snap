import { readFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { referencedFiles } from '../scripts/manifest-invariants.mjs';
import { readZip } from '../scripts/lib/zip.mjs';
import { assetNames, checkExtensionZip, checkSourceZip } from '../scripts/verify-package.mjs';

// The packaged-zip gate (release.yml before the Release exists, publish.yml
// on the downloaded assets). The zips are written here by a minimal zip
// writer; scripts/lib/zip.mjs reads them back, stored and deflated.

function zip(files: Record<string, string>, deflate = true): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const body = deflate ? deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const common = (b: Buffer, at: number) => {
      b.writeUInt16LE(20, at); // version needed
      b.writeUInt16LE(0x800, at + 2); // utf-8 names
      b.writeUInt16LE(deflate ? 8 : 0, at + 4);
      b.writeUInt32LE(crc32(data) >>> 0, at + 10);
      b.writeUInt32LE(body.length, at + 14);
      b.writeUInt32LE(data.length, at + 18);
      b.writeUInt16LE(nameBuf.length, at + 22);
    };
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    common(loc, 4);
    locals.push(loc, nameBuf, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    common(cen, 6);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += loc.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const manifest = (target: 'firefox' | 'chrome', version: string) => {
  const m = JSON.parse(readFileSync(`public/manifest.${target}.json`, 'utf8')) as { version: string };
  m.version = version;
  return JSON.stringify(m);
};

// A clean package: the manifest plus every file it references.
const good = (target: 'firefox' | 'chrome', version = '2.0.0'): Record<string, string> => {
  const m = manifest(target, version);
  const files: Record<string, string> = { 'manifest.json': m };
  for (const f of referencedFiles(JSON.parse(m) as Record<string, unknown>)) {
    files[f] = f.endsWith('.js') ? 'console.log(1);' : 'x';
  }
  return files;
};

describe('readZip', () => {
  it('reads stored and deflated entries and checks their CRC', () => {
    for (const deflate of [true, false]) {
      const entries = readZip(zip({ 'a.txt': 'hello', 'd/b.txt': 'world'.repeat(50) }, deflate));
      expect(entries.map((e) => [e.name, e.data().toString()])).toEqual([
        ['a.txt', 'hello'],
        ['d/b.txt', 'world'.repeat(50)],
      ]);
    }
    const bad = zip({ 'a.txt': 'hello' }, false);
    bad[30 + 'a.txt'.length]! ^= 0xff; // flip a data byte
    expect(() => readZip(bad)[0]!.data()).toThrow(/CRC/);
    expect(() => readZip(Buffer.from('not a zip at all, definitely not'))).toThrow(/not a zip/);
  });
});

describe('checkExtensionZip', () => {
  it('passes a clean package for both targets', () => {
    for (const t of ['firefox', 'chrome'] as const) {
      expect(checkExtensionZip(readZip(zip(good(t))), t, '2.0.0')).toEqual([]);
    }
  });

  it('flags a version other than the tag', () => {
    const v = checkExtensionZip(readZip(zip(good('firefox', '1.9.9'))), 'firefox', '2.0.0');
    expect(v.some((m) => m.includes('version'))).toBe(true);
  });

  it('flags source maps, docs, extra root entries, eval and a missing manifest', () => {
    const files: Record<string, string> = {
      ...good('chrome'),
      'popup/popup.js.map': '{}',
      'icons/README.md': '#',
      'src/x.ts': '',
      'chunks/a.js': 'const f = new Function("x");',
    };
    const v = checkExtensionZip(readZip(zip(files)), 'chrome', '2.0.0').join('\n');
    expect(v).toMatch(/source map.*popup\.js\.map/);
    expect(v).toMatch(/doc file.*icons\/README\.md/);
    expect(v).toMatch(/unexpected entry "src"/);
    expect(v).toMatch(/chunks\/a\.js: runtime code generation/);

    const { 'manifest.json': _, ...noManifest } = good('firefox');
    expect(checkExtensionZip(readZip(zip(noManifest)), 'firefox', '2.0.0')).toContain(
      'manifest.json is not at the archive root',
    );
  });

  it('flags a manifest-referenced file missing from the package', () => {
    const { 'details/details.html': _, ...files } = good('firefox');
    expect(checkExtensionZip(readZip(zip(files)), 'firefox', '2.0.0')).toEqual([
      'manifest.json: references "details/details.html", which is not in the package',
    ]);
  });

  it('scans the packaged JavaScript on the AST: a mention is fine, a spelling is not', () => {
    const ok = checkExtensionZip(
      readZip(zip({ ...good('chrome'), 'chunks/a.js': 'console.log("eval( in a string");' })),
      'chrome',
      '2.0.0',
    );
    expect(ok).toEqual([]);
    const bad = checkExtensionZip(
      readZip(zip({ ...good('chrome'), 'chunks/a.js': 'globalThis["eval"](e);' })),
      'chrome',
      '2.0.0',
    );
    expect(bad.join('\n')).toMatch(/chunks\/a\.js: runtime code generation/);
  });

  it('runs the manifest invariants on the packaged manifest', () => {
    const m = JSON.parse(manifest('firefox', '2.0.0')) as { permissions: string[] };
    m.permissions.push('cookies');
    const v = checkExtensionZip(readZip(zip({ ...good('firefox'), 'manifest.json': JSON.stringify(m) })), 'firefox', '2.0.0');
    expect(v.join('\n')).toMatch(/permissions must be exactly/);
  });
});

describe('checkSourceZip', () => {
  const pkg = (v: string) => JSON.stringify({ name: 'brreg-snap', version: v });

  it('wants the tagged package.json and lockfile, and no build output', () => {
    expect(checkSourceZip(readZip(zip({ 'package.json': pkg('2.0.0'), 'pnpm-lock.yaml': '' })), '2.0.0')).toEqual([]);
    const v = checkSourceZip(
      readZip(zip({ 'package.json': pkg('1.0.0'), 'dist-firefox/manifest.json': '{}' })),
      '2.0.0',
    ).join('\n');
    expect(v).toMatch(/version "1\.0\.0" != 2\.0\.0/);
    expect(v).toMatch(/pnpm-lock\.yaml is missing/);
    expect(v).toMatch(/build output.*dist-firefox/);
  });
});

it('names the three release assets the way the package scripts do', () => {
  expect(assetNames('2.0.0')).toEqual({
    firefox: 'brreg-snap-2.0.0.zip',
    chrome: 'brreg-snap-chrome-2.0.0.zip',
    source: 'brreg-snap-source-2.0.0.zip',
  });
});
