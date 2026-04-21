# Cleanup inventory

Tracks the files and folders that can be deleted once the corresponding
parity / safety gate closes. Nothing here is deleted speculatively —
every entry is pinned to a concrete gate that must pass first.

## Gate 1 — Legacy JS financial engine

**Gate**: `backend/tests/kernel.parity.test.js` — all asset-class parity tests
must assert hard epsilons on totalCost, revenue, grossMargin, and class-specific
KPIs (NOI/yield for income, revPAR/EBITDA for hospitality, RLV for merchant-sale).

**Status (2026-04-21 post hospitality alignment): ✅ GATE CLOSED — all 31 parity tests PASS as HARD ASSERTIONS.**

| Asset class              | Status     | Worst Δ        | Notes                                             |
| ------------------------ | ---------- | -------------- | ------------------------------------------------- |
| residential_apartments   | ✅ PASS    | 0.0000         | HARD ASSERTIONS on totalCost/margin/RLV           |
| plotted_development      | ✅ PASS    | 0.34 pp margin | Within epsilon (diff from dev-cost GST routing)   |
| commercial_office        | ✅ PASS    | 0.0000         | HARD ASSERTIONS on totalCost/revenue/NOI/yield    |
| retail                   | ✅ PASS    | 0.0000         | HARD ASSERTIONS on totalCost/revenue/NOI/yield    |
| industrial_warehousing   | ✅ PASS    | 0.0000         | HARD ASSERTIONS on totalCost/revenue/NOI/yield    |
| hospitality              | ✅ PASS    | 0.92 Cr rev    | HARD ASSERTIONS on totalCost (0.00), revenue (≤1.5 Cr), grossMargin (USALI EBITDA), exitValue. Residual = kernel's single-margin approximation of legacy's USALI cascade. |

**Closure summary**:

1. Hospitality kernel refactored (`packages/financial-kernel/src/assets/hospitality.ts`) to use
   the per-BUA-sqft hard-cost model, Karnataka stamp+betterment, soft-design/approvals/FF&E/OS&E/
   WC/pre-opening, 5% contingency, and legacy's mid-draw IDC formula.
2. Hospitality input schema relaxed (`packages/financial-kernel/src/inputSchema.ts`) to accept
   `hardCostPerSqft` in place of the legacy-output `constructionCostPerKey` field.
3. Global assumption defaults (`packages/financial-kernel/src/assumptions.ts`) aligned to
   legacy USALI-typical output: `fbRevPct 30 / otherRevPct 9 / gopMarginPct 30 / ebitdaMarginPct 22`.
4. `finalizeResult` accepts a `grossMarginPctOverride` so hospitality reports EBITDA margin
   (matching legacy's `_legacy.gross_margin_pct`) rather than the meaningless
   `(exitValue − totalCost) / exitValue`.

**Parity gate closed — deletion blocked on downstream shape migration**:

The legacy engine output is still the authoritative source for several UI shapes
the kernel does not yet produce:

- `computed.capitalStack` (sources/uses, equity/debt split, construction vs refi)
- `computed.cashFlows` (quarterly + yearly aggregate for the waterfall chart)
- `computed.sensitivityMatrix` (tornado inputs — kernel produces via the
  `sensitivity` orchestration stage but the UI reads the legacy-shape matrix)
- `computed.revenue.usali_pnl` (47-field USALI P&L for hospitality)
- `computed._legacy.*` convenience fields read by `financial.service.js` at
  lines 123–160 (INSERT/UPDATE column binding)

**Before deleting `financial.engine.js`**, these need to exist on the kernel
result (or a shim that synthesises them from kernel output). Plan:

1. Port `capitalStack` synthesis from `financial.engine.js` to a kernel
   post-processor (`packages/financial-kernel/src/capitalStack.ts`).
2. Port `cashFlows` aggregator (`quarterly` / `yearly` buckets keyed by label).
3. Decide whether USALI P&L is a kernel responsibility (move the cascade into
   `packages/financial-kernel/src/assets/hospitality.ts`) or a UI-only adapter.
4. Collapse `_legacy.*` usage in `financial.service.js` to kernel-native fields
   (delete the `leg.*` reads at lines 123–160).
5. Inline the `FIN_KERNEL_V2` gate (kernel becomes unconditional) and delete
   `kernel.adapter.js`.
6. Finally, delete `backend/src/engines/financial.engine.js` and the
   `backend/tests/financial.engine.test.js` suite; convert
   `kernel.parity.test.js` to a kernel-only golden-file regression test.

**HARD ASSERTIONS (regressions now fail CI)**:
- residential_apartments: totalCost, grossMargin, RLV, revenue, stamp, GST
- plotted_development: totalCost, grossMargin, revenue
- commercial_office, retail, industrial_warehousing: totalCost, revenue, NOI, yieldOnCost
- hospitality: totalCost, revenue (exit value), grossMargin (USALI EBITDA convention), exitValue

## Gate 2 — Python debt-engine companion

**Gate**: explicit user confirmation + TS debt engine parity for all
scenarios the Python service handles (amortization, drawdown, DSRA,
cash traps, covenants).

**Current state**: TS debt engine (`packages/financial-kernel/src/debt-engine/*`) is unconditional per `index.ts:114`. The Python companion is gated behind `DEBT_ENGINE_PY_URL` — if unset, nothing reaches the Python service.

**Once gate passes, delete**:

- The Python FastAPI service directory (location depends on deploy — likely `api/` or a separate repo)
- `DEBT_ENGINE_PY_URL` env var reads throughout the codebase
- `requirements.txt` entries specific to the debt engine (FastAPI, uvicorn, etc.) IF nothing else in `requirements.txt` needs them

**Do not delete** without confirming no external client points at the Python endpoint's URL.

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

_(none yet)_
