// Build-graph guard (vite.config.ts): the last line behind "zero runtime
// dependencies" and "src is TypeScript". ESLint sees import specifiers;
// this sees what the bundler actually resolved. The build fails when any
// module in the graph, or any emitted asset's source file, is outside
// src/ or has an extension not listed below — whether it arrived through
// a relative '../../node_modules/...' import, an HTML <script> entry, a
// CSS url() or a URL import left external.
//
// Not covered: CSS @import (Vite inlines it inside its CSS transform, so
// it never becomes a graph module; src CSS only @imports
// ../styles/shared.css today) and url() assets small enough to be
// inlined as data: URIs (no file is emitted).
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Source formats the extension may be built from. */
export const ALLOWED_EXTENSIONS = ['.ts', '.html', '.css', '.woff2', '.png', '.svg'];

/**
 * Vite's own runtime helpers, injected as '\0' virtual modules. Any other
 * virtual module (a plugin's, rolldown's runtime) fails until reviewed
 * and listed here.
 */
export const ALLOWED_VIRTUAL = ['\0vite/modulepreload-polyfill.js', '\0vite/preload-helper.js'];

/**
 * @param {string} id resolved module id (or asset source path)
 * @param {string} srcDir absolute path of src/
 * @returns {string | null} why the id may not be bundled; null when it may
 */
export function moduleViolation(id, srcDir) {
  if (ALLOWED_VIRTUAL.includes(id)) return null;
  if (id.startsWith('\0')) return 'virtual module not on the allowlist';
  if (id.includes('?')) return 'query-suffixed import (?raw, ?url, ?inline, ...)';
  if (!isAbsolute(id)) return 'not a local file (external or URL import)';
  const rel = relative(srcDir, id);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return 'outside src/';
  const ext = extname(id);
  if (!ALLOWED_EXTENSIONS.includes(ext)) return `"${ext}" is not an allowed source format`;
  return null;
}

/**
 * @param {{ root: string, srcDir: string }} dirs absolute paths
 * @returns {import('vite').Plugin}
 */
export function buildGraphGuard({ root, srcDir }) {
  return {
    name: 'build-graph-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      const bad = [];
      const checkId = (id, what) => {
        const why = moduleViolation(id, srcDir);
        if (why) bad.push(`${what} ${JSON.stringify(id)}: ${why}`);
      };
      // The whole module graph, not just chunk.moduleIds: a module that
      // tree-shakes away today may not tomorrow.
      for (const id of this.getModuleIds()) checkId(id, 'module');
      for (const out of Object.values(bundle)) {
        if (out.type !== 'asset') continue;
        for (const name of out.originalFileNames) checkId(resolve(root, name), `asset ${out.fileName} from`);
      }
      if (bad.length) {
        this.error(
          `build-graph-guard: the bundle may only contain src/ files of type ` +
            `${ALLOWED_EXTENSIONS.join(' ')} (zero runtime deps, CLAUDE.md § Dependencies):\n  ` +
            bad.join('\n  '),
        );
      }
    },
  };
}
