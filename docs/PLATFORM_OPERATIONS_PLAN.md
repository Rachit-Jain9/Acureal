# REDIP Platform Operations Plan — "never again" + Vercel Pro / Supabase Pro maximization

_Established 2026-07-08 after the three-round quality sweep (PRs #941/#943/#945). This is the
standing plan for (a) preventing the bug classes the operator hit from recurring, and (b) getting
full value from the paid Vercel Pro + Supabase Pro plans. Grounded in verified facts about THIS
deployment, not generic advice._

## 0. Verified ground truth (2026-07-08)

| Fact | Value | Consequence |
|---|---|---|
| Supabase region | `ap-south-1` (Mumbai) | — |
| Vercel function region | **unset** in vercel.json → default `iad1` (Washington DC) | Every DB round-trip crossed the planet (~200ms each; a deal-open makes dozens). **Fixed: `regions: ["bom1"]`** |
| DB connection | Supavisor transaction pooler `:6543` ✓ | Serverless-safe, no change needed |
| Pool size | 5 (serverless) ✓ | Correct for pooled serverless |
| Crons | 5, all once-daily (legacy Hobby cap) | comps-queue processing bumped to hourly on Pro |
| Bundle | 108 JS chunks, 3.09MB raw, largest 424KB (recharts, isolated) | Budget guard added: chunk ≤520KB, total ≤4MB |
| Analytics / Speed Insights | Both installed in App.jsx ✓ | Use them (monthly review), don't re-buy |
| Backups | Supabase Pro daily ✓ | PITR is an optional paid add-on, deferred |
| Multi-tenant RLS | Verified solid (advisor + manual policy review) | Tier-2 perf rewrites deferred, need isolation retest |

## 1. Why the bugs happened (root causes, from the actual incidents)

1. **Nothing watches production.** The blank-loads, invisible modal close, NaN chips, and blocked
   XLSX sat live until the founder personally hit them. There is no error monitoring; nobody is
   paged; Vercel runtime logs are short-retention.
2. **Unit tests cannot see the screen.** 1,276 frontend tests were green while the close button was
   invisible and the dashboard rendered blank. Visual/flow bugs are invisible to unit tests by
   construction.
3. **No perf budget.** The Leaflet map vendor silently became a dependency of the Deals route; the
   dashboard accumulated a heavyweight query for three booleans. Nothing in CI would ever object.
4. **Config debt.** `retry: 1` (froze transient failures), functions in `iad1` (cross-planet DB),
   crons still shaped by Hobby-plan limits after upgrading to Pro.
5. **Build-then-remove waste.** Portfolio Readiness + Pipeline Velocity were built, shipped, then
   removed as clutter. Feature bets need a cheap check-in before construction, not after.

## 2. The guardrail stack (what prevents each class)

| Layer | Catches | Status |
|---|---|---|
| CI: unit tests + build + audit + migration lint + RLS audit + theme-token guard | logic regressions, bad migrations, RLS-less tables, raw palette classes | ✅ existed |
| CI: **hover-state guard** (`hoverStateGuard.test.js`) | the no-op hover class regressing (fixed twice in #943/#945) | ✅ added (this PR) |
| CI: **bundle budget** (`check-bundle-budget.cjs`) | heavyweight vendors creeping onto routes; chunk/total size creep | ✅ added (this PR) |
| CI: **Playwright E2E smoke** against the PR's Vercel preview | blank pages, dead buttons, invisible controls, broken downloads — the entire class unit tests can't see | ✅ shipped (#952) — advisory; runs vs preview once operator enables Protection Bypass (§6.6) |
| Prod: **Sentry error monitoring** (free tier, EU data residency) | runtime errors real users hit, with stack traces + alert email | ✅ wired frontend + backend (public DSN committed w/ env override; prod-only; privacy-first no-PII; 4xx not reported; browser-extension + chunk noise filtered) |
| Prod: **Vercel Skew Protection** | stale-chunk errors after deploys (replaces the main.jsx reload hack as primary defense) | 🔜 operator toggle |
| Cadence: **weekly automated health check** (scheduled cloud agent) | deploy failures, error spikes, Supabase advisor drift | 🔜 Phase 2 |
| Cadence: **monthly multi-agent quality sweep** (like #943's) | slow accumulation of redundancy/perf/UX debt | operator-triggered |
| Process: **feature check-in before building new surfaces** | build-then-remove waste | standing rule |

### Phase 2 spec — E2E smoke (SHIPPED #952)
- Dedicated **E2E test organization + user** seeded in prod DB (multi-tenant isolation confirmed
  solid, so a test org is invisible to real orgs). Credentials in GitHub Actions secrets
  (`E2E_EMAIL` / `E2E_PASSWORD` / `E2E_ORG_ID`). Owns 2 seeded deals so "renders with data" has data.
- Playwright suite in `e2e/`, runs against a live deployment (PR preview in CI, production locally).
  5 flows, each mapped to a July-2026 operator-facing bug: **dashboard renders WITH data** (the #951
  org-context race guard) → deals list shows deals (not empty) → comps chips have no `NaN` → open deal
  mounts tabs + Activity "Team & access" panel → XLSX export returns 200 + non-empty workbook.
  `global-setup.js` logs in once (ticks Remember-me so the session → localStorage, since storageState
  doesn't capture sessionStorage) + pre-sets the tourStore flags so first-run overlays don't block clicks.
- CI `.github/workflows/e2e-smoke.yml` triggers on Vercel's `deployment_status` (no Vercel token).
  **Advisory** (not a required check) until proven stable, then promote to required.
- **Preview-protection dependency**: Vercel Deployment Protection is ON for previews (they 302 → Vercel
  SSO), so the suite can't reach a preview until the operator enables **Protection Bypass for Automation**
  and adds the token as repo secret `E2E_BYPASS_SECRET` (§6.6). Until then the CI run **skips green with a
  loud warning** (never red) and the suite still runs against production via `workflow_dispatch`.
- Verified: **5/5 vs production**; #951 race guard **4/4** zero flakes; also confirmed live on the
  operator's own org (Pipeline Distribution now renders the stage mix, no "No deals" ghost).

## 3. Vercel Pro — use it fully

| # | Item | Who | Status |
|---|---|---|---|
| V1 | **Functions in Mumbai** (`"regions": ["bom1"]`) — co-locates compute with the ap-south-1 DB and Bengaluru users. Biggest latency win available. | me | ✅ this PR |
| V2 | **Fluid Compute ON** — keeps instances warm between invocations (kills the cold-start class behind the blank-loads) + concurrency billing efficiency. Likely already on (project created 2026-03); verify. | operator (1 click) | 🔜 |
| V3 | **Skew Protection ON** — old browser tabs keep talking to the matching old deployment for hours after a deploy. | operator (1 click) | 🔜 |
| V4 | **Spend Management** — soft alert + hard cap so a runaway can never surprise-bill. | operator (2 min) | 🔜 |
| V5 | **Crons at Pro frequency** — comps-queue processing daily → hourly (was Hobby-capped; costGuard daily AI cap still bounds spend). | me | ✅ this PR |
| V6 | Analytics + Speed Insights — already installed; reviewed in the weekly/monthly cadence rather than adding new paid observability. | me (cadence) | ✅ |
| V7 | Log drain for longer retention | deferred until Sentry proves insufficient | ⏸ |

## 4. Supabase Pro — use it fully

| # | Item | Who | Status |
|---|---|---|---|
| S1 | Daily backups (Pro) — confirmed active; restore option visible. | done | ✅ |
| S2 | Transaction pooler for serverless | done | ✅ |
| S3 | Advisor Tier-1 fixes (dup indexes, FK indexes) | done (#945) | ✅ |
| S4 | **Advisor re-run in the weekly health check** — catch new RLS/perf lints within a week, not months. | me (Phase 2) | 🔜 |
| S5 | **Tier-2 hardening**: `auth_rls_initplan` scalar-subselect rewrites (9 policies), permissive-policy SELECT/ALL split (~186 lints), FORCE RLS consistency (~44 tables) — real at-scale wins, but each touches RLS ⇒ dedicated work block with tenant-isolation retest before/after. | me, operator green-light | 🔜 scheduled |
| S6 | Compute: stays on included tier — data is tiny (largest table ~2.7k rows); upsizing now would be waste. Revisit when p95 query time or connections say so. | — | ✅ right-sized |
| S7 | PITR add-on (~$100/mo) — skip at current data volume; daily backups suffice. Revisit at first paying customer with contractual RPO. | operator ($) | ⏸ |
| S8 | Read replicas / branching — skip; wrong scale. Migrations discipline (lint + idempotent files) is the working substitute. | — | ⏸ |
| S9 | Supabase dashboard account: MFA on. | operator (2 min) | 🔜 |
| S10 | Non-owner DB role for the Express pool so RLS becomes a live second layer (audit item #3) — pairs naturally with S5's retest. | me + operator (conn string) | 🔜 with S5 |

## 5. Operating cadence

- **Every PR**: CI gates (incl. bundle + hover guards + the #952 E2E smoke on the preview) →
  Vercel preview → merge → auto-deploy.
- **Weekly (automated)**: health check — latest prod deploy READY, error scan, Supabase advisors,
  cron success — posted as a short report.
- **Monthly**: multi-agent quality sweep (perf / redundancy / bugs / backend / UX) like #943's;
  Speed Insights + Analytics review.
- **Before any new dashboard widget / tab / surface**: one-line check-in with the operator.

## 6. Operator quick-reference (the only manual steps)

1. **Fluid Compute** — https://vercel.com/rachitjain348-4262s-projects/redip/settings/functions →
   "Fluid Compute" toggle ON (it may already be) → Save.
2. **Skew Protection** — https://vercel.com/rachitjain348-4262s-projects/redip/settings/advanced →
   "Skew Protection" → Enable.
3. **Spend cap** — https://vercel.com/teams/rachitjain348-4262s-projects/settings/billing →
   Spend Management → set alert (e.g. $30) + pause threshold (e.g. $50).
4. **Sentry** — create free account at https://sentry.io → new project (React) → send me the DSN
   string; I wire both frontend + backend and alerts to your email.
5. **Supabase MFA** — https://supabase.com/dashboard/account/security → enable MFA.
6. **Protection Bypass for Automation** (unlocks E2E smoke on previews) —
   https://vercel.com/rachitjain348-4262s-projects/redip/settings/deployment-protection →
   "Protection Bypass for Automation" → **Add Secret** → copy the generated value → send it to me →
   I add it as the GitHub secret `E2E_BYPASS_SECRET`. Until then the smoke test skips (green, warned) on
   previews and runs against production on demand.
