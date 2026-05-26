/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// eslint-disable-next-line no-underscore-dangle
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    // PR-E (2026-05-25) — named vendor chunks for the largest libraries so
    // they cache as stable artifacts across page navs and so the page-bundle
    // names in the build output actually reflect what's in them (Vite's
    // automatic naming previously labelled the recharts chunk after one of
    // its components, "PieChart-XXX.js", which made bundle-size review
    // confusing). React + the chart / map vendors split into named chunks.
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          // HOTFIX (2026-05-26) — React + React-DOM + scheduler MUST live
          // in a dedicated vendor chunk that's guaranteed to load before
          // any chunk that depends on React. Without this split,
          // vendor-react-router loads first and crashes the page with
          //   TypeError: Cannot read properties of undefined
          //     (reading '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED')
          // react-router-dom accesses React's internal symbol at module
          // load time; that symbol is undefined until React-DOM has
          // finished initialising. Putting react + react-dom + scheduler
          // in vendor-react ensures Rollup's chunk graph orders them
          // before vendor-react-router.
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/recharts/')) return 'vendor-recharts';
          if (id.includes('node_modules/leaflet/') || id.includes('node_modules/react-leaflet/')) {
            return 'vendor-leaflet';
          }
          if (id.includes('node_modules/react-router')) return 'vendor-react-router';
          if (id.includes('node_modules/@tanstack/')) return 'vendor-tanstack';
          if (id.includes('node_modules/lucide-react/')) return 'vendor-icons';
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      // Browser-safe slice of the financial kernel — only what the
      // reactive what-if path needs (computeDeal + asset-class guard).
      // See packages/financial-kernel/src/browser.ts for the curated
      // surface. Kept aliased rather than npm-published because this
      // is still a private workspace package.
      '@redip/kernel-browser': path.resolve(
        __dirname,
        '../packages/financial-kernel/src/browser.ts',
      ),
      // PR-NX26 (2026-05-17): single-source-of-truth ontology JSON
      // consumed by the AutoFillFromDocumentsModal. The backend validates
      // writes against this same v1.json file — keep them in lock-step
      // by importing the JSON directly, not by re-typing field labels.
      '@redip/real-estate-ontology': path.resolve(
        __dirname,
        '../packages/real-estate-ontology/src/v1.json',
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
    include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
  },
});
