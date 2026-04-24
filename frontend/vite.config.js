/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// eslint-disable-next-line no-underscore-dangle
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
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
