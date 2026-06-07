import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  existsSync,
  renameSync,
  rmSync,
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
    // esbuild minify is fast and produces correct output for our DOM
    // code (no eval, no Function constructor, no name-sensitive
    // reflection). Source maps stay enabled so AMO review can map
    // minified output back to the original TS.
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.html'),
        details: resolve(__dirname, 'src/details/details.html'),
        background: resolve(__dirname, 'src/background/background.ts'),
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
        const dist = resolve(__dirname, outDir);
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

        copyFileSync(
          resolve(__dirname, `public/manifest.${target}.json`),
          resolve(dist, 'manifest.json'),
        );
        if (existsSync(resolve(__dirname, 'public/icons'))) {
          cpSync(
            resolve(__dirname, 'public/icons'),
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
