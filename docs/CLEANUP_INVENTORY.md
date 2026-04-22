# Cleanup inventory

Tracks the files and folders that can be deleted once the corresponding
parity / safety gate closes. Nothing here is deleted speculatively —
every entry is pinned to a concrete gate that must pass first.

## Gate 1 — Legacy JS financial engine

**Status (2026-04-22): ✅ GATE CLOSED & LEGACY DELETED.**

**What was removed** (single atomic change, all tests green before and after):
- `backend/src/engines/financial.engine.js` (2,767 lines)
- `backend/src/engines/kernel.adapter.js` (`FIN_KERNEL_V2` overlay — now unconditional)
- `backend/tests/financial.engine.test.js`
- `backend/tests/kernel.parity.test.js`
- `backend/tests/kernel.legacyShape.parity.test.js`
- `backend/tests/kernel.capitalStack.parity.test.js`
- `backend/tests/kernel.cashFlows.parity.test.js`
- `backend/tests/kernel.usaliPnl.parity.test.js`

**What replaced it**:
- `backend/src/engines/kernel.service.js` — kernel-native JS adapter. Calls
  `computeDeal` from `@redip/financial-kernel`, flattens Decimal-typed output
  to the legacy camelCase shape, dispatches the correct capital-stack builder
  per asset class, and synthesises hospitality's construction→permanent
  refinancing + European 4-tier waterfall using the kernel's
  `buildAmortizingSchedule` and `buildHospitalityWaterfall` primitives.
- `backend/tests/kernel.service.acceptance.test.js` — 28 hard-golden-value
  assertions across every asset class, covering KPIs, cost bucket topology,
  area breakdown, revenue, capital stack, waterfall, scenarios, and
  sensitivity matrix. Golden values pinned to the kernel's current outputs
  at 1-bp / 50k-INR tolerance.

**Test coverage before/after**:
- Before: 178 tests (backend) + 392 (kernel) = 570
- After:  101 tests (backend) + 392 (kernel) = 493
- Net -77 tests, all duplicative parity assertions. Kernel acceptance is
  now the single truth; kernel's own unit suite still enforces every
  post-processor invariant.

**Closure history** (kept for audit):
1. Hospitality kernel refactored (`packages/financial-kernel/src/assets/hospitality.ts`) to use
   the per-BUA-sqft hard-cost model, Karnataka stamp+betterment, soft-design/approvals/FF&E/OS&E/
   WC/pre-opening, 5% contingency, and the mid-draw IDC formula.
2. Hospitality input schema relaxed (`packages/financial-kernel/src/inputSchema.ts`) to accept
   `hardCostPerSqft` in place of `constructionCostPerKey`.
3. Global assumption defaults (`packages/financial-kernel/src/assumptions.ts`) aligned to
   USALI-typical output: `fbRevPct 30 / otherRevPct 9 / gopMarginPct 30 / ebitdaMarginPct 22`.
4. `finalizeResult` accepts a `grossMarginPctOverride` so hospitality reports EBITDA margin.
5. `kernel.service.js` ports the hospitality refi/waterfall synthesis inline using kernel
   primitives (no maths re-implemented, just glue).
6. `financial.service.js` imports from `kernel.service` directly — no `FIN_KERNEL_V2` gate.

## Gate 2 — Python debt-engine companion

**Status (2026-04-22 audit): ✅ ALREADY CLOSED.**

A repo-wide grep for `.py` files, `debt-engine-py/` directories, and
`DEBT_ENGINE_PY_URL` runtime references returns nothing in live code —
only in legacy docs. The Python FastAPI companion was retired as part of
the 2026-04 consolidation (see `packages/financial-kernel/src/orchestration/featureFlag.ts:16-18`).

The in-process TypeScript debt engine
(`packages/financial-kernel/src/debt-engine/*`) is the sole runtime.
Operator escape hatches that remain: `DEBT_ENGINE_KILL` (emergency
zero-overlay) and `DEBT_ENGINE_SILENT` (test-log suppression).

## Gate 3 — Hardcoded India constants

**Gate**: already closed as of 2026-04-21. All references now route through
`packages/financial-kernel/src/config/india.ts`.

**Nothing to delete** — the old constants were replaced in place in
`packages/financial-kernel/src/assets/common.ts` rather than duplicated.

**Follow-up** (low priority): grep the repo for hardcoded `0.05`, `0.066`,
`0.18`, `43_560`, `1e7` and route any remaining call sites through the
config module. Low-priority because the kernel is the only load-bearing
consumer of these rates.

## Gate 4 — Investor package — cryptographic signing

**Gate**: key management provisioned (HSM/KMS), signing service deployed, verification UX shipped, compliance sign-off on the scheme.

**Currently**: `handleInvestorPackage` returns an unsigned package. Nothing to delete until the signed path ships — then the unsigned fallback (if any) can be removed. Tracked in `TODO_MANUAL.md` item 9.

## How to update this doc

- When you close a gate, move the section under `## Closed gates` at the bottom with a timestamp.
- When you open a new gate (a new cleanup-when-ready item), add a section matching the pattern above.
- Keep gate definitions executable — point at a specific test, env var, or migration that proves the gate closed. Prose gates ("when we're ready") rot.

## Closed gates

### 2026-04-22 — Gate 1 (legacy JS financial engine)

See "Gate 1" above for the full deletion manifest and the replacement
surface. `kernel.service.js` is now the sole path for financial
computation in the backend.
