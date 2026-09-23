// A minimal zip reader (central directory + stored/deflate entries), so
// scripts/verify-package.mjs needs neither a dependency nor `unzip`
// (absent on stock Windows). No ZIP64, no encryption: the release zips
// are a few hundred KB and made by web-ext and git archive.
import { Buffer } from 'node:buffer';
import { crc32, inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

/**
 * @typedef {{ name: string, size: number, data: () => Buffer }} ZipEntry
 */

/**
 * @param {Buffer} buf the whole zip file
 * @returns {ZipEntry[]} file entries (directory entries skipped)
 */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('not a zip file (no end of central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error('ZIP64 is not supported');

  /** @type {ZipEntry[]} */
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CEN) throw new Error(`bad central directory entry #${n}`);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error(`${name}: encrypted entries are not supported`);

    entries.push({
      name,
      size,
      data() {
        if (buf.readUInt32LE(local) !== LOC) throw new Error(`${name}: bad local header`);
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + csize);
        let out;
        if (method === 0) out = Buffer.from(raw);
        else if (method === 8) out = inflateRawSync(raw);
        else throw new Error(`${name}: compression method ${method} is not supported`);
        if (out.length !== size || crc32(out) >>> 0 !== crc) throw new Error(`${name}: CRC or size mismatch`);
        return out;
      },
    });
  }
  return entries;
}
