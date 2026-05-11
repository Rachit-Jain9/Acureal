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

  // Compose the sections list with asset-class branching.
  const sections = [
    generalSection,
    ...(ctx.dealFamily === 'income' ? [incomeRevenueSection, incomeOpExSection] : [developmentRevenueSection]),
    costSection,
    scheduleSection,
    capitalSection,
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
      label: 'Customer collection (INR Cr)',
      formula: (q) => `=${colLetter(q + 1)}9*CollectionPct`,
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

  // Asset-class-aware KPI tiles. Income deals show NOI / Cap Rate /
  // DSCR / Cash-on-Cash / Reversion. Development deals show Revenue /
  // Cost / Net CF / Gross Margin / Min DSCR / Equity CF.
  const kpiCells = ctx.dealFamily === 'income'
    ? [
        // Top row — operating fundamentals
        { row: 4, col: 'A', label: 'Stabilised NOI (INR Cr / yr)',  formula: `=${phasing}!${totalCol}18*4`,                                                                       format: NUMBER_FORMATS.currency },
        { row: 4, col: 'C', label: 'Modeled Cap Rate',              formula: `=IFERROR(${phasing}!${totalCol}18*4/(LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr),0)`, format: NUMBER_FORMATS.percent },
        { row: 4, col: 'E', label: 'Exit Cap Rate',                 formula: `=ExitCapRate`,                                                                                       format: NUMBER_FORMATS.percent },
        // Bottom row — investor returns
        { row: 7, col: 'A', label: 'Min DSCR',                      formula: `=${cashflow}!${totalCol}10`,                                                                         format: NUMBER_FORMATS.multiple },
        { row: 7, col: 'C', label: 'Cash-on-Cash (Yr 1)',           formula: `=IFERROR(${cashflow}!C9/((LandCostCr+ConstructionCostPerSqft*SaleableAreaSqft/10000000+ApprovalCostCr)*(1-DebtLTV)),0)`, format: NUMBER_FORMATS.percent },
        { row: 7, col: 'E', label: 'Net Sale Proceeds (INR Cr)',    formula: `=${cashflow}!${totalCol}11`,                                                                         format: NUMBER_FORMATS.currency },
      ]
    : [
        { row: 4, col: 'A', label: 'Total Revenue (INR Cr)',         formula: `=${phasing}!${totalCol}9`,                                                                       format: NUMBER_FORMATS.currency },
        { row: 4, col: 'C', label: 'Total Project Cost (INR Cr)',     formula: `=-${cashflow}!${totalCol}6+(-${cashflow}!${totalCol}7)`,                                          format: NUMBER_FORMATS.currency },
        { row: 4, col: 'E', label: 'Project Net Cash Flow (INR Cr)', formula: `=${cashflow}!${totalCol}8`,                                                                        format: NUMBER_FORMATS.currency },
        { row: 7, col: 'A', label: 'Gross Margin',                    formula: `=IFERROR(${cashflow}!${totalCol}8/${phasing}!${totalCol}9,0)`,                                    format: NUMBER_FORMATS.percent },
        { row: 7, col: 'C', label: 'Min DSCR',                        formula: `=${cashflow}!${totalCol}13`,                                                                      format: NUMBER_FORMATS.multiple },
        { row: 7, col: 'E', label: 'Equity Cash Flow (INR Cr)',       formula: `=${cashflow}!${totalCol}12`,                                                                      format: NUMBER_FORMATS.currency },
      ];
  kpiCells.forEach(({ row, col, label, formula, format }) => {
    const labelCell = sheet.getCell(`${col}${row}`);
    labelCell.value = label;
    labelCell.font = { name: FONT, size: 9, color: { argb: palette.xlsx('mutedHigh') }, bold: true };
    labelCell.alignment = { horizontal: 'left' };
    labelCell.fill = FILL(palette.xlsx('paper'));
    labelCell.protection = { locked: true };
    const valueCell = sheet.getCell(`${String.fromCharCode(col.charCodeAt(0) + 1)}${row}`);
    valueCell.value = { formula };
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
  sheet.getCell('A19').value = 'Returns';
  styleSectionTitle(sheet.getCell('A19'));
  sheet.getRow(19).height = 22;

  const returnsCells = [
    { row: 20, col: 'A', label: 'Project IRR (modeled)', formula: `=IFERROR(IRR(${cfRangeProper})*4,"–")`, format: NUMBER_FORMATS.percent },
    { row: 20, col: 'C', label: 'NPV (INR Cr)',          formula: `=IFERROR(NPV((1+DiscountRatePct)^(1/4)-1,${cfRangeProper}),0)`, format: NUMBER_FORMATS.currency },
    { row: 20, col: 'E', label: 'Equity Multiple',       formula: `=IFERROR((SUMIF(${cfRangeProper},">0"))/ABS(SUMIF(${cfRangeProper},"<0")),"–")`, format: NUMBER_FORMATS.multiple },
  ];
  returnsCells.forEach(({ row, col, label, formula, format }) => {
    const labelCell = sheet.getCell(`${col}${row}`);
    labelCell.value = label;
    labelCell.font = { name: FONT, size: 9, color: { argb: palette.xlsx('mutedHigh') }, bold: true };
    labelCell.alignment = { horizontal: 'left' };
    labelCell.fill = FILL(palette.xlsx('paper'));
    labelCell.protection = { locked: true };
    const valueCell = sheet.getCell(`${String.fromCharCode(col.charCodeAt(0) + 1)}${row}`);
    valueCell.value = { formula };
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

  // Cost Build occupies rows 12-19:
  //   R12 Land · R13 Construction · R14 Approvals · R15 Hard subtotal
  //   R16 Marketing · R17 Finance · R18 Soft subtotal · R19 Total project cost
  writeBlock('Cost Build', [
    ['Land cost (INR Cr)',           '=LandCostCr',                                     'From Inputs & Assumptions'],
    ['Construction cost (INR Cr)',   '=ConstructionCostPerSqft*SaleableAreaSqft/10000000', 'Construction rate × saleable area'],
    ['Approval & fees (INR Cr)',     '=ApprovalCostCr',                                 'From Inputs & Assumptions'],
    ['Hard cost subtotal',           '=B12+B13+B14',                                    'Land + Construction + Approvals'],
    ['Marketing & sales (INR Cr)',   '=B8*MarketingCostPct',                            'Total revenue × MarketingCostPct'],
    ['Finance / treasury (INR Cr)',  '=B8*FinanceCostPct',                              'Total revenue × FinanceCostPct'],
    ['Soft cost subtotal',           '=B16+B17',                                        'Marketing + Finance'],
    ['Total project cost (INR Cr)',  '=B15+B18',                                        'Hard + Soft costs'],
  ]);

  // Debt Sculpting occupies rows 21-27:
  //   R22 LTV · R23 Total debt · R24 Equity · R25 Annual interest
  //   R26 Quarterly accrual · R27 Per-sqft proxy
  writeBlock('Debt Sculpting', [
    ['Debt LTV (% of cost)',         '=DebtLTV',                                        'From Inputs & Assumptions'],
    ['Total debt envelope (INR Cr)', '=B19*DebtLTV',                                    'Total project cost × LTV'],
    ['Equity envelope (INR Cr)',     '=B19*(1-DebtLTV)',                                'Total project cost × (1-LTV)'],
    ['Annualised interest cost',     '=B23*DebtRatePct',                                'Debt envelope × rate (peak proxy)'],
    ['Quarterly interest accrual',   '=B25/4',                                          'Annualised ÷ 4 (sanity check vs Cash Flow row 10)'],
    ['Effective debt cost / unit',   '=B25/SaleableAreaSqft*10000000',                  'Per-sqft cost-of-capital proxy (Cr → INR ÷ sqft)'],
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

  // 2. Quarterly Trend column chart — anchored BELOW the data table
  //    (table is rows 37-53). Asset-class-aware series names.
  const trendQuarters = Math.min(ctx.totalQuarters, 16);
  const trendEndRow = 37 + trendQuarters;
  if (trendQuarters >= 2) {
    const series = ctx.dealFamily === 'income'
      ? [
        { name: 'PGI (Cr)', valuesRange: `$B$38:$B$${trendEndRow}`, colour: '0E1B2C' },
        { name: 'NOI (Cr)', valuesRange: `$D$38:$D$${trendEndRow}`, colour: '0F7B5A' },
      ]
      : [
        { name: 'Sales (Cr)',        valuesRange: `$B$38:$B$${trendEndRow}`, colour: '0F7B5A' },
        { name: 'Construction (Cr)', valuesRange: `$C$38:$C$${trendEndRow}`, colour: 'B23A48' },
      ];
    specs.push({
      type: 'bar',
      barDir: 'col',
      title: ctx.dealFamily === 'income'
        ? 'Quarterly Operating Trend — PGI vs NOI'
        : 'Quarterly Project Trend — Sales vs Construction',
      sheetName: dashName,
      categoriesRange: `$A$38:$A$${trendEndRow}`,
      series,
      anchor: { fromCol: 0, fromRow: trendEndRow + 1, widthCols: 13, heightRows: 14 },
    });
  }

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
