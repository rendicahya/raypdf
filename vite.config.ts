import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { createReadStream, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// GitHub Pages serves project sites from /<repo-name>/, so the base path
// must match the repository name. Adjust REPO_NAME if the repo is renamed.
const REPO_NAME = 'raypdf';

// Text recognition (lib/pdf/ocr.ts) runs tesseract.js in a worker, which
// loads these by URL rather than through the bundle. They're served from
// ocr/ under fixed names and left out of the precache: they're downloaded
// (and then cached for offline use) only once someone recognizes text.
const OCR_FILES: Record<string, string> = {
  'worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  // The build with the WebAssembly inside, so there's no second file to locate.
  'tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};

function ocrFiles(): Plugin {
  const source = (name: string) => fileURLToPath(new URL(OCR_FILES[name], import.meta.url));
  return {
    name: 'raypdf-ocr-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.match(/\/ocr\/([^/?]+)/)?.[1];
        if (!name || !(name in OCR_FILES)) return next();
        res.setHeader('Content-Type', name.endsWith('.gz') ? 'application/gzip' : 'text/javascript');
        createReadStream(source(name)).pipe(res);
      });
    },
    generateBundle() {
      for (const name of Object.keys(OCR_FILES)) {
        this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(source(name)) });
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    svelte(),
    ocrFiles(),
    VitePWA({
      // Precaches the app shell for instant offline loads, but never takes
      // over automatically — a new version only replaces the running one
      // once the user acts on the in-app update prompt (App.svelte /
      // UpdateToast.svelte), so an export in progress is never interrupted.
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: 'RayPDF',
        short_name: 'RayPDF',
        description: 'Sign, fill, edit, and protect PDFs in one go, right in your browser.',
        theme_color: '#2563eb',
        background_color: '#0a0a0a',
        display: 'standalone',
        start_url: mode === 'production' ? `/${REPO_NAME}/` : '/',
        scope: mode === 'production' ? `/${REPO_NAME}/` : '/',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        // Default globPatterns omit `.mjs`, which silently drops the pdf.js
        // worker (built as `pdf.worker.min-*.mjs`) from the precache — it
        // has to be listed explicitly alongside the usual extensions.
        // woff2 covers the bundled handwriting fonts for typed signatures.
        globPatterns: ['**/*.{js,mjs,css,html,svg,webmanifest,woff2}'],
        // The OCR files are a few MB, so they're cached on first use instead
        // (the language data by tesseract.js itself, in IndexedDB).
        globIgnores: ['ocr/**'],
        runtimeCaching: [
          {
            urlPattern: /\/ocr\/[^/]+\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'raypdf-ocr' },
          },
        ],
        // The pdf.js worker and main bundle are a few MB together; precaching
        // them is exactly the point (instant, offline-capable loads), so the
        // default 2 MB per-file limit needs raising rather than excluding them.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  base: mode === 'production' ? `/${REPO_NAME}/` : '/',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
}));
