// `pnpm check:docs`: live Markdown only; git supplies the corpus and ignore rules.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';

import { checkDocs, expandPaths, findReferences, selectDocFiles } from './lib/docs-check.mjs';

const exec = promisify(execFile);
const { stdout } = await exec('git', ['ls-files', '-z'], { maxBuffer: 8 * 1024 * 1024 });
const trackedFiles = stdout.split('\0').filter(Boolean);
const readFile = (path) => readFileSync(path, 'utf8');
const candidates = new Set(trackedFiles);
for (const file of selectDocFiles(trackedFiles)) {
  for (const ref of findReferences(readFile(file), file, trackedFiles).references) {
    for (const path of expandPaths(ref.path)) candidates.add(path);
  }
}

// --no-index also catches a tracked path that now matches an ignore rule.
// Exit 1 means none of these paths are ignored; other git failures are fatal.
const ignored = await new Promise((resolve, reject) => {
  const child = execFile('git', ['check-ignore', '--no-index', '-z', '--stdin'],
    { maxBuffer: 8 * 1024 * 1024 }, (error, output) => {
      if (error && error.code !== 1) reject(error);
      else resolve(new Set(output.split('\0').filter(Boolean)));
    });
  child.stdin.end([...candidates].join('\0') + '\0');
});

const result = checkDocs({ trackedFiles, readFile, exists: existsSync, isIgnored: (path) => ignored.has(path) });
for (const hit of result.hits) console.log(`${hit.file}:${hit.line}: ${hit.message}`);
console.log(`Docs check: ${result.filesScanned} files scanned, ${result.referencesChecked} references checked, ${result.sectionRefsSkipped} § refs skipped, ${result.hits.length} hits.`);
process.exitCode = result.hits.length ? 1 : 0;
