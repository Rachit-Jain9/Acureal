# Phase-03 Orchestration Merge & Rollout Plan

Target: merge `phase-03-orchestration` (which carries commits for phases 1–6) into `master`.

## State snapshot

- Merge base: `725ca07` ("Replace deal XLSX export…").
- Diff vs master: **115 files / +18,175 / −3**.
- `git merge-tree` conflict count: **0**.
- Phase branch does not touch `backend/src/engines/financial.engine.js`; master's PRs #4–#7 only touch that file. No line-level overlap.

## What the phase branch delivers

| Phase | Contribution |
|---|---|
| 1 | `packages/financial-kernel` TS package: units converter, assumption hierarchy, normalized input schema, canonical kernel (84 tests). |
| 2 | Facility-based debt engine (amortizing/bullet/balloon/refinance), CFADS, covenants, DSCR sculpt. |
| 3 | `FinancialOrchestrator` wiring debt + CFADS + waterfall + covenants + KPIs; TS inline path plus optional Python path. |
| 4 | Investor package output; FastAPI service; Supabase monitoring migration; edge function. |
| 5 | Python as canonical SoT for debt, Supabase snapshot persistence. |
| 6 | Engine always-on; `DEBT_ENGINE_V2` flag retired; `DEBT_ENGINE_KILL` safe-mode. |

Tip test counts (from phase-06 commit): 222 Jest + 109 backend + 9 pytest = **340**.

## The real risk: semantic gap, not textual conflict

Master PRs #4–#7 added inputs on the legacy engine that the kernel does not model the same way:

| Master input (legacy) | Kernel analog |
|---|---|
| `debtLTV`, `debtLTC` | Covenant spec `maxLTV` / `maxLTC` — **inputs, not derived**. Need mapping. |
| `debtTenorYears` | `FacilitySpec.tenor` — **not a top-level field**. Need mapping. |
| DSCR cap at loan term | Engine outputs DSCR per period; "cap at loan term" behaviour is absent. |
| Exit cap rate KPI | Kernel KPI registry does not currently emit it. |

Without reconciliation, merging silently drops these inputs at the `financial.service` boundary and the UI changes from PRs #4–#7 lose their effect.

**Required reconciliation work before merge:**
1. Extend the kernel's `inputSchema.ts` to accept `debtLTV`, `debtLTC`, `debtTenorYears` as canonical keys and map them into a synthesized `FacilitySpec`.
2. Port the "DSCR cap at loan term" behaviour into the kernel's debt engine (or document the divergence).
3. Surface exit cap rate via the KPI registry so the frontend KPI tile continues to render.
4. Add a reconciliation test: the same deal fixture through legacy vs kernel must agree on DSCR, schedule, and KPIs to ≥4 decimals.

This work is **not** in any phase commit today. It is the gate.

## Infra dependencies

- **Supabase migration**: `supabase/migrations/20260418010000_intelligence_monitoring.sql` (163 lines, idempotent, RLS-scoped to `current_organization_id()`). No numbering conflict with master's `20260418110617_remote_schema.sql`.
- **Supabase edge function**: `supabase/functions/investor-package/` must be deployed (phase-06 commit claims it is already live on project `lsbhrbvuynzqhdtzczco`; verify before relying on it).
- **vercel.json**: adds a kernel `tsc` build into `installCommand` and adds `packages/financial-kernel/dist/**` to serverless `includeFiles`. TS build becomes deploy-blocking.
- **Python function**: `api/investor-package.py` (FastAPI). Optional — omit `DEBT_ENGINE_PY_URL` to run pure TS.

## Environment flags introduced

| Var | Default | Purpose |
|---|---|---|
| `DEBT_ENGINE_KILL` | unset (off) | Kill-switch → safe-mode zero overlay. |
| `DEBT_ENGINE_PY_URL` | unset | Route debt math to Python FastAPI. If unset, inline TS. |
| `DEBT_ENGINE_SILENT` | unset | Suppress monitoring logs (tests). |
| `FASTAPI_URL` | unset | Edge function → Python service base URL. |

Launch with all unset except optionally `DEBT_ENGINE_PY_URL`.

## Rollout sequence

1. **Reconciliation PR** on a new branch off phase-03 tip: map `debtLTV` / `debtLTC` / `debtTenorYears` into `FacilitySpec`, port DSCR cap behaviour, expose exit cap rate KPI. Add reconciliation test vs legacy fixture. Must pass the existing 340-test suite plus the new reconciliation test.
2. **Staging deploy**: apply Supabase migration on staging; deploy edge function; deploy Vercel with kernel build enabled; leave `DEBT_ENGINE_PY_URL` unset (TS inline only).
3. **Shadow run**: for a week, log divergences between legacy KPIs and kernel KPIs on real deals. Target: zero divergence after reconciliation.
4. **Merge to master**: `git merge --no-ff phase-03-orchestration` after the reconciliation PR is green. Single merge commit.
5. **Prod deploy**: apply migration, deploy edge function, deploy backend. Leave `DEBT_ENGINE_KILL` unset.
6. **Opt-in Python path**: once stable, set `DEBT_ENGINE_PY_URL` in prod to route debt math to FastAPI. TS stays as the automatic fallback on error.

## Rollback

- Primary: set `DEBT_ENGINE_KILL=1` → safe-mode zero overlay within one request cycle, no code redeploy.
- Secondary: revert the merge commit; Supabase migration is additive and idempotent so it can stay.

## Open questions to resolve before step 1

- Is the `investor-package` edge function on project `lsbhrbvuynzqhdtzczco` actually still deployed, or was it removed between branches? Check `supabase functions list`.
- Does the kernel's assumption hierarchy need a Bengaluru-default layer for India-first defaults, or is the asset-class default layer sufficient?
- Do we want `DEBT_ENGINE_PY_URL` on from day one in prod, or TS-only for the first week?
