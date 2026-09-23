import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import {
  cpSync,
  mkdirSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

// Build target browser, selected via `BROWSER=chrome|firefox`. Defaults
// to firefox so the bare `vite build` / `pnpm watch` keep producing the
// Firefox output. Output goes to dist-<browser>/ and the matching
// public/manifest.<browser>.json is copied in below.
const target = process.env.BROWSER === 'chrome' ? 'chrome' : 'firefox';
const outDir = `dist-${target}`;

export default defineConfig({
  // Disable Vite's automatic public/ copy: it would drag both
  // manifest.<browser>.json source files into the output. The
  // copy-static-assets plugin below copies exactly the right manifest
  // (as manifest.json) plus the icons instead.
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: true,
    target: target === 'chrome' ? 'chrome116' : 'firefox115',
    // Vite's default minifier (Oxc since Vite 8). Source maps are
    // emitted into dist-*/ for local debugging only — packaging excludes
    // them (D12); AMO review uses the full-TS source zip instead.
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'src/popup/popup.html'),
        details: resolve(import.meta.dirname, 'src/details/details.html'),
        background: resolve(import.meta.dirname, 'src/background/background.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background/background.js';
          if (chunk.name === 'details') return 'details/[name].js';
          return 'popup/[name].js';
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (asset) => {
          const name = asset.name ?? '';
          if (name === 'details.html' || name === 'details.css') {
            return 'details/[name][extname]';
          }
          if (name.endsWith('.html') || name.endsWith('.css')) {
            return 'popup/[name][extname]';
          }
          return 'assets/[name][extname]';
        },
      },
    },
  },
  plugins: [
    {
      name: 'copy-static-assets',
      closeBundle() {
        const dist = resolve(import.meta.dirname, outDir);
        if (!existsSync(dist)) mkdirSync(dist, { recursive: true });

        // Vite emits HTML entries under dist/src/<dir>/<file>.html
        // because the input paths live under src/. The manifest and
        // the runtime URLs expect <dir>/<file>.html — move them up
        // and drop the empty dist/src tree.
        relocateHtml('src/popup/popup.html', 'popup/popup.html');
        relocateHtml('src/details/details.html', 'details/details.html');
        if (existsSync(resolve(dist, 'src'))) {
          rmSync(resolve(dist, 'src'), { recursive: true, force: true });
        }

        // Copy the manifest, stamping `"version"` from package.json —
        // the single source of truth for the version. The replacement
        // is string-level on purpose: JSON.parse/stringify would
        // reformat the file, and the built manifest must stay the
        // source manifest byte for byte apart from the version. (AMO
        // re-serialises it when signing, so the signed .xpi never
        // matches.)
        const manifestSrc = readFileSync(
          resolve(import.meta.dirname, `public/manifest.${target}.json`),
          'utf8',
        );
        const pkg = JSON.parse(
          readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'),
        ) as { version: string };
        const versionField = /("version"\s*:\s*")[^"]*(")/g;
        const matches = manifestSrc.match(versionField);
        if (!matches || matches.length !== 1) {
          throw new Error(
            `manifest.${target}.json: expected exactly one "version" field, ` +
              `found ${matches?.length ?? 0}`,
          );
        }
        writeFileSync(
          resolve(dist, 'manifest.json'),
          manifestSrc.replace(versionField, `$1${pkg.version}$2`),
        );
        if (existsSync(resolve(import.meta.dirname, 'public/icons'))) {
          cpSync(
            resolve(import.meta.dirname, 'public/icons'),
            resolve(dist, 'icons'),
            // Skip docs (e.g. icons/README.md) — only ship the PNGs.
            { recursive: true, filter: (src) => !src.endsWith('.md') },
          );
        }

        function relocateHtml(from: string, to: string): void {
          const src = resolve(dist, from);
          const dst = resolve(dist, to);
          if (!existsSync(src)) return;
          mkdirSync(resolve(dst, '..'), { recursive: true });
          renameSync(src, dst);
        }
      },
    },
  ],
});
