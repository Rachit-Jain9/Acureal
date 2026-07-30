'use strict';

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Log in ONCE (via the real login form) and persist the authenticated session
// so every test reuses it. Runs before the suite (playwright.config globalSetup).
module.exports = async () => {
  const baseURL = process.env.E2E_BASE_URL || 'https://acureal.in';
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error('E2E_EMAIL and E2E_PASSWORD must be set (GitHub Actions secrets, or local env).');
  }

  const storageDir = path.join(__dirname, 'storage');
  fs.mkdirSync(storageDir, { recursive: true });

  // Mirror the config's Vercel protection-bypass header so the login navigation
  // itself isn't blocked on a protected preview URL.
  const bypassSecret = process.env.E2E_BYPASS_SECRET;
  const extraHTTPHeaders = bypassSecret
    ? { 'x-vercel-protection-bypass': bypassSecret, 'x-vercel-set-bypass-cookie': 'true' }
    : undefined;

  const browser = await chromium.launch();
  const context = await browser.newContext({ extraHTTPHeaders });
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);

    // Acureal stores the cached `user` in sessionStorage unless "Remember me" is
    // checked. Playwright's storageState captures cookies + localStorage but
    // NOT sessionStorage — so without this tick the restored context would lack
    // the user object and ProtectedRoute would bounce every test to /login.
    const remember = page.locator('input[type="checkbox"]').first();
    if (await remember.count()) {
      await remember.check().catch(() => {});
    }

    await Promise.all([
      page.waitForURL(/\/dashboard/, { timeout: 45_000 }),
      page.locator('input[name="password"]').press('Enter'),
    ]);
    // Confirm the authenticated shell actually rendered before snapshotting.
    await page.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 30_000 });

    // Suppress the first-run onboarding overlays for this fresh test account.
    // tourStore reads these localStorage flags at init: without them the sidebar
    // welcome modal AND the deal-workspace tour auto-open as full-screen overlays
    // that intercept every click. storageState captures localStorage, so setting
    // them here carries the "already onboarded" state into every test.
    await page.evaluate(() => {
      localStorage.setItem('redip.productTour.completed', '1');
      localStorage.setItem('redip.dealWorkspaceTour.completed', '1');
      localStorage.setItem('redip.gettingStarted.dismissed', '1');
    });

    await page.context().storageState({ path: path.join(storageDir, 'auth.json') });
  } finally {
    await browser.close();
  }
};
