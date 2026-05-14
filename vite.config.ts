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

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'firefox115',
    minify: false,
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
        const dist = resolve(__dirname, 'dist');
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
          resolve(__dirname, 'public/manifest.json'),
          resolve(dist, 'manifest.json'),
        );
        if (existsSync(resolve(__dirname, 'public/icons'))) {
          cpSync(
            resolve(__dirname, 'public/icons'),
            resolve(dist, 'icons'),
            { recursive: true },
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
