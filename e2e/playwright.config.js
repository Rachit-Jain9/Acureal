'use strict';

const { defineConfig, devices } = require('@playwright/test');

// Target: PR preview URL in CI (E2E_BASE_URL injected by the workflow),
// production when run locally.
const baseURL = process.env.E2E_BASE_URL || 'https://redip.vercel.app';

// If Vercel Deployment Protection is enabled on preview URLs, requests need a
// bypass header (set E2E_BYPASS_SECRET to the project's protection-bypass token).
// Harmless on the public production URL, so it's always applied when present.
const bypassSecret = process.env.E2E_BYPASS_SECRET;
const bypassHeaders = bypassSecret
  ? { 'x-vercel-protection-bypass': bypassSecret, 'x-vercel-set-bypass-cookie': 'true' }
  : undefined;

module.exports = defineConfig({
  testDir: './tests',
  // A live deployment behind a serverless cold start can be slow on the first
  // hit; give each test room without being flaky.
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  // Log in once, reuse the authenticated session across every test.
  globalSetup: require.resolve('./global-setup'),
  use: {
    baseURL,
    storageState: 'storage/auth.json',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    extraHTTPHeaders: bypassHeaders,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
