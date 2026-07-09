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

`.github/workflows/e2e-smoke.yml` runs this suite against **production**, three
ways:

- **After every production deploy** (`deployment_status`, environment=Production)
  — validates each merge on the real site within ~1 min of going live.
  **Advisory** (not a required check) until proven stable, then promote to
  required in branch protection.
- **Daily** (`schedule`, 02:00 UTC) — a synthetic monitor for the "healthy 200
  but empty" class Sentry can't see, and any drift between deploys.
- **On demand** (`workflow_dispatch`) — against any URL you pass (defaults to
  production).

**Why production, not PR previews:** previews sit behind Vercel Deployment
Protection. `E2E_BYPASS_SECRET` (the Vercel "Protection Bypass for Automation"
token, forwarded as `x-vercel-protection-bypass`) gets the browser past the SSO
wall, but the login round-trip behaves differently through the protected-preview
edge — flaky for reasons unrelated to the app. Production is public and stable,
and testing every merge the moment it deploys is robust coverage. The bypass
secret is kept so you can `workflow_dispatch` against a specific preview URL by
hand; pre-merge preview testing can be revisited later (see the ops plan).
