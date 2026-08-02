'use strict';

// Generates a matrix of real workbooks and audits each. Heavy CPU + IO, same
// defensive timeout the sibling realism suite uses.
jest.setTimeout(120000);

/**
 * Workbook name/reference integrity across the asset-class matrix.
 *
 * THE GAP THIS CLOSES. Excel evaluates the model's ~4,400 formulas, not Node.
 * The existing suites read `cell.value.result` — the number the KERNEL cached
 * at write time — so a formula can be broken while the cached number is right,
 * and every test passes while the customer opens a sheet full of #NAME?.
 *
 * It has shipped. `buildWorkbook.js` documents `RERAEscrowPct` going out that
 * way: an inputs section skipped for some deals while the Cash Flow Engine
 * referenced the name unconditionally, producing a "#NAME? cascade" fixed by
 * hand on 2026-07-17. Auditing the generator on 2026-08-02 found two more live
 * instances of the identical pattern:
 *
 *   ExitCapRatePct     declared only in the HOSPITALITY inputs variant, but the
 *                      sensitivity grid builds `MAX(0.04,ExitCapRatePct+...)`
 *                      for every income deal -> 4 broken cells per workbook.
 *   LandownerSharePct  declared only for DEVELOPMENT family, but the
 *                      Calculations sheet computes marketing and finance cost
 *                      as `...*(1-LandownerSharePct)` unconditionally -> 2
 *                      broken cells on every income workbook.
 *
 * A defect patched one instance at a time is a defect with no guard. This is
 * the guard: the matrix below covers both families and every structure the
 * conditional sections branch on, so the next unconditional reference to a
 * conditionally-declared name fails CI instead of reaching an investor.
 */

const ExcelJS = require('exceljs');
const { buildDealWorkbookV2 } = require('../src/services/exports/xlsx/v2/buildWorkbook');
const { auditWorkbook, describeFinding } = require('../src/services/exports/xlsx/v2/workbookIntegrity');

const baseInputs = {
  saleableAreaSqft: 525000,
  baseRentPerSqftMonth: 110,
  landCostCr: 95,
  constructionCostPerSqft: 6800,
  exitCapRate: 0.08,
  occupancyPct: 0.92,
  vacancyPct: 0.08,
  rentEscalationPct: 0.05,
  propertyTaxPerSqftYr: 40,
  sellingPricePerSqft: 9500,
};

const makeCtx = (assetClass, dealStructure, extra = {}) => ({
  deal: {
    id: `integrity-${assetClass}-${dealStructure}`,
    name: `Integrity ${assetClass} ${dealStructure}`,
    asset_class: assetClass,
    deal_structure: dealStructure,
    exit_strategy: 'strategic_sale',
    city: 'Bengaluru',
    state: 'Karnataka',
    project_duration_months: 60,
    irr_pct: 0.137,
    npv_cr: 28.5,
    equity_multiple: 1.82,
    noi_cr: 42.1,
    exit_value_cr: 525,
    yield_on_cost_pct: 0.084,
    model_params: { inputs: { assetClass, ...baseInputs, ...extra } },
  },
});

// Both families, and every structure the conditional inputs sections branch on.
// Hospitality is included explicitly because it is the ONLY asset class that
// used to declare ExitCapRatePct — without it the matrix would have looked
// green while every other income workbook was broken.
const MATRIX = [
  ['commercial_office', 'outright_purchase'],
  ['commercial_office', 'jda_revenue_share'],
  ['retail', 'outright_purchase'],
  ['industrial_warehousing', 'outright_purchase'],
  ['hospitality', 'outright_purchase'],
  ['residential_apartments', 'outright_purchase'],
  ['residential_apartments', 'jda_revenue_share'],
  ['residential_apartments', 'jda_area_share'],
  ['plotted_development', 'outright_purchase'],
  ['plotted_development', 'jda_revenue_share'],
  ['villas', 'outright_purchase'],
  ['mixed_use', 'outright_purchase'],
];

const auditFor = async (assetClass, dealStructure) => {
  const buffer = await buildDealWorkbookV2(makeCtx(assetClass, dealStructure));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return auditWorkbook(workbook);
};

describe('every generated workbook resolves every name and sheet it references', () => {
  test.each(MATRIX)('%s / %s', async (assetClass, dealStructure) => {
    const report = await auditFor(assetClass, dealStructure);

    // Guards the guard: if the generator or the parser silently stopped seeing
    // formulas, an empty findings list would look like success.
    expect(report.formulaCount).toBeGreaterThan(500);
    expect(report.definedNameCount).toBeGreaterThan(50);

    if (report.findings.length > 0) {
      throw new Error(
        `${report.findings.length} integrity finding(s) in ${assetClass} / ${dealStructure}:\n  `
        + report.findings.map(describeFinding).join('\n  '),
      );
    }
  });
});

describe('the two names this suite was written for', () => {
  // Pinned by name. A future refactor that re-gates either section behind a
  // deal-family conditional reproduces the exact bug, and these say why.
  test('ExitCapRatePct is declared on a NON-hospitality income workbook', async () => {
    const report = await auditFor('commercial_office', 'outright_purchase');
    expect(report.findings.map((f) => f.identifier)).not.toContain('ExitCapRatePct');
  });

  test('LandownerSharePct is declared on an income workbook that has no landowner', async () => {
    // The Calculations sheet multiplies by (1 - LandownerSharePct) regardless
    // of structure; 0 collapses the factor to 1, which is the intended maths.
    const report = await auditFor('commercial_office', 'outright_purchase');
    expect(report.findings.map((f) => f.identifier)).not.toContain('LandownerSharePct');
  });
});

describe('the auditor itself', () => {
  const { extractCandidateNames, extractQuotedSheetRefs } = require('../src/services/exports/xlsx/v2/workbookIntegrity');

  test('does not mistake function calls for defined names', () => {
    expect(extractCandidateNames('=IFERROR(SUM(B1:B9),0)')).toEqual([]);
  });

  test('does not mistake cell or column references for defined names', () => {
    expect(extractCandidateNames('=$B$4+C12-SUM(A:A)')).toEqual([]);
  });

  test('ignores words inside string literals', () => {
    // Dashboard warning banners contain prose; without this every word in them
    // reads as an undefined name.
    expect(extractCandidateNames('=IF(B4=0,"Set SaleableAreaSqft on the Inputs sheet",B4)')).toEqual([]);
  });

  test('ignores sheet-qualified prefixes but still finds the sheet', () => {
    expect(extractCandidateNames("='Cash Flow Engine'!$B$18")).toEqual([]);
    expect(extractQuotedSheetRefs("='Cash Flow Engine'!$B$18")).toEqual(['Cash Flow Engine']);
  });

  test('finds a genuine defined-name reference', () => {
    expect(extractCandidateNames('=MAX(0.04,ExitCapRatePct+C7)')).toEqual(['ExitCapRatePct']);
  });

  test('reports one finding per distinct problem, not one per cell', async () => {
    // 4,000 formulas referencing one missing name is one bug.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    for (let r = 1; r <= 25; r += 1) sheet.getCell(`A${r}`).value = { formula: '=MadeUpName*2' };
    const report = auditWorkbook(workbook);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].type).toBe('undefined_name');
    expect(report.findings[0].identifier).toBe('MadeUpName');
  });

  test('catches a missing sheet and a literal #REF!', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    sheet.getCell('A1').value = { formula: "='Nope'!B1" };
    sheet.getCell('A2').value = { formula: '=#REF!+1' };
    const types = auditWorkbook(workbook).findings.map((f) => f.type);
    expect(types).toContain('missing_sheet');
    expect(types).toContain('ref_error');
  });
});
