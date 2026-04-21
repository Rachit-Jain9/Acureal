# Cleanup inventory

Tracks the files and folders that can be deleted once the corresponding
parity / safety gate closes. Nothing here is deleted speculatively —
every entry is pinned to a concrete gate that must pass first.

## Gate 1 — Legacy JS financial engine

**Gate**: `backend/tests/kernel.parity.test.js` — the "PARITY REPORT" log
lines (`totalCostCr`, `grossMarginPct`, `residualLandValueCr`) must all
reach `[PASS]` for the canonical residential deal AND for at least one
canonical deal per asset class (plotted_development, commercial_office,
retail, industrial_warehousing, hospitality, land_parcel).

**Current state (2026-04-21, residential_apartments canonical deal)**:

| KPI                    | Δ        | Eps       | Status   |
| ---------------------- | -------- | --------- | -------- |
| totalCostCr            | 6.39 Cr  | 0.5 Cr    | DIVERGES |
| grossMarginPct         | 4.68 pp  | 1.0 pp    | DIVERGES |
| residualLandValueCr    | 5.32 Cr  | 5.0 Cr    | DIVERGES |

Root cause: the two engines apply finance cost, contingency, and
developer margin in different orders. A dedicated parity sweep is
needed to align them.

**Once gate passes, delete**:

- `backend/src/engines/financial.engine.js`
- `backend/src/engines/kernel.adapter.js` (collapse into a thin wrapper or delete entirely)
- Any route handler that reads `FIN_KERNEL_V2` and branches — inline the kernel path
- Search for `require('.*financial.engine')` anywhere and migrate callers

**Promote the parity test** from parity-report to hard assertions (remove the `report()` helper, assert deltas directly).

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
