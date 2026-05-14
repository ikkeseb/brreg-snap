import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, cpSync, mkdirSync, existsSync } from 'node:fs';

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
        background: resolve(__dirname, 'src/background/background.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background/background.js';
          return 'popup/[name].js';
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (asset) => {
          if (asset.name?.endsWith('.html')) return 'popup/[name][extname]';
          if (asset.name?.endsWith('.css')) return 'popup/[name][extname]';
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
      },
    },
  ],
});
