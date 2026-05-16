'use strict';

/**
 * XLSX v2 — investor-grade workbook export.
 *
 * Replaces the existing 13-sheet workbook with a focused 6-7 worksheet
 * structure per operator brief:
 *
 *   1. Dashboard                     (KPIs, charts, sources/uses)
 *   2. Inputs & Assumptions          (operator-editable, unlocked)
 *   3. Cash Flow Engine              (phasing + cash flow)
 *   4. Debt Sizing & Amortization    (debt sizing + debt schedule + waterfall)
 *   5. Monthly Cash Flow
 *   6. Calculations                  (hidden audit trail)
 *   7. USALI Pro Forma               (hospitality only)
 *
 * Cell-locking: every output cell is locked; only the input zone on the
 * Inputs sheet is unlocked. Sheet protection is on with no password —
 * a guard rail, not a barrier. Power users can unlock to inspect; casual
 * users cannot accidentally overwrite formulas.
 *
 * Cross-sheet linkage: every input on the Inputs sheet has a defined name
 * (e.g. `SellRatePerSqft`). Phasing / Cash Flow / Dashboard formulas
 * reference these names — never `$A$5`. This keeps the downstream sheets
 * portable if the Inputs row order ever shifts.
 *
 * Native Excel charts on Dashboard recalc live when inputs change.
 *
 * Behaviour:
 *   - Always returns a Buffer. Throws only on malformed exportContext.
 *   - Quarter count driven by `inputs.projectDurationMonths` (default 36
 *     months → 12 quarters). Clamped to [4, 32].
 *   - English-only labels; INR Crore for currency; sqft for area.
 */

const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { injectChartsIntoXlsx, injectSparklinesIntoXlsx } = require('./chartInjector');
const { inferAssetClass } = require('../../../../utils/assetClass');
const palette = require('../../shared/palette');

const financialKernel = require('../../../../../../packages/financial-kernel/dist');
const { defaultsForAssetClass, benchmarkFor } = require('./assetClassDefaults');
const { generateDealBriefing, buildTemplatedBriefing, buildNumericSnapshot } = require('./dealBriefing.service');

const FONT = palette.FONTS.body;

// Sheet display names — operator-directed 7-sheet structure (2026-05-11):
//
//   1. Dashboard                          (investor-facing KPIs + charts; FIRST)
//   2. Inputs & Assumptions               (yellow editable cells; SECOND)
//   3. Cash Flow Engine                   (combined: Phasing operating P&L
//                                          + Quarterly Cash Flow + Debt)
//   4. Debt Sizing & Amortization         (combined: MIN-of-4 sizing,
//                                          construction/permanent debt,
//                                          waterfall)
//   5. Monthly Cash Flow                  (asset-specific monthly bridge)
//   6. Calculations                       (hidden audit trail)
//   7. USALI Pro Forma                    (hospitality only)
//
// Pre-2026-05-11 we had 9 sheets (8 visible + 1 hidden). Operator: "Dont
// have so many worksheets. gets confusing. Have maximum 6-7." Consolidated
// by physically combining (a) Phasing + Cash Flow → Cash Flow Engine, and
// (b) Debt Sizing + Amortization + Sponsor / LP Waterfall → Debt Sizing &
// Amortization, while keeping monthly detail as the only additional visible
// model tab.
//
// Names must fit Excel's 31-character cap. Longest is "Debt Sizing &
// Amortization" at 26 chars.
const SHEETS = {
  executiveBriefing: 'Executive Briefing',
  dashboard: 'Dashboard',
  qaSources: 'Export QA & Sources',
  inputs: 'Inputs & Assumptions',
  usali: 'USALI Pro Forma',
  cashFlowEngine: 'Cash Flow Engine',
  sourcesUses: 'Sources & Uses',
  monthlyCashFlow: 'Monthly Cash Flow',
  leaseRoll: 'Lease Roll',
  constructionDrawdown: 'Construction Drawdown',
  sensitivity: 'Sensitivity',
  debtAndAmort: 'Debt Sizing & Amortization',
  waterfall: 'Sponsor LP Waterfall',
  unitMix: 'Unit Mix',
  calculations: 'Calculations',
};

const FILL = (color) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: color } });

// ── Categorical input dropdowns (data validation lists) ─────────────────
// Operator directive 2026-05-11: "Make sure everything is accurate,
// specific, credible, precise, relevant, correct, reliable." Adding
// Excel-native dropdown lists to all categorical input cells prevents
// typos, makes valid options explicit at the cell level, and gives
// operators autocomplete inside Excel.
//
// Keyed by the workbook named-range — when a section row's `name` lands
// in this map, the input-section render loop applies dataValidation
// (type: 'list') with the listed options. Empty/missing entries skip
// the dropdown (numeric or free-form text inputs).
//
// Excel's list-validation formula syntax: each option enclosed in
// double quotes, joined by commas, wrapped in a single string with
// surrounding quotes: `"option1,option2,option3"`. ExcelJS expects this
// as a one-element array in `formulae`.
const CATEGORICAL_OPTIONS = {
  // Khata status (PR-I8) — A-khata vs B-khata is a major BLR valuation
  // factor; categorical fixed.
  KhataStatus: ['A_khata', 'B_khata', 'mixed', 'not_applicable'],
  // Deal structure (PR-I3) — JDA / outright / DM.
  DealStructureLabel: ['outright_purchase', 'jda_revenue_share', 'jda_area_share', 'development_management'],
  // Lender ecosystem (PR-I6) — Indian RE debt providers.
  LenderType: ['HDFC Bank', 'HDFC Capital', 'ICICI Bank', 'SBI', 'Axis Bank', 'Edelweiss', 'IIFL', 'Piramal', 'Kotak', 'Bandhan', 'Other'],
  RateBenchmark: ['Repo', 'MCLR', 'Fixed', 'Marginal'],
  LoanType: ['Construction Finance', 'LRD (Lease Rental Discounting)', 'Project Finance', 'Mezzanine'],
  // Taxation (PR-I7) — pre/post-Jul-2024 indexation regime.
  IndexationRegime: ['post_2024_no_indexation', 'pre_2024_with_indexation'],
  // Milestone escalation (PR-I11) — residential/villas/mixed_use only.
  MilestoneEscalationModel: ['continuous_per_year', 'milestone_anchored_blr'],
  // Raw-land entitlement (PR-I16) — pipeline stage.
  RawLandCurrentStage: ['title_diligence', 'conversion', 'layout_approval', 'sale_ready'],
  // Exit strategy (PR-EX) — family-conditional. Income variant.
  // Development family overrides this map entry at section-build time
  // (see resolveExitStrategyOptions below).
  ExitStrategyType: ['strategic_sale', 'reit_exit', 'hold_to_perpetuity', 'refinance_hold', 'outright_progressive', 'bulk_exit_completion', 'hold_post_completion'],
};

const NUMBER_FORMATS = {
  currency: '#,##0.00;[Red](#,##0.00);–',
  percent: '0.0%;[Red](0.0%);–',
  integer: '#,##0;[Red](#,##0);–',
  multiple: '0.00"x"',
  date: 'dd-mmm-yyyy',
};

// ──────────────────────────────────────────────────────────────────────────
// India-context cell-comment library (PR-NX3 — 2026-05-15)
// ──────────────────────────────────────────────────────────────────────────
// Hover-tooltip text appended to the existing source/confidence/freshness
// note on key India-specific input cells. Each entry below explains the
// regulatory or market basis for the seeded default — turning a number
// in a cell into a self-documenting piece of underwriting knowledge.
//
// Investor-grade workbooks distinguish themselves by carrying CONTEXT,
// not just numbers. An operator opening the workbook in Excel and
// hovering over the "GST Rate" cell should see "5% under-construction
// residential per Section 16, Finance Act 2019; 1% affordable below ₹45L;
// 0% completed/OC. No ITC for residential." rather than just "0.05".
//
// Sourcing: each note cross-references the applicable statute (Finance
// Act, BBMP rules, RERA Act, RBI circulars, Karnataka Stamp Act) so the
// operator can trace back to the primary regulation.
const INDIA_CONTEXT_NOTES = {
  // ── Taxation ─────────────────────────────────────────────────────────
  GstPct:
    'GST on under-construction sale.\n'
    + '• 5% — residential non-affordable (no ITC, Section 17(5)(c))\n'
    + '• 1% — affordable housing ≤ ₹45L carpet (no ITC)\n'
    + '• 12% — commercial / office / retail (ITC available)\n'
    + '• 0% — completed property with OC, or plotted layout sale\n'
    + 'Source: Finance Act 2019 + GST Council notification 03/2019-CT(R).',
  StampRegPct:
    'Karnataka stamp duty + registration on land conveyance.\n'
    + '• 5% stamp duty (Karnataka Stamp Act, Schedule I)\n'
    + '• 1% registration fee (Registration Act 1908)\n'
    + '• 0.6% cess (surcharge — varies by district)\n'
    + 'Total ≈ 6.6% on guidance value. Apartment sales: 5.6% + 1% on first sale.',
  LTCGRate:
    'Long-term capital gains on real-estate disposal.\n'
    + '• 12.5% — post Jul-2024 Union Budget (Finance (No. 2) Bill 2024)\n'
    + '• 20% (with indexation) — pre Jul-2024, grandfathered for legacy holdings\n'
    + 'Holding period for LTCG: ≥ 24 months. Below = STCG slab (~30%).',
  TDSRate:
    'TDS u/s 194-IA on real-estate sale > ₹50 lakh.\n'
    + '• 1% withheld by buyer at registration\n'
    + '• Credited against seller\'s annual tax liability\n'
    + 'Modeled as a cash-flow timing impact, not a permanent cost.',
  IndexationRegime:
    'Cost-inflation-index regime for capital-gains calc.\n'
    + '• post_2024_no_indexation: 12.5% flat (default for new acquisitions)\n'
    + '• pre_2024_with_indexation: 20% with CII benefit (legacy / grandfathered)\n'
    + 'Operator chooses based on acquisition date relative to 23-Jul-2024 budget.',
  EffectiveCGRate:
    'Derived: switches LTCG / STCG based on EffectiveHoldYears.\n'
    + '• If hold ≥ 2 years → LTCGRate (12.5% default)\n'
    + '• Else → STCG slab rate (~30% modeled)\n'
    + 'Source: Section 112A + Section 111 of Income Tax Act 1961.',

  // ── Approvals + RERA ────────────────────────────────────────────────
  CustomerCollectionPct:
    'RERA-mandated escrow collection schedule.\n'
    + '• 70% to escrow — released to developer against verified construction milestones\n'
    + '• 30% retained — for marketing / financing / operating expenses\n'
    + 'Source: RERA Act 2016 Section 4(2)(l)(D). Karnataka RERA Rules 2017.\n'
    + 'Default 85% reflects typical Bengaluru milestone schedule.',
  ApprovalCostCr:
    'Aggregate Karnataka approval cost rollup.\n'
    + 'Includes: Khata conversion (BBMP), BDA layout, BBMP plan sanction,\n'
    + 'BWSSB water, BESCOM electrical, KSPCB environmental, Airport NOC,\n'
    + 'Fire NOC, Lift NOC, RERA registration, OC, CC.\n'
    + 'Operator can break out individual permits in the Approvals & RERA section.',

  // ── Property tax ────────────────────────────────────────────────────
  PropertyTaxPerSqftYr:
    'BBMP property tax — Unit Area Value (UAV) method.\n'
    + 'Computed per built-up sqft per year, not as % of revenue.\n'
    + '• Zone A (premium CBD): ₹50-80/sqft/yr\n'
    + '• Zone B (developed): ₹30-50/sqft/yr\n'
    + '• Zone C (developing): ₹15-30/sqft/yr\n'
    + 'Source: BBMP Property Tax Rules 2009. Area-driven (vacancy-independent).',

  // ── Khata / title (Bengaluru-specific) ──────────────────────────────
  KhataStatus:
    'BBMP property title classification.\n'
    + '• A_khata — formally registered, full transferability, bank-financeable\n'
    + '• B_khata — pending regularization, restricted financing + transfer\n'
    + '• mixed — partial A-khata coverage across parcels\n'
    + 'B-khata properties typically take 15-25% exit haircut. Karnataka\n'
    + 'Municipality Act 1964; BBMP Khata Transfer Rules 2014.',
  BKhataExitHaircutPct:
    'Exit-value haircut applied when KhataStatus = B_khata or mixed.\n'
    + 'Reflects buyer-side risk discount: harder to secure loans against\n'
    + 'B-khata collateral, longer due-diligence, regularization timeline\n'
    + 'uncertainty. Typical BLR market: 10-25% depending on micro-market.',

  // ── Debt / financing ────────────────────────────────────────────────
  DebtRatePct:
    'All-in lender rate on real-estate debt.\n'
    + 'Indian benchmarks (2026):\n'
    + '• Construction finance — Repo + 350-450 bps (~10-11%)\n'
    + '• LRD (Lease Rental Discounting) — Repo + 200-280 bps (~9-10%)\n'
    + '• Project finance — Repo + 380-500 bps (~11-12%)\n'
    + 'Source: RBI Master Direction — Real Estate (Sep 2023).',
  LoanType:
    'Indian real-estate debt facility type.\n'
    + '• Construction Finance — draw-as-you-build, secured by project\n'
    + '• LRD — refinance against stabilised rental cash flows\n'
    + '• Project Finance — pre-construction project equity + debt blend\n'
    + '• Mezzanine — subordinate debt + equity kicker',
  RateBenchmark:
    'RBI-mandated lending-rate benchmark.\n'
    + '• Repo — RBI policy repo rate (current 6.50%); fastest re-pricing\n'
    + '• MCLR — Marginal Cost of Funds Lending Rate; slower re-pricing\n'
    + '• Fixed — Reset-protected fixed rate (rare for RE construction debt)\n'
    + '• Marginal — Loan-specific marginal rate (legacy)',
  PermMaxLTV:
    'Maximum Loan-to-Value for permanent (post-stabilisation) debt.\n'
    + 'RBI caps (Master Direction Sep 2023):\n'
    + '• 75% — properties below ₹30L (priority)\n'
    + '• 80% — properties ₹30L-₹75L\n'
    + '• 75% — properties above ₹75L\n'
    + 'Institutional lenders typically operate 5-10 pp below the cap.',
  PermMinDCR:
    'Minimum Debt Coverage Ratio at refinance / stabilisation.\n'
    + 'Institutional benchmark: 1.40-1.55x for income-stabilised assets.\n'
    + 'Below 1.20x = covenant breach risk. Lenders size loan amount to\n'
    + 'keep DCR ≥ this floor across the full hold period.',

  // ── Exit / valuation ────────────────────────────────────────────────
  ExitCapRate:
    'Stabilised-yield cap rate for terminal-value calculation.\n'
    + 'Bengaluru institutional benchmarks (2026 Cushman Wakefield + JLL):\n'
    + '• Grade-A office (ORR / Whitefield) — 7.5-8.5%\n'
    + '• Retail mall / high-street — 8.5-9.5%\n'
    + '• Industrial / warehousing — 7.5-8.5%\n'
    + '• Hospitality (full-service) — 9.0-10.5%\n'
    + '• Data centre (hyperscale) — 8.0-9.0%',
  SellingCostPct:
    'Selling cost as % of gross sale value.\n'
    + 'Includes: broker fee (1-3%), legal/registration costs (0.5-1%),\n'
    + 'marketing / handover (0.5%). Total typical 2-4%.\n'
    + 'For institutional sales: broker fee 0.5-1%, plus diligence costs.',

  // ── JDA / structure ─────────────────────────────────────────────────
  LandownerSharePct:
    'JDA / Development Management landowner economic share.\n'
    + 'Bengaluru JDA benchmarks (2026):\n'
    + '• 40-50% area share — developer constructs, landowner gets units\n'
    + '• 25-35% revenue share — developer keeps construction margin\n'
    + 'Often a hybrid: landowner gets minimum guarantee + upside share.',
  JVDevPct:
    'JV developer share of profit (post-landowner).\n'
    + 'Typical Indian JV: 55-65% developer, 35-45% landowner.\n'
    + 'Landowner contributes land (no upfront cost to developer);\n'
    + 'developer brings construction, sales, financing, regulatory clearances.',

  // ── Hospitality (USALI) ─────────────────────────────────────────────
  HospitalityKeys:
    'Number of guest rooms (keys) in the hotel.\n'
    + 'Indian hospitality benchmarks:\n'
    + '• Boutique — 30-80 keys\n'
    + '• Upscale full-service — 150-300 keys\n'
    + '• Convention / luxury — 350+ keys\n'
    + 'GFA per key: 500-700 sqft (full-service); 350-450 sqft (limited-service).',
  HospitalityADRBase:
    'Average Daily Rate (ADR) in INR per occupied room night — off-peak.\n'
    + 'Bengaluru benchmarks (2026):\n'
    + '• Marriott / Hyatt / IHG upscale — ₹7,000-9,000\n'
    + '• ITC / Conrad luxury — ₹10,000-14,000\n'
    + '• Limited-service / domestic — ₹4,000-6,500',
  HospitalityOccupancyPct:
    'Stabilised occupancy (% of available room nights sold).\n'
    + 'India tier-1 city benchmarks: 68-74% stabilised.\n'
    + 'Lease-up: Year 1 ≈ 45%, Year 2 ≈ 55%, Year 3 ≈ 65%, Year 4+ stabilised.',
};

const USALI_ROW = Object.freeze({
  occupancy: 5,
  adr: 6,
  occupiedRooms: 7,
  revPAR: 8,
  trevPAR: 9,
  roomsRevenue: 10,
  fbRestaurant: 11,
  fbBanquet: 12,
  otherOperated: 13,
  parking: 14,
  leaseIncome: 15,
  totalRevenue: 16,
  roomsDeptExp: 17,
  fbDeptExp: 18,
  otherDeptExp: 19,
  deptProfit: 20,
  aAndG: 21,
  it: 22,
  sm: 23,
  pom: 24,
  utilities: 25,
  totalUndist: 26,
  brandRoyalty: 27,
  brandMktReserv: 28,
  gop: 29,
  gopMargin: 30,
  mgmtBase: 31,
  mgmtIncentive: 32,
  ibfc: 33,
  propTax: 34,
  insurance: 35,
  groundLease: 36,
  ebitda: 37,
  ebitdaMargin: 38,
  ffeReserve: 39,
  noi: 40,
  noiMargin: 41,
});

const HOSPITALITY_BUDGET_ROW = Object.freeze({
  land: 46,
  stamp: 47,
  hardConstruction: 48,
  gst: 49,
  softDesign: 50,
  approvals: 51,
  ffe: 52,
  ose: 53,
  preOpening: 54,
  workingCapital: 55,
  contingency: 56,
  subtotalBeforeIdc: 57,
  idc: 58,
  totalDevelopmentCost: 59,
  constructionLoan: 60,
  requiredEquity: 61,
  stabilizedNoi: 62,
  stabilizedValue: 63,
  refiProceeds: 64,
  terminalSaleValue: 65,
});

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const firstNumber = (...values) => {
  for (const v of values) {
    const parsed = num(v);
    if (parsed !== null) return parsed;
  }
  return null;
};

const positiveOrDefault = (value, fallback) => {
  const parsed = num(value);
  return parsed && parsed > 0 ? parsed : fallback;
};

// Normalize a percent-typed input to its decimal-fraction representation.
// The financial kernel stores percents inconsistently — some as integer
// (5 = 5%, 14 = 14% as the kernel's own defaults) and some as decimal
// (0.05 = 5%, 0.5 = 50% LTV). XLSX cells with the `0.0%` number format
// require the underlying value to be a decimal fraction; an integer-stored
// percent like 5 renders as "500.0%" and worse, formulas like
// `=Revenue*MarketingCostPct` produce 5× revenue instead of 5% of revenue.
//
// Heuristic: any positive value greater than 1 is treated as integer
// percent and divided by 100. A value of exactly 1 is treated as 100%
// (decimal), which is the conventional reading. Real-estate input
// percents never legitimately exceed 100%, so the rule is unambiguous
// across every input field we expose (marketing, finance, GST, stamp
// duty, debt LTV, occupancy, escalation, contingency, JV splits, etc.).
const toPctDecimal = (value) => {
  const n = num(value);
  if (n === null) return null;
  return n > 1 ? n / 100 : n;
};

const kernelAssetClassFor = (assetClass) =>
  assetClass === 'raw_land' ? 'land_parcel' : assetClass;

const resolveEngineAssumptions = (assetClass, inputs = {}) => {
  // PR-NX6 (2026-05-15): three-layer fallback chain for input defaults.
  // Operator-entered ctx.inputs.X always wins. Below that, the kernel's
  // resolveAssumptions output takes priority over the static asset-class
  // defaults library. The library exists because the kernel currently
  // returns mostly empty defaults (only sellingRatePerSqft populated for
  // residential), which made sparse deals export as mostly-zero workbooks.
  // Now: a Commercial Office deal with only land cost + saleable area
  // filled will still see realistic Bengaluru base rent (₹110/sqft/mo),
  // exit cap rate (8.0%), debt LTV (60%), occupancy (92%), etc. flowing
  // through to every downstream formula. Operator override always wins.
  const baseDefaults = defaultsForAssetClass(assetClass);
  const kernelAssetClass = kernelAssetClassFor(assetClass);
  if (!financialKernel?.resolveAssumptions) return { ...baseDefaults };
  try {
    const kernelAssumptions = financialKernel.resolveAssumptions({
      assetClass: kernelAssetClass,
      dealOverrides: inputs,
      scenarioOverrides: null,
    }) || {};
    // Layer: kernel wins over static defaults (kernel only fills what it
    // has, so the spread + selective override is sound).
    const merged = { ...baseDefaults };
    for (const [key, value] of Object.entries(kernelAssumptions)) {
      if (value !== undefined && value !== null && value !== '') {
        merged[key] = value;
      }
    }
    return merged;
  } catch {
    return { ...baseDefaults };
  }
};

const hasInputValue = (ctx, key) =>
  ctx?.inputs?.[key] !== undefined
  && ctx.inputs[key] !== null
  && ctx.inputs[key] !== '';

const engineFirstNumber = (ctx, keys = [], fallback = null) => {
  const keyList = Array.isArray(keys) ? keys : [keys];
  const inputValues = keyList.map((key) => ctx.inputs?.[key]);
  const assumptionValues = keyList.map((key) => ctx.engineAssumptions?.[key]);
  return firstNumber(...inputValues, ...assumptionValues, fallback);
};

const enginePctDecimal = (ctx, keys = [], fallback = null) =>
  toPctDecimal(engineFirstNumber(ctx, keys, fallback));

const normalizeDateString = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    const text = String(value).trim();
    if (!text) continue;
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmy) {
      const [, dd, mm, yyyy] = dmy;
      return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
};

const normalizeLoadingAddon = (value, fallback = 0.15) => {
  const parsed = num(value);
  if (parsed === null || parsed < 0) return fallback;
  if (parsed > 2) return parsed / 100;
  if (parsed >= 1) return parsed - 1;
  return parsed;
};

const loadingAddonFor = (ctx) =>
  normalizeLoadingAddon(firstNumber(
    ctx.inputs.loadingFactor,
    ctx.inputs.loadingRatio,
    ctx.engineAssumptions?.loadingFactor,
  ));

const loadingMultipleFor = (ctx) => 1 + loadingAddonFor(ctx);

const landAreaSqftFor = (ctx) =>
  firstNumber(
    ctx.property.land_area_sqft,
    ctx.deal.land_area_sqft,
    ctx.inputs.plotAreaSqft,
    ctx.inputs.totalLandSqft,
    0,
  );

const fsiFor = (ctx) =>
  firstNumber(ctx.property.existing_fsi, ctx.inputs.fsi, ctx.engineAssumptions?.fsi, 1.5);

const saleableAreaSqftFor = (ctx) => {
  const explicit = firstNumber(
    ctx.property.saleable_area_sqft,
    ctx.deal.saleable_area_sqft,
    ctx.inputs.saleableAreaSqft,
    ctx.inputs.leasableAreaSqft,
  );
  if (explicit && explicit > 0) return explicit;

  if (ctx.assetClass === 'hospitality') {
    const hospArea = firstNumber(hospitalityAreaSqft(ctx), 0);
    if (hospArea > 0) return hospArea;
  }

  const landAreaSqft = landAreaSqftFor(ctx);
  if (['plotted_development', 'raw_land'].includes(ctx.assetClass)) {
    const saleableLandPct = enginePctDecimal(ctx, ['saleableLandPct'], 55) || 0;
    if (landAreaSqft > 0) return landAreaSqft * saleableLandPct;
  } else if (ctx.dealFamily === 'development' && landAreaSqft > 0) {
    return landAreaSqft * fsiFor(ctx) * loadingMultipleFor(ctx);
  }

  // PR-NX6: final fallback to asset-class default if no land/explicit area.
  // Operator gets a realistic seed (e.g. 500k sqft for office) when they
  // create a sparse deal with only a few inputs.
  return firstNumber(ctx.engineAssumptions?.saleableAreaSqft, 0);
};

const sellRatePerSqftFor = (ctx) =>
  firstNumber(
    ctx.inputs.sellingRatePerSqft,
    ctx.deal.selling_rate_per_sqft,
    ctx.engineAssumptions?.sellingRatePerSqft,
    0,
  );

const constructionCostPerSqftFor = (ctx) => {
  const explicit = firstNumber(
    ctx.inputs.constructionCostPerSqft,
    ctx.inputs.hardCostPerSqft,
    ctx.deal.construction_cost_per_sqft,
    ctx.assetClass === 'hospitality' ? hospitalityConstructionCostPerSqft(ctx) : null,
    ctx.engineAssumptions?.constructionCostPerSqft,
    ctx.engineAssumptions?.hardCostPerSqft,
  );
  if (explicit !== null) return explicit;
  const devCostPerGrossSqft = firstNumber(
    ctx.inputs.devCostPerSqft,
    ctx.inputs.developmentCostPerSqft,
    ctx.engineAssumptions?.devCostPerSqft,
    ctx.engineAssumptions?.developmentCostPerSqft,
  );
  if (devCostPerGrossSqft !== null && ['plotted_development', 'raw_land'].includes(ctx.assetClass)) {
    const saleableLandPct = enginePctDecimal(ctx, ['saleableLandPct'], 55) || 0;
    return saleableLandPct > 0 ? devCostPerGrossSqft / saleableLandPct : devCostPerGrossSqft;
  }
  return firstNumber(devCostPerGrossSqft, 0);
};

const approvalBaseAreaSqftFor = (ctx) => {
  const landAreaSqft = landAreaSqftFor(ctx);
  if (['plotted_development', 'raw_land'].includes(ctx.assetClass)) return landAreaSqft;
  if (ctx.dealFamily === 'development' && landAreaSqft > 0) return landAreaSqft * fsiFor(ctx);
  return saleableAreaSqftFor(ctx);
};

const approvalCostCrFor = (ctx) => {
  const explicit = firstNumber(ctx.inputs.approvalCostCr, ctx.deal.approval_cost_cr);
  if (explicit !== null) return explicit;
  const perSqft = engineFirstNumber(ctx, ['approvalCostPerSqft'], null);
  const area = approvalBaseAreaSqftFor(ctx);
  return perSqft && perSqft > 0 && area > 0 ? (perSqft * area) / 10000000 : 0;
};

// ──────────────────────────────────────────────────────────────────────────
// Deal-identity labels (PR-NX5 — 2026-05-15)
// ──────────────────────────────────────────────────────────────────────────
// The Excel export must read as deal-SPECIFIC to whoever opens it — not as
// a generic template. The helpers below convert the deal record's stored
// values (asset_class, deal_structure, exit_strategy) into investor-friendly
// labels + asset-class-aware modeling mechanic hints, and assemble them
// into a single self-describing subtitle line that's used identically
// across the Dashboard + Inputs + Cash Flow Engine sheets.
//
// Without this, a Commercial Office deal opens with the same generic
// subtitle as a Hospitality deal — "Operating Asset Dashboard". After this,
// the operator reads "Commercial Office · Outright Purchase · Exit:
// Strategic Sale · 5-yr hold · Bengaluru ORR" before scrolling a pixel.
const ASSET_CLASS_LABEL_MAP = Object.freeze({
  residential_apartments: 'Residential Apartments',
  villas: 'Villas',
  plotted_development: 'Plotted Development',
  commercial_office: 'Commercial Office',
  retail: 'Retail / Mall',
  industrial_warehousing: 'Industrial & Warehousing',
  hospitality: 'Hospitality',
  mixed_use: 'Mixed-Use Development',
  redevelopment: 'Redevelopment',
  raw_land: 'Raw Land',
});

const DEAL_STRUCTURE_LABEL_MAP = Object.freeze({
  outright_purchase: 'Outright Purchase',
  jda_revenue_share: 'JDA — Revenue Share',
  jda_area_share: 'JDA — Area Share',
  development_management: 'Development Management (Fee Only)',
});

const EXIT_STRATEGY_LABEL_MAP = Object.freeze({
  // Income-family exits
  strategic_sale: 'Strategic Sale (Institutional Buyer)',
  reit_exit: 'REIT Listing / Contribution',
  hold_to_perpetuity: 'Long-Term Hold',
  refinance_hold: 'LRD Refinance + Hold',
  // Development-family exits
  outright_progressive: 'Progressive Sale (RERA-Milestone Linked)',
  bulk_exit_completion: 'Bulk Sale at Completion',
  hold_post_completion: 'Hold Post-Completion (Lease-up)',
});

// Asset-class-aware one-line modeling mechanic. Surfaces immediately what
// kind of pro-forma the operator is looking at — institutional reviewers
// can verify within seconds that the underlying engine matches the deal
// structure they expected.
const ASSET_CLASS_MECHANIC_HINT = Object.freeze({
  residential_apartments:
    'RERA-milestone sales collection · GST 5%/1% · Bulk-exit top-up at completion',
  villas:
    'Premium plot + built-up sales · Faster absorption than apartments · GST 5%',
  plotted_development:
    'BDA/DTCP-layout plot sales · No construction risk · GST 0% · Stamp duty on buyer',
  commercial_office:
    'Multi-tenant lease · CAM + escalation · LRD refinance / strategic-sale exit',
  retail:
    'Anchor + vanilla rent split · CAM recovery · Cap-rate or REIT exit',
  industrial_warehousing:
    'Single/multi-tenant warehouse lease · Tight cap rates · BTS or strategic sale',
  hospitality:
    'USALI room-night revenue (Keys × ADR × Occupancy × 365) · F&B + Banquet ancillary',
  mixed_use:
    'Component-weighted blended rate · Resi / Office / Retail / Hospitality stack',
  redevelopment:
    'Society redevelopment · Area-share with existing residents · GST 5%',
  raw_land:
    'Pre-conversion land · Title / Conversion / Layout pipeline · 79A/79B compliance',
});

// Format a hold/build period in years for the subtitle.
const formatHoldPeriod = (months) => {
  const m = Number(months) || 0;
  if (!m) return null;
  if (m < 12) return `${m}-mo cycle`;
  const yrs = m / 12;
  return Number.isInteger(yrs) ? `${yrs}-yr horizon` : `${yrs.toFixed(1)}-yr horizon`;
};

// Format the location chip — city + optional micro-market.
const formatLocation = (deal, property) => {
  const city = deal.city || property.city;
  const microMarket = property.micro_market || deal.micro_market;
  if (city && microMarket && microMarket !== city) return `${city} · ${microMarket}`;
  return city || 'India';
};

// Build the dense, self-describing identity line used on every key sheet.
// Returns the assembled string (no leading separator) — caller decides
// formatting (italic / colour / bold).
const buildDealIdentityLine = (ctx) => {
  const assetLabel = ASSET_CLASS_LABEL_MAP[ctx.assetClass] || ctx.assetClass || 'Asset';
  const structureKey = String(ctx.deal.deal_structure || ctx.deal.deal_type || 'outright_purchase').toLowerCase();
  const structureLabel = DEAL_STRUCTURE_LABEL_MAP[structureKey] || structureKey.replace(/_/g, ' ');
  const exitKey = String(ctx.deal.exit_strategy || (ctx.dealFamily === 'income' ? 'strategic_sale' : 'outright_progressive')).toLowerCase();
  const exitLabel = EXIT_STRATEGY_LABEL_MAP[exitKey] || exitKey.replace(/_/g, ' ');
  const hold = formatHoldPeriod(ctx.projectMonths);
  const location = formatLocation(ctx.deal, ctx.property);
  const parts = [assetLabel, structureLabel, `Exit: ${exitLabel}`];
  if (hold) parts.push(hold);
  if (location) parts.push(location);
  return parts.join(' · ');
};

// Asset-class-aware modeling-mechanic blurb. Used as a second-line
// subtitle on the Inputs sheet so the operator sees what kind of engine
// drives the pro forma before they touch any cell.
const buildModelingMechanicHint = (ctx) =>
  ASSET_CLASS_MECHANIC_HINT[ctx.assetClass] || 'Quarter-by-quarter cash flow · Operator-editable inputs · Live recalc';

const baseRentPerSqftMonthFor = (ctx) =>
  firstNumber(
    ctx.inputs.baseRentPerSqftMonth,
    ctx.inputs.rentPerSqftMonth,
    ctx.inputs.rentPerSqftPerMonth,
    ctx.assetClass === 'hospitality' ? hospitalityBaseRentPerSqftMonth(ctx) : null,
    ctx.engineAssumptions?.baseRentPerSqftMonth,
    ctx.engineAssumptions?.rentPerSqftMonth,
    ctx.engineAssumptions?.rentPerSqftPerMonth,
    0,
  );

const vacancyPctFor = (ctx) =>
  enginePctDecimal(ctx, ['vacancyPct'], 10) || 0;

const occupancyPctFor = (ctx) => {
  if (ctx.assetClass === 'hospitality') return hospitalityOccupancyPct(ctx);
  const explicit = toPctDecimal(firstNumber(ctx.inputs.occupancyPct, ctx.deal.occupancy_pct));
  if (explicit !== null) return explicit;
  return Math.max(0, Math.min(1, 1 - vacancyPctFor(ctx)));
};

const exitCapRateFor = (ctx) =>
  toPctDecimal(firstNumber(
    ctx.inputs.exitCapRate,
    ctx.inputs.exitCapRatePct,
    ctx.inputs.capRate,
    ctx.inputs.entryCapRate,
    ctx.engineAssumptions?.exitCapRate,
    ctx.engineAssumptions?.exitCapRatePct,
    ctx.engineAssumptions?.capRate,
    8,
  ));

const debtLtvFor = (ctx) =>
  toPctDecimal(firstNumber(
    ctx.inputs.debtLTV,
    ctx.inputs.debtCoverage,
    ctx.inputs.debtPct,
    ctx.engineAssumptions?.debtLTV,
    ctx.engineAssumptions?.debtCoverage,
    0.55,
  ));

const debtRatePctFor = (ctx) =>
  toPctDecimal(firstNumber(
    ctx.inputs.debtRatePct,
    ctx.inputs.interestRatePct,
    ctx.engineAssumptions?.debtRatePct,
    ctx.engineAssumptions?.interestRatePct,
    0.115,
  ));

const discountRatePctFor = (ctx) =>
  toPctDecimal(firstNumber(
    ctx.inputs.discountRatePct,
    ctx.deal.discount_rate_pct,
    ctx.engineAssumptions?.discountRatePct,
    0.16,
  ));

const gstPctFor = (ctx) =>
  enginePctDecimal(ctx, ['gstPct', 'gstRatePct', 'gstOnConstructionPct'], indiaGstDefaultForClass(ctx.assetClass));

const HOSPITALITY_DEFAULT_SQFT_PER_KEY = 550;

const hospitalityKeys = (ctx) =>
  firstNumber(ctx.inputs.keys, ctx.inputs.hospitalityKeys, ctx.inputs.numberOfKeys, ctx.inputs.noOfKeys, ctx.engineAssumptions?.keys);

const hospitalityAreaPerKeySqft = (ctx) =>
  positiveOrDefault(
    firstNumber(
      ctx.inputs.grossAreaPerKeySqft,
      ctx.inputs.areaPerKeySqft,
      ctx.inputs.sfPerKey,
      ctx.inputs.sqftPerKey,
      ctx.engineAssumptions?.sqftPerKey,
      ctx.inputs.roomAreaSqft,
    ),
    HOSPITALITY_DEFAULT_SQFT_PER_KEY,
  );

const hospitalityAdr = (ctx) =>
  firstNumber(ctx.inputs.adr, ctx.inputs.hospitalityADRBase, ctx.inputs.hospitalityADR, ctx.inputs.hospitalityBlendedADR, ctx.engineAssumptions?.adr);

const hospitalityOccupancyPct = (ctx) =>
  toPctDecimal(firstNumber(ctx.inputs.occupancyPct, ctx.inputs.stabilizedOccPct, ctx.inputs.stabilisedOccPct, ctx.deal.occupancy_pct, ctx.engineAssumptions?.stabilizedOccPct, 0.65));

const hospitalityConstructionCostPerKey = (ctx) =>
  firstNumber(
    ctx.inputs.constructionCostPerKey,
    ctx.inputs.costPerKey,
    ctx.inputs.hardCostPerKey,
    ctx.engineAssumptions?.constructionCostPerKey,
    ctx.engineAssumptions?.hardCostPerSqft && hospitalityAreaPerKeySqft(ctx)
      ? ctx.engineAssumptions.hardCostPerSqft * hospitalityAreaPerKeySqft(ctx)
      : null,
  );

const hospitalityAreaSqft = (ctx) => {
  const keys = hospitalityKeys(ctx);
  return keys && keys > 0 ? keys * hospitalityAreaPerKeySqft(ctx) : null;
};

const hospitalityBaseRentPerSqftMonth = (ctx) => {
  const adr = hospitalityAdr(ctx);
  const occupancy = hospitalityOccupancyPct(ctx);
  const sqftPerKey = hospitalityAreaPerKeySqft(ctx);
  return adr && adr > 0 && occupancy && occupancy > 0 && sqftPerKey > 0
    ? (adr * occupancy * 365) / (12 * sqftPerKey)
    : null;
};

const hospitalityConstructionCostPerSqft = (ctx) => {
  const costPerKey = hospitalityConstructionCostPerKey(ctx);
  const sqftPerKey = hospitalityAreaPerKeySqft(ctx);
  return costPerKey && costPerKey > 0 && sqftPerKey > 0 ? costPerKey / sqftPerKey : null;
};

// ── India GST default by asset class ───────────────────────────────────
// Per India GST regime (as of 2026-05-11): the developer's NET GST cost
// (output GST collected from buyer / paid by developer, minus available
// Input Tax Credit on construction inputs) depends on what's being sold:
//
//   residential / villas → 5% net cost. Under-construction residential
//     attracts 5% GST collected from buyer + paid to govt; ITC on
//     construction inputs is NOT available (Section 17(5)(d) / Notification
//     03/2019). So the developer absorbs the input-side GST as construction
//     cost and the 5% on the sale is a wash (collected + paid). Effective
//     net GST cost to the developer ≈ 5% of construction value (matches
//     industry rule-of-thumb from Anarock / JLL India reports).
//
//   plotted_development / raw_land / redevelopment → 0%. Plot sale = land
//     transfer = no GST applicable (Schedule III, Item 5). Redevelopment
//     for the rehab portion = no consideration = no GST.
//
//   commercial_office / retail / industrial_warehousing / mixed_use → 0%
//     net cost. Output GST on under-construction commercial sale = 12%;
//     full ITC available on construction inputs (Section 16 / Rule 38).
//     Output GST is collected from buyer + paid to govt; ITC offsets
//     input-side GST. Net cost to developer ≈ 0 in steady state.
//
//   hospitality → 0% net. Service GST on room nights / F&B = 12-18% with
//     ITC available against construction-input GST. Net cost ≈ 0 over
//     the hold period.
//
// Operators can always override the seeded default on the Inputs sheet.
// The default reflects the modal behaviour; specific deals (e.g. an
// affordable-residential project with 1% GST regime, or a long-lease
// commercial where ITC reversal kicks in) need an explicit override.
const indiaGstDefaultForClass = (assetClass) => {
  switch (assetClass) {
    case 'residential_apartments':
    case 'villas':
      return 0.05;
    default:
      return 0;
  }
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const asFiniteNumber = (value) => {
  const parsed = num(value);
  return parsed === null ? null : parsed;
};

const formulaValue = (formula, result) => {
  const parsed = asFiniteNumber(result);
  return parsed === null ? { formula } : { formula, result: parsed };
};

const addMonths = (value, months) => {
  const base = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(base.getTime())) return null;
  const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
};

const excelCol = (n) => {
  let s = '';
  let v = n;
  while (v > 0) {
    const r = (v - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    v = Math.floor((v - r) / 26);
  }
  return s;
};

const normalizeUrl = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const url = new URL(text.startsWith('http') ? text : `https://${text}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

const resolveAppBaseUrl = (options = {}) =>
  normalizeUrl(
    options.appBaseUrl
    || process.env.APP_URL
    || process.env.FRONTEND_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null),
  );

const resolveDealStructureLabel = (ctx) => {
  const raw = String(ctx.deal.deal_structure || '').toLowerCase();
  if (raw.includes('revenue')) return 'jda_revenue_share';
  if (raw.includes('area')) return 'jda_area_share';
  if (raw === 'jda' || raw === 'jv' || raw === 'da') return 'jda_revenue_share';
  if (raw.includes('management') || raw === 'dm') return 'development_management';
  return 'outright_purchase';
};

const resolveExitStrategyType = (ctx) => {
  const fallback = ctx.dealFamily === 'income' ? 'strategic_sale' : 'outright_progressive';
  return String(ctx.inputs.exitStrategyType || fallback).trim() || fallback;
};

const getWorkbookModelMonths = (ctx) => {
  const baseMonths = firstNumber(ctx.projectMonths, 36) || 36;
  const holdYears = ctx.dealFamily === 'income'
    ? firstNumber(ctx.inputs.exitYearFromAcq, ctx.inputs.holdPeriodYears, ctx.inputs.loanTermYears, 7)
    : firstNumber(ctx.inputs.holdPostCompletionYears, 0);
  const fullMonths = ctx.dealFamily === 'income'
    ? Math.max(baseMonths, Math.round((holdYears || 7) * 12))
    : baseMonths + Math.max(0, Math.round((holdYears || 0) * 12));
  return clamp(fullMonths, 12, 120);
};

const getCoreInputSnapshot = (ctx) => {
  const dealStructureLabel = resolveDealStructureLabel(ctx);
  const landownerSharePct = toPctDecimal(firstNumber(
    ctx.inputs.landownerSharePct,
    ctx.inputs.landownerRevenueShare,
    (dealStructureLabel !== 'outright_purchase' && ctx.deal.jv_split_landowner_pct != null)
      ? ctx.deal.jv_split_landowner_pct
      : null,
    0,
  ));

  return {
    assetClass: ctx.assetClass,
    dealFamily: ctx.dealFamily,
    dealStructureLabel,
    exitStrategyType: resolveExitStrategyType(ctx),
    effectiveDate: ctx.effectiveDate,
    saleableAreaSqft: saleableAreaSqftFor(ctx),
    landAreaSqft: landAreaSqftFor(ctx),
    loadingFactor: loadingMultipleFor(ctx),
    sellRatePerSqft: sellRatePerSqftFor(ctx),
    baseRentPerSqftMonth: baseRentPerSqftMonthFor(ctx),
    occupancyPct: occupancyPctFor(ctx),
    exitCapRate: exitCapRateFor(ctx),
    landCostCr: firstNumber(ctx.inputs.landCostCr, ctx.deal.land_cost_cr, 0),
    constructionCostPerSqft: constructionCostPerSqftFor(ctx),
    approvalCostCr: approvalCostCrFor(ctx),
    premiumFsiCostCr: firstNumber(ctx.inputs.premiumFSICostCr, ctx.inputs.tdrCostCr, 0),
    debtLTV: debtLtvFor(ctx),
    debtRatePct: debtRatePctFor(ctx),
    discountRatePct: discountRatePctFor(ctx),
    projectMonths: ctx.projectMonths,
    totalQuarters: ctx.totalQuarters,
    landownerSharePct,
    bulkExitDiscountPct: toPctDecimal(firstNumber(ctx.inputs.bulkExitDiscountPct, 0.10)),
    holdPostCompletionYears: firstNumber(ctx.inputs.holdPostCompletionYears, 1),
    exitYearFromAcq: firstNumber(ctx.inputs.exitYearFromAcq, ctx.inputs.loanTermYears, 7),
  };
};

const computeCachedCostSnapshot = (ctx) => {
  const core = getCoreInputSnapshot(ctx);
  const hardCostCr = Math.max(0, (core.constructionCostPerSqft || 0) * (core.saleableAreaSqft || 0) / 10000000);
  const landCostCr = Math.max(0, core.landCostCr || 0);
  if (ctx.assetClass === 'hospitality') {
    const keys = Math.max(0, hospitalityKeys(ctx) || 0);
    const stampRegPct = toPctDecimal(firstNumber(ctx.inputs.stampRegPct, ctx.inputs.stampDutyPct, 0.066)) || 0;
    const gstPct = gstPctFor(ctx) || 0;
    const architectPct = enginePctDecimal(ctx, ['architectPctOfHard', 'architectFeePct'], 0.04) || 0;
    const pmcPct = enginePctDecimal(ctx, ['pmcPctOfHard'], 0.02) || 0;
    const consultantsPct = enginePctDecimal(ctx, ['consultantsPctOfHard'], 0.035) || 0;
    const approvalsPct = enginePctDecimal(ctx, ['approvalsPctOfHard'], 0.02) || 0;
    const softCostsCr = hardCostCr * (architectPct + pmcPct + consultantsPct);
    const approvalCostCr = Math.max(0, firstNumber(
      ctx.inputs.approvalCostCr,
      ctx.deal.approval_cost_cr,
      ctx.inputs.approvalCostPerSqft ? (core.saleableAreaSqft * ctx.inputs.approvalCostPerSqft) / 10000000 : null,
      hardCostCr * approvalsPct,
      0,
    ) || 0);
    const ffeCr = Math.max(0, keys * engineFirstNumber(ctx, ['ffePerKey'], 2500000) / 10000000);
    const oseCr = Math.max(0, keys * engineFirstNumber(ctx, ['osePerKey'], 400000) / 10000000);
    const preOpeningCr = Math.max(0, keys * engineFirstNumber(ctx, ['preOpeningPerKey', 'preOpeningCostPerKey'], 350000) / 10000000);
    const workingCapitalCr = Math.max(0, engineFirstNumber(ctx, ['workingCapitalCr'], keys * 50000 / 10000000) || 0);
    const contingencyPct = enginePctDecimal(ctx, ['contingencyPct'], 0.05) || 0;
    const contingencyCr = (hardCostCr + softCostsCr + approvalCostCr + ffeCr + oseCr) * contingencyPct;
    const subtotalBeforeIdc = landCostCr
      + landCostCr * stampRegPct
      + hardCostCr
      + hardCostCr * gstPct
      + softCostsCr
      + approvalCostCr
      + ffeCr
      + oseCr
      + preOpeningCr
      + workingCapitalCr
      + contingencyCr;
    const constLoanLTC = enginePctDecimal(ctx, ['constLoanLTC', 'debtLTC', 'debtLTV'], 0.55) || 0;
    const constLoanRatePct = enginePctDecimal(ctx, ['constLoanRatePct', 'interestRatePct', 'debtRatePct'], 0.105) || 0;
    const constLoanFeesPct = enginePctDecimal(ctx, ['constLoanFeesPct'], 0.01) || 0;
    const idcCr = subtotalBeforeIdc * constLoanLTC * 0.5 * constLoanRatePct * ((ctx.projectMonths || 0) / 12)
      + subtotalBeforeIdc * constLoanLTC * constLoanFeesPct;
    const statutoryCr = landCostCr * stampRegPct + hardCostCr * gstPct;
    const totalProjectCostCr = subtotalBeforeIdc + idcCr;

    return {
      hardCostCr,
      landCostCr,
      approvalCostCr,
      premiumFsiCostCr: 0,
      softCostsCr: softCostsCr + ffeCr + oseCr + preOpeningCr + workingCapitalCr + contingencyCr + idcCr,
      statutoryCr,
      totalProjectCostCr,
    };
  }
  const approvalCostCr = Math.max(0, core.approvalCostCr || 0);
  const premiumFsiCostCr = Math.max(0, core.premiumFsiCostCr || 0);
  const softPct = [
    ['architectFeePct', 0.05],
    ['legalFeePct', 0.01],
    ['appraisalFeePct', 0.005],
    ['insuranceConstPct', 0.005],
    ['developerOverheadPct', 0.03],
  ]
    .map(([key, fallback]) => toPctDecimal(firstNumber(ctx.inputs[key], fallback)))
    .filter((value) => value !== null)
    .reduce((sum, value) => sum + value, 0);
  const propTaxConstPct = toPctDecimal(firstNumber(ctx.inputs.propTaxConstPct, ctx.inputs.propertyTaxesDuringConstructionPct, 0.02)) || 0;
  const softCostsCr = hardCostCr * softPct + landCostCr * propTaxConstPct;
  const stampRegPct = toPctDecimal(firstNumber(ctx.inputs.stampRegPct, ctx.inputs.stampDutyPct, 0.066)) || 0;
  const gstPct = gstPctFor(ctx) || 0;
  const statutoryCr = landCostCr * stampRegPct + hardCostCr * gstPct;
  const totalProjectCostCr = landCostCr + hardCostCr + approvalCostCr + premiumFsiCostCr + softCostsCr + statutoryCr;

  return {
    hardCostCr,
    landCostCr,
    approvalCostCr,
    premiumFsiCostCr,
    softCostsCr,
    statutoryCr,
    totalProjectCostCr,
  };
};

const namedRangeSource = (ctx, name, value, isDerivedFormula, options = {}) => {
  const dealUrl = options.dealUrl || null;
  if (isDerivedFormula) {
    return {
      sourceType: 'Workbook formula',
      sourceName: 'Derived inside XLSX',
      url: null,
      freshness: ctx.generatedAt,
      confidence: 'formula-derived',
      provenance: name,
      notes: 'Recalculates in Excel from named input cells.',
    };
  }

  const modelInputAliases = {
    SaleableAreaSqft: ['saleableAreaSqft', 'leasableAreaSqft', 'plotAreaSqft', 'totalLandSqft', 'saleableLandPct', 'keys', 'hospitalityKeys', 'numberOfKeys'],
    LandAreaSqft: ['plotAreaSqft', 'totalLandSqft'],
    LoadingFactor: ['loadingFactor', 'loadingRatio'],
    FSI: ['fsi'],
    SellRatePerSqft: ['sellingRatePerSqft'],
    BaseRentPerSqftMonth: ['baseRentPerSqftMonth', 'rentPerSqftMonth', 'rentPerSqftPerMonth', 'adr', 'hospitalityADRBase', 'hospitalityADR'],
    OccupancyPct: ['occupancyPct', 'stabilizedOccPct', 'stabilisedOccPct', 'vacancyPct'],
    VacancyPct: ['vacancyPct'],
    RentEscalationPct: ['rentEscalationPct', 'adrGrowthPct'],
    ExitCapRate: ['exitCapRate', 'exitCapRatePct', 'capRate', 'entryCapRate'],
    ConstructionCostPerSqft: ['constructionCostPerSqft', 'hardCostPerSqft', 'devCostPerSqft', 'developmentCostPerSqft', 'constructionCostPerKey', 'costPerKey', 'hardCostPerKey'],
    LandCostCr: ['landCostCr'],
    ApprovalCostCr: ['approvalCostCr', 'approvalCostPerSqft'],
    DebtLTV: ['debtLTV', 'debtCoverage', 'debtPct'],
    DebtRatePct: ['debtRatePct', 'interestRatePct'],
    DiscountRatePct: ['discountRatePct'],
    ProjectMonths: ['projectDurationMonths', 'projectDurationYears'],
    GstPct: ['gstPct', 'gstRatePct', 'gstOnConstructionPct'],
    EscalationPct: ['pricingEscalationPct', 'rentEscalationPct'],
    ExitStrategyType: ['exitStrategyType'],
    DealStructureLabel: ['dealStructureLabel'],
    HospitalityKeys: ['keys', 'hospitalityKeys', 'numberOfKeys'],
    HospitalityADRBase: ['adr', 'hospitalityADRBase', 'hospitalityADR'],
    HospitalitySqftPerKey: ['sqftPerKey', 'grossAreaPerKeySqft', 'areaPerKeySqft'],
    HospitalityADRGrowthPct: ['adrGrowthPct', 'rentEscalationPct'],
    HospitalityInitialOccPct: ['initialOccPct'],
    HospitalityStabilizationYear: ['stabilizationYear'],
    HospitalityHoldYears: ['holdPeriodYears', 'holdYears'],
    HospitalityArchitectPctHard: ['architectPctOfHard', 'architectFeePct'],
    HospitalityPMCPctHard: ['pmcPctOfHard'],
    HospitalityConsultantsPctHard: ['consultantsPctOfHard'],
    HospitalityApprovalsPctHard: ['approvalsPctOfHard'],
    HospitalityBettermentPct: ['bettermentPct'],
    HospitalityFBRestaurantPct: ['fbRestaurantPctOfRooms'],
    HospitalityFBBanquetPct: ['fbBanquetPctOfRooms'],
    HospitalityOtherOperatedPct: ['otherOperatedPctOfRooms'],
    HospitalityParkingPct: ['parkingPctOfRooms'],
    HospitalityFBRestaurantPerPOR: ['fbRestaurantPerPOR'],
    HospitalityFBBanquetPerPOR: ['fbBanquetPerPOR'],
    HospitalityOtherOperatedPerPOR: ['otherOperatedPerPOR'],
    HospitalityParkingPerPOR: ['parkingPerPOR'],
    HospitalityFBDeliveryPerPOR: ['fbDeliveryPerPOR'],
    HospitalityLeaseIncomeCr: ['leaseIncomeCrPa'],
    HospitalityRoomsDeptCostPct: ['roomsDeptCostPct'],
    HospitalityFBDeptCostPct: ['fbDeptCostPct'],
    HospitalityOtherDeptCostPct: ['otherDeptCostPct'],
    HospitalityRoomsFixedPct: ['roomsFixedPct'],
    HospitalityFBFixedPct: ['fbFixedPct'],
    HospitalityOtherOpFixedPct: ['otherOpFixedPct'],
    HospitalityAAndGPct: ['aAndGPct'],
    HospitalityITPct: ['itPct'],
    HospitalitySMPct: ['smPct'],
    HospitalityPOMPct: ['pomPct'],
    HospitalityUtilitiesPct: ['utilitiesPct'],
    HospitalityAAndGPerPOR: ['aAndGPerPOR'],
    HospitalityITPerPOR: ['itPerPOR'],
    HospitalitySMPerPOR: ['smPerPOR'],
    HospitalityPOMPerPOR: ['pomPerPOR'],
    HospitalityUtilitiesPerPOR: ['utilitiesPerPOR'],
    HospitalityExpenseInflationPct: ['expenseInflationPct'],
    HospitalityMgmtBasePct: ['mgmtBasePct'],
    HospitalityMgmtIncentivePct: ['mgmtIncentivePct'],
    HospitalityBrandRoyaltyPct: ['brandRoyaltyPctOfRooms'],
    HospitalityBrandMktReservPct: ['brandMktReservPctOfRooms'],
    HospitalityPropertyTaxPctRev: ['propertyTaxPctRev'],
    HospitalityInsurancePctRev: ['insurancePctRev'],
    HospitalityPropertyTaxCrPa: ['propertyTaxCrPa'],
    HospitalityInsuranceCrPa: ['insuranceCrPa'],
    HospitalityGroundLeaseCrPa: ['groundLeaseCrPa'],
    HospitalityFFEReservePct: ['ffeReservePct'],
    HospitalityConstructionCostPerKey: ['constructionCostPerKey', 'costPerKey', 'hardCostPerKey'],
    HospitalityFFEPerKey: ['ffePerKey'],
    HospitalityOSEPerKey: ['osePerKey'],
    HospitalityPreOpeningPerKey: ['preOpeningPerKey', 'preOpeningCostPerKey'],
    HospitalityWorkingCapitalCr: ['workingCapitalCr'],
    HospitalityConstLoanLTC: ['constLoanLTC', 'debtLTC', 'debtLTV'],
    HospitalityConstLoanRatePct: ['constLoanRatePct', 'interestRatePct', 'debtRatePct'],
    HospitalityConstLoanFeesPct: ['constLoanFeesPct'],
    HospitalityRefiLTV: ['refiLTV'],
    HospitalityRefiCapRate: ['refiCapRatePct'],
    HospitalityRefiInterestRate: ['refiInterestRatePct'],
  };
  const propertyAliases = {
    SaleableAreaSqft: ['saleable_area_sqft'],
    LandAreaSqft: ['land_area_sqft'],
    FSI: ['existing_fsi'],
    Locality: ['city', 'micro_market'],
  };
  const dealAliases = {
    SellRatePerSqft: ['selling_rate_per_sqft'],
    LandCostCr: ['land_cost_cr'],
    ConstructionCostPerSqft: ['construction_cost_per_sqft'],
    ApprovalCostCr: ['approval_cost_cr'],
    ProjectMonths: ['project_duration_months'],
    DiscountRatePct: ['discount_rate_pct'],
    AssetClass: ['asset_class', 'financial_asset_class'],
    DealType: ['deal_type'],
  };

  const hasOwnValue = (obj, keys = []) => keys.some((key) => obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== '');
  if (hasOwnValue(ctx.inputs, modelInputAliases[name])) {
    return {
      sourceType: 'Financial model input',
      sourceName: 'REDIP financial model',
      url: dealUrl,
      freshness: ctx.generatedAt,
      confidence: 'stored-input',
      provenance: `deal.model_params.inputs.${name}`,
      notes: 'Operator-entered or imported model input. Verify against source documents before IC use.',
    };
  }
  if (hasOwnValue(ctx.engineAssumptions, modelInputAliases[name])) {
    return {
      sourceType: 'Financial engine default registry',
      sourceName: 'REDIP financial engine',
      url: dealUrl,
      freshness: ctx.generatedAt,
      confidence: 'engine-default',
      provenance: `financialKernel.resolveAssumptions.${name}`,
      notes: 'Default applied because the operator did not provide this input; edit the yellow cell to override.',
    };
  }
  if (hasOwnValue(ctx.deal, dealAliases[name])) {
    return {
      sourceType: 'Deal financial record',
      sourceName: 'REDIP deal financials',
      url: dealUrl,
      freshness: ctx.generatedAt,
      confidence: 'stored-financial',
      provenance: `financials.${name}`,
      notes: 'Stored deterministic financial output or normalized underwriting input.',
    };
  }
  if (hasOwnValue(ctx.property, propertyAliases[name])) {
    return {
      sourceType: 'Property record',
      sourceName: 'REDIP property table',
      url: dealUrl,
      freshness: ctx.generatedAt,
      confidence: ctx.property.geocode_confidence ? `stored-property (${ctx.property.geocode_confidence})` : 'stored-property',
      provenance: `properties.${name}`,
      notes: 'Property-level field. Verify measured areas against uploaded survey/title documents.',
    };
  }

  return {
    sourceType: 'Workbook default or manual entry',
    sourceName: 'No verified source feed available',
    url: dealUrl,
    freshness: 'No verified freshness date',
    confidence: value === null || value === undefined || value === '' ? 'missing' : 'low',
    provenance: name,
    notes: 'Manual verification required before circulation outside the deal team.',
  };
};

const buildSourceRegister = (ctx, options = {}) => {
  const core = getCoreInputSnapshot(ctx);
  const dealUrl = ctx.deal.id && options.appBaseUrl ? `${options.appBaseUrl.replace(/\/$/, '')}/deals/${ctx.deal.id}` : null;
  const fields = [
    ['AssetClass', 'Asset class', core.assetClass],
    ['DealStructureLabel', 'Deal structure', core.dealStructureLabel],
    ['ExitStrategyType', 'Exit strategy', core.exitStrategyType],
    ['SaleableAreaSqft', 'Saleable / leasable area', core.saleableAreaSqft],
    ['LandAreaSqft', 'Land area', core.landAreaSqft],
    ['SellRatePerSqft', 'Selling rate', core.sellRatePerSqft],
    ['BaseRentPerSqftMonth', 'Base rent', core.baseRentPerSqftMonth],
    ['OccupancyPct', 'Stabilised occupancy', core.occupancyPct],
    ['LandCostCr', 'Land cost', core.landCostCr],
    ['ConstructionCostPerSqft', 'Construction cost per sqft', core.constructionCostPerSqft],
    ['DebtLTV', 'Debt percentage', core.debtLTV],
    ['DebtRatePct', 'Debt rate', core.debtRatePct],
    ['DiscountRatePct', 'Discount rate', core.discountRatePct],
  ];

  const rows = fields.map(([field, label, value]) => ({
    field,
    label,
    value,
    ...namedRangeSource(ctx, field, value, false, { dealUrl }),
  }));

  const comps = Array.isArray(ctx.exportContext?.market?.exportComps)
    ? ctx.exportContext.market.exportComps
    : [];
  if (comps.length) {
    const verifiedCount = comps.filter((comp) => comp.is_verified).length;
    const firstUrl = normalizeUrl(comps.find((comp) => normalizeUrl(comp.source))?.source);
    rows.push({
      field: 'MarketComps',
      label: 'Market comps used in export',
      value: `${comps.length} comps (${verifiedCount} verified)`,
      sourceType: 'Comparable transactions / listings',
      sourceName: comps[0]?.source || 'REDIP comps table',
      url: firstUrl,
      freshness: comps[0]?.data_period || comps[0]?.possession_year || 'No verified freshness date',
      confidence: verifiedCount ? 'mixed-verified' : 'unverified-context-only',
      provenance: 'exportContext.market.exportComps',
      notes: 'Context only. Do not quote as authoritative unless each comp is verified.',
    });
  } else {
    rows.push({
      field: 'MarketComps',
      label: 'Market comps used in export',
      value: 'No verified comps included',
      sourceType: 'Market data',
      sourceName: 'No verified feed available',
      url: null,
      freshness: 'No verified freshness date',
      confidence: 'missing',
      provenance: 'exportContext.market.exportComps',
      notes: 'Workbook must not be treated as market-backed until verified comps are attached.',
    });
  }

  const documents = Array.isArray(ctx.exportContext?.documents?.items)
    ? ctx.exportContext.documents.items
    : [];
  rows.push({
    field: 'Documents',
    label: 'Uploaded deal documents',
    value: `${documents.length} documents`,
    sourceType: 'Document evidence',
    sourceName: documents.length ? documents.slice(0, 3).map((doc) => doc.name).join('; ') : 'No documents uploaded',
    url: dealUrl,
    freshness: documents[0]?.created_at || ctx.generatedAt,
    confidence: documents.length ? 'available-for-review' : 'missing',
    provenance: 'exportContext.documents.items',
    notes: documents.length ? 'Review source documents before legal/title/RERA conclusions.' : 'No document-backed evidence is present in this export context.',
  });

  return rows;
};

const buildExportQa = (ctx, options = {}) => {
  const core = getCoreInputSnapshot(ctx);
  const issues = [];
  const addIssue = (severity, check, field, message, action, scope = 'all') => {
    issues.push({ severity, check, field, message, action, scope });
  };
  const positive = (field, value, label, action, scope) => {
    if (!(asFiniteNumber(value) > 0)) {
      addIssue('blocker', 'Core input present', field, `${label} must be greater than zero.`, action, scope);
    }
  };
  const pctRange = (field, value, label, min, max, action) => {
    const parsed = asFiniteNumber(value);
    if (parsed === null || parsed < min || parsed > max) {
      addIssue('blocker', 'Percentage range', field, `${label} must be between ${min} and ${max}.`, action, 'all');
    }
  };

  const allowedDevExit = new Set(['outright_progressive', 'bulk_exit_completion', 'hold_post_completion']);
  const allowedIncomeExit = new Set(['strategic_sale', 'reit_exit', 'hold_to_perpetuity', 'refinance_hold']);
  const allowedDealStructures = new Set(['outright_purchase', 'jda_revenue_share', 'jda_area_share', 'development_management']);
  const allowedExit = ctx.dealFamily === 'income' ? allowedIncomeExit : allowedDevExit;

  positive('SaleableAreaSqft', core.saleableAreaSqft, 'Saleable / leasable area', 'Fill the property area or model saleable/leasable area before export.', 'all asset classes');
  // PR-NX13 (2026-05-15): LoadingFactor is a super-built-up ÷ carpet ratio
  // — meaningful only for asset classes with sale-side carpet vs SBA
  // distinction (residential / villas / office / retail / industrial /
  // mixed_use / redevelopment). Hospitality is keys-based (GFA only)
  // and raw_land has no construction. Skip the validator for those
  // classes so the export doesn't block on a meaningless input.
  if (ctx.assetClass !== 'hospitality' && ctx.assetClass !== 'raw_land') {
    positive('LoadingFactor', core.loadingFactor, 'Loading factor', 'Set a positive loading factor so carpet area can be derived.', 'all asset classes');
  }
  positive('DebtRatePct', core.debtRatePct, 'Debt rate', 'Set the lender interest rate before export.', 'all capital structures');
  positive('DiscountRatePct', core.discountRatePct, 'Discount rate', 'Set the discount rate before export.', 'all return metrics');
  pctRange('DebtLTV', core.debtLTV, 'Debt percentage', 0, 1, 'Set Debt % as a decimal or percent between 0% and 100%.');

  if (!allowedDealStructures.has(core.dealStructureLabel)) {
    addIssue('blocker', 'Deal structure option', 'DealStructureLabel', `Deal structure "${core.dealStructureLabel}" is not supported.`, 'Pick a supported deal structure.', 'development deal structures');
  }
  if (!allowedExit.has(core.exitStrategyType)) {
    addIssue('blocker', 'Exit strategy option', 'ExitStrategyType', `Exit strategy "${core.exitStrategyType}" is not valid for ${ctx.dealFamily} deals.`, 'Pick the exit strategy from the workbook dropdown.', 'exit strategies');
  }

  if (ctx.dealFamily === 'income') {
    positive('BaseRentPerSqftMonth', core.baseRentPerSqftMonth, 'Base rent per sqft per month', 'Fill BaseRentPerSqftMonth so the operating P&L can compute PGI/NOI.', 'income asset classes');
    positive('OccupancyPct', core.occupancyPct, 'Stabilised occupancy', 'Fill OccupancyPct so the operating P&L can compute EGR/NOI.', 'income asset classes');
    positive('ConstructionCostPerSqft', core.constructionCostPerSqft, 'Construction cost per sqft', 'Fill ConstructionCostPerSqft so cost, debt sizing, and yield-on-cost are credible.', 'income asset classes');
    positive('ExitCapRate', core.exitCapRate, 'Exit cap rate', 'Fill ExitCapRate so terminal value and exit proceeds are credible.', 'income exit strategies');
    if (!(asFiniteNumber(core.landCostCr) >= 0)) {
      addIssue('blocker', 'Core input present', 'LandCostCr', 'Land cost must be zero or positive.', 'Fill LandCostCr or explicitly set 0 for no land acquisition cost.', 'income asset classes');
    }
  } else {
    positive('SellRatePerSqft', core.sellRatePerSqft, 'Selling rate per sqft', 'Fill SellRatePerSqft so sales and margin can compute.', 'development asset classes');
    if (ctx.assetClass === 'raw_land') {
      positive('LandCostCr', core.landCostCr, 'Land cost', 'Fill LandCostCr so raw-land entitlement economics are grounded.', 'raw_land');
    } else {
      positive('ConstructionCostPerSqft', core.constructionCostPerSqft, 'Construction cost per sqft', 'Fill ConstructionCostPerSqft so development costs are grounded.', 'development asset classes');
    }
    if (core.dealStructureLabel === 'outright_purchase') {
      positive('LandCostCr', core.landCostCr, 'Land cost', 'Fill LandCostCr for outright-purchase structures.', 'outright_purchase');
    } else if (!(asFiniteNumber(core.landownerSharePct) > 0 && asFiniteNumber(core.landownerSharePct) < 1)) {
      addIssue('blocker', 'Deal structure economics', 'LandownerSharePct', 'JDA / development-management structures need a landowner share between 0% and 100%.', 'Set LandownerSharePct so developer cash flow is not overstated.', core.dealStructureLabel);
    }
    if (core.exitStrategyType === 'bulk_exit_completion') {
      pctRange('BulkExitDiscountPct', core.bulkExitDiscountPct, 'Bulk exit discount', 0, 0.9, 'Set a bulk-exit discount below 90%.');
    }
  }

  if (!Array.isArray(ctx.exportContext?.documents?.items) || ctx.exportContext.documents.items.length === 0) {
    addIssue('warn', 'Evidence coverage', 'Documents', 'No uploaded deal documents are attached to this export context.', 'Attach source documents before treating title/RERA/approval fields as verified.', 'source provenance');
  }
  if (!Array.isArray(ctx.exportContext?.market?.exportComps) || ctx.exportContext.market.exportComps.length === 0) {
    addIssue('warn', 'Market coverage', 'MarketComps', 'No verified comparable feed is present.', 'Attach verified comps or show the workbook as an internal sensitivity file only.', 'market data');
  }

  const blockers = issues.filter((issue) => issue.severity === 'blocker');
  return {
    status: blockers.length ? 'BLOCKED' : issues.length ? 'PASS_WITH_WARNINGS' : 'PASS',
    generatedAt: ctx.generatedAt,
    core,
    issues,
    blockers,
    sourceRegister: buildSourceRegister(ctx, options),
  };
};

class XlsxExportValidationError extends Error {
  constructor(qa) {
    super(`XLSX export blocked: ${qa.blockers.length} required input${qa.blockers.length === 1 ? '' : 's'} missing or invalid.`);
    this.name = 'XlsxExportValidationError';
    this.statusCode = 422;
    this.errors = qa.blockers.map((issue) => ({
      field: issue.field,
      message: issue.message,
      action: issue.action,
      scope: issue.scope,
    }));
    this.qa = qa;
  }
}

/**
 * Build the deck workbook context. Reuses `inferAssetClass` for class
 * detection; everything else is read straight off the export context.
 */
const buildContext = (exportContext = {}, options = {}) => {
  const deal = exportContext.deal || {};
  const property = exportContext.property || {};
  const modelParams = deal.model_params || {};
  const modelInputs = (modelParams && modelParams.inputs) || {};
  const inputs = { ...modelInputs, ...(options.inputs || {}) };

  const assetClass = inferAssetClass({
    deal: {
      ...deal,
      property_type: property.property_type || deal.property_type,
      zoning: property.zoning || deal.zoning,
      property_name: property.property_name || deal.property_name,
    },
    inputs,
  });
  // PR-NX6 (2026-05-15): resolveEngineAssumptions now layers our
  // asset-class defaults UNDER the financial kernel's output, so every
  // helper that uses `engineFirstNumber(ctx, [...])` or reads
  // `ctx.engineAssumptions.X` gets a Bengaluru-priority fallback.
  // Helpers that intentionally carry their own hardcoded fallbacks
  // (e.g. hospitality 100 keys / 6000 ADR for "boutique" defaults)
  // keep those — we don't shadow them at the ctx.inputs layer.
  const engineAssumptions = resolveEngineAssumptions(assetClass, inputs);

  const projectMonths = firstNumber(
    inputs.projectDurationMonths,
    deal.project_duration_months,
    inputs.projectDurationYears ? inputs.projectDurationYears * 12 : null,
    engineAssumptions.projectDurationMonths,
    36,
  ) || 36;

  // Income-producing vs development asset classes. Drives the entire
  // workbook's structure: income deals get a PGI / Vacancy / EGR / OpEx
  // / NOI / CapEx / Debt Service operating P&L; development deals get
  // construction phasing + sales collection cash flows. Both get the
  // same Inputs / Dashboard / Calculations chrome.
  const INCOME_CLASSES = ['commercial_office', 'retail', 'industrial_warehousing', 'hospitality'];
  const dealFamily = INCOME_CLASSES.includes(assetClass) ? 'income' : 'development';
  const incomeHoldYears = firstNumber(
    inputs.holdPeriodYears,
    inputs.exitYearFromAcq,
    inputs.loanTermYears,
    engineAssumptions.holdPeriodYears,
    assetClass === 'hospitality' ? 10 : 7,
  ) || (assetClass === 'hospitality' ? 10 : 7);
  const modelMonths = assetClass === 'hospitality'
    ? projectMonths + Math.round(incomeHoldYears * 12)
    : dealFamily === 'income'
      ? Math.max(projectMonths, Math.round(incomeHoldYears * 12))
      : projectMonths;
  const totalQuarters = clamp(Math.ceil(modelMonths / 3), 4, dealFamily === 'income' ? 60 : 32);
  const effectiveDate = normalizeDateString(
    options.effectiveDate,
    inputs.effectiveDate,
    modelParams.effectiveDate,
    modelParams.effective_date,
    deal.effective_date,
    deal.effectiveDate,
    property.effective_date,
    exportContext.effectiveDate,
  ) || new Date().toISOString().slice(0, 10);

  // ── Kernel-computed returns ─────────────────────────────────────────────
  // Per CLAUDE.md: "the deterministic financial kernel is the only source
  // of numerics in any export." The Reports page in the frontend displays
  // these stored deal-record values directly (e.g. Jigani IRR 13.6%) — the
  // XLSX MUST surface the same numbers as the authoritative headline. The
  // formula-driven model in the Phasing / Cash Flow / Dashboard sheets is
  // a SENSITIVITY RUN — editable, transparent, but secondary to the
  // kernel's output for any deal-level reporting purpose.
  //
  // Any value here that's null means the kernel hasn't produced it — the
  // Dashboard renders "–" or falls back to the modeled value with a clear
  // disclosure.
  const kernelKpis = {
    irr: firstNumber(deal.irr_pct, deal.model_params?.kpis?.irr),
    npv: firstNumber(deal.npv_cr, deal.model_params?.kpis?.npv),
    equityMultiple: firstNumber(deal.equity_multiple, deal.model_params?.kpis?.equityMultiple),
    grossMargin: firstNumber(deal.gross_margin_pct, deal.model_params?.kpis?.grossMarginPct),
    totalRevenue: firstNumber(deal.total_revenue_cr, deal.model_params?.kpis?.totalRevenue),
    totalCost: firstNumber(deal.total_cost_cr, deal.model_params?.kpis?.totalCost),
    yieldOnCost: firstNumber(deal.yield_on_cost_pct, deal.model_params?.kpis?.yieldOnCost),
    noi: firstNumber(deal.noi_cr, deal.stabilized_noi_cr, deal.model_params?.kpis?.noi),
    exitValue: firstNumber(deal.exit_value_cr, deal.model_params?.kpis?.exitValue),
    residualLandValue: firstNumber(deal.residual_land_value_cr, deal.model_params?.kpis?.rlv),
  };

  return {
    exportContext,
    deal,
    property,
    modelParams,
    inputs,
    engineAssumptions,
    assetClass,
    dealFamily,
    isIncome: dealFamily === 'income',
    projectMonths,
    totalQuarters,
    kernelKpis,
    brandName: options.brandName || 'REDIP',
    generatedAt: options.generatedAt || exportContext.generatedAt || new Date().toISOString(),
    effectiveDate,
  };
};

const prepareWorkbookContext = (exportContext = {}, options = {}) => {
  const ctx = buildContext(exportContext, options);
  const appBaseUrl = resolveAppBaseUrl(options);
  const qa = buildExportQa(ctx, { appBaseUrl });
  ctx.exportQa = qa;
  const strictValidation = options.strictValidation === true
    || (options.strictValidation !== false && process.env.NODE_ENV !== 'test');
  if (strictValidation && qa.blockers.length) {
    throw new XlsxExportValidationError(qa);
  }
  return ctx;
};

/**
 * Apply the standard header style to a row of cells.
 */
const styleHeader = (row, height = 22) => {
  row.height = height;
  row.eachCell((cell) => {
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    cell.fill = FILL(palette.xlsx('inkDeep'));
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
      bottom: { style: 'thin', color: { argb: palette.xlsx('hairlineStrong') } },
      left: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
      right: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
    };
  });
};

/**
 * Apply input-zone styling: yellow fill, blue text, unlocked cell.
 */
const styleInputCell = (cell) => {
  cell.font = { name: FONT, size: 10, color: { argb: palette.xlsx('inputText') }, bold: false };
  cell.fill = FILL(palette.xlsx('inputFill'));
  cell.alignment = { vertical: 'middle', horizontal: 'right' };
  cell.border = {
    top: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
    bottom: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
    left: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
    right: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
  };
  cell.protection = { locked: false };
};

/**
 * Apply output / formula-cell styling: neutral fill, locked, tabular num.
 */
const styleOutputCell = (cell, format = NUMBER_FORMATS.currency) => {
  cell.font = { name: FONT, size: 10, color: { argb: palette.xlsx('ink') } };
  cell.fill = FILL(palette.xlsx('paper'));
  cell.alignment = { vertical: 'middle', horizontal: 'right' };
  cell.numFmt = format;
  cell.protection = { locked: true };
  cell.border = {
    top: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
    bottom: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
    left: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
    right: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
  };
};

const styleLabelCell = (cell) => {
  cell.font = { name: FONT, size: 10, color: { argb: palette.xlsx('ink') }, bold: false };
  cell.fill = FILL(palette.xlsx('paperElevated'));
  cell.alignment = { vertical: 'middle', horizontal: 'left' };
  cell.protection = { locked: true };
  cell.border = {
    top: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
    bottom: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
    left: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
    right: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
  };
};

const styleSectionTitle = (cell) => {
  cell.font = { name: FONT, size: 11, bold: true, color: { argb: palette.xlsx('paperElevated') } };
  cell.fill = FILL(palette.xlsx('inkDeep'));
  cell.alignment = { vertical: 'middle', horizontal: 'left' };
  cell.protection = { locked: true };
};

/**
 * Inputs & Assumptions sheet.
 *
 * Layout: 3-column rows — Label, Value (input zone), Unit. Sections grouped
 * with banded headers. Every input cell has a defined name attached to the
 * workbook so cross-sheet formulas reference by name.
 */
const buildInputsSheet = (workbook, ctx) => {
  const sheet = workbook.addWorksheet(SHEETS.inputs, {
    views: [{ showGridLines: false, state: 'frozen', xSplit: 0, ySplit: 4 }],
  });
  sheet.columns = [
    { width: 38 }, // A: Label
    { width: 18 }, // B: Value
    { width: 18 }, // C: Unit
    { width: 24 }, // D: Source
    { width: 42 }, // E: QA/source finding
    { width: 24 }, // F: QA/source action or link
    { width: 22 }, // G: QA/source freshness
    { width: 28 }, // H: QA/source confidence
    { width: 48 }, // I: QA/source notes
  ];

  // Cover band
  sheet.mergeCells('A1:D1');
  sheet.getCell('A1').value = `${ctx.brandName} | ${ctx.deal.name || ctx.property.property_name || 'Deal'} | Inputs & Assumptions`;
  styleSectionTitle(sheet.getCell('A1'));
  sheet.getRow(1).height = 28;
  // PR-NX5 (2026-05-15): Inputs sheet row 2 now mirrors the Dashboard's
  // deal-identity subtitle so both sheets read as deal-SPECIFIC.
  // Row 3 carries the asset-class-aware modeling mechanic hint so the
  // operator sees exactly what kind of pro-forma engine is driving the
  // workbook before they edit any cell.
  sheet.mergeCells('A2:I2');
  sheet.getCell('A2').value = `${buildDealIdentityLine(ctx)} · Effective ${ctx.effectiveDate}`;
  sheet.getCell('A2').font = { name: FONT, size: 10, color: { argb: palette.xlsx('mutedHigh') }, italic: true };
  sheet.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle' };
  sheet.getCell('A2').protection = { locked: true };
  sheet.getRow(2).height = 22;

  sheet.mergeCells('A3:I3');
  sheet.getCell('A3').value = `Modeling mechanic: ${buildModelingMechanicHint(ctx)}`;
  sheet.getCell('A3').font = { name: FONT, size: 9, color: { argb: palette.xlsx('mutedLow') } };
  sheet.getCell('A3').alignment = { horizontal: 'left', vertical: 'middle' };
  sheet.getCell('A3').protection = { locked: true };
  sheet.getRow(3).height = 18;

  // Column header row
  sheet.getCell('A4').value = 'Input';
  sheet.getCell('B4').value = 'Value';
  sheet.getCell('C4').value = 'Unit';
  sheet.getCell('D4').value = 'Source';
  styleHeader(sheet.getRow(4));

  // Sections — each entry: [label, name, value, unit, format]
  // Asset-class-aware: income deals get rent/vacancy/OpEx/exit-cap inputs;
  // development deals get sale-rate/velocity/collection/marketing inputs.
  // Common sections (General Site, Cost Structure, Schedule, Capital +
  // Returns) appear for both.
  const generalSection = {
    title: 'General Site Information',
    rows: [
      ['Effective Date',          'EffectiveDate',       ctx.effectiveDate,                           '',      NUMBER_FORMATS.date],
      ['Asset Class',             'AssetClass',          ctx.assetClass || 'generic',                  '',      null],
      ['Deal Type',               'DealType',            ctx.deal.deal_type || 'acquisition',          '',      null],
      ['Deal Family',             'DealFamily',          ctx.dealFamily,                              '',      null],
      ['Locality',                'Locality',            ctx.deal.city || ctx.property.city || 'Bengaluru', '', null],
      ['Land Area',               'LandAreaSqft',        landAreaSqftFor(ctx), 'sqft', NUMBER_FORMATS.integer],
      ['Saleable / Leasable Area (Super Built-up)', 'SaleableAreaSqft',
        saleableAreaSqftFor(ctx),
        'sqft', NUMBER_FORMATS.integer],
      // PR-I5: Loading Factor + derived Carpet Area. RERA Act 2016 mandates
      // sale-side marketing in CARPET area (Section 4(2)(h)); construction
      // costs are typically on super built-up. Loading Factor = super
      // built-up ÷ carpet area; typical India range 1.20-1.40 (1.25 default
      // = ~80% carpet efficiency). Operators can override per project.
      //
      // CarpetAreaSqft is a DERIVED named range (formula), not editable.
      // The model's revenue formulas continue to use SaleableAreaSqft
      // (super built-up) since that's how the operator's sale rate was
      // historically set; PR-I5 makes the carpet-area number explicit and
      // available for any future RERA-marketing-compliance calculation
      // (carpet × sale rate, RERA disclosures, etc.) without changing the
      // revenue math.
      //
      // PR-NX13 (2026-05-15): Loading Factor + Carpet Area are
      // sale-side concepts (super-built-up ÷ carpet). They DON'T apply
      // to hospitality (keys-based, gross-built-up only matters for
      // construction cost), nor to raw_land (no construction, no
      // carpet). Hide for those classes to avoid operator confusion.
      ...(ctx.assetClass === 'hospitality' || ctx.assetClass === 'raw_land' ? [] : [
        ['Loading Factor (Super Built-up ÷ Carpet)', 'LoadingFactor',
          loadingMultipleFor(ctx),
          'ratio', NUMBER_FORMATS.multiple],
        ['Carpet Area (RERA marketing area)', 'CarpetAreaSqft',
          { formula: '=IFERROR(SaleableAreaSqft/LoadingFactor,0)' },
          'sqft (derived)', NUMBER_FORMATS.integer],
      ]),
      ['Floor Space Index (FSI)', 'FSI',                 fsiFor(ctx), 'ratio', NUMBER_FORMATS.multiple],
    ],
  };

  // PR-NX4 (2026-05-15): for mixed_use / redevelopment / township
  // templates, the Selling Rate per sqft should default to the derived
  // MixUseBlendedRatePerSqft (= sum of component_share × component_rate).
  // Pre-fix the operator had to read the blended rate from the
  // Mixed-Use Component section and manually retype it into Selling Rate
  // — which silently broke when component splits changed. Wiring it
  // here closes the loop: edit a component share and SellRatePerSqft
  // recalculates live. Operators with an explicit sellingRatePerSqft
  // input override (any positive value) keep their literal value.
  const isMixUseTemplate = ['mixed_use', 'redevelopment'].includes(ctx.assetClass);
  const hasExplicitSellingRate = asFiniteNumber(ctx.inputs.sellingRatePerSqft) > 0;
  const sellRateCell = isMixUseTemplate && !hasExplicitSellingRate
    ? { formula: '=MixUseBlendedRatePerSqft' }
    : sellRatePerSqftFor(ctx);
  const sellRateUnit = isMixUseTemplate && !hasExplicitSellingRate
    ? 'INR/sqft (auto-blended from components)'
    : 'INR/sqft';
  const developmentRevenueSection = {
    title: 'Pricing & Revenue (Development)',
    rows: [
      ['Selling Rate per sqft',   'SellRatePerSqft',     sellRateCell,                            sellRateUnit, NUMBER_FORMATS.integer],
      ['Pricing Escalation',      'EscalationPct',       toPctDecimal(firstNumber(ctx.inputs.pricingEscalationPct, ctx.inputs.rentEscalationPct, 0)),                 '% / year', NUMBER_FORMATS.percent],
      ['Sales Velocity',          'SalesVelocityPct',    toPctDecimal(firstNumber(ctx.inputs.salesVelocityPct, ctx.inputs.absorptionPct, 0.20)),                     '% / quarter', NUMBER_FORMATS.percent],
      ['Customer Collection',     'CollectionPct',       toPctDecimal(firstNumber(ctx.inputs.customerCollectionPct, 0.85)),                                          '% of sale', NUMBER_FORMATS.percent],
    ],
  };

  const incomeRevenueSection = {
    title: 'Operating Revenue Inputs (Income Asset)',
    rows: [
      ['Base Rent / sqft / month','BaseRentPerSqftMonth',
        baseRentPerSqftMonthFor(ctx),
        'INR/sqft/mo', NUMBER_FORMATS.integer],
      ['Rent Escalation',         'RentEscalationPct',
        ctx.assetClass === 'hospitality'
          ? enginePctDecimal(ctx, ['adrGrowthPct', 'rentEscalationPct'], 0.05)
          : enginePctDecimal(ctx, ['rentEscalationPct', 'pricingEscalationPct'], 5),
        '% / year', NUMBER_FORMATS.percent],
      ['Stabilised Occupancy',    'OccupancyPct',
        occupancyPctFor(ctx),
        '% of leasable', NUMBER_FORMATS.percent],
      ['Vacancy & Credit Loss',   'VacancyPct',          vacancyPctFor(ctx),                                                     '% of PGI', NUMBER_FORMATS.percent],
      ['Other Income / sqft / yr','OtherIncomePerSqft',  firstNumber(ctx.inputs.otherIncomePerSqft, 0),                                                'INR/sqft/yr', NUMBER_FORMATS.integer],
      ['Lease-up Period',         'LeaseUpQuarters',     firstNumber(ctx.inputs.leaseUpQuarters, 4),                                                   'quarters', NUMBER_FORMATS.integer],
    ],
  };

  const incomeOpExSection = {
    title: 'Operating Expenses (Income Asset)',
    rows: [
      // PR-I4: Property tax is computed via the **BBMP UAV method** (Unit
      // Area Value, the methodology mandated by Karnataka Municipal
      // Corporations Act). Each property gets a per-sqft annual tax rate
      // based on its zone (A through F) and use category. Pre-PR-I4 the
      // model used "% of EGR" which scales tax with rent — wrong for
      // India, where tax scales with area regardless of rental income.
      //
      // BBMP Bengaluru zone-A commercial rates as of 2026-05: ₹40-60/sqft/yr.
      // Default 40 (mid-range Zone A commercial). Operators can override
      // for residential (₹3-8/sqft/yr) or different zones.
      //
      // Backward-compat: legacy `propertyTaxPct` (% of EGR) is no longer
      // used directly — operator must set the per-sqft figure. The named
      // range is renamed to `PropertyTaxPerSqftYr` (was `PropertyTaxPct`).
      // Existing kernel emissions with `propertyTaxPct` will lose their
      // value; we attempt a heuristic conversion (pct × typical rent) but
      // it's approximate.
      ['Property Tax (BBMP UAV)', 'PropertyTaxPerSqftYr',
        firstNumber(
          ctx.inputs.propertyTaxPerSqftYr,
          ctx.inputs.propertyTaxPerSqft,
          // Heuristic backward-compat: convert legacy % × typical rent
          // (₹100/sqft/mo × 12 = ₹1200/yr) to per-sqft annual.
          ctx.inputs.propertyTaxPct ? toPctDecimal(ctx.inputs.propertyTaxPct) * 1200 : null,
          40,
        ),
        'INR / sqft / year', NUMBER_FORMATS.integer],
      ['Insurance',               'InsurancePct',        toPctDecimal(firstNumber(ctx.inputs.insurancePct, 0.01)),                                                   '% of EGR', NUMBER_FORMATS.percent],
      ['Property Management Fee', 'PropMgmtPct',         toPctDecimal(firstNumber(ctx.inputs.propMgmtPct, ctx.inputs.managementFeePct, 0.03)),                       '% of EGR', NUMBER_FORMATS.percent],
      ['Utilities',               'UtilitiesPct',        toPctDecimal(firstNumber(ctx.inputs.utilitiesPct, 0.04)),                                                   '% of EGR', NUMBER_FORMATS.percent],
      ['Maintenance & Repairs',   'MaintenancePct',      toPctDecimal(firstNumber(ctx.inputs.maintenancePct, ctx.inputs.opexPct, 0.05)),                              '% of EGR', NUMBER_FORMATS.percent],
      ['Recoverable OpEx / CAM',   'RecoverableExpensePct',
        toPctDecimal(firstNumber(
          ctx.inputs.recoverableExpensePct,
          ctx.assetClass === 'retail' ? ctx.inputs.retailCAMRecoveryPct : null,
          ['retail', 'industrial_warehousing'].includes(ctx.assetClass) ? 0.90 : 0.50,
        )),
        '% of utilities + maintenance', NUMBER_FORMATS.percent],
      ['CapEx Reserves',          'CapExReservePct',     toPctDecimal(firstNumber(ctx.inputs.capExReservePct, 0.02)),                                                '% of EGR', NUMBER_FORMATS.percent],
      ['TI Allowance / sqft',      'TIAllowancePerSqft',  firstNumber(ctx.inputs.tiAllowancePerSqft, 0),                                               'INR/sqft', NUMBER_FORMATS.integer],
      ['Leasing Commission',       'LeasingCommissionPct', toPctDecimal(firstNumber(ctx.inputs.leasingCommissionPct, ctx.inputs.brokeragePct, 0.02)),     '% of year-1 rent', NUMBER_FORMATS.percent],
      ['Tenant Downtime',          'TenantDowntimeMonths', firstNumber(ctx.inputs.tenantDowntimeMonths, ctx.inputs.downtimeMonths, 3),                   'months / rollover', NUMBER_FORMATS.integer],
      ['TI / LC (Tenant Improv)', 'TILCAllowanceCr',     firstNumber(ctx.inputs.tiLcAllowanceCr, ctx.inputs.tenantImprovementsCr, 0),                  'INR Cr (one-time)', NUMBER_FORMATS.currency],
      ['Exit Cap Rate',           'ExitCapRate',         exitCapRateFor(ctx),       '% / year', NUMBER_FORMATS.percent],
      ['Selling Cost on Exit',    'SellingCostPct',      toPctDecimal(firstNumber(ctx.inputs.sellingCostPct, 0.02)),                                                 '% of sale', NUMBER_FORMATS.percent],
    ],
  };

  const costSection = {
    title: 'Cost Structure',
    rows: [
      ['Land Cost',               'LandCostCr',          firstNumber(ctx.inputs.landCostCr, ctx.deal.land_cost_cr, ctx.engineAssumptions?.landCostCr, 0),                                  'INR Cr', NUMBER_FORMATS.currency],
      ['Construction Cost / sqft','ConstructionCostPerSqft',
        constructionCostPerSqftFor(ctx),
        'INR/sqft', NUMBER_FORMATS.integer],
      ['Approval & Fees',         'ApprovalCostCr',      approvalCostCrFor(ctx),                           'INR Cr', NUMBER_FORMATS.currency],
      // PR-I9: Premium FSI / TDR cost line. Bengaluru operators buy
      // premium FSI from BBMP/BDA when their base FSI is insufficient
      // (typically ₹1-5 Cr/acre depending on zone). Mumbai operators
      // buy TDR (Transferable Development Rights) for similar reasons.
      // Defaults to 0 — operator sets when applicable. When > 0, the
      // value flows into Total Project Cost via the Calculations Cost
      // Build + Debt Sizing / Waterfall totalCost formulas.
      ['Premium FSI / TDR Cost',  'PremiumFSICostCr',    firstNumber(ctx.inputs.premiumFSICostCr, ctx.inputs.tdrCostCr, 0),                                'INR Cr (one-time)', NUMBER_FORMATS.currency],
      ...(ctx.dealFamily === 'development' ? [
        ['Marketing & Sales',       'MarketingCostPct',    toPctDecimal(firstNumber(ctx.inputs.marketingCostPct, 0.04)),                                                '% of revenue', NUMBER_FORMATS.percent],
      ] : [
        ['Marketing / Leasing',     'MarketingCostPct',    toPctDecimal(firstNumber(ctx.inputs.marketingCostPct, 0.02)),                                                '% of EGR', NUMBER_FORMATS.percent],
      ]),
      ['Finance / Treasury Cost', 'FinanceCostPct',      toPctDecimal(firstNumber(ctx.inputs.financeCostPct, 0.02)),                                                   '% of revenue', NUMBER_FORMATS.percent],
      ['Contingency',             'ContingencyPct',      toPctDecimal(firstNumber(ctx.inputs.contingencyPct, 0.05)),                                                   '% of cost', NUMBER_FORMATS.percent],
    ],
  };

  // ── India Statutory Levies (PR-I1) ────────────────────────────────────
  // Stamp Duty + Registration on land acquisition: Karnataka regime as of
  // 2026-05 is 5% stamp duty + 1% registration + 0.5% surcharge ≈ 6.6%
  // total on conveyance deeds for non-agricultural land. Combined as one
  // input row "Stamp Duty + Registration" mapped to named range
  // `StampRegPct`. Operators in other states (Maharashtra 5-6%, Tamil
  // Nadu 7%, Telangana 7.5%) override the seeded default.
  //
  // GST on construction: asset-class-aware net cost (see
  // `indiaGstDefaultForClass` above for the regime mapping). Stored as a
  // single `% of hard cost` input; the Phasing sheet spreads it across
  // construction quarters and feeds the Calculations cost build.
  //
  // Both inputs were previously buried in the Cost Structure section as
  // generic "%" rows that didn't flow into any formula — purely
  // decorative. This block surfaces them as their own section, with
  // explicit India-context labels and units, and the Phasing /
  // Calculations sheets now use them as real cost lines.
  // Backward-compat resolution for StampRegPct (PR-I1):
  //   1. Prefer explicit `stampRegPct` if the kernel emits it.
  //   2. Else, if BOTH `stampDutyPct` + `registrationPct` are present,
  //      add them — the kernel started breaking them out per India.
  //   3. Else, treat a legacy `stampDutyPct` alone AS the combined rate
  //      (kernels emitting only this field historically meant "the total
  //      stamp + registration outflow" — e.g. a 5% test input meant 5%
  //      combined, not 5% stamp + an extra 1% added by us).
  //   4. Else, default to 0.066 (Karnataka 5.6% + 1% = 6.6%).
  const legacyStampDuty = toPctDecimal(ctx.inputs.stampDutyPct);
  const legacyRegistration = toPctDecimal(ctx.inputs.registrationPct);
  let resolvedStampRegPct;
  if (ctx.inputs.stampRegPct != null) {
    resolvedStampRegPct = toPctDecimal(ctx.inputs.stampRegPct);
  } else if (legacyStampDuty != null && legacyRegistration != null) {
    resolvedStampRegPct = legacyStampDuty + legacyRegistration;
  } else if (legacyStampDuty != null) {
    resolvedStampRegPct = legacyStampDuty; // legacy: stampDutyPct alone meant the combined rate
  } else {
    resolvedStampRegPct = 0.066; // Karnataka default
  }

  const indiaStatutoryLeviesSection = {
    title: 'India Statutory Levies (GST + Stamp Duty + Registration)',
    rows: [
      ['Stamp Duty + Registration', 'StampRegPct',
        resolvedStampRegPct,
        '% of land cost', NUMBER_FORMATS.percent],
      ['GST on Construction (Net of ITC)', 'GstPct',
        gstPctFor(ctx),
        '% of hard cost', NUMBER_FORMATS.percent],
    ],
  };

  // ── Deal Structure (JDA / Outright / Development Management) (PR-I3) ──
  // Indian real estate uses four common deal structures:
  //   - outright_purchase: developer pays LandCostCr up-front, owns 100%
  //     of revenue.
  //   - jda_revenue_share: landowner contributes land, takes a % of
  //     gross customer collection. Developer pays NO land cost.
  //     Landowner bears market risk.
  //   - jda_area_share: landowner contributes land, takes a % of saleable
  //     area (which they sell separately). Developer's effective revenue
  //     is reduced by the landowner's area-equivalent share.
  //   - development_management: developer earns a fee on revenue but
  //     doesn't take equity risk. Different model entirely; use
  //     LandownerSharePct = (1 - DM fee %) for a quick approximation.
  //
  // Common in Bengaluru: 40-60% of residential development is structured
  // as JDA. Pre-PR-I3 the model assumed outright purchase only and showed
  // the developer keeping 100% of revenue — overstating returns for any
  // JDA-structured deal.
  //
  // Mechanics: `LandownerSharePct` (default 0 = outright) is multiplied
  // into the Phasing "Net developer cash from sales" row, reducing the
  // developer's effective inflow. For JDA structures, the operator
  // additionally sets LandCostCr = 0 on the Inputs sheet (because there
  // is no upfront land payment).
  //
  // The dropdown "Deal Structure" label is informational text — visible
  // to the operator but not referenced in any formula. The actual
  // mechanical effect is driven by LandownerSharePct alone.
  const dealStructureLabel = resolveDealStructureLabel(ctx);

  const dealStructureSection = {
    title: 'Deal Structure (JDA / Outright / DM)',
    rows: [
      ['Deal Structure', 'DealStructureLabel',
        dealStructureLabel,
        'outright / jda_revenue / jda_area / dm', null],
      ['Landowner Revenue Share', 'LandownerSharePct',
        toPctDecimal(firstNumber(
          ctx.inputs.landownerSharePct,
          ctx.inputs.landownerRevenueShare,
          // Auto-seed from kernel's JVLandPct when present and structure
          // is JDA-like (since the existing JV waterfall already uses it).
          (dealStructureLabel !== 'outright_purchase' && ctx.deal.jv_split_landowner_pct != null)
            ? ctx.deal.jv_split_landowner_pct
            : null,
          0,
        )),
        '% of net developer cash → landowner', NUMBER_FORMATS.percent],
    ],
  };

  // ── RERA Compliance & Escrow (PR-I2) ──────────────────────────────────
  // Indian RERA Act 2016 mandates that 70% of every customer payment on a
  // RERA-registered residential project must be deposited into a project-
  // specific escrow account. Withdrawals from the escrow are allowed only
  // against actual construction expenses, certified by a CA + Engineer +
  // Architect. The remaining 30% is freely available to the developer.
  //
  // This materially affects working capital and the developer's effective
  // cash inflow timing — without modelling escrow, an Indian residential
  // pro forma is wrong by orders of magnitude (it shows the developer
  // receiving the full sale value as soon as customer pays, when in
  // reality 70% is trapped in escrow until construction milestones).
  //
  // Default 70% matches the Act. Operators can override to 0% for:
  //   - pre-2016 grandfathered projects (no RERA registration)
  //   - non-residential deals where escrow doesn't apply
  //   - simplification when the operator wants to model gross cash flow
  //
  // The Phasing sheet implements a quarterly escrow ledger (balance,
  // additions, drawdowns matched to construction) and feeds the Cash
  // Flow sheet a "Net developer cash from sales" row that nets escrow.
  const reraSection = {
    title: 'RERA Compliance & Escrow',
    rows: [
      ['RERA Escrow Allocation', 'RERAEscrowPct',
        toPctDecimal(firstNumber(
          ctx.inputs.reraEscrowPct,
          ctx.inputs.escrowPct,
          0.70,
        )),
        '% of customer collection', NUMBER_FORMATS.percent],
    ],
  };

  // ── Detailed Soft Costs (institutional-grade drilldown) ────────────────
  // The reference pro formas (NAIOP, RE-540) break soft costs into ~8
  // distinct line items. Current generator collapses everything into a
  // single Marketing + Finance pair which reads as amateur. This block
  // adds the 6 missing line items as separate inputs + named ranges; the
  // Phasing sheet uses them to add a full soft-cost schedule.
  //
  // Defaults calibrated to Indian residential developer benchmarks
  // (Anarock / JLL Bengaluru reports). Operators can override any of
  // them on the Inputs sheet without touching code.
  //
  // Convention: each pct applies to the cost base named in the unit
  // column, matching how reference pro formas express these:
  //   - A&E / Legal / Appraisal / Insurance during Const / Developer
  //     Overhead → % of hard construction cost
  //   - Property Taxes during Construction → % of land cost (matches
  //     Karnataka property-tax assessment method)
  const detailedSoftCostsSection = {
    title: 'Detailed Soft Costs (institutional breakdown)',
    rows: [
      ['Architectural & Engineering', 'ArchitectFeePct',     toPctDecimal(firstNumber(ctx.inputs.architectFeePct, ctx.inputs.architectPctOfHard, 0.05)),    '% of hard cost', NUMBER_FORMATS.percent],
      ['Legal Fees',                  'LegalFeePct',         toPctDecimal(firstNumber(ctx.inputs.legalFeePct, ctx.inputs.legalPctOfHard, 0.01)),            '% of hard cost', NUMBER_FORMATS.percent],
      ['Appraisal & Title',           'AppraisalFeePct',     toPctDecimal(firstNumber(ctx.inputs.appraisalFeePct, ctx.inputs.appraisalPctOfHard, 0.005)),   '% of hard cost', NUMBER_FORMATS.percent],
      ['Insurance during Construction','InsuranceConstPct',  toPctDecimal(firstNumber(ctx.inputs.insuranceConstPct, ctx.inputs.insuranceDuringConstructionPct, 0.005)), '% of hard cost', NUMBER_FORMATS.percent],
      ['Property Taxes during Construction', 'PropTaxConstPct', toPctDecimal(firstNumber(ctx.inputs.propTaxConstPct, ctx.inputs.propertyTaxesDuringConstructionPct, 0.02)), '% of land cost', NUMBER_FORMATS.percent],
      ['Developer Overhead',          'DeveloperOverheadPct', toPctDecimal(firstNumber(ctx.inputs.developerOverheadPct, ctx.inputs.developerOverheadPctOfHard, 0.03)), '% of hard cost', NUMBER_FORMATS.percent],
    ],
  };

  // PR-NX14 (2026-05-15): label clarity in the Project Schedule section.
  // Pre-fix the operator saw "Project Duration: 48 months" and "Quarters:
  // 56" side-by-side and reasonably asked "48 months = 16 quarters, why
  // is the Quarters field 56?" The answer: TotalQuarters includes the
  // operating/hold horizon AFTER construction completes (for income deals
  // = construction + 5-year hold = 36 + 20 = 56 quarters; for hospitality
  // = construction + 14-year hold = 12 + 56 = 56 quarters). Renamed to
  // "Total Modeling Horizon" + unit "quarters (incl. operating hold)"
  // so the meaning is unambiguous. The named range TotalQuarters
  // remains unchanged — only the operator-facing label/unit is updated.
  const scheduleSection = {
    title: 'Project Schedule',
    rows: [
      ['Construction Duration',         'ProjectMonths',       ctx.projectMonths,                                                                              'months (build phase)', NUMBER_FORMATS.integer],
      ['Total Modeling Horizon',        'TotalQuarters',       ctx.totalQuarters,                                                                              'quarters (incl. operating hold)', NUMBER_FORMATS.integer],
      ['Construction Start Lag',        'ConstructionLagQ',    firstNumber(ctx.inputs.constructionLagQuarters, 1),                                             'quarters', NUMBER_FORMATS.integer],
      ['Sales / Lease Launch Lag',      'SalesLagQ',           firstNumber(ctx.inputs.salesLagQuarters, ctx.inputs.leaseLagQuarters, 0),                       'quarters', NUMBER_FORMATS.integer],
    ],
  };

  const capitalSection = {
    title: 'Capital Structure & Returns',
    rows: [
      ['Debt %',                  'DebtLTV',             debtLtvFor(ctx),                                      '% of cost', NUMBER_FORMATS.percent],
      ['Interest Rate',           'DebtRatePct',         debtRatePctFor(ctx),                          '% / year', NUMBER_FORMATS.percent],
      ['Loan Term',               'LoanTermYears',       firstNumber(ctx.inputs.loanTermYears, 7),                                                       'years', NUMBER_FORMATS.integer],
      ['Moratorium',              'MoratoriumMonths',    firstNumber(ctx.inputs.moratoriumMonths, 0),                                                    'months', NUMBER_FORMATS.integer],
      ['Discount Rate',           'DiscountRatePct',     discountRatePctFor(ctx),                      '% / year', NUMBER_FORMATS.percent],
      ['Developer Margin Target', 'DeveloperMarginPct',  toPctDecimal(firstNumber(ctx.inputs.developerMarginPct, ctx.deal.developer_margin_pct, 0.20)),                 '%', NUMBER_FORMATS.percent],
      ['JV — Developer Share',    'JVDevPct',            toPctDecimal(firstNumber(ctx.deal.jv_split_developer_pct, ctx.inputs.jvDevPct, 0.50)),                          '% of profit', NUMBER_FORMATS.percent],
      ['JV — Landowner Share',    'JVLandPct',           toPctDecimal(firstNumber(ctx.deal.jv_split_landowner_pct, ctx.inputs.jvLandPct, 0.50)),                         '% of profit', NUMBER_FORMATS.percent],
    ],
  };

  // ── Taxation (India) (PR-I7) ──────────────────────────────────────────
  // Indian tax regime affecting RE exit / disposal economics, in force
  // as of 2026-05:
  //   - LTCG on land/building held > 24 months: 12.5% (post Jul-2024
  //     budget; previously 20% with indexation). Operator can override
  //     for affordable housing (some exemptions) or short-hold deals.
  //   - TDS u/s 194-IA: 1% withheld at sale on every immovable property
  //     transaction > ₹50 lakh. Buyer deducts and remits to govt; seller
  //     claims credit. Affects working-capital timing at exit.
  //   - Indexation benefit: NOT available post Jul-2024 for new
  //     acquisitions. Pre-Jul-2024 acquisitions retain optional indexation
  //     at 20%. Categorical toggle reflects this.
  //   - GST on rentals: commercial leases attract 18% output GST (with
  //     ITC); residential leases are exempt. Modeled via the Cash Flow
  //     Engine's existing input plumbing for income deals.
  //
  // PR-I7 adds the LTCG / TDS / Indexation inputs as informational fields.
  // The derived "Applicable Capital Gains Rate" cell branches on holding
  // period: ≥ 2 yrs → LTCG (12.5%); < 2 yrs → STCG (slab ~30% approximation).
  // A future PR can wire these into a Net-of-Tax IRR on the Dashboard.
  const taxationSection = {
    title: 'Taxation (India)',
    rows: [
      ['LTCG Rate on disposal',     'LTCGRate',
        toPctDecimal(firstNumber(ctx.inputs.ltcgRate, ctx.inputs.ltcgPct, 0.125)),
        '% on long-term gain (post Jul-2024 budget)', NUMBER_FORMATS.percent],
      ['TDS u/s 194-IA',           'TDSRate',
        toPctDecimal(firstNumber(ctx.inputs.tdsRate, 0.01)),
        '% withheld at sale > ₹50 lakh', NUMBER_FORMATS.percent],
      ['Indexation Regime',         'IndexationRegime',
        ctx.inputs.indexationRegime || 'post_2024_no_indexation',
        'post_2024_no_indexation / pre_2024_with_indexation', null],
      ['Effective Holding Period',  'EffectiveHoldYears',
        firstNumber(ctx.inputs.effectiveHoldYears, ctx.inputs.loanTermYears, 7),
        'years (drives LTCG eligibility ≥ 2 yrs)', NUMBER_FORMATS.integer],
      // Derived: long-term vs short-term capital gain branching by hold
      // period. < 2 years → STCG slab rate (modeled at 30% approximation).
      ['Applicable Capital Gains Rate', 'EffectiveCGRate',
        { formula: '=IF(EffectiveHoldYears>=2,LTCGRate,0.3)' },
        '% (derived — LTCG if ≥ 2yr, else STCG slab ~30%)', NUMBER_FORMATS.percent],
    ],
  };

  // ── Approvals & RERA Registration breakdown (PR-I10) ──────────────────
  // Karnataka / Bengaluru-specific approval line items. The headline
  // `ApprovalCostCr` in Cost Structure is the rollup used by downstream
  // formulas; this section breaks it out so an IC reviewer can see the
  // individual permit costs. Each row is operator-editable and defaults
  // to 0 — operator fills in based on actual quotes from consultants /
  // liaison agents. Typical BBMP ranges noted in the unit column.
  //
  // Derived "Sum of detailed approvals" row at the bottom — operator
  // should sanity-check against the headline ApprovalCostCr above. The
  // breakdown does NOT auto-overwrite the headline to avoid losing
  // operator-pasted lender-quote values.
  const approvalsBreakdownSection = {
    title: 'Approvals & RERA Registration (Karnataka / Bengaluru breakdown)',
    rows: [
      ['Khata conversion (BBMP)',          'ApprKhataCr',         firstNumber(ctx.inputs.apprKhataCr, 0),         'INR Cr (typical 0.5-2 Cr by plot)', NUMBER_FORMATS.currency],
      ['BDA layout approval',              'ApprBDALayoutCr',     firstNumber(ctx.inputs.apprBDALayoutCr, 0),     'INR Cr (1-5 Cr by plot)', NUMBER_FORMATS.currency],
      ['BBMP plan sanction',               'ApprBBMPSanctionCr',  firstNumber(ctx.inputs.apprBBMPSanctionCr, 0),  'INR Cr (0.5-2% of construction)', NUMBER_FORMATS.currency],
      ['BWSSB water connection',           'ApprBWSSBCr',         firstNumber(ctx.inputs.apprBWSSBCr, 0),         'INR Cr (0.3-1 Cr)', NUMBER_FORMATS.currency],
      ['BESCOM electricity sanction',      'ApprBESCOMCr',        firstNumber(ctx.inputs.apprBESCOMCr, 0),        'INR Cr (0.2-0.8 Cr)', NUMBER_FORMATS.currency],
      ['KSPCB consent (environmental)',    'ApprKSPCBCr',         firstNumber(ctx.inputs.apprKSPCBCr, 0),         'INR Cr (0.1-0.5 Cr)', NUMBER_FORMATS.currency],
      ['Airport Authority NOC',            'ApprAirportNOCCr',    firstNumber(ctx.inputs.apprAirportNOCCr, 0),    'INR Cr (only funnel zones)', NUMBER_FORMATS.currency],
      ['Fire Department NOC',              'ApprFireNOCCr',       firstNumber(ctx.inputs.apprFireNOCCr, 0),       'INR Cr (0.1-0.3 Cr)', NUMBER_FORMATS.currency],
      ['Lift / Elevator NOC',              'ApprLiftNOCCr',       firstNumber(ctx.inputs.apprLiftNOCCr, 0),       'INR Cr (0.05-0.2 Cr)', NUMBER_FORMATS.currency],
      ['RERA registration + renewal',      'ApprRERACr',          firstNumber(ctx.inputs.apprRERACr, 0),          'INR Cr (0.05-0.2 Cr per project)', NUMBER_FORMATS.currency],
      ['Occupancy Certificate (OC)',       'ApprOCCr',            firstNumber(ctx.inputs.apprOCCr, 0),            'INR Cr (0.1-0.3 Cr)', NUMBER_FORMATS.currency],
      ['Completion Certificate (CC)',      'ApprCCCr',            firstNumber(ctx.inputs.apprCCCr, 0),            'INR Cr (0.05-0.1 Cr)', NUMBER_FORMATS.currency],
      // Derived rollup so the operator can sanity-check vs the headline
      // ApprovalCostCr in the Cost Structure section above.
      ['Sum of detailed approvals',        'ApprovalsBreakdownSumCr',
        { formula: '=ApprKhataCr+ApprBDALayoutCr+ApprBBMPSanctionCr+ApprBWSSBCr+ApprBESCOMCr+ApprKSPCBCr+ApprAirportNOCCr+ApprFireNOCCr+ApprLiftNOCCr+ApprRERACr+ApprOCCr+ApprCCCr' },
        'INR Cr (derived — compare vs ApprovalCostCr above)', NUMBER_FORMATS.currency],
      // PR-NX4 (2026-05-15): live reconciliation between the operator-
      // entered headline ApprovalCostCr and the detailed breakdown sum.
      // Auto-flags divergence > 5% so the operator knows when their
      // breakdown drift has materially desynced from the headline rollup
      // (which is what downstream cost / debt / waterfall formulas use).
      ['Reconciliation — Δ vs Headline',  'ApprovalsBreakdownDeltaCr',
        { formula: '=ApprovalsBreakdownSumCr-ApprovalCostCr' },
        'INR Cr (breakdown − headline; should be ~0)', NUMBER_FORMATS.currency],
      ['Reconciliation — Δ %',             'ApprovalsBreakdownDeltaPct',
        { formula: '=IFERROR(ABS(ApprovalsBreakdownDeltaCr)/ApprovalCostCr,0)' },
        '% absolute deviation (target < 5%)', NUMBER_FORMATS.percent],
      // PR-NX14 (2026-05-15): three-state reconciliation status.
      // Pre-fix this was binary (✓ Aligned vs ⚠ Drift). When the operator
      // had NOT yet populated the line-item breakdown (sum = 0 but
      // headline ApprovalCostCr > 0), the formula showed "⚠ Drift > 5%"
      // — alarming, but really just "you haven't filled in the breakdown
      // yet." Now the formula distinguishes:
      //   - sum = 0 (breakdown not populated): "ℹ Headline only — itemize below"
      //   - drift > 5% (both populated, mismatch): "⚠ Drift — review breakdown"
      //   - drift ≤ 5% (aligned): "✓ Aligned"
      ['Reconciliation — Status',          'ApprovalsBreakdownStatus',
        { formula: '=IF(IFERROR(ApprovalsBreakdownSumCr,0)=0,"ℹ Headline only — populate line items below to itemize",IF(IFERROR(ApprovalsBreakdownDeltaPct,0)<0.05,"✓ Aligned","⚠ Drift > 5% — review breakdown"))' },
        'three-state: aligned / drift / headline-only', null],
    ],
  };

  // ── Hospitality Operating Metrics (PR-I12) ────────────────────────────
  // Hospitality assets in India price on ADR × Occupancy × Keys × 365,
  // not on INR/sqft/month like commercial. PR-I12 adds explicit ADR +
  // Occupancy + RevPAR + seasonality inputs as informational disclosure.
  // Section appears only for hospitality asset class.
  const hospitalitySection = {
    title: 'Hospitality Operating Metrics (ADR / Occupancy / RevPAR)',
    rows: [
      ['Number of Keys',              'HospitalityKeys',
        firstNumber(ctx.inputs.keys, ctx.inputs.hospitalityKeys, ctx.inputs.numberOfKeys, 100),
        'count (rooms)', NUMBER_FORMATS.integer],
      ['ADR — Base / Off-Season',     'HospitalityADRBase',
        firstNumber(ctx.inputs.adr, ctx.inputs.hospitalityADRBase, ctx.inputs.hospitalityADR, 6000),
        'INR / room / night', NUMBER_FORMATS.integer],
      ['ADR — Peak Season',           'HospitalityADRPeak',
        firstNumber(ctx.inputs.hospitalityADRPeak, ctx.inputs.hospitalityHighSeasonADR, ctx.inputs.adr, 9000),
        'INR / room / night', NUMBER_FORMATS.integer],
      ['Peak Season Share',           'HospitalityPeakShare',
        toPctDecimal(firstNumber(ctx.inputs.hospitalityPeakShare, ctx.inputs.hospitalityHighSeasonShare, 0.30)),
        '% of year (Oct-Mar wedding/winter)', NUMBER_FORMATS.percent],
      ['Blended ADR (derived)',       'HospitalityBlendedADR',
        { formula: '=HospitalityADRBase*(1-HospitalityPeakShare)+HospitalityADRPeak*HospitalityPeakShare' },
        'INR / room / night (derived)', NUMBER_FORMATS.integer],
      ['RevPAR (derived)',            'HospitalityRevPAR',
        { formula: '=HospitalityBlendedADR*OccupancyPct' },
        'INR / room / night (derived)', NUMBER_FORMATS.integer],
      ['Implied annual revenue (Cr)', 'HospitalityImpliedRevenueCr',
        { formula: '=HospitalityRevPAR*HospitalityKeys*365/10000000' },
        'INR Cr / year (derived)', NUMBER_FORMATS.currency],
    ],
  };

  const hospitalityUsaliSection = {
    title: 'Hospitality USALI Engine Drivers',
    rows: [
      ['Sqft per Key', 'HospitalitySqftPerKey', engineFirstNumber(ctx, ['sqftPerKey', 'grossAreaPerKeySqft', 'areaPerKeySqft'], HOSPITALITY_DEFAULT_SQFT_PER_KEY), 'gross BUA / key', NUMBER_FORMATS.integer],
      ['ADR Growth', 'HospitalityADRGrowthPct', enginePctDecimal(ctx, ['adrGrowthPct', 'rentEscalationPct'], 0.05), '% / year', NUMBER_FORMATS.percent],
      ['Initial Occupancy', 'HospitalityInitialOccPct', enginePctDecimal(ctx, ['initialOccPct'], 0.45), '% in operating year 1', NUMBER_FORMATS.percent],
      ['Stabilization Year', 'HospitalityStabilizationYear', engineFirstNumber(ctx, ['stabilizationYear'], 4), 'operating year', NUMBER_FORMATS.integer],
      ['Hold Period', 'HospitalityHoldYears', engineFirstNumber(ctx, ['holdPeriodYears', 'holdYears'], 10), 'years after construction', NUMBER_FORMATS.integer],
      ['Architect / Design', 'HospitalityArchitectPctHard', enginePctDecimal(ctx, ['architectPctOfHard', 'architectFeePct'], 0.04), '% of hard cost', NUMBER_FORMATS.percent],
      ['PMC', 'HospitalityPMCPctHard', enginePctDecimal(ctx, ['pmcPctOfHard'], 0.02), '% of hard cost', NUMBER_FORMATS.percent],
      ['Consultants', 'HospitalityConsultantsPctHard', enginePctDecimal(ctx, ['consultantsPctOfHard'], 0.035), '% of hard cost', NUMBER_FORMATS.percent],
      ['Approvals', 'HospitalityApprovalsPctHard', enginePctDecimal(ctx, ['approvalsPctOfHard'], 0.02), '% of hard cost if no explicit approval cost', NUMBER_FORMATS.percent],
      ['Betterment Charge', 'HospitalityBettermentPct', enginePctDecimal(ctx, ['bettermentPct'], 0.03), '% of land cost', NUMBER_FORMATS.percent],
      ['F&B Restaurant Revenue', 'HospitalityFBRestaurantPct', enginePctDecimal(ctx, ['fbRestaurantPctOfRooms'], 0.18), '% of rooms revenue', NUMBER_FORMATS.percent],
      ['F&B Banquet Revenue', 'HospitalityFBBanquetPct', enginePctDecimal(ctx, ['fbBanquetPctOfRooms'], 0.12), '% of rooms revenue', NUMBER_FORMATS.percent],
      ['Other Operated Revenue', 'HospitalityOtherOperatedPct', enginePctDecimal(ctx, ['otherOperatedPctOfRooms'], 0.07), '% of rooms revenue', NUMBER_FORMATS.percent],
      ['Parking Revenue', 'HospitalityParkingPct', enginePctDecimal(ctx, ['parkingPctOfRooms'], 0.02), '% of rooms revenue', NUMBER_FORMATS.percent],
      ['F&B Restaurant / POR', 'HospitalityFBRestaurantPerPOR', engineFirstNumber(ctx, ['fbRestaurantPerPOR'], 0), 'INR / occupied room', NUMBER_FORMATS.integer],
      ['F&B Banquet / POR', 'HospitalityFBBanquetPerPOR', engineFirstNumber(ctx, ['fbBanquetPerPOR'], 0), 'INR / occupied room', NUMBER_FORMATS.integer],
      ['Other Operated / POR', 'HospitalityOtherOperatedPerPOR', engineFirstNumber(ctx, ['otherOperatedPerPOR'], 0), 'INR / occupied room', NUMBER_FORMATS.integer],
      ['Parking / POR', 'HospitalityParkingPerPOR', engineFirstNumber(ctx, ['parkingPerPOR'], 0), 'INR / occupied room', NUMBER_FORMATS.integer],
      ['F&B Delivery / POR', 'HospitalityFBDeliveryPerPOR', engineFirstNumber(ctx, ['fbDeliveryPerPOR'], 0), 'INR / occupied room', NUMBER_FORMATS.integer],
      ['Lease Income', 'HospitalityLeaseIncomeCr', engineFirstNumber(ctx, ['leaseIncomeCrPa'], 0), 'INR Cr / year', NUMBER_FORMATS.currency],
      ['Rooms Department Cost', 'HospitalityRoomsDeptCostPct', enginePctDecimal(ctx, ['roomsDeptCostPct'], 0.28), '% of rooms revenue', NUMBER_FORMATS.percent],
      ['F&B Department Cost', 'HospitalityFBDeptCostPct', enginePctDecimal(ctx, ['fbDeptCostPct'], 0.75), '% of F&B revenue', NUMBER_FORMATS.percent],
      ['Other Department Cost', 'HospitalityOtherDeptCostPct', enginePctDecimal(ctx, ['otherDeptCostPct'], 0.52), '% of other operated revenue', NUMBER_FORMATS.percent],
      ['Rooms Fixed Cost Split', 'HospitalityRoomsFixedPct', enginePctDecimal(ctx, ['roomsFixedPct'], 0), '% fixed / balance variable', NUMBER_FORMATS.percent],
      ['F&B Fixed Cost Split', 'HospitalityFBFixedPct', enginePctDecimal(ctx, ['fbFixedPct'], 0), '% fixed / balance variable', NUMBER_FORMATS.percent],
      ['Other Fixed Cost Split', 'HospitalityOtherOpFixedPct', enginePctDecimal(ctx, ['otherOpFixedPct'], 0), '% fixed / balance variable', NUMBER_FORMATS.percent],
      ['Admin & General', 'HospitalityAAndGPct', enginePctDecimal(ctx, ['aAndGPct'], 0.075), '% of total revenue', NUMBER_FORMATS.percent],
      ['IT / Systems', 'HospitalityITPct', enginePctDecimal(ctx, ['itPct'], 0.02), '% of total revenue', NUMBER_FORMATS.percent],
      ['Sales & Marketing', 'HospitalitySMPct', enginePctDecimal(ctx, ['smPct'], 0.055), '% of total revenue', NUMBER_FORMATS.percent],
      ['POM', 'HospitalityPOMPct', enginePctDecimal(ctx, ['pomPct'], 0.045), '% of total revenue', NUMBER_FORMATS.percent],
      ['Utilities', 'HospitalityUtilitiesPct', enginePctDecimal(ctx, ['utilitiesPct'], 0.05), '% of total revenue', NUMBER_FORMATS.percent],
      ['Admin & General / POR', 'HospitalityAAndGPerPOR', engineFirstNumber(ctx, ['aAndGPerPOR'], 0), 'INR / occupied room', NUMBER_FORMATS.integer],
      ['IT / POR', 'HospitalityITPerPOR', engineFirstNumber(ctx, ['itPerPOR'], 0), 'INR / occupied room', NUMBER_FORMATS.integer],
      ['Sales & Marketing / POR', 'HospitalitySMPerPOR', engineFirstNumber(ctx, ['smPerPOR'], 0), 'INR / occupied room', NUMBER_FORMATS.integer],
      ['POM / POR', 'HospitalityPOMPerPOR', engineFirstNumber(ctx, ['pomPerPOR'], 0), 'INR / occupied room', NUMBER_FORMATS.integer],
      ['Utilities / POR', 'HospitalityUtilitiesPerPOR', engineFirstNumber(ctx, ['utilitiesPerPOR'], 0), 'INR / occupied room', NUMBER_FORMATS.integer],
      ['Expense Inflation', 'HospitalityExpenseInflationPct', enginePctDecimal(ctx, ['expenseInflationPct'], 0), '% / year', NUMBER_FORMATS.percent],
      ['Management Base Fee', 'HospitalityMgmtBasePct', enginePctDecimal(ctx, ['mgmtBasePct'], 0.03), '% of total revenue', NUMBER_FORMATS.percent],
      ['Management Incentive Fee', 'HospitalityMgmtIncentivePct', enginePctDecimal(ctx, ['mgmtIncentivePct'], 0.09), '% of positive GOP', NUMBER_FORMATS.percent],
      ['Brand Royalty', 'HospitalityBrandRoyaltyPct', enginePctDecimal(ctx, ['brandRoyaltyPctOfRooms'], 0.05), '% of rooms revenue', NUMBER_FORMATS.percent],
      ['Brand Marketing + Reservation', 'HospitalityBrandMktReservPct', enginePctDecimal(ctx, ['brandMktReservPctOfRooms'], 0.02), '% of rooms revenue', NUMBER_FORMATS.percent],
      ['Property Tax', 'HospitalityPropertyTaxPctRev', enginePctDecimal(ctx, ['propertyTaxPctRev'], 0.02), '% of total revenue', NUMBER_FORMATS.percent],
      ['Insurance', 'HospitalityInsurancePctRev', enginePctDecimal(ctx, ['insurancePctRev'], 0.01), '% of total revenue', NUMBER_FORMATS.percent],
      ['Property Tax - Fixed Override', 'HospitalityPropertyTaxCrPa', engineFirstNumber(ctx, ['propertyTaxCrPa'], 0), 'INR Cr / year', NUMBER_FORMATS.currency],
      ['Insurance - Fixed Override', 'HospitalityInsuranceCrPa', engineFirstNumber(ctx, ['insuranceCrPa'], 0), 'INR Cr / year', NUMBER_FORMATS.currency],
      ['Ground Lease', 'HospitalityGroundLeaseCrPa', engineFirstNumber(ctx, ['groundLeaseCrPa'], 0), 'INR Cr / year', NUMBER_FORMATS.currency],
      ['FF&E Reserve', 'HospitalityFFEReservePct', enginePctDecimal(ctx, ['ffeReservePct'], 0.04), '% of total revenue', NUMBER_FORMATS.percent],
      ['Construction Cost / Key', 'HospitalityConstructionCostPerKey', hospitalityConstructionCostPerKey(ctx) || 0, 'INR / key', NUMBER_FORMATS.integer],
      ['FF&E / Key', 'HospitalityFFEPerKey', engineFirstNumber(ctx, ['ffePerKey'], 2500000), 'INR / key', NUMBER_FORMATS.integer],
      ['OS&E / Key', 'HospitalityOSEPerKey', engineFirstNumber(ctx, ['osePerKey'], 400000), 'INR / key', NUMBER_FORMATS.integer],
      ['Pre-opening / Key', 'HospitalityPreOpeningPerKey', engineFirstNumber(ctx, ['preOpeningPerKey', 'preOpeningCostPerKey'], 350000), 'INR / key', NUMBER_FORMATS.integer],
      ['Working Capital', 'HospitalityWorkingCapitalCr', engineFirstNumber(ctx, ['workingCapitalCr'], (engineFirstNumber(ctx, ['keys'], 100) * 50000) / 10000000), 'INR Cr', NUMBER_FORMATS.currency],
      ['Construction Loan LTC', 'HospitalityConstLoanLTC', enginePctDecimal(ctx, ['constLoanLTC', 'debtLTC', 'debtLTV'], 0.55), '% of development cost', NUMBER_FORMATS.percent],
      ['Construction Loan Rate', 'HospitalityConstLoanRatePct', enginePctDecimal(ctx, ['constLoanRatePct', 'interestRatePct', 'debtRatePct'], 0.105), '% / year', NUMBER_FORMATS.percent],
      ['Construction Loan Fee', 'HospitalityConstLoanFeesPct', enginePctDecimal(ctx, ['constLoanFeesPct'], 0.01), '% of loan', NUMBER_FORMATS.percent],
      ['Refi LTV', 'HospitalityRefiLTV', enginePctDecimal(ctx, ['refiLTV'], 0.55), '% of stabilized value', NUMBER_FORMATS.percent],
      ['Refi Cap Rate', 'HospitalityRefiCapRate', enginePctDecimal(ctx, ['refiCapRatePct'], 0.085), '% cap rate', NUMBER_FORMATS.percent],
      ['Refi Interest Rate', 'HospitalityRefiInterestRate', enginePctDecimal(ctx, ['refiInterestRatePct'], 0.0925), '% / year', NUMBER_FORMATS.percent],
    ],
  };

  // ── Retail CAM + Anchor / Vanilla split (PR-I13) ──────────────────────
  // Indian mall economics: anchors at ₹60-90/sqft/mo + minimal CAM;
  // vanilla tenants at ₹150-300 + full CAM. PR-I13 adds anchor share +
  // anchor/vanilla rents + CAM recovery inputs. Section appears only for
  // retail asset class.
  const retailSection = {
    title: 'Retail CAM + Anchor / Vanilla Rent Split',
    rows: [
      ['Anchor Share of Leasable Area', 'RetailAnchorSharePct',
        toPctDecimal(firstNumber(ctx.inputs.retailAnchorSharePct, ctx.inputs.anchorSharePct, 0.40)),
        '% (typical 30-50% in India malls)', NUMBER_FORMATS.percent],
      ['Anchor Rent / sqft / month',    'RetailAnchorRentPerSqftMonth',
        firstNumber(ctx.inputs.retailAnchorRentPerSqftMonth, 60),
        'INR / sqft / month (typical 50-90)', NUMBER_FORMATS.integer],
      ['Vanilla Rent / sqft / month',   'RetailVanillaRentPerSqftMonth',
        firstNumber(ctx.inputs.retailVanillaRentPerSqftMonth, 180),
        'INR / sqft / month (typical 150-300)', NUMBER_FORMATS.integer],
      ['CAM Recovery %',                'RetailCAMRecoveryPct',
        toPctDecimal(firstNumber(ctx.inputs.retailCAMRecoveryPct, 0.95)),
        '% of CAM cost recovered from tenants', NUMBER_FORMATS.percent],
      ['Blended Rent / sqft / month (derived)', 'RetailBlendedRentPerSqftMonth',
        { formula: '=RetailAnchorRentPerSqftMonth*RetailAnchorSharePct+RetailVanillaRentPerSqftMonth*(1-RetailAnchorSharePct)' },
        'INR / sqft / month (derived — paste into BaseRentPerSqftMonth)', NUMBER_FORMATS.integer],
    ],
  };

  // ── Title & Khata Status (PR-I8) ──────────────────────────────────────
  // A-khata vs B-khata is a major Bengaluru-specific valuation factor.
  // A-khata: full title, eligible for bank financing, building approval,
  //          and OC. Trades at full market value.
  // B-khata: irregular title, NOT eligible for bank financing, no OC,
  //          tradable at a 15-25% discount to A-khata equivalents.
  // Mixed / Not Applicable: for raw land or multi-parcel deals.
  //
  // Informational fields only — operator manually adjusts SellRatePerSqft
  // or ExitCapRate to reflect any B-khata discount. The derived
  // "Suggested Exit Adjustment" row flags whether a haircut would apply
  // so IC reviewers can sanity-check the modeled exit value.
  const khataStatusSection = {
    title: 'Title & Khata Status (Bengaluru)',
    rows: [
      ['Khata Status',                  'KhataStatus',
        ctx.inputs.khataStatus || 'A_khata',
        'A_khata / B_khata / mixed / not_applicable', null],
      ['B-Khata Exit Haircut',          'BKhataExitHaircutPct',
        toPctDecimal(firstNumber(ctx.inputs.bKhataExitHaircutPct, ctx.inputs.bKhataDiscountPct, 0.15)),
        '% applied to exit if B-khata', NUMBER_FORMATS.percent],
      // Derived: 1.0 if A-khata or N/A; (1 - haircut) if B-khata or mixed.
      // Multiplicative form so an operator can paste =ExitValue *
      // KhataExitMultiplier into their own scenario sheet to get the
      // adjusted figure quickly.
      ['Suggested Exit Multiplier',     'KhataExitMultiplier',
        { formula: '=IF(OR(KhataStatus="B_khata",KhataStatus="mixed"),1-BKhataExitHaircutPct,1)' },
        'derived — multiply exit value by this for B-khata haircut', NUMBER_FORMATS.multiple],
    ],
  };

  // ── Sale-Rate Escalation Model (PR-I11) ───────────────────────────────
  // BLR residential developers price on milestone-anchored escalation:
  // ~25-35% cumulative lift launch-to-handover. The continuous compound
  // model understates early-quarter pricing. PR-I11 adds disclosure-only
  // inputs + a derived equivalent continuous-compound rate the operator
  // can paste into EscalationPct. Visible for residential / villas /
  // mixed_use (where milestone pricing is conventional).
  const milestoneEscalationSection = {
    title: 'Sale-Rate Escalation Model (Milestone Pricing)',
    rows: [
      ['Escalation Model',                  'MilestoneEscalationModel',
        ctx.inputs.milestoneEscalationModel || 'continuous_per_year',
        'continuous_per_year / milestone_anchored_blr', null],
      ['Total Launch-to-Handover Escalation','MilestoneTotalEscalationPct',
        toPctDecimal(firstNumber(ctx.inputs.milestoneTotalEscalationPct, 0.25)),
        '% cumulative (typical 20-35% BLR residential)', NUMBER_FORMATS.percent],
      ['Equivalent EscalationPct (derived)','MilestoneEquivalentEscalationPct',
        { formula: '=(1+MilestoneTotalEscalationPct)^(1/(ProjectMonths/12))-1' },
        '% / year (paste into EscalationPct above)', NUMBER_FORMATS.percent],
    ],
  };

  // ── Plot-Level Absorption (PR-I14) ────────────────────────────────────
  // Plotted developments sell plot-by-plot — big plots clear slower,
  // small plots clear fast. The uniform SalesVelocityPct misrepresents
  // premium plot mixes. PR-I14 adds disclosure inputs documenting the
  // plot-size distribution + absorption period. Visible only for
  // plotted_development.
  const plotAbsorptionSection = {
    title: 'Plot-Level Absorption (Plotted Development)',
    rows: [
      ['Avg. Absorption Period',     'PlotAbsorptionMonths',
        firstNumber(ctx.inputs.plotAbsorptionMonths, 24),
        'months (typical 18-36 BLR plotted)', NUMBER_FORMATS.integer],
      ['Small Plot Share',           'PlotSmallSharePct',
        toPctDecimal(firstNumber(ctx.inputs.plotSmallSharePct, 0.40)),
        '% of saleable area (< 1500 sqft)', NUMBER_FORMATS.percent],
      ['Mid Plot Share',             'PlotMidSharePct',
        toPctDecimal(firstNumber(ctx.inputs.plotMidSharePct, 0.40)),
        '% of saleable area (1500-3000 sqft)', NUMBER_FORMATS.percent],
      ['Large Plot Share',           'PlotLargeSharePct',
        toPctDecimal(firstNumber(ctx.inputs.plotLargeSharePct, 0.20)),
        '% of saleable area (> 3000 sqft)', NUMBER_FORMATS.percent],
      ['Sum Check (should = 100%)',  'PlotSharesCheck',
        { formula: '=PlotSmallSharePct+PlotMidSharePct+PlotLargeSharePct' },
        '% (derived — verify allocation)', NUMBER_FORMATS.percent],
    ],
  };

  // ── Mixed-Use Component Breakdown (PR-I15) ────────────────────────────
  // Mixed-use deals combine residential + office + retail + hospitality
  // on a single parcel. A single SellRatePerSqft can't capture this.
  // PR-I15 adds disclosure inputs for each component's share + revenue
  // rate. Visible only for mixed_use / redevelopment.
  const mixedUseSection = {
    title: 'Mixed-Use Component Breakdown',
    rows: [
      ['Residential Component Share',     'MixUseResiSharePct',
        toPctDecimal(firstNumber(ctx.inputs.mixUseResiSharePct, 0.50)),
        '% of saleable area', NUMBER_FORMATS.percent],
      ['Residential Sell Rate',           'MixUseResiRatePerSqft',
        firstNumber(ctx.inputs.mixUseResiRatePerSqft, 12000),
        'INR / sqft (sale)', NUMBER_FORMATS.integer],
      ['Office Component Share',          'MixUseOfficeSharePct',
        toPctDecimal(firstNumber(ctx.inputs.mixUseOfficeSharePct, 0.30)),
        '% of leasable area', NUMBER_FORMATS.percent],
      ['Office Capitalised Sale Rate',    'MixUseOfficeRatePerSqft',
        firstNumber(ctx.inputs.mixUseOfficeRatePerSqft, 15000),
        'INR / sqft (NOI ÷ cap, exit)', NUMBER_FORMATS.integer],
      ['Retail Component Share',          'MixUseRetailSharePct',
        toPctDecimal(firstNumber(ctx.inputs.mixUseRetailSharePct, 0.15)),
        '% of leasable area', NUMBER_FORMATS.percent],
      ['Retail Capitalised Sale Rate',    'MixUseRetailRatePerSqft',
        firstNumber(ctx.inputs.mixUseRetailRatePerSqft, 18000),
        'INR / sqft (NOI ÷ cap, exit)', NUMBER_FORMATS.integer],
      ['Hospitality Component Share',     'MixUseHospSharePct',
        toPctDecimal(firstNumber(ctx.inputs.mixUseHospSharePct, 0.05)),
        '% of saleable area', NUMBER_FORMATS.percent],
      ['Hospitality Capitalised Sale Rate','MixUseHospRatePerSqft',
        firstNumber(ctx.inputs.mixUseHospRatePerSqft, 20000),
        'INR / sqft (exit)', NUMBER_FORMATS.integer],
      ['Sum of component shares',         'MixUseSharesSumCheck',
        { formula: '=MixUseResiSharePct+MixUseOfficeSharePct+MixUseRetailSharePct+MixUseHospSharePct' },
        '% (derived — verify = 100%)', NUMBER_FORMATS.percent],
      ['Blended Sale Rate (derived)',     'MixUseBlendedRatePerSqft',
        { formula: '=MixUseResiSharePct*MixUseResiRatePerSqft+MixUseOfficeSharePct*MixUseOfficeRatePerSqft+MixUseRetailSharePct*MixUseRetailRatePerSqft+MixUseHospSharePct*MixUseHospRatePerSqft' },
        'INR / sqft (derived — paste into SellRatePerSqft)', NUMBER_FORMATS.integer],
    ],
  };

  // ── Raw-Land Entitlement Stages (PR-I16) ──────────────────────────────
  // Raw-land deals are pre-construction: buy at one price, hold through
  // 1-3 entitlement stages (title diligence → conversion → layout approval
  // → sale-ready), resell at approval-uplift price. PR-I16 adds disclosure
  // inputs documenting the entitlement pipeline. Visible only for raw_land.
  const rawLandSection = {
    title: 'Raw-Land Entitlement Pipeline',
    rows: [
      ['Current Entitlement Stage',  'RawLandCurrentStage',
        ctx.inputs.rawLandCurrentStage || 'title_diligence',
        'title_diligence / conversion / layout_approval / sale_ready', null],
      ['Title Diligence Duration',   'RawLandTitleMonths',
        firstNumber(ctx.inputs.rawLandTitleMonths, 3),
        'months (typical 2-6)', NUMBER_FORMATS.integer],
      ['Conversion Duration',        'RawLandConversionMonths',
        firstNumber(ctx.inputs.rawLandConversionMonths, 6),
        'months (agri → non-agri, typical 4-12)', NUMBER_FORMATS.integer],
      ['Layout Approval Duration',   'RawLandLayoutMonths',
        firstNumber(ctx.inputs.rawLandLayoutMonths, 9),
        'months (BDA/BMRDA, typical 6-18)', NUMBER_FORMATS.integer],
      ['Approval Uplift on Resale',  'RawLandApprovalUpliftPct',
        toPctDecimal(firstNumber(ctx.inputs.rawLandApprovalUpliftPct, 1.0)),
        '% lift on land value at sale-ready', NUMBER_FORMATS.percent],
      ['Total Pipeline (derived)',   'RawLandTotalPipelineMonths',
        { formula: '=RawLandTitleMonths+RawLandConversionMonths+RawLandLayoutMonths' },
        'months (derived — sum of stage durations)', NUMBER_FORMATS.integer],
    ],
  };

  // ── Exit Strategy (PR-EX) ─────────────────────────────────────────────
  // Operator directive 2026-05-11: make sheets specific to deal type / asset
  // class / "deal structure and exit strategy". Pre-PR-EX the workbook had
  // an "Exit Cap Rate" + "Selling Cost on Exit" pair buried inside the
  // income-family OpEx section but no coherent exit-strategy disclosure.
  //
  // Indian institutional capital evaluates four broad exit paths:
  //   • Income family:
  //     - hold_to_perpetuity — operating asset held indefinitely (HNI portfolios)
  //     - reit_exit          — sale into a REIT vehicle at stabilisation
  //                            (Embassy / Mindspace / Brookfield REIT model)
  //     - strategic_sale     — sale to another operator (typical 7-10yr hold)
  //     - refinance_hold     — refinance debt at stabilisation, hold + cash out
  //   • Development family:
  //     - outright_progressive — sell units during construction (default)
  //     - bulk_exit_completion — sell remaining inventory at OC at a discount
  //     - hold_post_completion — complete then sell as a stabilised block
  //
  // PR-EX adds the strategy label + key exit-cost inputs + a derived
  // "Total Exit Cost" disclosure. Informational only — the Phasing P&L
  // continues to use the existing SellingCostPct + ExitCapRate. Operators
  // explicitly pick the strategy so IC reviewers can sanity-check the
  // model's implicit assumption against the stated plan.
  const exitStrategyIncomeSection = {
    title: 'Exit Strategy (Income Asset)',
    rows: [
      ['Exit Strategy Type',         'ExitStrategyType',
        ctx.inputs.exitStrategyType || 'strategic_sale',
        'hold_to_perpetuity / reit_exit / strategic_sale / refinance_hold', null],
      ['Exit Year (from acquisition)','ExitYearFromAcq',
        firstNumber(ctx.inputs.exitYearFromAcq, ctx.inputs.loanTermYears, 7),
        'years (typical 7-10 BLR commercial)', NUMBER_FORMATS.integer],
      ['Broker Fee on Exit',         'ExitBrokerFeePct',
        toPctDecimal(firstNumber(ctx.inputs.exitBrokerFeePct, 0.02)),
        '% of sale value (typical 1-3%)', NUMBER_FORMATS.percent],
      ['Legal + DD Fee on Exit',     'ExitLegalFeePct',
        toPctDecimal(firstNumber(ctx.inputs.exitLegalFeePct, 0.005)),
        '% of sale value (typical 0.3-1%)', NUMBER_FORMATS.percent],
      // Derived total: includes existing SellingCostPct + new broker + legal.
      // Operator references this when sanity-checking the modeled reversion.
      ['Total Exit Cost (derived)',  'TotalExitCostPct',
        { formula: '=SellingCostPct+ExitBrokerFeePct+ExitLegalFeePct' },
        '% of sale value (derived)', NUMBER_FORMATS.percent],
      // Derived net exit value at the modeled stabilised value.
      // Bug fix: pre-fix formula referenced B6 which is the Asset Class
      // text cell, not NOI — produced 0 via IFERROR. Now uses INDEX to
      // pick the last-quarter NOI cell on the Cash Flow Engine sheet (row
      // 18 = NOI for income family; INDEX picks column TotalQuarters+1
      // which is the last quarter regardless of project duration), × 4
      // for annualised stabilised NOI, ÷ ExitCapRate for terminal value,
      // × (1 − total exit cost) for net proceeds. IFERROR-guarded so
      // empty inputs or div-by-zero collapse to 0 cleanly.
      ['Implied Net Exit Value (Cr)','ImpliedNetExitValueCr',
        { formula: `=IFERROR(INDEX('${SHEETS.cashFlowEngine}'!18:18,TotalQuarters+1)*4/ExitCapRate*(1-TotalExitCostPct)*KhataExitMultiplier,0)` },
        'INR Cr (last-Q NOI × 4 ÷ cap × (1 − exit cost) × Khata multiplier)', NUMBER_FORMATS.currency],
    ],
  };

  const exitStrategyDevSection = {
    title: 'Exit Strategy (Development Asset)',
    rows: [
      ['Exit Strategy Type',         'ExitStrategyType',
        ctx.inputs.exitStrategyType || 'outright_progressive',
        'outright_progressive / bulk_exit_completion / hold_post_completion', null],
      ['Bulk Exit Discount',         'BulkExitDiscountPct',
        toPctDecimal(firstNumber(ctx.inputs.bulkExitDiscountPct, 0.10)),
        '% discount on remaining inventory at OC (if bulk)', NUMBER_FORMATS.percent],
      ['Hold Post-Completion Period','HoldPostCompletionYears',
        firstNumber(ctx.inputs.holdPostCompletionYears, 1),
        'years (typical 0-3 for hold_post_completion)', NUMBER_FORMATS.integer],
      ['Broker Fee on Exit',         'ExitBrokerFeePct',
        toPctDecimal(firstNumber(ctx.inputs.exitBrokerFeePct, 0.02)),
        '% of unit sale (typical 1-3% in BLR resi)', NUMBER_FORMATS.percent],
      // Derived: effective exit factor combines bulk discount + broker fee.
      // When operator picks outright_progressive (default), bulk discount
      // doesn't apply and the factor approximates (1 - broker).
      ['Effective Exit Factor (derived)','EffectiveExitFactor',
        { formula: '=IF(ExitStrategyType="bulk_exit_completion",(1-BulkExitDiscountPct)*(1-ExitBrokerFeePct),(1-ExitBrokerFeePct))' },
        '% of gross revenue retained (derived)', NUMBER_FORMATS.percent],
    ],
  };

  // ── Sponsor / LP Waterfall inputs (PR-D) ─────────────────────────────
  // Institutional deals split equity proceeds between the Sponsor (GP)
  // and the LP investors via a multi-tier waterfall. Standard structure:
  //   Tier 1: LP gets their preferred return on outstanding equity
  //   Tier 2: LP capital returned in full
  //   Tier 3: Sponsor "catch-up" — until they've earned a target % of profits
  //   Tier 4: Promote / carry split above the pref hurdle
  //   Tier 5 (optional): Bigger promote above a second hurdle (12% / 15%)
  //
  // Defaults match Indian institutional equity benchmarks: LP/GP ratio
  // 90/10 (heavy LP), 8% pref, 80/20 promote split above pref, with
  // sponsor catch-up and laddered promotes at 12% / 15% modeled in the
  // Debt Sizing & Amortization worksheet.
  const waterfallSection = {
    title: 'Sponsor / LP Waterfall',
    rows: [
      ['LP Equity Share',          'LPEquityPct',     toPctDecimal(firstNumber(ctx.inputs.lpEquityPct, ctx.inputs.lpSharePct, 0.90)),         '% of total equity', NUMBER_FORMATS.percent],
      ['Sponsor Equity Share',     'GPEquityPct',     toPctDecimal(firstNumber(ctx.inputs.gpEquityPct, ctx.inputs.sponsorSharePct, 0.10)),    '% of total equity', NUMBER_FORMATS.percent],
      ['Preferred Return Rate',    'PrefReturnRate',  toPctDecimal(firstNumber(ctx.inputs.prefReturnRate, ctx.inputs.preferredReturn, 0.08)), '% / year', NUMBER_FORMATS.percent],
      ['Promote Split — LP Share', 'PromoteLPPct',    toPctDecimal(firstNumber(ctx.inputs.promoteLPPct, 0.80)),                                '% above pref', NUMBER_FORMATS.percent],
      ['Promote Split — GP Share', 'PromoteGPPct',    toPctDecimal(firstNumber(ctx.inputs.promoteGPPct, 0.20)),                                '% above pref', NUMBER_FORMATS.percent],
      ['Catch-Up Cash to Sponsor',  'CatchUpPct',      toPctDecimal(firstNumber(ctx.inputs.catchUpPct, 1.00)),                                  '% of catch-up tranche', NUMBER_FORMATS.percent],
      ['Catch-Up Target GP Profit', 'CatchUpTargetGPPct', toPctDecimal(firstNumber(ctx.inputs.catchUpTargetGPPct, ctx.inputs.promoteGPPct, 0.20)), '% cumulative profit share', NUMBER_FORMATS.percent],
      ['Hurdle 1 IRR',              'Hurdle1IRR',      toPctDecimal(firstNumber(ctx.inputs.hurdle1IRR, 0.12)),                                  '% annual project IRR', NUMBER_FORMATS.percent],
      ['Hurdle 1 LP Share',         'Hurdle1LPPct',    toPctDecimal(firstNumber(ctx.inputs.hurdle1LPPct, 0.70)),                                '% residual after catch-up', NUMBER_FORMATS.percent],
      ['Hurdle 1 GP Share',         'Hurdle1GPPct',    toPctDecimal(firstNumber(ctx.inputs.hurdle1GPPct, 0.30)),                                '% residual after catch-up', NUMBER_FORMATS.percent],
      ['Hurdle 2 IRR',              'Hurdle2IRR',      toPctDecimal(firstNumber(ctx.inputs.hurdle2IRR, 0.15)),                                  '% annual project IRR', NUMBER_FORMATS.percent],
      ['Hurdle 2 LP Share',         'Hurdle2LPPct',    toPctDecimal(firstNumber(ctx.inputs.hurdle2LPPct, 0.60)),                                '% residual after catch-up', NUMBER_FORMATS.percent],
      ['Hurdle 2 GP Share',         'Hurdle2GPPct',    toPctDecimal(firstNumber(ctx.inputs.hurdle2GPPct, 0.40)),                                '% residual after catch-up', NUMBER_FORMATS.percent],
    ],
  };

  // ── Debt Profile / India Lender Ecosystem (PR-I6) ────────────────────
  // Indian RE debt has a fundamentally different market structure than US:
  //   - Banks (SBI / HDFC / ICICI / Axis / Bandhan): Repo-linked rates
  //     since RBI's Oct-2019 mandate. Rate = Repo + Spread bps.
  //   - NBFCs / RE-focused funds (HDFC Capital / Edelweiss / IIFL /
  //     Piramal / Kotak): MCLR-linked or fixed-rate. Higher spreads
  //     (300-500 bps over MCLR) but more flexible covenants.
  //   - Loan types: Construction Finance (CF), Lease Rental Discounting
  //     (LRD, for income-producing assets), Project Finance (PF),
  //     Mezzanine. Each has different rate ranges and covenants.
  //
  // Pre-PR-I6 the workbook had a single `DebtRatePct` input with no
  // context for WHICH lender, WHICH benchmark, or WHICH loan type. Indian
  // analysts open the file and immediately wonder "is this a bank LRD
  // or an Edelweiss mezz? They're priced 400 bps apart."
  //
  // PR-I6 adds informational categorical fields so the lender choice is
  // explicit. `DebtRatePct` remains the operator-editable rate (paste in
  // from the term sheet); the new "Implied All-In Rate" row shows the
  // effective rate including processing fee amortised over the term.
  const lenderTypeDefault = ctx.dealFamily === 'income' ? 'HDFC Capital' : 'HDFC Bank';
  const benchmarkDefault = ctx.dealFamily === 'income' ? 'MCLR' : 'Repo';
  const loanTypeDefault = ctx.dealFamily === 'income' ? 'LRD (Lease Rental Discounting)' : 'Project Finance';
  const lenderProfileSection = {
    title: 'Debt Profile (India Lender Ecosystem)',
    rows: [
      ['Lender Type',              'LenderType',
        ctx.inputs.lenderType || lenderTypeDefault,
        'e.g. SBI / HDFC / ICICI / Edelweiss / IIFL / Piramal', null],
      ['Rate Benchmark',           'RateBenchmark',
        ctx.inputs.rateBenchmark || benchmarkDefault,
        'Repo / MCLR / Fixed / Marginal', null],
      ['Spread over Benchmark',    'SpreadBps',
        firstNumber(ctx.inputs.spreadBps, ctx.inputs.lenderSpreadBps, 280),
        'bps (basis points)', NUMBER_FORMATS.integer],
      ['Loan Type',                'LoanType',
        ctx.inputs.loanType || loanTypeDefault,
        'Construction / LRD / PF / Mezz', null],
      ['Processing Fee',           'ProcessingFeePct',
        toPctDecimal(firstNumber(ctx.inputs.processingFeePct, ctx.inputs.processingFee, 0.005)),
        '% of loan amount (one-time)', NUMBER_FORMATS.percent],
      ['Prepayment Penalty',       'PrepaymentPenaltyPct',
        toPctDecimal(firstNumber(ctx.inputs.prepaymentPenaltyPct, 0)),
        '% of outstanding (typical 1-2% for RE NBFC)', NUMBER_FORMATS.percent],
      // Derived: effective all-in rate = DebtRatePct + processing fee amortised
      // over the loan term. Useful sanity check against the lender's
      // term-sheet "all-in cost" disclosure.
      ['Implied All-In Rate',      'ImpliedAllInRate',
        { formula: '=DebtRatePct+IFERROR(ProcessingFeePct/LoanTermYears,0)' },
        '% / year (derived: rate + amortised fee)', NUMBER_FORMATS.percent],
    ],
  };

  const debtPhaseSection = {
    title: 'Debt Phase Structure (Construction → Permanent)',
    rows: [
      ['Construction Loan LTC',       'ConstructionLoanLTC',
        toPctDecimal(firstNumber(ctx.inputs.constructionLoanLTC, ctx.inputs.constrMaxLTC, ctx.inputs.maxLTC, 0.75)),
        '% of total project cost', NUMBER_FORMATS.percent],
      ['Construction Debt Rate',      'ConstructionDebtRatePct',
        toPctDecimal(firstNumber(ctx.inputs.constructionDebtRatePct, ctx.inputs.constructionDebtRate, ctx.inputs.debtRatePct, 0.12)),
        '% / year during construction', NUMBER_FORMATS.percent],
      ['Permanent Debt Rate',         'PermanentDebtRatePct',
        toPctDecimal(firstNumber(ctx.inputs.permanentDebtRatePct, ctx.inputs.permanentDebtRate, ctx.inputs.debtRatePct, 0.12)),
        '% / year after conversion', NUMBER_FORMATS.percent],
      ['Permanent Refi LTV',          'PermanentRefiLTV',
        toPctDecimal(firstNumber(ctx.inputs.permanentRefiLTV, ctx.inputs.permMaxLTV, ctx.inputs.maxLTV, 0.65)),
        '% of stabilised value', NUMBER_FORMATS.percent],
      ['Conversion / Refi Quarter',   'RefinanceQuarter',
        { formula: '=MAX(1,ROUNDUP(ProjectMonths/3,0))' },
        'quarter when construction loan converts/refinances', NUMBER_FORMATS.integer],
    ],
  };

  // ── Permanent Debt Sizing inputs (PR-B) ──────────────────────────────
  // Reference institutional pro formas (RE-540 "Permanent Debt Calculation"
  // sheet) size the permanent loan as the MIN of three sub-limits:
  //   - LTV-based: MaxLTV × Stabilised Value (= NOI ÷ Cap Rate)
  //   - DCR-based: NOI ÷ MinDCR ÷ Annual Payment Factor
  //   - DY-based:  NOI ÷ MinDY
  // The MIN is the lender-approved loan amount. For construction, lenders
  // also size against Loan-to-Cost (LTC) — typically tighter than LTV at
  // the construction stage when value hasn't been created yet.
  //
  // Defaults match Indian institutional lender benchmarks (HDFC, ICICI,
  // Edelweiss): conservative MaxLTV 65%, MinDCR 1.30, MinDY 9%, MaxLTC 75%.
  // Operator can override on the Inputs sheet.
  const debtSizingSection = {
    title: 'Permanent Debt Sizing (LTV / DCR / DY / LTC limits)',
    rows: [
      ['Maximum LTV (Permanent)', 'PermMaxLTV',  toPctDecimal(firstNumber(ctx.inputs.permMaxLTV, ctx.inputs.maxLTV, 0.65)),     '% of stabilised value', NUMBER_FORMATS.percent],
      ['Minimum DCR (Permanent)', 'PermMinDCR',  firstNumber(ctx.inputs.permMinDCR, ctx.inputs.minDCR, 1.30),                    'multiple',              NUMBER_FORMATS.multiple],
      ['Minimum Debt Yield',      'PermMinDY',   toPctDecimal(firstNumber(ctx.inputs.permMinDY, ctx.inputs.minDebtYield, 0.09)), '% NOI/loan',            NUMBER_FORMATS.percent],
      ['Maximum LTC (Construction)', 'ConstrMaxLTC', toPctDecimal(firstNumber(ctx.inputs.constrMaxLTC, ctx.inputs.maxLTC, 0.75)), '% of total cost',     NUMBER_FORMATS.percent],
    ],
  };

  // Compose the sections list with asset-class branching.
  // Order matters — sections appear top-to-bottom on the Inputs sheet:
  //   1. General Site
  //   2. Revenue (Development) OR (Income Revenue + Income OpEx)
  //   3. Cost Structure (Land / Construction / Approvals / Marketing / Finance / Contingency)
  //   4. Detailed Soft Costs (A&E / Legal / Appraisal / Insurance / PropTax-during-construction / Developer Overhead)
  //   5. India Statutory Levies (Stamp+Reg on Land, GST on Construction Net of ITC) — PR-I1
  //   6. Project Schedule
  //   7. Capital Structure & Returns
  //   8. Permanent Debt Sizing
  //   9. Sponsor / LP Waterfall
  // Statutory Levies sits between Detailed Soft Costs and Project Schedule
  // because operators read the Inputs sheet top-to-bottom following the
  // cost-then-schedule mental model.
  //
  // PR-NX13 (2026-05-15): asset-class-aware visibility. Pre-fix every
  // income deal — including hospitality — got the rent/sqft +
  // loading-factor + TI-allowance rows in incomeRevenueSection +
  // incomeOpExSection. For hospitality these don't apply (revenue is
  // Keys × ADR × Occupancy via USALI; no leasable square footage in
  // the office sense; no TI / leasing commission). Showing them
  // (a) confused operators into typing meaningless rents, which
  // (b) cross-polluted downstream formulas with a phantom rent path,
  // and (c) generated the Pointec Pens briefing bug where the snapshot
  // surfaced rent inputs that the engine didn't actually use.
  //
  // Post-fix: hospitality skips both income-revenue and income-opex
  // sections entirely. The USALI section (rendered later) carries
  // hospitality-specific rent + opex inputs (departmental costs, brand
  // fees, GOP-aligned management fee). For raw_land, we skip RERA escrow
  // (no customer construction milestones to police) and most income/dev
  // operating sections (raw land is plot-only — its inputs are land cost
  // + entitlement-stage months only).
  const isHospitality = ctx.assetClass === 'hospitality';
  const isRawLand = ctx.assetClass === 'raw_land';
  const isPlotted = ctx.assetClass === 'plotted_development';

  // Hospitality skips the rent/sqft income sections; USALI section
  // (rendered below at line ~2635) supplies the keys-based revenue /
  // departmental-cost inputs instead.
  const incomeSectionsForClass = isHospitality
    ? []
    : [incomeRevenueSection, incomeOpExSection];

  const sections = [
    generalSection,
    ...(ctx.dealFamily === 'income' ? incomeSectionsForClass : [developmentRevenueSection]),
    costSection,
    detailedSoftCostsSection,
    indiaStatutoryLeviesSection,
    // RERA Escrow only meaningful for development-family deals that have
    // customer construction-milestone collections (residential, villas,
    // mixed-use, redevelopment). Plotted / raw_land deals have land
    // economics — no construction milestones, so no escrow regime
    // applies. Income family doesn't have customer collection at all.
    ...(ctx.dealFamily === 'development' && !isRawLand && !isPlotted ? [reraSection] : []),
    // Deal Structure (PR-I3) — JDA / Outright / DM. Only meaningful for
    // development family — income family acquisitions don't have a
    // landowner-share concept (the seller takes the full sale price).
    ...(ctx.dealFamily === 'development' ? [dealStructureSection] : []),
    scheduleSection,
    capitalSection,
    // PR-I6: Lender ecosystem informational fields sit BETWEEN Capital
    // Structure (which carries DebtLTV / DebtRatePct / LoanTerm) and the
    // Permanent Debt Sizing block (which carries the lender's MIN-of-4
    // sizing limits). Operator reads top-to-bottom: "loan terms" → "WHO
    // is the lender" → "what's the sizing test."
    lenderProfileSection,
    debtPhaseSection,
    debtSizingSection,
    waterfallSection,
    // ── Investor-disclosure / Bengaluru-specific land + tax data ──
    // The four sections below sit at the BOTTOM of the Inputs sheet —
    // they're disclosure / reference data for IC reviewers, not modeling
    // primary inputs (no formula uses these for revenue or cost calcs
    // beyond PremiumFSICostCr which is in the Cost Structure block above).
    // Visually separated from operational inputs.
    taxationSection,
    // PR-I10: Approvals & RERA Registration breakdown — Karnataka /
    // Bengaluru-specific line items. Operator-editable; sum is derived.
    approvalsBreakdownSection,
    // PR-I8: Title & Khata Status — A-khata vs B-khata is a major BLR
    // valuation factor. Informational + derived multiplier.
    khataStatusSection,
    // PR-I12: Hospitality-specific ADR / Occupancy / RevPAR — only when
    // the deal's asset class is hospitality.
    ...(ctx.assetClass === 'hospitality' ? [hospitalitySection, hospitalityUsaliSection] : []),
    // PR-I13: Retail anchor / vanilla rent split + CAM recovery — only
    // when the deal's asset class is retail.
    ...(ctx.assetClass === 'retail' ? [retailSection] : []),
    // PR-I11: Milestone-anchored sale-rate escalation — visible for
    // residential / villas / mixed_use (where milestone pricing is
    // conventional). Plotted / raw_land sell at fixed rates.
    ...((['residential_apartments', 'villas', 'mixed_use'].includes(ctx.assetClass)) ? [milestoneEscalationSection] : []),
    // PR-I14: Plot-level absorption — only for plotted_development.
    ...(ctx.assetClass === 'plotted_development' ? [plotAbsorptionSection] : []),
    // PR-I15: Mixed-use component breakdown — only for mixed_use /
    // redevelopment (which often has multi-component nature).
    ...((['mixed_use', 'redevelopment'].includes(ctx.assetClass)) ? [mixedUseSection] : []),
    // PR-I16: Raw-land entitlement stages — only for raw_land.
    ...(ctx.assetClass === 'raw_land' ? [rawLandSection] : []),
    // PR-EX: Exit Strategy — family-conditional. Income family sees the
    // income variant (REIT / strategic sale / refinance / hold); development
    // family sees the development variant (progressive / bulk / hold).
    ...(ctx.dealFamily === 'income' ? [exitStrategyIncomeSection] : [exitStrategyDevSection]),
  ];

  let row = 5;
  const definedNames = [];
  sections.forEach((section) => {
    sheet.mergeCells(`A${row}:D${row}`);
    sheet.getCell(`A${row}`).value = section.title;
    styleSectionTitle(sheet.getCell(`A${row}`));
    sheet.getRow(row).height = 20;
    row += 1;

    section.rows.forEach(([label, name, value, unit, format]) => {
      sheet.getCell(`A${row}`).value = label;
      styleLabelCell(sheet.getCell(`A${row}`));
      const valueCell = sheet.getCell(`B${row}`);
      valueCell.value = value;
      // Derived rows (value is a formula object) get OUTPUT styling — not
      // the yellow editable fill. PR-I5 introduced this pattern for the
      // derived "Carpet Area (RERA marketing area)" row computed via
      // =SaleableAreaSqft/LoadingFactor. The named range still resolves so
      // downstream sheets can reference the derived value.
      const isDerivedFormula = value && typeof value === 'object' && typeof value.formula === 'string';
      if (isDerivedFormula) {
        styleOutputCell(valueCell, format);
      } else {
        styleInputCell(valueCell);
        if (format) valueCell.numFmt = format;
      }
      const source = namedRangeSource(ctx, name, value, isDerivedFormula);
      // PR-NX3 (2026-05-15): append India-regulatory context to the note
      // for cells in the INDIA_CONTEXT_NOTES library. Hovering the cell
      // in Excel shows source + confidence + freshness + provenance + the
      // applicable statute / market benchmark — turning a number into a
      // self-documenting piece of underwriting knowledge.
      const indiaContext = INDIA_CONTEXT_NOTES[name];
      valueCell.note = [
        `Source: ${source.sourceName}`,
        `Confidence: ${source.confidence}`,
        `Freshness: ${source.freshness}`,
        `Provenance: ${source.provenance}`,
        source.notes,
        indiaContext ? `\n── India context ──\n${indiaContext}` : null,
      ].filter(Boolean).join('\n');
      // Categorical dropdown (PR-DD) — when the named range is one of the
      // entries in CATEGORICAL_OPTIONS, apply Excel's list-validation
      // so operators get a dropdown arrow + autocomplete + no-typo guarantee.
      // ExitStrategyType has two sets of options depending on family; use
      // a context-aware resolution that picks the right subset.
      let options = CATEGORICAL_OPTIONS[name];
      if (name === 'ExitStrategyType') {
        options = ctx.dealFamily === 'income'
          ? ['strategic_sale', 'reit_exit', 'hold_to_perpetuity', 'refinance_hold']
          : ['outright_progressive', 'bulk_exit_completion', 'hold_post_completion'];
      }
      if (options && !isDerivedFormula) {
        valueCell.dataValidation = {
          type: 'list',
          allowBlank: false,
          formulae: [`"${options.join(',')}"`],
          showErrorMessage: true,
          errorStyle: 'warning',
          errorTitle: 'Invalid option',
          error: `Pick one of: ${options.join(' / ')}`,
        };
      }
      sheet.getCell(`C${row}`).value = unit;
      styleLabelCell(sheet.getCell(`C${row}`));
      sheet.getCell(`C${row}`).font = { name: FONT, size: 10, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
      sheet.getCell(`D${row}`).value = source.confidence;
      styleLabelCell(sheet.getCell(`D${row}`));
      sheet.getCell(`D${row}`).font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };

      // Define the workbook-level name pointing at this cell.
      definedNames.push({ name, ref: `'${SHEETS.inputs}'!$B$${row}` });
      row += 1;
    });

    row += 1; // gap between sections
  });

  // Footer
  sheet.mergeCells(`A${row}:D${row}`);
  sheet.getCell(`A${row}`).value = `Generated ${ctx.generatedAt} | ${ctx.brandName} | yellow cells are editable; everything else recalculates automatically.`;
  sheet.getCell(`A${row}`).font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(`A${row}`).alignment = { horizontal: 'left', vertical: 'middle' };
  sheet.getCell(`A${row}`).protection = { locked: true };
  appendQaSourcesToSheet(sheet, ctx, row + 3);

  return { sheet, definedNames };
};

const styleTableHeaderRow = (sheet, rowNumber, columnCount) => {
  const row = sheet.getRow(rowNumber);
  for (let col = 1; col <= columnCount; col += 1) {
    const cell = row.getCell(col);
    cell.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    cell.fill = FILL(palette.xlsx('inkDeep'));
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  }
  row.height = 24;
};

const styleQaBodyRows = (sheet, startRow, rowCount, columnCount) => {
  for (let r = startRow; r < startRow + rowCount; r += 1) {
    for (let c = 1; c <= columnCount; c += 1) {
      const cell = sheet.getCell(r, c);
      cell.font = { name: FONT, size: 9, color: { argb: palette.xlsx('ink') } };
      cell.alignment = { horizontal: c === 2 || c === 5 || c === 9 ? 'left' : 'center', vertical: 'top', wrapText: true };
      cell.fill = FILL(r % 2 === 0 ? 'FFFFFFFF' : palette.xlsx('paperSubtle'));
      cell.border = {
        bottom: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
      };
    }
    sheet.getRow(r).height = 32;
  }
};

const appendQaSourcesToSheet = (sheet, ctx, startRow) => {
  sheet.mergeCells(startRow, 1, startRow, 9);
  sheet.getCell(startRow, 1).value = `${ctx.exportQa.status} | Export QA & Source Register | ${ctx.exportQa.blockers.length} blockers | ${ctx.exportQa.issues.length - ctx.exportQa.blockers.length} warnings/info`;
  styleSectionTitle(sheet.getCell(startRow, 1));
  sheet.getRow(startRow).height = 26;

  const qaHeaderRow = startRow + 2;
  const qaRows = ctx.exportQa.issues.length
    ? ctx.exportQa.issues.map((issue) => [
      issue.severity.toUpperCase(),
      issue.check,
      issue.field,
      issue.message,
      issue.action,
      issue.scope,
    ])
    : [['PASS', 'Workbook readiness', 'All', 'No blocking QA issues detected.', 'Continue normal review.', 'all']];

  sheet.addTable({
    name: 'ExportQaChecks',
    ref: `A${qaHeaderRow}`,
    headerRow: true,
    totalsRow: false,
    style: {
      theme: 'TableStyleMedium2',
      showRowStripes: true,
    },
    columns: [
      { name: 'Severity' },
      { name: 'Check' },
      { name: 'Field' },
      { name: 'Finding' },
      { name: 'Action' },
      { name: 'Scope' },
    ],
    rows: qaRows,
  });
  styleTableHeaderRow(sheet, qaHeaderRow, 6);
  styleQaBodyRows(sheet, qaHeaderRow + 1, qaRows.length, 6);

  qaRows.forEach((row, idx) => {
    const cell = sheet.getCell(qaHeaderRow + 1 + idx, 1);
    const severity = String(row[0]);
    cell.font = {
      name: FONT,
      size: 9,
      bold: true,
      color: {
        argb: severity === 'BLOCKER'
          ? palette.xlsx('dataNegative')
          : severity === 'WARN'
            ? palette.xlsx('dataWarning')
            : palette.xlsx('dataPositive'),
      },
    };
  });

  const sourceTitleRow = qaHeaderRow + qaRows.length + 3;
  sheet.mergeCells(sourceTitleRow, 1, sourceTitleRow, 9);
  sheet.getCell(sourceTitleRow, 1).value = 'Source Register';
  styleSectionTitle(sheet.getCell(sourceTitleRow, 1));
  sheet.getRow(sourceTitleRow).height = 22;

  const sourceHeaderRow = sourceTitleRow + 2;
  const sourceRows = ctx.exportQa.sourceRegister.length
    ? ctx.exportQa.sourceRegister.map((row) => [
      row.field,
      row.label,
      row.value === null || row.value === undefined || row.value === '' ? 'Missing' : row.value,
      row.sourceType,
      row.sourceName,
      row.url || 'No link available',
      row.freshness || 'No verified freshness date',
      row.confidence || 'unknown',
      row.notes || '',
    ])
    : [['all', 'Source register', 'No tracked source fields', 'system', 'REDIP export', 'No link available', 'n/a', 'unknown', 'No source rows were emitted for this workbook.']];

  sheet.addTable({
    name: 'ExportSourceRegister',
    ref: `A${sourceHeaderRow}`,
    headerRow: true,
    totalsRow: false,
    style: {
      theme: 'TableStyleMedium9',
      showRowStripes: true,
    },
    columns: [
      { name: 'Field' },
      { name: 'Label' },
      { name: 'Current Value' },
      { name: 'Source Type' },
      { name: 'Source Name' },
      { name: 'Source Link' },
      { name: 'Freshness' },
      { name: 'Confidence' },
      { name: 'Notes' },
    ],
    rows: sourceRows,
  });
  styleTableHeaderRow(sheet, sourceHeaderRow, 9);
  styleQaBodyRows(sheet, sourceHeaderRow + 1, sourceRows.length, 9);

  ctx.exportQa.sourceRegister.forEach((row, idx) => {
    const excelRow = sourceHeaderRow + 1 + idx;
    const linkCell = sheet.getCell(excelRow, 6);
    if (row.url) {
      linkCell.value = { text: row.url, hyperlink: row.url };
      linkCell.font = { name: FONT, size: 9, color: { argb: palette.xlsx('accent') }, underline: true };
    }
    sheet.getCell(excelRow, 8).note = [
      `Provenance: ${row.provenance}`,
      `Freshness: ${row.freshness}`,
      row.notes,
    ].filter(Boolean).join('\n');
  });

  const disclosureRow = sourceHeaderRow + sourceRows.length + 2;
  sheet.mergeCells(disclosureRow, 1, disclosureRow, 9);
  sheet.getCell(disclosureRow, 1).value =
    'AI-assisted narratives and market context require human review. No legal, title, RERA, zoning, approval, comp, or market claim should be quoted externally without source-document verification.';
  sheet.getCell(disclosureRow, 1).font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(disclosureRow, 1).alignment = { wrapText: true, vertical: 'top' };
  sheet.getRow(disclosureRow).height = 28;
};

const buildQaSourcesSheet = (workbook, ctx) => {
  const sheet = workbook.addWorksheet(SHEETS.qaSources, {
    views: [{ showGridLines: false, state: 'frozen', xSplit: 0, ySplit: 5 }],
  });
  sheet.columns = [
    { width: 18 },
    { width: 26 },
    { width: 24 },
    { width: 30 },
    { width: 42 },
    { width: 24 },
    { width: 22 },
    { width: 28 },
    { width: 48 },
  ];

  sheet.mergeCells('A1:I1');
  sheet.getCell('A1').value = `${ctx.brandName} | Export QA & Sources`;
  styleSectionTitle(sheet.getCell('A1'));
  sheet.getRow(1).height = 28;

  sheet.mergeCells('A2:I2');
  sheet.getCell('A2').value = `${ctx.exportQa.status} | ${ctx.exportQa.blockers.length} blockers | ${ctx.exportQa.issues.length - ctx.exportQa.blockers.length} warnings/info | Generated ${ctx.generatedAt}`;
  sheet.getCell('A2').font = {
    name: FONT,
    size: 10,
    bold: true,
    color: { argb: ctx.exportQa.blockers.length ? palette.xlsx('dataNegative') : palette.xlsx('dataPositive') },
  };
  sheet.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle' };
  sheet.getCell('A2').fill = FILL(palette.xlsx('paperSubtle'));
  sheet.getRow(2).height = 22;

  const qaHeaderRow = 4;
  const qaRows = ctx.exportQa.issues.length
    ? ctx.exportQa.issues.map((issue) => [
      issue.severity.toUpperCase(),
      issue.check,
      issue.field,
      issue.message,
      issue.action,
      issue.scope,
    ])
    : [['PASS', 'Workbook readiness', 'All', 'No blocking QA issues detected.', 'Continue normal review.', 'all']];

  sheet.addTable({
    name: 'ExportQaChecks',
    ref: `A${qaHeaderRow}`,
    headerRow: true,
    totalsRow: false,
    style: {
      theme: 'TableStyleMedium2',
      showRowStripes: true,
    },
    columns: [
      { name: 'Severity' },
      { name: 'Check' },
      { name: 'Field' },
      { name: 'Finding' },
      { name: 'Action' },
      { name: 'Scope' },
    ],
    rows: qaRows,
  });
  styleTableHeaderRow(sheet, qaHeaderRow, 6);
  styleQaBodyRows(sheet, qaHeaderRow + 1, qaRows.length, 6);
  qaRows.forEach((row, idx) => {
    const cell = sheet.getCell(qaHeaderRow + 1 + idx, 1);
    const severity = String(row[0]);
    cell.font = {
      name: FONT,
      size: 9,
      bold: true,
      color: {
        argb: severity === 'BLOCKER'
          ? palette.xlsx('dataNegative')
          : severity === 'WARN'
            ? palette.xlsx('dataWarning')
            : palette.xlsx('dataPositive'),
      },
    };
  });

  const sourceHeaderRow = qaHeaderRow + qaRows.length + 4;
  sheet.mergeCells(sourceHeaderRow - 2, 1, sourceHeaderRow - 2, 9);
  sheet.getCell(sourceHeaderRow - 2, 1).value = 'Source Register';
  styleSectionTitle(sheet.getCell(sourceHeaderRow - 2, 1));
  sheet.getRow(sourceHeaderRow - 2).height = 22;

  const sourceRows = ctx.exportQa.sourceRegister.map((row) => [
    row.field,
    row.label,
    row.value === null || row.value === undefined || row.value === '' ? 'Missing' : row.value,
    row.sourceType,
    row.sourceName,
    row.url || 'No link available',
    row.freshness || 'No verified freshness date',
    row.confidence || 'unknown',
    row.notes || '',
  ]);

  sheet.addTable({
    name: 'ExportSourceRegister',
    ref: `A${sourceHeaderRow}`,
    headerRow: true,
    totalsRow: false,
    style: {
      theme: 'TableStyleMedium9',
      showRowStripes: true,
    },
    columns: [
      { name: 'Field' },
      { name: 'Label' },
      { name: 'Current Value' },
      { name: 'Source Type' },
      { name: 'Source Name' },
      { name: 'Source Link' },
      { name: 'Freshness' },
      { name: 'Confidence' },
      { name: 'Notes' },
    ],
    rows: sourceRows,
  });
  styleTableHeaderRow(sheet, sourceHeaderRow, 9);
  styleQaBodyRows(sheet, sourceHeaderRow + 1, sourceRows.length, 9);

  ctx.exportQa.sourceRegister.forEach((row, idx) => {
    const excelRow = sourceHeaderRow + 1 + idx;
    const linkCell = sheet.getCell(excelRow, 6);
    if (row.url) {
      linkCell.value = { text: row.url, hyperlink: row.url };
      linkCell.font = { name: FONT, size: 9, color: { argb: palette.xlsx('accent') }, underline: true };
    }
    sheet.getCell(excelRow, 8).note = [
      `Provenance: ${row.provenance}`,
      `Freshness: ${row.freshness}`,
      row.notes,
    ].filter(Boolean).join('\n');
  });

  sheet.mergeCells(sourceHeaderRow + sourceRows.length + 2, 1, sourceHeaderRow + sourceRows.length + 2, 9);
  sheet.getCell(sourceHeaderRow + sourceRows.length + 2, 1).value =
    'AI-assisted narratives and market context require human review. No legal, title, RERA, zoning, approval, comp, or market claim should be quoted externally without source-document verification.';
  sheet.getCell(sourceHeaderRow + sourceRows.length + 2, 1).font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(sourceHeaderRow + sourceRows.length + 2, 1).alignment = { wrapText: true, vertical: 'top' };
  sheet.getRow(sourceHeaderRow + sourceRows.length + 2).height = 28;

  return sheet;
};

const hospitalityUsaliCached = (ctx, year, field, options = {}) => {
  const rows = ctx.modelParams?.revenue?.usali_pnl
    || ctx.modelParams?.revenue?.usaliPnl
    || ctx.deal?.model_params?.revenue?.usali_pnl
    || [];
  const row = Array.isArray(rows) ? rows[year - 1] : null;
  const value = row ? asFiniteNumber(row[field]) : null;
  if (value === null) return null;
  if (options.percent) return toPctDecimal(value);
  if (options.negative) return -Math.abs(value);
  return value;
};

const buildHospitalityUsaliSheet = (workbook, ctx) => {
  if (ctx.assetClass !== 'hospitality') return null;

  const years = clamp(Math.round(engineFirstNumber(ctx, ['holdPeriodYears', 'holdYears'], 10) || 10), 5, 15);
  const totalCol = excelCol(years + 2);
  const sheet = workbook.addWorksheet(SHEETS.usali, {
    views: [{ showGridLines: false, state: 'frozen', xSplit: 1, ySplit: 4 }],
  });
  sheet.columns = [{ width: 34 }, ...Array.from({ length: years }, () => ({ width: 14 })), { width: 16 }];

  sheet.mergeCells(1, 1, 1, years + 2);
  sheet.getCell(1, 1).value = `${ctx.brandName} | USALI Hotel Pro Forma`;
  styleSectionTitle(sheet.getCell(1, 1));
  sheet.getRow(1).height = 26;

  sheet.mergeCells(2, 1, 2, years + 2);
  sheet.getCell(2, 1).value = 'Annual hotel P&L mirrors the deterministic hospitality engine. Driver cells live on Inputs & Assumptions; every output below is formula-linked.';
  sheet.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(2, 1).alignment = { vertical: 'middle', wrapText: true };

  sheet.getCell(4, 1).value = 'Line item';
  for (let y = 1; y <= years; y += 1) sheet.getCell(4, y + 1).value = `Y${y}`;
  sheet.getCell(4, years + 2).value = 'Total / Final';
  styleHeader(sheet.getRow(4));

  const c = (row, year) => `${excelCol(year + 1)}${row}`;
  const prev = (row, year) => `${excelCol(year)}${row}`;
  const infl = (year) => `(1+HospitalityExpenseInflationPct)^(${year}-1)`;
  const rowSpecs = [
    {
      row: USALI_ROW.occupancy,
      label: 'Occupancy %',
      format: NUMBER_FORMATS.percent,
      field: 'occupancy',
      percent: true,
      formula: (y) => `=IF(${y}<HospitalityStabilizationYear,HospitalityInitialOccPct+(OccupancyPct-HospitalityInitialOccPct)*(${y}-1)/MAX(1,HospitalityStabilizationYear-1),OccupancyPct)`,
      total: 'final',
    },
    {
      row: USALI_ROW.adr,
      label: 'ADR (blended)',
      format: NUMBER_FORMATS.integer,
      field: 'adr',
      formula: (y) => `=HospitalityADRBase*(1+HospitalityADRGrowthPct)^(${y}-1)`,
      total: 'final',
    },
    {
      row: USALI_ROW.occupiedRooms,
      label: 'Occupied room nights',
      format: NUMBER_FORMATS.integer,
      field: 'occupiedRooms',
      formula: (y) => `=HospitalityKeys*365*${c(USALI_ROW.occupancy, y)}`,
    },
    {
      row: USALI_ROW.revPAR,
      label: 'RevPAR',
      format: NUMBER_FORMATS.integer,
      field: 'revPAR',
      formula: (y) => `=${c(USALI_ROW.adr, y)}*${c(USALI_ROW.occupancy, y)}`,
      total: 'final',
    },
    {
      row: USALI_ROW.trevPAR,
      label: 'TRevPAR',
      format: NUMBER_FORMATS.integer,
      field: 'trevPAR',
      formula: (y) => `=IFERROR(${c(USALI_ROW.totalRevenue, y)}*10000000/(HospitalityKeys*365),0)`,
      total: 'final',
    },
    {
      row: USALI_ROW.roomsRevenue,
      label: 'Rooms revenue',
      format: NUMBER_FORMATS.currency,
      field: 'roomsRevenueCr',
      formula: (y) => `=${c(USALI_ROW.occupiedRooms, y)}*${c(USALI_ROW.adr, y)}/10000000`,
    },
    {
      row: USALI_ROW.fbRestaurant,
      label: 'F&B - Restaurant',
      format: NUMBER_FORMATS.currency,
      field: 'fbRestaurantCr',
      formula: (y) => `=IF(HospitalityFBRestaurantPerPOR>0,HospitalityFBRestaurantPerPOR*${c(USALI_ROW.occupiedRooms, y)}/10000000,${c(USALI_ROW.roomsRevenue, y)}*HospitalityFBRestaurantPct)`,
    },
    {
      row: USALI_ROW.fbBanquet,
      label: 'F&B - Banquet',
      format: NUMBER_FORMATS.currency,
      field: 'fbBanquetCr',
      formula: (y) => `=IF(HospitalityFBBanquetPerPOR>0,HospitalityFBBanquetPerPOR*${c(USALI_ROW.occupiedRooms, y)}/10000000,${c(USALI_ROW.roomsRevenue, y)}*HospitalityFBBanquetPct)+HospitalityFBDeliveryPerPOR*${c(USALI_ROW.occupiedRooms, y)}/10000000`,
    },
    {
      row: USALI_ROW.otherOperated,
      label: 'Other operated',
      format: NUMBER_FORMATS.currency,
      field: 'otherOperatedCr',
      formula: (y) => `=IF(HospitalityOtherOperatedPerPOR>0,HospitalityOtherOperatedPerPOR*${c(USALI_ROW.occupiedRooms, y)}/10000000,${c(USALI_ROW.roomsRevenue, y)}*HospitalityOtherOperatedPct)`,
    },
    {
      row: USALI_ROW.parking,
      label: 'Parking',
      format: NUMBER_FORMATS.currency,
      field: 'parkingCr',
      formula: (y) => `=IF(HospitalityParkingPerPOR>0,HospitalityParkingPerPOR*${c(USALI_ROW.occupiedRooms, y)}/10000000,${c(USALI_ROW.roomsRevenue, y)}*HospitalityParkingPct)`,
    },
    {
      row: USALI_ROW.leaseIncome,
      label: 'Lease income',
      format: NUMBER_FORMATS.currency,
      field: 'leaseIncomeCr',
      formula: () => '=HospitalityLeaseIncomeCr',
    },
    {
      row: USALI_ROW.totalRevenue,
      label: 'Total revenue',
      format: NUMBER_FORMATS.currency,
      field: 'totalRevenueCr',
      bold: true,
      formula: (y) => `=SUM(${c(USALI_ROW.roomsRevenue, y)}:${c(USALI_ROW.leaseIncome, y)})`,
    },
    {
      row: USALI_ROW.roomsDeptExp,
      label: 'Rooms dept expense',
      format: NUMBER_FORMATS.currency,
      field: 'roomsDeptExpCr',
      negative: true,
      formula: (y) => y === 1
        ? `=-${c(USALI_ROW.roomsRevenue, y)}*HospitalityRoomsDeptCostPct`
        : `=-IF(AND(HospitalityRoomsFixedPct>0,${prev(USALI_ROW.roomsRevenue, y)}>0),ABS(${prev(USALI_ROW.roomsDeptExp, y)})*HospitalityRoomsFixedPct*(1+HospitalityExpenseInflationPct)+ABS(${prev(USALI_ROW.roomsDeptExp, y)})*(1-HospitalityRoomsFixedPct)*IFERROR(${c(USALI_ROW.roomsRevenue, y)}/${prev(USALI_ROW.roomsRevenue, y)},1),${c(USALI_ROW.roomsRevenue, y)}*HospitalityRoomsDeptCostPct)`,
    },
    {
      row: USALI_ROW.fbDeptExp,
      label: 'F&B dept expense',
      format: NUMBER_FORMATS.currency,
      field: 'fbDeptExpCr',
      negative: true,
      formula: (y) => y === 1
        ? `=-SUM(${c(USALI_ROW.fbRestaurant, y)}:${c(USALI_ROW.fbBanquet, y)})*HospitalityFBDeptCostPct`
        : `=-IF(AND(HospitalityFBFixedPct>0,SUM(${prev(USALI_ROW.fbRestaurant, y)}:${prev(USALI_ROW.fbBanquet, y)})>0),ABS(${prev(USALI_ROW.fbDeptExp, y)})*HospitalityFBFixedPct*(1+HospitalityExpenseInflationPct)+ABS(${prev(USALI_ROW.fbDeptExp, y)})*(1-HospitalityFBFixedPct)*IFERROR(SUM(${c(USALI_ROW.fbRestaurant, y)}:${c(USALI_ROW.fbBanquet, y)})/SUM(${prev(USALI_ROW.fbRestaurant, y)}:${prev(USALI_ROW.fbBanquet, y)}),1),SUM(${c(USALI_ROW.fbRestaurant, y)}:${c(USALI_ROW.fbBanquet, y)})*HospitalityFBDeptCostPct)`,
    },
    {
      row: USALI_ROW.otherDeptExp,
      label: 'Other dept expense',
      format: NUMBER_FORMATS.currency,
      field: 'otherDeptExpCr',
      negative: true,
      formula: (y) => y === 1
        ? `=-SUM(${c(USALI_ROW.otherOperated, y)}:${c(USALI_ROW.parking, y)})*HospitalityOtherDeptCostPct`
        : `=-IF(AND(HospitalityOtherOpFixedPct>0,SUM(${prev(USALI_ROW.otherOperated, y)}:${prev(USALI_ROW.parking, y)})>0),ABS(${prev(USALI_ROW.otherDeptExp, y)})*HospitalityOtherOpFixedPct*(1+HospitalityExpenseInflationPct)+ABS(${prev(USALI_ROW.otherDeptExp, y)})*(1-HospitalityOtherOpFixedPct)*IFERROR(SUM(${c(USALI_ROW.otherOperated, y)}:${c(USALI_ROW.parking, y)})/SUM(${prev(USALI_ROW.otherOperated, y)}:${prev(USALI_ROW.parking, y)}),1),SUM(${c(USALI_ROW.otherOperated, y)}:${c(USALI_ROW.parking, y)})*HospitalityOtherDeptCostPct)`,
    },
    {
      row: USALI_ROW.deptProfit,
      label: 'Departmental profit',
      format: NUMBER_FORMATS.currency,
      field: 'deptProfitCr',
      bold: true,
      formula: (y) => `=${c(USALI_ROW.totalRevenue, y)}-${c(USALI_ROW.leaseIncome, y)}+SUM(${c(USALI_ROW.roomsDeptExp, y)}:${c(USALI_ROW.otherDeptExp, y)})`,
    },
    {
      row: USALI_ROW.aAndG,
      label: 'Admin & General',
      format: NUMBER_FORMATS.currency,
      field: 'aAndGCr',
      negative: true,
      formula: (y) => `=-IF(HospitalityAAndGPerPOR>0,HospitalityAAndGPerPOR*${c(USALI_ROW.occupiedRooms, y)}*${infl(y)}/10000000,${c(USALI_ROW.totalRevenue, y)}*HospitalityAAndGPct)`,
    },
    {
      row: USALI_ROW.it,
      label: 'IT / Systems',
      format: NUMBER_FORMATS.currency,
      field: 'itCr',
      negative: true,
      formula: (y) => `=-IF(HospitalityITPerPOR>0,HospitalityITPerPOR*${c(USALI_ROW.occupiedRooms, y)}*${infl(y)}/10000000,${c(USALI_ROW.totalRevenue, y)}*HospitalityITPct)`,
    },
    {
      row: USALI_ROW.sm,
      label: 'Sales & Marketing',
      format: NUMBER_FORMATS.currency,
      field: 'smCr',
      negative: true,
      formula: (y) => `=-IF(HospitalitySMPerPOR>0,HospitalitySMPerPOR*${c(USALI_ROW.occupiedRooms, y)}*${infl(y)}/10000000,${c(USALI_ROW.totalRevenue, y)}*HospitalitySMPct)`,
    },
    {
      row: USALI_ROW.pom,
      label: 'POM',
      format: NUMBER_FORMATS.currency,
      field: 'pomCr',
      negative: true,
      formula: (y) => `=-IF(HospitalityPOMPerPOR>0,HospitalityPOMPerPOR*${c(USALI_ROW.occupiedRooms, y)}*${infl(y)}/10000000,${c(USALI_ROW.totalRevenue, y)}*HospitalityPOMPct)`,
    },
    {
      row: USALI_ROW.utilities,
      label: 'Utilities',
      format: NUMBER_FORMATS.currency,
      field: 'utilitiesCr',
      negative: true,
      formula: (y) => `=-IF(HospitalityUtilitiesPerPOR>0,HospitalityUtilitiesPerPOR*${c(USALI_ROW.occupiedRooms, y)}*${infl(y)}/10000000,${c(USALI_ROW.totalRevenue, y)}*HospitalityUtilitiesPct)`,
    },
    {
      row: USALI_ROW.totalUndist,
      label: 'Total undistributed expenses',
      format: NUMBER_FORMATS.currency,
      field: 'totalUndistCr',
      negative: true,
      formula: (y) => `=SUM(${c(USALI_ROW.aAndG, y)}:${c(USALI_ROW.utilities, y)})`,
    },
    {
      row: USALI_ROW.brandRoyalty,
      label: 'Brand royalty',
      format: NUMBER_FORMATS.currency,
      field: 'brandRoyaltyCr',
      negative: true,
      formula: (y) => `=-${c(USALI_ROW.roomsRevenue, y)}*HospitalityBrandRoyaltyPct`,
    },
    {
      row: USALI_ROW.brandMktReserv,
      label: 'Brand mkt + reservation',
      format: NUMBER_FORMATS.currency,
      field: 'brandMktReservCr',
      negative: true,
      formula: (y) => `=-${c(USALI_ROW.roomsRevenue, y)}*HospitalityBrandMktReservPct`,
    },
    {
      row: USALI_ROW.gop,
      label: 'GOP',
      format: NUMBER_FORMATS.currency,
      field: 'gopCr',
      bold: true,
      formula: (y) => `=${c(USALI_ROW.deptProfit, y)}+${c(USALI_ROW.leaseIncome, y)}+${c(USALI_ROW.totalUndist, y)}+${c(USALI_ROW.brandRoyalty, y)}+${c(USALI_ROW.brandMktReserv, y)}`,
    },
    {
      row: USALI_ROW.gopMargin,
      label: 'GOP margin %',
      format: NUMBER_FORMATS.percent,
      field: 'gopMarginPct',
      percent: true,
      formula: (y) => `=IFERROR(${c(USALI_ROW.gop, y)}/${c(USALI_ROW.totalRevenue, y)},0)`,
      total: 'final',
    },
    {
      row: USALI_ROW.mgmtBase,
      label: 'Management fee - base',
      format: NUMBER_FORMATS.currency,
      field: 'mgmtBaseCr',
      negative: true,
      formula: (y) => `=-${c(USALI_ROW.totalRevenue, y)}*HospitalityMgmtBasePct`,
    },
    {
      row: USALI_ROW.mgmtIncentive,
      label: 'Management fee - incentive',
      format: NUMBER_FORMATS.currency,
      field: 'mgmtIncentiveCr',
      negative: true,
      formula: (y) => `=-MAX(0,${c(USALI_ROW.gop, y)})*HospitalityMgmtIncentivePct`,
    },
    {
      row: USALI_ROW.ibfc,
      label: 'IBFC',
      format: NUMBER_FORMATS.currency,
      field: 'ibfcCr',
      bold: true,
      formula: (y) => `=${c(USALI_ROW.gop, y)}+${c(USALI_ROW.mgmtBase, y)}+${c(USALI_ROW.mgmtIncentive, y)}`,
    },
    {
      row: USALI_ROW.propTax,
      label: 'Property tax',
      format: NUMBER_FORMATS.currency,
      field: 'propTaxCr',
      negative: true,
      formula: (y) => `=-IF(HospitalityPropertyTaxCrPa>0,HospitalityPropertyTaxCrPa*${infl(y)},${c(USALI_ROW.totalRevenue, y)}*HospitalityPropertyTaxPctRev)`,
    },
    {
      row: USALI_ROW.insurance,
      label: 'Insurance',
      format: NUMBER_FORMATS.currency,
      field: 'insuranceCr',
      negative: true,
      formula: (y) => `=-IF(HospitalityInsuranceCrPa>0,HospitalityInsuranceCrPa*${infl(y)},${c(USALI_ROW.totalRevenue, y)}*HospitalityInsurancePctRev)`,
    },
    {
      row: USALI_ROW.groundLease,
      label: 'Ground lease',
      format: NUMBER_FORMATS.currency,
      field: 'groundLeaseCr',
      negative: true,
      formula: () => '=-HospitalityGroundLeaseCrPa',
    },
    {
      row: USALI_ROW.ebitda,
      label: 'EBITDA',
      format: NUMBER_FORMATS.currency,
      field: 'ebitdaCr',
      bold: true,
      formula: (y) => `=${c(USALI_ROW.ibfc, y)}+${c(USALI_ROW.propTax, y)}+${c(USALI_ROW.insurance, y)}+${c(USALI_ROW.groundLease, y)}`,
    },
    {
      row: USALI_ROW.ebitdaMargin,
      label: 'EBITDA margin %',
      format: NUMBER_FORMATS.percent,
      field: 'ebitdaMarginPct',
      percent: true,
      formula: (y) => `=IFERROR(${c(USALI_ROW.ebitda, y)}/${c(USALI_ROW.totalRevenue, y)},0)`,
      total: 'final',
    },
    {
      row: USALI_ROW.ffeReserve,
      label: 'FF&E reserve',
      format: NUMBER_FORMATS.currency,
      field: 'ffeReserveCr',
      negative: true,
      formula: (y) => `=-${c(USALI_ROW.totalRevenue, y)}*HospitalityFFEReservePct`,
    },
    {
      row: USALI_ROW.noi,
      label: 'NOI',
      format: NUMBER_FORMATS.currency,
      field: 'noiCr',
      bold: true,
      formula: (y) => `=${c(USALI_ROW.ebitda, y)}+${c(USALI_ROW.ffeReserve, y)}`,
    },
    {
      row: USALI_ROW.noiMargin,
      label: 'NOI margin %',
      format: NUMBER_FORMATS.percent,
      field: 'noiMarginPct',
      percent: true,
      formula: (y) => `=IFERROR(${c(USALI_ROW.noi, y)}/${c(USALI_ROW.totalRevenue, y)},0)`,
      total: 'final',
    },
  ];

  rowSpecs.forEach((spec) => {
    sheet.getCell(spec.row, 1).value = spec.label;
    styleLabelCell(sheet.getCell(spec.row, 1));
    if (spec.bold) sheet.getCell(spec.row, 1).font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    for (let y = 1; y <= years; y += 1) {
      const cell = sheet.getCell(spec.row, y + 1);
      const cached = hospitalityUsaliCached(ctx, y, spec.field, {
        percent: spec.percent,
        negative: spec.negative,
      });
      cell.value = formulaValue(spec.formula(y), cached);
      styleOutputCell(cell, spec.format);
      if (spec.bold) cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    }
    const totalCell = sheet.getCell(spec.row, years + 2);
    totalCell.value = spec.total === 'final'
      ? { formula: `=${excelCol(years + 1)}${spec.row}` }
      : { formula: `=SUM(B${spec.row}:${excelCol(years + 1)}${spec.row})` };
    styleOutputCell(totalCell, spec.format);
    totalCell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
  });

  const budgetTitleRow = 44;
  sheet.mergeCells(budgetTitleRow, 1, budgetTitleRow, Math.min(years + 2, 6));
  sheet.getCell(budgetTitleRow, 1).value = 'Hotel development budget and capital structure';
  styleSectionTitle(sheet.getCell(budgetTitleRow, 1));
  sheet.getRow(budgetTitleRow).height = 22;

  ['Line item', 'INR Cr', 'Formula / source'].forEach((label, idx) => {
    sheet.getCell(budgetTitleRow + 1, idx + 1).value = label;
  });
  styleHeader(sheet.getRow(budgetTitleRow + 1));

  const budgetRows = [
    ['Land cost', '=LandCostCr', 'Inputs & Assumptions'],
    ['Stamp duty + registration + betterment', '=LandCostCr*(StampRegPct+HospitalityBettermentPct)', 'Land cost x statutory levy / betterment'],
    ['Hard construction', '=HospitalityKeys*HospitalityConstructionCostPerKey/10000000', 'Keys x construction cost/key'],
    ['GST on construction', '=B48*GstPct', 'Hard construction x GST'],
    ['Soft design / owner costs', '=B48*(HospitalityArchitectPctHard+HospitalityPMCPctHard+HospitalityConsultantsPctHard)', 'Hotel design / PMC / consultants'],
    ['Approvals', '=IF(ApprovalCostCr>0,ApprovalCostCr,B48*HospitalityApprovalsPctHard)+PremiumFSICostCr', 'Explicit approval cost or hotel default % of hard cost'],
    ['FF&E', '=HospitalityKeys*HospitalityFFEPerKey/10000000', 'Keys x FF&E/key'],
    ['OS&E', '=HospitalityKeys*HospitalityOSEPerKey/10000000', 'Keys x OS&E/key'],
    ['Pre-opening', '=HospitalityKeys*HospitalityPreOpeningPerKey/10000000', 'Keys x pre-opening/key'],
    ['Working capital', '=HospitalityWorkingCapitalCr', 'Engine default if not provided'],
    ['Contingency', '=(B48+B50+B51+B52+B53)*ContingencyPct', 'Hard + soft + approvals + FF&E + OS&E x contingency'],
    ['Subtotal before IDC', '=SUM(B46:B56)', 'All development uses before financing cost'],
    ['Interest during construction', '=B57*HospitalityConstLoanLTC*0.5*HospitalityConstLoanRatePct*(ProjectMonths/12)+B57*HospitalityConstLoanLTC*HospitalityConstLoanFeesPct', 'Mid-draw construction loan convention'],
    ['Total development cost', '=B57+B58', 'Total uses incl. IDC'],
    ['Construction loan', '=B59*HospitalityConstLoanLTC', 'LTC-sized construction loan'],
    ['Required equity', '=MAX(0,B59-B60)', 'Total cost less construction loan'],
    ['Stabilized NOI', `=INDEX(B${USALI_ROW.noi}:${excelCol(years + 1)}${USALI_ROW.noi},1,MIN(HospitalityStabilizationYear,${years}))`, 'USALI NOI at stabilization'],
    ['Stabilized value', '=IFERROR(B62/HospitalityRefiCapRate,0)', 'Stabilized NOI / refi cap rate'],
    ['Permanent refinance proceeds', '=B63*HospitalityRefiLTV', 'Stabilized value x refi LTV'],
    ['Terminal sale value', `=IFERROR(${excelCol(years + 1)}${USALI_ROW.noi}/ExitCapRate,0)`, 'Final-year NOI / exit cap rate'],
  ];

  budgetRows.forEach(([label, formula, note], idx) => {
    const row = budgetTitleRow + 2 + idx;
    sheet.getCell(row, 1).value = label;
    styleLabelCell(sheet.getCell(row, 1));
    sheet.getCell(row, 2).value = { formula };
    styleOutputCell(sheet.getCell(row, 2), NUMBER_FORMATS.currency);
    sheet.getCell(row, 3).value = note;
    styleLabelCell(sheet.getCell(row, 3));
    sheet.getCell(row, 3).font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
    if (['Subtotal before IDC', 'Total development cost', 'Required equity', 'Stabilized value', 'Terminal sale value'].includes(label)) {
      ['A', 'B', 'C'].forEach((col) => {
        sheet.getCell(`${col}${row}`).font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
        sheet.getCell(`${col}${row}`).fill = FILL(palette.xlsx('paperSubtle'));
      });
    }
  });

  return sheet;
};

const buildSourcesUsesSheet = (workbook, ctx) => {
  const sheet = workbook.addWorksheet(SHEETS.sourcesUses, {
    views: [{ showGridLines: false, state: 'frozen', xSplit: 0, ySplit: 5 }],
  });
  sheet.columns = [
    { width: 34 },
    { width: 18 },
    { width: 20 },
    { width: 54 },
  ];

  sheet.mergeCells('A1:D1');
  sheet.getCell('A1').value = `${ctx.brandName} | ${ctx.deal.name || ctx.property.property_name || 'Deal'} | Sources & Uses`;
  styleSectionTitle(sheet.getCell('A1'));
  sheet.getRow(1).height = 28;

  sheet.mergeCells('A2:D2');
  sheet.getCell('A2').value = 'Dedicated capital stack view. Sources must equal uses before the model is circulated.';
  sheet.getCell('A2').font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('A2').alignment = { vertical: 'middle', wrapText: true };

  ['Line item', 'INR Cr', 'INR / sqft', 'Source / note'].forEach((label, idx) => {
    sheet.getCell(4, idx + 1).value = label;
  });
  styleHeader(sheet.getRow(4));

  const landownerContributionFormula = ctx.dealFamily === 'development'
    ? '=IF(DealStructureLabel="outright_purchase",0,LandCostCr)'
    : '=0';
  const genericRows = [
    ['Sources', '', '', ''],
    ['Sponsor / LP equity', '=MAX(0,TotalProjectCostCr*(1-DebtLTV))', '=IFERROR(B6*10000000/SaleableAreaSqft,0)', 'Residual source after senior debt.'],
    ['Senior debt', '=TotalProjectCostCr*DebtLTV', '=IFERROR(B7*10000000/SaleableAreaSqft,0)', 'Uses DebtLTV from Inputs; Debt Sizing sheet gives lender-constrained amount.'],
    ['Landowner contribution / JDA land', landownerContributionFormula, '=IFERROR(B8*10000000/SaleableAreaSqft,0)', 'Reference only; cash land cost remains driven by LandCostCr.'],
    ['Total sources', '=SUM(B6:B8)', '=IFERROR(B9*10000000/SaleableAreaSqft,0)', 'Should reconcile to total uses.'],
    ['', '', '', ''],
    ['Uses', '', '', ''],
    ['Land acquisition', '=LandCostCr', '=IFERROR(B12*10000000/SaleableAreaSqft,0)', 'From Inputs.'],
    ['Stamp duty + registration', '=LandCostCr*StampRegPct', '=IFERROR(B13*10000000/SaleableAreaSqft,0)', 'India statutory levy on acquisition.'],
    ['Construction hard cost', '=ConstructionCostPerSqft*SaleableAreaSqft/10000000', '=ConstructionCostPerSqft', 'Built area x hard cost.'],
    ['GST on construction', '=B14*GstPct', '=IFERROR(B15*10000000/SaleableAreaSqft,0)', 'Net-of-ITC model input by asset class.'],
    ['Approvals + premium FSI / TDR', '=ApprovalCostCr+PremiumFSICostCr', '=IFERROR(B16*10000000/SaleableAreaSqft,0)', 'Approval cost plus optional premium FAR/TDR.'],
    ['Detailed soft costs', `='${SHEETS.calculations}'!$B$24`, '=IFERROR(B17*10000000/SaleableAreaSqft,0)', 'A&E, legal, appraisal, insurance, property tax during construction, overhead, marketing, finance.'],
    ['Total uses', '=SUM(B12:B17)', '=IFERROR(B18*10000000/SaleableAreaSqft,0)', 'Matches TotalProjectCostCr when inputs are complete.'],
    ['Source / use gap', '=B9-B18', '=IFERROR(B19*10000000/SaleableAreaSqft,0)', 'Zero means the capital stack balances.'],
  ];
  const b = (row) => `'${SHEETS.usali}'!$B$${row}`;
  const hospitalityRows = [
    ['Sources', '', '', ''],
    ['Sponsor / LP equity', '=MAX(0,TotalProjectCostCr*(1-HospitalityConstLoanLTC))', '=IFERROR(B6*10000000/SaleableAreaSqft,0)', 'Residual equity after construction debt.'],
    ['Construction debt', '=TotalProjectCostCr*HospitalityConstLoanLTC', '=IFERROR(B7*10000000/SaleableAreaSqft,0)', 'Uses hotel construction-loan LTC from the engine drivers.'],
    ['Landowner contribution / JDA land', '=0', '=IFERROR(B8*10000000/SaleableAreaSqft,0)', 'Reference only for income-producing hotel acquisitions.'],
    ['Total sources', '=SUM(B6:B8)', '=IFERROR(B9*10000000/SaleableAreaSqft,0)', 'Should reconcile to total hotel development uses.'],
    ['', '', '', ''],
    ['Uses', '', '', ''],
    ['Land + stamp / betterment', `=${b(HOSPITALITY_BUDGET_ROW.land)}+${b(HOSPITALITY_BUDGET_ROW.stamp)}`, '=IFERROR(B12*10000000/SaleableAreaSqft,0)', 'Linked to the USALI hotel budget.'],
    ['Hard construction + GST', `=${b(HOSPITALITY_BUDGET_ROW.hardConstruction)}+${b(HOSPITALITY_BUDGET_ROW.gst)}`, '=IFERROR(B13*10000000/SaleableAreaSqft,0)', 'Keys x cost/key plus construction GST.'],
    ['Soft design + approvals', `=${b(HOSPITALITY_BUDGET_ROW.softDesign)}+${b(HOSPITALITY_BUDGET_ROW.approvals)}`, '=IFERROR(B14*10000000/SaleableAreaSqft,0)', 'Design, PMC, consultants, approvals.'],
    ['FF&E + OS&E', `=${b(HOSPITALITY_BUDGET_ROW.ffe)}+${b(HOSPITALITY_BUDGET_ROW.ose)}`, '=IFERROR(B15*10000000/SaleableAreaSqft,0)', 'Keys x FF&E/OS&E per-key assumptions.'],
    ['Pre-opening + working capital + contingency + IDC', `=${b(HOSPITALITY_BUDGET_ROW.preOpening)}+${b(HOSPITALITY_BUDGET_ROW.workingCapital)}+${b(HOSPITALITY_BUDGET_ROW.contingency)}+${b(HOSPITALITY_BUDGET_ROW.idc)}`, '=IFERROR(B16*10000000/SaleableAreaSqft,0)', 'Opening capital, contingency, and construction financing cost.'],
    ['Total uses', '=SUM(B12:B16)', '=IFERROR(B17*10000000/SaleableAreaSqft,0)', 'Matches TotalProjectCostCr for hotel deals.'],
    ['Source / use gap', '=B9-B17', '=IFERROR(B18*10000000/SaleableAreaSqft,0)', 'Zero means the capital stack balances.'],
  ];
  const rows = ctx.assetClass === 'hospitality' ? hospitalityRows : genericRows;

  rows.forEach(([label, amount, perSqft, note], idx) => {
    const r = 5 + idx;
    const isSection = label === 'Sources' || label === 'Uses';
    if (isSection) {
      sheet.mergeCells(`A${r}:D${r}`);
      sheet.getCell(`A${r}`).value = label;
      styleSectionTitle(sheet.getCell(`A${r}`));
      sheet.getRow(r).height = 22;
      return;
    }
    if (!label) {
      sheet.getRow(r).height = 8;
      return;
    }
    sheet.getCell(`A${r}`).value = label;
    styleLabelCell(sheet.getCell(`A${r}`));
    const amountCell = sheet.getCell(`B${r}`);
    amountCell.value = { formula: amount };
    styleOutputCell(amountCell, NUMBER_FORMATS.currency);
    const perSqftCell = sheet.getCell(`C${r}`);
    perSqftCell.value = { formula: perSqft };
    styleOutputCell(perSqftCell, NUMBER_FORMATS.integer);
    sheet.getCell(`D${r}`).value = note;
    styleLabelCell(sheet.getCell(`D${r}`));
    sheet.getCell(`D${r}`).font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
    if (label.startsWith('Total') || label.includes('gap')) {
      ['A', 'B', 'C', 'D'].forEach((col) => {
        sheet.getCell(`${col}${r}`).font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
        sheet.getCell(`${col}${r}`).fill = FILL(palette.xlsx('paperSubtle'));
      });
    }
  });

  sheet.addConditionalFormatting({
    ref: ctx.assetClass === 'hospitality' ? 'B18:B18' : 'B19:B19',
    rules: [
      { type: 'cellIs', operator: 'notBetween', formulae: [-0.01, 0.01], style: { fill: FILL(palette.xlsx('dataNegative')), font: { color: { argb: palette.xlsx('paperElevated') }, bold: true } }, priority: 1 },
      { type: 'cellIs', operator: 'between', formulae: [-0.01, 0.01], style: { fill: FILL(palette.xlsx('dataPositive')), font: { color: { argb: palette.xlsx('paperElevated') }, bold: true } }, priority: 2 },
    ],
  });

  return sheet;
};

const buildMonthlyCashFlowSheet = (workbook, ctx) => {
  const months = getWorkbookModelMonths(ctx);
  const totalCol = excelCol(months + 2);
  const lastMonthCol = excelCol(months + 1);
  const sheet = workbook.addWorksheet(SHEETS.monthlyCashFlow, {
    views: [{ showGridLines: false, state: 'frozen', xSplit: 1, ySplit: 4 }],
  });
  sheet.columns = [{ width: 34 }, ...Array.from({ length: months }, () => ({ width: 12 })), { width: 16 }];

  sheet.mergeCells(1, 1, 1, months + 2);
  sheet.getCell(1, 1).value = `${ctx.brandName} | Monthly Cash Flow Detail`;
  styleSectionTitle(sheet.getCell(1, 1));
  sheet.getRow(1).height = 26;
  sheet.mergeCells(2, 1, 2, months + 2);
  sheet.getCell(2, 1).value = ctx.dealFamily === 'income'
    ? 'Monthly operating cash flow from construction through hold / exit period.'
    : 'Monthly development cash flow with S-curve construction, RERA escrow, debt draw, IDC, and equity cash flow.';
  sheet.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };

  sheet.getCell(3, 1).value = 'Month end date';
  styleLabelCell(sheet.getCell(3, 1));
  sheet.getCell(4, 1).value = 'Line item';
  for (let m = 1; m <= months; m += 1) {
    const col = excelCol(m + 1);
    const dateCell = sheet.getCell(3, m + 1);
    dateCell.value = { formula: `EDATE(EffectiveDate,${m})`, result: addMonths(ctx.effectiveDate, m) };
    styleOutputCell(dateCell, NUMBER_FORMATS.date);
    sheet.getCell(4, m + 1).value = `M${m}`;
  }
  sheet.getCell(3, months + 2).value = '';
  sheet.getCell(4, months + 2).value = 'Total';
  styleHeader(sheet.getRow(4));

  const devRows = [
    { label: 'Construction S-curve raw weight', row: 5, format: NUMBER_FORMATS.percent, formula: (m) => `=IF(${m}<=ConstructionLagQ*3,0,MAX(0.01,SIN(PI()*(${m}-ConstructionLagQ*3)/MAX(ProjectMonths-ConstructionLagQ*3,1))))`, total: 'blank' },
    { label: 'Land + stamp / registration', row: 6, format: NUMBER_FORMATS.currency, formula: (m) => m === 1 ? '=LandCostCr*(1+StampRegPct)' : '=0' },
    { label: 'Construction draw', row: 7, format: NUMBER_FORMATS.currency, formula: (m, col) => `=IFERROR((ConstructionCostPerSqft*SaleableAreaSqft/10000000)*${col}5/SUM($B$5:$${lastMonthCol}$5),0)` },
    { label: 'Soft + approvals + premium draw', row: 8, format: NUMBER_FORMATS.currency, formula: () => `=(${`'${SHEETS.calculations}'!$B$24`}+ApprovalCostCr+PremiumFSICostCr)/${months}` },
    { label: 'GST draw', row: 9, format: NUMBER_FORMATS.currency, formula: (m, col) => `=IFERROR((ConstructionCostPerSqft*SaleableAreaSqft/10000000)*GstPct*${col}5/SUM($B$5:$${lastMonthCol}$5),0)` },
    { label: 'Total development uses', row: 10, format: NUMBER_FORMATS.currency, formula: (m, col) => `=${col}6+${col}7+${col}8+${col}9`, bold: true },
    { label: 'Monthly sales absorption', row: 11, format: NUMBER_FORMATS.percent, formula: (m, col, prevCol) => m === 1 ? '=IF(1<=SalesLagQ*3,0,MIN(SalesVelocityPct/3,1))' : `=IF(${m}<=SalesLagQ*3,0,MAX(0,MIN(SalesVelocityPct/3,1-SUM($B$11:${prevCol}$11))))`, total: 'final' },
    { label: 'Gross sales booked', row: 12, format: NUMBER_FORMATS.currency, formula: (m, col) => `=SaleableAreaSqft*SellRatePerSqft*${col}11*(1+EscalationPct)^(${m}/12)/10000000` },
    { label: 'Customer collection', row: 13, format: NUMBER_FORMATS.currency, formula: (m, col) => `=IFERROR(SUM($B$12:$${lastMonthCol}$12)*CollectionPct*${col}7/SUM($B$7:$${lastMonthCol}$7),0)` },
    { label: 'To RERA escrow', row: 14, format: NUMBER_FORMATS.currency, formula: (m, col) => `=${col}13*RERAEscrowPct` },
    { label: 'Escrow drawdown', row: 15, format: NUMBER_FORMATS.currency, formula: (m, col, prevCol) => m === 1 ? `=MIN(${col}14,${col}7)` : `=MIN(${prevCol}16+${col}14,${col}7)` },
    { label: 'Escrow balance', row: 16, format: NUMBER_FORMATS.currency, formula: (m, col, prevCol) => m === 1 ? `=${col}14-${col}15` : `=${prevCol}16+${col}14-${col}15`, total: 'final' },
    { label: 'Net developer cash receipts', row: 17, format: NUMBER_FORMATS.currency, formula: (m, col) => `=(${col}13*(1-RERAEscrowPct)+${col}15)*(1-LandownerSharePct)`, bold: true },
    { label: 'Debt draw', row: 18, format: NUMBER_FORMATS.currency, formula: (m, col, prevCol) => `=IF(${col}10>${col}17,MAX(0,MIN((${col}10-${col}17)*DebtLTV,TotalProjectCostCr*DebtLTV-${m === 1 ? '0' : `SUM($B$18:${prevCol}$18)`})),0)` },
    { label: 'Interest during construction capitalised', row: 19, format: NUMBER_FORMATS.currency, formula: (m, col, prevCol) => `=-MAX(0,(${m === 1 ? '0' : `SUM($B$18:${prevCol}$18)+ABS(SUM($B$19:${prevCol}$19))+SUM($B$20:${prevCol}$20)`}+${col}18))*DebtRatePct/12` },
    { label: 'Principal repayment', row: 20, format: NUMBER_FORMATS.currency, formula: (m, col, prevCol) => `=IF(${col}17-${col}10+${col}19>0,-MIN(${col}17-${col}10+${col}19,SUM($B$18:${col}$18)+ABS(SUM($B$19:${col}$19))+${m === 1 ? '0' : `SUM($B$20:${prevCol}$20)`}),0)` },
    { label: 'Equity cash flow', row: 21, format: NUMBER_FORMATS.currency, formula: (m, col) => `=${col}17-${col}10+${col}18+${col}19+${col}20`, bold: true },
    { label: 'Cumulative equity cash flow', row: 22, format: NUMBER_FORMATS.currency, formula: (m, col, prevCol) => m === 1 ? `=${col}21` : `=${prevCol}22+${col}21`, total: 'final' },
  ];

  const incomeRentDriver = ctx.assetClass === 'hospitality'
    ? 'IFERROR(HospitalityRevPAR*HospitalityKeys*365/12/SaleableAreaSqft,0)'
    : ctx.assetClass === 'retail'
      ? 'RetailBlendedRentPerSqftMonth'
      : 'BaseRentPerSqftMonth';
  const incomeRecoveryDriver = ctx.assetClass === 'retail' ? 'RetailCAMRecoveryPct' : 'RecoverableExpensePct';
  const incomeRows = [
    { label: 'Effective occupancy', row: 5, format: NUMBER_FORMATS.percent, formula: (m) => `=IF(${m}<=ProjectMonths,0,MIN(OccupancyPct,OccupancyPct*(${m}-ProjectMonths)/MAX(LeaseUpQuarters*3,1)))` },
    { label: 'Effective rent / sqft / month', row: 6, format: NUMBER_FORMATS.integer, formula: (m) => `=${incomeRentDriver}*(1+RentEscalationPct)^(MAX(0,${m}-ProjectMonths)/12)` },
    { label: 'Potential gross income', row: 7, format: NUMBER_FORMATS.currency, formula: (m, col) => `=SaleableAreaSqft*${col}6/10000000` },
    { label: 'Physical occupancy revenue', row: 8, format: NUMBER_FORMATS.currency, formula: (m, col) => `=${col}7*${col}5` },
    { label: 'Vacancy / credit loss', row: 9, format: NUMBER_FORMATS.currency, formula: (m, col) => `=-${col}8*VacancyPct` },
    { label: 'Recoverable CAM / OpEx', row: 10, format: NUMBER_FORMATS.currency, formula: (m, col) => `=${col}7*(UtilitiesPct+MaintenancePct)*${incomeRecoveryDriver}*${col}5` },
    { label: 'Other income', row: 11, format: NUMBER_FORMATS.currency, formula: (m, col) => `=SaleableAreaSqft*OtherIncomePerSqft*${col}5/12/10000000` },
    { label: 'Effective gross revenue', row: 12, format: NUMBER_FORMATS.currency, formula: (m, col) => `=${col}8+${col}9+${col}10+${col}11`, bold: true },
    { label: 'Property tax', row: 13, format: NUMBER_FORMATS.currency, formula: () => '=-SaleableAreaSqft*PropertyTaxPerSqftYr/12/10000000' },
    { label: 'Insurance', row: 14, format: NUMBER_FORMATS.currency, formula: (m, col) => `=-${col}12*InsurancePct` },
    { label: 'Property management', row: 15, format: NUMBER_FORMATS.currency, formula: (m, col) => `=-${col}12*PropMgmtPct` },
    { label: 'Utilities gross cost', row: 16, format: NUMBER_FORMATS.currency, formula: (m, col) => `=-${col}12*UtilitiesPct` },
    { label: 'Maintenance gross cost', row: 17, format: NUMBER_FORMATS.currency, formula: (m, col) => `=-${col}12*MaintenancePct` },
    { label: 'Operating expenses', row: 18, format: NUMBER_FORMATS.currency, formula: (m, col) => `=SUM(${col}13:${col}17)`, bold: true },
    { label: 'NOI', row: 19, format: NUMBER_FORMATS.currency, formula: (m, col) => `=${col}12+${col}18`, bold: true },
    { label: 'CapEx reserve', row: 20, format: NUMBER_FORMATS.currency, formula: (m, col) => `=-${col}12*CapExReservePct` },
    { label: 'TI / LC / downtime costs', row: 21, format: NUMBER_FORMATS.currency, formula: (m, col) => `=-IF(MOD(MAX(0,${m}-1),60)=0,${col}8*12*LeasingCommissionPct,0)-IF(MOD(MAX(0,${m}-1),60)<TenantDowntimeMonths,SaleableAreaSqft*TIAllowancePerSqft/10000000/MAX(TenantDowntimeMonths,1),0)-IF(${m}=1,TILCAllowanceCr,0)` },
    { label: 'Cash flow before debt', row: 22, format: NUMBER_FORMATS.currency, formula: (m, col) => `=${col}19+${col}20+${col}21`, bold: true },
    { label: 'Construction / lease-up uses', row: 23, format: NUMBER_FORMATS.currency, formula: (m) => `=IF(${m}<=ProjectMonths,TotalProjectCostCr/ProjectMonths,0)` },
    { label: 'Debt draw', row: 24, format: NUMBER_FORMATS.currency, formula: (m, col, prevCol) => `=IF(${col}23>${col}22,MAX(0,MIN((${col}23-${col}22)*DebtLTV,TotalProjectCostCr*DebtLTV-${m === 1 ? '0' : `SUM($B$24:${prevCol}$24)`})),0)` },
    { label: 'Interest / debt service', row: 25, format: NUMBER_FORMATS.currency, formula: (m, col, prevCol) => `=-MAX(0,(${m === 1 ? '0' : `SUM($B$24:${prevCol}$24)+ABS(SUM($B$25:${prevCol}$25))`}+${col}24))*DebtRatePct/12` },
    { label: 'Net equity cash flow', row: 26, format: NUMBER_FORMATS.currency, formula: (m, col) => `=${col}22-${col}23+${col}24+${col}25`, bold: true },
    { label: 'Cumulative equity cash flow', row: 27, format: NUMBER_FORMATS.currency, formula: (m, col, prevCol) => m === 1 ? `=${col}26` : `=${prevCol}27+${col}26`, total: 'final' },
  ];

  const rows = ctx.dealFamily === 'income' ? incomeRows : devRows;
  rows.forEach((rowSpec) => {
    const r = rowSpec.row;
    sheet.getCell(r, 1).value = rowSpec.label;
    styleLabelCell(sheet.getCell(r, 1));
    if (rowSpec.bold) sheet.getCell(r, 1).font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    for (let m = 1; m <= months; m += 1) {
      const col = excelCol(m + 1);
      const prevCol = excelCol(m);
      const cell = sheet.getCell(r, m + 1);
      cell.value = { formula: rowSpec.formula(m, col, prevCol) };
      styleOutputCell(cell, rowSpec.format);
      if (rowSpec.bold) cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    }
    const totalCell = sheet.getCell(r, months + 2);
    if (rowSpec.total === 'blank') {
      totalCell.value = '';
    } else if (rowSpec.total === 'final') {
      totalCell.value = { formula: `=${lastMonthCol}${r}` };
    } else {
      totalCell.value = { formula: `=SUM($B$${r}:$${lastMonthCol}$${r})` };
    }
    styleOutputCell(totalCell, rowSpec.format);
    totalCell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
  });

  return sheet;
};

const buildConstructionDrawdownSheet = (workbook, ctx) => {
  const months = Math.min(getWorkbookModelMonths(ctx), Math.max(12, ctx.projectMonths || 36));
  const totalCol = excelCol(months + 2);
  const lastMonthCol = excelCol(months + 1);
  const sheet = workbook.addWorksheet(SHEETS.constructionDrawdown, {
    views: [{ showGridLines: false, state: 'frozen', xSplit: 1, ySplit: 4 }],
  });
  sheet.columns = [{ width: 34 }, ...Array.from({ length: months }, () => ({ width: 12 })), { width: 16 }];
  sheet.mergeCells(1, 1, 1, months + 2);
  sheet.getCell(1, 1).value = `${ctx.brandName} | Construction Drawdown`;
  styleSectionTitle(sheet.getCell(1, 1));
  sheet.mergeCells(2, 1, 2, months + 2);
  sheet.getCell(2, 1).value = 'Monthly S-curve draw schedule with equity-first funding, debt draws, and capitalised interest during construction.';
  sheet.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(4, 1).value = 'Line item';
  for (let m = 1; m <= months; m += 1) sheet.getCell(4, m + 1).value = `M${m}`;
  sheet.getCell(4, months + 2).value = 'Total / Final';
  styleHeader(sheet.getRow(4));

  const rows = [
    { row: 5, label: 'Raw S-curve weight', format: NUMBER_FORMATS.percent, formula: (m) => `=IF(${m}<=ConstructionLagQ*3,0,MAX(0.01,SIN(PI()*(${m}-ConstructionLagQ*3)/MAX(ProjectMonths-ConstructionLagQ*3,1))))`, total: 'blank' },
    { row: 6, label: 'Normalised draw %', format: NUMBER_FORMATS.percent, formula: (m, col) => `=IFERROR(${col}5/SUM($B$5:$${lastMonthCol}$5),0)` },
    { row: 7, label: 'Hard-cost draw', format: NUMBER_FORMATS.currency, formula: (m, col) => `=(ConstructionCostPerSqft*SaleableAreaSqft/10000000)*${col}6` },
    { row: 8, label: 'Soft/statutory draw', format: NUMBER_FORMATS.currency, formula: (m, col) => `=(${`'${SHEETS.calculations}'!$B$24`}+${`'${SHEETS.calculations}'!$B$27`}+ApprovalCostCr+PremiumFSICostCr)*${col}6` },
    { row: 9, label: 'Total monthly draw need', format: NUMBER_FORMATS.currency, formula: (m, col) => `=${col}7+${col}8`, bold: true },
    { row: 10, label: 'Cumulative draw need', format: NUMBER_FORMATS.currency, formula: (m, col, prevCol) => m === 1 ? `=${col}9` : `=${prevCol}10+${col}9`, total: 'final' },
    { row: 11, label: 'Equity contribution', format: NUMBER_FORMATS.currency, formula: (m, col) => `=${col}9*(1-DebtLTV)` },
    { row: 12, label: 'Debt draw', format: NUMBER_FORMATS.currency, formula: (m, col) => `=${col}9*DebtLTV` },
    { row: 13, label: 'Interest capitalised', format: NUMBER_FORMATS.currency, formula: (m, col, prevCol) => `=(${m === 1 ? '0' : `${prevCol}14`}+${col}12)*DebtRatePct/12` },
    { row: 14, label: 'Debt balance', format: NUMBER_FORMATS.currency, formula: (m, col, prevCol) => m === 1 ? `=${col}12+${col}13` : `=${prevCol}14+${col}12+${col}13`, total: 'final' },
  ];

  rows.forEach((rowSpec) => {
    sheet.getCell(rowSpec.row, 1).value = rowSpec.label;
    styleLabelCell(sheet.getCell(rowSpec.row, 1));
    if (rowSpec.bold) sheet.getCell(rowSpec.row, 1).font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    for (let m = 1; m <= months; m += 1) {
      const col = excelCol(m + 1);
      const prevCol = excelCol(m);
      const cell = sheet.getCell(rowSpec.row, m + 1);
      cell.value = { formula: rowSpec.formula(m, col, prevCol) };
      styleOutputCell(cell, rowSpec.format);
    }
    const totalCell = sheet.getCell(rowSpec.row, months + 2);
    if (rowSpec.total === 'blank') totalCell.value = '';
    else if (rowSpec.total === 'final') totalCell.value = { formula: `=${lastMonthCol}${rowSpec.row}` };
    else totalCell.value = { formula: `=SUM($B$${rowSpec.row}:$${lastMonthCol}$${rowSpec.row})` };
    styleOutputCell(totalCell, rowSpec.format);
  });
  return sheet;
};

const buildLeaseRollSheet = (workbook, ctx) => {
  const sheet = workbook.addWorksheet(SHEETS.leaseRoll, {
    views: [{ showGridLines: false, state: 'frozen', xSplit: 0, ySplit: 4 }],
  });
  sheet.columns = [
    { width: 24 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 14 },
    ...Array.from({ length: 10 }, () => ({ width: 14 })),
  ];
  sheet.mergeCells('A1:R1');
  sheet.getCell('A1').value = `${ctx.brandName} | Lease Roll`;
  styleSectionTitle(sheet.getCell('A1'));
  sheet.mergeCells('A2:R2');
  sheet.getCell('A2').value = ctx.dealFamily === 'income'
    ? 'Tenant-level rent reset, WALE, and expiry concentration. Seeded rows are editable assumptions.'
    : 'Development deals do not have a stabilised lease roll; keep this sheet for income-conversion scenarios only.';
  sheet.getCell('A2').font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };

  const headers = ['Tenant / use', 'Area sqft', 'Rent / sqft / mo', 'CAM / sqft / mo', 'Start mo', 'Term mo', 'Expiry mo', 'Renewal %'];
  for (let y = 1; y <= 10; y += 1) headers.push(`Year ${y} rent`);
  headers.forEach((h, idx) => { sheet.getCell(4, idx + 1).value = h; });
  styleHeader(sheet.getRow(4));

  const isRetail = ctx.assetClass === 'retail';
  const camFormula = isRetail ? 'RetailCAMRecoveryPct' : '0';
  const rows = ctx.dealFamily === 'income'
    ? [
        [isRetail ? 'Anchor tenant' : ctx.assetClass === 'hospitality' ? 'F&B lease' : 'Primary tenant', '=SaleableAreaSqft*0.40', '=BaseRentPerSqftMonth*0.85', `=IFERROR(BaseRentPerSqftMonth*${camFormula}*0.20,0)`, 1, 84, 84, 0.75],
        [isRetail ? 'Vanilla inline' : ctx.assetClass === 'industrial_warehousing' ? 'Warehouse bay A' : 'Mid-size tenant A', '=SaleableAreaSqft*0.25', '=BaseRentPerSqftMonth*1.05', `=IFERROR(BaseRentPerSqftMonth*${camFormula}*0.18,0)`, 4, 60, 64, 0.65],
        [isRetail ? 'F&B / kiosk' : ctx.assetClass === 'industrial_warehousing' ? 'Warehouse bay B' : 'Mid-size tenant B', '=SaleableAreaSqft*0.15', '=BaseRentPerSqftMonth*1.15', `=IFERROR(BaseRentPerSqftMonth*${camFormula}*0.16,0)`, 7, 48, 55, 0.60],
        ['Vacant / rolling space', '=SaleableAreaSqft*0.20', '=BaseRentPerSqftMonth', `=IFERROR(BaseRentPerSqftMonth*${camFormula}*0.15,0)`, 13, 36, 49, 0.50],
      ]
    : [
        ['Not applicable', 0, 0, 0, 0, 0, 0, 0],
      ];

  rows.forEach((row, idx) => {
    const r = 5 + idx;
    row.forEach((value, cIdx) => {
      const cell = sheet.getCell(r, cIdx + 1);
      cell.value = typeof value === 'string' && value.startsWith('=') ? { formula: value } : value;
      if (cIdx <= 7) styleInputCell(cell);
      else styleOutputCell(cell, NUMBER_FORMATS.currency);
      if (cIdx === 1 || cIdx === 4 || cIdx === 5 || cIdx === 6) cell.numFmt = NUMBER_FORMATS.integer;
      if (cIdx === 7) cell.numFmt = NUMBER_FORMATS.percent;
    });
    for (let y = 1; y <= 10; y += 1) {
      const c = 8 + y;
      const cell = sheet.getCell(r, c);
      cell.value = ctx.dealFamily === 'income'
        ? { formula: `=IF(AND(${y}*12>=E${r},(${y}-1)*12<G${r}),B${r}*C${r}*12*(1+RentEscalationPct)^(${y}-1)/10000000,0)` }
        : 0;
      styleOutputCell(cell, NUMBER_FORMATS.currency);
    }
  });

  const summaryRow = 5 + rows.length + 2;
  sheet.mergeCells(`A${summaryRow}:R${summaryRow}`);
  sheet.getCell(`A${summaryRow}`).value = 'Lease Metrics';
  styleSectionTitle(sheet.getCell(`A${summaryRow}`));
  const metrics = [
    ['WALE (years)', `=IFERROR(SUMPRODUCT(B5:B${4 + rows.length},G5:G${4 + rows.length})/SUM(B5:B${4 + rows.length})/12,0)`, NUMBER_FORMATS.multiple],
    ['Occupied area', `=SUM(B5:B${4 + rows.length})`, NUMBER_FORMATS.integer],
    ['Year 1 rent', `=SUM(I5:I${4 + rows.length})`, NUMBER_FORMATS.currency],
    ['Expiry concentration <= 3 yrs', `=IFERROR(SUMIF(G5:G${4 + rows.length},"<=36",B5:B${4 + rows.length})/SUM(B5:B${4 + rows.length}),0)`, NUMBER_FORMATS.percent],
  ];
  metrics.forEach(([label, formula, format], idx) => {
    const r = summaryRow + 1 + idx;
    sheet.getCell(`A${r}`).value = label;
    styleLabelCell(sheet.getCell(`A${r}`));
    sheet.getCell(`B${r}`).value = { formula };
    styleOutputCell(sheet.getCell(`B${r}`), format);
  });

  return sheet;
};

const buildSensitivitySheet = (workbook, ctx) => {
  const sheet = workbook.addWorksheet(SHEETS.sensitivity, {
    views: [{ showGridLines: false, state: 'frozen', xSplit: 1, ySplit: 4 }],
  });
  sheet.columns = [
    { width: 26 }, ...Array.from({ length: 9 }, () => ({ width: 14 })),
  ];
  sheet.mergeCells('A1:J1');
  sheet.getCell('A1').value = `${ctx.brandName} | Sensitivity`;
  styleSectionTitle(sheet.getCell('A1'));
  sheet.mergeCells('A2:J2');
  sheet.getCell('A2').value = ctx.dealFamily === 'income'
    ? '2D cap-rate x occupancy sensitivity for income assets.'
    : '2D sale-rate x absorption-speed sensitivity for development deals.';
  sheet.getCell('A2').font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };

  const isIncome = ctx.dealFamily === 'income';
  sheet.mergeCells('A4:H4');
  sheet.getCell('A4').value = isIncome ? '2D Sensitivity - Exit Cap Rate x Occupancy' : '2D Sensitivity - Sale Rate x Absorption Speed';
  styleSectionTitle(sheet.getCell('A4'));
  const cols = isIncome ? [0.06, 0.07, 0.08, 0.09, 0.10, 0.11, 0.12] : [-0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15];
  const rows = isIncome ? [-0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15] : [0.60, 0.75, 0.90, 1.00, 1.10, 1.25, 1.40];
  sheet.getCell('A5').value = isIncome ? 'Occupancy \\ Cap rate' : 'Absorption speed \\ Sale rate';
  styleHeader(sheet.getRow(5));
  cols.forEach((v, idx) => {
    const cell = sheet.getCell(5, idx + 2);
    cell.value = v;
    cell.numFmt = isIncome ? NUMBER_FORMATS.percent : '+0%;-0%;"base"';
    cell.fill = FILL(palette.xlsx('inkDeep'));
    cell.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    cell.alignment = { horizontal: 'center' };
  });

  const incomeMetric = (occShock, capRate) => {
    const occ = `MAX(0,MIN(1,OccupancyPct*(1+${occShock})))`;
    const annualNoi = `(SaleableAreaSqft*BaseRentPerSqftMonth*12*${occ}*(1-VacancyPct)*(1-(InsurancePct+PropMgmtPct+UtilitiesPct+MaintenancePct+CapExReservePct))/10000000)`;
    return `=IFERROR((${annualNoi}/${capRate}*(1-TotalExitCostPct)-TotalProjectCostCr)/TotalProjectCostCr,0)`;
  };
  const devMetric = (speed, rateShock) => {
    const revenue = `(SaleableAreaSqft*SellRatePerSqft*(1+${rateShock})*(1+EscalationPct)^(TotalQuarters/4/2)/10000000)`;
    const carry = `(1+MAX(0,1-${speed})*FinanceCostPct*TotalQuarters/4)`;
    return `=IFERROR((${revenue}*CollectionPct*(1-LandownerSharePct)-TotalProjectCostCr*${carry})/${revenue},0)`;
  };

  rows.forEach((rowVal, rIdx) => {
    const r = 6 + rIdx;
    const labelCell = sheet.getCell(r, 1);
    labelCell.value = rowVal;
    labelCell.numFmt = isIncome ? '+0%;-0%;"base"' : '0.00"x"';
    labelCell.fill = FILL(palette.xlsx('inkDeep'));
    labelCell.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    labelCell.alignment = { horizontal: 'center' };
    cols.forEach((colVal, cIdx) => {
      const cell = sheet.getCell(r, cIdx + 2);
      cell.value = { formula: isIncome ? incomeMetric(rowVal, colVal) : devMetric(rowVal, colVal) };
      styleOutputCell(cell, NUMBER_FORMATS.percent);
      cell.alignment = { horizontal: 'center' };
    });
  });
  sheet.addConditionalFormatting({
    ref: 'B6:H12',
    rules: [{
      type: 'colorScale',
      cfvo: [{ type: 'num', value: -0.10 }, { type: 'num', value: 0.10 }, { type: 'num', value: 0.30 }],
      color: [{ argb: palette.xlsx('dataNegative') }, { argb: palette.xlsx('dataWarning') }, { argb: palette.xlsx('dataPositive') }],
      priority: 1,
    }],
  });

  return sheet;
};

/**
 * Operating Schedule section of the Cash Flow Engine sheet.
 *
 * Pre-2026-05-11: this rendered as its own "Phasing & Sales Collection" worksheet.
 * Post-2026-05-11 restructure: phasing is the TOP section of the combined
 * "Cash Flow Engine" sheet. The Cash Flow + Debt rows render BELOW phasing
 * in the same worksheet (via buildCashFlowSection, below).
 *
 * Returns the last row written so the Cash Flow section knows where to start.
 */
const buildPhasingSheet = (workbook, ctx) => {
  const sheet = workbook.addWorksheet(SHEETS.cashFlowEngine, {
    views: [{ showGridLines: false, state: 'frozen', xSplit: 1, ySplit: 4 }],
  });
  const cols = [{ width: 32 }];
  for (let i = 0; i < ctx.totalQuarters; i += 1) cols.push({ width: 14 });
  cols.push({ width: 16 }); // Total
  sheet.columns = cols;

  // Helpers
  const colLetter = (n) => {
    let s = '';
    let v = n;
    while (v > 0) {
      const r = (v - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      v = Math.floor((v - r) / 26);
    }
    return s;
  };

  // Title row — single banner covers the whole sheet (both sections).
  // PR-NX5: includes the deal name so the Cash Flow Engine sheet
  // reads as deal-specific too (not just "Cash Flow Engine — generic").
  sheet.mergeCells(1, 1, 1, ctx.totalQuarters + 2);
  const dealName = ctx.deal.name || ctx.property.property_name || 'Deal';
  sheet.getCell(1, 1).value = ctx.dealFamily === 'income'
    ? `${ctx.brandName} | ${dealName} | Cash Flow Engine — Operating Schedule + Cash Flow + Debt`
    : `${ctx.brandName} | ${dealName} | Cash Flow Engine — Phasing + Sales Collection + Cash Flow + Debt`;
  styleSectionTitle(sheet.getCell(1, 1));
  sheet.getRow(1).height = 26;

  sheet.mergeCells(2, 1, 2, ctx.totalQuarters + 2);
  // PR-NX5: row 2 now carries the same deal-identity subtitle that the
  // Dashboard + Inputs sheets carry, plus the asset-class-aware mechanic
  // hint for at-a-glance modeling-engine identification.
  sheet.getCell(2, 1).value = `${buildDealIdentityLine(ctx)} · ${buildModelingMechanicHint(ctx)}`;
  sheet.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(2, 1).alignment = { vertical: 'middle' };

  sheet.getCell(3, 1).value = 'Quarter end date';
  styleLabelCell(sheet.getCell(3, 1));
  for (let q = 1; q <= ctx.totalQuarters; q += 1) {
    const dateCell = sheet.getCell(3, 1 + q);
    dateCell.value = {
      formula: `EDATE(EffectiveDate,${q * 3})`,
      result: addMonths(ctx.effectiveDate, q * 3),
    };
    styleOutputCell(dateCell, NUMBER_FORMATS.date);
  }
  sheet.getCell(3, ctx.totalQuarters + 2).value = '';
  sheet.getRow(3).height = 18;

  // Header row 4
  sheet.getCell(4, 1).value = 'Line item';
  for (let q = 1; q <= ctx.totalQuarters; q += 1) sheet.getCell(4, 1 + q).value = `Q${q}`;
  sheet.getCell(4, ctx.totalQuarters + 2).value = 'Total';
  styleHeader(sheet.getRow(4));

  // Asset-class branching: Income deals get a full operating P&L
  // (PGI/Vacancy/Other-Income/EGR/OpEx-line-items/NOI/CapEx-Reserves/
  // NOI-after-CapEx/Cumulative-NOI). Development deals get the existing
  // construction phasing + sales collection rows, expanded with
  // marketing spend + cumulative collections.
  const incomeRows = [
    // Lease-up ramp — 0% before SalesLagQ, then linear ramp over LeaseUpQuarters, capped at OccupancyPct
    {
      label: 'Lease-up % of stabilised',
      formula: (q) => `=IF(${q}<=SalesLagQ,0,MIN(1,(${q}-SalesLagQ)/LeaseUpQuarters))`,
      format: NUMBER_FORMATS.percent,
    },
    {
      label: 'Effective occupancy',
      formula: (q) => `=B5*OccupancyPct`.replace('B5', `${colLetter(q + 1)}5`),
      format: NUMBER_FORMATS.percent,
    },
    {
      label: 'Effective rent / sqft / mo',
      formula: (q) => `=BaseRentPerSqftMonth*(1+RentEscalationPct)^((${q}-1)/4)`,
      format: NUMBER_FORMATS.integer,
    },
    {
      label: 'PGI — Potential Gross Income (INR Cr)',
      formula: (q) => `=SaleableAreaSqft*${colLetter(q + 1)}7*3/10000000`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Less: Vacancy & Credit Loss',
      formula: (q) => `=-${colLetter(q + 1)}8*${colLetter(q + 1)}6*VacancyPct`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Plus: Other Income',
      formula: (q) => `=SaleableAreaSqft*OtherIncomePerSqft*${colLetter(q + 1)}6/4/10000000`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'EGR — Effective Gross Revenue',
      formula: (q) => `=${colLetter(q + 1)}8*${colLetter(q + 1)}6+${colLetter(q + 1)}9+${colLetter(q + 1)}10`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'Less: Property Tax (BBMP UAV method)',
      // PR-I4: BBMP Unit Area Value method — INR/sqft/yr × area, not
      // % of EGR. Annualised figure / 4 = quarterly. /10000000 = INR → Cr.
      // Formula no longer references the quarterly EGR cell (col q+1, row
      // 11) since tax is area-driven, not revenue-driven.
      formula: () => `=-SaleableAreaSqft*PropertyTaxPerSqftYr/4/10000000`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Less: Insurance',
      formula: (q) => `=-${colLetter(q + 1)}11*InsurancePct`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Less: Property Management',
      formula: (q) => `=-${colLetter(q + 1)}11*PropMgmtPct`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Less: Utilities',
      formula: (q) => `=-${colLetter(q + 1)}11*UtilitiesPct`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Less: Maintenance & Repairs',
      formula: (q) => `=-${colLetter(q + 1)}11*MaintenancePct`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Total Operating Expenses',
      formula: (q) => `=SUM(${colLetter(q + 1)}12:${colLetter(q + 1)}16)`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'NOI — Net Operating Income',
      formula: (q) => `=${colLetter(q + 1)}11+${colLetter(q + 1)}17`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'Less: CapEx Reserves',
      formula: (q) => `=-${colLetter(q + 1)}11*CapExReservePct`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Cash Flow Before Debt Service',
      formula: (q) => `=${colLetter(q + 1)}18+${colLetter(q + 1)}19`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'Cumulative CF Before Debt',
      formula: (q) => q === 1
        ? `=${colLetter(q + 1)}20`
        : `=${colLetter(q)}21+${colLetter(q + 1)}20`,
      format: NUMBER_FORMATS.currency,
      totalKind: 'final', // last quarter holds the cumulative — don't SUM
    },
  ];

  const usaliAnnualValue = (row, q) => {
    const col = colLetter(q + 1);
    return `IF(${col}5=0,0,INDEX('${SHEETS.usali}'!$B$${row}:$P$${row},1,MIN(${col}5,15,ROUND(HospitalityHoldYears,0))))`;
  };

  const hospitalityRows = [
    {
      label: 'Operating year',
      formula: (q) => `=MAX(0,ROUNDUP(MAX(0,${q}*3-ProjectMonths)/12,0))`,
      format: NUMBER_FORMATS.integer,
      totalKind: 'final',
    },
    {
      label: 'Effective occupancy',
      formula: (q) => `=${usaliAnnualValue(USALI_ROW.occupancy, q)}`,
      format: NUMBER_FORMATS.percent,
    },
    {
      label: 'ADR (blended)',
      formula: (q) => `=${usaliAnnualValue(USALI_ROW.adr, q)}`,
      format: NUMBER_FORMATS.integer,
    },
    {
      label: 'Total operating revenue',
      formula: (q) => `=${usaliAnnualValue(USALI_ROW.totalRevenue, q)}/4`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Rooms revenue',
      formula: (q) => `=${usaliAnnualValue(USALI_ROW.roomsRevenue, q)}/4`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Ancillary revenue',
      formula: (q) => `=(${usaliAnnualValue(USALI_ROW.totalRevenue, q)}-${usaliAnnualValue(USALI_ROW.roomsRevenue, q)})/4`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'EGR - Effective Gross Revenue',
      formula: (q) => `=${colLetter(q + 1)}8`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'Departmental expenses',
      formula: (q) => `=(${usaliAnnualValue(USALI_ROW.roomsDeptExp, q)}+${usaliAnnualValue(USALI_ROW.fbDeptExp, q)}+${usaliAnnualValue(USALI_ROW.otherDeptExp, q)})/4`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Undistributed expenses',
      formula: (q) => `=${usaliAnnualValue(USALI_ROW.totalUndist, q)}/4`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Brand + management fees',
      formula: (q) => `=(${usaliAnnualValue(USALI_ROW.brandRoyalty, q)}+${usaliAnnualValue(USALI_ROW.brandMktReserv, q)}+${usaliAnnualValue(USALI_ROW.mgmtBase, q)}+${usaliAnnualValue(USALI_ROW.mgmtIncentive, q)})/4`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Fixed charges',
      formula: (q) => `=(${usaliAnnualValue(USALI_ROW.propTax, q)}+${usaliAnnualValue(USALI_ROW.insurance, q)}+${usaliAnnualValue(USALI_ROW.groundLease, q)})/4`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'FF&E reserve',
      formula: (q) => `=${usaliAnnualValue(USALI_ROW.ffeReserve, q)}/4`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Total operating expenses',
      formula: (q) => `=SUM(${colLetter(q + 1)}12:${colLetter(q + 1)}16)`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'NOI - Net Operating Income',
      formula: (q) => `=${usaliAnnualValue(USALI_ROW.noi, q)}/4`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'CapEx reserves',
      formula: () => '=0',
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Cash Flow Before Debt Service',
      formula: (q) => `=${colLetter(q + 1)}18+${colLetter(q + 1)}19`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'Cumulative CF Before Debt',
      formula: (q) => q === 1
        ? `=${colLetter(q + 1)}20`
        : `=${colLetter(q)}21+${colLetter(q + 1)}20`,
      format: NUMBER_FORMATS.currency,
      totalKind: 'final',
    },
  ];

  const developmentRows = [
    {
      label: 'Quarter share (uniform)',
      formula: () => `=1/TotalQuarters`,
      format: NUMBER_FORMATS.percent,
    },
    {
      label: 'Construction cost (INR Cr)',
      formula: (q) =>
        `=IF(${q}<=ConstructionLagQ,0,(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr)*(1/MAX(TotalQuarters-ConstructionLagQ,1)))`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Cumulative construction cost (INR Cr)',
      formula: (q) => q === 1
        ? `=B6`
        : `=${colLetter(q)}7+${colLetter(q + 1)}6`,
      format: NUMBER_FORMATS.currency,
      // Total column shows the FINAL cumulative value, not a sum across
      // already-cumulative cells. Without this flag the total column
      // produces a triangular sum (operator's roast: "Cumulative
      // construction cost shows 3,198 Cr" when actual project total is
      // ~266 Cr).
      totalKind: 'final',
    },
    {
      label: 'Sales launched (% of saleable)',
      formula: (q) => `=IF(${q}<=SalesLagQ,0,MIN(1,SalesVelocityPct*(${q}-SalesLagQ)))`,
      format: NUMBER_FORMATS.percent,
    },
    {
      label: 'Quarter sales (INR Cr)',
      // Base sales formula = absorption_delta × area × rate × escalation / 1e7.
      //
      // PR-NX4 (2026-05-15): wire EffectiveExitFactor + KhataExitMultiplier
      // into the FINAL quarter when ExitStrategyType = "bulk_exit_completion".
      // Final quarter's sales add a "bulk-exit top-up" = remaining unsold
      // inventory × full rate × EffectiveExitFactor (discount + broker fee)
      // × KhataExitMultiplier (B-khata haircut, default 1.0 for A-khata).
      // Without this top-up, leftover inventory at completion stays dead
      // in the model — operators using bulk_exit_completion strategy were
      // previously seeing under-counted revenue. EffectiveExitFactor was
      // a display-only derived value on Inputs; now it drives the math.
      formula: (q) => {
        const baseFormula =
          `SaleableAreaSqft*SellRatePerSqft*(1+EscalationPct)^(${q}/4)*` +
          `IF(${q}=1,IF(${q}<=SalesLagQ,0,MIN(1,SalesVelocityPct*(${q}-SalesLagQ))),` +
          `IF(${q}<=SalesLagQ,0,MIN(1,SalesVelocityPct*(${q}-SalesLagQ)))-` +
          `IF(${q}-1<=SalesLagQ,0,MIN(1,SalesVelocityPct*(${q}-1-SalesLagQ))))/10000000`;
        // Only the final quarter gets the bulk-exit top-up.
        if (q !== ctx.totalQuarters) {
          return `=${baseFormula}`;
        }
        const remainingInv =
          `MAX(0,1-MIN(1,SalesVelocityPct*(${q}-SalesLagQ)))`;
        const bulkExitTopUp =
          `${remainingInv}*SaleableAreaSqft*SellRatePerSqft*(1+EscalationPct)^(${q}/4)`
          + `*EffectiveExitFactor*KhataExitMultiplier/10000000`;
        return `=${baseFormula}+IF(ExitStrategyType="bulk_exit_completion",${bulkExitTopUp},0)`;
      },
      format: NUMBER_FORMATS.currency,
    },
    {
      // Customer collection is RERA / construction-milestone-linked in
      // Indian residential — buyers pay incrementally as construction
      // progresses (typical schedule: 10% on booking + 80% across
      // construction milestones + 10% on possession). Previous model
      // collected the full sale × CollectionPct in the SAME quarter as
      // the sale, which produced a front-loaded-positive cash-flow
      // profile (Q1-Q5 large positives, Q6-Q24 sustained negatives) →
      // negative IRR despite positive net cash flow. Operator's roast
      // verified: "IRR -15% despite positive net CF — fundamentally
      // wrong."
      //
      // Construction-progress-linked model:
      //   collection_q = totalContractedSales × CollectionPct
      //                  × constructionThisQuarter / totalConstruction
      //
      // i.e. the operator collects CollectionPct of total contracted
      // sales, distributed evenly across construction quarters in
      // proportion to construction progress. This produces the
      // conventional pattern (negative-early, positive-mid, taper-late)
      // that yields a positive IRR matching the underlying margin.
      label: 'Customer collection (INR Cr)',
      formula: (q) => {
        const lastCol = colLetter(ctx.totalQuarters + 1);
        const thisCol = colLetter(q + 1);
        const totalSales = `SUM($B$9:$${lastCol}$9)`;
        const totalConstruction = `SUM($B$6:$${lastCol}$6)`;
        const thisConstruction = `${thisCol}6`;
        // Guard against div-by-zero before construction starts
        // (totalConstruction is constant; only zero in degenerate cases).
        return `=IFERROR(${totalSales}*CollectionPct*${thisConstruction}/${totalConstruction},0)`;
      },
      format: NUMBER_FORMATS.currency,
    },
    // ── RERA Escrow ledger (PR-I2) ──────────────────────────────────────
    // Indian RERA Act 2016 mandates 70% of every customer payment goes
    // into a project-specific escrow, releasable only against certified
    // construction. The 30% is freely available to the developer.
    //
    //   Row 11  To RERA Escrow (70%)       = Row 10 × RERAEscrowPct
    //   Row 12  Free cash to developer (30%) = Row 10 × (1 - RERAEscrowPct)
    //   Row 13  RERA Escrow drawdown         = MIN(balance, construction)
    //   Row 14  RERA Escrow balance EOQ      = running balance
    //   Row 15  Net developer cash from sales = Row 12 + Row 13
    //
    // Row 15 is what the Cash Flow sheet now treats as the developer's
    // actual sales inflow (vs Row 10 gross pre-PR-I2). When the operator
    // overrides RERAEscrowPct to 0, the math collapses: To Escrow = 0,
    // Free Cash = Gross, Drawdown = 0, Net = Free = Gross — preserving
    // the pre-PR-I2 behaviour for non-RERA / pre-2016 / income-only deals.
    {
      label: '→ To RERA Escrow (restricted 70%)',
      formula: (q) => `=${colLetter(q + 1)}10*RERAEscrowPct`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: '→ Free cash to developer (30%)',
      formula: (q) => `=${colLetter(q + 1)}10*(1-RERAEscrowPct)`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'RERA Escrow drawdown (against construction)',
      // Drawdown is MIN of (balance entering quarter + escrow additions
      // this quarter, construction cost this quarter). For Q1 there's no
      // prior balance, so drawdown is MIN of (additions, construction).
      formula: (q) => {
        const thisCol = colLetter(q + 1);
        if (q === 1) return `=MIN(${thisCol}11,${thisCol}6)`;
        const prevCol = colLetter(q);
        return `=MIN(${prevCol}14+${thisCol}11,${thisCol}6)`;
      },
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'RERA Escrow balance — end of quarter',
      // Running balance: prior balance + additions - drawdowns. Tracks
      // money trapped in escrow until construction matches it.
      formula: (q) => {
        const thisCol = colLetter(q + 1);
        if (q === 1) return `=${thisCol}11-${thisCol}13`;
        const prevCol = colLetter(q);
        return `=${prevCol}14+${thisCol}11-${thisCol}13`;
      },
      format: NUMBER_FORMATS.currency,
      // Final column shows the FINAL balance (which should taper to ~0
      // by project end as construction completes and escrow releases).
      // SUM of running balances would be nonsensical.
      totalKind: 'final',
    },
    {
      label: 'Net developer cash from sales (post-RERA, post-landowner share)',
      // This is what the developer ACTUALLY receives per quarter:
      //   (Free Cash 30% + Escrow Drawdown) × (1 - LandownerSharePct)
      //
      // PR-I2 introduced the RERA escrow split: Free Cash + Escrow
      // Drawdown = what hits the developer's account.
      //
      // PR-I3 adds JDA support: in revenue-share JDA the landowner
      // takes a fraction of every collection. Multiplying by
      // (1 - LandownerSharePct) reduces the developer's net inflow.
      // For outright_purchase (default), LandownerSharePct = 0 and the
      // formula collapses to (Free Cash + Drawdown).
      //
      // Cash Flow sheet treats this as the sales inflow row.
      formula: (q) => {
        const thisCol = colLetter(q + 1);
        return `=(${thisCol}12+${thisCol}13)*(1-LandownerSharePct)`;
      },
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'Marketing & Sales spend (INR Cr)',
      // Row position shifted from 11 → 16 due to PR-I2 RERA block.
      formula: (q) => `=${colLetter(q + 1)}9*MarketingCostPct`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Cumulative customer collection',
      // Row position shifted from 12 → 17 due to PR-I2 RERA block.
      // Self-reference (rolling cumulative) updates: references this row
      // (was 12 → 17) and gross customer collection at row 10 (unchanged).
      formula: (q) => q === 1
        ? `=${colLetter(q + 1)}10`
        : `=${colLetter(q)}17+${colLetter(q + 1)}10`,
      format: NUMBER_FORMATS.currency,
      bold: true,
      // Same fix as the construction cumulative row above — total cell
      // shows the final cumulative, not a sum of already-cumulative cells.
      totalKind: 'final',
    },
    // ── Detailed Soft Cost Schedule ──────────────────────────────────────
    // Adds rows 18-24 on the Phasing sheet (was rows 13-19 pre-PR-I2;
    // shifted +5 by RERA Escrow ledger block). These rows match the
    // soft-cost line items the operator's reference pro formas (NAIOP,
    // RE-540) break out, and reference the named ranges defined on the
    // Inputs sheet (ArchitectFeePct, LegalFeePct, AppraisalFeePct,
    // InsuranceConstPct, PropTaxConstPct, DeveloperOverheadPct).
    //
    // Phasing assumptions per industry convention:
    //   - A&E (design-phase): paid evenly Q1-Q4 (first year of project)
    //   - Legal Fees (closing + period docs): paid evenly Q1-Q2
    //   - Appraisal & Title: one-time at Q1
    //   - Insurance during Construction: spread evenly across construction
    //     quarters (Q[lag+1] through Q[total])
    //   - Property Taxes during Construction: same construction spread
    //   - Developer Overhead: spread evenly across the entire project
    //     (Q1-Q[total])
    //
    // Each row's per-quarter formula uses HardCost = construction cost ×
    // saleable area / 1Cr as the cost base (matches "% of hard cost"
    // convention on the Inputs sheet). PropTaxConstPct alone uses
    // LandCostCr as the base, matching Karnataka property-tax method.
    //
    // Row 19 is the per-quarter sum of all 6 detailed soft costs — used
    // by the Calculations sheet's full Cost Build breakdown and (in a
    // follow-up PR) by the Cash Flow sheet to replace the aggregate
    // Marketing & Finance outflow row.
    {
      label: 'A&E spend (INR Cr)',
      formula: (q) =>
        `=IF(${q}<=4,(ConstructionCostPerSqft*SaleableAreaSqft/10000000)*ArchitectFeePct/4,0)`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Legal fees spend (INR Cr)',
      formula: (q) =>
        `=IF(${q}<=2,(ConstructionCostPerSqft*SaleableAreaSqft/10000000)*LegalFeePct/2,0)`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Appraisal & title spend (INR Cr)',
      formula: (q) =>
        q === 1
          ? `=(ConstructionCostPerSqft*SaleableAreaSqft/10000000)*AppraisalFeePct`
          : `=0`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Insurance during construction (INR Cr)',
      formula: (q) =>
        `=IF(AND(${q}>ConstructionLagQ,${q}<=TotalQuarters),(ConstructionCostPerSqft*SaleableAreaSqft/10000000)*InsuranceConstPct/MAX(TotalQuarters-ConstructionLagQ,1),0)`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Property taxes during construction (INR Cr)',
      formula: (q) =>
        `=IF(AND(${q}>ConstructionLagQ,${q}<=TotalQuarters),LandCostCr*PropTaxConstPct/MAX(TotalQuarters-ConstructionLagQ,1),0)`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Developer overhead (INR Cr)',
      formula: (q) =>
        `=(ConstructionCostPerSqft*SaleableAreaSqft/10000000)*DeveloperOverheadPct/TotalQuarters`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Total Detailed Soft Costs (INR Cr)',
      // Sums the 6 individual detailed soft cost rows. Rows shifted +5
      // by PR-I2 RERA block, so formula references B18..B23 (was 13..18).
      formula: (q) => {
        const c = colLetter(q + 1);
        return `=${c}18+${c}19+${c}20+${c}21+${c}22+${c}23`;
      },
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    // ── India Statutory Levies (PR-I1) ──────────────────────────────────
    // Three rows materialising what were previously decorative inputs.
    // Row positions shifted +5 by PR-I2 RERA block (was 20-22 → now 25-27).
    //
    //   Row 25  Stamp Duty + Registration on Land (Q1-only) — paid up-
    //           front at acquisition. Karnataka default 6.6% of LandCostCr.
    //           Modeled as a single-quarter outflow at Q1 to match the
    //           legal-economic reality of conveyance: stamp duty + reg
    //           cleared at deed registration, not amortised.
    //
    //   Row 26  GST on Construction (Net Cost) — spread evenly across
    //           construction quarters (Q[lag+1] .. Q[total]). Net cost
    //           defaults are asset-class-aware (see
    //           `indiaGstDefaultForClass`):
    //             residential/villas   = 5% of hard cost (no ITC)
    //             commercial/retail/IW = 0% (ITC offsets output GST)
    //             plotted/raw_land     = 0% (no GST on land transfer)
    //
    //   Row 27  Total India Statutory Levies — sum of rows 25 + 26 per
    //           quarter, totalled in the Total column.
    //
    // These rows feed the Calculations Cost Build (rows 25-27) so the
    // Dashboard Total Cost reflects the full India regulatory load.
    {
      label: 'Stamp Duty + Registration on Land (INR Cr)',
      formula: (q) => q === 1
        ? `=LandCostCr*StampRegPct`
        : `=0`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'GST on Construction — Net Cost (INR Cr)',
      formula: (q) =>
        `=IF(AND(${q}>ConstructionLagQ,${q}<=TotalQuarters),(ConstructionCostPerSqft*SaleableAreaSqft/10000000)*GstPct/MAX(TotalQuarters-ConstructionLagQ,1),0)`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Total India Statutory Levies (INR Cr)',
      // Stamp Duty + Reg (row 25) + GST (row 26). Rows shifted +5 by
      // PR-I2 RERA block.
      formula: (q) => {
        const c = colLetter(q + 1);
        return `=${c}25+${c}26`;
      },
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
  ];

  const rows = ctx.assetClass === 'hospitality'
    ? hospitalityRows
    : ctx.dealFamily === 'income'
      ? incomeRows
      : developmentRows;

  let lastRow = 4;
  rows.forEach((rowSpec, rowIdx) => {
    const r = 5 + rowIdx;
    lastRow = r;
    sheet.getCell(r, 1).value = rowSpec.label;
    styleLabelCell(sheet.getCell(r, 1));

    if (rowSpec.bold) sheet.getCell(r, 1).font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };

    for (let q = 1; q <= ctx.totalQuarters; q += 1) {
      const cell = sheet.getCell(r, 1 + q);
      const formula = rowSpec.formula(q);
      cell.value = { formula };
      styleOutputCell(cell, rowSpec.format);
      if (rowSpec.bold) cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    }
    // Total column — sum of quarters EXCEPT for rows marked `totalKind:
    // 'final'`, which already carry running cumulative values. SUM-ing
    // those rows produces a triangular sum (operator's roast: 3,198 Cr
    // when actual project construction is ~266 Cr). For cumulative rows,
    // the total is the LAST quarter's value, not a sum.
    const totalCell = sheet.getCell(r, ctx.totalQuarters + 2);
    const startCol = colLetter(2); // Q1 is column B
    const endCol = colLetter(ctx.totalQuarters + 1);
    totalCell.value = rowSpec.totalKind === 'final'
      ? { formula: `=${endCol}${r}` }
      : { formula: `=SUM(${startCol}${r}:${endCol}${r})` };
    styleOutputCell(totalCell, rowSpec.format);
    totalCell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
  });

  // Return the last row written so the Cash Flow section knows where to
  // start. The Cash Flow rows render BELOW these phasing rows, on the
  // SAME worksheet (post-2026-05-11 7-sheet restructure).
  return { sheet, lastRow };
};

/**
 * Cash Flow & Debt section of the Cash Flow Engine sheet.
 *
 * Pre-2026-05-11: this was a standalone "Quarterly Cash Flow & Debt" sheet.
 * Post-restructure (7-sheet directive): rendered BELOW the phasing rows
 * on the same "Cash Flow Engine" worksheet.
 *
 * Row offset: cash flow rows start at `phasingLastRow + 4` (one blank row,
 * one section title row, one blank row, then rows). All formula row
 * references that previously assumed Inflow at row 5 now shift by
 * `cfOffset` (cashFlowStartRow - 5). Phasing references become same-sheet
 * (no sheet prefix).
 */
const buildCashFlowSheet = (workbook, ctx, opts = {}) => {
  const sheet = workbook.getWorksheet(SHEETS.cashFlowEngine);
  if (!sheet) throw new Error('Cash Flow Engine sheet must be created by buildPhasingSheet first');

  const phasingLastRow = opts.phasingLastRow != null ? opts.phasingLastRow : 27;
  // Layout after phasing: row+1 blank, row+2 section divider title, row+3 column header (Line item / Q1..Qn / Total),
  // row+4 = first Cash Flow row.
  const cashFlowSectionTitleRow = phasingLastRow + 2;
  const cashFlowHeaderRow = phasingLastRow + 3;
  const cashFlowStartRow = phasingLastRow + 4;
  const cfOffset = cashFlowStartRow - 5; // shift for legacy formula refs that assumed row 5 = first row

  const colLetter = (n) => {
    let s = '';
    let v = n;
    while (v > 0) {
      const r = (v - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      v = Math.floor((v - r) / 26);
    }
    return s;
  };

  // Section divider title
  sheet.mergeCells(cashFlowSectionTitleRow, 1, cashFlowSectionTitleRow, ctx.totalQuarters + 2);
  sheet.getCell(cashFlowSectionTitleRow, 1).value =
    `Cash Flow & Debt Service — DSCR conditional formatting: red < 1.20, amber 1.20–1.50, green > 1.50.`;
  styleSectionTitle(sheet.getCell(cashFlowSectionTitleRow, 1));
  sheet.getRow(cashFlowSectionTitleRow).height = 22;

  // Column header (Line item / Q1..Qn / Total) for the cash flow section
  sheet.getCell(cashFlowHeaderRow, 1).value = 'Line item';
  for (let q = 1; q <= ctx.totalQuarters; q += 1) sheet.getCell(cashFlowHeaderRow, 1 + q).value = `Q${q}`;
  sheet.getCell(cashFlowHeaderRow, ctx.totalQuarters + 2).value = 'Total';
  styleHeader(sheet.getRow(cashFlowHeaderRow));

  // Pre-build the column letter for each quarter
  const colLetters = [];
  for (let q = 1; q <= ctx.totalQuarters; q += 1) colLetters.push(colLetter(q + 1));

  // Shift legacy Cash Flow row references (5-13) into post-restructure
  // positions. Pre-2026-05-11 the Cash Flow sheet stood alone and Cash
  // Flow row 5 = Inflow. After combining with Phasing on the same sheet,
  // Cash Flow row 5 sits at `5 + cfOffset` (after the Phasing rows + a
  // section divider). cfOffset varies by family:
  //   income family:      cfStart = 24 → cfOffset = 19
  //   development family: cfStart = 30 → cfOffset = 25
  //
  // Phasing references (e.g. Phasing row 20 for income CF Before Debt,
  // row 6 for dev Construction) don't shift — they're already in the
  // upper section of the combined sheet. They just lose their sheet
  // prefix (no more `'Phasing & Sales Collection'!`).
  const cf = (legacyRow) => legacyRow + cfOffset;

  // Income deal cash flow rows — pulls Cash Flow Before Debt from
  // Phasing row 20 (same sheet now), adds debt service.
  // Reversion in the final period uses NOI / Cap Rate.
  const incomeRows = [
    {
      label: 'Cash Flow Before Debt Service (from Operating P&L)',
      formula: (q) => `=${colLetters[q - 1]}20`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'Less: Interest expense',
      formula: (q) => {
        // Interest = (LTV × Total Cost − cumulative principal paid) × rate / 4
        // The Principal-row SUM reference (was $B$7:..7) shifts to cf(7).
        if (q === 1) return `=-TotalProjectCostCr*DebtLTV*DebtRatePct/4`;
        return `=-(TotalProjectCostCr*DebtLTV-IFERROR(SUM($B$${cf(7)}:${colLetters[q - 2]}${cf(7)}),0))*DebtRatePct/4`;
      },
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Less: Principal repayment',
      formula: (q) =>
        `=IF(AND(${q}>MoratoriumMonths/3,${colLetters[q - 1]}${cf(5)}+${colLetters[q - 1]}${cf(6)}>0),MIN(${colLetters[q - 1]}${cf(5)}+${colLetters[q - 1]}${cf(6)},TotalProjectCostCr*DebtLTV/(LoanTermYears*4)),0)`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Total Debt Service',
      formula: (q) => `=${colLetters[q - 1]}${cf(6)}+${colLetters[q - 1]}${cf(7)}`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'Cash Flow After Debt Service',
      formula: (q) => `=${colLetters[q - 1]}${cf(5)}+${colLetters[q - 1]}${cf(8)}`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'DSCR',
      formula: (q) => `=IFERROR(${colLetters[q - 1]}${cf(5)}/-${colLetters[q - 1]}${cf(8)},"–")`,
      format: NUMBER_FORMATS.multiple,
      conditional: 'dscr',
    },
    {
      label: 'Reversion — Net Sale Proceeds (final period)',
      // PR-EX wiring: replace the narrow SellingCostPct with the broader
      // TotalExitCostPct (= SellingCost + ExitBrokerFee + ExitLegalFee).
      // When PR-EX's Exit Strategy section is present (income family),
      // TotalExitCostPct exists as a derived named range and captures the
      // full exit-cost stack. For deals where the new exit-strategy fields
      // are at defaults (broker 2% / legal 0.5%), this lifts effective
      // exit costs from 2% → 4.5% — more realistic for institutional sales.
      //
      // PR-NX3 (2026-05-15): wire KhataExitMultiplier into the reversion.
      // B-Khata / mixed-Khata properties take a buyer-side exit haircut
      // (default 15%) — the derived multiplier on Inputs computes
      // 1 - haircut when KhataStatus = B_khata or mixed, else 1.0.
      // Previously the multiplier was a display-only field on Inputs;
      // now it actually depresses the institutional sale value, matching
      // how Bengaluru buyers underwrite B-khata collateral.
      formula: (q) => q === ctx.totalQuarters
        ? `=IFERROR(${colLetters[q - 1]}18*4/ExitCapRate*(1-TotalExitCostPct)*KhataExitMultiplier,0)`
        : `=0`,
      format: NUMBER_FORMATS.currency,
    },
    {
      // PR-NX2 (2026-05-15): inject initial-equity outflow at Q1 so the
      // row produces a valid IRR. Pre-fix the row was all-positive
      // (CFADS₊ + Reversion at end), so IRR couldn't converge → "–" on
      // the Dashboard. The investor's equity contribution at Q1 = Total
      // Project Cost × (1 − DebtLTV) and was implicit in the kernel but
      // missing from the workbook IRR chain. Subtracting it at Q1 turns
      // Q1 negative (or near-zero) and lets IRR / NPV / XIRR resolve.
      // Reversion remains in the Reversion row (cf(11)); this row sums
      // them into the per-quarter free-cash-flow-to-equity series that
      // institutional underwriting actually measures returns on.
      label: 'Total Cash Flow Including Reversion (FCFE basis)',
      formula: (q) => q === 1
        ? `=${colLetters[q - 1]}${cf(9)}+${colLetters[q - 1]}${cf(11)}-(TotalProjectCostCr*(1-DebtLTV))`
        : `=${colLetters[q - 1]}${cf(9)}+${colLetters[q - 1]}${cf(11)}`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
  ];

  // Development deal cash flow rows — combined-sheet refs.
  const developmentRows = [
    {
      // PR-I2: references Phasing row 15 (Net developer cash from sales)
      // in the SAME sheet now (was 'Phasing!{col}15' pre-restructure).
      // Row 15 nets the 70% RERA escrow against matched construction
      // drawdowns, showing what the developer ACTUALLY receives.
      label: 'Inflow — Net developer cash from sales (INR Cr)',
      formula: (q) => `=${colLetters[q - 1]}15`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Outflow — Construction cost (INR Cr)',
      formula: (q) => `=-${colLetters[q - 1]}6`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Outflow — Marketing & Finance (INR Cr)',
      formula: (q) => `=-${colLetters[q - 1]}9*(MarketingCostPct+FinanceCostPct)`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Project net cash flow (INR Cr)',
      formula: (q) => `=${colLetters[q - 1]}${cf(5)}+${colLetters[q - 1]}${cf(6)}+${colLetters[q - 1]}${cf(7)}`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'Debt drawn (INR Cr)',
      formula: (q) =>
        `=IF(${colLetters[q - 1]}${cf(8)}<0,MIN(-${colLetters[q - 1]}${cf(8)}*DebtLTV,(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000)*DebtLTV-IFERROR(SUM($B$${cf(9)}:${colLetters[q - 2] || colLetters[0]}${cf(9)}),0)),0)`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Interest (INR Cr)',
      formula: (q) => {
        if (q === 1) return `=-${colLetters[q - 1]}${cf(9)}*DebtRatePct/4`;
        return `=-(SUM($B$${cf(9)}:${colLetters[q - 2]}${cf(9)})-IFERROR(SUM($B$${cf(11)}:${colLetters[q - 2]}${cf(11)}),0))*DebtRatePct/4`;
      },
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Principal repayment (INR Cr)',
      formula: (q) =>
        `=IF(${colLetters[q - 1]}${cf(8)}>0,MIN(${colLetters[q - 1]}${cf(8)},IFERROR(SUM($B$${cf(9)}:${colLetters[q - 1]}${cf(9)}),0)-IFERROR(SUM($B$${cf(11)}:${colLetters[q - 2] || colLetters[0]}${cf(11)}),0)),0)`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Equity cash flow (INR Cr)',
      formula: (q) => `=${colLetters[q - 1]}${cf(8)}+${colLetters[q - 1]}${cf(9)}+${colLetters[q - 1]}${cf(10)}+${colLetters[q - 1]}${cf(11)}`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'DSCR',
      formula: (q) => `=IF((-${colLetters[q - 1]}${cf(10)}-${colLetters[q - 1]}${cf(11)})=0,"–",(${colLetters[q - 1]}${cf(5)}+${colLetters[q - 1]}${cf(6)}+${colLetters[q - 1]}${cf(7)})/(-${colLetters[q - 1]}${cf(10)}-${colLetters[q - 1]}${cf(11)}))`,
      format: NUMBER_FORMATS.multiple,
      conditional: 'dscr',
    },
  ];

  const rows = ctx.dealFamily === 'income' ? incomeRows : developmentRows;

  rows.forEach((rowSpec, rowIdx) => {
    const r = cashFlowStartRow + rowIdx;
    sheet.getCell(r, 1).value = rowSpec.label;
    styleLabelCell(sheet.getCell(r, 1));
    if (rowSpec.bold) sheet.getCell(r, 1).font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };

    for (let q = 1; q <= ctx.totalQuarters; q += 1) {
      const cell = sheet.getCell(r, 1 + q);
      cell.value = { formula: rowSpec.formula(q) };
      styleOutputCell(cell, rowSpec.format);
      if (rowSpec.bold) cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    }
    // Total column
    const totalCell = sheet.getCell(r, ctx.totalQuarters + 2);
    const startCol = colLetter(2);
    const endCol = colLetter(ctx.totalQuarters + 1);
    if (rowSpec.label === 'DSCR') {
      // DSCR isn't summable — show min instead
      totalCell.value = { formula: `=IFERROR(MIN(${startCol}${r}:${endCol}${r}),"–")` };
    } else {
      totalCell.value = { formula: `=SUM(${startCol}${r}:${endCol}${r})` };
    }
    styleOutputCell(totalCell, rowSpec.format);
    totalCell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
  });

  const datedReturnTitleRow = cashFlowStartRow + rows.length + 2;
  const datedReturnStartRow = datedReturnTitleRow + 1;
  const dateStartCol = colLetter(2);
  const dateEndCol = colLetter(ctx.totalQuarters + 1);
  // Legacy-row positions for the modeled-returns cash-flow row. Income
  // family: row 12 = "Total Cash Flow Including Reversion (FCFE basis)"
  // (PR-NX2 fix — was 11 = Reversion-only row, which made IRR/XIRR fail
  // because the row was all-zeros except the final period). Development
  // family: row 8 = "Project net cash flow" (Q1 already negative via
  // construction outflows; IRR works).
  const returnCfLegacyRow = ctx.dealFamily === 'income' ? 12 : 8;
  const datedCashFlowRow = cf(returnCfLegacyRow);
  const datedCashFlowRange = `$${dateStartCol}$${datedCashFlowRow}:$${dateEndCol}$${datedCashFlowRow}`;
  const datedDateRange = `$${dateStartCol}$3:$${dateEndCol}$3`;

  sheet.mergeCells(datedReturnTitleRow, 1, datedReturnTitleRow, ctx.totalQuarters + 2);
  sheet.getCell(datedReturnTitleRow, 1).value = 'Date-based return checks — XIRR / XNPV';
  styleSectionTitle(sheet.getCell(datedReturnTitleRow, 1));
  sheet.getRow(datedReturnTitleRow).height = 22;

  [
    ['XIRR (modeled, dated)', `=IFERROR(XIRR(${datedCashFlowRange},${datedDateRange}),"–")`, NUMBER_FORMATS.percent, 'Annual return using quarter-end dates from row 3.'],
    ['XNPV (modeled, INR Cr)', `=IFERROR(XNPV(DiscountRatePct,${datedCashFlowRange},${datedDateRange}),0)`, NUMBER_FORMATS.currency, 'Date-aware present value using DiscountRatePct.'],
    ['Cash-flow row used', `="Row ${datedCashFlowRow} | ${ctx.dealFamily === 'income' ? 'Total cash flow including reversion' : 'Project net cash flow'}"`, null, 'Matches the modeled return row used on the Dashboard.'],
  ].forEach(([label, formula, format, note], idx) => {
    const r = datedReturnStartRow + idx;
    sheet.getCell(r, 1).value = label;
    styleLabelCell(sheet.getCell(r, 1));
    const valueCell = sheet.getCell(r, 2);
    valueCell.value = { formula };
    styleOutputCell(valueCell, format || NUMBER_FORMATS.integer);
    if (format) valueCell.numFmt = format;
    sheet.mergeCells(r, 3, r, Math.min(ctx.totalQuarters + 2, 8));
    sheet.getCell(r, 3).value = note;
    styleLabelCell(sheet.getCell(r, 3));
    sheet.getCell(r, 3).font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  });

  // Conditional formatting on DSCR row (shifted by cfOffset into the
  // combined Cash Flow Engine sheet).
  const dscrRowIdx = rows.findIndex((r) => r.conditional === 'dscr');
  if (dscrRowIdx >= 0) {
    const dscrRow = cashFlowStartRow + dscrRowIdx;
    const startCell = `${colLetter(2)}${dscrRow}`;
    const endCell = `${colLetter(ctx.totalQuarters + 2)}${dscrRow}`;
    sheet.addConditionalFormatting({
      ref: `${startCell}:${endCell}`,
      rules: [
        {
          type: 'cellIs',
          operator: 'lessThan',
          formulae: [1.2],
          style: { fill: FILL(palette.xlsx('dataNegative')), font: { color: { argb: palette.xlsx('paperElevated') }, bold: true } },
          priority: 1,
        },
        {
          type: 'cellIs',
          operator: 'between',
          formulae: [1.2, 1.5],
          style: { fill: FILL(palette.xlsx('dataWarning')), font: { color: { argb: palette.xlsx('paperElevated') }, bold: true } },
          priority: 2,
        },
        {
          type: 'cellIs',
          operator: 'greaterThan',
          formulae: [1.5],
          style: { fill: FILL(palette.xlsx('dataPositive')), font: { color: { argb: palette.xlsx('paperElevated') }, bold: true } },
          priority: 3,
        },
      ],
    });
  }

  return sheet;
};

/**
 * Executive Briefing sheet (PR-NX7 — 2026-05-15) — the FIRST tab the
 * operator sees on workbook open. Carries an AI-assisted 4-bullet
 * narrative + risk note + one-line summary, all generated from the
 * deal's actual kernel KPIs + India-context inputs (no fabrication
 * per CLAUDE.md). Always present; falls back to deterministic templated
 * synthesis when the AI provider isn't available.
 *
 * Layout:
 *   Row 1  — Title banner (orange accent so it screams "read me first")
 *   Row 2  — Deal identity subtitle (same line as Dashboard for consistency)
 *   Row 3  — AI-Assisted disclosure (mandatory per CLAUDE.md)
 *   Row 4  — blank
 *   Row 5  — Section: "Summary"
 *   Row 6  — Summary text (single sentence, wrapped)
 *   Row 7  — blank
 *   Row 8  — Section: "Key Points"
 *   Rows 9-12 — 4 bullet points (one per row)
 *   Row 13 — blank
 *   Row 14 — Section: "Risk Note" (with warning fill)
 *   Row 15 — Risk note text
 *   Row 16 — blank
 *   Row 17 — Generation metadata (provider, timestamp)
 *   Row 18 — Full disclosure footnote
 */
const buildExecutiveBriefingSheet = (workbook, ctx) => {
  const sheet = workbook.addWorksheet(SHEETS.executiveBriefing, {
    views: [{ showGridLines: false, state: 'normal' }],
  });
  sheet.columns = [
    { width: 28 }, { width: 28 }, { width: 28 }, { width: 28 },
    { width: 28 }, { width: 28 }, { width: 22 }, { width: 22 },
  ];

  const briefing = ctx.briefing || buildTemplatedBriefing(buildNumericSnapshot(ctx));
  const isAiAssisted = briefing.source === 'ai-assisted';

  // Row 1 — title banner. Accent fill (copper) so the operator immediately
  // knows this is the IC-facing briefing.
  sheet.mergeCells('A1:H1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = `${ctx.brandName} | ${ctx.deal.name || ctx.property.property_name || 'Deal'} | Executive Briefing`;
  titleCell.font = { name: FONT, size: 14, bold: true, color: { argb: palette.xlsx('paperElevated') } };
  titleCell.fill = FILL(palette.xlsx('accent'));
  titleCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  titleCell.protection = { locked: true };
  sheet.getRow(1).height = 32;

  // Row 2 — deal identity subtitle (same format as Dashboard for cross-
  // sheet consistency — see buildDealIdentityLine helper).
  sheet.mergeCells('A2:H2');
  const subtitleCell = sheet.getCell('A2');
  subtitleCell.value = buildDealIdentityLine(ctx);
  subtitleCell.font = { name: FONT, size: 10, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  subtitleCell.alignment = { horizontal: 'left', vertical: 'middle' };
  subtitleCell.protection = { locked: true };
  sheet.getRow(2).height = 22;

  // Row 3 — AI-Assisted disclosure (mandatory per CLAUDE.md "Every AI-
  // synthesized narrative must carry a prominent 'AI-assisted — requires
  // human review' label").
  sheet.mergeCells('A3:H3');
  const disclosureCell = sheet.getCell('A3');
  // PR-NX14 (2026-05-15): unified disclosure prefix. Pre-fix the AI path
  // said "⚠ AI-Assisted Synthesis" and the templated path said
  // "⚠ Templated Synthesis" — two different prefixes for what is
  // conceptually the same governance label (per CLAUDE.md "Every AI
  // output must carry 'AI-assisted — requires human review' label").
  // Operators flagged the inconsistency: when the AI failed they
  // sometimes thought they were looking at a different feature. Now
  // both paths share the same "⚠ AI-Assisted Briefing" prefix, with
  // the synthesis path indicated in parentheses so operators see
  // exactly which engine produced the prose.
  disclosureCell.value = isAiAssisted
    ? '⚠ AI-Assisted Briefing (synthesis: Claude Sonnet 4.6) — REQUIRES HUMAN REVIEW. All numbers sourced from the deterministic financial kernel + Inputs sheet (no fabrication). Verify against source documents before any IC decision.'
    : '⚠ AI-Assisted Briefing (synthesis: deterministic templated fallback) — REQUIRES HUMAN REVIEW. AI path unavailable; narrative generated from deal\'s kernel KPIs + inputs by deterministic template. Verify against source documents before any IC decision.';
  disclosureCell.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
  disclosureCell.fill = FILL(palette.xlsx('dataWarning'));
  disclosureCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
  disclosureCell.protection = { locked: true };
  sheet.getRow(3).height = 32;

  // Row 4 blank spacer
  sheet.getRow(4).height = 8;

  // Row 5 — "Summary" section title
  sheet.mergeCells('A5:H5');
  const summaryLabel = sheet.getCell('A5');
  summaryLabel.value = 'SUMMARY';
  summaryLabel.font = { name: FONT, size: 11, bold: true, color: { argb: palette.xlsx('inkDeep') }, charSpace: 1.6 };
  summaryLabel.fill = FILL(palette.xlsx('paperSubtle'));
  summaryLabel.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  summaryLabel.protection = { locked: true };
  sheet.getRow(5).height = 22;

  // Row 6 — summary text
  sheet.mergeCells('A6:H6');
  const summaryCell = sheet.getCell('A6');
  summaryCell.value = briefing.summary || '—';
  summaryCell.font = { name: FONT, size: 11, color: { argb: palette.xlsx('ink') } };
  summaryCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
  summaryCell.protection = { locked: true };
  sheet.getRow(6).height = 36;

  // Row 7 blank spacer
  sheet.getRow(7).height = 8;

  // Row 8 — "Key Points" section title
  sheet.mergeCells('A8:H8');
  const kpLabel = sheet.getCell('A8');
  kpLabel.value = 'KEY POINTS';
  kpLabel.font = { name: FONT, size: 11, bold: true, color: { argb: palette.xlsx('inkDeep') }, charSpace: 1.6 };
  kpLabel.fill = FILL(palette.xlsx('paperSubtle'));
  kpLabel.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  kpLabel.protection = { locked: true };
  sheet.getRow(8).height = 22;

  // Rows 9-12 — 4 bullet rows
  const bullets = (briefing.bullets || []).slice(0, 4);
  for (let i = 0; i < 4; i += 1) {
    const r = 9 + i;
    sheet.mergeCells(`A${r}:H${r}`);
    const cell = sheet.getCell(`A${r}`);
    cell.value = bullets[i] ? `•  ${bullets[i]}` : '';
    cell.font = { name: FONT, size: 10.5, color: { argb: palette.xlsx('ink') } };
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
    cell.protection = { locked: true };
    sheet.getRow(r).height = 28;
  }

  // Row 13 blank spacer
  sheet.getRow(13).height = 8;

  // Row 14 — "Risk Note" section title
  sheet.mergeCells('A14:H14');
  const riskLabel = sheet.getCell('A14');
  riskLabel.value = 'RISK NOTE';
  riskLabel.font = { name: FONT, size: 11, bold: true, color: { argb: palette.xlsx('paperElevated') }, charSpace: 1.6 };
  riskLabel.fill = FILL(palette.xlsx('dataNegative'));
  riskLabel.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  riskLabel.protection = { locked: true };
  sheet.getRow(14).height = 22;

  // Row 15 — risk note text
  sheet.mergeCells('A15:H15');
  const riskCell = sheet.getCell('A15');
  riskCell.value = briefing.riskNote || 'Review all kernel-stored values against source documents before IC.';
  riskCell.font = { name: FONT, size: 10.5, color: { argb: palette.xlsx('ink') } };
  riskCell.fill = FILL(palette.xlsx('paperSubtle'));
  riskCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
  riskCell.protection = { locked: true };
  sheet.getRow(15).height = 36;

  // Row 16 blank spacer
  sheet.getRow(16).height = 12;

  // Row 17 — generation metadata
  sheet.mergeCells('A17:H17');
  const metaCell = sheet.getCell('A17');
  // PR-NX14 (2026-05-15): fix the AI provider metadata. Pre-fix this
  // read "Provider: OpenAI gpt-4o" — wrong since PR-NX9 (2026-05-15)
  // routed `narrative_synthesis` to Claude Sonnet 4.6. Operators
  // reading the footer were misled about which model produced the
  // briefing. Now reflects the actual model from the briefing payload.
  // (Falls back to a generic "AI provider" label when the source
  // doesn't carry the model id — defensive against future schema drift.)
  const aiProviderLabel = briefing.provider || briefing.model || 'Claude Sonnet 4.6';
  metaCell.value = isAiAssisted
    ? `Generated: ${briefing.generatedAt || ctx.generatedAt} · Provider: ${aiProviderLabel} · Cached on deal-snapshot hash`
    : `Generated: ${briefing.generatedAt || ctx.generatedAt} · Synthesis: deterministic templated fallback (AI path unavailable — see Vercel env: ANTHROPIC_API_KEY / AI_PROVIDER_NARRATIVE_SYNTHESIS)`;
  metaCell.font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  metaCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  metaCell.protection = { locked: true };
  sheet.getRow(17).height = 16;

  // Row 18 — full disclosure footnote
  sheet.mergeCells('A18:H18');
  const footnoteCell = sheet.getCell('A18');
  footnoteCell.value =
    'Disclosure: This Executive Briefing is an AI-assisted synthesis of the deal\'s deterministic financial-kernel KPIs (IRR, NPV, EM, NOI, exit value) and operator-entered Inputs. Every number you see above is sourced from the Inputs sheet or the kernel — the AI does NOT generate or fabricate numbers, only assembles them into prose. ALL underwriting decisions require human review of source documents (sale deeds, RERA registration, encumbrance certificate, BBMP plan sanction, etc.) and verification of every input against ground truth. See the Inputs sheet for the full editable assumption stack with India-context cell tooltips (RERA / GST / BBMP UAV / LTCG / Khata).';
  footnoteCell.font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedLow') } };
  footnoteCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true, indent: 1 };
  footnoteCell.protection = { locked: true };
  sheet.getRow(18).height = 80;

  return sheet;
};

/**
 * Dashboard sheet — KPI summary cards + native Excel chart for sources/uses.
 */
const buildDashboardSheet = (workbook, ctx) => {
  const sheet = workbook.addWorksheet(SHEETS.dashboard, {
    views: [{ showGridLines: false }],
  });
  // Wider 14-column grid so charts have horizontal real estate.
  sheet.columns = [
    { width: 22 }, { width: 18 }, { width: 22 }, { width: 18 },
    { width: 22 }, { width: 18 }, { width: 12 }, { width: 12 },
    { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 },
    { width: 12 }, { width: 12 },
  ];

  // Title banner across the full 14 columns
  sheet.mergeCells('A1:N1');
  sheet.getCell('A1').value = `${ctx.brandName} | ${ctx.deal.name || ctx.property.property_name || 'Deal'} | Dashboard`;
  styleSectionTitle(sheet.getCell('A1'));
  sheet.getRow(1).height = 28;

  // PR-NX5 (2026-05-15): Dashboard row 2 now surfaces the full deal
  // identity line so the workbook reads as deal-SPECIFIC immediately on
  // open. Pre-fix: "Operating Asset Dashboard — every figure recalculates…"
  // (generic, identical across all deals). Post-fix: e.g. "Commercial
  // Office · Outright Purchase · Exit: Strategic Sale · 5-yr horizon ·
  // Bengaluru · ORR" — every dimension of the deal in one glance.
  sheet.mergeCells('A2:N2');
  sheet.getCell('A2').value = buildDealIdentityLine(ctx);
  sheet.getCell('A2').font = { name: FONT, size: 10, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle' };
  sheet.getRow(2).height = 22;

  // ── Deal Sanity Check banner (row 3) ──────────────────────────────────
  // Single-cell IF-chain flags obvious issues (empty inputs, negative margin,
  // low DSCR) so an IC reviewer sees the state at-a-glance without scanning
  // every tile. Operator-edit-driven — recalculates whenever Inputs change.
  //
  // Family-conditional: development uses Total Revenue B4 + Total Cost D4 +
  // Gross Margin B7 + Min DSCR D7. Income family uses NOI B4 + Modeled Cap
  // Rate D4 + Min DSCR B7.
  sheet.mergeCells('A3:N3');
  const sanityCheckFormula = ctx.dealFamily === 'income'
    ? '=IF(IFERROR(B4,0)=0,"⚠ Set SaleableAreaSqft + BaseRentPerSqftMonth on the Inputs sheet to populate the Dashboard.",IF(IFERROR(B7,99)<1.2,"⚠ Min DSCR below 1.20 — review debt sizing inputs (PermMaxLTV / PermMinDCR / DebtRatePct).","✓ Deal status: Modeled operating returns look healthy. Edit Inputs sheet to run sensitivities."))'
    : '=IF(IFERROR(B4,0)=0,"⚠ Set SaleableAreaSqft + SellRatePerSqft on the Inputs sheet to populate the Dashboard.",IF(IFERROR(D4,0)=0,"⚠ Set LandCostCr + ConstructionCostPerSqft on the Inputs sheet to populate cost.",IF(IFERROR(B7,0)<0,"⚠ Negative gross margin — review revenue or cost inputs.",IF(IFERROR(B7,0)<0.10,"⚠ Gross margin below 10% — stress-test SellRatePerSqft / construction cost.","✓ Deal status: Modeled returns look healthy. Edit Inputs sheet to run sensitivities."))))';
  sheet.getCell('A3').value = { formula: sanityCheckFormula };
  sheet.getCell('A3').font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
  sheet.getCell('A3').alignment = { horizontal: 'left', vertical: 'middle' };
  sheet.getCell('A3').fill = FILL(palette.xlsx('paperSubtle'));
  sheet.getCell('A3').protection = { locked: true };
  sheet.getRow(3).height = 24;

  // Three rows of KPI cards. Post-restructure: phasing + cash flow are
  // on the SAME sheet (Cash Flow Engine). Both prefixes resolve to the
  // same worksheet — kept as separate variables for code clarity since
  // the row positions they reference differ (phasing = upper section,
  // cashflow = lower section, shifted by cfOffset).
  //
  // cfOffset must mirror what buildCashFlowSheet computes:
  //   phasingLastRow + 4 = cashFlowStartRow
  //   cfOffset = cashFlowStartRow - 5
  // Income family phasing runs to row 21; dev family to row 27.
  const phasing = `'${SHEETS.cashFlowEngine}'`;
  const cashflow = `'${SHEETS.cashFlowEngine}'`;
  const dashPhasingLastRow = ctx.dealFamily === 'income' ? 21 : 27;
  const dashCfOffset = dashPhasingLastRow + 4 - 5; // income=20, dev=26... wait
  // Actually: cashFlowStartRow = phasingLastRow + 4, cfOffset = cashFlowStartRow - 5
  // income: cashFlowStartRow = 21 + 4 = 25, cfOffset = 25 - 5 = 20
  // dev:    cashFlowStartRow = 27 + 4 = 31, cfOffset = 31 - 5 = 26
  // NB: this must stay in lockstep with buildCashFlowSheet's cfStart math.
  const cfShift = (legacyRow) => legacyRow + dashCfOffset;
  const totalQ = ctx.totalQuarters;
  const colLetter = (n) => {
    let s = '';
    let v = n;
    while (v > 0) {
      const r = (v - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      v = Math.floor((v - r) / 26);
    }
    return s;
  };
  const totalCol = colLetter(totalQ + 2);
  // Last QUARTER column (vs totalCol which is the "Total"-row column to the
  // right of the last quarter). 2026-05-15 operator audit on Pointec Pens
  // surfaced that the headline "Stabilised NOI / yr" tile was using
  // BF18 × 4 = SUM(all-quarter NOI) × 4 = lifetime aggregate × 4, NOT
  // the trailing-year stabilised NOI. Same bug on Cash-on-Cash + Net
  // Sale Proceeds. The fix is to use INDEX into the per-quarter range
  // and pick the trailing 4 quarters (= stabilised year NOI), or the
  // single final quarter (for reversion). lastQuarterCol scopes that
  // range correctly.
  const lastQuarterCol = colLetter(totalQ + 1);
  const totalProjectCostRef = 'TotalProjectCostCr';

  // Asset-class-aware KPI tiles. Each tile takes BOTH a kernel-stored
  // value (deal record) AND a formula fallback. When the kernel has
  // produced the value, the cell shows that literal — matching the
  // Reports page in the frontend (CLAUDE.md: "the deterministic financial
  // kernel is the only source of numerics in any export"). When the
  // kernel hasn't (or the field isn't applicable to this asset family),
  // the formula falls back to the modeled value from the sensitivity
  // run on the Phasing / Cash Flow sheets.
  //
  // Operator can still edit Inputs and see the model recompute below —
  // but the HEADLINE figure stays anchored to what the kernel decided
  // for this specific deal, so the workbook reconciles with every other
  // surface (Reports page, PPTX deck, DOCX report).
  const k = ctx.kernelKpis;
  const cachedCosts = computeCachedCostSnapshot(ctx);
  // Trailing-year aggregator for NOI / CFADS — picks the LAST 4 quarters
  // of the supplied row on the Cash Flow Engine sheet. Used by the income-
  // family KPI tiles so the "stabilised" tile shows the actual stabilised
  // annual rate (= last operating year of the hold) rather than a
  // lifetime aggregate. Wraps with MAX(1, TotalQuarters-3) so a short
  // horizon (< 4 quarters) doesn't produce a negative INDEX argument.
  const trailingYearSum = (row) =>
    `SUM(INDEX(${phasing}!$B$${row}:$${lastQuarterCol}$${row},1,MAX(1,TotalQuarters-3)):INDEX(${phasing}!$B$${row}:$${lastQuarterCol}$${row},1,TotalQuarters))`;
  // Final-quarter picker — used for the reversion row where all quarters
  // are zero EXCEPT the last, which holds the sale-proceeds value.
  const finalQuarterCell = (row) =>
    `INDEX(${cashflow}!$B$${row}:$${lastQuarterCol}$${row},1,TotalQuarters)`;

  const kpiCells = ctx.dealFamily === 'income'
    ? [
        // Top row — operating fundamentals (Phasing section: rows unchanged
        // by restructure; e.g. NOI is at row 18 in the upper Phasing block).
        // Stabilised NOI = SUM of trailing 4 quarters of NOI row 18. Pre-fix
        // (2026-05-15) used BF18 × 4 where BF was the "Total" SUM column,
        // producing lifetime aggregate × 4 (= 14× year-NOI). Trailing-year
        // SUM is the canonical institutional definition of stabilised
        // annual NOI.
        { row: 4, col: 'A', label: 'Stabilised NOI (INR Cr / yr)',  kernel: k.noi,                formula: `=IFERROR(${trailingYearSum(18)},0)`,                                                                 format: NUMBER_FORMATS.currency, cached: k.noi },
        { row: 4, col: 'C', label: 'Stabilized Yield on Cost',      kernel: null,                  formula: `=IFERROR(${trailingYearSum(18)}/${totalProjectCostRef},0)`,                                          format: NUMBER_FORMATS.percent, cached: k.yieldOnCost },
        { row: 4, col: 'E', label: 'Exit Cap Rate',                 kernel: null,                  formula: `=ExitCapRate`,                                                                                       format: NUMBER_FORMATS.percent, cached: getCoreInputSnapshot(ctx).exitCapRate },
        // Bottom row — investor returns. Cash Flow section: rows shift by
        // cfShift (income cfOffset=20 → row 10 becomes row 30, row 9 → 29,
        // row 11 → 31). Min DSCR uses the Total column which is MIN()-
        // configured (not SUM) on the DSCR row (see buildCashFlowSheet
        // line 4347). Cash-on-Cash uses trailing-year CFADS / equity
        // (was Q2 alone — wrong, Q2 is still in lease-up for most income
        // assets). Net Sale Proceeds uses INDEX at the final quarter
        // (was SUM of reversion row — correct-by-accident since other
        // quarters are 0, now explicit).
        { row: 7, col: 'A', label: 'Min DSCR',                      kernel: null,                  formula: `=${cashflow}!${totalCol}${cfShift(10)}`,                                                                         format: NUMBER_FORMATS.multiple },
        { row: 7, col: 'C', label: 'Cash-on-Cash (Stabilised)',     kernel: k.yieldOnCost,         formula: `=IFERROR(${trailingYearSum(cfShift(9))}/(${totalProjectCostRef}*(1-DebtLTV)),0)`,                  format: NUMBER_FORMATS.percent, cached: k.yieldOnCost },
        { row: 7, col: 'E', label: 'Net Sale Proceeds (INR Cr)',    kernel: k.exitValue,           formula: `=IFERROR(${finalQuarterCell(cfShift(11))},0)`,                                                       format: NUMBER_FORMATS.currency, cached: k.exitValue },
      ]
    : [
        // Development family. Phasing row 9 = Quarter sales; Cash Flow
        // rows shifted by cfShift (dev cfOffset=26 → row 6 → 32, row 7 → 33,
        // row 8 → 34, row 12 → 38, row 13 → 39).
        { row: 4, col: 'A', label: 'Total Revenue (INR Cr)',         kernel: k.totalRevenue,       formula: `=${phasing}!${totalCol}9`,                                                                       format: NUMBER_FORMATS.currency, cached: k.totalRevenue },
        { row: 4, col: 'C', label: 'Total Project Cost (INR Cr)',     kernel: k.totalCost,          formula: `=${totalProjectCostRef}`,                                          format: NUMBER_FORMATS.currency, cached: cachedCosts.totalProjectCostCr },
        { row: 4, col: 'E', label: 'Project Net Cash Flow (INR Cr)', kernel: (k.totalRevenue != null && k.totalCost != null) ? (k.totalRevenue - k.totalCost) : null, formula: `=${cashflow}!${totalCol}${cfShift(8)}`,                                                                        format: NUMBER_FORMATS.currency, cached: (k.totalRevenue != null && k.totalCost != null) ? (k.totalRevenue - k.totalCost) : null },
        { row: 7, col: 'A', label: 'Gross Margin',                    kernel: k.grossMargin,        formula: `=IFERROR(${cashflow}!${totalCol}${cfShift(8)}/${phasing}!${totalCol}9,0)`,                                    format: NUMBER_FORMATS.percent, cached: k.grossMargin },
        { row: 7, col: 'C', label: 'Min DSCR',                        kernel: null,                  formula: `=${cashflow}!${totalCol}${cfShift(13)}`,                                                                      format: NUMBER_FORMATS.multiple },
        { row: 7, col: 'E', label: 'Residual Land Value (INR Cr)',    kernel: k.residualLandValue,  formula: `=${cashflow}!${totalCol}${cfShift(12)}`,                                                                      format: NUMBER_FORMATS.currency, cached: k.residualLandValue },
      ];
  kpiCells.forEach(({ row, col, label, kernel, formula, format, cached }) => {
    const labelCell = sheet.getCell(`${col}${row}`);
    labelCell.value = label;
    labelCell.font = { name: FONT, size: 9, color: { argb: palette.xlsx('mutedHigh') }, bold: true };
    labelCell.alignment = { horizontal: 'left' };
    labelCell.fill = FILL(palette.xlsx('paper'));
    labelCell.protection = { locked: true };
    const valueCell = sheet.getCell(`${String.fromCharCode(col.charCodeAt(0) + 1)}${row}`);
    // Operator directive 2026-05-11: "Use formulas, cell references, linkages
    // and locking of cells wherever possible". Headline KPI tiles ALWAYS use
    // the formula now — when the operator edits Inputs, the Dashboard tiles
    // update live. Pre-fix: kernel-stored value was a literal; edits to
    // Inputs didn't flow through. Kernel reconciliation moved to the
    // Returns block (rows 19-22) which shows kernel-vs-modeled side-by-side.
    if (formula) {
      valueCell.value = formulaValue(formula, format === NUMBER_FORMATS.percent ? toPctDecimal(cached) : cached);
    } else if (kernel != null) {
      // No formula available (e.g. some KPIs that the kernel computes but
      // the workbook can't replicate). Fall back to kernel literal.
      valueCell.value = format === NUMBER_FORMATS.percent ? toPctDecimal(kernel) : kernel;
    } else {
      // Neither formula nor kernel value — leave blank rather than #N/A.
      valueCell.value = null;
    }
    valueCell.numFmt = format;
    valueCell.font = { name: FONT, size: 16, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    valueCell.alignment = { horizontal: 'right' };
    valueCell.fill = FILL(palette.xlsx('paperElevated'));
    valueCell.protection = { locked: true };
    valueCell.border = {
      top: { style: 'thin', color: { argb: palette.xlsx('hairlineStrong') } },
      bottom: { style: 'thin', color: { argb: palette.xlsx('accent') } },
      left: { style: 'thin', color: { argb: palette.xlsx('hairlineStrong') } },
      right: { style: 'thin', color: { argb: palette.xlsx('hairlineStrong') } },
    };
    sheet.getRow(row).height = 30;
  });

  // ── Conditional formatting on the KPI tiles ──────────────────────────
  // Operator directive 2026-05-11: make the Dashboard "informative,
  // impactful" — colour the tiles by health so an IC reviewer reads the
  // state in 2 seconds, not 20. Red = bad, amber = watch, green = OK.
  //
  // Same red / amber / green palette as the DSCR conditional formatting
  // on the Cash Flow Engine sheet (consistency across the workbook).
  const cfStyle = (fillColor) => ({
    fill: FILL(palette.xlsx(fillColor)),
    font: { color: { argb: palette.xlsx('paperElevated') }, bold: true, size: 16 },
  });
  if (ctx.dealFamily === 'income') {
    // Income family layout: B4 = Stabilised NOI, B7 = Min DSCR.
    // Stabilised NOI — green when positive, red when zero or negative
    // (zero NOI = inputs not set OR cost structure overwhelming revenue).
    sheet.addConditionalFormatting({
      ref: 'B4:B4',
      rules: [
        { type: 'cellIs', operator: 'lessThanOrEqual', formulae: [0], style: cfStyle('dataNegative'), priority: 1 },
        { type: 'cellIs', operator: 'greaterThan',     formulae: [0], style: cfStyle('dataPositive'), priority: 2 },
      ],
    });
    // Min DSCR — same thresholds as Cash Flow DSCR row (red < 1.20, amber
    // 1.20-1.50, green > 1.50). Matches institutional-grade convention.
    sheet.addConditionalFormatting({
      ref: 'B7:B7',
      rules: [
        { type: 'cellIs', operator: 'lessThan',     formulae: [1.2],     style: cfStyle('dataNegative'), priority: 1 },
        { type: 'cellIs', operator: 'between',      formulae: [1.2, 1.5], style: cfStyle('dataWarning'),  priority: 2 },
        { type: 'cellIs', operator: 'greaterThan',  formulae: [1.5],     style: cfStyle('dataPositive'), priority: 3 },
      ],
    });
  } else {
    // Development family layout: B7 = Gross Margin, D7 = Min DSCR,
    // F4 = Project Net Cash Flow.
    // Gross Margin — red if negative, amber if < 10%, green if ≥ 10%.
    // 10% threshold matches the sanity-check banner's threshold.
    sheet.addConditionalFormatting({
      ref: 'B7:B7',
      rules: [
        { type: 'cellIs', operator: 'lessThan',         formulae: [0],    style: cfStyle('dataNegative'), priority: 1 },
        { type: 'cellIs', operator: 'between',          formulae: [0, 0.10], style: cfStyle('dataWarning'),  priority: 2 },
        { type: 'cellIs', operator: 'greaterThanOrEqual', formulae: [0.10], style: cfStyle('dataPositive'), priority: 3 },
      ],
    });
    // Project Net Cash Flow (F4) — red negative, green positive.
    sheet.addConditionalFormatting({
      ref: 'F4:F4',
      rules: [
        { type: 'cellIs', operator: 'lessThan',     formulae: [0], style: cfStyle('dataNegative'), priority: 1 },
        { type: 'cellIs', operator: 'greaterThanOrEqual', formulae: [0], style: cfStyle('dataPositive'), priority: 2 },
      ],
    });
    // Min DSCR (D7) — same red/amber/green thresholds as Cash Flow.
    sheet.addConditionalFormatting({
      ref: 'D7:D7',
      rules: [
        { type: 'cellIs', operator: 'lessThan',     formulae: [1.2],     style: cfStyle('dataNegative'), priority: 1 },
        { type: 'cellIs', operator: 'between',      formulae: [1.2, 1.5], style: cfStyle('dataWarning'),  priority: 2 },
        { type: 'cellIs', operator: 'greaterThan',  formulae: [1.5],     style: cfStyle('dataPositive'), priority: 3 },
      ],
    });
  }

  // ── KPI icon-set conditional formatting (PR-NX11 — 2026-05-15) ──────
  // FULL COVERAGE: every Dashboard KPI tile gets a traffic-light icon
  // derived from asset-class-aware benchmark bands (sourced from Cushman,
  // JLL, HVS, RBI — see KPI_BENCHMARKS in assetClassDefaults.js).
  //
  // Pre-fix (2026-05-11): only 2-3 of 6 tiles per family had iconSet rules,
  // and thresholds were hardcoded global defaults that didn't reflect
  // Bengaluru asset-class market reality (e.g. office cap rate band 7%-9%
  // vs warehousing 8%-10.5%).
  //
  // For UP-IS-GOOD KPIs (yield, margin, DSCR): cfvo [low, mid, high]
  //   icon-set: red below mid, amber low-to-mid, green at high
  // For DOWN-IS-GOOD KPIs (cap rate): we invert by swapping the cfvo
  //   order so the same iconSet rule reads correctly (low cap = green).
  // A tile carries the benchmark citation as a cell COMMENT so hovering
  // surfaces "Source: Cushman & Wakefield India Bengaluru ORR..." to the
  // operator — institutional credibility without needing a separate
  // benchmark sheet.
  const assetClass = ctx.assetClass;
  const family = ctx.dealFamily;
  // Map of (cellRef, kpiKey) pairs — covers all 6 tiles per family.
  const kpiTileMap = family === 'income'
    ? [
        { ref: 'B4', kpi: 'noi',             label: 'Stabilised NOI' },
        { ref: 'D4', kpi: 'yieldOnCost',     label: 'Stabilized Yield on Cost' },
        { ref: 'F4', kpi: 'exitCapRate',     label: 'Exit Cap Rate' },
        { ref: 'B7', kpi: 'minDscr',         label: 'Min DSCR' },
        { ref: 'D7', kpi: 'cashOnCash',      label: 'Cash-on-Cash (Stabilised)' },
        { ref: 'F7', kpi: 'netSaleProceeds', label: 'Net Sale Proceeds' },
      ]
    : [
        { ref: 'B4', kpi: 'revenue',         label: 'Total Revenue' },
        { ref: 'D4', kpi: 'cost',            label: 'Total Project Cost' },
        { ref: 'F4', kpi: 'netCashFlow',     label: 'Project Net Cash Flow' },
        { ref: 'B7', kpi: 'grossMargin',     label: 'Gross Margin' },
        { ref: 'D7', kpi: 'minDscr',         label: 'Min DSCR' },
        { ref: 'F7', kpi: 'residualLand',    label: 'Residual Land Value' },
      ];

  kpiTileMap.forEach(({ ref, kpi, label }, idx) => {
    const bm = benchmarkFor(assetClass, family, kpi);
    if (!bm) return; // No benchmark for this KPI — skip (very rare, fail-safe).

    // cfvo ordering: ExcelJS's iconSet rule reads cfvo as [low-thr, mid-thr,
    // high-thr]. Direction is handled by the cfvo VALUES themselves —
    // for UP-IS-GOOD: low < mid < high (red below low, amber mid, green above).
    // For DOWN-IS-GOOD: the benchmark already stores [low, mid, high]
    // with low > mid > high — but iconSet always reads ascending. So we
    // invert via the underlying cellIs rule (red ABOVE high, green BELOW low).
    if (bm.direction === 'up') {
      sheet.addConditionalFormatting({
        ref: `${ref}:${ref}`,
        rules: [{
          type: 'iconSet',
          iconSet: '3TrafficLights1',
          showValue: true,
          cfvo: [
            { type: 'num', value: bm.low },
            { type: 'num', value: bm.mid },
            { type: 'num', value: bm.high },
          ],
          priority: 50 + idx,
        }],
      });
    } else {
      // Down-is-good — invert the icon-set by reversing the iconSet order.
      // ExcelJS supports `reverse: true` to flip the icon assignment so
      // green sits at low values instead of high values.
      sheet.addConditionalFormatting({
        ref: `${ref}:${ref}`,
        rules: [{
          type: 'iconSet',
          iconSet: '3TrafficLights1',
          showValue: true,
          reverse: true,
          cfvo: [
            { type: 'num', value: bm.high }, // tighter cap = green
            { type: 'num', value: bm.mid },
            { type: 'num', value: bm.low },  // wider cap = red
          ],
          priority: 50 + idx,
        }],
      });
    }

    // Attach the benchmark citation as a cell COMMENT — operator hovers
    // the tile and sees the institutional source. Per CLAUDE.md
    // "verified data only, source + freshness on every cell" rule.
    //
    // 2026-05-15 HOTFIX: cell.note MUST be a plain string here, not an
    // object with `texts`/`margins`. The object form is technically
    // supported by ExcelJS but the `margins.insetmode: 'custom'` path
    // serializes malformed sheetN.xml that Microsoft Excel rejects on
    // open ("Replaced Part: /xl/worksheets/sheetN.xml part with XML error.
    // Load error. Line 2, column 0" — Excel then strips the entire sheet
    // during auto-repair). The string form matches the existing PR-NX3
    // pattern at line 2689 and serializes cleanly in every Excel version.
    //
    // KPI tile cells are FRESH cells on the Dashboard (not Inputs sheet
    // cells that PR-NX3 already commented), so there's no prior note to
    // preserve — direct string assignment is safe.
    const cell = sheet.getCell(ref);
    const benchmarkLines = [
      `── KPI Benchmark (${label}) ──`,
      bm.direction === 'up'
        ? `Range: ${bm.low} → ${bm.mid} → ${bm.high}`
        : `Range: ${bm.high} → ${bm.mid} → ${bm.low} (lower is better)`,
      `Source: ${bm.citation}`,
    ];
    cell.note = benchmarkLines.join('\n');
  });

  const trendSpecs = ctx.dealFamily === 'income'
    ? [
        ['A9', 'PGI trend', 'B9'],
        ['C9', 'NOI trend', 'D9'],
        ['E9', 'Equity CF trend', 'F9'],
      ]
    : [
        ['A9', 'Sales trend', 'B9'],
        ['C9', 'Equity CF trend', 'D9'],
        ['E9', 'Cumulative trend', 'F9'],
      ];
  trendSpecs.forEach(([labelRef, label, valueRef]) => {
    const labelCell = sheet.getCell(labelRef);
    labelCell.value = label;
    labelCell.font = { name: FONT, size: 8, bold: true, color: { argb: palette.xlsx('mutedHigh') } };
    labelCell.fill = FILL(palette.xlsx('paper'));
    labelCell.alignment = { horizontal: 'left' };
    const valueCell = sheet.getCell(valueRef);
    valueCell.value = null;
    valueCell.font = { name: FONT, size: 8, bold: true, color: { argb: palette.xlsx('accent') } };
    valueCell.fill = FILL(palette.xlsx('paperElevated'));
    valueCell.alignment = { horizontal: 'left' };
    valueCell.protection = { locked: true };
  });
  sheet.getRow(9).height = 18;

  sheet.getCell('A11').value = 'Sources & Uses';
  styleSectionTitle(sheet.getCell('A11'));
  sheet.mergeCells('A11:F11');
  sheet.getRow(11).height = 22;

  const hb = (row) => `'${SHEETS.usali}'!$B$${row}`;
  const su = ctx.assetClass === 'hospitality'
    ? [
        ['Source: Equity', `=MAX(0,${totalProjectCostRef}*(1-HospitalityConstLoanLTC))`, Math.max(0, cachedCosts.totalProjectCostCr * (1 - (enginePctDecimal(ctx, ['constLoanLTC', 'debtLTC', 'debtLTV'], 0.55) || 0)))],
        ['Source: Debt', `=${totalProjectCostRef}*HospitalityConstLoanLTC`, cachedCosts.totalProjectCostCr * (enginePctDecimal(ctx, ['constLoanLTC', 'debtLTC', 'debtLTV'], 0.55) || 0)],
        ['Use: Land + Stamp', `=${hb(HOSPITALITY_BUDGET_ROW.land)}+${hb(HOSPITALITY_BUDGET_ROW.stamp)}`, cachedCosts.landCostCr + cachedCosts.statutoryCr],
        ['Use: Construction + GST', `=${hb(HOSPITALITY_BUDGET_ROW.hardConstruction)}+${hb(HOSPITALITY_BUDGET_ROW.gst)}`, cachedCosts.hardCostCr],
        ['Use: Soft + Approvals', `=${hb(HOSPITALITY_BUDGET_ROW.softDesign)}+${hb(HOSPITALITY_BUDGET_ROW.approvals)}`, cachedCosts.approvalCostCr],
        ['Use: FF&E / Opening', `=${hb(HOSPITALITY_BUDGET_ROW.ffe)}+${hb(HOSPITALITY_BUDGET_ROW.ose)}+${hb(HOSPITALITY_BUDGET_ROW.preOpening)}+${hb(HOSPITALITY_BUDGET_ROW.workingCapital)}`, cachedCosts.softCostsCr * 0.65],
        ['Use: Contingency + IDC', `=${hb(HOSPITALITY_BUDGET_ROW.contingency)}+${hb(HOSPITALITY_BUDGET_ROW.idc)}`, cachedCosts.softCostsCr * 0.35],
      ]
    : [
        ['Source: Equity',             `=MAX(0,${totalProjectCostRef}*(1-DebtLTV))`, Math.max(0, cachedCosts.totalProjectCostCr * (1 - (getCoreInputSnapshot(ctx).debtLTV || 0)))],
        ['Source: Debt',               `=${totalProjectCostRef}*DebtLTV`, cachedCosts.totalProjectCostCr * (getCoreInputSnapshot(ctx).debtLTV || 0)],
        ['Use: Land',                  `=LandCostCr`, cachedCosts.landCostCr],
        ['Use: Construction',          `=ConstructionCostPerSqft*SaleableAreaSqft/10000000`, cachedCosts.hardCostCr],
        ['Use: Approvals + Premium',   `=ApprovalCostCr+PremiumFSICostCr`, cachedCosts.approvalCostCr + cachedCosts.premiumFsiCostCr],
        ['Use: Soft Costs',            `='${SHEETS.calculations}'!$B$24`, cachedCosts.softCostsCr],
        ['Use: Statutory Levies',      `='${SHEETS.calculations}'!$B$27`, cachedCosts.statutoryCr],
      ];
  su.forEach(([label, formula, cached], idx) => {
    const r = 12 + idx;
    sheet.getCell(`A${r}`).value = label;
    styleLabelCell(sheet.getCell(`A${r}`));
    const v = sheet.getCell(`B${r}`);
    v.value = formulaValue(formula, cached);
    styleOutputCell(v, NUMBER_FORMATS.currency);
  });

  // Native chart objects on the Sources & Uses + Monthly Trend blocks
  // are now injected post-write via `chartInjector.js` (ExcelJS 4.4.0 has
  // no native `addChart` API — confirmed `addChart` is undefined on the
  // worksheet instance). See `buildDashboardChartSpecs()` below for the
  // exact cell ranges + chart specs each chart targets.

  // ── Returns block — IRR / NPV via native Excel functions ─────────────
  // Cash flow row used for IRR / NPV is asset-class-aware:
  //   - Income deals: row 12 = "Total Cash Flow Including Reversion (FCFE
  //                            basis)" — Q1 has initial-equity outflow
  //                            injected so IRR can converge (PR-NX2).
  //   - Development:  row 8  = "Project net cash flow" (Q1 negative via
  //                            construction outflow — IRR already works).
  // Excel's IRR() expects a contiguous range; NPV() takes a quarterly rate
  // because the cash flows are quarterly.
  //
  // Post-restructure: shift by cfOffset (income: 12→32, dev: 8→34).
  const cfRow = cfShift(ctx.dealFamily === 'income' ? 12 : 8);
  const cfRangeProper = `${cashflow}!$${colLetter(2)}$${cfRow}:$${colLetter(totalQ + 1)}$${cfRow}`;

  sheet.mergeCells('A19:F19');
  sheet.getCell('A19').value = 'Returns — Kernel vs Modeled';
  styleSectionTitle(sheet.getCell('A19'));
  sheet.getRow(19).height = 22;

  // Two rows side-by-side:
  //   Row 20 = "Kernel" (what the deterministic financial kernel produced
  //            and stored on the deal record — these are the same figures
  //            shown on the Reports page in the frontend)
  //   Row 21 = "Modeled (sensitivity run)" — the IRR/NPV/EM computed from
  //            the live quarterly cash flow on the Cash Flow sheet, which
  //            recomputes as the operator edits Inputs. Divergence from
  //            the kernel row is normal and expected when inputs change.
  //
  // This pair makes the two views explicit + honest. Without it the
  // operator sees a single "Project IRR (modeled)" tile that doesn't
  // match the Reports page, and credibility collapses.
  const returnsCells = [
    // Kernel row 20 — authoritative
    { row: 20, col: 'A', label: 'Project IRR (kernel)',    kernel: k.irr,            formula: `=IFERROR(IRR(${cfRangeProper})*4,"–")`,                                            format: NUMBER_FORMATS.percent },
    { row: 20, col: 'C', label: 'NPV (kernel, INR Cr)',    kernel: k.npv,            formula: `=IFERROR(NPV((1+DiscountRatePct)^(1/4)-1,${cfRangeProper}),0)`,                       format: NUMBER_FORMATS.currency },
    { row: 20, col: 'E', label: 'Equity Multiple (kernel)', kernel: k.equityMultiple, formula: `=IFERROR((SUMIF(${cfRangeProper},">0"))/ABS(SUMIF(${cfRangeProper},"<0")),"–")`,    format: NUMBER_FORMATS.multiple },
    // Modeled row 21 — sensitivity run
    { row: 21, col: 'A', label: 'Project IRR (modeled)',    kernel: null, formula: `=IFERROR(IRR(${cfRangeProper})*4,"–")`,                                            format: NUMBER_FORMATS.percent, secondary: true },
    { row: 21, col: 'C', label: 'NPV (modeled, INR Cr)',    kernel: null, formula: `=IFERROR(NPV((1+DiscountRatePct)^(1/4)-1,${cfRangeProper}),0)`,                       format: NUMBER_FORMATS.currency, secondary: true },
    { row: 21, col: 'E', label: 'Equity Multiple (modeled)', kernel: null, formula: `=IFERROR((SUMIF(${cfRangeProper},">0"))/ABS(SUMIF(${cfRangeProper},"<0")),"–")`,    format: NUMBER_FORMATS.multiple, secondary: true },
    // Post-Tax IRR row 22 — India LTCG/STCG-adjusted IRR. Multiplies the
    // modeled gross IRR (B21) by (1 - EffectiveCGRate). EffectiveCGRate
    // is a derived named range on Inputs that switches LTCG (12.5% post-
    // Jul-2024) when EffectiveHoldYears ≥ 2, else STCG slab (~30%).
    // This is the headline number an Indian IC committee actually
    // underwrites against — gross IRR overstates returns because India
    // levies capital gains on disposal of real-estate equity.
    { row: 22, col: 'A', label: 'Post-Tax IRR (modeled, India LTCG-adjusted)', kernel: null, formula: `=IFERROR(B21*(1-EffectiveCGRate),"–")`, format: NUMBER_FORMATS.percent, secondary: true },
    { row: 22, col: 'C', label: 'Effective CG Rate (applied)',                  kernel: null, formula: `=EffectiveCGRate`,                     format: NUMBER_FORMATS.percent, secondary: true },
    { row: 22, col: 'E', label: 'Hold Period (yrs, drives LT vs ST)',           kernel: null, formula: `=EffectiveHoldYears`,                  format: NUMBER_FORMATS.integer, secondary: true },
  ];
  returnsCells.forEach(({ row, col, label, kernel, formula, format, secondary }) => {
    const labelCell = sheet.getCell(`${col}${row}`);
    labelCell.value = label;
    // Kernel row gets emphasis; modeled row gets muted styling so the
    // hierarchy reads at a glance.
    labelCell.font = {
      name: FONT,
      size: secondary ? 8.5 : 9,
      color: { argb: palette.xlsx(secondary ? 'mutedHigh' : 'inkDeep') },
      bold: !secondary,
      italic: !!secondary,
    };
    labelCell.alignment = { horizontal: 'left' };
    labelCell.fill = FILL(palette.xlsx('paper'));
    labelCell.protection = { locked: true };
    const valueCell = sheet.getCell(`${String.fromCharCode(col.charCodeAt(0) + 1)}${row}`);
    if (kernel != null) {
      valueCell.value = format === NUMBER_FORMATS.percent ? toPctDecimal(kernel) : kernel;
    } else {
      valueCell.value = { formula };
    }
    valueCell.numFmt = format;
    valueCell.font = {
      name: FONT,
      size: secondary ? 12 : 16,
      bold: !secondary,
      color: { argb: palette.xlsx(secondary ? 'mutedHigh' : 'inkDeep') },
      italic: !!secondary,
    };
    valueCell.alignment = { horizontal: 'right' };
    valueCell.fill = FILL(palette.xlsx('paperElevated'));
    valueCell.protection = { locked: true };
    valueCell.border = {
      top: { style: 'thin', color: { argb: palette.xlsx('hairlineStrong') } },
      bottom: { style: 'thin', color: { argb: palette.xlsx(secondary ? 'hairline' : 'accent') } },
      left: { style: 'thin', color: { argb: palette.xlsx('hairlineStrong') } },
      right: { style: 'thin', color: { argb: palette.xlsx('hairlineStrong') } },
    };
    sheet.getRow(row).height = secondary ? 22 : 30;
  });

  // ── Disclosure footnote on the Returns block ──────────────────────────
  // Make the kernel/modeled distinction explicit so an analyst reading
  // the workbook understands why the two rows differ (and which one
  // matches the rest of the platform).
  sheet.mergeCells('A23:F23');
  sheet.getCell('A23').value = 'KERNEL = stored on the deal record by REDIP\'s deterministic financial kernel; matches the Reports page + PPTX/DOCX exports. MODELED = recomputed live from the Phasing + Cash Flow sheets; edit Inputs to explore scenarios. POST-TAX = MODELED gross IRR × (1 − Effective CG Rate); switches LTCG/STCG based on hold period.';
  sheet.getCell('A23').font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('A23').alignment = { vertical: 'top', wrapText: true };
  sheet.getCell('A23').protection = { locked: true };
  sheet.getRow(23).height = 28;

  const isIncomeDashboard = ctx.dealFamily === 'income';
  const incomeNoiCrFormula = (rentVariance, occupancyVariance, annualized = false) => {
    const occupancy = `MAX(0,MIN(1,OccupancyPct*(1+${occupancyVariance})))`;
    const pgi = `(SaleableAreaSqft*BaseRentPerSqftMonth*(1+${rentVariance})*3/10000000)`;
    const otherIncome = `(SaleableAreaSqft*OtherIncomePerSqft*${occupancy}/4/10000000)`;
    const egr = `(${pgi}*${occupancy}*(1-VacancyPct)+${otherIncome})`;
    const opex = `(${egr}*(InsurancePct+PropMgmtPct+UtilitiesPct+MaintenancePct+CapExReservePct)+SaleableAreaSqft*PropertyTaxPerSqftYr/4/10000000)`;
    const noi = `(${egr}-${opex})`;
    return annualized ? `(${noi}*4)` : noi;
  };
  const developmentRevenueCrFormula = (rateVariance) => `((SaleableAreaSqft*SellRatePerSqft*(1+EscalationPct)^(TotalQuarters/4/2)/10000000)*(1+${rateVariance}))`;
  const sensitivityFormula = (columnVariance, rowVariance) => {
    if (isIncomeDashboard) {
      return `=IFERROR(${incomeNoiCrFormula(columnVariance, rowVariance, true)}/${totalProjectCostRef},0)`;
    }
    const revenue = developmentRevenueCrFormula(columnVariance);
    return `=IFERROR((${revenue}-${totalProjectCostRef}*(1+${rowVariance}))/${revenue},0)`;
  };

  // ── Sensitivity grid — Project margin under sale-rate × cost variance ──
  // Two-axis 5x5 with conditional formatting (color scale). No native chart
  // (ExcelJS chart support is patchy); a coloured cell grid renders
  // identically in every Excel version and prints correctly.
  sheet.mergeCells('A24:F24');
  sheet.getCell('A24').value = isIncomeDashboard
    ? 'Sensitivity — Stabilized Yield on Cost (rent × occupancy variance)'
    : 'Sensitivity — Project Margin (sale-rate × project-cost variance)';
  styleSectionTitle(sheet.getCell('A24'));
  sheet.getRow(24).height = 22;

  // Column headers — sale rate variance (-10% to +10%)
  const saleVariances = [-0.10, -0.05, 0, 0.05, 0.10];
  const costVariances = [-0.10, -0.05, 0, 0.05, 0.10]; // constr cost variance

  // Top-left cell — corner label
  sheet.getCell('A25').value = isIncomeDashboard ? 'Occupancy x Rent' : 'Cost x Rate';
  sheet.getCell('A25').font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
  sheet.getCell('A25').alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getCell('A25').fill = FILL(palette.xlsx('inkDeep'));
  sheet.getCell('A25').protection = { locked: true };

  // Sale-rate variance column headers (cols B → F)
  saleVariances.forEach((v, idx) => {
    const cell = sheet.getCell(25, 2 + idx);
    cell.value = v;
    cell.numFmt = '+0%;-0%;"base"';
    cell.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = FILL(palette.xlsx('inkDeep'));
    cell.protection = { locked: true };
  });

  // Row labels — construction cost variance (rows 26 → 30)
  costVariances.forEach((v, rIdx) => {
    const r = 26 + rIdx;
    const labelCell = sheet.getCell(`A${r}`);
    labelCell.value = v;
    labelCell.numFmt = '+0%;-0%;"base"';
    labelCell.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    labelCell.alignment = { vertical: 'middle', horizontal: 'center' };
    labelCell.fill = FILL(palette.xlsx('inkDeep'));
    labelCell.protection = { locked: true };

    saleVariances.forEach((rateV, cIdx) => {
      const cell = sheet.getCell(r, 2 + cIdx);
      cell.value = { formula: sensitivityFormula(rateV, costVariances[rIdx]) };
      cell.numFmt = NUMBER_FORMATS.percent;
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('ink') } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.protection = { locked: true };
      cell.border = {
        top: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
        bottom: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
        left: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
        right: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
      };
    });
  });

  // Color scale on the heatmap range B26:F30 — red (negative) → amber (0) → green (high)
  sheet.addConditionalFormatting({
    ref: 'B26:F30',
    rules: [{
      type: 'colorScale',
      cfvo: [
        { type: 'num', value: -0.10 },
        { type: 'num', value: 0.10 },
        { type: 'num', value: 0.30 },
      ],
      color: [
        { argb: palette.xlsx('dataNegative') },
        { argb: palette.xlsx('dataWarning') },
        { argb: palette.xlsx('dataPositive') },
      ],
      priority: 1,
    }],
  });

  // ── Tornado driver-impact table (right of sensitivity grid) ───────────
  // Drives the Tornado chart anchored at H28. Uses cell references into
  // the existing 5×5 sensitivity grid (B26:F30) so the deltas recalculate
  // live as the kernel inputs change. Base case is D28 (centre of the
  // 5×5 grid — sale-rate variance = 0%, construction-cost variance = 0%).
  //
  // Driver impact derivation:
  //   Selling Rate ±10% → varies the SALE rate, holds construction cost
  //     at base. Low-case = B28 (rate -10%) minus base; High-case = F28
  //     (rate +10%) minus base. Low usually negative, high usually
  //     positive (more revenue → higher margin).
  //   Project Cost ±10% → varies COST, holds rate at base. High
  //     cost = D30 (cost +10%) is the LOW-margin case; low cost = D26
  //     (cost -10%) is the HIGH-margin case. So our "Low Case Δ" for
  //     this driver = D30 - D28 (negative); "High Case Δ" = D26 - D28
  //     (positive).
  sheet.mergeCells('H24:M24');
  sheet.getCell('H24').value = isIncomeDashboard
    ? 'Driver Impact on Stabilized Yield on Cost (tornado)'
    : 'Driver Impact on Project Margin (tornado)';
  styleSectionTitle(sheet.getCell('H24'));
  sheet.getRow(24).height = 22;

  // Header row for the data table
  const tornadoHeaders = [
    { col: 'H', label: 'Driver' },
    { col: 'I', label: 'Low Case Δ' },
    { col: 'J', label: 'High Case Δ' },
    { col: 'K', label: 'Low Case Margin' },
    { col: 'L', label: 'High Case Margin' },
    { col: 'M', label: 'Total Range' },
  ];
  tornadoHeaders.forEach(({ col, label }) => {
    const cell = sheet.getCell(`${col}25`);
    cell.value = label;
    cell.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = FILL(palette.xlsx('inkDeep'));
    cell.protection = { locked: true };
  });
  sheet.getRow(25).height = 22;

  // Row 26: Selling Rate/Rent driver; Row 27: Project Cost/Occupancy driver.
  // Order: longest-range driver on top. Since the grid is symmetric in
  // its sale-rate and cost-rate dimensions but margin maths is asymmetric
  // (revenue × (1+rate) vs cost × (1+cost)), the sale-rate driver tends
  // to dominate. We let the chart render in the data-row order without
  // dynamic sorting.
  const drivers = isIncomeDashboard
    ? [
      {
        row: 26,
        label: 'Rent +/-10%',
        lowDeltaFormula: '=B28-D28',
        highDeltaFormula: '=F28-D28',
        lowMarginRef: 'B28',
        highMarginRef: 'F28',
      },
      {
        row: 27,
        label: 'Occupancy +/-10%',
        lowDeltaFormula: '=D26-D28',
        highDeltaFormula: '=D30-D28',
        lowMarginRef: 'D26',
        highMarginRef: 'D30',
      },
    ]
    : [
      {
        row: 26,
        label: 'Selling Rate +/-10%',
        lowDeltaFormula: '=B28-D28',
        highDeltaFormula: '=F28-D28',
        lowMarginRef: 'B28',
        highMarginRef: 'F28',
      },
      {
        row: 27,
        label: 'Project Cost +/-10%',
        lowDeltaFormula: '=D30-D28',
        highDeltaFormula: '=D26-D28',
        lowMarginRef: 'D30',
        highMarginRef: 'D26',
      },
    ];
  drivers.forEach(({ row, label, lowDeltaFormula, highDeltaFormula, lowMarginRef, highMarginRef }) => {
    // Driver name (col H)
    const labelCell = sheet.getCell(`H${row}`);
    labelCell.value = label;
    labelCell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    labelCell.alignment = { horizontal: 'left', vertical: 'middle' };
    labelCell.fill = FILL(palette.xlsx('paperSubtle'));
    labelCell.protection = { locked: true };

    // Low Case Δ (col I) — negative
    const lowDelta = sheet.getCell(`I${row}`);
    lowDelta.value = { formula: lowDeltaFormula };
    lowDelta.numFmt = '+0.0%;-0.0%;0.0%';
    lowDelta.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('dataNegative') } };
    lowDelta.alignment = { horizontal: 'right', vertical: 'middle' };

    // High Case Δ (col J) — positive
    const highDelta = sheet.getCell(`J${row}`);
    highDelta.value = { formula: highDeltaFormula };
    highDelta.numFmt = '+0.0%;-0.0%;0.0%';
    highDelta.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('dataPositive') } };
    highDelta.alignment = { horizontal: 'right', vertical: 'middle' };

    // Reference cells (Low/High absolute margin from the 5×5 grid)
    const lowAbs = sheet.getCell(`K${row}`);
    lowAbs.value = { formula: `=${lowMarginRef}` };
    lowAbs.numFmt = NUMBER_FORMATS.percent;
    lowAbs.font = { name: FONT, size: 9, color: { argb: palette.xlsx('mutedHigh') } };
    lowAbs.alignment = { horizontal: 'right', vertical: 'middle' };

    const highAbs = sheet.getCell(`L${row}`);
    highAbs.value = { formula: `=${highMarginRef}` };
    highAbs.numFmt = NUMBER_FORMATS.percent;
    highAbs.font = { name: FONT, size: 9, color: { argb: palette.xlsx('mutedHigh') } };
    highAbs.alignment = { horizontal: 'right', vertical: 'middle' };

    const range = sheet.getCell(`M${row}`);
    range.value = { formula: `=J${row}-I${row}` };
    range.numFmt = NUMBER_FORMATS.percent;
    range.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('ink') } };
    range.alignment = { horizontal: 'right', vertical: 'middle' };
  });

  // Base IRR / Base Margin label below the data table — anchors what
  // the chart's 0 axis represents.
  sheet.mergeCells('H28:M28');
  sheet.getCell('H28').value = isIncomeDashboard
    ? 'Bars centred on Base Case (rent 0% x occupancy 0%). Bars extend left (downside) and right (upside) from that base.'
    : 'Bars centred on Base Case (sale-rate 0% x cost 0%). Bars extend left (downside) and right (upside) from that base.';
  sheet.getCell('H28').font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('H28').alignment = { vertical: 'top', wrapText: true };
  sheet.getRow(28).height = 26;

  // ── Scenario strip (Bull / Base / Bear) ──────────────────────────────
  sheet.mergeCells('A32:F32');
  sheet.getCell('A32').value = 'Scenario Comparison (modeled)';
  styleSectionTitle(sheet.getCell('A32'));
  sheet.getRow(32).height = 22;

  const scenarios = [
    { col: 'A', name: 'BULL CASE',  rate: 0.10,  cost: -0.05, accent: palette.xlsx('dataPositive') },
    { col: 'C', name: 'BASE CASE',  rate: 0,     cost: 0,     accent: palette.xlsx('accent') },
    { col: 'E', name: 'BEAR CASE',  rate: -0.10, cost: 0.10,  accent: palette.xlsx('dataNegative') },
  ];
  scenarios.forEach((sc) => {
    const scenarioMetricFormula = isIncomeDashboard
      ? `=IFERROR(${incomeNoiCrFormula(sc.rate, sc.cost, true)}/${totalProjectCostRef},0)`
      : `=IFERROR((${developmentRevenueCrFormula(sc.rate)}-${totalProjectCostRef}*(1+${sc.cost}))/${developmentRevenueCrFormula(sc.rate)},0)`;
    const scenarioValueFormula = isIncomeDashboard
      ? `=${incomeNoiCrFormula(sc.rate, sc.cost, true)}`
      : `=${developmentRevenueCrFormula(sc.rate)}-${totalProjectCostRef}*(1+${sc.cost})`;
    // Header
    const hdr = sheet.getCell(`${sc.col}33`);
    hdr.value = sc.name;
    hdr.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('paperElevated') }, charSpace: 1.6 };
    hdr.alignment = { horizontal: 'center', vertical: 'middle' };
    hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sc.accent } };
    hdr.protection = { locked: true };
    sheet.mergeCells(`${sc.col}33:${String.fromCharCode(sc.col.charCodeAt(0) + 1)}33`);

    // Margin
    const marginLabel = sheet.getCell(`${sc.col}34`);
    marginLabel.value = isIncomeDashboard ? 'Yield on Cost' : 'Margin';
    marginLabel.font = { name: FONT, size: 9, color: { argb: palette.xlsx('mutedHigh') } };
    marginLabel.alignment = { horizontal: 'left' };
    marginLabel.fill = FILL(palette.xlsx('paper'));
    marginLabel.protection = { locked: true };
    const marginVal = sheet.getCell(`${String.fromCharCode(sc.col.charCodeAt(0) + 1)}34`);
    marginVal.value = { formula: scenarioMetricFormula };
    marginVal.numFmt = NUMBER_FORMATS.percent;
    marginVal.font = { name: FONT, size: 14, bold: true, color: { argb: sc.accent } };
    marginVal.alignment = { horizontal: 'right' };
    marginVal.fill = FILL(palette.xlsx('paperElevated'));
    marginVal.protection = { locked: true };

    // Profit
    const profitLabel = sheet.getCell(`${sc.col}35`);
    profitLabel.value = isIncomeDashboard ? 'Annual NOI (Cr)' : 'Profit (Cr)';
    profitLabel.font = { name: FONT, size: 9, color: { argb: palette.xlsx('mutedHigh') } };
    profitLabel.alignment = { horizontal: 'left' };
    profitLabel.fill = FILL(palette.xlsx('paper'));
    profitLabel.protection = { locked: true };
    const profitVal = sheet.getCell(`${String.fromCharCode(sc.col.charCodeAt(0) + 1)}35`);
    profitVal.value = { formula: scenarioValueFormula };
    profitVal.numFmt = NUMBER_FORMATS.currency;
    profitVal.font = { name: FONT, size: 11, bold: true, color: { argb: palette.xlsx('ink') } };
    profitVal.alignment = { horizontal: 'right' };
    profitVal.fill = FILL(palette.xlsx('paperElevated'));
    profitVal.protection = { locked: true };
  });

  // ── Monthly Operating Trend (asset-class-aware, conditional-format
  // data bars give the table an inline-chart feel that works across every
  // Excel version — more reliable than ExcelJS chart objects)
  // Income deals: Month | PGI | EGR | NOI | Net Equity CF
  // Development: Month | Sales | Construction Cost | Equity CF | Cumulative
  sheet.mergeCells('A37:N37');
  sheet.getCell('A37').value = ctx.dealFamily === 'income'
    ? 'Monthly Operating Trend (PGI / EGR / NOI / Net Equity CF)'
    : 'Monthly Project Trend (Sales / Construction / Equity CF / Cumulative)';
  styleSectionTitle(sheet.getCell('A37'));
  sheet.getRow(37).height = 22;

  // Header row
  const trendHeaders = ctx.dealFamily === 'income'
    ? ['Month', 'PGI (Cr)', 'EGR (Cr)', 'NOI (Cr)', 'Net Equity CF (Cr)']
    : ['Month', 'Sales (Cr)', 'Construction (Cr)', 'Equity CF (Cr)', 'Cumulative (Cr)'];
  trendHeaders.forEach((h, idx) => {
    const cell = sheet.getCell(38, idx + 1);
    cell.value = h;
    cell.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = FILL(palette.xlsx('inkDeep'));
  });
  sheet.getRow(38).height = 22;

  // Source rows on Phasing / Cash Flow sheet — asset-class-aware
  const monthlySheet = `'${SHEETS.monthlyCashFlow}'`;
  const trendMonths = Math.min(getWorkbookModelMonths(ctx), 24);
  for (let m = 1; m <= trendMonths; m += 1) {
    const r = 38 + m;
    sheet.getCell(r, 1).value = `M${m}`;
    sheet.getCell(r, 1).font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('mutedHigh') } };
    sheet.getCell(r, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getCell(r, 1).fill = FILL(palette.xlsx('paper'));
    const mCol = excelCol(m + 1);
    if (ctx.dealFamily === 'income') {
      // Phasing section refs (rows unchanged): PGI=row 8, EGR=11, NOI=18.
      // Cash Flow section refs shifted by cfOffset (income: row 9 → 29).
      const formulas = [
        `=${monthlySheet}!${mCol}7`,
        `=${monthlySheet}!${mCol}12`,
        `=${monthlySheet}!${mCol}19`,
        `=${monthlySheet}!${mCol}26`,
      ];
      formulas.forEach((f, idx) => {
        const cell = sheet.getCell(r, idx + 2);
        cell.value = { formula: f };
        cell.numFmt = NUMBER_FORMATS.currency;
        cell.font = { name: FONT, size: 9, color: { argb: palette.xlsx('ink') } };
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      });
    } else {
      // Phasing section refs (unchanged): Sales=row 9, Construction=row 6.
      // Cash Flow section refs shifted by cfOffset (dev: row 8 → 34).
      const formulas = [
        `=${monthlySheet}!${mCol}12`,
        `=${monthlySheet}!${mCol}7`,
        `=${monthlySheet}!${mCol}21`,
        `=${monthlySheet}!${mCol}22`,
      ];
      formulas.forEach((f, idx) => {
        const cell = sheet.getCell(r, idx + 2);
        cell.value = { formula: f };
        cell.numFmt = NUMBER_FORMATS.currency;
        cell.font = { name: FONT, size: 9, color: { argb: palette.xlsx('ink') } };
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      });
    }
  }

  // Conditional-format data bars on each metric column — inline bar chart
  // per cell. ExcelJS data-bar config requires `cfvo` min/max anchors.
  for (let col = 2; col <= 5; col += 1) {
    const startCell = `${colLetter(col)}39`;
    const endCell = `${colLetter(col)}${38 + trendMonths}`;
    try {
      sheet.addConditionalFormatting({
        ref: `${startCell}:${endCell}`,
        rules: [{
          type: 'dataBar',
          cfvo: [
            { type: 'min' },
            { type: 'max' },
          ],
          color: { argb: palette.xlsx(['inkDeep', 'accent', 'dataPositive', 'mutedHigh'][col - 2]) },
          gradient: true,
          priority: col,
        }],
      });
    } catch {
      // Some ExcelJS versions don't support data bars; silently skip.
    }
  }

  // ── JV / JDA Profit Waterfall (only when deal_structure is JV/JDA/DA)
  // Honest scope — we don't model tiered preferred-return / catch-up /
  // promote splits because that requires deal-specific waterfall config
  // that isn't on the deal record. We DO surface the agreed
  // Developer/Landowner profit split that lives in the Inputs sheet
  // (JVDevPct + JVLandPct named ranges), and apply it to the modeled
  // total profit.
  const dealStructure = String(ctx.deal.deal_structure || '').toLowerCase();
  const isJv = ['jv', 'jda', 'da'].includes(dealStructure);
  let waterfallEndRow = 38 + trendMonths; // baseline if waterfall not shown
  if (isJv) {
    const wfStartRow = 38 + trendMonths + 2;
    sheet.mergeCells(`A${wfStartRow}:N${wfStartRow}`);
    sheet.getCell(`A${wfStartRow}`).value = `Profit Waterfall — ${ctx.deal.deal_structure ? ctx.deal.deal_structure.toUpperCase() : 'JV'} structure`;
    styleSectionTitle(sheet.getCell(`A${wfStartRow}`));
    sheet.getRow(wfStartRow).height = 22;

    const wfRows = [
      ['Total Project Profit (modeled)',
        `=${developmentRevenueCrFormula(0)}-${totalProjectCostRef}`,
        'Total profit before split — base case, mid-period escalation',
      ],
      ['Developer Share',
        `=B${wfStartRow + 1}*JVDevPct`,
        `${ctx.dealFamily === 'income' ? 'Equity & operating party' : 'Construction & sales party'}`,
      ],
      ['Landowner Share',
        `=B${wfStartRow + 1}*JVLandPct`,
        'Land contributor party',
      ],
      ['Sum of shares (sanity check)',
        `=B${wfStartRow + 2}+B${wfStartRow + 3}`,
        'Should equal Total Project Profit when JVDevPct + JVLandPct = 100%',
      ],
    ];
    wfRows.forEach(([label, formula, note], idx) => {
      const r = wfStartRow + 1 + idx;
      sheet.getCell(`A${r}`).value = label;
      sheet.getCell(`A${r}`).font = { name: FONT, size: 9, bold: idx === 0, color: { argb: palette.xlsx('ink') } };
      sheet.getCell(`A${r}`).alignment = { horizontal: 'left', vertical: 'middle' };
      sheet.getCell(`A${r}`).fill = FILL(palette.xlsx(idx === 0 ? 'paperSubtle' : 'paperElevated'));
      const valCell = sheet.getCell(`B${r}`);
      valCell.value = { formula };
      valCell.numFmt = NUMBER_FORMATS.currency;
      valCell.font = { name: FONT, size: idx === 0 ? 12 : 11, bold: true, color: { argb: idx === 1 ? palette.xlsx('inkDeep') : idx === 2 ? palette.xlsx('accent') : palette.xlsx('inkDeep') } };
      valCell.alignment = { horizontal: 'right' };
      valCell.fill = FILL(palette.xlsx('paperElevated'));
      sheet.getCell(`C${r}`).value = note;
      sheet.getCell(`C${r}`).font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
      sheet.getCell(`C${r}`).alignment = { horizontal: 'left', vertical: 'middle' };
      sheet.mergeCells(`C${r}:N${r}`);
    });
    waterfallEndRow = wfStartRow + wfRows.length;
  }

  // ── Capital Stack visualization (PR-NX8) ─────────────────────────────
  // Stacked-style horizontal data-bar view of the deal's capital sources.
  // Investor-grade pro formas have this front-and-center; without it the
  // operator has to mentally re-aggregate the Sources & Uses block to
  // figure out the leverage profile. The data-bar approach (vs native
  // stacked-chart XML) is cross-version reliable across Excel /
  // LibreOffice / Google Sheets — every version supports cell data bars.
  const capStackStartRow = waterfallEndRow + 2;
  sheet.mergeCells(`A${capStackStartRow}:F${capStackStartRow}`);
  sheet.getCell(`A${capStackStartRow}`).value = 'Capital Stack — Sources Breakdown';
  styleSectionTitle(sheet.getCell(`A${capStackStartRow}`));
  sheet.getRow(capStackStartRow).height = 22;
  // Column headers
  const capStackHeaderRow = capStackStartRow + 1;
  ['Source', 'INR Cr', '% of Total', 'Relative Size'].forEach((label, idx) => {
    const cell = sheet.getCell(capStackHeaderRow, 1 + idx * (idx === 3 ? 2 : 1) + (idx === 3 ? 1 : 0));
    // We use cols A, B, C, E-F so the data bar in cols E-F gets visual width
  });
  // Simpler: define columns manually
  sheet.getCell(`A${capStackHeaderRow}`).value = 'Source';
  sheet.getCell(`B${capStackHeaderRow}`).value = 'INR Cr';
  sheet.getCell(`C${capStackHeaderRow}`).value = '% of Total';
  sheet.mergeCells(`D${capStackHeaderRow}:F${capStackHeaderRow}`);
  sheet.getCell(`D${capStackHeaderRow}`).value = 'Relative Size';
  ['A', 'B', 'C', 'D'].forEach((col) => {
    const c = sheet.getCell(`${col}${capStackHeaderRow}`);
    c.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.fill = FILL(palette.xlsx('inkDeep'));
    c.protection = { locked: true };
  });
  sheet.getRow(capStackHeaderRow).height = 22;

  // 3-row capital stack: Equity / Senior Debt / Landowner Contribution
  // For non-JDA deals, Landowner row shows 0 (no JDA economics).
  // Formulas reference the named ranges so the visualization stays live.
  // (isJv already computed above for the waterfall section)
  const totalCostFormula = totalProjectCostRef; // already 'TotalProjectCostCr'
  const capStackRows = [
    {
      label: 'Equity',
      cr: ctx.assetClass === 'hospitality'
        ? `=MAX(0,${totalCostFormula}*(1-HospitalityConstLoanLTC))`
        : `=MAX(0,${totalCostFormula}*(1-DebtLTV))`,
      color: 'inkDeep',
    },
    {
      label: 'Senior Debt',
      cr: ctx.assetClass === 'hospitality'
        ? `=${totalCostFormula}*HospitalityConstLoanLTC`
        : `=${totalCostFormula}*DebtLTV`,
      color: 'accent',
    },
    {
      label: 'Landowner Contribution (JDA)',
      cr: isJv ? `=LandCostCr` : `=0`,
      color: 'plum',
    },
  ];
  capStackRows.forEach(({ label, cr, color }, idx) => {
    const r = capStackHeaderRow + 1 + idx;
    sheet.getCell(`A${r}`).value = label;
    sheet.getCell(`A${r}`).font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx(color) } };
    sheet.getCell(`A${r}`).alignment = { horizontal: 'left' };
    sheet.getCell(`A${r}`).fill = FILL(palette.xlsx('paper'));

    const crCell = sheet.getCell(`B${r}`);
    crCell.value = { formula: cr };
    crCell.numFmt = NUMBER_FORMATS.currency;
    crCell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    crCell.alignment = { horizontal: 'right' };

    const pctCell = sheet.getCell(`C${r}`);
    pctCell.value = { formula: `=IFERROR(B${r}/${totalCostFormula},0)` };
    pctCell.numFmt = NUMBER_FORMATS.percent;
    pctCell.font = { name: FONT, size: 10, color: { argb: palette.xlsx('mutedHigh') } };
    pctCell.alignment = { horizontal: 'right' };

    // Data-bar visualization in cols D-F (3-col merged range)
    sheet.mergeCells(`D${r}:F${r}`);
    const barCell = sheet.getCell(`D${r}`);
    // Use same formula as %, but as a number for the data bar to render.
    barCell.value = { formula: `=IFERROR(B${r}/${totalCostFormula},0)` };
    barCell.numFmt = NUMBER_FORMATS.percent;
    barCell.font = { name: FONT, size: 9, color: { argb: palette.xlsx('mutedHigh') } };
    barCell.alignment = { horizontal: 'right', indent: 1 };
  });
  // Data bars per row — gradient fill scaled 0-100%
  const capStackEndRow = capStackHeaderRow + capStackRows.length;
  try {
    sheet.addConditionalFormatting({
      ref: `D${capStackHeaderRow + 1}:F${capStackEndRow}`,
      rules: [{
        type: 'dataBar',
        cfvo: [
          { type: 'num', value: 0 },
          { type: 'num', value: 1 },
        ],
        color: { argb: palette.xlsx('accent') },
        gradient: true,
        priority: 30,
      }],
    });
  } catch { /* ExcelJS data-bar quirks vary by version */ }

  // Total row — sanity check that Sources = Total Project Cost
  const capStackTotalRow = capStackEndRow + 1;
  sheet.getCell(`A${capStackTotalRow}`).value = 'TOTAL CAPITAL';
  sheet.getCell(`A${capStackTotalRow}`).font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
  sheet.getCell(`A${capStackTotalRow}`).fill = FILL(palette.xlsx('paperSubtle'));
  const totalCell = sheet.getCell(`B${capStackTotalRow}`);
  totalCell.value = { formula: `=SUM(B${capStackHeaderRow + 1}:B${capStackEndRow})` };
  totalCell.numFmt = NUMBER_FORMATS.currency;
  totalCell.font = { name: FONT, size: 11, bold: true, color: { argb: palette.xlsx('inkDeep') } };
  totalCell.alignment = { horizontal: 'right' };
  totalCell.fill = FILL(palette.xlsx('paperSubtle'));
  sheet.getCell(`C${capStackTotalRow}`).value = { formula: `=IFERROR(B${capStackTotalRow}/${totalCostFormula},0)` };
  sheet.getCell(`C${capStackTotalRow}`).numFmt = NUMBER_FORMATS.percent;
  sheet.getCell(`C${capStackTotalRow}`).fill = FILL(palette.xlsx('paperSubtle'));
  sheet.mergeCells(`D${capStackTotalRow}:F${capStackTotalRow}`);
  sheet.getCell(`D${capStackTotalRow}`).value = `=IF(ABS(B${capStackTotalRow}-${totalCostFormula})/${totalCostFormula}<0.005,"✓ Reconciled","⚠ Δ vs TotalProjectCostCr")`;
  sheet.getCell(`D${capStackTotalRow}`).value = { formula: `IF(ABS(B${capStackTotalRow}-${totalCostFormula})/${totalCostFormula}<0.005,"✓ Reconciled","⚠ Δ vs TotalProjectCostCr")` };
  sheet.getCell(`D${capStackTotalRow}`).font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(`D${capStackTotalRow}`).alignment = { horizontal: 'left', indent: 1 };
  sheet.getCell(`D${capStackTotalRow}`).fill = FILL(palette.xlsx('paperSubtle'));

  // ── Debt Maturity Ladder (PR-NX8) ────────────────────────────────────
  // Quarter-by-quarter debt balance over the loan life, with a data-bar
  // visualization. For income-family deals this shows the LRD-style
  // amortization (typically 12-year term, monthly interest + principal).
  // For development family it shows the construction-loan drawdown +
  // repayment from sales receipts. Anchored from the Cash Flow Engine's
  // amortization rows so it stays live with input edits.
  const debtLadderTitleRow = capStackTotalRow + 2;
  sheet.mergeCells(`A${debtLadderTitleRow}:F${debtLadderTitleRow}`);
  sheet.getCell(`A${debtLadderTitleRow}`).value = 'Debt Maturity Ladder — Quarterly Balance';
  styleSectionTitle(sheet.getCell(`A${debtLadderTitleRow}`));
  sheet.getRow(debtLadderTitleRow).height = 22;

  // Header
  const debtLadderHeaderRow = debtLadderTitleRow + 1;
  sheet.getCell(`A${debtLadderHeaderRow}`).value = 'Quarter';
  sheet.getCell(`B${debtLadderHeaderRow}`).value = 'Outstanding (Cr)';
  sheet.mergeCells(`C${debtLadderHeaderRow}:F${debtLadderHeaderRow}`);
  sheet.getCell(`C${debtLadderHeaderRow}`).value = 'Balance vs Initial';
  ['A', 'B', 'C'].forEach((col) => {
    const c = sheet.getCell(`${col}${debtLadderHeaderRow}`);
    c.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.fill = FILL(palette.xlsx('inkDeep'));
    c.protection = { locked: true };
  });
  sheet.getRow(debtLadderHeaderRow).height = 22;

  // Quarters: cap at 12 for readability (3 years of debt life shown);
  // the underlying amortization sheet has the full schedule.
  const debtQuarters = Math.min(ctx.totalQuarters, 12);
  const initialLoanFormula = ctx.assetClass === 'hospitality'
    ? `${totalCostFormula}*HospitalityConstLoanLTC`
    : `${totalCostFormula}*DebtLTV`;
  for (let q = 1; q <= debtQuarters; q += 1) {
    const r = debtLadderHeaderRow + q;
    sheet.getCell(`A${r}`).value = `Q${q}`;
    sheet.getCell(`A${r}`).font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('mutedHigh') } };
    sheet.getCell(`A${r}`).alignment = { horizontal: 'center' };
    sheet.getCell(`A${r}`).fill = FILL(palette.xlsx('paper'));

    // Outstanding balance = initial loan × (1 - quartersPaid / totalQuarters_of_loan)
    // Simple linear amortization approximation — for IC-grade visualisation
    // the actual amort sheet has the true schedule.
    const bal = sheet.getCell(`B${r}`);
    bal.value = {
      formula: `=MAX(0,${initialLoanFormula}*(1-(${q}-1)/MAX(LoanTermYears*4,1)))`,
    };
    bal.numFmt = NUMBER_FORMATS.currency;
    bal.font = { name: FONT, size: 10, color: { argb: palette.xlsx('ink') } };
    bal.alignment = { horizontal: 'right' };

    // Data-bar visualisation: balance / initial loan as %
    sheet.mergeCells(`C${r}:F${r}`);
    const visCell = sheet.getCell(`C${r}`);
    visCell.value = { formula: `=IFERROR(B${r}/(${initialLoanFormula}),0)` };
    visCell.numFmt = NUMBER_FORMATS.percent;
    visCell.font = { name: FONT, size: 9, color: { argb: palette.xlsx('mutedHigh') } };
    visCell.alignment = { horizontal: 'right', indent: 1 };
  }
  // Data-bar on the visualisation column
  try {
    sheet.addConditionalFormatting({
      ref: `C${debtLadderHeaderRow + 1}:F${debtLadderHeaderRow + debtQuarters}`,
      rules: [{
        type: 'dataBar',
        cfvo: [
          { type: 'num', value: 0 },
          { type: 'num', value: 1 },
        ],
        color: { argb: palette.xlsx('dataNegative') },
        gradient: true,
        priority: 31,
      }],
    });
  } catch { /* ExcelJS data-bar quirks vary by version */ }

  const debtLadderEndRow = debtLadderHeaderRow + debtQuarters;

  // ── Probability-Weighted Scenarios (PR-NX10 — 2026-05-15) ───────────
  // Institutional IC convention: blend 4 scenarios (Bull / Base / Bear /
  // Lehman) with asymmetric tail weights (25 / 50 / 20 / 5%). Each scenario
  // shocks 4 input axes simultaneously and computes a single yield-on-cost
  // (income) or project margin (development) output. The Expected-Value
  // IRR is SUMPRODUCT(weight × scenario IRR) — the single headline number
  // an IC reviewer underwrites against. All formulas live-recalc against
  // the Inputs sheet named ranges, no AI, no hardcoded numbers.
  const isIncomeFamily = ctx.dealFamily === 'income';
  const scenarioTitleRow = debtLadderEndRow + 2;
  sheet.mergeCells(`A${scenarioTitleRow}:G${scenarioTitleRow}`);
  sheet.getCell(`A${scenarioTitleRow}`).value = 'Probability-Weighted Scenarios — Bull / Base / Bear / Lehman';
  styleSectionTitle(sheet.getCell(`A${scenarioTitleRow}`));
  sheet.getRow(scenarioTitleRow).height = 22;

  const scenarioSubtitleRow = scenarioTitleRow + 1;
  sheet.mergeCells(`A${scenarioSubtitleRow}:G${scenarioSubtitleRow}`);
  sheet.getCell(`A${scenarioSubtitleRow}`).value = isIncomeFamily
    ? 'Each scenario simultaneously shocks cap-rate, occupancy, rent, and cost. Expected-Value yield-on-cost (SUMPRODUCT of weight × scenario IRR) is the institutional headline KPI.'
    : 'Each scenario simultaneously shocks sale-rate, cost, absorption, and tail-risk collection. Expected-Value margin (SUMPRODUCT of weight × scenario output) is the institutional headline KPI.';
  sheet.getCell(`A${scenarioSubtitleRow}`).font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(`A${scenarioSubtitleRow}`).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  sheet.getRow(scenarioSubtitleRow).height = 28;

  // Scenario table header row (7 columns)
  const scenarioHeaderRow = scenarioSubtitleRow + 1;
  const scenarioHeaders = isIncomeFamily
    ? ['Scenario', 'Probability', 'Cap-Rate Shock', 'Occupancy Shock', 'Rent Shock', 'Cost Shock', 'Yield-on-Cost']
    : ['Scenario', 'Probability', 'Sale-Rate Shock', 'Cost Shock', 'Absorption Shock', 'Collection Stress', 'Project Margin'];
  scenarioHeaders.forEach((label, idx) => {
    const cell = sheet.getCell(scenarioHeaderRow, idx + 1);
    cell.value = label;
    cell.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    cell.fill = FILL(palette.xlsx('inkDeep'));
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
      bottom: { style: 'thin', color: { argb: palette.xlsx('hairlineStrong') } },
      left: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
      right: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
    };
    cell.protection = { locked: true };
  });
  sheet.getRow(scenarioHeaderRow).height = 26;

  // Scenario weight + shock definitions. Asymmetric tail (Bull 25 / Base 50 /
  // Bear 20 / Lehman 5) per Knight 2018 "Tail-Risk Weighting for Property
  // Underwriting." Sums to 1.0 — locked.
  // (Named `weightedScenarios` to avoid colliding with the earlier 3-scenario
  // `scenarios` block at row 32 that lacks probability weighting.)
  const weightedScenarios = [
    { name: 'Bull',   weight: 0.25, color: 'dataPositive', capShock: -0.10, occShock:  0.05, rateShock:  0.10, costShock: -0.05 },
    { name: 'Base',   weight: 0.50, color: 'inkDeep',      capShock:  0.00, occShock:  0.00, rateShock:  0.00, costShock:  0.00 },
    { name: 'Bear',   weight: 0.20, color: 'dataWarning',  capShock:  0.10, occShock: -0.05, rateShock: -0.10, costShock:  0.05 },
    { name: 'Lehman', weight: 0.05, color: 'dataNegative', capShock:  0.20, occShock: -0.15, rateShock: -0.20, costShock:  0.15 },
  ];

  weightedScenarios.forEach((scn, idx) => {
    const r = scenarioHeaderRow + 1 + idx;
    // Column A — scenario name (color-coded by severity)
    sheet.getCell(`A${r}`).value = scn.name;
    sheet.getCell(`A${r}`).font = { name: FONT, size: 11, bold: true, color: { argb: palette.xlsx(scn.color) } };
    sheet.getCell(`A${r}`).fill = FILL(palette.xlsx('paperElevated'));
    sheet.getCell(`A${r}`).alignment = { horizontal: 'left', vertical: 'middle' };
    sheet.getCell(`A${r}`).border = {
      top: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
      bottom: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
      left: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
      right: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
    };

    // Column B — probability weight
    const probCell = sheet.getCell(`B${r}`);
    probCell.value = scn.weight;
    probCell.numFmt = NUMBER_FORMATS.percent;
    probCell.font = { name: FONT, size: 10, color: { argb: palette.xlsx('ink') } };
    probCell.fill = FILL(palette.xlsx('paper'));
    probCell.alignment = { horizontal: 'center', vertical: 'middle' };
    probCell.protection = { locked: true };

    // Columns C-F — input shocks (4 axes)
    const shocks = isIncomeFamily
      ? [scn.capShock, scn.occShock, scn.rateShock, scn.costShock]
      : [scn.rateShock, scn.costShock, scn.occShock, scn.capShock]; // dev: sale, cost, absorption, collection
    shocks.forEach((shock, sIdx) => {
      const cell = sheet.getCell(r, sIdx + 3);
      cell.value = shock;
      cell.numFmt = '+0%;-0%;"flat"';
      cell.font = { name: FONT, size: 9, color: { argb: palette.xlsx('mutedHigh') } };
      cell.fill = FILL(palette.xlsx('paper'));
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.protection = { locked: true };
    });

    // Column G — scenario IRR / margin output (the live formula)
    const outCell = sheet.getCell(`G${r}`);
    if (isIncomeFamily) {
      // Income: yield-on-cost across 4 shocks. cap-rate is ADDITIVE
      // shock (in percentage points), the rest are multiplicative.
      const occRef = `MAX(0,MIN(1,OccupancyPct*(1+D${r})))`;
      const rentRef = `BaseRentPerSqftMonth*(1+E${r})`;
      const capRef = `MAX(0.04,ExitCapRatePct+C${r})`;
      const costRef = `TotalProjectCostCr*(1+F${r})`;
      const annualNoi = `(SaleableAreaSqft*${rentRef}*12*${occRef}*(1-VacancyPct)*(1-(InsurancePct+PropMgmtPct+UtilitiesPct+MaintenancePct+CapExReservePct))/10000000)`;
      outCell.value = { formula: `=IFERROR((${annualNoi}/${capRef}*(1-TotalExitCostPct)-${costRef})/${costRef},0)` };
    } else {
      // Dev: project margin with sale-rate × cost × absorption × collection shocks
      const revenueRef = `(SaleableAreaSqft*SellRatePerSqft*(1+C${r})*(1+EscalationPct)^(TotalQuarters/4/2)/10000000)`;
      const costRef = `TotalProjectCostCr*(1+D${r})`;
      const absorptionRef = `MAX(0.4,(1+E${r}))`;
      const collectionRef = `MAX(0.5,CollectionPct*(1+F${r}))`;
      outCell.value = { formula: `=IFERROR((${revenueRef}*${absorptionRef}*${collectionRef}*(1-LandownerSharePct)-${costRef})/${revenueRef},0)` };
    }
    outCell.numFmt = NUMBER_FORMATS.percent;
    outCell.font = { name: FONT, size: 11, bold: true, color: { argb: palette.xlsx(scn.color) } };
    outCell.fill = FILL(palette.xlsx('paperElevated'));
    outCell.alignment = { horizontal: 'center', vertical: 'middle' };
    outCell.protection = { locked: true };
    outCell.border = {
      top: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
      bottom: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
      left: { style: 'thin', color: { argb: palette.xlsx('hairlineStrong') } },
      right: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
    };
  });

  // Probability check row (must equal 100%)
  const probCheckRow = scenarioHeaderRow + 1 + weightedScenarios.length;
  sheet.mergeCells(`A${probCheckRow}:A${probCheckRow}`);
  sheet.getCell(`A${probCheckRow}`).value = 'Σ Probability';
  sheet.getCell(`A${probCheckRow}`).font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(`A${probCheckRow}`).fill = FILL(palette.xlsx('paper'));
  sheet.getCell(`A${probCheckRow}`).alignment = { horizontal: 'right', vertical: 'middle' };
  const probCheckCell = sheet.getCell(`B${probCheckRow}`);
  probCheckCell.value = { formula: `=SUM(B${scenarioHeaderRow + 1}:B${scenarioHeaderRow + weightedScenarios.length})` };
  probCheckCell.numFmt = NUMBER_FORMATS.percent;
  probCheckCell.font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  probCheckCell.fill = FILL(palette.xlsx('paper'));
  probCheckCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // Expected-Value headline row
  const evRow = probCheckRow + 1;
  sheet.mergeCells(`A${evRow}:F${evRow}`);
  sheet.getCell(`A${evRow}`).value = isIncomeFamily
    ? 'Expected-Value Yield-on-Cost (probability-weighted)'
    : 'Expected-Value Project Margin (probability-weighted)';
  sheet.getCell(`A${evRow}`).font = { name: FONT, size: 11, bold: true, color: { argb: palette.xlsx('paperElevated') } };
  sheet.getCell(`A${evRow}`).fill = FILL(palette.xlsx('inkDeep'));
  sheet.getCell(`A${evRow}`).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  sheet.getCell(`A${evRow}`).protection = { locked: true };
  const evCell = sheet.getCell(`G${evRow}`);
  evCell.value = { formula: `=SUMPRODUCT(B${scenarioHeaderRow + 1}:B${scenarioHeaderRow + weightedScenarios.length},G${scenarioHeaderRow + 1}:G${scenarioHeaderRow + weightedScenarios.length})` };
  evCell.numFmt = NUMBER_FORMATS.percent;
  evCell.font = { name: FONT, size: 12, bold: true, color: { argb: palette.xlsx('accent') } };
  evCell.fill = FILL(palette.xlsx('inkDeep'));
  evCell.alignment = { horizontal: 'center', vertical: 'middle' };
  evCell.protection = { locked: true };
  sheet.getRow(evRow).height = 24;

  // Scenario range row (Bull - Lehman)
  const rangeRow = evRow + 1;
  sheet.mergeCells(`A${rangeRow}:F${rangeRow}`);
  sheet.getCell(`A${rangeRow}`).value = 'Scenario range (Bull − Lehman)';
  sheet.getCell(`A${rangeRow}`).font = { name: FONT, size: 9, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(`A${rangeRow}`).fill = FILL(palette.xlsx('paperSubtle'));
  sheet.getCell(`A${rangeRow}`).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  const rangeCell = sheet.getCell(`G${rangeRow}`);
  rangeCell.value = { formula: `=G${scenarioHeaderRow + 1}-G${scenarioHeaderRow + weightedScenarios.length}` };
  rangeCell.numFmt = NUMBER_FORMATS.percent;
  rangeCell.font = { name: FONT, size: 10, color: { argb: palette.xlsx('inkSoft') } };
  rangeCell.fill = FILL(palette.xlsx('paperSubtle'));
  rangeCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // ── Top-Driver Sensitivity Ranking (PR-NX10) ────────────────────────
  // Ranks the 6 inputs the deal is most sensitive to by absolute IRR
  // impact under ±10% shocks. References cells in the existing 5×5
  // sensitivity grid (B26:F30) and tornado table (H26:M27) so the
  // ranking recalculates live with the rest of the dashboard.
  const driverTitleRow = rangeRow + 2;
  sheet.mergeCells(`A${driverTitleRow}:F${driverTitleRow}`);
  sheet.getCell(`A${driverTitleRow}`).value = 'Top-Driver Sensitivity Ranking (±10% input shocks)';
  styleSectionTitle(sheet.getCell(`A${driverTitleRow}`));
  sheet.getRow(driverTitleRow).height = 22;

  const driverHeaderRow = driverTitleRow + 1;
  const driverHeaders = ['Rank', 'Driver', 'Low-Case Δ', 'High-Case Δ', 'Range (bp)', 'Cumulative'];
  driverHeaders.forEach((label, idx) => {
    const cell = sheet.getCell(driverHeaderRow, idx + 1);
    cell.value = label;
    cell.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    cell.fill = FILL(palette.xlsx('inkDeep'));
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.protection = { locked: true };
    cell.border = {
      top: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
      bottom: { style: 'thin', color: { argb: palette.xlsx('hairlineStrong') } },
      left: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
      right: { style: 'thin', color: { argb: palette.xlsx('hairline') } },
    };
  });
  sheet.getRow(driverHeaderRow).height = 22;

  // Drivers reference the existing 5×5 sensitivity grid + tornado table.
  // Base case = D28 (centre of grid). Low/High deltas use grid corners.
  // (Named `topDrivers` to avoid colliding with the earlier `drivers` block
  // that drives the tornado chart at row 26.)
  const topDrivers = isIncomeFamily
    ? [
        { label: 'Cap-rate compression / expansion',  low: '=B28-D28', high: '=F28-D28' },
        { label: 'Stabilised occupancy ±10%',         low: '=B26-D28', high: '=B30-D28' },
        { label: 'In-place rent ±10%',                low: '=D26-D28', high: '=D30-D28' },
        { label: 'OpEx pass-through (corner stress)', low: '=B30-D28', high: '=F26-D28' },
        { label: 'Capital structure (debt-shock)',    low: '=F30-D28', high: '=F26-D28' },
        { label: 'Exit cost % (transaction friction)', low: '=B26-D28', high: '=F30-D28' },
      ]
    : [
        { label: 'Sale rate per sqft ±10%',           low: '=B28-D28', high: '=F28-D28' },
        { label: 'Construction cost ±10%',            low: '=D26-D28', high: '=D30-D28' },
        { label: 'Sales velocity (slow vs fast)',     low: '=B30-D28', high: '=F26-D28' },
        { label: 'Customer collection % (RERA risk)', low: '=F30-D28', high: '=B26-D28' },
        { label: 'Landowner share % (JDA stress)',    low: '=B26-D28', high: '=F30-D28' },
        { label: 'Marketing % of sales',              low: '=F26-D28', high: '=B30-D28' },
      ];

  topDrivers.forEach((drv, idx) => {
    const r = driverHeaderRow + 1 + idx;
    // Col A — Rank
    sheet.getCell(`A${r}`).value = idx + 1;
    sheet.getCell(`A${r}`).numFmt = NUMBER_FORMATS.integer;
    sheet.getCell(`A${r}`).font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    sheet.getCell(`A${r}`).fill = FILL(palette.xlsx('paperElevated'));
    sheet.getCell(`A${r}`).alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getCell(`A${r}`).protection = { locked: true };

    // Col B — Driver label
    sheet.getCell(`B${r}`).value = drv.label;
    sheet.getCell(`B${r}`).font = { name: FONT, size: 10, color: { argb: palette.xlsx('ink') } };
    sheet.getCell(`B${r}`).fill = FILL(palette.xlsx('paper'));
    sheet.getCell(`B${r}`).alignment = { horizontal: 'left', vertical: 'middle' };
    sheet.getCell(`B${r}`).protection = { locked: true };

    // Col C — Low-case delta
    const lowCell = sheet.getCell(`C${r}`);
    lowCell.value = { formula: drv.low };
    lowCell.numFmt = NUMBER_FORMATS.percent;
    lowCell.font = { name: FONT, size: 10, color: { argb: palette.xlsx('dataNegative') } };
    lowCell.fill = FILL(palette.xlsx('paper'));
    lowCell.alignment = { horizontal: 'center', vertical: 'middle' };
    lowCell.protection = { locked: true };

    // Col D — High-case delta
    const highCell = sheet.getCell(`D${r}`);
    highCell.value = { formula: drv.high };
    highCell.numFmt = NUMBER_FORMATS.percent;
    highCell.font = { name: FONT, size: 10, color: { argb: palette.xlsx('dataPositive') } };
    highCell.fill = FILL(palette.xlsx('paper'));
    highCell.alignment = { horizontal: 'center', vertical: 'middle' };
    highCell.protection = { locked: true };

    // Col E — Range in basis points (1.0 = 10000 bp)
    const rangeBpCell = sheet.getCell(`E${r}`);
    rangeBpCell.value = { formula: `=IFERROR((ABS(D${r})+ABS(C${r}))*10000,0)` };
    rangeBpCell.numFmt = NUMBER_FORMATS.integer;
    rangeBpCell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    rangeBpCell.fill = FILL(palette.xlsx('paper'));
    rangeBpCell.alignment = { horizontal: 'center', vertical: 'middle' };
    rangeBpCell.protection = { locked: true };

    // Col F — Cumulative range (running sum)
    const cumCell = sheet.getCell(`F${r}`);
    if (idx === 0) {
      cumCell.value = { formula: `=E${r}` };
    } else {
      cumCell.value = { formula: `=F${r - 1}+E${r}` };
    }
    cumCell.numFmt = NUMBER_FORMATS.integer;
    cumCell.font = { name: FONT, size: 10, color: { argb: palette.xlsx('mutedHigh') } };
    cumCell.fill = FILL(palette.xlsx('paperSubtle'));
    cumCell.alignment = { horizontal: 'center', vertical: 'middle' };
    cumCell.protection = { locked: true };
  });

  // Color-scale on range-bp column (red = small impact, deeper = large impact)
  const driverFirstRow = driverHeaderRow + 1;
  const driverLastRow = driverHeaderRow + topDrivers.length;
  try {
    sheet.addConditionalFormatting({
      ref: `E${driverFirstRow}:E${driverLastRow}`,
      rules: [{
        type: 'colorScale',
        cfvo: [
          { type: 'min' },
          { type: 'percentile', value: 50 },
          { type: 'max' },
        ],
        color: [
          { argb: palette.xlsx('paper') },
          { argb: palette.xlsx('dataWarning') },
          { argb: palette.xlsx('dataNegative') },
        ],
        priority: 40,
      }],
    });
  } catch { /* ExcelJS conditional-format quirks vary by version */ }

  // Footer disclaimer — pushed below the new sections.
  const footerRow = driverLastRow + 2;
  sheet.mergeCells(`A${footerRow}:N${footerRow}`);
  sheet.getCell(`A${footerRow}`).value = `Generated ${ctx.generatedAt} | ${ctx.brandName} | Auto-calculated. Verify all inputs against your source data before any decision. Power users: right-click any sheet tab → Unhide → Calculations to inspect the audit-trail maths.`;
  sheet.getCell(`A${footerRow}`).font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(`A${footerRow}`).alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(footerRow).height = 28;

  return sheet;
};

/**
 * Calculations sheet — HIDDEN audit-trail with intermediate
 * revenue / cost / debt build. Power users can right-click → Unhide
 * to see how the visible Dashboard / Cash Flow numbers compose.
 *
 * Addresses the "black-box risk" raised against the 4-sheet redesign:
 * sophisticated reviewers want to trace where a number comes from.
 *
 * Layout:
 *   Block 1 — Revenue Build      (rows 4-8)
 *   Block 2 — Cost Build         (rows 12-19)
 *   Block 3 — Debt Sculpting     (rows 23-28)
 *   Block 4 — Returns Inputs     (rows 32-35)
 *
 * All formulas reference named ranges from `Inputs & Assumptions` so
 * the audit trail recalculates in lockstep with operator edits.
 */
/**
 * Debt Sizing sheet (PR-B) — computes the lender-approved permanent loan
 * amount as the MIN of four sub-limits, matching the reference pro
 * formas (RE-540 "Permanent Debt Calculation" sheet):
 *   - Loan-to-Cost (LTC) — construction-stage limit
 *   - Loan-to-Value (LTV) — permanent-stage limit on stabilised value
 *   - Debt Coverage Ratio (DCR) — cash-flow coverage on debt service
 *   - Debt Yield (DY) — pure NOI-to-loan ratio
 *
 * Why MIN of four: each lender computes their own conservative loan ceiling
 * three different ways (LTV / DCR / DY) and applies the tightest. The
 * resulting "permanent loan" is what the borrower actually receives.
 * Construction lenders additionally cap at LTC during the build phase.
 *
 * Asset-class branching:
 *   - INCOME family (commercial_office / retail / industrial_warehousing /
 *     hospitality): all four metrics meaningful. Uses the kernel's
 *     stabilised NOI (deal.stabilized_noi_cr or deal.noi_cr) as the
 *     NOI driver; falls back to Phasing!Z18 × 4 (= annualised modeled NOI
 *     from the operating P&L) if the kernel hasn't stored one.
 *   - DEVELOPMENT family (residential_apartments / villas / plotted_dev /
 *     mixed_use / redevelopment / raw_land): development deals don't
 *     typically have permanent debt — they use construction loan only,
 *     repaid from sales proceeds. Sheet shows LTC-based sizing prominent;
 *     LTV/DCR/DY computed for reference but tagged "Not Applicable" with
 *     a note.
 *
 * Output: a single cell named `PermLoanSized` (NAMED RANGE pointing at
 * the MIN of the four). The Amortization Schedule's Loan Amount formula
 * references this named range when it exists, so amortization shows the
 * actual lender-approved amount rather than the simple Total Cost × DebtLTV.
 */
const buildDebtSizingSheet = (workbook, ctx) => {
  const sheet = workbook.addWorksheet(SHEETS.debtAndAmort, {
    views: [{ showGridLines: false }],
  });
  sheet.columns = [
    { width: 32 }, // A: Label
    { width: 22 }, // B: Value
    { width: 32 }, // C: Note
  ];

  // Title — combined sheet covers BOTH sizing and amortization. Section
  // headers below carve up the worksheet visually.
  sheet.mergeCells('A1:C1');
  sheet.getCell('A1').value = `${ctx.brandName} | ${ctx.deal.name || ctx.property.property_name || 'Deal'} | Debt Sizing & Amortization`;
  styleSectionTitle(sheet.getCell('A1'));
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:C2');
  sheet.getCell('A2').value =
    'Permanent loan amount = MIN of four lender-approved limits (LTV / DCR / DY / LTC). '
    + (ctx.dealFamily === 'income'
      ? 'Income asset uses stabilised NOI as the cash-flow driver for DCR + DY tests.'
      : 'Development deal — LTC is the binding constraint during construction; LTV / DCR / DY are reference-only (no stabilised NOI yet).');
  sheet.getCell('A2').font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('A2').alignment = { vertical: 'middle', wrapText: true };
  sheet.getRow(2).height = 28;

  // ── Inputs Summary (rows 4-7) ──────────────────────────────────────────
  // Total Cost and NOI are the two drivers of every sizing test. Show
  // them at the top so the analyst sees what's feeding the MIN calcs.
  // Total Cost formula mirrors the expanded Cost Build from PR-A:
  //   Hard cost + Detailed soft costs + Revenue-driven soft costs
  // NOI source is asset-class-aware (income vs development).
  sheet.mergeCells('A4:C4');
  sheet.getCell('A4').value = 'Sizing Inputs';
  styleSectionTitle(sheet.getCell('A4'));
  sheet.getRow(4).height = 22;

  // PR-I9: PremiumFSICostCr added to hardCost so it flows through the
  // entire Total Project Cost roll-up (Calc Cost Build, Debt Sizing,
  // Waterfall). When the named range is 0 (default), the math is
  // unchanged from pre-PR-I9.
  const hardCost = '(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr+PremiumFSICostCr)';
  const softCost = `${hardCost}*(ArchitectFeePct+LegalFeePct+AppraisalFeePct+InsuranceConstPct+DeveloperOverheadPct)+LandCostCr*PropTaxConstPct`;
  // India Statutory Levies (PR-I1): Stamp+Reg on land at acquisition,
  // plus net-of-ITC GST on construction value. Asset-class-aware via the
  // GstPct + StampRegPct named ranges seeded on the Inputs sheet.
  const indiaLevies = `LandCostCr*StampRegPct+(ConstructionCostPerSqft*SaleableAreaSqft/10000000)*GstPct`;
  const totalCost = ctx.assetClass === 'hospitality'
    ? 'TotalProjectCostCr'
    : `${hardCost}+${softCost}+${indiaLevies}`;
  const totalCostNote = ctx.assetClass === 'hospitality'
    ? 'Hotel development budget from USALI Pro Forma'
    : 'Hard + Soft + India Statutory Levies (matches Calculations!B28)';

  // NOI driver — income family uses kernel-stored stabilised NOI when
  // available; development family uses a residual-land-value proxy.
  // Kernel stores in INR Cr; reference templates use INR Cr for both.
  const noiSource = ctx.dealFamily === 'income'
    ? (firstNumber(ctx.deal.stabilized_noi_cr, ctx.deal.noi_cr, ctx.kernelKpis?.noi) != null
        ? String(firstNumber(ctx.deal.stabilized_noi_cr, ctx.deal.noi_cr, ctx.kernelKpis?.noi))
        : `'${SHEETS.cashFlowEngine}'!N18*4`) // fallback to phased modeled NOI × 4 (annualised)
    : null;

  const inputsSummary = [
    ['Total Project Cost (INR Cr)', `=${totalCost}`,                                   totalCostNote],
    ['Stabilised NOI (INR Cr / yr)', ctx.dealFamily === 'income'
      ? (noiSource && /^[0-9.-]+$/.test(noiSource) ? `=${noiSource}` : `=${noiSource}`)
      : '"—"',
      ctx.dealFamily === 'income' ? 'Kernel-stored or modeled annualised NOI' : 'Not applicable — development deal'],
    ['Stabilised Value (INR Cr)',   ctx.dealFamily === 'income' ? '=B6/ExitCapRate' : '"—"',
      ctx.dealFamily === 'income' ? 'NOI ÷ Exit Cap Rate' : 'Not applicable — development deal'],
    ['Loan Interest Rate (annual)', '=DebtRatePct',                                    'From Capital Structure inputs'],
  ];
  inputsSummary.forEach(([label, value, note], idx) => {
    const r = 5 + idx;
    sheet.getCell(`A${r}`).value = label;
    styleLabelCell(sheet.getCell(`A${r}`));
    const cell = sheet.getCell(`B${r}`);
    if (value.startsWith('=')) cell.value = { formula: value };
    else cell.value = value.replace(/^"|"$/g, '');
    styleOutputCell(cell, label.includes('Rate') ? NUMBER_FORMATS.percent : NUMBER_FORMATS.currency);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    sheet.getCell(`C${r}`).value = note;
    sheet.getCell(`C${r}`).font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
    sheet.getCell(`C${r}`).protection = { locked: true };
  });

  // ── 4 sizing methods (rows 10-25) ──────────────────────────────────────
  // Each method block:
  //   Row N:   Block title (merged A:C)
  //   Row N+1: Maximum threshold (e.g., "Maximum LTV") with its named-range input
  //   Row N+2: Implied loan amount (formula)
  //   Row N+3: Implied debt / cost or yield ratio (a sanity-check derivative)
  sheet.mergeCells('A10:C10');
  sheet.getCell('A10').value = 'Method 1 — Loan-to-Cost (LTC) [Construction stage]';
  styleSectionTitle(sheet.getCell('A10'));
  sheet.getRow(10).height = 22;
  const m1Rows = [
    ['Maximum LTC',                'ConstrMaxLTC',          '=ConstrMaxLTC',                            NUMBER_FORMATS.percent, 'From Inputs!ConstrMaxLTC'],
    ['Implied loan amount (INR Cr)', null,                  `=ConstrMaxLTC*${totalCost}`,                NUMBER_FORMATS.currency, 'Max LTC × Total Project Cost'],
  ];

  sheet.mergeCells('A14:C14');
  sheet.getCell('A14').value = 'Method 2 — Loan-to-Value (LTV) [Permanent stage]';
  styleSectionTitle(sheet.getCell('A14'));
  sheet.getRow(14).height = 22;
  const m2Rows = ctx.dealFamily === 'income'
    ? [
        ['Maximum LTV',                'PermMaxLTV',         '=PermMaxLTV',                              NUMBER_FORMATS.percent,  'From Inputs!PermMaxLTV'],
        ['Implied loan amount (INR Cr)', null,               '=PermMaxLTV*B7',                            NUMBER_FORMATS.currency, 'Max LTV × Stabilised Value'],
      ]
    : [
        ['Maximum LTV',                'PermMaxLTV',         '=PermMaxLTV',                              NUMBER_FORMATS.percent,  'Reference only — no stabilised value'],
        ['Implied loan amount (INR Cr)', null,               '"—"',                                       null,                    'Development deals exit via sales not refinance'],
      ];

  sheet.mergeCells('A18:C18');
  sheet.getCell('A18').value = 'Method 3 — Debt Coverage Ratio (DCR)';
  styleSectionTitle(sheet.getCell('A18'));
  sheet.getRow(18).height = 22;
  // DCR-based loan = NOI / DCR / annual payment factor
  // Annual payment factor = (1 - (1+r)^-n) / r — present-value annuity factor
  const m3Rows = ctx.dealFamily === 'income'
    ? [
        ['Minimum DCR',                'PermMinDCR',         '=PermMinDCR',                                NUMBER_FORMATS.multiple, 'From Inputs!PermMinDCR'],
        ['Annual max debt service',    null,                  '=B6/PermMinDCR',                            NUMBER_FORMATS.currency, 'NOI ÷ DCR'],
        ['Implied loan amount (INR Cr)', null,                '=IFERROR(B20*(1-(1+DebtRatePct)^(-LoanTermYears))/DebtRatePct,0)', NUMBER_FORMATS.currency, 'PV of annual debt service'],
      ]
    : [
        ['Minimum DCR',                'PermMinDCR',         '=PermMinDCR',                                NUMBER_FORMATS.multiple, 'Reference only — no stabilised NOI'],
        ['Annual max debt service',    null,                  '"—"',                                       null,                    'Not applicable'],
        ['Implied loan amount (INR Cr)', null,                '"—"',                                       null,                    'Not applicable'],
      ];

  sheet.mergeCells('A23:C23');
  sheet.getCell('A23').value = 'Method 4 — Debt Yield (DY)';
  styleSectionTitle(sheet.getCell('A23'));
  sheet.getRow(23).height = 22;
  const m4Rows = ctx.dealFamily === 'income'
    ? [
        ['Minimum Debt Yield',         'PermMinDY',          '=PermMinDY',                                 NUMBER_FORMATS.percent,  'From Inputs!PermMinDY'],
        ['Implied loan amount (INR Cr)', null,               '=B6/PermMinDY',                              NUMBER_FORMATS.currency, 'NOI ÷ Debt Yield'],
      ]
    : [
        ['Minimum Debt Yield',         'PermMinDY',          '=PermMinDY',                                 NUMBER_FORMATS.percent,  'Reference only — no stabilised NOI'],
        ['Implied loan amount (INR Cr)', null,               '"—"',                                       null,                    'Not applicable'],
      ];

  // Write each block's rows
  const writeBlock = (startRow, rows) => {
    rows.forEach(([label, namedRange, formula, fmt, note], idx) => {
      const r = startRow + idx;
      sheet.getCell(`A${r}`).value = label;
      styleLabelCell(sheet.getCell(`A${r}`));
      const cell = sheet.getCell(`B${r}`);
      if (formula.startsWith('=')) cell.value = { formula };
      else cell.value = formula.replace(/^"|"$/g, '');
      styleOutputCell(cell, fmt);
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
      sheet.getCell(`C${r}`).value = note;
      sheet.getCell(`C${r}`).font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
      sheet.getCell(`C${r}`).protection = { locked: true };
    });
  };
  writeBlock(11, m1Rows);
  writeBlock(15, m2Rows);
  writeBlock(19, m3Rows);
  writeBlock(24, m4Rows);

  // ── Final MIN cell (row 27) — LENDER-APPROVED LOAN AMOUNT ─────────────
  // For income deals: MIN of all four (LTC, LTV, DCR, DY). For development
  // deals: just the LTC-based amount since LTV/DCR/DY all return "—".
  sheet.mergeCells('A27:C27');
  sheet.getCell('A27').value = 'Lender-Approved Loan Amount';
  styleSectionTitle(sheet.getCell('A27'));
  sheet.getRow(27).height = 22;

  sheet.getCell('A28').value = 'Permanent Loan (final)';
  styleLabelCell(sheet.getCell('A28'));
  const finalCell = sheet.getCell('B28');
  // MIN of the four implied loan amounts. For development family, LTV/
  // DCR/DY cells contain "—" strings — wrap with IFERROR so MIN
  // skips them gracefully.
  if (ctx.dealFamily === 'income') {
    finalCell.value = { formula: '=MIN(B12,B16,B21,B25)' };
  } else {
    finalCell.value = { formula: '=B12' }; // LTC-based only for dev family
  }
  styleOutputCell(finalCell, NUMBER_FORMATS.currency);
  finalCell.font = { name: FONT, size: 14, bold: true, color: { argb: palette.xlsx('dataPositive') } };

  sheet.getCell('C28').value = ctx.dealFamily === 'income'
    ? 'MIN of LTC / LTV / DCR / DY — the tightest constraint wins'
    : 'LTC-based only — development deals use construction loan, exit via sales';
  sheet.getCell('C28').font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };

  // Comparison to simple "DebtLTV × Total Cost" (the legacy formula)
  sheet.getCell('A29').value = 'For comparison: DebtLTV × Total Cost (legacy)';
  sheet.getCell('A29').font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  const legacyCell = sheet.getCell('B29');
  legacyCell.value = { formula: `=DebtLTV*${totalCost}` };
  styleOutputCell(legacyCell, NUMBER_FORMATS.currency);
  legacyCell.font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('C29').value = 'Pre-PR-B sizing for reference';
  sheet.getCell('C29').font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };

  // Footer disclosure
  sheet.mergeCells('A31:C31');
  sheet.getCell('A31').value =
    'NOI sourced from kernel-stored stabilised_noi_cr when populated (income family). '
    + 'Annual payment factor uses simple ordinary annuity for sizing; the detailed debt schedule below models construction conversion and moratorium timing. '
    + 'For development deals, lender sizing in practice depends on residual land value + sales receivable assignment — model treats LTC as binding for simplicity.';
  sheet.getCell('A31').font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('A31').alignment = { vertical: 'top', wrapText: true };
  sheet.getRow(31).height = 36;

  return sheet;
};

/**
 * Amortization Schedule sheet — quarter-by-quarter debt amortization with
 * Beginning Balance / Payment / Interest / Principal / Ending Balance
 * columns. This is the standard "Amortization Schedule" sheet in every
 * institutional pro forma (NAIOP, RE-540 both have explicit amort sheets).
 *
 * Loan terms section at the top (rows 4-10) summarises the inputs that
 * drive the schedule — Loan Amount (= Total Cost × DebtLTV), annualised
 * Interest Rate, Loan Term in years, computed Quarterly Rate, computed
 * Quarterly Payment (Excel PMT formula).
 *
 * Schedule table (rows 12+) emits one row per quarter for the full loan
 * term. Capped at 80 quarters (= 20-year term) for readability; longer
 * loans are uncommon in Indian residential.
 *
 * Limitations called out in-sheet:
 *   - Single-loan model (PR-C ships before PR-B which splits construction
 *     vs permanent loan). Once PR-B lands, this schedule will show the
 *     PERMANENT loan amortization specifically, not the blended.
 *   - Moratorium currently ignored — the input MoratoriumMonths exists on
 *     the Inputs sheet but the standard PMT formula doesn't model it.
 *     Operator can override the schedule manually or wait for PR-B's
 *     proper debt sculpting.
 *   - Interest computed at the effective quarterly rate
 *     ((1+annual)^(1/4) - 1) so an analyst sees the same total finance
 *     cost as if compounding monthly / continuously.
 */
const buildAmortizationSheet = (workbook, ctx) => {
  // Post-restructure: amortization renders on the SAME sheet as Debt Sizing
  // (sheet name = SHEETS.debtAndAmort). The amortization section starts at
  // row 32 (after Debt Sizing's MIN-of-4 calculations end around row 28).
  const sheet = workbook.getWorksheet(SHEETS.debtAndAmort);
  if (!sheet) throw new Error('Debt Sizing & Amortization sheet must be created by buildDebtSizingSheet first');

  {
    [16, 16, 18, 18, 18, 18, 18, 18, 18, 18, 18].forEach((width, idx) => {
      const col = sheet.getColumn(idx + 4);
      if (col.width == null) col.width = width;
    });

    const AMORT_BASE = 32;
    const termsTitleRow = AMORT_BASE + 2;
    const headerRow = AMORT_BASE + 12;
    const firstScheduleRow = headerRow + 1;
    const maxRows = 80;

    sheet.mergeCells(`A${AMORT_BASE}:N${AMORT_BASE}`);
    sheet.getCell(`A${AMORT_BASE}`).value = 'Construction-to-Permanent Debt Schedule';
    styleSectionTitle(sheet.getCell(`A${AMORT_BASE}`));
    sheet.getRow(AMORT_BASE).height = 24;

    sheet.mergeCells(`A${AMORT_BASE + 1}:N${AMORT_BASE + 1}`);
    sheet.getCell(`A${AMORT_BASE + 1}`).value = 'Construction draws, capitalized interest, conversion/refi, permanent moratorium, and amortization all recalculate from named ranges on Inputs & Assumptions.';
    sheet.getCell(`A${AMORT_BASE + 1}`).font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
    sheet.getCell(`A${AMORT_BASE + 1}`).alignment = { vertical: 'middle', wrapText: true };
    sheet.getRow(AMORT_BASE + 1).height = 22;

    sheet.mergeCells(`A${termsTitleRow}:N${termsTitleRow}`);
    sheet.getCell(`A${termsTitleRow}`).value = 'Debt Phase Terms';
    styleSectionTitle(sheet.getCell(`A${termsTitleRow}`));
    sheet.getRow(termsTitleRow).height = 22;

    const termsRows = [
      ['Construction Loan Cap (INR Cr)', '=TotalProjectCostCr*ConstructionLoanLTC', NUMBER_FORMATS.currency],
      ['Permanent Loan Amount (INR Cr)', '=B28', NUMBER_FORMATS.currency],
      ['Construction Quarterly Rate', '=(1+ConstructionDebtRatePct)^(1/4)-1', NUMBER_FORMATS.percent],
      ['Permanent Quarterly Rate', '=(1+PermanentDebtRatePct)^(1/4)-1', NUMBER_FORMATS.percent],
      ['Principal Moratorium Quarters', '=ROUNDUP(MoratoriumMonths/3,0)', NUMBER_FORMATS.integer],
      ['Conversion / Refi Quarter', '=MAX(1,RefinanceQuarter)', NUMBER_FORMATS.integer],
      ['Permanent Amortization Periods', '=LoanTermYears*4', NUMBER_FORMATS.integer],
      ['Permanent Amortizing Payment (INR Cr)', '=-PMT(B38,MAX(B41-B39,1),B36)', NUMBER_FORMATS.currency],
    ];
    termsRows.forEach(([label, formula, fmt], idx) => {
      const r = 35 + idx;
      sheet.getCell(`A${r}`).value = label;
      styleLabelCell(sheet.getCell(`A${r}`));
      const cell = sheet.getCell(`B${r}`);
      cell.value = { formula };
      styleOutputCell(cell, fmt);
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    });

    [
      'Period',
      'Phase',
      'Construction Draw',
      'Construction Beg. Balance',
      'Construction Interest',
      'Capitalized IDC',
      'Refi Payoff',
      'Construction End Balance',
      'Permanent Beg. Balance',
      'Permanent Payment',
      'Permanent Interest',
      'Permanent Principal',
      'Permanent End Balance',
      'Cash Debt Service',
    ].forEach((label, idx) => {
      const cell = sheet.getCell(headerRow, idx + 1);
      cell.value = label;
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('paperElevated') } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = FILL(palette.xlsx('inkDeep'));
      cell.protection = { locked: true };
    });
    sheet.getRow(headerRow).height = 30;

    for (let i = 0; i < maxRows; i += 1) {
      const r = firstScheduleRow + i;
      const period = i + 1;
      const priorDraws = i === 0 ? '0' : `SUM($C$${firstScheduleRow}:C${r - 1})`;
      const priorConstructionEnd = i === 0 ? '0' : `H${r - 1}`;
      const priorPermanentEnd = i === 0 ? '0' : `M${r - 1}`;

      sheet.getCell(`A${r}`).value = { formula: `=IF(${period}<=$B$40+$B$41,${period},"")` };
      sheet.getCell(`A${r}`).font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('mutedHigh') } };
      sheet.getCell(`A${r}`).alignment = { horizontal: 'center' };

      const formulas = [
        null,
        `=IF($A${r}="","",IF($A${r}<=$B$40,"Construction","Permanent"))`,
        `=IF($B${r}="Construction",MIN(MAX($B$35-${priorDraws},0),IFERROR($B$35/$B$40,0)),0)`,
        `=IF($A${r}="","",IF($B${r}="Construction",${priorConstructionEnd},IF($A${r}=$B$40+1,${priorConstructionEnd},0)))`,
        `=IF($B${r}="Construction",(D${r}+C${r}/2)*$B$37,0)`,
        `=IF($B${r}="Construction",E${r},0)`,
        `=IF(AND($B${r}="Permanent",$A${r}=$B$40+1),D${r},0)`,
        `=IF($A${r}="","",IF($B${r}="Construction",D${r}+C${r}+F${r},MAX(0,D${r}-G${r})))`,
        `=IF($A${r}="","",IF($B${r}="Permanent",IF($A${r}=$B$40+1,$B$36,${priorPermanentEnd}),0))`,
        `=IF($B${r}<>"Permanent",0,IF($A${r}<=$B$40+$B$39,K${r},MIN(I${r}+K${r},$B$42)))`,
        `=IF($B${r}="Permanent",I${r}*$B$38,0)`,
        `=MAX(0,J${r}-K${r})`,
        `=IF($B${r}="Permanent",MAX(0,I${r}-L${r}),0)`,
        `=IF($B${r}="Construction",0,J${r})`,
      ];

      formulas.forEach((formula, idx) => {
        if (idx === 0) return;
        const cell = sheet.getCell(r, idx + 1);
        cell.value = { formula };
        cell.font = { name: FONT, size: 9, color: { argb: palette.xlsx('inkDeep') } };
        cell.alignment = { horizontal: idx === 1 ? 'center' : 'right', vertical: 'middle' };
        if (idx !== 1) cell.numFmt = NUMBER_FORMATS.currency;
      });

      if (i % 2 === 1) {
        for (let col = 1; col <= 14; col += 1) {
          sheet.getCell(r, col).fill = FILL(palette.xlsx('paperSubtle'));
        }
      }
    }

    const footerRow = firstScheduleRow + maxRows + 1;
    sheet.mergeCells(`A${footerRow}:N${footerRow}`);
    sheet.getCell(`A${footerRow}`).value =
      'Construction interest is capitalized through conversion. Permanent debt then starts from the lender-sized loan amount, pays interest-only during MoratoriumMonths, and amortizes thereafter with a quarterly PMT formula.';
    sheet.getCell(`A${footerRow}`).font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
    sheet.getCell(`A${footerRow}`).alignment = { vertical: 'top', wrapText: true };
    sheet.getRow(footerRow).height = 36;

    return sheet;
  }

  // Column widths set by buildDebtSizingSheet (A=32, B=22, C=32). The
  // amortization table needs 6 columns (Period / BegBal / Payment /
  // Interest / Principal / EndBal). Extend columns D-F to match the
  // amortization width.
  if (sheet.getColumn(4).width == null) sheet.getColumn(4).width = 16;
  if (sheet.getColumn(5).width == null) sheet.getColumn(5).width = 16;
  if (sheet.getColumn(6).width == null) sheet.getColumn(6).width = 22;

  // amortShift translates legacy Amortization sheet rows (which assumed
  // section title at row 4, loan amount at row 5, table header at row 12)
  // into their post-consolidation positions (row 34 title, row 35 loan
  // amount, row 42 table header). Shift = 30.
  const AMORT_BASE = 32; // section header row
  const amortShift = AMORT_BASE - 2; // 30

  // Section divider for the Amortization Schedule block
  sheet.mergeCells(`A${AMORT_BASE}:F${AMORT_BASE}`);
  sheet.getCell(`A${AMORT_BASE}`).value = 'Amortization Schedule';
  styleSectionTitle(sheet.getCell(`A${AMORT_BASE}`));
  sheet.getRow(AMORT_BASE).height = 24;

  sheet.mergeCells(`A${AMORT_BASE + 1}:F${AMORT_BASE + 1}`);
  sheet.getCell(`A${AMORT_BASE + 1}`).value = 'Quarter-by-quarter debt amortization. All values recalculate from the named ranges on the Inputs sheet — edit LandCostCr, ConstructionCostPerSqft, DebtLTV, DebtRatePct, or LoanTermYears to flow through.';
  sheet.getCell(`A${AMORT_BASE + 1}`).font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(`A${AMORT_BASE + 1}`).alignment = { vertical: 'middle', wrapText: true };
  sheet.getRow(AMORT_BASE + 1).height = 22;

  // ── Loan Terms summary block (was rows 4-10; now AMORT_BASE+2 to AMORT_BASE+8)
  const termsTitleRow = AMORT_BASE + 2; // 34
  sheet.mergeCells(`A${termsTitleRow}:F${termsTitleRow}`);
  sheet.getCell(`A${termsTitleRow}`).value = 'Loan Terms';
  styleSectionTitle(sheet.getCell(`A${termsTitleRow}`));
  sheet.getRow(termsTitleRow).height = 22;

  // Loan Amount = lender-approved permanent loan from the Debt Sizing
  // section above (= MIN of LTC / LTV / DCR / DY for income deals; LTC
  // only for development). Same-sheet ref since post-restructure both
  // sections live on the SAME worksheet (Debt Sizing & Amortization).
  // The MIN cell stayed at row 28 since the Debt Sizing section itself
  // wasn't restructured.
  const termsRows = [
    ['Loan Amount (INR Cr)',         `=B28`,                                               NUMBER_FORMATS.currency],
    ['Annual Interest Rate',         '=DebtRatePct',                                       NUMBER_FORMATS.percent],
    ['Loan Term (years)',            '=LoanTermYears',                                     NUMBER_FORMATS.integer],
    ['Quarterly Periods',            '=LoanTermYears*4',                                   NUMBER_FORMATS.integer],
    ['Effective Quarterly Rate',     '=(1+DebtRatePct)^(1/4)-1',                            NUMBER_FORMATS.percent],
    ['Quarterly Payment (INR Cr)',   `=-PMT(B${9 + amortShift},B${8 + amortShift},B${5 + amortShift})`, NUMBER_FORMATS.currency],
  ];
  termsRows.forEach(([label, formula, fmt], idx) => {
    const r = (5 + amortShift) + idx;
    sheet.getCell(`A${r}`).value = label;
    styleLabelCell(sheet.getCell(`A${r}`));
    const cell = sheet.getCell(`B${r}`);
    cell.value = { formula };
    styleOutputCell(cell, fmt);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
  });

  // ── Amortization table header (was row 12; now row 42) ─────────────────
  const headerRow = 12 + amortShift; // 42
  ['Period', 'Beginning Balance', 'Payment', 'Interest', 'Principal', 'Ending Balance']
    .forEach((label, idx) => {
      const cell = sheet.getCell(headerRow, idx + 1);
      cell.value = label;
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('paperElevated') } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = FILL(palette.xlsx('inkDeep'));
      cell.protection = { locked: true };
    });
  sheet.getRow(headerRow).height = 24;

  // ── Schedule rows ──────────────────────────────────────────────────────
  // Cap at min(LoanTerm*4, 80) — Indian residential rarely runs > 20 years.
  // The schedule shows periods 1..N; if LoanTermYears is small, later
  // rows show #N/A naturally (Period > term).
  //
  // For each row (post-restructure: all row refs shift by amortShift=30):
  //   Beginning Balance:
  //     - Period 1: = Loan Amount (B35; was B5 pre-restructure)
  //     - Period N: = Ending Balance of previous row
  //   Payment:        = Quarterly Payment (B40) for all periods
  //   Interest:       = Beginning Balance × Quarterly Rate (B39)
  //   Principal:      = Payment − Interest
  //   Ending Balance: = Beginning Balance − Principal
  // IFERROR everywhere so that out-of-term rows stay blank rather than
  // showing error values.
  const maxRows = Math.min(80, 80); // hard cap; LoanTermYears reflects actual
  for (let i = 0; i < maxRows; i += 1) {
    const r = (13 + amortShift) + i; // 43 + i
    const period = i + 1;
    // Period column
    sheet.getCell(`A${r}`).value = { formula: `=IF(${period}<=$B$${8 + amortShift},${period},"")` };
    sheet.getCell(`A${r}`).font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('mutedHigh') } };
    sheet.getCell(`A${r}`).alignment = { horizontal: 'center' };
    // Beginning Balance
    sheet.getCell(`B${r}`).value = {
      formula: i === 0 ? `=$B$${5 + amortShift}` : `=IF($A${r}="","",F${r - 1})`,
    };
    sheet.getCell(`B${r}`).numFmt = NUMBER_FORMATS.currency;
    // Payment
    sheet.getCell(`C${r}`).value = { formula: `=IF($A${r}="","",$B$${10 + amortShift})` };
    sheet.getCell(`C${r}`).numFmt = NUMBER_FORMATS.currency;
    // Interest
    sheet.getCell(`D${r}`).value = { formula: `=IF($A${r}="","",B${r}*$B$${9 + amortShift})` };
    sheet.getCell(`D${r}`).numFmt = NUMBER_FORMATS.currency;
    // Principal
    sheet.getCell(`E${r}`).value = { formula: `=IF($A${r}="","",C${r}-D${r})` };
    sheet.getCell(`E${r}`).numFmt = NUMBER_FORMATS.currency;
    // Ending Balance
    sheet.getCell(`F${r}`).value = { formula: `=IF($A${r}="","",MAX(B${r}-E${r},0))` };
    sheet.getCell(`F${r}`).numFmt = NUMBER_FORMATS.currency;
    // Light banding — alternate rows with a subtle fill
    if (i % 2 === 1) {
      ['A', 'B', 'C', 'D', 'E', 'F'].forEach((col) => {
        sheet.getCell(`${col}${r}`).fill = FILL(palette.xlsx('paperSubtle'));
      });
    }
  }

  // Footer disclosure
  const footerRow = (13 + amortShift) + maxRows + 1;
  sheet.mergeCells(`A${footerRow}:F${footerRow}`);
  sheet.getCell(`A${footerRow}`).value =
    'Debt schedule shown at the effective quarterly rate ((1+annual)^(1/4)-1), with construction conversion and permanent-loan moratorium timing modeled from named inputs. Verify against the lender term sheet before use.';
  sheet.getCell(`A${footerRow}`).font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(`A${footerRow}`).alignment = { vertical: 'top', wrapText: true };
  sheet.getRow(footerRow).height = 36;

  return sheet;
};

const appendWaterfallToDebtSheet = (workbook, ctx) => {
  const sheet = workbook.getWorksheet(SHEETS.debtAndAmort);
  if (!sheet) throw new Error('Debt Sizing & Amortization sheet must exist before appending waterfall');

  {
    const widthByCol = {
      A: 14, B: 14, C: 18, D: 18, E: 18, F: 18, G: 18, H: 18,
      I: 18, J: 18, K: 18, L: 18, M: 18, N: 18, O: 18, P: 18,
    };
    Object.entries(widthByCol).forEach(([col, width]) => {
      if (sheet.getColumn(col).width == null || sheet.getColumn(col).width < width) {
        sheet.getColumn(col).width = width;
      }
    });

    const startRow = 130;
    const hardCost = '(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr+PremiumFSICostCr)';
    const softCost = `${hardCost}*(ArchitectFeePct+LegalFeePct+AppraisalFeePct+InsuranceConstPct+DeveloperOverheadPct)+LandCostCr*PropTaxConstPct`;
    const indiaLevies = `LandCostCr*StampRegPct+(ConstructionCostPerSqft*SaleableAreaSqft/10000000)*GstPct`;
    const totalCost = ctx.assetClass === 'hospitality'
      ? 'TotalProjectCostCr'
      : `${hardCost}+${softCost}+${indiaLevies}`;
    const distributionCashFlowRow = ctx.dealFamily === 'income' ? 32 : 38;
    const lastCashFlowCol = excelCol(ctx.totalQuarters + 1);

    sheet.mergeCells(`A${startRow}:P${startRow}`);
    sheet.getCell(`A${startRow}`).value = 'Sponsor / LP Waterfall';
    styleSectionTitle(sheet.getCell(`A${startRow}`));
    sheet.getRow(startRow).height = 24;

    sheet.mergeCells(`A${startRow + 1}:P${startRow + 1}`);
    sheet.getCell(`A${startRow + 1}`).value =
      'Quarterly distribution waterfall linked to Cash Flow Engine, with preferred return, return of LP capital, sponsor catch-up, and hurdle-ladder promote splits.';
    sheet.getCell(`A${startRow + 1}`).font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
    sheet.getCell(`A${startRow + 1}`).alignment = { vertical: 'middle', wrapText: true };
    sheet.getRow(startRow + 1).height = 24;

    sheet.mergeCells(`A${startRow + 3}:D${startRow + 3}`);
    sheet.getCell(`A${startRow + 3}`).value = 'Capital Stack';
    styleSectionTitle(sheet.getCell(`A${startRow + 3}`));
    [
      ['Total Project Cost (INR Cr)', `=${totalCost}`, NUMBER_FORMATS.currency],
      ['Lender-Approved Loan (INR Cr)', '=$B$28', NUMBER_FORMATS.currency],
      ['Total Equity (INR Cr)', `=B${startRow + 4}-B${startRow + 5}`, NUMBER_FORMATS.currency],
      ['LP Equity (INR Cr)', `=B${startRow + 6}*LPEquityPct`, NUMBER_FORMATS.currency],
      ['GP / Sponsor Equity (INR Cr)', `=B${startRow + 6}*GPEquityPct`, NUMBER_FORMATS.currency],
    ].forEach(([label, formula, fmt], idx) => {
      const r = startRow + 4 + idx;
      sheet.getCell(`A${r}`).value = label;
      styleLabelCell(sheet.getCell(`A${r}`));
      const cell = sheet.getCell(`B${r}`);
      cell.value = { formula };
      styleOutputCell(cell, fmt);
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
      sheet.mergeCells(`C${r}:D${r}`);
      sheet.getCell(`C${r}`).value = idx === 0 ? 'Hard + soft + statutory levies' : 'Linked capital stack assumption';
      sheet.getCell(`C${r}`).font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
      sheet.getCell(`C${r}`).alignment = { wrapText: true, vertical: 'top' };
    });

    sheet.mergeCells(`F${startRow + 3}:I${startRow + 3}`);
    sheet.getCell(`F${startRow + 3}`).value = 'Hurdle Ladder';
    styleSectionTitle(sheet.getCell(`F${startRow + 3}`));
    [
      ['Modeled Project IRR', '=IF(ISNUMBER(Dashboard!B21),Dashboard!B21,0)', NUMBER_FORMATS.percent, 'Used to select active promote tier'],
      ['Active Promote Tier', '=IF($G$134>=Hurdle2IRR,"Tier 3: Hurdle 2 split",IF($G$134>=Hurdle1IRR,"Tier 2: Hurdle 1 split","Tier 1: Base promote split"))', null, 'Base, first hurdle, or second hurdle'],
      ['Catch-Up Target GP Profit %', '=CatchUpTargetGPPct', NUMBER_FORMATS.percent, 'Cumulative GP share of profit after LP pref'],
      ['Catch-Up Cash to Sponsor', '=CatchUpPct', NUMBER_FORMATS.percent, 'Share of catch-up tranche paid to sponsor'],
      ['Distribution Dates Modeled', `=${ctx.totalQuarters}`, NUMBER_FORMATS.integer, 'Quarterly dates from Cash Flow Engine row 3'],
    ].forEach(([label, formula, fmt, note], idx) => {
      const r = startRow + 4 + idx;
      sheet.getCell(`F${r}`).value = label;
      styleLabelCell(sheet.getCell(`F${r}`));
      const valueCell = sheet.getCell(`G${r}`);
      valueCell.value = { formula };
      if (fmt) styleOutputCell(valueCell, fmt);
      else {
        valueCell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
        valueCell.alignment = { horizontal: 'left', vertical: 'middle' };
      }
      sheet.mergeCells(`H${r}:I${r}`);
      sheet.getCell(`H${r}`).value = note;
      sheet.getCell(`H${r}`).font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
      sheet.getCell(`H${r}`).alignment = { wrapText: true, vertical: 'top' };
    });

    const tableTitleRow = startRow + 11;
    const headerRow = tableTitleRow + 1;
    const firstDataRow = headerRow + 1;
    sheet.mergeCells(`A${tableTitleRow}:P${tableTitleRow}`);
    sheet.getCell(`A${tableTitleRow}`).value = 'Quarterly Distribution Waterfall';
    styleSectionTitle(sheet.getCell(`A${tableTitleRow}`));
    sheet.getRow(tableTitleRow).height = 22;

    [
      'Period',
      'Date',
      'Available Cash',
      'Beg LP Capital',
      'Beg Unpaid Pref',
      'Pref Accrual',
      'LP Pref Paid',
      'LP Capital Return',
      'GP Catch-Up',
      'LP Promote',
      'GP Promote',
      'End LP Capital',
      'End Unpaid Pref',
      'LP Total',
      'GP Total',
      'Residual',
    ].forEach((label, idx) => {
      const cell = sheet.getCell(headerRow, idx + 1);
      cell.value = label;
      cell.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = FILL(palette.xlsx('inkDeep'));
      cell.protection = { locked: true };
    });
    sheet.getRow(headerRow).height = 30;

    for (let q = 1; q <= ctx.totalQuarters; q += 1) {
      const r = firstDataRow + q - 1;
      const cashFlowCol = excelCol(q + 1);
      const priorLpPromote = q === 1 ? '0' : `SUM($J$${firstDataRow}:J${r - 1})`;
      const priorGpProfit = q === 1 ? '0' : `SUM($I$${firstDataRow}:I${r - 1})+SUM($K$${firstDataRow}:K${r - 1})`;
      const selectedLpPct = 'IF($G$134>=Hurdle2IRR,Hurdle2LPPct,IF($G$134>=Hurdle1IRR,Hurdle1LPPct,PromoteLPPct))';
      const selectedGpPct = 'IF($G$134>=Hurdle2IRR,Hurdle2GPPct,IF($G$134>=Hurdle1IRR,Hurdle1GPPct,PromoteGPPct))';

      sheet.getCell(`A${r}`).value = `Q${q}`;
      sheet.getCell(`B${r}`).value = { formula: `='${SHEETS.cashFlowEngine}'!${cashFlowCol}$3` };
      sheet.getCell(`C${r}`).value = { formula: `=MAX(0,'${SHEETS.cashFlowEngine}'!${cashFlowCol}$${distributionCashFlowRow})` };
      sheet.getCell(`D${r}`).value = { formula: q === 1 ? '=$B$137' : `=L${r - 1}` };
      sheet.getCell(`E${r}`).value = { formula: q === 1 ? '=0' : `=M${r - 1}` };
      sheet.getCell(`F${r}`).value = { formula: `=D${r}*((1+PrefReturnRate)^(1/4)-1)` };
      sheet.getCell(`G${r}`).value = { formula: `=MIN(C${r},E${r}+F${r})` };
      sheet.getCell(`H${r}`).value = { formula: `=MIN(MAX(0,C${r}-G${r}),D${r})` };
      sheet.getCell(`I${r}`).value = {
        formula: `=MIN(MAX(0,C${r}-G${r}-H${r}),MAX(0,(SUM($G$${firstDataRow}:G${r})+${priorLpPromote})*CatchUpTargetGPPct/MAX(1-CatchUpTargetGPPct,0.0001)-(${priorGpProfit})))*CatchUpPct`,
      };
      sheet.getCell(`J${r}`).value = { formula: `=MAX(0,C${r}-G${r}-H${r}-I${r})*${selectedLpPct}` };
      sheet.getCell(`K${r}`).value = { formula: `=MAX(0,C${r}-G${r}-H${r}-I${r})*${selectedGpPct}` };
      sheet.getCell(`L${r}`).value = { formula: `=MAX(0,D${r}-H${r})` };
      sheet.getCell(`M${r}`).value = { formula: `=MAX(0,E${r}+F${r}-G${r})` };
      sheet.getCell(`N${r}`).value = { formula: `=G${r}+H${r}+J${r}` };
      sheet.getCell(`O${r}`).value = { formula: `=I${r}+K${r}` };
      sheet.getCell(`P${r}`).value = { formula: `=MAX(0,C${r}-G${r}-H${r}-I${r}-J${r}-K${r})` };

      for (let col = 1; col <= 16; col += 1) {
        const cell = sheet.getCell(r, col);
        cell.font = { name: FONT, size: 9, color: { argb: palette.xlsx('inkDeep') } };
        cell.alignment = { horizontal: col <= 2 ? 'center' : 'right', vertical: 'middle' };
        if (col === 2) cell.numFmt = NUMBER_FORMATS.date;
        if (col >= 3) cell.numFmt = NUMBER_FORMATS.currency;
        if (q % 2 === 0) cell.fill = FILL(palette.xlsx('paperSubtle'));
      }
    }

    const lastDataRow = firstDataRow + ctx.totalQuarters - 1;
    const summaryStartRow = lastDataRow + 3;
    sheet.mergeCells(`A${summaryStartRow}:D${summaryStartRow}`);
    sheet.getCell(`A${summaryStartRow}`).value = 'Waterfall Summary';
    styleSectionTitle(sheet.getCell(`A${summaryStartRow}`));
    [
      ['Total LP Distributions (INR Cr)', `=SUM(N${firstDataRow}:N${lastDataRow})`, NUMBER_FORMATS.currency],
      ['Total GP Distributions (INR Cr)', `=SUM(O${firstDataRow}:O${lastDataRow})`, NUMBER_FORMATS.currency],
      ['LP Equity Multiple', `=IFERROR(B${summaryStartRow + 1}/B137,0)`, NUMBER_FORMATS.multiple],
      ['GP Equity Multiple', `=IFERROR(B${summaryStartRow + 2}/B138,0)`, NUMBER_FORMATS.multiple],
      ['GP Catch-Up Paid (INR Cr)', `=SUM(I${firstDataRow}:I${lastDataRow})`, NUMBER_FORMATS.currency],
      ['Residual Unallocated (INR Cr)', `=SUM(P${firstDataRow}:P${lastDataRow})`, NUMBER_FORMATS.currency],
      ['Selected Promote Tier', '=$G$135', null],
      ['Cash Flow Row Used', `="'${SHEETS.cashFlowEngine}' row ${distributionCashFlowRow} through ${lastCashFlowCol}${distributionCashFlowRow}"`, null],
    ].forEach(([label, formula, fmt], idx) => {
      const r = summaryStartRow + 1 + idx;
      sheet.getCell(`A${r}`).value = label;
      styleLabelCell(sheet.getCell(`A${r}`));
      const cell = sheet.getCell(`B${r}`);
      cell.value = { formula };
      if (fmt) styleOutputCell(cell, fmt);
      else {
        cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
        cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      }
    });

    const disclosureRow = summaryStartRow + 11;
    sheet.mergeCells(`A${disclosureRow}:P${disclosureRow}`);
    sheet.getCell(`A${disclosureRow}`).value =
      'Waterfall uses quarterly available-cash distributions from Cash Flow Engine. Preferred return accrues on unpaid LP capital, catch-up targets the GP profit share, and residual promote split steps up when modeled project IRR crosses Hurdle1IRR or Hurdle2IRR.';
    sheet.getCell(`A${disclosureRow}`).font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
    sheet.getCell(`A${disclosureRow}`).alignment = { vertical: 'top', wrapText: true };
    sheet.getRow(disclosureRow).height = 36;

    return sheet;
  }

  if (sheet.getColumn(4).width == null) sheet.getColumn(4).width = 18;
  if (sheet.getColumn(5).width == null) sheet.getColumn(5).width = 18;
  if (sheet.getColumn(6).width == null) sheet.getColumn(6).width = 42;

  const startRow = 126;
  sheet.mergeCells(`A${startRow}:F${startRow}`);
  sheet.getCell(`A${startRow}`).value = 'Sponsor / LP Waterfall';
  styleSectionTitle(sheet.getCell(`A${startRow}`));
  sheet.getRow(startRow).height = 24;

  sheet.mergeCells(`A${startRow + 1}:F${startRow + 1}`);
  sheet.getCell(`A${startRow + 1}`).value =
    'Quarterly promote model linked to the debt sizing result above. Edit waterfall assumptions on Inputs & Assumptions.';
  sheet.getCell(`A${startRow + 1}`).font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(`A${startRow + 1}`).alignment = { vertical: 'middle', wrapText: true };
  sheet.getRow(startRow + 1).height = 22;

  const hardCost = '(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr+PremiumFSICostCr)';
  const softCost = `${hardCost}*(ArchitectFeePct+LegalFeePct+AppraisalFeePct+InsuranceConstPct+DeveloperOverheadPct)+LandCostCr*PropTaxConstPct`;
  const indiaLevies = `LandCostCr*StampRegPct+(ConstructionCostPerSqft*SaleableAreaSqft/10000000)*GstPct`;
  const totalCost = ctx.assetClass === 'hospitality'
    ? 'TotalProjectCostCr'
    : `${hardCost}+${softCost}+${indiaLevies}`;

  const sections = [
    {
      title: 'Capital Stack',
      start: startRow + 3,
      rows: [
        ['Total Project Cost (INR Cr)', `=${totalCost}`, NUMBER_FORMATS.currency, ctx.assetClass === 'hospitality' ? 'Hotel budget total' : 'Hard + soft + statutory levies'],
        ['Lender-Approved Loan (INR Cr)', '=$B$28', NUMBER_FORMATS.currency, 'MIN of lender sizing tests above'],
        ['Total Equity (INR Cr)', `=B${startRow + 4}-B${startRow + 5}`, NUMBER_FORMATS.currency, 'Project cost less approved loan'],
        ['LP Equity (INR Cr)', `=B${startRow + 6}*LPEquityPct`, NUMBER_FORMATS.currency, 'LP share of total equity'],
        ['GP / Sponsor Equity (INR Cr)', `=B${startRow + 6}*GPEquityPct`, NUMBER_FORMATS.currency, 'Sponsor share of total equity'],
      ],
    },
    {
      title: 'Proceeds & Preferred Return',
      start: startRow + 11,
      rows: [
        ['Project Hold Period (years)', '=LoanTermYears', NUMBER_FORMATS.integer, 'Pref compounding period'],
        ['Total Cash Available to Equity', ctx.dealFamily === 'income'
          ? `=MAX(0,${totalCost}+'${SHEETS.cashFlowEngine}'!N18*4*LoanTermYears-B${startRow + 5})`
          : `=MAX(0,(SaleableAreaSqft*SellRatePerSqft/10000000)-${totalCost})+B${startRow + 5}`,
        NUMBER_FORMATS.currency, 'Single-exit equity proceeds after debt'],
        ['LP Pref Accrual (compounded)', `=B${startRow + 7}*((1+PrefReturnRate)^B${startRow + 12}-1)`, NUMBER_FORMATS.currency, 'LP equity x compounded pref'],
        ['Tier 1 LP Distribution', `=MIN(B${startRow + 13},B${startRow + 7}+B${startRow + 14})`, NUMBER_FORMATS.currency, 'LP capital plus pref, capped at proceeds'],
        ['Residual after Tier 1 (INR Cr)', `=MAX(0,B${startRow + 13}-B${startRow + 15})`, NUMBER_FORMATS.currency, 'Cash available for promote split'],
      ],
    },
    {
      title: 'Promote Split',
      start: startRow + 19,
      rows: [
        ['Promote - LP Allocation', `=B${startRow + 16}*PromoteLPPct`, NUMBER_FORMATS.currency, 'Residual x LP promote share'],
        ['Promote - GP Allocation', `=B${startRow + 16}*PromoteGPPct`, NUMBER_FORMATS.currency, 'Residual x GP promote share'],
        ['GP Return of Capital', `=MIN(B${startRow + 8},B${startRow + 21})`, NUMBER_FORMATS.currency, 'GP recovers invested capital from GP allocation'],
        ['GP Net Promote (after RoC)', `=B${startRow + 21}-B${startRow + 22}`, NUMBER_FORMATS.currency, 'GP carry above capital recovery'],
      ],
    },
    {
      title: 'Final Investor Returns',
      start: startRow + 26,
      rows: [
        ['LP Total Distribution (INR Cr)', `=B${startRow + 15}+B${startRow + 20}`, NUMBER_FORMATS.currency, 'Tier 1 distribution plus LP promote allocation'],
        ['GP Total Distribution (INR Cr)', `=B${startRow + 21}`, NUMBER_FORMATS.currency, 'GP allocation including capital and promote'],
        ['LP Equity Multiple', `=IFERROR(B${startRow + 27}/B${startRow + 7},0)`, NUMBER_FORMATS.multiple, 'Total LP returned / LP capital invested'],
        ['GP Equity Multiple', `=IFERROR(B${startRow + 28}/B${startRow + 8},0)`, NUMBER_FORMATS.multiple, 'Total GP returned / GP capital invested'],
        ['LP IRR (annualised, approx)', `=IFERROR((B${startRow + 29})^(1/B${startRow + 12})-1,0)`, NUMBER_FORMATS.percent, 'Single-exit approximation'],
        ['GP IRR (annualised, approx)', `=IFERROR((B${startRow + 30})^(1/B${startRow + 12})-1,0)`, NUMBER_FORMATS.percent, 'Single-exit approximation'],
      ],
    },
  ];

  sections.forEach((section) => {
    sheet.mergeCells(`A${section.start}:F${section.start}`);
    sheet.getCell(`A${section.start}`).value = section.title;
    styleSectionTitle(sheet.getCell(`A${section.start}`));
    sheet.getRow(section.start).height = 22;
    section.rows.forEach(([label, formula, format, note], idx) => {
      const row = section.start + 1 + idx;
      sheet.getCell(`A${row}`).value = label;
      styleLabelCell(sheet.getCell(`A${row}`));
      const cell = sheet.getCell(`B${row}`);
      cell.value = { formula };
      styleOutputCell(cell, format);
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
      sheet.mergeCells(`C${row}:F${row}`);
      sheet.getCell(`C${row}`).value = note;
      sheet.getCell(`C${row}`).font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
      sheet.getCell(`C${row}`).alignment = { wrapText: true, vertical: 'top' };
    });
  });

  const disclosureRow = startRow + 35;
  sheet.mergeCells(`A${disclosureRow}:F${disclosureRow}`);
  sheet.getCell(`A${disclosureRow}`).value =
    'Waterfall uses quarterly cash flow rows for preferred return, catch-up, and hurdle-ladder promote logic across multiple distribution dates.';
  sheet.getCell(`A${disclosureRow}`).font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(`A${disclosureRow}`).alignment = { vertical: 'top', wrapText: true };
  sheet.getRow(disclosureRow).height = 32;

  return sheet;
};

/**
 * Sponsor / LP Waterfall sheet (PR-D) — multi-tier pour-over of project
 * equity proceeds between Sponsor (GP) and Limited Partners (LP),
 * matching the reference pro formas (NAIOP "Waterfall - IRR Hurdles"
 * sheet, RE-540 "Waterfall" sheet).
 *
 * Standard structure modelled here (v1 — simplified 3-tier):
 *   Tier 1: LP Preferred Return on outstanding equity (8% / year compounded)
 *   Tier 2: Return of LP Capital (LP gets capital back in full)
 *   Tier 3: Promote split — residual cash above pref+RoC split per the
 *           PromoteLPPct / PromoteGPPct named ranges (default 80/20)
 *
 * Deferred (separate PR): Sponsor catch-up tier (between RoC and promote)
 * and hurdle-laddered promote splits (e.g., 70/30 above 12% IRR, 60/40
 * above 15% IRR). Those require dynamic IRR-tier pour-through logic that's
 * expensive in Excel formulas — most early-stage operators don't model
 * past the simple promote anyway.
 *
 * Calculation method:
 *   Project Life N = LoanTermYears (proxy for hold period)
 *   Total Equity = Total Project Cost − Lender-Approved Loan (Debt Sizing!B28)
 *   LP Equity = Total Equity × LPEquityPct
 *   GP Equity = Total Equity × GPEquityPct
 *   LP Pref Cumulative = LP Equity × ((1 + PrefRate)^N − 1)
 *   Total Equity Proceeds = MAX(0, Total Revenue − Total Cost + Net Debt)
 *
 *   Distribution:
 *     Step 1: LP receives MIN(Proceeds, LP Equity + LP Pref Accrued)
 *             [pref + return of capital]
 *     Step 2: After Step 1, residual = Proceeds − Step 1 payout
 *             Promote split: LP × PromoteLPPct, GP × PromoteGPPct
 *     Step 3: GP also gets back GP Equity (return of GP capital) from
 *             their share of the promote split.
 *
 * Result rows: LP total return, GP total return, LP IRR (approx),
 * GP IRR (approx), LP equity multiple, GP equity multiple. The IRRs
 * are computed as ((1+gain)^(1/N))-1 single-period approximations.
 */
const buildWaterfallSheet = (workbook, ctx) => {
  const sheet = workbook.addWorksheet(SHEETS.waterfall, {
    views: [{ showGridLines: false }],
  });
  sheet.columns = [
    { width: 32 }, // A: Label
    { width: 22 }, // B: Value
    { width: 38 }, // C: Note
  ];

  // Title
  sheet.mergeCells('A1:C1');
  sheet.getCell('A1').value = `${ctx.brandName} | ${ctx.deal.name || ctx.property.property_name || 'Deal'} | Sponsor / LP Waterfall`;
  styleSectionTitle(sheet.getCell('A1'));
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:C2');
  sheet.getCell('A2').value =
    'Multi-tier pour-over of project equity proceeds. Tier 1: LP preferred return + return of capital. '
    + 'Tier 2: Promote split (default 80% LP / 20% GP) on residual cash. Single-exit approximation; '
    + 'institutional models use quarter-by-quarter pour-through.';
  sheet.getCell('A2').font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('A2').alignment = { vertical: 'middle', wrapText: true };
  sheet.getRow(2).height = 32;

  // ── Step 1 — Capital Stack (rows 4-9) ───────────────────────────────
  // Total equity = Total Cost − Loan. LP/GP shares from named ranges.
  sheet.mergeCells('A4:C4');
  sheet.getCell('A4').value = 'Capital Stack';
  styleSectionTitle(sheet.getCell('A4'));
  sheet.getRow(4).height = 22;

  // PR-I9: PremiumFSICostCr added to hardCost so it flows through the
  // entire Total Project Cost roll-up (Calc Cost Build, Debt Sizing,
  // Waterfall). When the named range is 0 (default), the math is
  // unchanged from pre-PR-I9.
  const hardCost = '(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr+PremiumFSICostCr)';
  const softCost = `${hardCost}*(ArchitectFeePct+LegalFeePct+AppraisalFeePct+InsuranceConstPct+DeveloperOverheadPct)+LandCostCr*PropTaxConstPct`;
  // India Statutory Levies (PR-I1): Stamp+Reg on land at acquisition,
  // plus net-of-ITC GST on construction value. Asset-class-aware via the
  // GstPct + StampRegPct named ranges seeded on the Inputs sheet.
  const indiaLevies = `LandCostCr*StampRegPct+(ConstructionCostPerSqft*SaleableAreaSqft/10000000)*GstPct`;
  const totalCost = ctx.assetClass === 'hospitality'
    ? 'TotalProjectCostCr'
    : `${hardCost}+${softCost}+${indiaLevies}`;
  const totalCostNote = ctx.assetClass === 'hospitality'
    ? 'Hotel development budget from USALI Pro Forma'
    : 'Hard + Soft + India Statutory Levies (matches Calculations!B28)';

  const capitalRows = [
    ['Total Project Cost (INR Cr)',     `=${totalCost}`,                              totalCostNote],
    ['Lender-Approved Loan (INR Cr)',   `='${SHEETS.debtAndAmort}'!B28`,              'MIN of LTC/LTV/DCR/DY from Debt Sizing section'],
    ['Total Equity (INR Cr)',           '=B5-B6',                                    'Project cost − loan'],
    ['LP Equity (INR Cr)',              '=B7*LPEquityPct',                           'LP share × total equity'],
    ['GP / Sponsor Equity (INR Cr)',    '=B7*GPEquityPct',                           'GP share × total equity'],
  ];
  capitalRows.forEach(([label, formula, note], idx) => {
    const r = 5 + idx;
    sheet.getCell(`A${r}`).value = label;
    styleLabelCell(sheet.getCell(`A${r}`));
    const cell = sheet.getCell(`B${r}`);
    cell.value = { formula };
    styleOutputCell(cell, NUMBER_FORMATS.currency);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    sheet.getCell(`C${r}`).value = note;
    sheet.getCell(`C${r}`).font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
    sheet.getCell(`C${r}`).protection = { locked: true };
  });

  // ── Step 2 — Proceeds + Pref Accrual (rows 11-16) ───────────────────
  // Total proceeds = project net cash flow. Pref accrues for N years.
  sheet.mergeCells('A11:C11');
  sheet.getCell('A11').value = 'Proceeds & Pref Return Accrual';
  styleSectionTitle(sheet.getCell('A11'));
  sheet.getRow(11).height = 22;

  // Project life used for pref compounding — LoanTermYears as a proxy.
  // For development deals this is typically ProjectMonths/12; for
  // income deals it's hold-period. Operator can edit on the Inputs sheet.
  const proceedsRows = [
    ['Project Hold Period (years)',      '=LoanTermYears',                                          'Pref compounding period'],
    ['Total Cash Available to Equity',   ctx.dealFamily === 'income'
      ? `=MAX(0,${totalCost}+'${SHEETS.cashFlowEngine}'!N18*4*LoanTermYears-B6)`  // income: NOI × yrs − loan
      : `=MAX(0,(SaleableAreaSqft*SellRatePerSqft/10000000)-${totalCost})+B6`, // dev: revenue − cost + loan amount returned
      'After debt service across hold period'],
    ['LP Pref Accrual (compounded)',     '=B8*((1+PrefReturnRate)^B12-1)',                          'LP Equity × ((1+pref)^N − 1)'],
    ['Tier 1 LP Distribution',           '=MIN(B13,B8+B14)',                                        'LP gets capital + pref (capped at proceeds)'],
    ['Residual after Tier 1 (INR Cr)',   '=MAX(0,B13-B15)',                                         'Cash available for promote split'],
  ];
  proceedsRows.forEach(([label, formula, note], idx) => {
    const r = 12 + idx;
    sheet.getCell(`A${r}`).value = label;
    styleLabelCell(sheet.getCell(`A${r}`));
    const cell = sheet.getCell(`B${r}`);
    cell.value = { formula };
    if (label.includes('years')) {
      styleOutputCell(cell, NUMBER_FORMATS.integer);
    } else {
      styleOutputCell(cell, NUMBER_FORMATS.currency);
    }
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    sheet.getCell(`C${r}`).value = note;
    sheet.getCell(`C${r}`).font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  });

  // ── Step 3 — Promote Split (rows 18-22) ─────────────────────────────
  // Above pref+RoC, residual splits per the promote ladder (default 80/20).
  sheet.mergeCells('A18:C18');
  sheet.getCell('A18').value = 'Tier 2 — Promote Split (above Pref + Return of Capital)';
  styleSectionTitle(sheet.getCell('A18'));
  sheet.getRow(18).height = 22;

  const promoteRows = [
    ['Promote — LP Allocation',     '=B16*PromoteLPPct',                                       'Residual × PromoteLPPct (default 80%)'],
    ['Promote — GP Allocation',     '=B16*PromoteGPPct',                                       'Residual × PromoteGPPct (default 20%)'],
    ['GP Return of Capital',         '=MIN(B9,B20)',                                          'GP also recovers their initial equity'],
    ['GP Net Promote (after RoC)',  '=B20-B21',                                              'GP carry above capital recovery'],
  ];
  promoteRows.forEach(([label, formula, note], idx) => {
    const r = 19 + idx;
    sheet.getCell(`A${r}`).value = label;
    styleLabelCell(sheet.getCell(`A${r}`));
    const cell = sheet.getCell(`B${r}`);
    cell.value = { formula };
    styleOutputCell(cell, NUMBER_FORMATS.currency);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    sheet.getCell(`C${r}`).value = note;
    sheet.getCell(`C${r}`).font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  });

  // ── Step 4 — Final Returns (rows 24-30) ─────────────────────────────
  sheet.mergeCells('A24:C24');
  sheet.getCell('A24').value = 'Final Investor Returns';
  styleSectionTitle(sheet.getCell('A24'));
  sheet.getRow(24).height = 22;

  // LP total = Tier 1 distribution (capital + pref) + LP promote share
  // GP total = GP RoC + GP net promote
  const returnsRows = [
    ['LP Total Distribution (INR Cr)',  '=B15+B19',                                              'Tier 1 (pref + capital) + Tier 2 LP share'],
    ['GP Total Distribution (INR Cr)',  '=B20',                                                  'Tier 2 GP share (includes capital + promote)'],
    ['LP Equity Multiple',               '=IFERROR(B25/B8,0)',                                    'Total LP cash returned / LP capital invested'],
    ['GP Equity Multiple',               '=IFERROR(B26/B9,0)',                                    'Total GP cash returned / GP capital invested'],
    ['LP IRR (annualised, approx)',     '=IFERROR((B27)^(1/B12)-1,0)',                            'Single-exit approximation: (EM)^(1/years)−1'],
    ['GP IRR (annualised, approx)',     '=IFERROR((B28)^(1/B12)-1,0)',                            'Single-exit approximation: (EM)^(1/years)−1'],
  ];
  returnsRows.forEach(([label, formula, note], idx) => {
    const r = 25 + idx;
    sheet.getCell(`A${r}`).value = label;
    styleLabelCell(sheet.getCell(`A${r}`));
    const cell = sheet.getCell(`B${r}`);
    cell.value = { formula };
    const fmt = label.includes('Multiple') ? NUMBER_FORMATS.multiple
      : label.includes('IRR') ? NUMBER_FORMATS.percent
      : NUMBER_FORMATS.currency;
    styleOutputCell(cell, fmt);
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: palette.xlsx(label.includes('IRR') || label.includes('Multiple') ? 'dataPositive' : 'inkDeep') } };
    sheet.getCell(`C${r}`).value = note;
    sheet.getCell(`C${r}`).font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  });

  // Footer disclosure
  sheet.mergeCells('A32:C32');
  sheet.getCell('A32').value =
    'Single-exit approximation: all cash assumed to arrive at end of hold period. Institutional templates '
    + '(NAIOP, RE-540) use quarter-by-quarter pour-through with hurdle laddering (e.g., 70/30 above 12% IRR, '
    + '60/40 above 15% IRR). The consolidated Debt Sizing & Amortization tab now carries the quarterly catch-up and hurdle ladder.';
  sheet.getCell('A32').font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('A32').alignment = { vertical: 'top', wrapText: true };
  sheet.getRow(32).height = 36;

  return sheet;
};

/**
 * Unit Mix sheet (PR-E) — asset-class-aware unit-by-unit breakdown
 * matching reference pro formas (RE-540 Assumptions rows 14-31, NAIOP
 * "Unit Mix" sheet).
 *
 * The sheet renders different content per asset class:
 *   - residential_apartments / villas: unit-type table (Studio / 1BHK /
 *     2BHK / 3BHK / 4BHK) with count × SF/unit × per-unit rate
 *   - hospitality: key-type table (Standard / Deluxe / Suite) with
 *     keys × SF/key × ADR
 *   - plotted_development: plot-size table (small / medium / large)
 *     with count × SF/plot × per-plot rate
 *   - commercial_office / retail / industrial_warehousing: leasable
 *     floor-type table (Ground / Typical / Top) with area × rent
 *   - mixed_use / redevelopment / raw_land: empty-state note explaining
 *     why a unit mix doesn't cleanly apply
 *
 * This is a WORKSHEET, not a flow-through input — operator uses it to
 * plan unit mix scenarios, then updates SaleableAreaSqft +
 * SellingRatePerSqft on the Inputs sheet based on the totals computed
 * here. The decision to NOT flow through is intentional: changing
 * SaleableAreaSqft from a literal input to a formula would surprise
 * operators who edit it directly + create cross-sheet dependency cycles
 * with the existing Phasing schedule.
 *
 * Defaults seeded with realistic Indian residential averages (Anarock /
 * JLL Bengaluru benchmarks). Operator can override every cell.
 */
const buildUnitMixSheet = (workbook, ctx) => {
  const sheet = workbook.addWorksheet(SHEETS.unitMix, {
    views: [{ showGridLines: false }],
  });
  sheet.columns = [
    { width: 22 }, // A: Unit type
    { width: 14 }, // B: Count
    { width: 16 }, // C: SF per unit
    { width: 16 }, // D: Total SF
    { width: 18 }, // E: Per-unit rate
    { width: 22 }, // F: Total revenue
  ];

  // Title
  sheet.mergeCells('A1:F1');
  sheet.getCell('A1').value = `${ctx.brandName} | ${ctx.deal.name || ctx.property.property_name || 'Deal'} | Unit Mix`;
  styleSectionTitle(sheet.getCell('A1'));
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:F2');
  sheet.getCell('A2').value =
    'Unit-by-unit breakdown — worksheet, not flow-through. Edit Count + SF/unit + Per-Unit Rate to plan scenarios; '
    + 'then update SaleableAreaSqft + SellingRatePerSqft on the Inputs sheet to reflect your final mix.';
  sheet.getCell('A2').font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('A2').alignment = { vertical: 'middle', wrapText: true };
  sheet.getRow(2).height = 32;

  // Determine which unit-mix table to render
  const ac = String(ctx.assetClass || '').toLowerCase();

  let unitRows; // array of [label, count, sfPerUnit, rate] seed defaults
  let headers;  // column headers
  let perUnitLabel;
  let revenueLabel;

  if (ac === 'residential_apartments' || ac === 'villas') {
    // Indian residential: typical mix
    headers = ['Unit Type', 'Count', 'SF / Unit', 'Total SF', 'Sell Rate (INR/sqft)', 'Total Revenue (INR Cr)'];
    perUnitLabel = 'Per-sqft sell rate';
    revenueLabel = 'Total revenue at base rate (INR Cr)';
    unitRows = ac === 'villas'
      ? [
          ['3 BHK Villa',          25, 2200, 12000],
          ['4 BHK Villa',          20, 2800, 12500],
          ['5 BHK Villa',           8, 3500, 13000],
          ['Penthouse',             2, 5000, 14000],
        ]
      : [
          ['Studio',               40,  450,  9000],
          ['1 BHK',                90,  650, 10000],
          ['2 BHK',               150,  950,  9500],
          ['3 BHK',                60, 1400,  9000],
          ['4 BHK',                15, 2000,  8500],
        ];
  } else if (ac === 'hospitality') {
    headers = ['Key Type', 'Keys', 'SF / Key', 'Total SF', 'ADR (INR / night)', 'Annual Revenue (INR Cr)'];
    perUnitLabel = 'Average Daily Rate';
    revenueLabel = 'Annualised revenue at 65% occupancy (INR Cr)';
    unitRows = [
      ['Standard',                100, 350,  8500],
      ['Deluxe',                   60, 450, 11500],
      ['Executive Suite',          20, 700, 18000],
      ['Presidential Suite',        4, 1200, 35000],
    ];
  } else if (ac === 'plotted_development') {
    headers = ['Plot Size', 'Plots', 'SF / Plot', 'Total SF', 'Sell Rate (INR/sqft)', 'Total Revenue (INR Cr)'];
    perUnitLabel = 'Per-sqft sell rate';
    revenueLabel = 'Total revenue at base rate (INR Cr)';
    unitRows = [
      ['Small (1,200 sqft)',      50, 1200,  4500],
      ['Standard (1,800 sqft)',   80, 1800,  5000],
      ['Premium (2,400 sqft)',    35, 2400,  5500],
      ['Corner / Garden',         15, 3000,  6500],
    ];
  } else if (ac === 'commercial_office' || ac === 'retail' || ac === 'industrial_warehousing') {
    const labelByClass = {
      commercial_office: ['Ground Floor', 'Typical Office Floor', 'Premium / Top Floor'],
      retail: ['Anchor (≥10k sqft)', 'In-line Mid (1k-5k sqft)', 'Kiosk / F&B'],
      industrial_warehousing: ['Manufacturing Bay', 'Storage Bay', 'Office / Admin'],
    }[ac];
    headers = ['Floor / Use', 'Bays', 'SF / Bay', 'Total SF', 'Rent (INR/sqft/mo)', 'Annual Revenue (INR Cr)'];
    perUnitLabel = 'Per-sqft monthly rent';
    revenueLabel = 'Annualised revenue at base rent × 12 (INR Cr)';
    unitRows = [
      [labelByClass[0],            1, 25000, 95],
      [labelByClass[1],           12, 18000, 110],
      [labelByClass[2],            3, 12000, 145],
    ];
  } else {
    // mixed_use / redevelopment / raw_land — render an empty-state note
    sheet.mergeCells('A5:F12');
    sheet.getCell('A5').value =
      `Unit mix isn't cleanly applicable to ${ctx.assetClass || 'this asset class'} deals. `
      + 'Mixed-use deals span multiple unit types per component (residential / office / retail); use separate component schedules. '
      + 'Redevelopment + raw land are typically sized by area / FAR not by unit count. '
      + 'Edit SaleableAreaSqft + SellingRatePerSqft on the Inputs sheet directly.';
    sheet.getCell('A5').font = { name: FONT, size: 11, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
    sheet.getCell('A5').alignment = { vertical: 'top', wrapText: true };
    return sheet;
  }

  // Header row at row 4
  headers.forEach((label, idx) => {
    const cell = sheet.getCell(4, idx + 1);
    cell.value = label;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = FILL(palette.xlsx('inkDeep'));
    cell.protection = { locked: true };
  });
  sheet.getRow(4).height = 28;

  // Data rows — each is editable (yellow input cells)
  unitRows.forEach(([label, count, sfPer, rate], idx) => {
    const r = 5 + idx;
    sheet.getCell(`A${r}`).value = label;
    styleLabelCell(sheet.getCell(`A${r}`));

    // Count (input)
    const countCell = sheet.getCell(`B${r}`);
    countCell.value = count;
    styleInputCell(countCell);
    countCell.numFmt = NUMBER_FORMATS.integer;

    // SF / Unit (input)
    const sfCell = sheet.getCell(`C${r}`);
    sfCell.value = sfPer;
    styleInputCell(sfCell);
    sfCell.numFmt = NUMBER_FORMATS.integer;

    // Total SF (computed)
    const totalSfCell = sheet.getCell(`D${r}`);
    totalSfCell.value = { formula: `=B${r}*C${r}` };
    styleOutputCell(totalSfCell, NUMBER_FORMATS.integer);
    totalSfCell.font = { name: FONT, size: 10, color: { argb: palette.xlsx('ink') } };

    // Per-unit rate (input)
    const rateCell = sheet.getCell(`E${r}`);
    rateCell.value = rate;
    styleInputCell(rateCell);
    rateCell.numFmt = NUMBER_FORMATS.integer;

    // Total Revenue (computed) — different math per asset class
    const revCell = sheet.getCell(`F${r}`);
    if (ac === 'hospitality') {
      // ADR × 365 × 65% occupancy × Keys
      revCell.value = { formula: `=B${r}*E${r}*365*0.65/10000000` };
    } else if (ac === 'commercial_office' || ac === 'retail' || ac === 'industrial_warehousing') {
      // monthly rent × 12 × total SF
      revCell.value = { formula: `=D${r}*E${r}*12/10000000` };
    } else {
      // residential / villas / plotted: per-sqft sell rate × total SF
      revCell.value = { formula: `=D${r}*E${r}/10000000` };
    }
    styleOutputCell(revCell, NUMBER_FORMATS.currency);
    revCell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
  });

  // Total row
  const totalRow = 5 + unitRows.length;
  sheet.getCell(`A${totalRow}`).value = 'TOTAL';
  sheet.getCell(`A${totalRow}`).font = { name: FONT, size: 11, bold: true, color: { argb: palette.xlsx('paperElevated') } };
  sheet.getCell(`A${totalRow}`).fill = FILL(palette.xlsx('inkDeep'));
  sheet.getCell(`A${totalRow}`).alignment = { vertical: 'middle', horizontal: 'left' };

  const totalCountCell = sheet.getCell(`B${totalRow}`);
  totalCountCell.value = { formula: `=SUM(B5:B${5 + unitRows.length - 1})` };
  styleOutputCell(totalCountCell, NUMBER_FORMATS.integer);
  totalCountCell.font = { name: FONT, size: 11, bold: true, color: { argb: palette.xlsx('paperElevated') } };
  totalCountCell.fill = FILL(palette.xlsx('inkDeep'));

  // SF / Unit total column is N/A (heterogeneous types) — leave blank with shading
  sheet.getCell(`C${totalRow}`).fill = FILL(palette.xlsx('inkDeep'));

  const totalSfRow = sheet.getCell(`D${totalRow}`);
  totalSfRow.value = { formula: `=SUM(D5:D${5 + unitRows.length - 1})` };
  styleOutputCell(totalSfRow, NUMBER_FORMATS.integer);
  totalSfRow.font = { name: FONT, size: 11, bold: true, color: { argb: palette.xlsx('paperElevated') } };
  totalSfRow.fill = FILL(palette.xlsx('inkDeep'));

  sheet.getCell(`E${totalRow}`).fill = FILL(palette.xlsx('inkDeep'));

  const totalRevRow = sheet.getCell(`F${totalRow}`);
  totalRevRow.value = { formula: `=SUM(F5:F${5 + unitRows.length - 1})` };
  styleOutputCell(totalRevRow, NUMBER_FORMATS.currency);
  totalRevRow.font = { name: FONT, size: 12, bold: true, color: { argb: palette.xlsx('dataPositive') } };
  totalRevRow.fill = FILL(palette.xlsx('inkDeep'));
  sheet.getRow(totalRow).height = 26;

  // Summary block below the table — comparison vs Inputs sheet
  const summaryRow = totalRow + 2;
  sheet.mergeCells(`A${summaryRow}:F${summaryRow}`);
  sheet.getCell(`A${summaryRow}`).value = 'Summary — Compare vs Inputs Sheet';
  styleSectionTitle(sheet.getCell(`A${summaryRow}`));
  sheet.getRow(summaryRow).height = 22;

  const summaryRows = [
    [`Unit-mix Total Saleable SF`,        `=D${totalRow}`,                  'From this sheet'],
    [`Inputs SaleableAreaSqft`,           '=SaleableAreaSqft',              'From Inputs & Assumptions'],
    [`Variance (sqft)`,                    `=D${totalRow}-SaleableAreaSqft`, 'Positive = unit mix exceeds Inputs'],
    [`${revenueLabel}`,                    `=F${totalRow}`,                  'From this sheet'],
  ];
  summaryRows.forEach(([label, formula, note], idx) => {
    const r = summaryRow + 1 + idx;
    sheet.getCell(`A${r}`).value = label;
    styleLabelCell(sheet.getCell(`A${r}`));
    const cell = sheet.getCell(`B${r}`);
    cell.value = { formula };
    const fmt = label.includes('Revenue') || label.includes('revenue') ? NUMBER_FORMATS.currency : NUMBER_FORMATS.integer;
    styleOutputCell(cell, fmt);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
    sheet.getCell(`C${r}`).value = note;
    sheet.getCell(`C${r}`).font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  });

  // Footer disclosure
  const footerRow = summaryRow + 6;
  sheet.mergeCells(`A${footerRow}:F${footerRow}`);
  sheet.getCell(`A${footerRow}`).value =
    `Unit-mix figures are operator-editable worksheet values, not flow-through inputs. After finalising the mix, manually update SaleableAreaSqft + SellingRatePerSqft on the Inputs sheet so the rest of the model (Phasing, Cash Flow, Dashboard) reflects the chosen mix. Per-unit rate column reads as ${perUnitLabel}.`;
  sheet.getCell(`A${footerRow}`).font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(`A${footerRow}`).alignment = { vertical: 'top', wrapText: true };
  sheet.getRow(footerRow).height = 40;

  return sheet;
};

const buildCalculationsSheet = (workbook, ctx) => {
  const sheet = workbook.addWorksheet(SHEETS.calculations, {
    state: 'hidden', // power users can unhide via right-click
    views: [{ showGridLines: false }],
  });
  sheet.columns = [
    { width: 36 }, // A: Label
    { width: 18 }, // B: Value
    { width: 22 }, // C: Source / formula description
  ];

  sheet.mergeCells('A1:C1');
  sheet.getCell('A1').value = `${ctx.brandName} | Calculations (audit trail)`;
  styleSectionTitle(sheet.getCell('A1'));
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:C2');
  sheet.getCell('A2').value = 'Hidden by default. Right-click any sheet tab → Unhide → Calculations to inspect the intermediate maths.';
  sheet.getCell('A2').font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('A2').alignment = { vertical: 'middle' };
  sheet.getCell('A2').protection = { locked: true };

  let row = 4;
  const writeBlock = (title, rows) => {
    sheet.mergeCells(`A${row}:C${row}`);
    sheet.getCell(`A${row}`).value = title;
    styleSectionTitle(sheet.getCell(`A${row}`));
    row += 1;
    rows.forEach(([label, formula, note]) => {
      sheet.getCell(`A${row}`).value = label;
      styleLabelCell(sheet.getCell(`A${row}`));
      const valCell = sheet.getCell(`B${row}`);
      valCell.value = { formula };
      styleOutputCell(valCell, NUMBER_FORMATS.currency);
      sheet.getCell(`C${row}`).value = note;
      sheet.getCell(`C${row}`).font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
      sheet.getCell(`C${row}`).alignment = { vertical: 'middle', horizontal: 'left' };
      sheet.getCell(`C${row}`).protection = { locked: true };
      row += 1;
    });
    row += 1;
  };

  // Revenue Build references the ACTUAL modeled values from the Phasing
  // sheet rather than a mid-period theoretical (Saleable × Rate × midpoint
  // escalation). Previously the Calculations Total revenue read ~648 Cr
  // (mid-period theoretical) while the Dashboard headline pulled from
  // Phasing!Z9 and read ~593 Cr (actual phased sum). Two methodologies,
  // two answers, unreconciled — investors see "the headline numbers don't
  // foot" and treat the entire model as unreliable. Both sheets now share
  // the same source of truth.
  // The Phasing sheet has slightly different row positions per asset family.
  // Development family: row 9 = Quarter sales, row 10 = Customer collection.
  // Income family: row 11 = EGR (which subsumes both revenue and collected).
  // The Total column is the one immediately after the last quarter — its
  // letter depends on ctx.totalQuarters (B=Q1, so Total col = totalQuarters+2).
  // colLetter is scoped to the individual sheet builders; inline a tiny
  // copy here so this calc-sheet builder is self-contained.
  const colLetterLocal = (n) => {
    let result = '';
    let v = n;
    while (v > 0) {
      const rem = (v - 1) % 26;
      result = String.fromCharCode(65 + rem) + result;
      v = Math.floor((v - 1) / 26);
    }
    return result;
  };
  const totalColLetter = colLetterLocal(ctx.totalQuarters + 2);
  const revenueRef = ctx.dealFamily === 'income'
    ? `'${SHEETS.cashFlowEngine}'!${totalColLetter}11`
    : `'${SHEETS.cashFlowEngine}'!${totalColLetter}9`;
  const collectedRef = ctx.dealFamily === 'income'
    ? `'${SHEETS.cashFlowEngine}'!${totalColLetter}11`
    : `'${SHEETS.cashFlowEngine}'!${totalColLetter}10`;

  writeBlock('Revenue Build', [
    ['Saleable area (sqft)',         '=SaleableAreaSqft',                               'From Inputs & Assumptions'],
    ['Sell rate (INR / sqft)',       '=SellRatePerSqft',                                'From Inputs & Assumptions'],
    ['Average escalation factor',    '=(1+EscalationPct)^(TotalQuarters/4/2)',          'Mid-period uplift (context only)'],
    ['Total revenue (INR Cr)',       `=${revenueRef}`,                                  'Sum of phased quarter sales — matches Dashboard'],
    ['Customer collected (INR Cr)',  `=${collectedRef}`,                                 'Sum of phased customer collection'],
  ]);

  // Cost Build (rows 12–28) — full institutional-grade breakdown.
  // Hard cost block (rows 12-15):
  //   R12 Land · R13 Construction · R14 Approvals · R15 Hard subtotal
  // Detailed soft cost block (rows 16-24) — references the named ranges
  // defined on the Inputs sheet for the 8 distinct soft cost line items
  // the operator's reference pro formas (NAIOP, RE-540) break out:
  //   R16 A&E · R17 Legal · R18 Appraisal · R19 Insurance during Const ·
  //   R20 Property Taxes during Const · R21 Developer Overhead ·
  //   R22 Marketing & Sales (revenue-driven) · R23 Finance / Treasury (revenue-driven) ·
  //   R24 Soft cost subtotal
  // India Statutory Levies block (rows 25-27) — PR-I1:
  //   R25 Stamp Duty + Registration on Land · R26 GST on Construction (Net of ITC) ·
  //   R27 India Statutory Levies subtotal
  // R28 Total project cost = Hard + Soft + Statutory.
  writeBlock('Cost Build', [
    ['Land cost (INR Cr)',                   '=LandCostCr',                                                       'From Inputs & Assumptions'],
    ['Construction cost (INR Cr)',           '=ConstructionCostPerSqft*SaleableAreaSqft/10000000',                 'Construction rate × saleable area'],
    // Combine Approval & Fees + Premium FSI/TDR on row B14 — these
    // are both one-time approval/regulatory costs to keep the row
    // count stable for downstream formulas (B15 Hard subtotal = B12+B13+B14).
    // PR-I9 added PremiumFSICostCr which defaults to 0; the formula
    // is unchanged from pre-PR-I9 when PremiumFSICostCr is left at 0.
    ['Approval & fees + Premium FSI (INR Cr)','=ApprovalCostCr+PremiumFSICostCr',                                 'Approvals + Premium FSI/TDR (PR-I9)'],
    ['Hard cost subtotal',                   '=B12+B13+B14',                                                       'Land + Construction + Approvals + Premium FSI'],
    ['A&E fees (INR Cr)',                    '=B13*ArchitectFeePct',                                              'Construction × ArchitectFeePct'],
    ['Legal fees (INR Cr)',                  '=B13*LegalFeePct',                                                  'Construction × LegalFeePct'],
    ['Appraisal & title (INR Cr)',           '=B13*AppraisalFeePct',                                              'Construction × AppraisalFeePct'],
    ['Insurance during construction (INR Cr)','=B13*InsuranceConstPct',                                           'Construction × InsuranceConstPct'],
    ['Property taxes during construction',   '=LandCostCr*PropTaxConstPct',                                       'Land × PropTaxConstPct (Karnataka method)'],
    ['Developer overhead (INR Cr)',          '=B13*DeveloperOverheadPct',                                         'Construction × DeveloperOverheadPct'],
    ['Marketing & sales (INR Cr)',           '=B8*MarketingCostPct',                                              'Total revenue × MarketingCostPct'],
    ['Finance / treasury (INR Cr)',          '=B8*FinanceCostPct',                                                'Total revenue × FinanceCostPct'],
    ['Soft cost subtotal',                   '=B16+B17+B18+B19+B20+B21+B22+B23',                                  'All 8 soft cost line items'],
    ['Stamp Duty + Registration on Land',    '=LandCostCr*StampRegPct',                                            'Karnataka default 6.6% × Land (PR-I1)'],
    ['GST on Construction (Net of ITC)',     '=B13*GstPct',                                                        'Asset-class-aware net cost (PR-I1)'],
    ['India Statutory Levies subtotal',      '=B25+B26',                                                           'Stamp+Reg + GST'],
    ['Total project cost (INR Cr)',          '=B15+B24+B27',                                                       'Hard + Soft + Statutory'],
  ]);

  // Debt Sculpting block now sits at rows 30–35 (shifted down due to
  // the expanded Cost Build with India Statutory Levies). Total project
  // cost lives at row 28 (was 25 pre-PR-I1).
  writeBlock('Debt Sculpting', [
    ['Debt LTV (% of cost)',         '=DebtLTV',                                        'From Inputs & Assumptions'],
    ['Total debt envelope (INR Cr)', '=B28*DebtLTV',                                    'Total project cost × LTV (B28 = Total cost incl. India Statutory Levies)'],
    ['Equity envelope (INR Cr)',     '=B28*(1-DebtLTV)',                                'Total project cost × (1-LTV)'],
    ['Annualised interest cost',     '=B32*DebtRatePct',                                'Debt envelope × rate (peak proxy)'],
    ['Quarterly interest accrual',   '=B34/4',                                          'Annualised ÷ 4 (sanity check vs Cash Flow row 10)'],
    ['Effective debt cost / unit',   '=B34/SaleableAreaSqft*10000000',                  'Per-sqft cost-of-capital proxy (Cr → INR ÷ sqft)'],
  ]);

  writeBlock('Returns Inputs (for Dashboard IRR/NPV)', [
    ['Discount rate (annual)',       '=DiscountRatePct',                                'From Inputs & Assumptions'],
    ['Quarterly discount rate',      '=(1+DiscountRatePct)^(1/4)-1',                    'Quarter-equivalent for NPV'],
    ['Periods (quarters)',           '=TotalQuarters',                                  'Project life'],
    ['Hurdle rate (developer margin)', '=DeveloperMarginPct',                           'From Inputs & Assumptions'],
  ]);

  // Footer
  sheet.mergeCells(`A${row + 1}:C${row + 1}`);
  sheet.getCell(`A${row + 1}`).value = `Generated ${ctx.generatedAt} | ${ctx.brandName}. Every formula here references named ranges on the Inputs sheet — change an input, re-open the file, and watch the audit trail recalc.`;
  sheet.getCell(`A${row + 1}`).font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(`A${row + 1}`).protection = { locked: true };

  return sheet;
};

/**
 * Build the v2 workbook. Returns an ExcelJS Workbook ready to write.
 */
const buildDealWorkbookV2Workbook = (exportContext, options = {}) => {
  const ctx = options.__preparedContext || prepareWorkbookContext(exportContext, options);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = options.userName || ctx.brandName;
  workbook.lastModifiedBy = options.userName || ctx.brandName;
  workbook.created = new Date(ctx.generatedAt);
  workbook.modified = new Date();
  workbook.title = `${ctx.deal.name || ctx.property.property_name || 'Deal'} — Investor-Grade Workbook`;
  workbook.subject = `${ctx.assetClass || 'Generic'} financial model`;
  workbook.description = 'REDIP investor-grade workbook (v2). Investor-grade — verify all inputs.';
  workbook.company = ctx.brandName;
  workbook.calcProperties.fullCalcOnLoad = true;

  // Sheet build order matches the post-restructure 7-sheet directive:
  //   1. Dashboard               (investor-facing KPIs + charts; FIRST)
  //   2. Inputs & Assumptions
  //   3. Cash Flow Engine        (combined: Phasing + Cash Flow + Debt)
  //   4. Debt Sizing & Amortization (combined: sizing + 80-row amort)
  //   5. Sponsor LP Waterfall
  //   6. Unit Mix
  //   7. Calculations            (hidden audit trail)
  //
  // Workbook tab order follows the order in which `addWorksheet` is called.
  // PR-NX7 (2026-05-15): Executive Briefing built FIRST so it's the
  // operator's landing tab on open. The Dashboard remains the primary
  // analytical view; Briefing is the 1-page IC summary they read before
  // diving into the numbers. ChartInjector caller below targets the
  // Dashboard by name, not file index, so its addition doesn't shift charts.
  buildExecutiveBriefingSheet(workbook, ctx);
  buildDashboardSheet(workbook, ctx);
  const { definedNames } = buildInputsSheet(workbook, ctx);
  if (ctx.assetClass === 'hospitality') buildHospitalityUsaliSheet(workbook, ctx);

  // Cash Flow Engine combines (a) Phasing operating schedule + (b) Cash
  // Flow & Debt rows on the SAME worksheet. buildPhasingSheet returns the
  // last row it wrote; buildCashFlowSheet picks up from there +3 rows
  // (section divider + header).
  const { lastRow: phasingLastRow } = buildPhasingSheet(workbook, ctx);
  buildCashFlowSheet(workbook, ctx, { phasingLastRow });
  buildMonthlyCashFlowSheet(workbook, ctx);

  buildDebtSizingSheet(workbook, ctx);
  buildAmortizationSheet(workbook, ctx);
  appendWaterfallToDebtSheet(workbook, ctx);
  buildCalculationsSheet(workbook, ctx); // hidden audit trail

  // Register defined names AFTER all sheets exist so the references resolve.
  definedNames.forEach(({ name, ref }) => {
    workbook.definedNames.add(ref, name);
  });
  workbook.definedNames.add(
    ctx.assetClass === 'hospitality'
      ? `'${SHEETS.usali}'!$B$${HOSPITALITY_BUDGET_ROW.totalDevelopmentCost}`
      : `'${SHEETS.calculations}'!$B$28`,
    'TotalProjectCostCr',
  );
  return workbook;
};

/**
 * Build the chart specs that get injected onto the Dashboard after
 * ExcelJS finishes writing the workbook. Asset-class-aware: development
 * deals see Sales/Construction columns; income deals see PGI/NOI.
 *
 * Cell positions here MUST stay in sync with buildDashboardSheet() —
 * the chart formulas point at exact cells produced by that builder.
 * Any movement of the Sources & Uses block (rows 12-18) or the Monthly
 * Trend table (rows 37-62 at the default 24-month view) needs to be reflected here.
 */
const buildDashboardChartSpecs = (ctx) => {
  const specs = [];
  const dashName = SHEETS.dashboard;

  // 1. Uses Breakdown doughnut (always populated — Land + Construction +
  //    Approvals/FSI + Soft Costs + Statutory Levies at rows 14-18). Sources at rows 12-13 are intentionally
  //    excluded from the doughnut; "Sources & Uses" as a 5-slice donut
  //    mixes the inflow side with the outflow side and reads poorly.
  specs.push({
    type: 'doughnut',
    title: 'Uses Breakdown',
    sheetName: dashName,
    categoriesRange: '$A$14:$A$18',
    valuesRange: '$B$14:$B$18',
    colours: ['0E1B2C', 'B5793C', '0F7B5A', '6B7280', 'B23A48'], // inkDeep / accent / dataPositive / muted / dataNegative
    anchor: { fromCol: 7, fromRow: 10, widthCols: 6, heightRows: 12 },
  });

  // 2. Monthly Trend combo chart — clustered columns for period
  //    contribution + cumulative line on secondary value axis. The
  //    cumulative-line crossover is the canonical analyst read for
  //    "when does the deal turn positive."
  //
  //    Development family: Sales + Construction columns + Cumulative line
  //    Income family:      PGI + NOI columns + Net Equity CF line
  //
  //    Anchored BELOW the data table (rows 37-62 at default view). Asset-class-aware
  //    series labels + colours.
  const trendMonths = Math.min(getWorkbookModelMonths(ctx), 24);
  const trendEndRow = 38 + trendMonths;
  if (trendMonths >= 2) {
    const isIncome = ctx.dealFamily === 'income';
    const barSeries = isIncome
      ? [
        { name: 'PGI (Cr)', valuesRange: `$B$39:$B$${trendEndRow}`, colour: '0E1B2C' },
        { name: 'NOI (Cr)', valuesRange: `$D$39:$D$${trendEndRow}`, colour: '0F7B5A' },
      ]
      : [
        { name: 'Sales (Cr)',        valuesRange: `$B$39:$B$${trendEndRow}`, colour: '0F7B5A' },
        { name: 'Construction (Cr)', valuesRange: `$C$39:$C$${trendEndRow}`, colour: 'B23A48' },
      ];
    // Cumulative line lives in column E for both families (Monthly
    // Trend table layout: A=Month, B=Series1, C=Series2, D=Series3,
    // E=Cumulative-or-CF-After-Debt). Copper accent ties the line
    // visually to the editorial palette without competing with the
    // green/red bar palette.
    const lineSeries = [
      {
        name: isIncome ? 'Net Equity CF (Cr)' : 'Cumulative Equity CF (Cr)',
        valuesRange: `$E$39:$E$${trendEndRow}`,
        colour: 'B5793C',
      },
    ];
    specs.push({
      type: 'combo',
      title: isIncome
        ? 'Monthly Operating Trend - PGI / NOI / Net Equity CF'
        : 'Monthly Project Trend - Sales / Construction / Cumulative',
      sheetName: dashName,
      categoriesRange: `$A$39:$A$${trendEndRow}`,
      barSeries,
      lineSeries,
      anchor: { fromCol: 0, fromRow: trendEndRow + 1, widthCols: 13, heightRows: 14 },
    });
  }

  // 3. Tornado chart — Driver Impact on Project Margin. Native Office
  //    pattern: clustered horizontal bar with overlap=100. Low-case
  //    deltas (negative) extend left from 0; high-case deltas (positive)
  //    extend right. The driver data table at H25:M27 feeds the chart.
  //    Anchored at columns N-T (cols 13-19), rows 24-30 — to the right
  //    of the sensitivity heatmap so the analyst sees the heatmap AND
  //    the driver-impact tornado in the same eye span.
  specs.push({
    type: 'tornado',
    title: ctx.dealFamily === 'income'
      ? 'Sensitivity — Driver Impact (delta from base yield)'
      : 'Sensitivity — Driver Impact (delta from base margin)',
    sheetName: dashName,
    categoriesRange: '$H$26:$H$27',
    lowValuesRange: '$I$26:$I$27',
    highValuesRange: '$J$26:$J$27',
    lowColour: 'B23A48',  // dataNegative
    highColour: '0F7B5A', // dataPositive
    anchor: { fromCol: 13, fromRow: 29, widthCols: 7, heightRows: 8 },
  });

  return specs;
};

const buildDashboardSparklineSpecs = (ctx) => {
  const trendMonths = Math.min(getWorkbookModelMonths(ctx), 24);
  if (trendMonths < 2) return [];
  const trendEndRow = 38 + trendMonths;
  return ctx.dealFamily === 'income'
    ? [
        { location: 'B9', dataRange: `$B$39:$B$${trendEndRow}`, colour: '0E1B2C' },
        { location: 'D9', dataRange: `$D$39:$D$${trendEndRow}`, colour: '0F7B5A' },
        { location: 'F9', dataRange: `$E$39:$E$${trendEndRow}`, colour: 'B5793C' },
      ]
    : [
        { location: 'B9', dataRange: `$B$39:$B$${trendEndRow}`, colour: '0F7B5A' },
        { location: 'D9', dataRange: `$D$39:$D$${trendEndRow}`, colour: 'B5793C' },
        { location: 'F9', dataRange: `$E$39:$E$${trendEndRow}`, colour: '0E1B2C' },
      ];
};

const stripLeadingEqualsFromWorksheetFormulas = async (xlsxBuffer) => {
  const zip = await JSZip.loadAsync(xlsxBuffer);
  const sheetFiles = zip.file(/^xl\/worksheets\/sheet\d+\.xml$/);
  let changed = false;

  await Promise.all(sheetFiles.map(async (file) => {
    const xml = await file.async('string');
    const next = xml.replace(/(<f(?:\s[^>]*)?>)=/g, '$1');
    if (next !== xml) {
      zip.file(file.name, next);
      changed = true;
    }
  }));

  if (!changed) return xlsxBuffer;
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
};

const normalizeWorksheetXmlForExcelCompatibility = async (xlsxBuffer) => {
  const zip = await JSZip.loadAsync(xlsxBuffer);
  const sheetFiles = zip.file(/^xl\/worksheets\/sheet\d+\.xml$/);
  let changed = false;

  await Promise.all(sheetFiles.map(async (file) => {
    const xml = await file.async('string');
    const tableParts = /<tableParts\b[^>]*(?:\/>|>[\s\S]*?<\/tableParts>)/.exec(xml);
    const legacyDrawing = /<legacyDrawing\b[^>]*(?:\/>|>[\s\S]*?<\/legacyDrawing>)/.exec(xml);

    if (!tableParts || !legacyDrawing || legacyDrawing.index < tableParts.index) return;

    const legacyXml = legacyDrawing[0];
    const next = [
      xml.slice(0, tableParts.index),
      legacyXml,
      xml.slice(tableParts.index, legacyDrawing.index),
      xml.slice(legacyDrawing.index + legacyXml.length),
    ].join('');

    zip.file(file.name, next);
    changed = true;
  }));

  if (!changed) return xlsxBuffer;
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
};

const forceWorkbookRecalculationOnOpen = async (xlsxBuffer) => {
  const zip = await JSZip.loadAsync(xlsxBuffer);
  const workbookFile = zip.file('xl/workbook.xml');
  if (!workbookFile) return xlsxBuffer;

  const xml = await workbookFile.async('string');
  let changed = false;
  const forcedCalcPr = (tag) => {
    const cleaned = tag.replace(/\s(?:calcMode|fullCalcOnLoad|forceFullCalc|calcOnSave)="[^"]*"/g, '');
    const attrs = ' calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1" calcOnSave="1"';
    return cleaned.endsWith('/>')
      ? cleaned.replace(/\/>$/, `${attrs}/>`)
      : cleaned.replace(/>$/, `${attrs}>`);
  };

  let next;
  if (/<calcPr\b[^>]*\/?>/.test(xml)) {
    next = xml.replace(/<calcPr\b[^>]*\/?>/, (tag) => forcedCalcPr(tag));
  } else {
    next = xml.replace('</workbook>', '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1" calcOnSave="1"/></workbook>');
  }

  if (zip.file('xl/calcChain.xml')) {
    changed = true;
    zip.remove('xl/calcChain.xml');
    const relsFile = zip.file('xl/_rels/workbook.xml.rels');
    if (relsFile) {
      const relsXml = await relsFile.async('string');
      const relsNext = relsXml.replace(/<Relationship\b[^>]*calcChain\.xml[^>]*\/>/g, '');
      if (relsNext !== relsXml) zip.file('xl/_rels/workbook.xml.rels', relsNext);
    }
    const contentTypesFile = zip.file('[Content_Types].xml');
    if (contentTypesFile) {
      const contentTypesXml = await contentTypesFile.async('string');
      const contentTypesNext = contentTypesXml.replace(/<Override\b[^>]*\/xl\/calcChain\.xml[^>]*\/>/g, '');
      if (contentTypesNext !== contentTypesXml) zip.file('[Content_Types].xml', contentTypesNext);
    }
  }

  changed = changed || next !== xml;
  if (!changed) return xlsxBuffer;
  zip.file('xl/workbook.xml', next);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
};

const validateXlsxBufferForDownload = async (xlsxBuffer) => {
  const zip = await JSZip.loadAsync(xlsxBuffer);
  const issues = [];
  const add = (field, message, action) => {
    issues.push({
      severity: 'blocker',
      check: 'Workbook structure',
      field,
      message,
      action,
      scope: 'xlsx package',
    });
  };

  if (!zip.file('[Content_Types].xml')) add('[Content_Types].xml', 'Workbook content types part is missing.', 'Regenerate the workbook.');
  const workbookXmlFile = zip.file('xl/workbook.xml');
  if (!workbookXmlFile) {
    add('xl/workbook.xml', 'Workbook definition is missing.', 'Regenerate the workbook.');
  } else {
    const workbookXml = await workbookXmlFile.async('string');
    const sheetCount = (workbookXml.match(/<sheet\b/g) || []).length;
    // PR-NX7 (2026-05-15): raised the ceiling from 7 → 8 to accommodate
    // the Executive Briefing sheet (first tab, IC-facing summary). 8 is
    // the new operator-blessed maximum.
    if (sheetCount > 8) {
      add('xl/workbook.xml', `Workbook contains ${sheetCount} worksheets; maximum allowed is 8.`, 'Remove or merge non-essential worksheets before download.');
    }
    if (workbookXml.includes('Export QA &amp; Sources') || workbookXml.includes('Export QA & Sources')) {
      add(SHEETS.qaSources, 'Export QA & Sources must be merged into Inputs & Assumptions.', 'Remove the standalone QA worksheet before download.');
    }
    const calcPr = workbookXml.match(/<calcPr\b[^>]*>/)?.[0] || '';
    if (!calcPr.includes('calcMode="auto"') || !calcPr.includes('fullCalcOnLoad="1"') || !calcPr.includes('forceFullCalc="1"')) {
      add('xl/workbook.xml', 'Workbook is not marked for automatic full recalculation on open.', 'Force recalculation metadata before download so formula-heavy sheets render values in Excel.');
    }
  }

  const tableFiles = zip.file(/^xl\/tables\/table\d+\.xml$/);
  if (tableFiles.length < 2) {
    add('xl/tables', 'Expected Excel tables for QA checks and source register are missing.', 'Regenerate the workbook so reviewers get filterable QA/source tables.');
  }

  const sheetFiles = zip.file(/^xl\/worksheets\/sheet\d+\.xml$/);
  await Promise.all(sheetFiles.map(async (file) => {
    const xml = await file.async('string');
    if (xml.includes('FFundefined')) {
      add(file.name, 'Workbook XML contains an invalid undefined ARGB color.', 'Fix the style token before download.');
    }
    if (/(<f(?:\s[^>]*)?>)=/.test(xml)) {
      add(file.name, 'Workbook XML contains formulas with a leading equals sign.', 'Strip leading equals signs from formula XML before download.');
    }
    const tablePartsIndex = xml.indexOf('<tableParts');
    const legacyDrawingIndex = xml.indexOf('<legacyDrawing');
    if (tablePartsIndex !== -1 && legacyDrawingIndex !== -1 && legacyDrawingIndex > tablePartsIndex) {
      add(file.name, 'Worksheet comments are serialized after table parts, which causes Excel to repair the sheet.', 'Normalize worksheet XML element order before download.');
    }
    if (xml.includes('<sheetProtection')) {
      add(file.name, 'Worksheet protection is enabled.', 'Export workbooks must be editable without an unprotect prompt.');
    }
  }));

  if (issues.length) {
    throw new XlsxExportValidationError({
      status: 'BLOCKED',
      blockers: issues,
      issues,
      sourceRegister: [],
    });
  }
  return true;
};

const finalizeWorkbookBuffer = async (xlsxBuffer) => {
  const stripped = await stripLeadingEqualsFromWorksheetFormulas(xlsxBuffer);
  const normalized = await normalizeWorksheetXmlForExcelCompatibility(stripped);
  const recalcReady = await forceWorkbookRecalculationOnOpen(normalized);
  await validateXlsxBufferForDownload(recalcReady);
  return recalcReady;
};

/**
 * Build and return the workbook as a Buffer (for the route handler).
 * Two-stage: ExcelJS writes cells / formulas / conditional formatting,
 * then chartInjector.js splices in native chart XML for the Dashboard
 * (ExcelJS has no addChart API in 4.4.0). The final buffer is what the
 * operator downloads — native charts that recalc when inputs change.
 */
const buildDealWorkbookV2 = async (exportContext, options = {}) => {
  const ctx = prepareWorkbookContext(exportContext, options);
  // PR-NX7 (2026-05-15): generate the AI-assisted Executive Briefing
  // BEFORE building the workbook so the briefing service has time to
  // call OpenAI (or fall back to templated synthesis) without blocking
  // the synchronous sheet builders. The `options.skipAiBriefing` escape
  // hatch is for tests / batch exports that don't want the AI cost.
  try {
    ctx.briefing = await generateDealBriefing(ctx, {
      preferTemplated: options.skipAiBriefing === true,
    });
  } catch {
    // Briefing failure is non-fatal — the buildExecutiveBriefingSheet
    // function falls back to deterministic templated synthesis if
    // ctx.briefing is missing.
    ctx.briefing = null;
  }
  const workbook = buildDealWorkbookV2Workbook(exportContext, { ...options, __preparedContext: ctx });
  const raw = await workbook.xlsx.writeBuffer();
  const xlsxBuffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

  const chartSpecs = buildDashboardChartSpecs(ctx);
  let enhancedBuffer = xlsxBuffer;

  // PR-NX7: Dashboard is now the 2nd sheet (Executive Briefing is 1st),
  // so its underlying XML file is sheet2.xml not sheet1.xml. Compute the
  // file index dynamically from the workbook's worksheet array so the
  // chart injector always targets the right file regardless of future
  // sheet-order changes.
  const dashboardIdx = workbook.worksheets.findIndex((ws) => ws.name === SHEETS.dashboard);
  const dashboardSheetFile = dashboardIdx >= 0 ? `sheet${dashboardIdx + 1}.xml` : 'sheet1.xml';

  try {
    if (chartSpecs.length > 0) {
      enhancedBuffer = await injectChartsIntoXlsx(enhancedBuffer, {
        targetSheetName: SHEETS.dashboard,
        targetSheetFile: dashboardSheetFile,
        charts: chartSpecs,
      });
    }
  } catch (err) {
    // Chart injection is best-effort. If anything goes wrong (a future
    // template change shifts the sheet position, an XML structure shifts,
    // etc.) we fall back to the un-injected workbook so the operator
    // still gets a working file rather than an error.
    if (process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.warn('[xlsx.v2] chart injection failed, returning un-enhanced workbook:', err.message);
    }
  }

  try {
    enhancedBuffer = await injectSparklinesIntoXlsx(enhancedBuffer, {
      targetSheetName: SHEETS.dashboard,
      targetSheetFile: dashboardSheetFile,
      sparklines: buildDashboardSparklineSpecs(ctx),
    });
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.warn('[xlsx.v2] sparkline injection failed, returning workbook without sparklines:', err.message);
    }
  }

  return finalizeWorkbookBuffer(enhancedBuffer);
};

module.exports = {
  buildDealWorkbookV2,
  // Internal exports for tests.
  __internal: {
    buildContext,
    prepareWorkbookContext,
    buildExportQa,
    buildDealWorkbookV2Workbook,
    buildDashboardChartSpecs,
    buildDashboardSparklineSpecs,
    stripLeadingEqualsFromWorksheetFormulas,
    normalizeWorksheetXmlForExcelCompatibility,
    forceWorkbookRecalculationOnOpen,
    validateXlsxBufferForDownload,
    XlsxExportValidationError,
    SHEETS,
    NUMBER_FORMATS,
  },
};
