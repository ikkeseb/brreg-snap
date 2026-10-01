// `node scripts/verify-package.mjs X.Y.Z [dir]`: checks the three release
// zips in `dir` (default web-ext-artifacts/) — what actually goes to the
// stores, after packaging. release.yml runs it before the GitHub Release
// exists; publish.yml runs it again on the downloaded Release assets.
//
// Extension zips: the same checks as verify:dist — the manifest
// invariants (scripts/manifest-invariants.mjs) with stamped version ==
// X.Y.Z, every manifest-referenced file present, only the allowed root
// entries, no runtime code generation (the AST scan in
// scripts/codegen-scan.mjs, which needs the dev dependencies installed)
// — plus no source maps or docs. Source zip: the tagged tree (package.json at X.Y.Z, the
// lockfile), no build output. Prints sha256 + size per zip, and adds
// them to the job summary when run in GitHub Actions.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { findCodegen } from './codegen-scan.mjs';
import { check, DIST_ROOT, referencedFiles } from './manifest-invariants.mjs';
import { assetNames } from './lib/release.mjs';
import { readZip } from './lib/zip.mjs';

/** @typedef {import('./lib/zip.mjs').ZipEntry} ZipEntry */

/**
 * @param {ZipEntry[]} entries
 * @param {'firefox' | 'chrome'} target
 * @param {string} version
 * @returns {string[]} violations
 */
export function checkExtensionZip(entries, target, version) {
  const out = [];
  const names = entries.map((e) => e.name);
  for (const root of new Set(names.map((n) => n.split('/')[0]))) {
    if (!DIST_ROOT.includes(root)) out.push(`unexpected entry "${root}" at the package root`);
  }
  for (const n of names) {
    if (n.endsWith('.map')) out.push(`source map in the package: ${n}`);
    if (n.endsWith('.md')) out.push(`doc file in the package: ${n}`);
  }
  const manifestEntry = entries.find((e) => e.name === 'manifest.json');
  if (!manifestEntry) {
    out.push('manifest.json is not at the archive root');
  } else {
    let manifest;
    try {
      manifest = JSON.parse(manifestEntry.data().toString('utf8'));
    } catch (err) {
      out.push(`manifest.json: ${err.message}`);
    }
    if (manifest) {
      out.push(...check(manifest, target, { version }).map((v) => `manifest.json: ${v}`));
      for (const file of referencedFiles(manifest)) {
        if (!names.includes(file)) out.push(`manifest.json: references "${file}", which is not in the package`);
      }
    }
  }
  for (const e of entries) {
    if (!e.name.endsWith('.js')) continue;
    for (const hit of findCodegen(e.data().toString('utf8'), e.name)) {
      out.push(`${e.name}: runtime code generation: ${hit}`);
    }
  }
  return out;
}

/**
 * @param {ZipEntry[]} entries
 * @param {string} version
 * @returns {string[]} violations
 */
export function checkSourceZip(entries, version) {
  const out = [];
  const pkg = entries.find((e) => e.name === 'package.json');
  if (!pkg) out.push('package.json is not at the archive root');
  else {
    const v = JSON.parse(pkg.data().toString('utf8')).version;
    if (v !== version) out.push(`package.json version ${JSON.stringify(v)} != ${version}`);
  }
  if (!entries.some((e) => e.name === 'pnpm-lock.yaml')) out.push('pnpm-lock.yaml is missing');
  for (const root of ['node_modules', 'dist-firefox', 'dist-chrome', 'web-ext-artifacts']) {
    if (entries.some((e) => e.name.startsWith(`${root}/`))) out.push(`build output in the source zip: ${root}/`);
  }
  return out;
}

function main() {
  const [version, dir = 'web-ext-artifacts'] = process.argv.slice(2);
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error('usage: node scripts/verify-package.mjs X.Y.Z [dir]');
    process.exit(2);
  }
  const names = assetNames(version);
  const failures = [];
  const rows = [];
  for (const [kind, name] of Object.entries(names)) {
    const path = join(dir, name);
    let buf;
    try {
      buf = readFileSync(path);
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
      continue;
    }
    let violations;
    try {
      const entries = readZip(buf);
      violations =
        kind === 'source'
          ? checkSourceZip(entries, version)
          : checkExtensionZip(entries, /** @type {'firefox' | 'chrome'} */ (kind), version);
    } catch (err) {
      violations = [err.message];
    }
    failures.push(...violations.map((v) => `${name}: ${v}`));
    rows.push({ name, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') });
  }

  for (const r of rows) console.log(`${r.sha256}  ${String(r.size).padStart(7)}  ${r.name}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Packages ${version}\n\n| File | Bytes | sha256 |\n|---|---:|---|\n` +
        rows.map((r) => `| \`${r.name}\` | ${r.size} | \`${r.sha256}\` |`).join('\n') +
        '\n\n',
    );
  }
  if (failures.length) {
    for (const f of failures) console.error(`FAIL ${f}`);
    process.exit(1);
  }
  console.log(`OK ${Object.values(names).join(', ')}: invariants, referenced files, file set, no eval, version ${version}.`);
}

if (resolve(process.argv[1] ?? '') === resolve(import.meta.filename)) main();
