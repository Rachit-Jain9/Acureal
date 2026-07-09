'use strict';

// REDIP production smoke suite.
//
// Every assertion here maps to a bug that actually shipped to the operator in
// July 2026 and would have been caught before merge if this ran on the PR
// preview. The suite logs in as an isolated test org (2 seeded deals) and
// click-tests the real UI against a live deployment.
//
//   • Empty dashboard / Deals list  — the transaction-pooler org-context race
//     (#951). The dashboard showed "No deals in your pipeline" while deals
//     existed. This is the headline regression guard.
//   • NaN filter chips on Comps      — (#... Comps NaN fix)
//   • Missing "Team & access" panel  — people-sharing added to the Activity tab
//   • Broken XLSX export             — "my excel file I can't download"
//
// storageState (authenticated session) is injected by playwright.config +
// global-setup, so each test starts already logged in.

const { test, expect } = require('@playwright/test');

const SEEDED_DEAL = 'E2E Whitefield Apartments';

// Assert the app didn't bounce us to /login and no error boundary fired.
async function expectAuthenticatedShell(page) {
  await expect(page).not.toHaveURL(/\/login/);
  // ErrorBoundary / crash text must be absent.
  await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
}

test.describe('REDIP production smoke', () => {
  test('dashboard renders WITH data — org-context race guard (#951)', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    // The authenticated shell mounted (heading present, not redirected to login).
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expectAuthenticatedShell(page);

    // Both distribution cards must render their titles (page fully painted).
    await expect(page.getByText('Pipeline Distribution')).toBeVisible();
    await expect(page.getByText('City Distribution')).toBeVisible();

    // THE regression guard: with deals in the org, the pipeline chart must NOT
    // show the empty state. This is the exact string that appeared next to a
    // populated City Distribution during the pooler race.
    await expect(page.getByText('No deals in your pipeline')).toHaveCount(0);
  });

  test('deals list shows the seeded deals (not the empty state)', async ({ page }) => {
    await page.goto('/dashboard/deals', { waitUntil: 'domcontentloaded' });
    await expectAuthenticatedShell(page);

    await expect(page.getByRole('heading', { name: SEEDED_DEAL })).toBeVisible();
    await expect(page.getByText('No deals found')).toHaveCount(0);
  });

  test('comps page renders without NaN filter chips', async ({ page }) => {
    await page.goto('/dashboard/comps', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Comparables' })).toBeVisible();
    await expectAuthenticatedShell(page);

    // The NaN filter-chip bug rendered literal "NaN" into range chips. No
    // rendered text on a healthy page should contain it.
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('NaN');
  });

  test('opening a deal mounts its tabs and the Activity "Team & access" panel', async ({ page }) => {
    await page.goto('/dashboard/deals', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: SEEDED_DEAL }).click();

    // Deal workspace mounted — the Activity tab exists.
    const activityTab = page.getByRole('tab', { name: /activity/i }).or(
      page.getByRole('button', { name: /activity/i }),
    ).first();
    await expect(activityTab).toBeVisible();
    await activityTab.click();

    // People-sharing lives at the top of the Activity tab.
    await expect(page.getByText('Team & access')).toBeVisible();
    await expectAuthenticatedShell(page);
  });

  test('XLSX export returns 200 with a non-empty workbook', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    // Hit the same endpoint the "Export deals to Excel" button uses, from the
    // authenticated page context (cookies attached via credentials:include).
    const result = await page.evaluate(async () => {
      const res = await fetch('/api/exports/deals/xlsx', { credentials: 'include' });
      const buf = await res.arrayBuffer();
      return {
        status: res.status,
        contentType: res.headers.get('content-type') || '',
        bytes: buf.byteLength,
      };
    });

    expect(result.status).toBe(200);
    expect(result.contentType).toContain('spreadsheetml');
    expect(result.bytes).toBeGreaterThan(1000); // a real workbook, not an error blob
  });
});
