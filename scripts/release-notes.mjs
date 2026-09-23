// `node scripts/release-notes.mjs X.Y.Z`: prints the CHANGELOG.md section
// for X.Y.Z (the GitHub Release notes, release.yml) and fails if it is
// missing or empty, so a tag without release notes never publishes.
import { readFileSync } from 'node:fs';

import { changelogSection, isVersion } from './lib/release.mjs';

const version = process.argv[2] ?? '';
if (!isVersion(version)) {
  console.error('usage: node scripts/release-notes.mjs X.Y.Z');
  process.exit(2);
}
const section = changelogSection(readFileSync('CHANGELOG.md', 'utf8'), version);
if (!section) {
  console.error(`CHANGELOG.md has no non-empty "## [${version}]" section`);
  process.exit(1);
}
process.stdout.write(`${section}\n`);
