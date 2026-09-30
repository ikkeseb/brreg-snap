// `pnpm release X.Y.Z` — the release, scripted. Two steps, because the
// store release notes are written by a human in between:
//
//   pnpm release X.Y.Z [--skip-ci-check]   preflight, bump versions, date
//                                          the CHANGELOG, pnpm verify,
//                                          render the submission kit
//   (write the release notes in docs/submission-kit/X.Y.Z/amo.md)
//   pnpm release X.Y.Z --tag               commit + annotated tag vX.Y.Z,
//                                          print the push command
//
// `--dry-run` runs the read-only checks and prints every step without
// writing anything. Never pushes. The whole flow: docs/release.md.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  changelogSection,
  compareVersions,
  findTodos,
  isVersion,
  kitFields,
  promoteUnreleased,
  reflowForAmo,
  renderTemplate,
  setJsonVersion,
  unreleasedBody,
} from './lib/release.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const FLAGS = ['--dry-run', '--tag', '--skip-ci-check'];
const VERSION_FILES = ['package.json', 'public/manifest.firefox.json', 'public/manifest.chrome.json'];
const KIT_FIELDS = ['release_notes.nb-NO', 'release_notes.en-US', 'approval_notes'];

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--'));
const flags = new Set(args.filter((a) => a.startsWith('--')));
const unknown = [...flags].filter((f) => !FLAGS.includes(f));
if (!version || unknown.length || args.filter((a) => !a.startsWith('--')).length > 1) {
  console.error(
    'usage: pnpm release X.Y.Z [--dry-run] [--skip-ci-check]\n' +
      '       pnpm release X.Y.Z --tag [--dry-run]\n' +
      (unknown.length ? `unknown flag: ${unknown.join(' ')}\n` : '') +
      'See docs/release.md.',
  );
  process.exit(2);
}
const dry = flags.has('--dry-run');
const kitDir = `docs/submission-kit/${version}`;
const kitFiles = [`${kitDir}/amo.md`, `${kitDir}/cws.md`];

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const write = (path, text) => {
  mkdirSync(join(ROOT, path, '..'), { recursive: true });
  writeFileSync(join(ROOT, path), text);
};

/** @param {string[]} a */
function git(...a) {
  return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

let failed = 0;
/** @param {boolean} ok @param {string} msg */
function check(ok, msg) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failed++;
  return ok;
}

/** @param {string} msg @param {() => void} fn */
function step(msg, fn) {
  console.log(`  ${dry ? 'would' : '->'} ${msg}`);
  if (!dry) fn();
}

function localDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** gh, or gh.exe when this runs in WSL against a Windows install. */
function gh(a) {
  for (const bin of ['gh', 'gh.exe']) {
    const r = spawnSync(bin, a, { cwd: ROOT, encoding: 'utf8' });
    if (r.error && /** @type {NodeJS.ErrnoException} */ (r.error).code === 'ENOENT') continue;
    return r;
  }
  return null;
}

function checkRepoState() {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  check(branch === 'main', `on main (on ${branch})`);
  const dirty = git('status', '--porcelain');
  return { branch, dirty };
}

function tagExists(tag) {
  try {
    git('rev-parse', '--quiet', '--verify', `refs/tags/${tag}`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ prepare

function prepare() {
  const tag = `v${version}`;
  const pkg = JSON.parse(read('package.json'));
  console.log(`Release ${version}${dry ? ' (dry run: nothing is written)' : ''}\n\nPreflight`);

  check(isVersion(version), `version ${version} is X.Y.Z`);
  check(
    isVersion(version) && compareVersions(version, pkg.version) > 0,
    `${version} is above the current ${pkg.version}`,
  );
  const { dirty } = checkRepoState();
  check(!dirty, dirty ? `clean working tree (dirty:\n${indent(dirty)})` : 'clean working tree');

  const head = git('rev-parse', 'HEAD');
  let remote = '';
  try {
    remote = git('ls-remote', 'origin', 'refs/heads/main', `refs/tags/${tag}`);
  } catch (err) {
    check(false, `can reach origin (git ls-remote failed: ${firstLine(err)})`);
  }
  if (remote) {
    const main = /^(\w+)\trefs\/heads\/main$/m.exec(remote)?.[1];
    check(main === head, `HEAD ${head.slice(0, 7)} is origin/main (${main?.slice(0, 7) ?? 'missing'})`);
    check(!remote.includes(`refs/tags/${tag}`), `tag ${tag} is not on origin`);
  }
  check(!tagExists(tag), `tag ${tag} does not exist locally`);

  if (flags.has('--skip-ci-check')) {
    console.log('  skip CI status (--skip-ci-check)');
  } else {
    const r = gh(['run', 'list', '--commit', head, '--workflow', 'CI', '--json', 'status,conclusion', '--limit', '1']);
    if (!r) {
      check(false, 'CI green for HEAD (gh not found: install GitHub CLI, or pass --skip-ci-check and check Actions by hand)');
    } else if (r.status !== 0) {
      check(false, `CI green for HEAD (gh failed: ${firstLine(r.stderr)})`);
    } else {
      const [run] = JSON.parse(r.stdout || '[]');
      check(
        run?.status === 'completed' && run.conclusion === 'success',
        `CI green for HEAD (${run ? `${run.status}/${run.conclusion || '-'}` : 'no CI run for this commit'})`,
      );
    }
  }

  const changelog = read('CHANGELOG.md');
  const unreleased = unreleasedBody(changelog);
  check(
    !!unreleased,
    unreleased === null ? 'CHANGELOG.md has a "## [Unreleased]" section' : 'CHANGELOG.md "## [Unreleased]" is not empty',
  );
  check(!existsSync(join(ROOT, kitDir)), `${kitDir}/ does not exist yet`);

  // Compute every new file in memory first: a template or anchor error
  // fails here, before anything is written.
  /** @type {Record<string, string>} */
  const out = {};
  const date = localDate();
  try {
    for (const f of VERSION_FILES) out[f] = setJsonVersion(read(f), version, f);
    if (unreleased) {
      out['CHANGELOG.md'] = promoteUnreleased(changelog, version, date);
      const ctx = {
        version,
        values: {
          version,
          changelog: /** @type {string} */ (changelogSection(out['CHANGELOG.md'], version)),
          privacy_amo: reflowForAmo(read('PRIVACY.md')),
        },
        docs: { amo: read('docs/amo-submission.md'), cws: read('docs/cws-submission.md') },
      };
      out[kitFiles[0]] = renderTemplate(read('docs/submission-kit/templates/amo.md'), ctx);
      out[kitFiles[1]] = renderTemplate(read('docs/submission-kit/templates/cws.md'), ctx);
      check(true, 'submission kit renders from the canonical docs');
    }
  } catch (err) {
    check(false, `inputs render: ${err.message}`);
  }

  if (failed && !dry) return stop();

  console.log('\nSteps');
  for (const f of VERSION_FILES) step(`set "version" ${pkg.version} -> ${version} in ${f}`, () => write(f, out[f]));
  step(`CHANGELOG.md: "## [Unreleased]" -> "## [${version}] — ${date}", new empty [Unreleased] above`, () =>
    write('CHANGELOG.md', out['CHANGELOG.md']),
  );
  for (const f of kitFiles) {
    const todos = out[f] ? findTodos(out[f]).length : 0;
    step(`write ${f}${todos ? ` (${todos} TODO(store-notes) lines to fill)` : ''}`, () => write(f, out[f]));
  }
  step('run pnpm verify', () => {
    const r = spawnSync('pnpm', ['verify'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) {
      console.error(
        `\npnpm verify failed. Fix it and re-run, or undo with:\n` +
          `  git checkout -- ${VERSION_FILES.join(' ')} CHANGELOG.md && git clean -fd ${kitDir}`,
      );
      process.exit(1);
    }
  });

  console.log(
    `\nNext\n  1. Write the release notes (nb-NO + en-US) in ${kitFiles[0]} over the TODO(store-notes) lines.\n` +
      `  2. Review the diff, then: pnpm release ${version} --tag`,
  );
  if (failed) stop();
}

// ---------------------------------------------------------------------- tag

function tagRelease() {
  const tag = `v${version}`;
  console.log(`Tag ${tag}${dry ? ' (dry run: nothing is written)' : ''}\n\nPreflight`);
  const pkg = JSON.parse(read('package.json'));
  check(
    pkg.version === version,
    `package.json version is ${version}${pkg.version === version ? '' : ` (${pkg.version}: run "pnpm release ${version}" first)`}`,
  );
  checkRepoState();
  check(!tagExists(tag), `tag ${tag} does not exist locally`);

  const expected = [...VERSION_FILES, 'CHANGELOG.md', ...kitFiles];
  // -z: NUL-separated and unquoted; not trimmed (the status column can
  // start with a space).
  const changed = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .map((l) => l.slice(3));
  const extra = changed.filter((p) => !expected.includes(p));
  const missing = expected.filter((p) => !changed.includes(p));
  check(!extra.length, `only release files changed${extra.length ? ` (also: ${extra.join(', ')})` : ''}`);
  check(!missing.length, `every release file changed${missing.length ? ` (unchanged: ${missing.join(', ')})` : ''}`);

  const section = changelogSection(read('CHANGELOG.md'), version);
  check(!!section, `CHANGELOG.md has a non-empty "## [${version}]" section`);

  for (const f of kitFiles) {
    if (!check(existsSync(join(ROOT, f)), `${f} exists`)) continue;
    const text = read(f);
    const todos = findTodos(text);
    check(!todos.length, `${f}: no TODO(store-notes) left${todos.length ? ` (lines ${todos.join(', ')})` : ''}`);
  }
  if (existsSync(join(ROOT, kitFiles[0]))) {
    try {
      const fields = kitFields(read(kitFiles[0]));
      for (const name of KIT_FIELDS) check(!!fields[name], `${kitFiles[0]}: field ${name} is filled`);
    } catch (err) {
      check(false, `${kitFiles[0]}: ${err.message}`);
    }
  }

  if (failed && !dry) return stop();

  console.log('\nSteps');
  step(`git add ${expected.join(' ')}`, () => git('add', '--', ...expected));
  step(`git commit -m "release: ${version}"`, () => git('commit', '-m', `release: ${version}`));
  step(`git tag -a ${tag} -m "brreg-snap ${version}"`, () => git('tag', '-a', tag, '-m', `brreg-snap ${version}`));

  console.log(
    `\nNext (not run — pushing is yours; the pre-push hook runs pnpm verify):\n` +
      `  git push --atomic origin main ${tag}\n` +
      `Then release.yml builds the GitHub Release; publish with the "Publish to stores" workflow (docs/release.md).`,
  );
  if (failed) stop();
}

function stop() {
  console.error(`\n${failed} preflight check(s) failed${dry ? '' : '; nothing was written'}.`);
  process.exit(1);
}

const indent = (s) => s.replace(/^/gm, '      ');
const firstLine = (e) => String(e?.stderr || e?.message || e).trim().split('\n')[0];

if (flags.has('--tag')) tagRelease();
else prepare();
