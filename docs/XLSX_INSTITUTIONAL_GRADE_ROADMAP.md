# XLSX rebuild — institutional-grade roadmap

_Anchored to the operator's three reference pro formas:_
- **NAIOP Challenge Proforma** (2 MB, 16 sheets, Excel Solver-based optimisation, full sponsor/LP waterfall, monthly + annual CF, sensitivity, forward SOFR curve)
- **RE-540 Final Project** (8 sheets — Scenario Summary / Assumptions / Rent Summary / Development Costs / Construction & Lease-Up / **Permanent Debt Calculation** / Amortization Schedule / Cash Flow Analysis / Waterfall)
- **RE-508 Final Project** (3 sheets but with multi-project monthly cash flow + reversion value modelling)

_Status as of 2026-05-11._ This doc tracks the multi-PR effort to elevate REDIP's XLSX exports from "competent v2 with 4 sheets" to "investor-grade pro forma matching the references above." The operator's brutal-roast feedback over the past two sessions identified the gap.

---

## What's already fixed (PRs that closed real credibility issues)

| PR | Theme | What it fixed |
|---|---|---|
| #248 | Hidden Calculations sheet circular refs | Eight off-by-one row references producing circular formulas → Excel popped a repair dialog and zeroed every cost figure |
| #250 | Percent normalisation | Kernel stored some percents as integer (5 for 5%), others as decimal (0.05). Excel's `0.0%` format requires decimal — integer-stored values rendered as 500% and formulas produced 100× wrong math. New `toPctDecimal()` helper covers 24 percent inputs |
| #254 | Native chart objects | ExcelJS 4.4.0 has no `addChart`. New `chartInjector.js` splices native doughnut + clustered-column XML into the buffer after ExcelJS writes. Mirrors openpyxl reference-template structure exactly |
| #256 | Phasing cumulative-row totals | Total column applied SUM to rows already containing running cumulative values → triangular sum (3,198 Cr instead of 266 Cr for Jigani). Fixed via `totalKind: 'final'` flag |
| #257 | Customer collection timing | Was same-quarter as sale → front-loaded-positive CF profile → negative IRR despite positive net cumulative cash flow. Now construction-progress-linked (RERA-milestone-style). Jigani test IRR flipped from -15% to +47% (operator can dial down sales velocity to get a more realistic absorption-driven figure) |
| #259 | **Kernel = single source of truth on Dashboard headlines** | Dashboard's Total Revenue / IRR / NPV / EM / Gross Margin / etc. now display the kernel-stored values from the deal record when available — matching the Reports page in the frontend exactly. Modeled (sensitivity-run) figures preserved as a secondary row with explicit "MODELED" labels + a disclosure footnote |

**Net effect today**: the workbook is *correct* (no circular refs, headlines reconcile across the platform, native charts on the Dashboard). It is **not yet** institutional-grade in depth — that's the work below.

---

## Remaining institutional-grade gaps (vs reference templates)

### Critical depth gaps

| # | Gap | Reference precedent | Effort | Priority |
|---|---|---|---|---|
| 1 | **Detailed soft cost breakdown** — current generator collapses everything into "Marketing & Sales" + "Finance / Treasury Cost". References break out: Architectural & engineering (% of hard cost), Legal (% of hard cost), Appraisal & title (% of hard cost), Marketing & brokerage (% of revenue), Property taxes during construction (% of land), Insurance during construction (% of hard cost), Developer overhead (% of hard cost), Contingency (% of hard cost). ~8 line items instead of 2. | RE-540 Development Costs sheet rows 14-22; NAIOP Budget | Medium (new Inputs rows + Phasing schedule + Calculations breakdown) | **HIGH** — top of the next-PR list |
| 2 | **Construction loan vs Permanent loan split** — currently one Debt LTV input; references model two separate loans. Construction loan is LTC-based, drawn against construction draws month-by-month, interest capitalised into cost basis. Permanent loan kicks in at stabilisation, sized as **MIN of three sub-limits**: LTV (loan / value), DCR (NOI / debt service ≥ minimum), Debt Yield (NOI / loan ≥ minimum) | RE-540 "Permanent Debt Calculation" sheet C13:C25 (LTV-based / DCR-based / Debt-Yield-based, then MIN) | High (new sheet + Phasing integration + Cash Flow restructure) | **HIGH** — separates REDIP from amateur Excel models |
| 3 | **Amortization schedule** — current generator computes interest each quarter from running debt balance but doesn't show an explicit amortization table. References include a full month-by-month or quarter-by-quarter table with Beginning Balance / Payment / Interest / Principal / Ending Balance | RE-540 "Amortization Schedule" sheet; RE-508 Pro forma rows 33-37 | Low (new sheet, formulas straightforward) | MEDIUM |
| 4 | **Sponsor / LP waterfall** — current generator has a simple JV split (developer % / landowner %). References model multi-tier waterfall: 8% pref return + return of capital + catch-up + promote (e.g., 80/20 above 12% IRR, 70/30 above 15%, etc.) | NAIOP "Waterfall - IRR Hurdles" sheet; RE-540 "Waterfall" sheet | High (new sheet, multi-tier IRR pour-over logic) | HIGH for institutional deals |
| 5 | **Unit mix table** — current generator uses a single "Saleable / Leasable Area" number. References itemise by unit type (studio / 1BHK / 2BHK / 3BHK / 4BHK) with units count × SF per unit × per-unit rent. Lets analysts model unit-mix changes | RE-540 Assumptions rows 14-31; NAIOP Unit Mix sheet | Medium (new sheet, asset-class-aware: applies to residential / hospitality / hotels not necessarily to commercial / industrial) | MEDIUM |
| 6 | **Monthly cash flow detail** — current generator is quarterly only. References have month-by-month construction draws + month-by-month operating cash flow (NAIOP has both MonthlyCF + AnnualCF separately) | NAIOP MonthlyCF sheet (43 columns wide); RE-540 Construction & Lease Up rows 15-25 | High (large refactor: 36-72 columns instead of 4-32 quarters; chart injector ranges + Dashboard refs all change) | MEDIUM |
| 7 | **Construction draws month-by-month** — references show how equity contributions are drawn first, then construction loan draws cover the rest, with cumulative interest tracked monthly | RE-540 "Construction and Lease Up" rows 14-25 | Medium (new section in Phasing or its own sheet) | HIGH (couples with #2) |
| 8 | **Recoverable expenses & lease-type modelling (commercial / retail)** — for NNN leases, OpEx is largely recovered from tenants. Current generator models OpEx as a pure deduction; institutional model treats it as a wash with adjustments for vacancy | RE-540 Assumptions rows 33-36 (NNN vs FS lease type) | Medium (new Inputs row + EGR calc adjustment) | MEDIUM (income asset families) |
| 9 | **Reversion / exit value modelling** — current generator has Exit Cap Rate input but uses it simply (NOI / cap rate). References show full reversion with: NOI growth assumption, selling costs (broker, legal, taxes), net sale proceeds | RE-540 / RE-508 Cash Flow Analysis terminal-period row | Low (refinement of existing Reversion row) | MEDIUM |
| 10 | **Sensitivity analysis as a 2D data table** — current generator has a 5×5 conditional-format grid. References have multiple 2D tables (e.g., IRR vs Cap Rate × Sale Price; NPV vs Discount Rate × Construction Cost) plus single-variable tornado | NAIOP "Sensitivty Analysis" sheet | Medium (extend existing grid logic) | MEDIUM |
| 11 | **Excel built-in Scenario Manager** — Excel has a native scenarios feature accessible via Data → What-If Analysis. References use it to store Bull / Base / Bear with named changing cells | RE-540 "Scenario Summary" sheet (generated by Excel) | Hard (ExcelJS doesn't expose Scenario Manager API) | LOW (workbook-internal feature, not a code-side feature) |
| 12 | **Forward interest rate curve / debt-cost projection** — NAIOP has a SOFR curve sheet. Real institutional models use forward rates to size debt cost over time | NAIOP "Forward SOFR" sheet | Hard (requires external rate feed) | LOW (most operators use a single rate) |

### Visual / aesthetic gaps

| # | Gap | Effort | Priority |
|---|---|---|---|
| 13 | **Combo chart on Quarterly Trend** (column + line with cumulative on secondary axis). Currently 2-series clustered columns. PPTX has the combo via pptxgenjs — XLSX needs lineChart + barChart sharing axes in the injected chart XML | Low (extend chartInjector to support combo) | MEDIUM |
| 14 | **Tornado chart on the Dashboard** — sensitivity driver bars centred on base IRR, sorted by impact. PPTX (PR #251) + DOCX (PR #252) have it via shape primitives / SVG. XLSX would need an embedded image OR a clever native-bar approach | Medium (image embed via pure-JS PNG renderer, or stacked-bar trick in chart XML) | MEDIUM |
| 15 | **KPI tile sparklines** — mini inline trend charts in KPI cells (e.g., a 12-quarter sales velocity sparkline in the Total Revenue tile). ExcelJS doesn't support sparklines natively; would need XML injection extension | Medium | LOW (nice-to-have) |
| 16 | **KPI icon-set conditional formatting** — ↑↓ arrows on IRR / NPV / Margin tiles indicating "above" or "below" benchmark | Low (ExcelJS supports iconSet rules) | MEDIUM |
| 17 | **Premium colour theme** (deep navy + copper + emerald) — palette is already partially applied but the references have richer styling (header bands, row-stripe shading, subtle borders, larger title typography) | Low (style sweep) | LOW |

### Asset-class specific depth gaps

| # | Gap | Asset class | Effort |
|---|---|---|---|
| 18 | **ADR / Occupancy / RevPAR build for hospitality** — current generator uses a generic NOI build; hospitality needs Average Daily Rate × Occupancy × RevPAR with seasonality and ramp-up | hospitality | Medium |
| 19 | **CAM reconciliation for retail** — recoverable expenses pass through to tenant with adjustments | retail | Medium |
| 20 | **Approval / entitlement milestone modelling for raw land** — current generator just shows construction cost; raw-land deals are about approvals not construction | raw_land, redevelopment | Medium |
| 21 | **Component-level revenue for mixed-use** — separate revenue / cost / cap rate per component (residential vs office vs retail vs hospitality), then aggregate to a blended project IRR | mixed_use | Hard |
| 22 | **Plot-level absorption for plotted dev** — sell plot-by-plot at different prices over time | plotted_development | Medium |

### Cross-cutting infrastructure

| # | Gap | Effort | Priority |
|---|---|---|---|
| 23 | **Combo chart support in chartInjector** | Low | MEDIUM (unlocks #13) |
| 24 | **Line chart support in chartInjector** | Low | MEDIUM (unlocks cumulative-line patterns) |
| 25 | **Scatter chart support in chartInjector** | Low | LOW |
| 26 | **Excel data table (2D) support in chartInjector** — for sensitivity grids | Hard (Excel native data tables require array-formula handling) | LOW (current conditional-format grid is acceptable substitute) |

---

## Recommended next-PR sequence

After PR #259 (kernel reconciliation) — proposed order:

1. **PR-A: Detailed soft cost breakdown** (gap #1). ✅ **SHIPPED in PR #261** — 6 new line items + Phasing schedule rows 13-19 + expanded Calculations Cost Build to 14 rows.
2. **PR-B: Construction loan vs Permanent loan structure** (#2, couples with #7). Adds a "Permanent Debt Calc" sheet computing MIN(LTV, DCR, DY) loan amount. ~300-400 LOC. _Open._
3. **PR-C: Amortization schedule sheet** (#3). ✅ **SHIPPED in PR #263** — standalone sheet with quarter-by-quarter Beg Bal / Payment / Interest / Principal / End Bal + Loan Terms summary. 80 rows = 20-year cap.
4. **PR-D: Sponsor/LP waterfall sheet** (#4). 4-tier pour-over (pref → return of capital → catch-up → promote). ~250-350 LOC. _Open._
5. **PR-E: Unit mix table** (#5). Asset-class-aware; residential / hospitality / hotels get the table. ~150 LOC. _Open._
6. **PR-F: Combo chart support + Quarterly Trend gets cumulative line** (#13, #23). ✅ **SHIPPED in PR #262** — chartInjector extended with `buildComboChartXml` (barChart + lineChart in one plotArea, secondary value axis); Dashboard Quarterly Trend chart now shows period contribution columns plus copper cumulative line.
7. **PR-G: Tornado chart on Dashboard** (#14). ✅ **SHIPPED in PR #265** — instead of an embedded image, native Office horizontal bar with `overlap=100` and two oppositely-signed series. Driver-impact data table at H24:M26 feeds the chart with low/high deltas computed live from the existing sensitivity grid.

Each PR keeps the existing chart injector + kernel reconciliation logic intact.

### Remaining open PRs by priority

After PR #261 + #262 + #263 + #265 landed (rebuild batches 1 + 2), the next-highest-leverage gaps are:

- **PR-B (Construction vs Permanent loan with MIN sizing)** — biggest remaining depth gap. Once it lands, PR-C's Amortization sheet automatically shows the PERMANENT loan amortization (the in-sheet footer already acknowledges this). Suggested split: PR-B.1 adds the input rows + "Permanent Debt Calc" sheet computing MIN of three sizing methods (additive, safe); PR-B.2 restructures Cash Flow to model construction loan drawdowns + permanent loan takeout (invasive, needs careful row-position management).
- **PR-D (Sponsor / LP waterfall)** — critical for institutional deals with promote economics. New sheet with 4-tier pour-over (pref → return of capital → catch-up → promote at 8/12/15% IRR hurdles).
- **PR-E (Unit mix table)** — residential / hospitality specifically. Needs design decision: visibility-only (operator-edits as worksheet, no flow-through) vs flow-through (Unit Mix total SF feeds SaleableAreaSqft on Inputs — changes how an existing input behaves).

---

## Operator decision points

- **Which gap matters most for your buyer persona?** If you're selling to development sponsors (residential, plotted dev, mixed-use), gap #5 (unit mix) + gap #4 (waterfall) probably matter more than gap #2 (loan split). If you're selling to income-asset investors (commercial, retail, industrial, hospitality), gap #8 (lease-type modelling) + gap #2 (debt sizing) matter most.
- **Single PR thread or parallel?** Each PR above is independent and could ship in any order. The kernel reconciliation (#259) is the precondition — everything else can interleave.
- **Where to stop?** Realistically, gaps #1 + #2 + #4 + #5 (the "core institutional four") get you to the bar where a Blackstone / CBRE analyst won't immediately rebuild from scratch. Gaps #6-#9 are next-level polish. Gaps #10-#26 are progressively diminishing returns.

---

## What I cannot do alone

Even with all 26 gaps closed, the workbook still won't fully match the references because:
- The **NAIOP template uses Excel Solver** for optimisation — that's an Excel feature, not exportable from generation code
- **Real institutional templates are hand-tuned per deal** over months by analysts; they embed deal-specific commentary, sources, micro-market overrides, exception handling
- **Forward rate curves + lender quotes** require external data feeds (rate sheets from banks) that REDIP doesn't ingest yet

REDIP's value is *deterministic, audit-trail-able pro forma generation from kernel inputs* — not a substitute for a senior analyst's underwriting. Set buyer expectations accordingly: this is a starting point that saves the analyst hours of skeleton-building, not a replacement for their judgement.
