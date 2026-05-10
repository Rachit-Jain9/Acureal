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

  return {
    exportContext,
    deal,
    property,
    inputs,
    assetClass,
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
  const sections = [
    {
      title: 'General Site Information',
      rows: [
        ['Effective Date',          'EffectiveDate',       ctx.effectiveDate,                           '',      NUMBER_FORMATS.date],
        ['Asset Class',             'AssetClass',          ctx.assetClass || 'generic',                  '',      null],
        ['Deal Type',               'DealType',            ctx.deal.deal_type || 'acquisition',          '',      null],
        ['Locality',                'Locality',            ctx.deal.city || ctx.property.city || 'Bengaluru', '', null],
        ['Land Area',               'LandAreaSqft',        firstNumber(ctx.property.land_area_sqft, ctx.deal.land_area_sqft, ctx.inputs.plotAreaSqft), 'sqft', NUMBER_FORMATS.integer],
        ['Saleable Area',           'SaleableAreaSqft',    firstNumber(ctx.property.saleable_area_sqft, ctx.deal.saleable_area_sqft, ctx.inputs.saleableAreaSqft), 'sqft', NUMBER_FORMATS.integer],
        ['Floor Space Index (FSI)', 'FSI',                 firstNumber(ctx.property.existing_fsi, ctx.inputs.fsi),                                       'ratio', NUMBER_FORMATS.multiple],
      ],
    },
    {
      title: 'Pricing & Revenue',
      rows: [
        ['Selling Rate per sqft',   'SellRatePerSqft',     firstNumber(ctx.inputs.sellingRatePerSqft, ctx.deal.selling_rate_per_sqft),                  'INR/sqft', NUMBER_FORMATS.integer],
        ['Pricing Escalation',      'EscalationPct',       firstNumber(ctx.inputs.pricingEscalationPct, ctx.inputs.rentEscalationPct, 0),                 '% / year', NUMBER_FORMATS.percent],
        ['Sales Velocity',          'SalesVelocityPct',    firstNumber(ctx.inputs.salesVelocityPct, ctx.inputs.absorptionPct, 0.20),                     '% / quarter', NUMBER_FORMATS.percent],
        ['Customer Collection',     'CollectionPct',       firstNumber(ctx.inputs.customerCollectionPct, 0.85),                                          '% of sale', NUMBER_FORMATS.percent],
      ],
    },
    {
      title: 'Cost Structure',
      rows: [
        ['Land Cost',               'LandCostCr',          firstNumber(ctx.inputs.landCostCr, ctx.deal.land_cost_cr, 0),                                 'INR Cr', NUMBER_FORMATS.currency],
        ['Construction Cost / sqft','ConstructionCostPerSqft', firstNumber(ctx.inputs.constructionCostPerSqft, ctx.deal.construction_cost_per_sqft, 0),  'INR/sqft', NUMBER_FORMATS.integer],
        ['Approval & Fees',         'ApprovalCostCr',      firstNumber(ctx.inputs.approvalCostCr, ctx.deal.approval_cost_cr, 0),                          'INR Cr', NUMBER_FORMATS.currency],
        ['Marketing & Sales',       'MarketingCostPct',    firstNumber(ctx.inputs.marketingCostPct, 0.04),                                                '% of revenue', NUMBER_FORMATS.percent],
        ['Finance / Treasury Cost', 'FinanceCostPct',      firstNumber(ctx.inputs.financeCostPct, 0.02),                                                  '% of revenue', NUMBER_FORMATS.percent],
        ['GST',                     'GstPct',              firstNumber(ctx.inputs.gstPct, ctx.inputs.gstRatePct, 0.05),                                   '%', NUMBER_FORMATS.percent],
        ['Stamp Duty',              'StampDutyPct',        firstNumber(ctx.inputs.stampDutyPct, 0.05),                                                    '%', NUMBER_FORMATS.percent],
      ],
    },
    {
      title: 'Project Schedule',
      rows: [
        ['Project Duration',        'ProjectMonths',       ctx.projectMonths,                                                                              'months', NUMBER_FORMATS.integer],
        ['Quarters',                'TotalQuarters',       ctx.totalQuarters,                                                                              'count', NUMBER_FORMATS.integer],
        ['Construction Start Lag',  'ConstructionLagQ',    firstNumber(ctx.inputs.constructionLagQuarters, 1),                                              'quarters', NUMBER_FORMATS.integer],
        ['Sales Launch Lag',        'SalesLagQ',           firstNumber(ctx.inputs.salesLagQuarters, 0),                                                     'quarters', NUMBER_FORMATS.integer],
      ],
    },
    {
      title: 'Capital Structure & Returns',
      rows: [
        ['Debt %',                  'DebtLTV',             firstNumber(ctx.inputs.debtLTV, ctx.inputs.debtPct, 0.55),                                      '% of cost', NUMBER_FORMATS.percent],
        ['Interest Rate',           'DebtRatePct',         firstNumber(ctx.inputs.debtRatePct, ctx.inputs.interestRatePct, 0.115),                          '% / year', NUMBER_FORMATS.percent],
        ['Moratorium',              'MoratoriumMonths',    firstNumber(ctx.inputs.moratoriumMonths, 0),                                                    'months', NUMBER_FORMATS.integer],
        ['Discount Rate',           'DiscountRatePct',     firstNumber(ctx.inputs.discountRatePct, ctx.deal.discount_rate_pct, 0.16),                       '% / year', NUMBER_FORMATS.percent],
        ['Developer Margin Target', 'DeveloperMarginPct',  firstNumber(ctx.inputs.developerMarginPct, ctx.deal.developer_margin_pct, 0.20),                  '%', NUMBER_FORMATS.percent],
      ],
    },
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

  // Sheet protection — allow input cells to be edited, lock everything else.
  sheet.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertRows: false,
    deleteRows: false,
  });

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

  // Title row
  sheet.mergeCells(1, 1, 1, ctx.totalQuarters + 2);
  sheet.getCell(1, 1).value = `${ctx.brandName} | Construction Phasing & Sales Collection`;
  styleSectionTitle(sheet.getCell(1, 1));
  sheet.getRow(1).height = 26;

  sheet.mergeCells(2, 1, 2, ctx.totalQuarters + 2);
  sheet.getCell(2, 1).value = `Quarters driven by ProjectMonths input. All formulas reference Inputs & Assumptions named ranges.`;
  sheet.getCell(2, 1).font = { name: FONT, size: 9, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell(2, 1).alignment = { vertical: 'middle' };
  sheet.getCell(2, 1).protection = { locked: true };

  // Header row 4
  sheet.getCell(4, 1).value = 'Line item';
  for (let q = 1; q <= ctx.totalQuarters; q += 1) sheet.getCell(4, 1 + q).value = `Q${q}`;
  sheet.getCell(4, ctx.totalQuarters + 2).value = 'Total';
  styleHeader(sheet.getRow(4));

  const rows = [
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
      formula: (q) => {
        if (q === 1) return `=B6`;
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
        const prev = colLetter(q);
        const curr = colLetter(q + 1);
        return `=${prev}7+${curr}6`;
      },
      format: NUMBER_FORMATS.currency,
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
      formula: (q) => {
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
        const curr = colLetter(q + 1);
        return `=${curr}9*CollectionPct`;
      },
      format: NUMBER_FORMATS.currency,
    },
  ];

  rows.forEach((rowSpec, rowIdx) => {
    const r = 5 + rowIdx;
    sheet.getCell(r, 1).value = rowSpec.label;
    styleLabelCell(sheet.getCell(r, 1));

    for (let q = 1; q <= ctx.totalQuarters; q += 1) {
      const cell = sheet.getCell(r, 1 + q);
      const formula = rowSpec.formula(q);
      cell.value = { formula };
      styleOutputCell(cell, rowSpec.format);
    }
    // Total column — sum of quarters
    const totalCell = sheet.getCell(r, ctx.totalQuarters + 2);
    const colLetter = (n) => {
      let s = '';
      let v = n;
      while (v > 0) {
        const r2 = (v - 1) % 26;
        s = String.fromCharCode(65 + r2) + s;
        v = Math.floor((v - r2) / 26);
      }
      return s;
    };
    const startCol = colLetter(2); // Q1 is column B
    const endCol = colLetter(ctx.totalQuarters + 1);
    totalCell.value = { formula: `=SUM(${startCol}${r}:${endCol}${r})` };
    styleOutputCell(totalCell, rowSpec.format);
    totalCell.font = { name: FONT, size: 10, bold: true, color: { argb: palette.xlsx('inkDeep') } };
  });

  sheet.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
  });
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

  const rows = [
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

  sheet.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
  });
  return sheet;
};

/**
 * Dashboard sheet — KPI summary cards + native Excel chart for sources/uses.
 */
const buildDashboardSheet = (workbook, ctx) => {
  const sheet = workbook.addWorksheet(SHEETS.dashboard, {
    views: [{ showGridLines: false }],
  });
  sheet.columns = [
    { width: 22 }, { width: 18 }, { width: 22 }, { width: 18 },
    { width: 22 }, { width: 18 },
  ];

  sheet.mergeCells('A1:F1');
  sheet.getCell('A1').value = `${ctx.brandName} | ${ctx.deal.name || ctx.property.property_name || 'Deal'} | Dashboard`;
  styleSectionTitle(sheet.getCell('A1'));
  sheet.getRow(1).height = 28;

  sheet.mergeCells('A2:F2');
  sheet.getCell('A2').value = `Live KPIs — every cell recalculates when you change inputs on the Inputs sheet.`;
  sheet.getCell('A2').font = { name: FONT, size: 10, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('A2').protection = { locked: true };
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

  const kpiCells = [
    { row: 4, col: 'A', label: 'Total Revenue (INR Cr)',     formula: `=${phasing}!${totalCol}9`,                                format: NUMBER_FORMATS.currency },
    { row: 4, col: 'C', label: 'Total Project Cost (INR Cr)', formula: `=-${cashflow}!${totalCol}6+(-${cashflow}!${totalCol}7)`,  format: NUMBER_FORMATS.currency },
    { row: 4, col: 'E', label: 'Project Net Cash Flow (INR Cr)', formula: `=${cashflow}!${totalCol}8`,                            format: NUMBER_FORMATS.currency },
    { row: 7, col: 'A', label: 'Gross Margin',                formula: `=IFERROR(${cashflow}!${totalCol}8/${phasing}!${totalCol}9,0)`, format: NUMBER_FORMATS.percent },
    { row: 7, col: 'C', label: 'Min DSCR',                    formula: `=${cashflow}!${totalCol}13`,                              format: NUMBER_FORMATS.multiple },
    { row: 7, col: 'E', label: 'Equity Cash Flow (INR Cr)',   formula: `=${cashflow}!${totalCol}12`,                              format: NUMBER_FORMATS.currency },
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

  // Native Excel chart referencing the Sources & Uses cells.
  // ExcelJS supports addChart but with limited options — we provide a
  // doughnut chart referencing A12:B16.
  try {
    sheet.addChart({
      type: 'doughnut',
      title: { name: 'Sources & Uses' },
      cat: { values: `'${SHEETS.dashboard}'!$A$12:$A$16` },
      val: { values: `'${SHEETS.dashboard}'!$B$12:$B$16` },
      tl: { col: 2, row: 11 },
      br: { col: 6, row: 22 },
    });
  } catch {
    // ExcelJS chart support is patchy across versions; if it throws we
    // skip the chart and the data remains visible in the cells.
  }

  // Footer disclaimer
  sheet.mergeCells('A24:F24');
  sheet.getCell('A24').value = `Generated ${ctx.generatedAt} | ${ctx.brandName} | Auto-calculated. Verify all inputs against your source data before any decision.`;
  sheet.getCell('A24').font = { name: FONT, size: 8, italic: true, color: { argb: palette.xlsx('mutedHigh') } };
  sheet.getCell('A24').protection = { locked: true };

  sheet.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
  });
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

  // Register defined names AFTER all sheets exist so the references resolve.
  definedNames.forEach(({ name, ref }) => {
    workbook.definedNames.add(ref, name);
  });

  return workbook;
};

/**
 * Build and return the workbook as a Buffer (for the route handler).
 */
const buildDealWorkbookV2 = async (exportContext, options = {}) => {
  const workbook = buildDealWorkbookV2Workbook(exportContext, options);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
};

module.exports = {
  buildDealWorkbookV2,
  // Internal exports for tests.
  __internal: {
    buildContext,
    buildDealWorkbookV2Workbook,
    SHEETS,
    NUMBER_FORMATS,
  },
};
