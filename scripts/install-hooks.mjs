// `prepare` hook: point git at the committed hooks in .githooks/.
//
// No-ops silently unless this package root is itself the top of a git
// work tree: the AMO reviewer builds from a source zip without .git, and
// an unzipped copy inside some other repository must not rewrite that
// repository's config. CI checkouts are work trees, so it runs there
// harmlessly.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

function git(...args) {
  return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
}

let top;
try {
  if (git('rev-parse', '--is-inside-work-tree') !== 'true') process.exit(0);
  top = git('rev-parse', '--show-toplevel');
} catch {
  process.exit(0); // no git binary, or not inside a repository
}

if (realpathSync(top) !== realpathSync(process.cwd())) process.exit(0);

try {
  git('config', 'core.hooksPath', '.githooks');
} catch {
  console.warn('prepare: could not set core.hooksPath; run: git config core.hooksPath .githooks');
}
