'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const ExcelJS = require('exceljs');
const { buildDealWorkbookXlsx, __testables } = require('../src/services/dealXlsx.service');

const createDevelopmentContext = () => ({
  deal: {
    id: 101,
    name: 'Gattahalli Apartments',
    property_name: 'Gattahalli Apartments',
    city: 'Bengaluru',
    micro_market: 'Gattahalli',
    deal_type: 'jv',
    asset_class: 'residential_apartments',
    total_revenue_cr: 210,
    total_cost_cr: 162,
    model_params: {
      inputs: {
        plotAreaSqft: 120000,
        saleableAreaSqft: 185000,
        builtUpAreaSqft: 160000,
        units: 164,
        sellingRatePerSqft: 12500,
        pricingEscalationPct: 0.03,
        customerCollectionPct: 0.94,
        constructionCostPerSqft: 3300,
        landCostCr: 48,
        approvalCostCr: 6.5,
        marketingCostPct: 0.035,
        financeCostPct: 0.025,
        gstPct: 0.05,
        stampDutyPct: 0.01,
        projectDurationMonths: 36,
        debtLTV: 0.55,
        debtRatePct: 0.115,
        discountRatePct: 0.14,
        developerMarginPct: 0.22,
      },
    },
  },
  property: {
    city: 'Bengaluru',
    micro_market: 'Gattahalli',
    land_area_sqft: 120000,
    saleable_area_sqft: 185000,
    built_up_area_sqft: 160000,
    property_type: 'residential',
  },
  risks: {
    recommendation: {
      label: 'Proceed With Conditions',
    },
  },
  cashFlows: {
    yearly: [
      { label: 'Year 1', net: -62 },
      { label: 'Year 2', net: -28 },
      { label: 'Year 3', net: 74 },
      { label: 'Year 4', net: 126 },
    ],
  },
});

const createRetailContext = () => ({
  deal: {
    id: 202,
    name: 'Commercial Retail',
    property_name: 'Commercial Retail',
    city: 'Bengaluru',
    micro_market: 'Whitefield',
    deal_type: 'acquisition',
    asset_class: 'retail',
    model_params: {
      inputs: {
        leasableAreaSqft: 98000,
        builtUpAreaSqft: 112000,
        baseRentPerSqftMonth: 118,
        occupancyPct: 0.91,
        vacancyPct: 0.05,
        rentEscalationPct: 0.05,
        constructionCostPerSqft: 650,
        landCostCr: 126,
        approvalCostCr: 4,
        opexPct: 0.16,
        debtCoverage: 0.6,
        interestRatePct: 0.105,
        moratoriumMonths: 6,
        exitCapRate: 0.0825,
        holdPeriodYears: 5,
        discountRatePct: 0.12,
      },
    },
  },
  property: {
    city: 'Bengaluru',
    micro_market: 'Whitefield',
    saleable_area_sqft: 98000,
    built_up_area_sqft: 112000,
    property_type: 'retail',
  },
  risks: {
    recommendation: {
      label: 'Proceed',
    },
  },
  cashFlows: {
    yearly: [
      { label: 'Year 1', net: -130 },
      { label: 'Year 2', net: 8 },
      { label: 'Year 3', net: 10 },
      { label: 'Year 4', net: 11 },
      { label: 'Year 5', net: 152 },
    ],
  },
});

describe('dealXlsx.service', () => {
  test('builds development assumptions and phasing context for apartment deals', () => {
    const context = __testables.buildWorkbookContext(createDevelopmentContext(), {
      brandName: 'REDIP',
      generatedAt: '2026-04-15T10:00:00Z',
    });

    const assumptions = __testables.buildAssumptionDefinitions(context);
    const keys = assumptions.map((item) => item.key);

    expect(context.phasingSheetName).toBe(__testables.SHEETS.phasingDevelopment);
    expect(keys).toContain('sell_rate_psf');
    expect(keys).toContain('construction_cost_psf');
    expect(keys).toContain('developer_margin_pct');
  });

  test('creates a valid institutional workbook for an income-producing retail deal', async () => {
    const buffer = await buildDealWorkbookXlsx(createRetailContext(), {
      brandName: 'REDIP',
      userName: 'Test Analyst',
      generatedAt: '2026-04-15T10:00:00Z',
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      '00_Cover',
      '01_Executive_Summary',
      '02_Key_Assumptions',
      '03_Scenarios',
      '04_Area_Unit_Mix',
      '05_Revenue',
      '06_Costs',
      '07_Lease_Phasing',
      '08_Cash_Flow',
      '09_Debt_and_Security',
      '10_Returns',
      '11_Sensitivity',
      '12_Charts',
      '13_Audit_Checks',
    ]);

    expect(workbook.getWorksheet('02_Key_Assumptions').getCell('F4').formula).toBeTruthy();
    expect(workbook.getWorksheet('05_Revenue').getCell('C4').formula).toMatch(/saleable_area_sqft|02_Key_Assumptions/);
    expect(workbook.getWorksheet('07_Lease_Phasing').getCell('C6').formula).toContain('05_Revenue');
    expect(workbook.getWorksheet('08_Cash_Flow').getCell('C10').formula).toContain('SUM');
    expect(workbook.getWorksheet('10_Returns').getCell('C8').formula).toContain('IRR');
    expect(workbook.getWorksheet('01_Executive_Summary').getCell('B5').formula).toContain('10_Returns');
  });

  test('returns a real xlsx zip buffer in a plain node runtime', () => {
    const script = `
      const { buildDealWorkbookXlsx } = require('./src/services/dealXlsx.service');
      const exportContext = ${JSON.stringify(createDevelopmentContext())};
      (async () => {
        const buffer = await buildDealWorkbookXlsx(exportContext, {
          brandName: 'REDIP',
          userName: 'Test User',
          generatedAt: '2026-04-15T10:00:00Z',
        });
        process.stdout.write(JSON.stringify({
          isBuffer: Buffer.isBuffer(buffer),
          signature: buffer.slice(0, 2).toString('utf8'),
          length: buffer.length,
        }));
      })().catch((error) => {
        console.error(error);
        process.exit(1);
      });
    `;

    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
    });
    const result = JSON.parse(output);

    expect(result.isBuffer).toBe(true);
    expect(result.signature).toBe('PK');
    expect(result.length).toBeGreaterThan(5000);
  });
});
