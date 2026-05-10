'use strict';

const ExcelJS = require('exceljs');
const { buildDealWorkbookV2, __internal } = require('../src/services/exports/xlsx/v2/buildWorkbook');

const minimalContext = () => ({
  deal: {
    id: 1,
    name: 'Whitefield Phase 2',
    asset_class: 'residential_apartments',
    deal_type: 'jv',
    city: 'Bengaluru',
    state: 'Karnataka',
    project_duration_months: 36,
    model_params: {
      inputs: {
        sellingRatePerSqft: 12000,
        salesVelocityPct: 0.18,
        customerCollectionPct: 0.85,
        landCostCr: 80,
        constructionCostPerSqft: 4500,
        approvalCostCr: 8,
        marketingCostPct: 0.04,
        financeCostPct: 0.02,
        gstPct: 0.05,
        stampDutyPct: 0.05,
        debtLTV: 0.55,
        debtRatePct: 0.115,
        moratoriumMonths: 6,
        discountRatePct: 0.16,
        developerMarginPct: 0.22,
        constructionLagQuarters: 1,
        salesLagQuarters: 0,
      },
    },
  },
  property: {
    property_name: 'Whitefield Phase 2',
    city: 'Bengaluru',
    micro_market: 'Whitefield',
    land_area_sqft: 280000,
    saleable_area_sqft: 420000,
    existing_fsi: 1.5,
    property_type: 'residential_apartments',
  },
});

describe('services/exports/xlsx/v2/buildWorkbook', () => {
  describe('buildContext', () => {
    test('clamps quarters to [4, 32] driven by project duration', () => {
      const a = __internal.buildContext({ ...minimalContext(), deal: { ...minimalContext().deal, project_duration_months: 1 } });
      expect(a.totalQuarters).toBe(4);
      const b = __internal.buildContext({ ...minimalContext(), deal: { ...minimalContext().deal, project_duration_months: 200 } });
      expect(b.totalQuarters).toBe(32);
      const c = __internal.buildContext(minimalContext());
      expect(c.totalQuarters).toBe(12);
    });

    test('uses brandName / generatedAt overrides', () => {
      const ctx = __internal.buildContext(minimalContext(), {
        brandName: 'TestCo',
        generatedAt: '2026-05-10T00:00:00Z',
      });
      expect(ctx.brandName).toBe('TestCo');
      expect(ctx.generatedAt).toBe('2026-05-10T00:00:00Z');
    });

    test('infers asset class from deal + property combination', () => {
      const ctx = __internal.buildContext(minimalContext());
      expect(ctx.assetClass).toBe('residential_apartments');
    });
  });

  describe('buildDealWorkbookV2', () => {
    test('returns a non-empty Buffer with the .xlsx ZIP signature', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext(), {
        brandName: 'REDIP',
        generatedAt: '2026-05-10T00:00:00Z',
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(2000);
      // .xlsx files are ZIP archives — signature 'PK'
      expect(buffer.slice(0, 2).toString('ascii')).toBe('PK');
    });

    test('produced workbook contains the four visible sheets + hidden Calculations sheet', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const names = wb.worksheets.map((ws) => ws.name);
      expect(names).toEqual([
        'Inputs & Assumptions',
        'Phasing & Sales Collection',
        'Quarterly Cash Flow & Debt',
        'Dashboard',
        'Calculations',
      ]);
      const calc = wb.getWorksheet('Calculations');
      expect(calc).toBeDefined();
      // Hidden by default — power users right-click → Unhide
      expect(calc.state).toBe('hidden');
    });

    test('Calculations sheet carries the audit-trail blocks', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const calc = wb.getWorksheet('Calculations');
      const text = [];
      calc.eachRow((row) => row.eachCell((cell) => {
        if (typeof cell.value === 'string') text.push(cell.value);
      }));
      const joined = text.join(' | ');
      expect(joined).toMatch(/Revenue Build/);
      expect(joined).toMatch(/Cost Build/);
      expect(joined).toMatch(/Debt Sculpting/);
      expect(joined).toMatch(/Returns Inputs/);
    });

    test('Dashboard renders Returns block (IRR / NPV / Equity Multiple) and Scenario strip', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const dash = wb.getWorksheet('Dashboard');
      const text = [];
      dash.eachRow((row) => row.eachCell((cell) => {
        if (typeof cell.value === 'string') text.push(cell.value);
      }));
      const joined = text.join(' | ');
      expect(joined).toMatch(/Returns/);
      expect(joined).toMatch(/Project IRR/);
      expect(joined).toMatch(/NPV/);
      expect(joined).toMatch(/Equity Multiple/);
      expect(joined).toMatch(/Sensitivity/);
      expect(joined).toMatch(/Scenario Comparison/);
      expect(joined).toMatch(/BULL CASE/);
      expect(joined).toMatch(/BEAR CASE/);
    });

    test('Inputs sheet has the input zone unlocked', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const inputs = wb.getWorksheet('Inputs & Assumptions');
      // Pick one input row by label match → its B-column cell should be unlocked
      let foundUnlocked = false;
      inputs.eachRow((row) => {
        const labelCell = row.getCell(1).value;
        if (typeof labelCell === 'string' && /Selling Rate per sqft/i.test(labelCell)) {
          const valCell = row.getCell(2);
          // ExcelJS represents protection.locked as boolean; default true
          if (valCell.protection && valCell.protection.locked === false) foundUnlocked = true;
        }
      });
      expect(foundUnlocked).toBe(true);
    });

    test('Cash Flow sheet has DSCR row with conditional formatting referenced', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const cf = wb.getWorksheet('Quarterly Cash Flow & Debt');
      // The DSCR label should appear in column A.
      let hasDscr = false;
      cf.eachRow((row) => {
        const v = row.getCell(1).value;
        if (typeof v === 'string' && v.toUpperCase().includes('DSCR')) hasDscr = true;
      });
      expect(hasDscr).toBe(true);
    });

    test('Dashboard sheet renders KPI labels and a Sources & Uses block', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const dash = wb.getWorksheet('Dashboard');
      const cells = [];
      dash.eachRow((row) => {
        row.eachCell((cell) => cells.push(typeof cell.value === 'string' ? cell.value : ''));
      });
      const text = cells.join(' | ');
      expect(text).toMatch(/Total Revenue/);
      expect(text).toMatch(/Sources & Uses/);
      expect(text).toMatch(/Source: Equity/);
      expect(text).toMatch(/Use: Land/);
    });

    test('survives a mostly-empty exportContext without throwing', async () => {
      const buffer = await buildDealWorkbookV2({ deal: { name: 'Empty Deal' }, property: {} });
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(2000);
    });

    test('income asset (commercial_office) renders Operating P&L with PGI / EGR / NOI rows', async () => {
      const ctx = minimalContext();
      ctx.deal.asset_class = 'commercial_office';
      ctx.deal.name = 'Whitefield Office Park';
      ctx.property.property_type = 'commercial_office';
      ctx.deal.model_params.inputs = {
        ...ctx.deal.model_params.inputs,
        baseRentPerSqftMonth: 95,
        rentEscalationPct: 0.05,
        occupancyPct: 0.92,
        vacancyPct: 0.05,
        propertyTaxPct: 0.015,
        insurancePct: 0.01,
        propMgmtPct: 0.03,
        utilitiesPct: 0.04,
        maintenancePct: 0.05,
        capExReservePct: 0.02,
        exitCapRate: 0.075,
        loanTermYears: 7,
      };
      const buffer = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);

      const phasing = wb.getWorksheet('Phasing & Sales Collection');
      expect(phasing).toBeDefined();
      const phasingText = [];
      phasing.eachRow((row) => row.eachCell((cell) => {
        if (typeof cell.value === 'string') phasingText.push(cell.value);
      }));
      const phasingJoined = phasingText.join(' | ');
      // Income-asset rows
      expect(phasingJoined).toMatch(/PGI/);
      expect(phasingJoined).toMatch(/EGR/);
      expect(phasingJoined).toMatch(/NOI/);
      expect(phasingJoined).toMatch(/Property Tax/);
      expect(phasingJoined).toMatch(/CapEx Reserves/);
      // Title is asset-aware
      expect(phasingJoined).toMatch(/Lease-up & Operating/);

      const dash = wb.getWorksheet('Dashboard');
      const dashText = [];
      dash.eachRow((row) => row.eachCell((cell) => {
        if (typeof cell.value === 'string') dashText.push(cell.value);
      }));
      const dashJoined = dashText.join(' | ');
      // Income KPI tiles
      expect(dashJoined).toMatch(/Stabilised NOI/);
      expect(dashJoined).toMatch(/Modeled Cap Rate/);
      expect(dashJoined).toMatch(/Cash-on-Cash/);
    }, 30000);

    test('development asset (residential_apartments) keeps Sales Collection rows', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext()); // residential_apartments default
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const phasing = wb.getWorksheet('Phasing & Sales Collection');
      const text = [];
      phasing.eachRow((row) => row.eachCell((cell) => {
        if (typeof cell.value === 'string') text.push(cell.value);
      }));
      const joined = text.join(' | ');
      expect(joined).toMatch(/Construction cost/);
      expect(joined).toMatch(/Customer collection/);
      expect(joined).toMatch(/Construction Phasing & Sales/);
      // Should NOT have income-asset rows
      expect(joined).not.toMatch(/PGI/);
      expect(joined).not.toMatch(/Property Tax/);
    }, 30000);

    test('Dashboard renders Quarterly Operating Trend table with asset-aware columns', async () => {
      // Income deal — should show PGI / EGR / NOI / CF After Debt columns
      const incomeCtx = minimalContext();
      incomeCtx.deal.asset_class = 'commercial_office';
      incomeCtx.deal.name = 'Office Tower';
      const buf1 = await buildDealWorkbookV2(incomeCtx);
      const wb1 = new ExcelJS.Workbook();
      await wb1.xlsx.load(buf1);
      const dash1 = wb1.getWorksheet('Dashboard');
      const text1 = [];
      dash1.eachRow((row) => row.eachCell((cell) => {
        if (typeof cell.value === 'string') text1.push(cell.value);
      }));
      const joined1 = text1.join(' | ');
      expect(joined1).toMatch(/Quarterly Operating Trend/);
      expect(joined1).toMatch(/PGI \(Cr\)/);
      expect(joined1).toMatch(/NOI \(Cr\)/);
      expect(joined1).toMatch(/CF After Debt/);

      // Development deal — should show Sales / Construction / Net CF / Cumulative columns
      const devCtx = minimalContext();
      const buf2 = await buildDealWorkbookV2(devCtx);
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(buf2);
      const dash2 = wb2.getWorksheet('Dashboard');
      const text2 = [];
      dash2.eachRow((row) => row.eachCell((cell) => {
        if (typeof cell.value === 'string') text2.push(cell.value);
      }));
      const joined2 = text2.join(' | ');
      expect(joined2).toMatch(/Quarterly Project Trend/);
      expect(joined2).toMatch(/Sales \(Cr\)/);
      expect(joined2).toMatch(/Construction \(Cr\)/);
      expect(joined2).toMatch(/Cumulative \(Cr\)/);
    }, 30000);

    test('Dashboard renders JV profit waterfall when deal_structure is JV/JDA/DA', async () => {
      const ctx = minimalContext();
      ctx.deal.deal_structure = 'jv';
      ctx.deal.jv_split_developer_pct = 60;
      ctx.deal.jv_split_landowner_pct = 40;
      const buf = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const dash = wb.getWorksheet('Dashboard');
      const text = [];
      dash.eachRow((row) => row.eachCell((cell) => {
        if (typeof cell.value === 'string') text.push(cell.value);
      }));
      const joined = text.join(' | ');
      expect(joined).toMatch(/Profit Waterfall/);
      expect(joined).toMatch(/Total Project Profit/);
      expect(joined).toMatch(/Developer Share/);
      expect(joined).toMatch(/Landowner Share/);
    }, 30000);

    test('Dashboard hides JV waterfall when deal_structure is outright', async () => {
      const ctx = minimalContext();
      ctx.deal.deal_structure = 'outright';
      const buf = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const dash = wb.getWorksheet('Dashboard');
      const text = [];
      dash.eachRow((row) => row.eachCell((cell) => {
        if (typeof cell.value === 'string') text.push(cell.value);
      }));
      const joined = text.join(' | ');
      expect(joined).not.toMatch(/Profit Waterfall/);
    }, 30000);

    test('all sheets are unprotected (operator can edit any cell)', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      // ExcelJS exposes sheet protection via worksheet.sheetProtection
      // (only set when protect() was called). We removed all protect()
      // calls, so this property should be undefined or empty on every
      // visible sheet.
      const visibleSheets = wb.worksheets.filter((ws) => ws.state !== 'hidden');
      visibleSheets.forEach((ws) => {
        // sheetProtection.sheet === true would mean protection is active
        const isProtected = ws.sheetProtection && ws.sheetProtection.sheet === true;
        expect(isProtected).toBeFalsy();
      });
    });
  });
});
