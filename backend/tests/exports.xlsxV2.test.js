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

    // Regression: kernel stores some percents as integer (5 = 5%) and
    // others as decimal (0.05). Excel's `0.0%` cell format expects the
    // underlying value to be a decimal fraction — integer-stored values
    // render as 500%, AND formulas like `=Revenue*MarketingCostPct`
    // produce 5× revenue. toPctDecimal() normalizes both representations
    // to decimal at the input layer.
    test('toPctDecimal normalizes integer-percent inputs to decimal in cells', async () => {
      const ctx = minimalContext();
      // Mix integer- and decimal-stored percents — exactly the shape the
      // financial.service.js kernel actually emits today (defaults are
      // integer; some stored values are decimal).
      ctx.deal.model_params.inputs = {
        ...ctx.deal.model_params.inputs,
        marketingCostPct: 5,            // integer percent
        financeCostPct: 12,             // integer percent
        gstPct: 18,                     // integer percent
        stampDutyPct: 0.05,             // decimal percent
        contingencyPct: 4,              // integer percent
        debtRatePct: 12,                // integer percent
        discountRatePct: 14,            // integer percent
        developerMarginPct: 25,         // integer percent
        debtLTV: 0.5,                   // decimal — already correct
        customerCollectionPct: 0.85,    // decimal — already correct
      };
      const buffer = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const inputs = wb.getWorksheet('Inputs & Assumptions');

      // Every percent cell must hold the decimal-fraction value, no
      // matter whether the kernel handed it to us as integer or decimal.
      const expected = {
        'Marketing & Sales':       0.05,
        'Finance / Treasury Cost': 0.12,
        'Contingency':             0.04,
        'GST':                     0.18,
        'Stamp Duty':              0.05,
        'Debt %':                  0.50,
        'Interest Rate':           0.12,
        'Discount Rate':           0.14,
        'Developer Margin Target': 0.25,
        'Customer Collection':     0.85,
      };
      const actual = {};
      inputs.eachRow((row) => {
        const label = String(row.getCell(1).value || '').trim();
        if (Object.prototype.hasOwnProperty.call(expected, label)) {
          actual[label] = row.getCell(2).value;
        }
      });
      Object.entries(expected).forEach(([label, want]) => {
        expect(actual[label]).toBeCloseTo(want, 4);
      });
    });

    // Regression: cumulative rows in the Phasing sheet (construction cost
    // running total + customer collection running total) used to write
    // `=SUM(B:Y)` into the Total column. But those cells already contain
    // running cumulative values — SUM-ing them produces a triangular sum
    // (operator's roast: "Cumulative construction cost shows 3,198 Cr"
    // when actual project total is ~266 Cr). The fix: cumulative rows
    // get `totalKind: 'final'` and the Total cell references the LAST
    // quarter's cell instead of summing.
    test('cumulative rows in Phasing use final-value (not SUM) for the Total column', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const phasing = wb.getWorksheet('Phasing & Sales Collection');

      // Find the Total column (last column = column for q=totalQuarters+1)
      const formulaAt = (cellRef) => {
        const v = phasing.getCell(cellRef).value;
        return v && typeof v === 'object' && v.formula ? v.formula : null;
      };

      // For a 12-quarter project (minimal-context default): B=Q1..M=Q12,
      // N=Total. Cumulative rows must reference the LAST quarter cell
      // (=M{row}); non-cumulative rows still use SUM(B{row}:M{row}).
      expect(formulaAt('N7')).toMatch(/^=M7$/);     // cumulative construction
      expect(formulaAt('N12')).toMatch(/^=M12$/);   // cumulative collection
      expect(formulaAt('N6')).toMatch(/^=SUM\(B6:M6\)$/);   // per-quarter construction
      expect(formulaAt('N9')).toMatch(/^=SUM\(B9:M9\)$/);   // per-quarter sales
    });

    // Regression: Dashboard headline "Total Revenue" used to pull from the
    // Phasing quarter-by-quarter sum (593 Cr for Jigani) while the
    // Calculations audit-trail sheet computed it as mid-period × full
    // saleable (648 Cr). Operator's roast: "headline numbers don't foot →
    // entire model unreliable." Both sheets now reference the same source.
    test('Calculations sheet Revenue reconciles with Dashboard Revenue', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);

      const dashCell = wb.getWorksheet('Dashboard').getCell('B4').value;
      const calcCell = wb.getWorksheet('Calculations').getCell('B8').value;
      const dashFormula = dashCell && typeof dashCell === 'object' ? dashCell.formula : null;
      const calcFormula = calcCell && typeof calcCell === 'object' ? calcCell.formula : null;

      // Both must reference the SAME Phasing cell — the Total column for
      // development-family row 9 (Quarter sales). The exact column letter
      // depends on `totalQuarters` (12 → N9 in the minimal context); the
      // critical assertion is that both Dashboard B4 and Calculations B8
      // point at the same cell so headlines reconcile.
      expect(dashFormula).toMatch(/'Phasing & Sales Collection'!([A-Z]+)9/);
      expect(calcFormula).toMatch(/'Phasing & Sales Collection'!([A-Z]+)9/);
      const dashCol = dashFormula.match(/'Phasing & Sales Collection'!([A-Z]+)9/)[1];
      const calcCol = calcFormula.match(/'Phasing & Sales Collection'!([A-Z]+)9/)[1];
      expect(dashCol).toBe(calcCol);
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

    // Regression: previously these cells contained off-by-one row references
    // that produced circular formulas (e.g. "Hard cost subtotal = B13+B14+B15"
    // self-referencing its own cell, "Annualised interest = B25*DebtRatePct"
    // self-referencing). Excel surfaced this as a "circular reference" warning
    // on file open and zero values throughout the audit trail. Lock the
    // intended row references in.
    // Native chart objects were absent from every previous v2 build —
    // ExcelJS 4.4.0 has no `addChart` API (verified empirically). The
    // chart-injector now post-processes the buffer to splice in chart
    // XML matching the operator's reference template pack
    // (REDIP_India_Template_*.xlsx, openpyxl-generated). When a Dashboard
    // is built, the output buffer must contain at least one chart entry
    // under xl/charts/ and a drawing on the Dashboard sheet referencing
    // those charts.
    test('Dashboard ships native chart objects via post-write injection', async () => {
      const JSZip = require('jszip');
      const buffer = await buildDealWorkbookV2(minimalContext());
      const zip = await JSZip.loadAsync(buffer);

      // Chart XML files present
      const chartFiles = Object.keys(zip.files).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n));
      expect(chartFiles.length).toBeGreaterThanOrEqual(1);

      // Drawing file present + references each chart
      const drawingXml = await zip.file('xl/drawings/drawing1.xml').async('string');
      expect(drawingXml).toMatch(/<xdr:oneCellAnchor>/);

      // Dashboard sheet references the drawing
      const sheetXml = await zip.file('xl/worksheets/sheet4.xml').async('string');
      expect(sheetXml).toMatch(/<drawing\s+r:id="rId\d+"\s*\/>/);

      // Sheet rels include the drawing rel
      const sheetRels = await zip.file('xl/worksheets/_rels/sheet4.xml.rels').async('string');
      expect(sheetRels).toMatch(/drawings\/drawing1\.xml/);

      // Content types declares each chart + the drawing
      const contentTypes = await zip.file('[Content_Types].xml').async('string');
      expect(contentTypes).toMatch(/\/xl\/drawings\/drawing1\.xml/);
      expect(contentTypes).toMatch(/\/xl\/charts\/chart1\.xml/);
    });

    // The Uses Breakdown doughnut always renders. The Quarterly Trend
    // bar renders when totalQuarters >= 2 (which it always is in our
    // test contexts since the minimum is 4).
    test('Dashboard charts include a doughnut (Uses) + a column bar (Quarterly Trend)', async () => {
      const JSZip = require('jszip');
      const buffer = await buildDealWorkbookV2(minimalContext());
      const zip = await JSZip.loadAsync(buffer);

      const chartFiles = Object.keys(zip.files).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n));
      const xmls = await Promise.all(chartFiles.map((n) => zip.file(n).async('string')));

      // At least one doughnut + at least one bar chart
      expect(xmls.some((x) => x.includes('<c:doughnutChart'))).toBe(true);
      expect(xmls.some((x) => x.includes('<c:barChart'))).toBe(true);

      // The doughnut targets the Uses cells (Dashboard!A14:A16 / B14:B16)
      const doughnut = xmls.find((x) => x.includes('<c:doughnutChart'));
      expect(doughnut).toMatch(/\$A\$14:\$A\$16/);
      expect(doughnut).toMatch(/\$B\$14:\$B\$16/);
    });

    // Asset-class branching for the trend chart: development deals show
    // Sales vs Construction; income deals show PGI vs NOI. The series
    // labels are emitted into the chart XML.
    test('Quarterly Trend chart series labels switch by asset family', async () => {
      const JSZip = require('jszip');
      // Development deal — series should be Sales + Construction
      const devBuffer = await buildDealWorkbookV2(minimalContext());
      const devZip = await JSZip.loadAsync(devBuffer);
      const devChartFiles = Object.keys(devZip.files).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n));
      const devXmls = await Promise.all(devChartFiles.map((n) => devZip.file(n).async('string')));
      const devBar = devXmls.find((x) => x.includes('<c:barChart'));
      expect(devBar).toMatch(/Sales \(Cr\)/);
      expect(devBar).toMatch(/Construction \(Cr\)/);

      // Income deal — series should be PGI + NOI
      const incomeCtx = minimalContext();
      incomeCtx.deal.asset_class = 'commercial_office';
      const incomeBuffer = await buildDealWorkbookV2(incomeCtx);
      const incomeZip = await JSZip.loadAsync(incomeBuffer);
      const incomeChartFiles = Object.keys(incomeZip.files).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n));
      const incomeXmls = await Promise.all(incomeChartFiles.map((n) => incomeZip.file(n).async('string')));
      const incomeBar = incomeXmls.find((x) => x.includes('<c:barChart'));
      expect(incomeBar).toMatch(/PGI \(Cr\)/);
      expect(incomeBar).toMatch(/NOI \(Cr\)/);
    });

    test('Calculations sheet subtotal + debt formulas have no self-references', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const calc = wb.getWorksheet('Calculations');

      const formulaAt = (cellRef) => {
        const v = calc.getCell(cellRef).value;
        return v && typeof v === 'object' && v.formula ? v.formula : null;
      };

      // Cost Build (rows 12–19)
      expect(formulaAt('B15')).toBe('=B12+B13+B14');          // Hard cost = Land + Construction + Approvals
      expect(formulaAt('B18')).toBe('=B16+B17');              // Soft cost = Marketing + Finance
      expect(formulaAt('B19')).toBe('=B15+B18');              // Total cost = Hard + Soft

      // Debt Sculpting (rows 22–27)
      expect(formulaAt('B23')).toBe('=B19*DebtLTV');          // Total debt envelope
      expect(formulaAt('B24')).toBe('=B19*(1-DebtLTV)');      // Equity envelope
      expect(formulaAt('B25')).toBe('=B23*DebtRatePct');      // Annualised interest
      expect(formulaAt('B26')).toBe('=B25/4');                // Quarterly accrual
      expect(formulaAt('B27')).toBe('=B25/SaleableAreaSqft*10000000'); // Per-sqft proxy

      // None of those formulas should reference their own cell
      ['B15', 'B18', 'B19', 'B23', 'B24', 'B25', 'B26', 'B27'].forEach((cellRef) => {
        const formula = formulaAt(cellRef) || '';
        expect(formula).not.toMatch(new RegExp(`\\b${cellRef}\\b`));
      });
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
