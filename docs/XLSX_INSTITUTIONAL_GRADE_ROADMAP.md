# XLSX rebuild — institutional-grade roadmap

_Anchored to two layers of reference:_
- **US institutional benchmarks (structural reference only)** — NAIOP Challenge Proforma, RE-540 Final Project, RE-508 Final Project. Used to learn the **shape** of an institutional-grade pro forma (Inputs, Phasing, Debt Sizing, Amortization, Waterfall, Unit Mix, Sensitivity, Sources & Uses). We do NOT clone their content — SOFR curves, US tax structures, ULI / CBRE-US benchmarks are intentionally absent.
- **India-specific operating reality (every line item)** — operator brief 2026-05-11 anchors all defaults, formulas, and disclosures to how Indian deals actually work: INR Crore + lakhs + sqft + acres units; GST tiers by asset class; Karnataka stamp duty + registration; RERA 70/30 escrow; JDA / area-share / revenue-share structures; A-vs-B-khata; BBMP property tax UAV method; Bengaluru lender ecosystem (HDFC, ICICI, Edelweiss, IIFL, HDFC Capital, Piramal); Repo + MCLR rate benchmarks; LTCG / TDS taxation; promoter-track-record fields.

_Status as of 2026-05-17._ The 7-PR institutional arc (PR-A through PR-G) gave the workbook structural depth. **The 16-item India localization batch (PR-I1 through PR-I16) has now LANDED in full** — shipped in PRs #271, #275, #276, #277, #280, #281, #282, #286, #289, #290. Every line item is now specific and relevant to how pro forma / financial modelling is done for Indian real estate by asset class and deal structure. Cross-product AI briefing (PR-NX18) + market-benchmark validators dev-side (PR-NX28) + income-side DSCR/YoC (PR-NX33) shipped on top.

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
| 2 | **Construction loan vs Permanent loan split** — currently one Debt LTV input; references model two separate loans. Construction loan is LTC-based, drawn against construction draws month-by-month, interest capitalised into cost basis. Permanent loan kicks in at stabilisation, sized as **MIN of three sub-limits**: LTV (loan / value), DCR (NOI / debt service ≥ minimum), Debt Yield (NOI / loan ≥ minimum) | RE-540 "Permanent Debt Calculation" sheet C13:C25 (LTV-based / DCR-based / Debt-Yield-based, then MIN) | High (new sheet + Phasing integration + Cash Flow restructure) | **HIGH** — separates Acureal from amateur Excel models |
| 3 | **Amortization schedule** — current generator computes interest each quarter from running debt balance but doesn't show an explicit amortization table. References include a full month-by-month or quarter-by-quarter table with Beginning Balance / Payment / Interest / Principal / Ending Balance | RE-540 "Amortization Schedule" sheet; RE-508 Pro forma rows 33-37 | Low (new sheet, formulas straightforward) | MEDIUM |
| 4 | **Sponsor / LP waterfall** — current generator has a simple JV split (developer % / landowner %). References model multi-tier waterfall: 8% pref return + return of capital + catch-up + promote (e.g., 80/20 above 12% IRR, 70/30 above 15%, etc.) | NAIOP "Waterfall - IRR Hurdles" sheet; RE-540 "Waterfall" sheet | High (new sheet, multi-tier IRR pour-over logic) | HIGH for institutional deals |
| 5 | **Unit mix table** — current generator uses a single "Saleable / Leasable Area" number. References itemise by unit type (studio / 1BHK / 2BHK / 3BHK / 4BHK) with units count × SF per unit × per-unit rent. Lets analysts model unit-mix changes | RE-540 Assumptions rows 14-31; NAIOP Unit Mix sheet | Medium (new sheet, asset-class-aware: applies to residential / hospitality / hotels not necessarily to commercial / industrial) | MEDIUM |
| 6 | **Monthly cash flow detail** — current generator is quarterly only. References have month-by-month construction draws + month-by-month operating cash flow (NAIOP has both MonthlyCF + AnnualCF separately) | NAIOP MonthlyCF sheet (43 columns wide); RE-540 Construction & Lease Up rows 15-25 | High (large refactor: 36-72 columns instead of 4-32 quarters; chart injector ranges + Dashboard refs all change) | MEDIUM |
| 7 | **Construction draws month-by-month** — references show how equity contributions are drawn first, then construction loan draws cover the rest, with cumulative interest tracked monthly | RE-540 "Construction and Lease Up" rows 14-25 | Medium (new section in Phasing or its own sheet) | HIGH (couples with #2) |
| 8 | **Recoverable expenses & lease-type modelling (commercial / retail)** — for NNN leases, OpEx is largely recovered from tenants. Current generator models OpEx as a pure deduction; institutional model treats it as a wash with adjustments for vacancy | RE-540 Assumptions rows 33-36 (NNN vs FS lease type) | Medium (new Inputs row + EGR calc adjustment) | MEDIUM (income asset families) |
| 9 | **Reversion / exit value modelling** — current generator has Exit Cap Rate input but uses it simply (NOI / cap rate). References show full reversion with: NOI growth assumption, selling costs (broker, legal, taxes), net sale proceeds | RE-540 / RE-508 Cash Flow Analysis terminal-period row | Low (refinement of existing Reversion row) | MEDIUM |
| 10 | **Sensitivity analysis as a 2D data table** — current generator has a 5×5 conditional-format grid. References have multiple 2D tables (e.g., IRR vs Cap Rate × Sale Price; NPV vs Discount Rate × Construction Cost) plus single-variable tornado | NAIOP "Sensitivty Analysis" sheet | Medium (extend existing grid logic) | MEDIUM |
| 11 | **Excel built-in Scenario Manager** — Excel has a native scenarios feature accessible via Data → What-If Analysis. References use it to store Bull / Base / Bear with named changing cells | RE-540 "Scenario Summary" sheet (generated by Excel) | Hard (ExcelJS doesn't expose Scenario Manager API) | LOW (workbook-internal feature, not a code-side feature) |
| ~~12~~ | ~~Forward SOFR rate curve~~ — **REMOVED 2026-05-11.** US-centric, not relevant for Indian deals. Indian rate exposure modelled via I6 (Lender ecosystem: Repo / MCLR + spread). | — | — | — |

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

**ARC COMPLETE — all 7 PRs merged + deployed as of 2026-05-11.**

The roadmap's recommended PR sequence (PR-A through PR-G) shipped in this order:
1. PR-A #261 — Detailed soft cost breakdown
2. PR-F #262 — Combo chart (Quarterly Trend)
3. PR-C #263 — Amortization Schedule sheet
4. PR-G #265 — Tornado on Dashboard
5. PR-B #267 — Permanent Debt Sizing (MIN of LTC/LTV/DCR/DY)
6. PR-D #268 — Sponsor / LP Waterfall
7. PR-E #269 — Unit Mix table

Each independently verifiable, each adds institutional-grade depth without breaking the kernel-reconciliation precondition (PR #259).

---

## India localization — the next phase (post-arc)

_Operator directive 2026-05-11: drop the US-centric items (SOFR rate curves etc.) and make every line item specific and relevant to the way pro forma / financial modelling is actually done for Indian real estate, by asset class and by deal structure._

The 7-PR institutional arc gave the workbook **structural depth** (debt sizing, waterfall, unit mix, amortization). What it still doesn't fully express is **India-specific behaviour** — GST mechanics, RERA escrow, JDA structures, BBMP property tax, Karnataka stamp duty + registration, A-vs-B-khata exit haircuts. The next phase fixes that.

### Why this matters

A pro forma that says "Stamp Duty 5%" as an editable yellow cell but doesn't flow that 5% into a real cost line is decorative. An analyst at HDFC Capital or Edelweiss looks at the cost build, sees no stamp-duty line, and writes the model off. Same for GST (currently an unused input), RERA escrow (not modelled at all — affects every residential deal's working capital), JDA mode (only handled as a profit split, not as a "no land cost" structure).

### India localization batch (priority order)

| # | Gap | Asset classes affected | Why it matters | Status |
|---|---|---|---|---|
| I1 | **GST + Stamp Duty + Registration as REAL cost lines.** Currently inputs that don't flow. GST behaviour by asset class: residential = 5% no ITC (developer eats cost); commercial = 12% with full ITC (washes out); plotted = 0%; hospitality = mixed. Stamp duty + registration = ~6.6% of land cost in Karnataka, one-time at acquisition. | All | Closes the biggest correctness hole. Stamp duty alone is 0.5-1.0% of total project cost in BLR; GST adds another 3-5% for residential. Currently invisible. | ✅ LANDED |
| I2 | **RERA Escrow 70/30 split** on customer collections. RERA mandates 70% of every customer payment goes to project-specific escrow, releasable only against certified construction. Affects working capital + debt-sizing for residential. | residential_apartments, villas, plotted_development, mixed_use | Indian residential developers live or die by escrow timing. Without it, the cash flow profile is wrong by orders of magnitude. | ✅ LANDED |
| I3 | **JDA structures**: outright_purchase / jda_revenue_share / jda_area_share / development_management. Currently the model treats all deals as outright_purchase + applies a profit split. Real JDAs: LandCostCr = 0, but landowner takes a fraction of revenue OR a fraction of saleable area. | All development; major for BLR | JDAs are how 40-60% of Bengaluru residential development gets structured. Modelling them as outright_purchase + profit split overstates upfront capital and understates landowner exposure to market risk. | ✅ LANDED |
| I4 | **Property Tax fix (BBMP UAV method)**. Currently modelled as % of EGR. India uses Unit Area Value (BBMP, BMC, MCGM) → INR/sqft/year flat, by zone. Should be INR/sqft/yr × SaleableAreaSqft. | All income deals | Currently wrong methodology — % of EGR scales with rent, but real property tax is area-driven. | ✅ LANDED |
| I5 | **Carpet vs Super Built-up Area + Loading Factor.** RERA mandates carpet-area pricing in marketing; construction costs are on super-built-up. Need a Loading Factor input (typical 1.25-1.40x) and explicit derived Carpet Area. | residential_apartments, villas, commercial_office, retail | RERA compliance + accurate sale-rate modelling. Operator's sell rate could be in either carpet or super-built-up — needs to be explicit. | ✅ LANDED |
| I6 | **Lender ecosystem inputs.** Lender Type (SBI / HDFC / ICICI / Axis / Edelweiss / IIFL / HDFC Capital / Piramal / Bandhan / Other), Rate Type (Repo-linked / MCLR / Fixed), Loan Type (Construction / LRD / Project Finance / Mezz), Spread bps over benchmark, Processing Fee %. | All | Indian RE lending is fundamentally different from US — repo + spread, MCLR benchmarks, LRD vs project finance distinction matters for IRR modelling. | ✅ LANDED |
| I7 | **Taxation block** — LTCG @ 12.5% on land/equity disposal (post-Jul-2024), TDS u/s 194-IA at 1% on sale > 50L, GST on rentals (commercial 18% with ITC, residential exempt). Drives Net-of-Tax IRR row alongside Pre-Tax. | All | Indian investors care about Post-Tax IRR. Currently invisible. | ✅ LANDED |
| I8 | **Khata status (A / B / mixed)** as a categorical input with optional B-khata exit haircut (default 15%). | All BLR deals | A-khata vs B-khata is a major BLR valuation factor. Marwari investors specifically ask. | ✅ LANDED |
| I9 | **Premium FSI / TDR cost** as an optional one-time cost line. | All BLR / MMR deals | Premium FSI in BLR (BBMP/BDA charge) + TDR in MMR are major one-time cost items. | ✅ LANDED |
| I10 | **Approvals & RERA registration** as cost line items distinct from "Approval & Fees". Khata, BDA layout, BBMP plan sanction, BWSSB connection, BESCOM, KSPCB consent, Airport NOC, RERA registration + renewal. Each with default INR ranges. | All BLR deals | Currently lumped into one "Approval & Fees" Cr figure. Investors want the breakdown. | ✅ LANDED |
| I11 | **Sale-rate escalation tied to construction milestone** (plinth, slabs, finishing, OC). Indian residential typically sees 8-12% sale-price escalation over the construction cycle, milestone-anchored. Currently modelled as continuous EscalationPct/year. | residential_apartments, villas, mixed_use | Matches how operators actually quote prices to brokers — by stage, not by date. | ✅ LANDED |
| I12 | **Hospitality ADR / Occupancy / RevPAR build** with seasonality (high-season vs low-season ADR), STAR-report-style metrics. Currently rolled into a flat occupancy figure. | hospitality | Hospitality investors live in ADR × Occupancy × RevPAR. Generic NOI build doesn't speak their language. | ✅ LANDED |
| I13 | **Retail CAM reconciliation + anchor-vs-vanilla rent split.** Anchor tenants get sub-market rates; vanilla tenants pay market + CAM. | retail | Indian mall economics are anchor-driven; current generic NOI model misses this. | ✅ LANDED |
| I14 | **Plot-level absorption for plotted development** — sell plot-by-plot at different prices over time, not aggregate. | plotted_development | Plotted dev is sold individually, not bulk. Per-plot revenue + sales velocity matters. | ✅ LANDED |
| I15 | **Component-level revenue for mixed-use** — separate residential / retail / office / hospitality rev + cost + cap rate per component, then blend. | mixed_use, redevelopment | Mixed-use deals are multi-component; a single SellRatePerSqft is wrong. | ✅ LANDED |
| I16 | **Approval / entitlement milestone modelling for raw land**. Raw-land deals are about approval progression, not construction. Stage = Title Diligence → Conversion → Layout → Sale-ready. | raw_land, redevelopment | Current model assumes construction; raw land is about value uplift via approvals. | ✅ LANDED |

### What's intentionally NOT on the roadmap (operator-removed)

- ~~Forward SOFR rate curve~~ — US-centric. India uses Repo Rate + spread or MCLR + spread. Replaced by I6 above.
- ~~Forward interest rate curve / debt-cost projection~~ — requires external rate feeds. Indian operators typically run a single rate scenario.
- ~~Excel native Scenario Manager~~ — ExcelJS limitation, not worth the workaround. Sensitivity grid + tornado from PR-G already cover the use case.
- ~~SOFR sheet from NAIOP template~~ — US benchmark, not relevant.

### What's still on the roadmap but lower priority

- Monthly cash flow detail (vs current quarterly) — large refactor; useful but quarterly is fine for most Indian institutional deals
- 2D sensitivity tables beyond the current 5×5 — nice-to-have
- KPI icon-sets + sparklines — visual polish
- Premium colour theme refinement — visual polish

### Recommended ship sequence

1. **PR-I1** — GST + Stamp Duty + Registration as real cost lines _(highest leverage, single PR)_
2. **PR-I2** — RERA Escrow 70/30 _(residential workflow correctness)_
3. **PR-I3** — JDA structures _(Bengaluru deal-structure coverage)_
4. **PR-I4** — Property Tax BBMP UAV fix _(quick correctness fix)_
5. **PR-I5** — Carpet / Loading Factor _(RERA compliance + clarity)_
6. **PR-I6** — Lender ecosystem _(institutional-grade debt profile)_
7. **PR-I7** — Taxation block _(post-tax IRR for investors)_
8. **PR-I10** — Approvals + RERA registration breakdown
9. PR-I8, I9, I11, I12, I13, I14, I15, I16 — asset-class-specific depth, sequence by deal-type demand

---

## Operator decision points

- **Buyer persona drives priority.** Selling to Indian PE / institutional capital (HDFC Capital, Edelweiss, Kotak, IIFL, Piramal, Brookfield-India, Blackstone-India) → I1 (GST + Stamp Duty) + I2 (RERA escrow) + I3 (JDA) + I6 (lender ecosystem) + I7 (taxation) are non-negotiable. Selling to family offices / HNI → I3 (JDA), I7 (LTCG), I8 (Khata) matter most. Selling to international LPs → I7 (taxation transparency), I6 (lender benchmarks vs LIBOR/SOFR alternatives) matter.
- **Single PR thread (recommended).** Ship I1 → I2 → I3 → I4 in sequence. Each independently verifiable + each closes a real correctness hole.
- **Where to stop?** I1-I4 brings the model to "any Bengaluru deal professional can read it without flinching." I5-I7 brings it to "institutional capital underwriter takes it seriously." I8-I16 is asset-class-specific depth that ships as buyer demand dictates.

---

## What I cannot do alone

Even with the India localization batch fully closed, the workbook still won't fully match the references because:
- **Real institutional templates are hand-tuned per deal** over months by analysts; they embed deal-specific commentary, sources, micro-market overrides, exception handling
- **Lender quotes + sanction letters** require external data feeds (rate sheets from HDFC / ICICI / Edelweiss / IIFL) that Acureal doesn't ingest yet
- **State-specific stamp duty** varies (Karnataka 5.6% + 1% reg = 6.6%; Maharashtra 5-6%; Telangana 7.5%; Tamil Nadu 7%). The workbook defaults to Karnataka — operators outside BLR should override the StampRegPct input
- **GST rates change at every Council meeting** — the defaults reflect the regime as of 2026-05-11; operators should sanity-check against the live notification list before signing

Acureal's value is *deterministic, audit-trail-able pro forma generation from kernel inputs, calibrated to Indian operating reality* — not a substitute for a senior analyst's underwriting. Set buyer expectations accordingly: this is a starting point that saves the analyst hours of skeleton-building, not a replacement for their judgement. Every AI-assisted narrative in the deck (risk summary, IC memo) still carries the "AI-assisted — requires human review" label per CLAUDE.md.
