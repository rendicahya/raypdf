import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves project sites from /<repo-name>/, so the base path
// must match the repository name. Adjust REPO_NAME if the repo is renamed.
const REPO_NAME = 'signy';

export default defineConfig(({ mode }) => ({
  plugins: [
    svelte(),
    VitePWA({
      // Precaches the app shell for instant offline loads, but never takes
      // over automatically — a new version only replaces the running one
      // once the user acts on the in-app update prompt (App.svelte /
      // UpdateToast.svelte), so an export in progress is never interrupted.
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: 'Signy',
        short_name: 'Signy',
        description: 'Sign PDF documents with protected handwritten signatures, entirely in your browser.',
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
