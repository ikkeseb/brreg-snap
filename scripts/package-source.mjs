// AMO source-review zip: `git archive` of the tag v<package.json version>,
// never HEAD, so a docs commit after the tag can't leak into the source
// the reviewer rebuilds. Plain Node (no shell), so it runs the same under
// cmd.exe, PowerShell and sh.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = `v${version}`;

try {
  execFileSync('git', ['rev-parse', '--verify', '--quiet', `${tag}^{commit}`], {
    stdio: 'ignore',
  });
} catch {
  console.error(`package:source: tag ${tag} not found — tag the release first.`);
  process.exit(1);
}

mkdirSync('web-ext-artifacts', { recursive: true });
const out = `web-ext-artifacts/brreg-snap-source-${version}.zip`;
execFileSync('git', ['archive', '--format=zip', '-o', out, tag], { stdio: 'inherit' });
console.log(`Wrote ${out} from ${tag}`);
