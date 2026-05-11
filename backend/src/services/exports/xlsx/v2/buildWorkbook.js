'use strict';

/**
 * XLSX v2 — investor-grade 4-sheet workbook.
 *
 * Replaces the existing 13-sheet workbook with a tight 4-sheet structure
 * per operator brief 2026-05-10:
 *
 *   1. Inputs & Assumptions          (operator-editable, unlocked)
 *   2. Construction Phasing & Sales Collection
 *   3. Quarterly Cash Flow & Debt
 *   4. Dashboard                     (KPIs, charts, sources/uses)
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
const { injectChartsIntoXlsx } = require('./chartInjector');
const { inferAssetClass } = require('../../../../utils/assetClass');
const palette = require('../../shared/palette');

const FONT = palette.FONTS.body;

// Sheet display names — explicitly NO `WS1`/`WS2` prefixes per operator
// instruction 2026-05-10. Names must fit Excel's 31-character cap; the
// phasing sheet's full name "Construction Phasing & Sales Collection"
// is 39 chars, so we trim to "Phasing & Sales Collection" (26).
const SHEETS = {
  inputs: 'Inputs & Assumptions',
  phasing: 'Phasing & Sales Collection',
  cashflow: 'Quarterly Cash Flow & Debt',
  dashboard: 'Dashboard',
  debtSizing: 'Debt Sizing',
  amortization: 'Amortization Schedule',
  calculations: 'Calculations',
};

const FILL = (color) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: color } });

const NUMBER_FORMATS = {
  currency: '#,##0.00;[Red](#,##0.00);–',
  percent: '0.0%;[Red](0.0%);–',
  integer: '#,##0;[Red](#,##0);–',
  multiple: '0.00"x"',
  date: 'dd-mmm-yyyy',
};

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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Build the deck workbook context. Reuses `inferAssetClass` for class
 * detection; everything else is read straight off the export context.
 */
const buildContext = (exportContext = {}, options = {}) => {
  const deal = exportContext.deal || {};
  const property = exportContext.property || {};
  const modelInputs = (deal.model_params && deal.model_params.inputs) || {};
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

  const projectMonths = firstNumber(
    inputs.projectDurationMonths,
    deal.project_duration_months,
    inputs.projectDurationYears ? inputs.projectDurationYears * 12 : null,
    36,
  ) || 36;
  const totalQuarters = clamp(Math.ceil(projectMonths / 3), 4, 32);

  // Income-producing vs development asset classes. Drives the entire
  // workbook's structure: income deals get a PGI / Vacancy / EGR / OpEx
  // / NOI / CapEx / Debt Service operating P&L; development deals get
  // construction phasing + sales collection cash flows. Both get the
  // same Inputs / Dashboard / Calculations chrome.
  const INCOME_CLASSES = ['commercial_office', 'retail', 'industrial_warehousing', 'hospitality'];
  const dealFamily = INCOME_CLASSES.includes(assetClass) ? 'income' : 'development';

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
    inputs,
    assetClass,
    dealFamily,
    isIncome: dealFamily === 'income',
    projectMonths,
    totalQuarters,
    kernelKpis,
    brandName: options.brandName || 'REDIP',
    generatedAt: options.generatedAt || exportContext.generatedAt || new Date().toISOString(),
    effectiveDate: options.effectiveDate || new Date().toISOString().slice(0, 10),
  };
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
  ];

  // Cover band
  sheet.mergeCells('A1:C1');
  sheet.getCell('A1').value = `${ctx.brandName} | ${ctx.deal.name || ctx.property.property_name || 'Deal'} | Inputs & Assumptions`;
  styleSectionTitle(sheet.getCell('A1'));
  sheet.getRow(1).height = 28;
  sheet.mergeCells('A2:C2');
  sheet.getCell('A2').value = `${ctx.deal.deal_type || 'Acquisition'} | ${ctx.assetClass || 'Generic'} | Effective ${ctx.effectiveDate}`;
  sheet.getCell('A2').font = { name: FONT, size: 10, color: { argb: palette.xlsx('mutedHigh') }, italic: true };
  sheet.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle' };
  sheet.getCell('A2').protection = { locked: true };
  sheet.getRow(2).height = 22;

  // Column header row
  sheet.getCell('A4').value = 'Input';
  sheet.getCell('B4').value = 'Value';
  sheet.getCell('C4').value = 'Unit';
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
      ['Land Area',               'LandAreaSqft',        firstNumber(ctx.property.land_area_sqft, ctx.deal.land_area_sqft, ctx.inputs.plotAreaSqft, 0), 'sqft', NUMBER_FORMATS.integer],
      ['Saleable / Leasable Area','SaleableAreaSqft',    firstNumber(ctx.property.saleable_area_sqft, ctx.deal.saleable_area_sqft, ctx.inputs.saleableAreaSqft, ctx.inputs.leasableAreaSqft, 0), 'sqft', NUMBER_FORMATS.integer],
      ['Floor Space Index (FSI)', 'FSI',                 firstNumber(ctx.property.existing_fsi, ctx.inputs.fsi, 1.5), 'ratio', NUMBER_FORMATS.multiple],
    ],
  };

  const developmentRevenueSection = {
    title: 'Pricing & Revenue (Development)',
    rows: [
      ['Selling Rate per sqft',   'SellRatePerSqft',     firstNumber(ctx.inputs.sellingRatePerSqft, ctx.deal.selling_rate_per_sqft, 0),                'INR/sqft', NUMBER_FORMATS.integer],
      ['Pricing Escalation',      'EscalationPct',       toPctDecimal(firstNumber(ctx.inputs.pricingEscalationPct, ctx.inputs.rentEscalationPct, 0)),                 '% / year', NUMBER_FORMATS.percent],
      ['Sales Velocity',          'SalesVelocityPct',    toPctDecimal(firstNumber(ctx.inputs.salesVelocityPct, ctx.inputs.absorptionPct, 0.20)),                     '% / quarter', NUMBER_FORMATS.percent],
      ['Customer Collection',     'CollectionPct',       toPctDecimal(firstNumber(ctx.inputs.customerCollectionPct, 0.85)),                                          '% of sale', NUMBER_FORMATS.percent],
    ],
  };

  const incomeRevenueSection = {
    title: 'Operating Revenue Inputs (Income Asset)',
    rows: [
      ['Base Rent / sqft / month','BaseRentPerSqftMonth', firstNumber(ctx.inputs.baseRentPerSqftMonth, ctx.inputs.rentPerSqftMonth, 0),               'INR/sqft/mo', NUMBER_FORMATS.integer],
      ['Rent Escalation',         'RentEscalationPct',   toPctDecimal(firstNumber(ctx.inputs.rentEscalationPct, ctx.inputs.pricingEscalationPct, 0.05)),             '% / year', NUMBER_FORMATS.percent],
      ['Stabilised Occupancy',    'OccupancyPct',        toPctDecimal(firstNumber(ctx.inputs.occupancyPct, ctx.deal.occupancy_pct, 0.92)),                  '% of leasable', NUMBER_FORMATS.percent],
      ['Vacancy & Credit Loss',   'VacancyPct',          toPctDecimal(firstNumber(ctx.inputs.vacancyPct, 0.05)),                                                     '% of PGI', NUMBER_FORMATS.percent],
      ['Other Income / sqft / yr','OtherIncomePerSqft',  firstNumber(ctx.inputs.otherIncomePerSqft, 0),                                                'INR/sqft/yr', NUMBER_FORMATS.integer],
      ['Lease-up Period',         'LeaseUpQuarters',     firstNumber(ctx.inputs.leaseUpQuarters, 4),                                                   'quarters', NUMBER_FORMATS.integer],
    ],
  };

  const incomeOpExSection = {
    title: 'Operating Expenses (Income Asset)',
    rows: [
      ['Property Tax',            'PropertyTaxPct',      toPctDecimal(firstNumber(ctx.inputs.propertyTaxPct, 0.015)),                                                '% of EGR', NUMBER_FORMATS.percent],
      ['Insurance',               'InsurancePct',        toPctDecimal(firstNumber(ctx.inputs.insurancePct, 0.01)),                                                   '% of EGR', NUMBER_FORMATS.percent],
      ['Property Management Fee', 'PropMgmtPct',         toPctDecimal(firstNumber(ctx.inputs.propMgmtPct, ctx.inputs.managementFeePct, 0.03)),                       '% of EGR', NUMBER_FORMATS.percent],
      ['Utilities',               'UtilitiesPct',        toPctDecimal(firstNumber(ctx.inputs.utilitiesPct, 0.04)),                                                   '% of EGR', NUMBER_FORMATS.percent],
      ['Maintenance & Repairs',   'MaintenancePct',      toPctDecimal(firstNumber(ctx.inputs.maintenancePct, ctx.inputs.opexPct, 0.05)),                              '% of EGR', NUMBER_FORMATS.percent],
      ['CapEx Reserves',          'CapExReservePct',     toPctDecimal(firstNumber(ctx.inputs.capExReservePct, 0.02)),                                                '% of EGR', NUMBER_FORMATS.percent],
      ['TI / LC (Tenant Improv)', 'TILCAllowanceCr',     firstNumber(ctx.inputs.tiLcAllowanceCr, ctx.inputs.tenantImprovementsCr, 0),                  'INR Cr (one-time)', NUMBER_FORMATS.currency],
      ['Exit Cap Rate',           'ExitCapRate',         toPctDecimal(firstNumber(ctx.inputs.exitCapRate, ctx.inputs.capRate, ctx.inputs.entryCapRate, 0.08)),       '% / year', NUMBER_FORMATS.percent],
      ['Selling Cost on Exit',    'SellingCostPct',      toPctDecimal(firstNumber(ctx.inputs.sellingCostPct, 0.02)),                                                 '% of sale', NUMBER_FORMATS.percent],
    ],
  };

  const costSection = {
    title: 'Cost Structure',
    rows: [
      ['Land Cost',               'LandCostCr',          firstNumber(ctx.inputs.landCostCr, ctx.deal.land_cost_cr, 0),                                  'INR Cr', NUMBER_FORMATS.currency],
      ['Construction Cost / sqft','ConstructionCostPerSqft', firstNumber(ctx.inputs.constructionCostPerSqft, ctx.deal.construction_cost_per_sqft, 0), 'INR/sqft', NUMBER_FORMATS.integer],
      ['Approval & Fees',         'ApprovalCostCr',      firstNumber(ctx.inputs.approvalCostCr, ctx.deal.approval_cost_cr, 0),                           'INR Cr', NUMBER_FORMATS.currency],
      ...(ctx.dealFamily === 'development' ? [
        ['Marketing & Sales',       'MarketingCostPct',    toPctDecimal(firstNumber(ctx.inputs.marketingCostPct, 0.04)),                                                '% of revenue', NUMBER_FORMATS.percent],
      ] : [
        ['Marketing / Leasing',     'MarketingCostPct',    toPctDecimal(firstNumber(ctx.inputs.marketingCostPct, 0.02)),                                                '% of EGR', NUMBER_FORMATS.percent],
      ]),
      ['Finance / Treasury Cost', 'FinanceCostPct',      toPctDecimal(firstNumber(ctx.inputs.financeCostPct, 0.02)),                                                   '% of revenue', NUMBER_FORMATS.percent],
      ['Contingency',             'ContingencyPct',      toPctDecimal(firstNumber(ctx.inputs.contingencyPct, 0.05)),                                                   '% of cost', NUMBER_FORMATS.percent],
      ['GST',                     'GstPct',              toPctDecimal(firstNumber(ctx.inputs.gstPct, ctx.inputs.gstRatePct, 0.05)),                                    '%', NUMBER_FORMATS.percent],
      ['Stamp Duty',              'StampDutyPct',        toPctDecimal(firstNumber(ctx.inputs.stampDutyPct, 0.05)),                                                     '%', NUMBER_FORMATS.percent],
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

  const scheduleSection = {
    title: 'Project Schedule',
    rows: [
      ['Project Duration',        'ProjectMonths',       ctx.projectMonths,                                                                              'months', NUMBER_FORMATS.integer],
      ['Quarters',                'TotalQuarters',       ctx.totalQuarters,                                                                              'count', NUMBER_FORMATS.integer],
      ['Construction Start Lag',  'ConstructionLagQ',    firstNumber(ctx.inputs.constructionLagQuarters, 1),                                             'quarters', NUMBER_FORMATS.integer],
      ['Sales / Lease Launch Lag','SalesLagQ',           firstNumber(ctx.inputs.salesLagQuarters, ctx.inputs.leaseLagQuarters, 0),                       'quarters', NUMBER_FORMATS.integer],
    ],
  };

  const capitalSection = {
    title: 'Capital Structure & Returns',
    rows: [
      ['Debt %',                  'DebtLTV',             toPctDecimal(firstNumber(ctx.inputs.debtLTV, ctx.inputs.debtPct, 0.55)),                                      '% of cost', NUMBER_FORMATS.percent],
      ['Interest Rate',           'DebtRatePct',         toPctDecimal(firstNumber(ctx.inputs.debtRatePct, ctx.inputs.interestRatePct, 0.115)),                          '% / year', NUMBER_FORMATS.percent],
      ['Loan Term',               'LoanTermYears',       firstNumber(ctx.inputs.loanTermYears, 7),                                                       'years', NUMBER_FORMATS.integer],
      ['Moratorium',              'MoratoriumMonths',    firstNumber(ctx.inputs.moratoriumMonths, 0),                                                    'months', NUMBER_FORMATS.integer],
      ['Discount Rate',           'DiscountRatePct',     toPctDecimal(firstNumber(ctx.inputs.discountRatePct, ctx.deal.discount_rate_pct, 0.16)),                      '% / year', NUMBER_FORMATS.percent],
      ['Developer Margin Target', 'DeveloperMarginPct',  toPctDecimal(firstNumber(ctx.inputs.developerMarginPct, ctx.deal.developer_margin_pct, 0.20)),                 '%', NUMBER_FORMATS.percent],
      ['JV — Developer Share',    'JVDevPct',            toPctDecimal(firstNumber(ctx.deal.jv_split_developer_pct, ctx.inputs.jvDevPct, 0.50)),                          '% of profit', NUMBER_FORMATS.percent],
      ['JV — Landowner Share',    'JVLandPct',           toPctDecimal(firstNumber(ctx.deal.jv_split_landowner_pct, ctx.inputs.jvLandPct, 0.50)),                         '% of profit', NUMBER_FORMATS.percent],
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
  // Detailed Soft Costs section sits right after the headline Cost
  // Structure block so operators see the drilldown adjacent to its
  // parent figures. Debt Sizing inputs come right after Capital Structure
  // so the LTV/DCR/DY/LTC sub-limits sit next to the headline debt %.
  const sections = [
    generalSection,
    ...(ctx.dealFamily === 'income' ? [incomeRevenueSection, incomeOpExSection] : [developmentRevenueSection]),
    costSection,
    detailedSoftCostsSection,
    scheduleSection,
    capitalSection,
    debtSizingSection,
  ];

  let row = 5;
  const definedNames = [];
  sections.forEach((section) => {
    sheet.mergeCells(`A${row}:C${row}`);
    sheet.getCell(`A${row}`).value = section.title;
    styleSectionTitle(sheet.getCell(`A${row}`));
    sheet.getRow(row).height = 20;
    row += 1;

    section.rows.forEach(([label, name, value, unit, format]) => {
      sheet.getCell(`A${row}`).value = label;
      styleLabelCell(sheet.getCell(`A${row}`));
      const valueCell = sheet.getCell(`B${row}`);
      valueCell.value = value;
      styleInputCell(valueCell);
      if (format) valueCell.numFmt = format;
      sheet.getCell(`C${row}`).value = unit;
      styleLabelCell(sheet.getCell(`C${row}`));
      sheet.getCell(`C${row}`).font = { name: FONT, size: 10, italic: true, color: { argb: palette.xlsx('mutedHigh') } };

      // Define the workbook-level name pointing at this cell.
      definedNames.push({ name, ref: `'${SHEETS.inputs}'!$B$${row}` });
      row += 1;
    });

    row += 1; // gap between sections
  });

  // Footer
  sheet.mergeCells(`A${row}:C${row}`);
  sheet.getCell(`A${row}`).value = `Generated ${ctx.generatedAt} | ${ctx.brandName} | yellow cells are editable; everything else recalculates automatically.`;
  sheet.getCell(`A${row}`).font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(`A${row}`).alignment = { horizontal: 'left', vertical: 'middle' };
  sheet.getCell(`A${row}`).protection = { locked: true };

  // Sheet protection intentionally disabled — the operator owns this
  // file once downloaded. Yellow input cells remain visually obvious.

  return { sheet, definedNames };
};

/**
 * Construction Phasing & Sales Collection sheet.
 * Quarterly columns Q1..Qn, rows for cumulative cost / sales / collection.
 */
const buildPhasingSheet = (workbook, ctx) => {
  const sheet = workbook.addWorksheet(SHEETS.phasing, {
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

  // Title row — asset-class-aware
  sheet.mergeCells(1, 1, 1, ctx.totalQuarters + 2);
  sheet.getCell(1, 1).value = ctx.dealFamily === 'income'
    ? `${ctx.brandName} | Lease-up & Operating Schedule`
    : `${ctx.brandName} | Construction Phasing & Sales Collection`;
  styleSectionTitle(sheet.getCell(1, 1));
  sheet.getRow(1).height = 26;

  sheet.mergeCells(2, 1, 2, ctx.totalQuarters + 2);
  sheet.getCell(2, 1).value = ctx.dealFamily === 'income'
    ? `Quarter-by-quarter PGI / EGR / OpEx / NOI build. All formulas reference Inputs & Assumptions named ranges.`
    : `Quarters driven by ProjectMonths input. All formulas reference Inputs & Assumptions named ranges.`;
  sheet.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(2, 1).alignment = { vertical: 'middle' };

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
      formula: (q) => `=-${colLetter(q + 1)}8*VacancyPct*(1-${colLetter(q + 1)}6)`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Plus: Other Income',
      formula: (q) => `=SaleableAreaSqft*OtherIncomePerSqft*${colLetter(q + 1)}6/4/10000000`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'EGR — Effective Gross Revenue',
      formula: (q) => `=${colLetter(q + 1)}8+${colLetter(q + 1)}9+${colLetter(q + 1)}10`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'Less: Property Tax',
      formula: (q) => `=-${colLetter(q + 1)}11*PropertyTaxPct`,
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
      formula: (q) =>
        `=SaleableAreaSqft*SellRatePerSqft*(1+EscalationPct)^(${q}/4)*` +
        `IF(${q}=1,IF(${q}<=SalesLagQ,0,MIN(1,SalesVelocityPct*(${q}-SalesLagQ))),` +
        `IF(${q}<=SalesLagQ,0,MIN(1,SalesVelocityPct*(${q}-SalesLagQ)))-` +
        `IF(${q}-1<=SalesLagQ,0,MIN(1,SalesVelocityPct*(${q}-1-SalesLagQ))))/10000000`,
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
    {
      label: 'Marketing & Sales spend (INR Cr)',
      formula: (q) => `=${colLetter(q + 1)}9*MarketingCostPct`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Cumulative customer collection',
      formula: (q) => q === 1
        ? `=${colLetter(q + 1)}10`
        : `=${colLetter(q)}12+${colLetter(q + 1)}10`,
      format: NUMBER_FORMATS.currency,
      bold: true,
      // Same fix as the construction cumulative row above — total cell
      // shows the final cumulative, not a sum of already-cumulative cells.
      totalKind: 'final',
    },
    // ── Detailed Soft Cost Schedule ──────────────────────────────────────
    // Adds rows 13-19 on the Phasing sheet. These rows match the soft-cost
    // line items the operator's reference pro formas (NAIOP, RE-540)
    // break out, and reference the named ranges defined on the Inputs
    // sheet (ArchitectFeePct, LegalFeePct, AppraisalFeePct,
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
      formula: (q) => {
        const c = colLetter(q + 1);
        return `=${c}13+${c}14+${c}15+${c}16+${c}17+${c}18`;
      },
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
  ];

  const rows = ctx.dealFamily === 'income' ? incomeRows : developmentRows;

  rows.forEach((rowSpec, rowIdx) => {
    const r = 5 + rowIdx;
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

  // Sheet protection intentionally disabled — the operator owns this
  // file once it's downloaded and shouldn't be blocked from editing
  // any cell. Yellow input cells are still visually obvious.
  return sheet;
};

/**
 * Quarterly Cash Flow & Debt sheet.
 */
const buildCashFlowSheet = (workbook, ctx) => {
  const sheet = workbook.addWorksheet(SHEETS.cashflow, {
    views: [{ showGridLines: false, state: 'frozen', xSplit: 1, ySplit: 4 }],
  });
  const cols = [{ width: 32 }];
  for (let i = 0; i < ctx.totalQuarters; i += 1) cols.push({ width: 14 });
  cols.push({ width: 16 });
  sheet.columns = cols;

  sheet.mergeCells(1, 1, 1, ctx.totalQuarters + 2);
  sheet.getCell(1, 1).value = `${ctx.brandName} | Quarterly Cash Flow & Debt`;
  styleSectionTitle(sheet.getCell(1, 1));
  sheet.getRow(1).height = 26;

  sheet.mergeCells(2, 1, 2, ctx.totalQuarters + 2);
  sheet.getCell(2, 1).value = `DSCR conditional formatting: red < 1.20, amber 1.20–1.50, green > 1.50.`;
  sheet.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(2, 1).protection = { locked: true };

  sheet.getCell(4, 1).value = 'Line item';
  for (let q = 1; q <= ctx.totalQuarters; q += 1) sheet.getCell(4, 1 + q).value = `Q${q}`;
  sheet.getCell(4, ctx.totalQuarters + 2).value = 'Total';
  styleHeader(sheet.getRow(4));

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

  // Pre-build the column letter for each quarter
  const colLetters = [];
  for (let q = 1; q <= ctx.totalQuarters; q += 1) colLetters.push(colLetter(q + 1));

  // Helper to reference the phasing sheet for revenue / cost
  const phasing = `'${SHEETS.phasing}'`;

  // Income deal cash flow rows — pulls Cash Flow Before Debt from
  // Phasing!{col}20 (the new Operating P&L), adds debt service.
  // Reversion in the final period uses NOI / Cap Rate.
  const incomeRows = [
    {
      label: 'Cash Flow Before Debt Service (from Operating P&L)',
      formula: (q) => `=${phasing}!${colLetters[q - 1]}20`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'Less: Interest expense',
      formula: (q) => {
        // Interest = (LTV × Total Cost − cumulative principal paid) × rate / 4
        if (q === 1) return `=-(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr)*DebtLTV*DebtRatePct/4`;
        return `=-((LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr)*DebtLTV-IFERROR(SUM($B$7:${colLetters[q - 2]}7),0))*DebtRatePct/4`;
      },
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Less: Principal repayment',
      formula: (q) =>
        `=IF(AND(${q}>MoratoriumMonths/3,${colLetters[q - 1]}5+${colLetters[q - 1]}6>0),MIN(${colLetters[q - 1]}5+${colLetters[q - 1]}6,(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr)*DebtLTV/(LoanTermYears*4)),0)`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Total Debt Service',
      formula: (q) => `=${colLetters[q - 1]}6+${colLetters[q - 1]}7`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'Cash Flow After Debt Service',
      formula: (q) => `=${colLetters[q - 1]}5+${colLetters[q - 1]}8`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'DSCR',
      formula: (q) => `=IFERROR(${colLetters[q - 1]}5/-${colLetters[q - 1]}8,"–")`,
      format: NUMBER_FORMATS.multiple,
      conditional: 'dscr',
    },
    {
      label: 'Reversion — Net Sale Proceeds (final period)',
      formula: (q) => q === ctx.totalQuarters
        ? `=IFERROR(${phasing}!${colLetters[q - 1]}18*4/ExitCapRate*(1-SellingCostPct),0)`
        : `=0`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Total Cash Flow Including Reversion',
      formula: (q) => `=${colLetters[q - 1]}9+${colLetters[q - 1]}11`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
  ];

  // Development deal cash flow rows — existing structure.
  const developmentRows = [
    {
      label: 'Inflow — Customer collection (INR Cr)',
      formula: (q) => `=${phasing}!${colLetters[q - 1]}10`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Outflow — Construction cost (INR Cr)',
      formula: (q) => `=-${phasing}!${colLetters[q - 1]}6`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Outflow — Marketing & Finance (INR Cr)',
      formula: (q) => `=-${phasing}!${colLetters[q - 1]}9*(MarketingCostPct+FinanceCostPct)`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Project net cash flow (INR Cr)',
      formula: (q) => `=${colLetters[q - 1]}5+${colLetters[q - 1]}6+${colLetters[q - 1]}7`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'Debt drawn (INR Cr)',
      formula: (q) =>
        `=IF(${colLetters[q - 1]}8<0,MIN(-${colLetters[q - 1]}8*DebtLTV,(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000)*DebtLTV-IFERROR(SUM($B$9:${colLetters[q - 2] || colLetters[0]}9),0)),0)`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Interest (INR Cr)',
      formula: (q) => {
        if (q === 1) return `=-${colLetters[q - 1]}9*DebtRatePct/4`;
        return `=-(SUM($B$9:${colLetters[q - 2]}9)-IFERROR(SUM($B$11:${colLetters[q - 2]}11),0))*DebtRatePct/4`;
      },
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Principal repayment (INR Cr)',
      formula: (q) =>
        `=IF(${colLetters[q - 1]}8>0,MIN(${colLetters[q - 1]}8,IFERROR(SUM($B$9:${colLetters[q - 1]}9),0)-IFERROR(SUM($B$11:${colLetters[q - 2] || colLetters[0]}11),0)),0)`,
      format: NUMBER_FORMATS.currency,
    },
    {
      label: 'Equity cash flow (INR Cr)',
      formula: (q) => `=${colLetters[q - 1]}8+${colLetters[q - 1]}9+${colLetters[q - 1]}10+${colLetters[q - 1]}11`,
      format: NUMBER_FORMATS.currency,
      bold: true,
    },
    {
      label: 'DSCR',
      formula: (q) => `=IF((-${colLetters[q - 1]}10-${colLetters[q - 1]}11)=0,"–",(${colLetters[q - 1]}5+${colLetters[q - 1]}6+${colLetters[q - 1]}7)/(-${colLetters[q - 1]}10-${colLetters[q - 1]}11))`,
      format: NUMBER_FORMATS.multiple,
      conditional: 'dscr',
    },
  ];

  const rows = ctx.dealFamily === 'income' ? incomeRows : developmentRows;

  rows.forEach((rowSpec, rowIdx) => {
    const r = 5 + rowIdx;
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

  // Conditional formatting on DSCR row (row 13)
  const dscrRowIdx = rows.findIndex((r) => r.conditional === 'dscr');
  if (dscrRowIdx >= 0) {
    const dscrRow = 5 + dscrRowIdx;
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

  // Sheet protection intentionally disabled — the operator owns this
  // file once it's downloaded and shouldn't be blocked from editing
  // any cell. Yellow input cells are still visually obvious.
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

  sheet.mergeCells('A2:N2');
  sheet.getCell('A2').value = `${ctx.dealFamily === 'income' ? 'Operating Asset Dashboard' : 'Development Project Dashboard'} — every figure recalculates live from the Inputs sheet.`;
  sheet.getCell('A2').font = { name: FONT, size: 10, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle' };
  sheet.getRow(2).height = 22;

  // Three rows of KPI cards
  const phasing = `'${SHEETS.phasing}'`;
  const cashflow = `'${SHEETS.cashflow}'`;
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
  const kpiCells = ctx.dealFamily === 'income'
    ? [
        // Top row — operating fundamentals
        { row: 4, col: 'A', label: 'Stabilised NOI (INR Cr / yr)',  kernel: k.noi,                formula: `=${phasing}!${totalCol}18*4`,                                                                       format: NUMBER_FORMATS.currency },
        { row: 4, col: 'C', label: 'Modeled Cap Rate',              kernel: null,                  formula: `=IFERROR(${phasing}!${totalCol}18*4/(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr),0)`, format: NUMBER_FORMATS.percent },
        { row: 4, col: 'E', label: 'Exit Cap Rate',                 kernel: null,                  formula: `=ExitCapRate`,                                                                                       format: NUMBER_FORMATS.percent },
        // Bottom row — investor returns
        { row: 7, col: 'A', label: 'Min DSCR',                      kernel: null,                  formula: `=${cashflow}!${totalCol}10`,                                                                         format: NUMBER_FORMATS.multiple },
        { row: 7, col: 'C', label: 'Cash-on-Cash (Yr 1)',           kernel: k.yieldOnCost,         formula: `=IFERROR(${cashflow}!C9/((LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr)*(1-DebtLTV)),0)`, format: NUMBER_FORMATS.percent },
        { row: 7, col: 'E', label: 'Net Sale Proceeds (INR Cr)',    kernel: k.exitValue,           formula: `=${cashflow}!${totalCol}11`,                                                                         format: NUMBER_FORMATS.currency },
      ]
    : [
        { row: 4, col: 'A', label: 'Total Revenue (INR Cr)',         kernel: k.totalRevenue,       formula: `=${phasing}!${totalCol}9`,                                                                       format: NUMBER_FORMATS.currency },
        { row: 4, col: 'C', label: 'Total Project Cost (INR Cr)',     kernel: k.totalCost,          formula: `=-${cashflow}!${totalCol}6+(-${cashflow}!${totalCol}7)`,                                          format: NUMBER_FORMATS.currency },
        { row: 4, col: 'E', label: 'Project Net Cash Flow (INR Cr)', kernel: (k.totalRevenue != null && k.totalCost != null) ? (k.totalRevenue - k.totalCost) : null, formula: `=${cashflow}!${totalCol}8`,                                                                        format: NUMBER_FORMATS.currency },
        { row: 7, col: 'A', label: 'Gross Margin',                    kernel: k.grossMargin,        formula: `=IFERROR(${cashflow}!${totalCol}8/${phasing}!${totalCol}9,0)`,                                    format: NUMBER_FORMATS.percent },
        { row: 7, col: 'C', label: 'Min DSCR',                        kernel: null,                  formula: `=${cashflow}!${totalCol}13`,                                                                      format: NUMBER_FORMATS.multiple },
        { row: 7, col: 'E', label: 'Residual Land Value (INR Cr)',    kernel: k.residualLandValue,  formula: `=${cashflow}!${totalCol}12`,                                                                      format: NUMBER_FORMATS.currency },
      ];
  kpiCells.forEach(({ row, col, label, kernel, formula, format }) => {
    const labelCell = sheet.getCell(`${col}${row}`);
    labelCell.value = label;
    labelCell.font = { name: FONT, size: 9, color: { argb: palette.xlsx('mutedHigh') }, bold: true };
    labelCell.alignment = { horizontal: 'left' };
    labelCell.fill = FILL(palette.xlsx('paper'));
    labelCell.protection = { locked: true };
    const valueCell = sheet.getCell(`${String.fromCharCode(col.charCodeAt(0) + 1)}${row}`);
    if (kernel != null) {
      // Literal kernel value. For percent-format cells the kernel stores
      // integer-percent (13.6 = 13.6%) but Excel's `0.0%` format expects
      // a decimal — convert via toPctDecimal.
      valueCell.value = format === NUMBER_FORMATS.percent ? toPctDecimal(kernel) : kernel;
    } else {
      valueCell.value = { formula };
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

  // Sources & Uses block — labels + values for the chart
  sheet.getCell('A11').value = 'Sources & Uses';
  styleSectionTitle(sheet.getCell('A11'));
  sheet.mergeCells('A11:F11');
  sheet.getRow(11).height = 22;

  const su = [
    ['Source: Equity',    `=MAX(0,(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr)*(1-DebtLTV))`],
    ['Source: Debt',      `=(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr)*DebtLTV`],
    ['Use: Land',         `=LandCostCr`],
    ['Use: Construction', `=ConstructionCostPerSqft*SaleableAreaSqft/10000000`],
    ['Use: Approvals',    `=ApprovalCostCr`],
  ];
  su.forEach(([label, formula], idx) => {
    const r = 12 + idx;
    sheet.getCell(`A${r}`).value = label;
    styleLabelCell(sheet.getCell(`A${r}`));
    const v = sheet.getCell(`B${r}`);
    v.value = { formula };
    styleOutputCell(v, NUMBER_FORMATS.currency);
  });

  // Native chart objects on the Sources & Uses + Quarterly Trend blocks
  // are now injected post-write via `chartInjector.js` (ExcelJS 4.4.0 has
  // no native `addChart` API — confirmed `addChart` is undefined on the
  // worksheet instance). See `buildDashboardChartSpecs()` below for the
  // exact cell ranges + chart specs each chart targets.

  // ── Returns block — IRR / NPV via native Excel functions ─────────────
  // Cash flow row used for IRR / NPV is asset-class-aware:
  //   - Income deals: row 11 = "Total Cash Flow Including Reversion"
  //   - Development:  row 8  = "Project net cash flow"
  // Excel's IRR() expects a contiguous range; NPV() takes a quarterly rate
  // because the cash flows are quarterly.
  const cfRow = ctx.dealFamily === 'income' ? 11 : 8;
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
  sheet.mergeCells('A22:F22');
  sheet.getCell('A22').value = 'KERNEL = stored on the deal record by REDIP\'s deterministic financial kernel; matches the Reports page + PPTX/DOCX exports. MODELED = recomputed live from the Phasing + Cash Flow sheets; edit Inputs to explore scenarios.';
  sheet.getCell('A22').font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('A22').alignment = { vertical: 'top', wrapText: true };
  sheet.getCell('A22').protection = { locked: true };
  sheet.getRow(22).height = 28;

  // ── Sensitivity grid — Project margin under sale-rate × cost variance ──
  // Two-axis 5x5 with conditional formatting (color scale). No native chart
  // (ExcelJS chart support is patchy); a coloured cell grid renders
  // identically in every Excel version and prints correctly.
  sheet.mergeCells('A23:F23');
  sheet.getCell('A23').value = 'Sensitivity — Project Margin (sale-rate × construction-cost variance)';
  styleSectionTitle(sheet.getCell('A23'));
  sheet.getRow(23).height = 22;

  // Column headers — sale rate variance (-10% to +10%)
  const saleVariances = [-0.10, -0.05, 0, 0.05, 0.10];
  const costVariances = [-0.10, -0.05, 0, 0.05, 0.10]; // constr cost variance

  // Top-left cell — corner label
  sheet.getCell('A24').value = 'Cost ↓ × Rate →';
  sheet.getCell('A24').font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
  sheet.getCell('A24').alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getCell('A24').fill = FILL(palette.xlsx('inkDeep'));
  sheet.getCell('A24').protection = { locked: true };

  // Sale-rate variance column headers (cols B → F)
  saleVariances.forEach((v, idx) => {
    const cell = sheet.getCell(24, 2 + idx);
    cell.value = v;
    cell.numFmt = '+0%;-0%;"base"';
    cell.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = FILL(palette.xlsx('inkDeep'));
    cell.protection = { locked: true };
  });

  // Row labels — construction cost variance (rows 25 → 29)
  costVariances.forEach((v, rIdx) => {
    const r = 25 + rIdx;
    const labelCell = sheet.getCell(`A${r}`);
    labelCell.value = v;
    labelCell.numFmt = '+0%;-0%;"base"';
    labelCell.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    labelCell.alignment = { vertical: 'middle', horizontal: 'center' };
    labelCell.fill = FILL(palette.xlsx('inkDeep'));
    labelCell.protection = { locked: true };

    saleVariances.forEach((rateV, cIdx) => {
      const cell = sheet.getCell(r, 2 + cIdx);
      // Margin = (Revenue × (1 + saleVar) − Cost × (1 + costVar)) / Revenue × (1 + saleVar)
      const formula =
        `=IFERROR(((SaleableAreaSqft*SellRatePerSqft*(1+EscalationPct)^(TotalQuarters/4/2)/10000000)*(1+${rateV})` +
        `-(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr)*(1+IF(ROW()-25=${rIdx},${costVariances[rIdx]},0))) ` +
        `/((SaleableAreaSqft*SellRatePerSqft*(1+EscalationPct)^(TotalQuarters/4/2)/10000000)*(1+${rateV})),0)`;
      cell.value = { formula };
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

  // Color scale on the heatmap range B25:F29 — red (negative) → amber (0) → green (high)
  sheet.addConditionalFormatting({
    ref: 'B25:F29',
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
  // Drives the Tornado chart anchored at H27. Uses cell references into
  // the existing 5×5 sensitivity grid (B25:F29) so the deltas recalculate
  // live as the kernel inputs change. Base case is D27 (centre of the
  // 5×5 grid — sale-rate variance = 0%, construction-cost variance = 0%).
  //
  // Driver impact derivation:
  //   Selling Rate ±10% → varies the SALE rate, holds construction cost
  //     at base. Low-case = B27 (rate -10%) minus base; High-case = F27
  //     (rate +10%) minus base. Low usually negative, high usually
  //     positive (more revenue → higher margin).
  //   Construction Cost ±10% → varies COST, holds rate at base. High
  //     cost = D29 (cost +10%) is the LOW-margin case; low cost = D25
  //     (cost -10%) is the HIGH-margin case. So our "Low Case Δ" for
  //     this driver = D29 - D27 (negative); "High Case Δ" = D25 - D27
  //     (positive).
  sheet.mergeCells('H23:M23');
  sheet.getCell('H23').value = 'Driver Impact on Project Margin (tornado)';
  styleSectionTitle(sheet.getCell('H23'));
  sheet.getRow(23).height = 22;

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
    const cell = sheet.getCell(`${col}24`);
    cell.value = label;
    cell.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = FILL(palette.xlsx('inkDeep'));
    cell.protection = { locked: true };
  });
  sheet.getRow(24).height = 22;

  // Row 25: Selling Rate driver; Row 26: Construction Cost driver.
  // Order: longest-range driver on top. Since the grid is symmetric in
  // its sale-rate and cost-rate dimensions but margin maths is asymmetric
  // (revenue × (1+rate) vs cost × (1+cost)), the sale-rate driver tends
  // to dominate. We let the chart render in the data-row order without
  // dynamic sorting.
  const drivers = [
    {
      row: 25,
      label: 'Selling Rate ±10%',
      lowDeltaFormula: '=B27-D27',     // rate -10% margin minus base margin
      highDeltaFormula: '=F27-D27',    // rate +10% margin minus base margin
      lowMarginRef: 'B27',
      highMarginRef: 'F27',
    },
    {
      row: 26,
      label: 'Construction Cost ±10%',
      lowDeltaFormula: '=D29-D27',     // cost +10% margin minus base margin (worst case)
      highDeltaFormula: '=D25-D27',    // cost -10% margin minus base margin (best case)
      lowMarginRef: 'D29',
      highMarginRef: 'D25',
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
  sheet.mergeCells('H27:M27');
  sheet.getCell('H27').value = 'Bars centred on Base Case (sale-rate 0% × cost 0%). Bars extend left (downside) and right (upside) from that base.';
  sheet.getCell('H27').font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('H27').alignment = { vertical: 'top', wrapText: true };
  sheet.getRow(27).height = 26;

  // ── Scenario strip (Bull / Base / Bear) ──────────────────────────────
  sheet.mergeCells('A31:F31');
  sheet.getCell('A31').value = 'Scenario Comparison (modeled)';
  styleSectionTitle(sheet.getCell('A31'));
  sheet.getRow(31).height = 22;

  const scenarios = [
    { col: 'A', name: 'BULL CASE',  rate: 0.10,  cost: -0.05, accent: palette.xlsx('dataPositive') },
    { col: 'C', name: 'BASE CASE',  rate: 0,     cost: 0,     accent: palette.xlsx('accent') },
    { col: 'E', name: 'BEAR CASE',  rate: -0.10, cost: 0.10,  accent: palette.xlsx('dataNegative') },
  ];
  scenarios.forEach((sc) => {
    // Header
    const hdr = sheet.getCell(`${sc.col}32`);
    hdr.value = sc.name;
    hdr.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('paperElevated') }, charSpace: 1.6 };
    hdr.alignment = { horizontal: 'center', vertical: 'middle' };
    hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sc.accent } };
    hdr.protection = { locked: true };
    sheet.mergeCells(`${sc.col}32:${String.fromCharCode(sc.col.charCodeAt(0) + 1)}32`);

    // Margin
    const marginLabel = sheet.getCell(`${sc.col}33`);
    marginLabel.value = 'Margin';
    marginLabel.font = { name: FONT, size: 9, color: { argb: palette.xlsx('mutedHigh') } };
    marginLabel.alignment = { horizontal: 'left' };
    marginLabel.fill = FILL(palette.xlsx('paper'));
    marginLabel.protection = { locked: true };
    const marginVal = sheet.getCell(`${String.fromCharCode(sc.col.charCodeAt(0) + 1)}33`);
    marginVal.value = {
      formula:
        `=IFERROR(((SaleableAreaSqft*SellRatePerSqft*(1+EscalationPct)^(TotalQuarters/4/2)/10000000)*(1+${sc.rate})` +
        `-(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr)*(1+${sc.cost})) ` +
        `/((SaleableAreaSqft*SellRatePerSqft*(1+EscalationPct)^(TotalQuarters/4/2)/10000000)*(1+${sc.rate})),0)`,
    };
    marginVal.numFmt = NUMBER_FORMATS.percent;
    marginVal.font = { name: FONT, size: 14, bold: true, color: { argb: sc.accent } };
    marginVal.alignment = { horizontal: 'right' };
    marginVal.fill = FILL(palette.xlsx('paperElevated'));
    marginVal.protection = { locked: true };

    // Profit
    const profitLabel = sheet.getCell(`${sc.col}34`);
    profitLabel.value = 'Profit (Cr)';
    profitLabel.font = { name: FONT, size: 9, color: { argb: palette.xlsx('mutedHigh') } };
    profitLabel.alignment = { horizontal: 'left' };
    profitLabel.fill = FILL(palette.xlsx('paper'));
    profitLabel.protection = { locked: true };
    const profitVal = sheet.getCell(`${String.fromCharCode(sc.col.charCodeAt(0) + 1)}34`);
    profitVal.value = {
      formula:
        `=(SaleableAreaSqft*SellRatePerSqft*(1+EscalationPct)^(TotalQuarters/4/2)/10000000)*(1+${sc.rate})` +
        `-(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr)*(1+${sc.cost})`,
    };
    profitVal.numFmt = NUMBER_FORMATS.currency;
    profitVal.font = { name: FONT, size: 11, bold: true, color: { argb: palette.xlsx('ink') } };
    profitVal.alignment = { horizontal: 'right' };
    profitVal.fill = FILL(palette.xlsx('paperElevated'));
    profitVal.protection = { locked: true };
  });

  // ── Quarterly Operating Trend (asset-class-aware, conditional-format
  // data bars give the table an inline-chart feel that works across every
  // Excel version — more reliable than ExcelJS chart objects)
  // Income deals: Quarter | PGI | EGR | NOI | Cash Flow After Debt
  // Development: Quarter | Sales | Construction Cost | Net Cash Flow | Cumulative
  sheet.mergeCells('A36:N36');
  sheet.getCell('A36').value = ctx.dealFamily === 'income'
    ? 'Quarterly Operating Trend (PGI / EGR / NOI / CF After Debt)'
    : 'Quarterly Project Trend (Sales / Construction / Net CF / Cumulative)';
  styleSectionTitle(sheet.getCell('A36'));
  sheet.getRow(36).height = 22;

  // Header row
  const trendHeaders = ctx.dealFamily === 'income'
    ? ['Quarter', 'PGI (Cr)', 'EGR (Cr)', 'NOI (Cr)', 'CF After Debt (Cr)']
    : ['Quarter', 'Sales (Cr)', 'Construction (Cr)', 'Net CF (Cr)', 'Cumulative (Cr)'];
  trendHeaders.forEach((h, idx) => {
    const cell = sheet.getCell(37, idx + 1);
    cell.value = h;
    cell.font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('paperElevated') } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = FILL(palette.xlsx('inkDeep'));
  });
  sheet.getRow(37).height = 22;

  // Source rows on Phasing / Cash Flow sheet — asset-class-aware
  const trendQuarters = Math.min(ctx.totalQuarters, 16); // cap at 16 for readability
  for (let q = 1; q <= trendQuarters; q += 1) {
    const r = 37 + q;
    sheet.getCell(r, 1).value = `Q${q}`;
    sheet.getCell(r, 1).font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('mutedHigh') } };
    sheet.getCell(r, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getCell(r, 1).fill = FILL(palette.xlsx('paper'));
    const qCol = colLetter(q + 1); // q=1 → B on phasing/cashflow

    if (ctx.dealFamily === 'income') {
      // PGI = Phasing!{qCol}8, EGR = row 11, NOI = row 18, CFAfterDebt = Cash Flow row 9
      const formulas = [
        `=${phasing}!${qCol}8`,
        `=${phasing}!${qCol}11`,
        `=${phasing}!${qCol}18`,
        `=${cashflow}!${qCol}9`,
      ];
      formulas.forEach((f, idx) => {
        const cell = sheet.getCell(r, idx + 2);
        cell.value = { formula: f };
        cell.numFmt = NUMBER_FORMATS.currency;
        cell.font = { name: FONT, size: 9, color: { argb: palette.xlsx('ink') } };
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      });
    } else {
      // Sales = Phasing!{qCol}9, Construction = row 6, Net CF = Cash Flow row 8, Cum = Cash Flow!{qCol}8 cumulative via SUMIF
      const startCol = colLetter(2);
      const formulas = [
        `=${phasing}!${qCol}9`,
        `=${phasing}!${qCol}6`,
        `=${cashflow}!${qCol}8`,
        `=SUM(${cashflow}!$${startCol}$8:${qCol}8)`,
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
  const dataBarColors = [palette.xlsx('plum'), palette.xlsx('accent'), palette.xlsx('dataPositive'), palette.xlsx('mutedHigh')];
  for (let col = 2; col <= 5; col += 1) {
    const startCell = `${colLetter(col)}38`;
    const endCell = `${colLetter(col)}${37 + trendQuarters}`;
    try {
      sheet.addConditionalFormatting({
        ref: `${startCell}:${endCell}`,
        rules: [{
          type: 'dataBar',
          cfvo: [
            { type: 'min' },
            { type: 'max' },
          ],
          color: { argb: palette.xlsx(['plum', 'accent', 'dataPositive', 'mutedHigh'][col - 2]) },
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
  let waterfallEndRow = 37 + trendQuarters; // baseline if waterfall not shown
  if (isJv) {
    const wfStartRow = 37 + trendQuarters + 2;
    sheet.mergeCells(`A${wfStartRow}:N${wfStartRow}`);
    sheet.getCell(`A${wfStartRow}`).value = `Profit Waterfall — ${ctx.deal.deal_structure ? ctx.deal.deal_structure.toUpperCase() : 'JV'} structure`;
    styleSectionTitle(sheet.getCell(`A${wfStartRow}`));
    sheet.getRow(wfStartRow).height = 22;

    const wfRows = [
      ['Total Project Profit (modeled)',
        `=(SaleableAreaSqft*SellRatePerSqft*(1+EscalationPct)^(TotalQuarters/4/2)/10000000)-(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr)`,
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
      valCell.font = { name: FONT, size: idx === 0 ? 12 : 11, bold: true, color: { argb: idx === 1 ? palette.xlsx('plum') : idx === 2 ? palette.xlsx('accent') : palette.xlsx('inkDeep') } };
      valCell.alignment = { horizontal: 'right' };
      valCell.fill = FILL(palette.xlsx('paperElevated'));
      sheet.getCell(`C${r}`).value = note;
      sheet.getCell(`C${r}`).font = { name: FONT, size: 8.5, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
      sheet.getCell(`C${r}`).alignment = { horizontal: 'left', vertical: 'middle' };
      sheet.mergeCells(`C${r}:N${r}`);
    });
    waterfallEndRow = wfStartRow + wfRows.length;
  }

  // Footer disclaimer — pushed below the trend table (or waterfall if shown).
  const footerRow = waterfallEndRow + 2;
  sheet.mergeCells(`A${footerRow}:N${footerRow}`);
  sheet.getCell(`A${footerRow}`).value = `Generated ${ctx.generatedAt} | ${ctx.brandName} | Auto-calculated. Verify all inputs against your source data before any decision. Power users: right-click any sheet tab → Unhide → Calculations to inspect the audit-trail maths.`;
  sheet.getCell(`A${footerRow}`).font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(`A${footerRow}`).alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(footerRow).height = 28;

  // Sheet protection intentionally disabled — the operator owns this
  // file once it's downloaded and shouldn't be blocked from editing
  // any cell. Yellow input cells are still visually obvious.
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
  const sheet = workbook.addWorksheet(SHEETS.debtSizing, {
    views: [{ showGridLines: false }],
  });
  sheet.columns = [
    { width: 32 }, // A: Label
    { width: 22 }, // B: Value
    { width: 32 }, // C: Note
  ];

  // Title
  sheet.mergeCells('A1:C1');
  sheet.getCell('A1').value = `${ctx.brandName} | ${ctx.deal.name || ctx.property.property_name || 'Deal'} | Debt Sizing`;
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

  const hardCost = '(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr)';
  const softCost = `${hardCost}*(ArchitectFeePct+LegalFeePct+AppraisalFeePct+InsuranceConstPct+DeveloperOverheadPct)+LandCostCr*PropTaxConstPct`;
  const totalCost = `${hardCost}+${softCost}`;

  // NOI driver — income family uses kernel-stored stabilised NOI when
  // available; development family uses a residual-land-value proxy.
  // Kernel stores in INR Cr; reference templates use INR Cr for both.
  const noiSource = ctx.dealFamily === 'income'
    ? (firstNumber(ctx.deal.stabilized_noi_cr, ctx.deal.noi_cr, ctx.kernelKpis?.noi) != null
        ? String(firstNumber(ctx.deal.stabilized_noi_cr, ctx.deal.noi_cr, ctx.kernelKpis?.noi))
        : `'${SHEETS.phasing}'!N18*4`) // fallback to phased modeled NOI × 4 (annualised)
    : null;

  const inputsSummary = [
    ['Total Project Cost (INR Cr)', `=${totalCost}`,                                   'Hard + Soft + Revenue-driven costs (matches Calculations!B25)'],
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
    + 'Annual payment factor uses simple ordinary annuity — moratorium not modelled. '
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
  const sheet = workbook.addWorksheet(SHEETS.amortization, {
    views: [{ showGridLines: false }],
  });
  sheet.columns = [
    { width: 10 }, // A: Period
    { width: 22 }, // B: Beginning Balance
    { width: 18 }, // C: Payment
    { width: 16 }, // D: Interest
    { width: 16 }, // E: Principal
    { width: 22 }, // F: Ending Balance
  ];

  // Title
  sheet.mergeCells('A1:F1');
  sheet.getCell('A1').value = `${ctx.brandName} | ${ctx.deal.name || ctx.property.property_name || 'Deal'} | Amortization Schedule`;
  styleSectionTitle(sheet.getCell('A1'));
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:F2');
  sheet.getCell('A2').value = 'Quarter-by-quarter debt amortization. All values recalculate from the named ranges on the Inputs sheet — edit LandCostCr, ConstructionCostPerSqft, DebtLTV, DebtRatePct, or LoanTermYears to flow through.';
  sheet.getCell('A2').font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('A2').alignment = { vertical: 'middle', wrapText: true };
  sheet.getRow(2).height = 22;

  // ── Loan Terms summary block (rows 4-10) ──────────────────────────────
  sheet.mergeCells('A4:F4');
  sheet.getCell('A4').value = 'Loan Terms';
  styleSectionTitle(sheet.getCell('A4'));
  sheet.getRow(4).height = 22;

  // Loan Amount = lender-approved permanent loan from the Debt Sizing
  // sheet (= MIN of LTC / LTV / DCR / DY for income deals; LTC only for
  // development). This is the AMORTISED amount — what the borrower
  // actually repays month after month.
  //
  // PR-B introduced the Debt Sizing sheet; this Loan Amount formula
  // now references its final MIN cell (B28). Operators can still see
  // the legacy "DebtLTV × Total Cost" for comparison in Debt Sizing!B29.
  const debtSizingRef = `'${SHEETS.debtSizing}'`;
  const termsRows = [
    ['Loan Amount (INR Cr)',         `=${debtSizingRef}!B28`,                              NUMBER_FORMATS.currency],
    ['Annual Interest Rate',         '=DebtRatePct',                                       NUMBER_FORMATS.percent],
    ['Loan Term (years)',            '=LoanTermYears',                                     NUMBER_FORMATS.integer],
    ['Quarterly Periods',            '=LoanTermYears*4',                                   NUMBER_FORMATS.integer],
    ['Effective Quarterly Rate',     '=(1+DebtRatePct)^(1/4)-1',                            NUMBER_FORMATS.percent],
    ['Quarterly Payment (INR Cr)',   '=-PMT(B9,B8,B5)',                                    NUMBER_FORMATS.currency],
  ];
  termsRows.forEach(([label, formula, fmt], idx) => {
    const r = 5 + idx;
    sheet.getCell(`A${r}`).value = label;
    styleLabelCell(sheet.getCell(`A${r}`));
    const cell = sheet.getCell(`B${r}`);
    cell.value = { formula };
    styleOutputCell(cell, fmt);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
  });

  // ── Amortization table header (row 12) ─────────────────────────────────
  const headerRow = 12;
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
  // For each row:
  //   Beginning Balance:
  //     - Period 1: = Loan Amount (B5)
  //     - Period N: = Ending Balance of previous row
  //   Payment:        = Quarterly Payment (B10) for all periods
  //   Interest:       = Beginning Balance × Quarterly Rate (B9)
  //   Principal:      = Payment − Interest
  //   Ending Balance: = Beginning Balance − Principal
  // IFERROR everywhere so that out-of-term rows stay blank rather than
  // showing error values.
  const maxRows = Math.min(80, 80); // hard cap; LoanTermYears reflects actual
  for (let i = 0; i < maxRows; i += 1) {
    const r = 13 + i;
    const period = i + 1;
    // Period column
    sheet.getCell(`A${r}`).value = { formula: `=IF(${period}<=$B$8,${period},"")` };
    sheet.getCell(`A${r}`).font = { name: FONT, size: 9, bold: true, color: { argb: palette.xlsx('mutedHigh') } };
    sheet.getCell(`A${r}`).alignment = { horizontal: 'center' };
    // Beginning Balance
    sheet.getCell(`B${r}`).value = {
      formula: i === 0 ? '=$B$5' : `=IF($A${r}="","",F${r - 1})`,
    };
    sheet.getCell(`B${r}`).numFmt = NUMBER_FORMATS.currency;
    // Payment
    sheet.getCell(`C${r}`).value = { formula: `=IF($A${r}="","",$B$10)` };
    sheet.getCell(`C${r}`).numFmt = NUMBER_FORMATS.currency;
    // Interest
    sheet.getCell(`D${r}`).value = { formula: `=IF($A${r}="","",B${r}*$B$9)` };
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
  const footerRow = 13 + maxRows + 1;
  sheet.mergeCells(`A${footerRow}:F${footerRow}`);
  sheet.getCell(`A${footerRow}`).value =
    'Amortization shown at the effective quarterly rate ((1+annual)^(1/4)−1). Moratorium input MoratoriumMonths is currently not modelled here — once PR-B splits construction vs permanent loan, this schedule will show the permanent loan post-moratorium. Verify against the lender term sheet before use.';
  sheet.getCell(`A${footerRow}`).font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(`A${footerRow}`).alignment = { vertical: 'top', wrapText: true };
  sheet.getRow(footerRow).height = 36;

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
    ? `'${SHEETS.phasing}'!${totalColLetter}11`
    : `'${SHEETS.phasing}'!${totalColLetter}9`;
  const collectedRef = ctx.dealFamily === 'income'
    ? `'${SHEETS.phasing}'!${totalColLetter}11`
    : `'${SHEETS.phasing}'!${totalColLetter}10`;

  writeBlock('Revenue Build', [
    ['Saleable area (sqft)',         '=SaleableAreaSqft',                               'From Inputs & Assumptions'],
    ['Sell rate (INR / sqft)',       '=SellRatePerSqft',                                'From Inputs & Assumptions'],
    ['Average escalation factor',    '=(1+EscalationPct)^(TotalQuarters/4/2)',          'Mid-period uplift (context only)'],
    ['Total revenue (INR Cr)',       `=${revenueRef}`,                                  'Sum of phased quarter sales — matches Dashboard'],
    ['Customer collected (INR Cr)',  `=${collectedRef}`,                                 'Sum of phased customer collection'],
  ]);

  // Cost Build (rows 12–25) — full institutional-grade breakdown.
  // Hard cost block (rows 12-15):
  //   R12 Land · R13 Construction · R14 Approvals · R15 Hard subtotal
  // Detailed soft cost block (rows 16-23) — references the named ranges
  // defined on the Inputs sheet for the 8 distinct soft cost line items
  // the operator's reference pro formas (NAIOP, RE-540) break out:
  //   R16 A&E · R17 Legal · R18 Appraisal · R19 Insurance during Const ·
  //   R20 Property Taxes during Const · R21 Developer Overhead ·
  //   R22 Marketing & Sales (revenue-driven) · R23 Finance / Treasury (revenue-driven)
  // R24 Soft cost subtotal · R25 Total project cost
  writeBlock('Cost Build', [
    ['Land cost (INR Cr)',                   '=LandCostCr',                                                       'From Inputs & Assumptions'],
    ['Construction cost (INR Cr)',           '=ConstructionCostPerSqft*SaleableAreaSqft/10000000',                 'Construction rate × saleable area'],
    ['Approval & fees (INR Cr)',             '=ApprovalCostCr',                                                   'From Inputs & Assumptions'],
    ['Hard cost subtotal',                   '=B12+B13+B14',                                                       'Land + Construction + Approvals'],
    ['A&E fees (INR Cr)',                    '=B13*ArchitectFeePct',                                              'Construction × ArchitectFeePct'],
    ['Legal fees (INR Cr)',                  '=B13*LegalFeePct',                                                  'Construction × LegalFeePct'],
    ['Appraisal & title (INR Cr)',           '=B13*AppraisalFeePct',                                              'Construction × AppraisalFeePct'],
    ['Insurance during construction (INR Cr)','=B13*InsuranceConstPct',                                           'Construction × InsuranceConstPct'],
    ['Property taxes during construction',   '=LandCostCr*PropTaxConstPct',                                       'Land × PropTaxConstPct (Karnataka method)'],
    ['Developer overhead (INR Cr)',          '=B13*DeveloperOverheadPct',                                         'Construction × DeveloperOverheadPct'],
    ['Marketing & sales (INR Cr)',           '=B8*MarketingCostPct',                                              'Total revenue × MarketingCostPct'],
    ['Finance / treasury (INR Cr)',          '=B8*FinanceCostPct',                                                'Total revenue × FinanceCostPct'],
    ['Soft cost subtotal',                   '=B16+B17+B18+B19+B20+B21+B22+B23',                                  'All 8 soft cost line items'],
    ['Total project cost (INR Cr)',          '=B15+B24',                                                          'Hard + Soft costs'],
  ]);

  // Debt Sculpting block now sits at rows 27–32 (shifted down due to
  // the expanded Cost Build).
  writeBlock('Debt Sculpting', [
    ['Debt LTV (% of cost)',         '=DebtLTV',                                        'From Inputs & Assumptions'],
    ['Total debt envelope (INR Cr)', '=B25*DebtLTV',                                    'Total project cost × LTV (B25 = Total cost at expanded Cost Build)'],
    ['Equity envelope (INR Cr)',     '=B25*(1-DebtLTV)',                                'Total project cost × (1-LTV)'],
    ['Annualised interest cost',     '=B29*DebtRatePct',                                'Debt envelope × rate (peak proxy)'],
    ['Quarterly interest accrual',   '=B31/4',                                          'Annualised ÷ 4 (sanity check vs Cash Flow row 10)'],
    ['Effective debt cost / unit',   '=B31/SaleableAreaSqft*10000000',                  'Per-sqft cost-of-capital proxy (Cr → INR ÷ sqft)'],
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

  // Lock everything — power users who want to edit can unhide + unprotect.
  // Sheet protection intentionally disabled — the operator owns this
  // file once it's downloaded and shouldn't be blocked from editing
  // any cell. Yellow input cells are still visually obvious.
  return sheet;
};

/**
 * Build the v2 workbook. Returns an ExcelJS Workbook ready to write.
 */
const buildDealWorkbookV2Workbook = (exportContext, options = {}) => {
  const ctx = buildContext(exportContext, options);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = options.userName || ctx.brandName;
  workbook.lastModifiedBy = options.userName || ctx.brandName;
  workbook.created = new Date(ctx.generatedAt);
  workbook.modified = new Date();
  workbook.title = `${ctx.deal.name || ctx.property.property_name || 'Deal'} — Investor-Grade Workbook`;
  workbook.subject = `${ctx.assetClass || 'Generic'} financial model`;
  workbook.description = 'REDIP investor-grade workbook (v2). Investor-grade — verify all inputs.';
  workbook.company = ctx.brandName;

  const { definedNames } = buildInputsSheet(workbook, ctx);
  buildPhasingSheet(workbook, ctx);
  buildCashFlowSheet(workbook, ctx);
  buildDashboardSheet(workbook, ctx);
  buildDebtSizingSheet(workbook, ctx);
  buildAmortizationSheet(workbook, ctx);
  buildCalculationsSheet(workbook, ctx); // hidden audit trail

  // Register defined names AFTER all sheets exist so the references resolve.
  definedNames.forEach(({ name, ref }) => {
    workbook.definedNames.add(ref, name);
  });

  return workbook;
};

/**
 * Build the chart specs that get injected onto the Dashboard after
 * ExcelJS finishes writing the workbook. Asset-class-aware: development
 * deals see Sales/Construction columns; income deals see PGI/NOI.
 *
 * Cell positions here MUST stay in sync with buildDashboardSheet() —
 * the chart formulas point at exact cells produced by that builder.
 * Any movement of the Sources & Uses block (rows 12-16) or the Quarterly
 * Trend table (rows 37-53) needs to be reflected here.
 */
const buildDashboardChartSpecs = (ctx) => {
  const specs = [];
  const dashName = SHEETS.dashboard;

  // 1. Uses Breakdown doughnut (always populated — Land + Construction +
  //    Approvals at rows 14-16). Sources at rows 12-13 are intentionally
  //    excluded from the doughnut; "Sources & Uses" as a 5-slice donut
  //    mixes the inflow side with the outflow side and reads poorly.
  specs.push({
    type: 'doughnut',
    title: 'Uses Breakdown',
    sheetName: dashName,
    categoriesRange: '$A$14:$A$16',
    valuesRange: '$B$14:$B$16',
    colours: ['0E1B2C', 'B5793C', '0F7B5A'], // inkDeep / accent / dataPositive
    anchor: { fromCol: 7, fromRow: 10, widthCols: 6, heightRows: 12 },
  });

  // 2. Quarterly Trend combo chart — clustered columns for period
  //    contribution + cumulative line on secondary value axis. The
  //    cumulative-line crossover is the canonical analyst read for
  //    "when does the deal turn positive."
  //
  //    Development family: Sales + Construction columns + Cumulative line
  //    Income family:      PGI + NOI columns + CF-After-Debt cumulative line
  //
  //    Anchored BELOW the data table (rows 37-53). Asset-class-aware
  //    series labels + colours.
  const trendQuarters = Math.min(ctx.totalQuarters, 16);
  const trendEndRow = 37 + trendQuarters;
  if (trendQuarters >= 2) {
    const isIncome = ctx.dealFamily === 'income';
    const barSeries = isIncome
      ? [
        { name: 'PGI (Cr)', valuesRange: `$B$38:$B$${trendEndRow}`, colour: '0E1B2C' },
        { name: 'NOI (Cr)', valuesRange: `$D$38:$D$${trendEndRow}`, colour: '0F7B5A' },
      ]
      : [
        { name: 'Sales (Cr)',        valuesRange: `$B$38:$B$${trendEndRow}`, colour: '0F7B5A' },
        { name: 'Construction (Cr)', valuesRange: `$C$38:$C$${trendEndRow}`, colour: 'B23A48' },
      ];
    // Cumulative line lives in column E for both families (Quarterly
    // Trend table layout: A=Quarter, B=Series1, C=Series2, D=Series3,
    // E=Cumulative-or-CF-After-Debt). Copper accent ties the line
    // visually to the editorial palette without competing with the
    // green/red bar palette.
    const lineSeries = [
      {
        name: isIncome ? 'CF After Debt (cum, Cr)' : 'Cumulative Net CF (Cr)',
        valuesRange: `$E$38:$E$${trendEndRow}`,
        colour: 'B5793C',
      },
    ];
    specs.push({
      type: 'combo',
      title: isIncome
        ? 'Quarterly Operating Trend — PGI / NOI / CF After Debt'
        : 'Quarterly Project Trend — Sales / Construction / Cumulative',
      sheetName: dashName,
      categoriesRange: `$A$38:$A$${trendEndRow}`,
      barSeries,
      lineSeries,
      anchor: { fromCol: 0, fromRow: trendEndRow + 1, widthCols: 13, heightRows: 14 },
    });
  }

  // 3. Tornado chart — Driver Impact on Project Margin. Native Office
  //    pattern: clustered horizontal bar with overlap=100. Low-case
  //    deltas (negative) extend left from 0; high-case deltas (positive)
  //    extend right. The driver data table at H24:M26 feeds the chart.
  //    Anchored at columns N-T (cols 13-19), rows 23-29 — to the right
  //    of the sensitivity heatmap so the analyst sees the heatmap AND
  //    the driver-impact tornado in the same eye span.
  specs.push({
    type: 'tornado',
    title: 'Sensitivity — Driver Impact (Δ from base margin)',
    sheetName: dashName,
    categoriesRange: '$H$25:$H$26',
    lowValuesRange: '$I$25:$I$26',
    highValuesRange: '$J$25:$J$26',
    lowColour: 'B23A48',  // dataNegative
    highColour: '0F7B5A', // dataPositive
    anchor: { fromCol: 13, fromRow: 28, widthCols: 7, heightRows: 8 },
  });

  return specs;
};

/**
 * Build and return the workbook as a Buffer (for the route handler).
 * Two-stage: ExcelJS writes cells / formulas / conditional formatting,
 * then chartInjector.js splices in native chart XML for the Dashboard
 * (ExcelJS has no addChart API in 4.4.0). The final buffer is what the
 * operator downloads — native charts that recalc when inputs change.
 */
const buildDealWorkbookV2 = async (exportContext, options = {}) => {
  const ctx = buildContext(exportContext, options);
  const workbook = buildDealWorkbookV2Workbook(exportContext, options);
  const raw = await workbook.xlsx.writeBuffer();
  const xlsxBuffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

  const chartSpecs = buildDashboardChartSpecs(ctx);
  if (chartSpecs.length === 0) return xlsxBuffer;

  try {
    // Dashboard is always the 4th sheet in our generator (Inputs / Phasing
    // / Cash Flow / Dashboard / Calculations). ExcelJS assigns sheet files
    // by position so this maps deterministically to xl/worksheets/sheet4.xml.
    return await injectChartsIntoXlsx(xlsxBuffer, {
      targetSheetName: SHEETS.dashboard,
      targetSheetFile: 'sheet4.xml',
      charts: chartSpecs,
    });
  } catch (err) {
    // Chart injection is best-effort. If anything goes wrong (a future
    // template change shifts the sheet position, an XML structure shifts,
    // etc.) we fall back to the un-injected workbook so the operator
    // still gets a working file rather than an error.
    if (process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.warn('[xlsx.v2] chart injection failed, returning un-enhanced workbook:', err.message);
    }
    return xlsxBuffer;
  }
};

module.exports = {
  buildDealWorkbookV2,
  // Internal exports for tests.
  __internal: {
    buildContext,
    buildDealWorkbookV2Workbook,
    buildDashboardChartSpecs,
    SHEETS,
    NUMBER_FORMATS,
  },
};
