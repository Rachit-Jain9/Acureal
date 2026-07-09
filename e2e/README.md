# REDIP E2E smoke tests

Playwright click-tests that run against a **live deployment** — the PR's Vercel
preview in CI, production when run locally. Every assertion maps to a bug that
actually reached the operator in July 2026, so this suite is the net that
catches those regressions before they ship again:

| Test | Guards against |
|------|----------------|
| dashboard renders WITH data | the transaction-pooler org-context race (#951) — dashboard showed "No deals in your pipeline" while deals existed |
| deals list shows seeded deals | the same race emptying the Deals list |
| comps page has no NaN chips | NaN filter-chip regression |
| deal opens → Activity "Team & access" | the people-sharing panel disappearing |
| XLSX export returns a workbook | "my excel file I can't download" |

## Run it locally (against production)

```bash
cd e2e
npm install
npx playwright install chromium

E2E_EMAIL='<test-account-email>' \
E2E_PASSWORD='<test-account-password>' \
npx playwright test
```

- Target a different deployment with `E2E_BASE_URL=https://<preview>.vercel.app`.
- The suite logs in **once** (`global-setup.js`), ticks "Remember me" so the
  session persists to `localStorage` (Playwright's `storageState` doesn't
  capture `sessionStorage`), suppresses the first-run onboarding overlays, and
  reuses that session across every test.

## The test account

A dedicated, isolated org — **never a real customer or the operator's login**.
It owns two seeded deals (`E2E Whitefield Apartments`, `E2E Sarjapur Plotted`)
so the "renders with data" assertions have something to render. Credentials live
in GitHub Actions secrets: `E2E_EMAIL`, `E2E_PASSWORD` (and `E2E_ORG_ID`).

## CI

`.github/workflows/e2e-smoke.yml` runs this suite three ways:

- **On each PR preview** (`deployment_status`) — against the live preview URL.
  **Advisory** (not a required check) until proven stable, then promote to
  required in branch protection.
- **Daily against production** (`schedule`, 02:00 UTC) — a synthetic monitor for
  the "healthy 200 but empty" class Sentry can't see, and any regression that
  slips in between PRs. No secret needed (production is public).
- **On demand** (`workflow_dispatch`) — against any URL you pass (defaults to
  production).

If preview URLs are ever put behind Vercel Deployment Protection, add an
`E2E_BYPASS_SECRET` repo secret (the project's protection-bypass token); the
config forwards it automatically. Production is public, so this is unset today.
