# Legacy-engine shape audit

Pre-flight for Step 1 of the `financial.engine.js` deletion plan in
[CLEANUP_INVENTORY.md](./CLEANUP_INVENTORY.md).

The goal is to enumerate every downstream consumer of the five legacy-only
output shapes — `capitalStack`, `cashFlows`, `sensitivityMatrix`,
`revenue.usali_pnl`, and `_legacy.*` — so the kernel port produces exactly
what the UI / exports / persistence layer already read. A mirror-exact port
means no call-site changes and no risk of silent regressions; any
simplification we decide to do comes *after* the port lands and has parity
tests.

Audit window: 2026-04-21. Source of truth for legacy shape is
`backend/src/engines/financial.engine.js` — line numbers below are from the
current HEAD of `claude/festive-wilson-234dcf`.

---

## 1. `capitalStack`

### Legacy producer

| Asset class                      | File                                      | Line  | Shape                                                                                           |
| -------------------------------- | ----------------------------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| residential / plotted / villas   | `backend/src/engines/financial.engine.js` | 918   | `{ totalCostCr, debtCr, equityCr, debtPct, equityPct, debtInterestCr, debtLTV, debtRatePct, debtTenorYears }` — null when `debtLTV === 0` |
| commercial / retail / industrial | same                                      | 1162  | same construction-loan shape + optional `debtSchedule`                                          |
| merchant-sale / land parcel      | same                                      | 1526  | same                                                                                            |
| hospitality                      | same                                      | 2369  | extended: `{ totalCostCr, debtCr, equityCr, debtPct, equityPct, interestRatePct, amortizationYears, dscr, minDSCR, debtYieldPct, debtSchedule, construction, permanent, waterfall }` |

Hospitality's `construction` sub-object: `{ principalCr, ltcPct, ratePct, feesPct, idcCr, termYears }`.
Hospitality's `permanent` sub-object: `{ principalCr, ltvPct, ratePct, ioYears, amortYears, refiYear, sizingCapRate, stabilizedValueCr, quarterlyPaymentCr, annualDebtServiceCr, totalInterestCr, balloonRepaymentCr }`.
Hospitality's `waterfall` sub-object: `{ tiers[{ name, hurdlePct, lpSharePct, gpSharePct, lpCr, gpCr }], totalLPCr, totalGPCr, lpEquityMultiple, gpEquityMultiple, totalEquityCr, lpCapitalCr, gpCapitalCr, totalDistributionsCr }`.

### Consumers

| File                                                                        | Line  | Read                                                                                                           | Purpose                              |
| --------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `backend/src/services/financial.service.js`                                 | 116   | `computed.capitalStack`                                                                                        | embed in `model_params` JSON         |
| `frontend/src/pages/FinancialsPage.jsx`                                     | 479   | `mp.capitalStack`                                                                                              | passthrough in `normalizedFinancials`|
| `frontend/src/pages/FinancialsPage.jsx`                                     | 1494  | `rawFinancials.capital_stack ?? rawFinancials.model_params.capitalStack`                                       | DebtSchedulePanel                    |
| `frontend/src/pages/FinancialsPage.jsx`                                     | 1497–1533 | `.debtLTV, .debtRatePct, .debtCr, .debtTenorYears, .debtSchedule`                                          | debt UI + amortizing schedule        |
| `frontend/src/components/financials/HospitalityProformaSection.jsx`         | 22–24 | `.waterfall, .permanent, .construction`                                                                        | hospitality proforma                 |
| `backend/src/services/dealPptx.service.js`                                  | 921–924, 1042, 1106 | `context.capitalStack.{debtCr, equityCr}`, `model.capitalStack`                                  | PPTX narrative + chart               |

**Port requirement**: The new `packages/financial-kernel/src/capitalStack.ts`
must emit the *exact* construction-loan keys for income/residential assets and
the full extended hospitality bundle (`construction / permanent / waterfall`)
for hospitality. Nothing may change key names or nullability semantics — the
hospitality proforma early-returns when `.waterfall` is undefined, and
`DebtSchedulePanel` renders only when `capital_stack || model_params.capitalStack`
resolves truthy.

---

## 2. `cashFlows`

### Legacy producer

`structureCashFlows(cfs, timeline)` at `backend/src/engines/financial.engine.js:536`.

```
{
  quarterly: [{ quarter, label, startDate, endDate, period, net }, ...],
  yearly:    [{ year, label, startDate, endDate, period, net }, ...],
  summary:   { totalInflow, totalOutflow },
}
```

- `quarter === 0` gets label `"Effective Date"`; all other quarters get `"Q{n}"`.
- `yearly` prepends a year-0 "Effective Date" row only when `cfs[0] !== 0`.
- `summary.peakDeployment`, `summary.net`, `summary.firstPositiveLabel` are
  **NOT** produced here — they are synthesized downstream in
  `dealExport.service.js:238–249`. The kernel port should emit the same minimal
  summary and let the export normalizer fill in the rest.

### Consumers

| File                                               | Line            | Read                                                            | Purpose                          |
| -------------------------------------------------- | --------------- | --------------------------------------------------------------- | -------------------------------- |
| `backend/src/services/financial.service.js`        | 158             | `JSON.stringify(computed.cashFlows)`                            | persist to `financials.cash_flows` column |
| `backend/src/services/financial.service.js`        | 375, 379        | `fin.cash_flows.{quarterly, yearly}`                            | CSV export                       |
| `backend/src/routes/export.routes.js`              | 98–100, 1177–1179 | `exportContext.cashFlows.{yearly, quarterly}`                | PDF export slices                |
| `backend/src/routes/export.routes.js`              | 675, 1494       | `exportContext.cashFlows.summary.{totalInflow, totalOutflow, peakDeployment}` | export narrative |
| `backend/src/routes/export.routes.js`              | 1681, 2087      | raw `f.model_params, f.cash_flows` / `d.cash_flows`             | bulk read paths                  |
| `backend/src/services/dealXlsx.service.js`         | 151–165         | `exportContext.cashFlows.{quarterly, yearly}`                   | XLSX export                      |
| `backend/src/services/dealExport.service.js`       | 78, 223–246, 458, 634 | `f.cash_flows` → normalize → `cashFlows.summary.peakDeployment` | export context builder    |
| `backend/src/services/dealPptx.service.js`         | 1078–1106       | `exportContext.cashFlows.{yearly, quarterly}`                   | PPTX cash-flow slide             |
| `frontend/src/pages/FinancialsPage.jsx`            | 402, 481–482    | `financials.cash_flows.{quarterly, yearly}`                     | `CashFlowChart` input shape      |
| `frontend/src/pages/FinancialsPage.jsx`            | 822, 1843       | `CashFlowChart({ cashFlows, yearlyCashFlows, assetClass })`     | chart render                     |
| `frontend/src/components/financials/FinancialVisualizationLayer.jsx` | 365–430, 595, 643–644 | `cashFlows` array from normalized shape              | waterfall + IRR progression      |

**Port requirement**: The kernel must produce `{ quarterly, yearly, summary }`
with the exact label conventions (`"Effective Date"`, `"Q{n}"`, `"Year {n}"`)
so `financial.service.js:158` can serialize straight to the `cash_flows`
column without a shim. `startDate`, `endDate`, `period` are surfaced in the
XLSX export — dropping them regresses the export layer.

---

## 3. `sensitivityMatrix`

### Legacy producer

Embedded on each asset-class result (line 931 for residential, 1175 for
commercial, 1539 for merchant-sale, 2405 for hospitality). Shape:

```
{
  sellingRates:      number[]  // axis 1 values
  constructionCosts: number[]  // axis 2 values
  irrGrid:           number[][] // [constructionCost idx][sellingRate idx]
  axis?:             [string, string] // human labels, e.g. ['Constr. Cost', 'Selling Rate']
  variations?:       Array<...>  // optional single-variable tornado rows
}
```

### Consumers

| File                                                  | Line        | Read                                                              | Purpose                   |
| ----------------------------------------------------- | ----------- | ----------------------------------------------------------------- | ------------------------- |
| `backend/src/services/financial.service.js`           | 159, 268–272 | `JSON.stringify(computed.sensitivityMatrix)`, `result.sensitivityMatrix` | persist + runSensitivity |
| `backend/src/services/dealExport.service.js`          | 79, 254–262, 459, 465 | `f.sensitivity_matrix` → normalize                        | export context            |
| `backend/src/services/dealPptx.service.js`            | 1083, 1155, 2039–2050 | `context.sensitivityMatrix.{irrGrid, sellingRates, constructionCosts}` | PPTX sensitivity table |
| `frontend/src/pages/FinancialsPage.jsx`               | 403, 483–488 | `financials.sensitivity_matrix.{sellingRates, constructionCosts, irrGrid, axis}` | sensitivity tab |

**Port requirement**: Kernel's `sensitivity` orchestration stage already
produces this matrix under a slightly different name. The port is a shape
adapter, not a new computation.

---

## 4. `revenue.usali_pnl`

### Legacy producer

`backend/src/engines/financial.engine.js:2367` — hospitality only. 10-year
array, each row has **47 fields** covering occupancy/ADR, four revenue
streams, departmental expenses, undistributed opex, brand fees, GOP,
management fees, fixed costs, EBITDA, FF&E reserve, and NOI with both
absolute-cr and margin-pct variants.

### Consumers

| File                                                              | Line | Read                             | Purpose                       |
| ----------------------------------------------------------------- | ---- | -------------------------------- | ----------------------------- |
| `frontend/src/pages/FinancialsPage.jsx`                           | 475  | `revenue.usali_pnl`              | passthrough in normalized     |
| `frontend/src/components/financials/HospitalityProformaSection.jsx` | 18, 28, 34–37, 97–175, 183–275 | `financials.revenue.usali_pnl` | full USALI P&L table, revenue mix pie, NOI evolution chart |

**Port requirement**: The section at `HospitalityProformaSection.jsx:28`
early-returns when `pnl` is not a non-empty array. Port must preserve
exact field names — the table has a hard-coded field list at lines 186–229
(`occupancy, adr, revPAR, trevPAR, roomsRevenueCr, fbRestaurantCr, fbBanquetCr,
otherOperatedCr, parkingCr, leaseIncomeCr, totalRevenueCr, roomsDeptExpCr,
fbDeptExpCr, otherDeptExpCr, deptProfitCr, aAndGCr, itCr, smCr, pomCr,
utilitiesCr, brandRoyaltyCr, brandMktReservCr, gopCr, gopMarginPct, mgmtBaseCr,
mgmtIncentiveCr, ibfcCr, propTaxCr, insuranceCr, groundLeaseCr, ebitdaCr,
ebitdaMarginPct, ffeReserveCr, noiCr, noiMarginPct`).

**Decision pending**: this is hospitality-specific reporting, not a kernel
primitive. Recommendation: port it as a kernel post-processor (mirrors legacy
exactly) rather than into `packages/financial-kernel/src/assets/hospitality.ts`,
to avoid bloating the core adapter. Finalize in Step 3 of the deletion plan.

---

## 5. `costs.sources_uses`

(Discovered during audit — belongs to hospitality output and is also consumed
by the proforma.)

### Legacy producer

`backend/src/engines/financial.engine.js:2165–2214`. Shape:

```
{
  uses: [{ category, subtotalCr, items: [{ label, valueCr }] }, ...],
  usesTotalCr,
  sources: [{ label, valueCr, category: 'debt' | 'equity' }, ...],
  sourcesTotalCr,
  refinance: { refiYear, refiPrincipalCr, refiLTVPct, refiCapRatePct,
               refiInterestRatePct, refiIOYears, refiAmortYears,
               stabilizedValueForRefiCr },
}
```

### Consumers

| File                                                              | Line    | Read                                              | Purpose                |
| ----------------------------------------------------------------- | ------- | ------------------------------------------------- | ---------------------- |
| `frontend/src/pages/FinancialsPage.jsx`                           | 480     | `costs.sources_uses`                              | normalized passthrough |
| `frontend/src/components/financials/HospitalityProformaSection.jsx` | 19–21, 38, 277–365 | `financials.costs.sources_uses \|\| costsRaw.sources_uses \|\| sourcesUses` | sources & uses panel, refi card |

**Port requirement**: Hospitality-only. Port in the same step that moves the
USALI P&L.

---

## 6. `_legacy.*`

Used exclusively by `backend/src/services/financial.service.js:91` and
read at lines 123–160 to bind the flat `financials` table columns. Fields
consumed:

```
land_cost_cr, plot_area_sqft, fsi, loading_factor,
construction_cost_per_sqft, selling_rate_per_sqft,
approval_cost_cr, marketing_cost_pct, finance_cost_pct,
developer_margin_pct, project_duration_months,
total_revenue_cr, gross_profit_cr, gross_margin_pct,
developer_profit_cr, discount_rate_pct
```

### Consumers

Single-file: `backend/src/services/financial.service.js` only. Once the
kernel produces an equivalent echo under `inputs.*` and `kpis.*`, these reads
collapse to direct kernel-field references and the `_legacy.*` bag can be
deleted. No UI code touches `_legacy`.

**Port requirement**: Not a kernel module — a local refactor of
`financial.service.js` lines 91–160 mapping each `leg.*` read to the
kernel-native field that already holds the same value. Inputs echo is already
present on kernel result (`input.inputs`); KPIs are present on `computed.kpis`.

---

## Risk / regression surface

Ranked by blast radius if the port drops or renames a field:

1. **`revenue.usali_pnl`** — hospitality proforma early-returns on missing
   array; an empty port bricks the entire hospitality tab.
2. **`capitalStack.waterfall` / `.permanent` / `.construction`** — same
   page, same component; each sub-object guards its own panel.
3. **`cash_flows.quarterly`** — drives `CashFlowChart`, XLSX export rows,
   PPTX cash-flow slide. Rendering degrades silently to empty state.
4. **`_legacy.*`** — breaks INSERT/UPDATE to `financials` table; Postgres
   will reject NOT NULL columns that were previously populated. DB write
   failure on every calculate.
5. **`sensitivityMatrix`** — sensitivity tab goes blank; PPTX sensitivity
   table hides itself via `hasSensitivity` guard at `dealPptx.service.js:2039`.

## Validation plan for the port

Before any legacy-engine file is deleted, each of the five shapes needs a
snapshot parity test that diffs legacy vs kernel output across all 10 asset
classes (where applicable). Suggested test file:

- `backend/tests/kernel.shape.parity.test.js` — deep-equal on `capitalStack`,
  `cashFlows`, `sensitivityMatrix`, plus hospitality-only `revenue.usali_pnl`
  and `costs.sources_uses`. Epsilon = 0.01 Cr on numeric fields; exact match
  on keys + types.

Run alongside the existing `kernel.parity.test.js` KPI suite.

---

## Recommended port order

Consolidated plan reflecting audit findings (supersedes the high-level six
steps in `CLEANUP_INVENTORY.md` only in level of detail — the goals are the
same):

1. **`packages/financial-kernel/src/postprocess/capitalStack.ts`** — port
   both the construction-loan shape (line 918 et al) and the hospitality
   extended bundle (line 2369). Shape adapter over existing kernel debt-engine
   output. Add unit tests covering `debtLTV === 0` (returns null) vs
   `debtLTV > 0` (full object) branches.
2. **`packages/financial-kernel/src/postprocess/cashFlows.ts`** — port
   `structureCashFlows` exactly, including `"Effective Date"` labels and
   conditional year-0 row.
3. **`packages/financial-kernel/src/postprocess/sensitivityMatrix.ts`** —
   adapt existing `sensitivity` stage output to the legacy shape keys.
4. **`packages/financial-kernel/src/assets/hospitality-reporting.ts`** —
   port USALI P&L cascade + sources & uses structure. Keep separate from
   `hospitality.ts` so the core adapter stays focused on parity KPIs.
5. **Collapse `financial.service.js:91–160`** — replace `leg.*` reads with
   kernel-native references; delete `_legacy` from legacy engine too (dead
   code at that point).
6. **Inline `FIN_KERNEL_V2` gate** — kernel becomes unconditional in
   `financial.service.js`; delete `backend/src/engines/kernel.adapter.js`.
7. **Delete `backend/src/engines/financial.engine.js` + its test file**;
   convert `kernel.parity.test.js` to kernel-only golden regression.

Each step ships behind its own parity test so regressions surface at CI
boundary rather than in production render.
