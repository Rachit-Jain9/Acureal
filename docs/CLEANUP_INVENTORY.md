# Cleanup inventory

Tracks the files and folders that can be deleted once the corresponding
parity / safety gate closes. Nothing here is deleted speculatively —
every entry is pinned to a concrete gate that must pass first.

## Gate 1 — Legacy JS financial engine

**Gate**: `backend/tests/kernel.parity.test.js` — all asset-class parity tests
must assert hard epsilons on totalCost, revenue, grossMargin, and class-specific
KPIs (NOI/yield for income, revPAR/EBITDA for hospitality, RLV for merchant-sale).

**Current state (2026-04-21 post finance-cost alignment)**:

| Asset class              | Status     | Worst Δ        | Notes                                             |
| ------------------------ | ---------- | -------------- | ------------------------------------------------- |
| residential_apartments   | ✅ PASS    | 0.0000         | HARD ASSERTIONS on totalCost/margin/RLV           |
| plotted_development      | ✅ PASS    | 0.34 pp margin | Within epsilon (diff from dev-cost GST routing)   |
| commercial_office        | ✅ PASS    | 0.0000         | HARD ASSERTIONS on totalCost/revenue/NOI/yield    |
| retail                   | ✅ PASS    | 0.0000         | HARD ASSERTIONS on totalCost/revenue/NOI/yield    |
| industrial_warehousing   | ✅ PASS    | 0.0000         | HARD ASSERTIONS on totalCost/revenue/NOI/yield    |
| hospitality              | ⚠️ DIVERGES | 84.81 Cr rev   | Design-level: legacy returns hold-period revenue; kernel returns Y1 stabilized. Finance cost also diverges (13.59 Cr). Needs revenue-definition alignment. |

**Remaining work to close Gate 1**:

1. Hospitality revenue definition alignment. Decide: is "revenue" the stabilized
   annual figure (kernel) or the hold-period total (legacy)? Align both engines
   on one convention. Likely kernel is semantically correct (stabilized NOI-
   anchored) but the UI contract may require the legacy shape.
2. Hospitality finance cost — apply the same compound+draw-schedule pattern
   that fixed residential and plotted.
3. Hospitality grossMargin — follows from (1) and (2).

**Once gate passes, delete**:

- `backend/src/engines/financial.engine.js`
- `backend/src/engines/kernel.adapter.js` (collapse into a thin wrapper or delete entirely)
- Any route handler that reads `FIN_KERNEL_V2` and branches — inline the kernel path
- Search for `require('.*financial.engine')` anywhere and migrate callers

**Already promoted to HARD ASSERTIONS** (regressions now fail CI):
- residential_apartments: totalCost, grossMargin, RLV
- plotted_development: totalCost, grossMargin
- commercial_office, retail, industrial_warehousing: totalCost, revenue, NOI, yieldOnCost

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
