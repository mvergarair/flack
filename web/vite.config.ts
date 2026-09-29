/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

// The Flack version (root package.json) and the GitHub repo whose releases the admin page
// checks for updates. Forks can point it at their own repo, or set it empty to turn it off.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const updateRepo = process.env.VITE_FLACK_UPDATE_REPO ?? 'mvergarair/flack';

export default defineConfig({
  define: {
    __FLACK_VERSION__: JSON.stringify(version),
    __FLACK_UPDATE_REPO__: JSON.stringify(updateRepo),
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: true, type: 'module' },
      manifest: {
        name: 'Flack',
        short_name: 'Flack',
        description: 'Team chat',
        theme_color: '#1E2B2F',
        background_color: '#FFFFFF',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    host: '127.0.0.1',
    // Pre-transform the app on startup so the first page load isn't slowed by compilation.
    warmup: { clientFiles: ['./src/main.tsx'] },
  },
  // Pre-bundle every SDK entry up front: discovering one lazily triggers a full page reload.
  optimizeDeps: {
    include: [
      'react',
      'react-dom/client',
      'react-router',
      'firebase/app',
      'firebase/auth',
      'firebase/firestore',
      'firebase/database',
      'firebase/storage',
      'firebase/functions',
      'firebase/messaging',
      'marked',
      'dompurify',
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
