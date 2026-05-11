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
        'Amortization Schedule',
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
    // PR-C: standalone Amortization Schedule sheet — quarter-by-quarter
    // debt amortization with Beginning / Payment / Interest / Principal /
    // Ending Balance columns. Standard component of every institutional
    // pro forma (NAIOP + RE-540 both have explicit amortization sheets).
    test('Amortization Schedule sheet renders loan terms + quarter-by-quarter amort table', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const amort = wb.getWorksheet('Amortization Schedule');
      expect(amort).toBeDefined();

      // Loan Terms block at rows 4-10
      const a4 = amort.getCell('A4').value;
      expect(String(a4)).toMatch(/Loan Terms/);

      // Loan Amount cell B5 — formula references named ranges
      const b5 = amort.getCell('B5').value;
      expect(b5).toBeTruthy();
      expect(b5.formula).toContain('DebtLTV');
      expect(b5.formula).toContain('LandCostCr');

      // Quarterly Rate cell B9 — (1+annual)^(1/4) - 1
      const b9 = amort.getCell('B9').value;
      expect(b9.formula).toMatch(/\(1\+DebtRatePct\)\^\(1\/4\)-1/);

      // Quarterly Payment cell B10 — PMT formula
      const b10 = amort.getCell('B10').value;
      expect(b10.formula).toMatch(/PMT\(B9,B8,B5\)/);

      // Header row at row 12
      expect(String(amort.getCell('A12').value)).toBe('Period');
      expect(String(amort.getCell('B12').value)).toBe('Beginning Balance');
      expect(String(amort.getCell('C12').value)).toBe('Payment');
      expect(String(amort.getCell('D12').value)).toBe('Interest');
      expect(String(amort.getCell('E12').value)).toBe('Principal');
      expect(String(amort.getCell('F12').value)).toBe('Ending Balance');

      // Row 13 (Period 1): Beginning Balance = $B$5 (Loan Amount)
      const b13 = amort.getCell('B13').value;
      expect(b13.formula).toBe('=$B$5');

      // Row 14 (Period 2): Beginning Balance = previous-row Ending Balance
      const b14 = amort.getCell('B14').value;
      expect(b14.formula).toMatch(/F13/);

      // Interest formula = Beginning × Quarterly Rate
      const d13 = amort.getCell('D13').value;
      expect(d13.formula).toContain('B13*$B$9');

      // Ending Balance = MAX(Beginning - Principal, 0) — guards against
      // negative balance in the final period
      const f13 = amort.getCell('F13').value;
      expect(f13.formula).toContain('MAX(B13-E13,0)');
    });

    // PR-A institutional-grade soft cost breakdown: reference pro formas
    // (NAIOP, RE-540) break soft costs into ~8 distinct line items.
    // Previous generator collapsed everything into Marketing + Finance.
    // This regression test asserts the 6 new soft cost line items exist
    // on the Inputs sheet (as named ranges + cells), on the Phasing sheet
    // (as scheduled-by-quarter rows 13-19), and on the Calculations sheet
    // Cost Build block (as the expanded rows 16-23 + new soft subtotal).
    test('Inputs sheet exposes 6 detailed soft cost named ranges', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);

      // ExcelJS exposes defined-name targets via wb.definedNames.matrixMap
      const allDefined = JSON.stringify(wb.definedNames);
      for (const name of ['ArchitectFeePct', 'LegalFeePct', 'AppraisalFeePct',
        'InsuranceConstPct', 'PropTaxConstPct', 'DeveloperOverheadPct']) {
        expect(allDefined).toContain(name);
      }
    });

    test('Phasing sheet renders 7 detailed soft cost rows (rows 13-19) for development family', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const phasing = wb.getWorksheet('Phasing & Sales Collection');

      // Row 13 = A&E; row 14 = Legal; row 15 = Appraisal; row 16 = Insurance during Const;
      // row 17 = Property Taxes during Const; row 18 = Developer Overhead; row 19 = Total Detailed.
      const labels = [
        [13, 'A&E spend'],
        [14, 'Legal fees spend'],
        [15, 'Appraisal & title spend'],
        [16, 'Insurance during construction'],
        [17, 'Property taxes during construction'],
        [18, 'Developer overhead'],
        [19, 'Total Detailed Soft Costs'],
      ];
      for (const [row, expectedLabelPrefix] of labels) {
        const labelCell = phasing.getCell(`A${row}`).value;
        const labelStr = labelCell && typeof labelCell === 'object' && labelCell.richText
          ? labelCell.richText.map((r) => r.text).join('')
          : String(labelCell || '');
        expect(labelStr).toContain(expectedLabelPrefix);
      }

      // Each soft cost row Q1 (column B) carries a formula referencing
      // the appropriate named range
      const b13 = phasing.getCell('B13').value;
      expect(b13.formula).toContain('ArchitectFeePct');
      const b16 = phasing.getCell('B16').value;
      expect(b16.formula).toContain('InsuranceConstPct');
      const b17 = phasing.getCell('B17').value;
      expect(b17.formula).toContain('PropTaxConstPct');
      const b17Formula = b17.formula;
      // Property taxes apply to LandCostCr (Karnataka method), not hard cost
      expect(b17Formula).toContain('LandCostCr');

      // Row 19 total = sum of rows 13-18
      const b19 = phasing.getCell('B19').value;
      expect(b19.formula).toMatch(/=B13\+B14\+B15\+B16\+B17\+B18/);
    });

    test('Calculations Cost Build now shows 14 rows including 8-line-item soft cost breakdown', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const calc = wb.getWorksheet('Calculations');

      // Verify the expanded Cost Build labels exist
      const text = [];
      calc.eachRow((row) => row.eachCell((cell) => {
        if (typeof cell.value === 'string') text.push(cell.value);
      }));
      const joined = text.join(' | ');
      expect(joined).toMatch(/A&E fees/);
      expect(joined).toMatch(/Legal fees/);
      expect(joined).toMatch(/Appraisal & title/);
      expect(joined).toMatch(/Insurance during construction/);
      expect(joined).toMatch(/Property taxes during construction/);
      expect(joined).toMatch(/Developer overhead/);

      // Soft cost subtotal (row 24) sums all 8 line items
      const b24 = calc.getCell('B24').value;
      expect(b24.formula).toBe('=B16+B17+B18+B19+B20+B21+B22+B23');
    });

    // Regression: customer collection used to compute as
    // `=B9*CollectionPct` for each quarter — same-quarter as the sale.
    // For Indian residential this is wrong (RERA / construction-milestone-
    // linked payment schedule means collection follows construction). The
    // bug produced a front-loaded-positive cash-flow profile and a
    // negative IRR despite positive net cumulative cash flow (operator's
    // roast verified: IRR -15% on a 593 Cr revenue project with 30%
    // gross margin).
    //
    // The fix: collection_q = totalContractedSales × CollectionPct ×
    // constructionThisQuarter / totalConstruction. Each quarter's
    // collection mirrors construction progress proportionally.
    // Regression: Dashboard headline KPIs (Total Revenue, Total Cost,
    // Gross Margin, IRR, NPV, Equity Multiple, etc.) used to be FORMULA
    // recomputes from the Phasing + Cash Flow sheets — divergent from
    // the kernel-stored values on the deal record, which is what the
    // Reports page in the frontend displays. Per CLAUDE.md, the kernel
    // is the single source of numerics for any export. The fix: when
    // the deal record carries a kernel value, write it as a literal in
    // the Dashboard cell; otherwise fall back to the formula recompute.
    test('Dashboard KPI tiles use kernel-stored values when populated', async () => {
      const ctx = minimalContext();
      ctx.deal = {
        ...ctx.deal,
        irr_pct: 13.6,
        npv_cr: -3.89,
        equity_multiple: 1.55,
        gross_margin_pct: 30.6,
        total_revenue_cr: 637.01,
        total_cost_cr: 442.04,
        residual_land_value_cr: 227.37,
      };
      const buffer = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const dash = wb.getWorksheet('Dashboard');

      // Total Revenue (B4) — kernel value, NOT a formula
      const b4 = dash.getCell('B4').value;
      expect(typeof b4).toBe('number');
      expect(b4).toBeCloseTo(637.01, 2);

      // Total Project Cost (D4) — kernel value
      const d4 = dash.getCell('D4').value;
      expect(typeof d4).toBe('number');
      expect(d4).toBeCloseTo(442.04, 2);

      // Net CF (F4) — derived from kernel revenue/cost (literal)
      const f4 = dash.getCell('F4').value;
      expect(typeof f4).toBe('number');
      expect(f4).toBeCloseTo(637.01 - 442.04, 2);

      // Gross Margin (B7) — kernel value, converted to decimal for 0.0% format
      const b7 = dash.getCell('B7').value;
      expect(typeof b7).toBe('number');
      expect(b7).toBeCloseTo(0.306, 4);

      // Min DSCR (D7) — no kernel field, stays as formula
      const d7 = dash.getCell('D7').value;
      expect(typeof d7).toBe('object');
      expect(d7.formula).toBeTruthy();

      // Project IRR (kernel) at row 20 — must be the literal kernel value
      const b20 = dash.getCell('B20').value;
      expect(typeof b20).toBe('number');
      expect(b20).toBeCloseTo(0.136, 4);

      // NPV (kernel) at row 20 — literal
      const d20 = dash.getCell('D20').value;
      expect(typeof d20).toBe('number');
      expect(d20).toBeCloseTo(-3.89, 2);

      // Equity Multiple (kernel) — literal
      const f20 = dash.getCell('F20').value;
      expect(typeof f20).toBe('number');
      expect(f20).toBeCloseTo(1.55, 2);

      // Row 21 — the modeled (sensitivity-run) IRR/NPV/EM stays as
      // formulas so operator can edit Inputs and see them recompute.
      const b21 = dash.getCell('B21').value;
      expect(typeof b21).toBe('object');
      expect(b21.formula).toMatch(/IRR\(/);
      const d21 = dash.getCell('D21').value;
      expect(typeof d21).toBe('object');
      expect(d21.formula).toMatch(/NPV\(/);
    });

    test('Dashboard KPI tiles fall back to formula when kernel value is missing', async () => {
      // Deal record without any kernel-computed KPIs
      const ctx = minimalContext();
      delete ctx.deal.irr_pct;
      delete ctx.deal.npv_cr;
      delete ctx.deal.equity_multiple;
      delete ctx.deal.gross_margin_pct;
      delete ctx.deal.total_revenue_cr;
      delete ctx.deal.total_cost_cr;
      delete ctx.deal.residual_land_value_cr;

      const buffer = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const dash = wb.getWorksheet('Dashboard');

      // Every KPI tile should be a formula (no kernel literals)
      for (const ref of ['B4', 'D4', 'F4', 'B7', 'F7', 'B20', 'D20', 'F20']) {
        const v = dash.getCell(ref).value;
        expect(typeof v).toBe('object');
        expect(v.formula).toBeTruthy();
      }
    });

    test('customer collection follows construction progress (RERA-milestone-linked, not same-quarter)', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const phasing = wb.getWorksheet('Phasing & Sales Collection');

      // Row 10 = Customer collection. Pick Q5 (col F) as the test cell.
      const f10 = phasing.getCell('F10').value;
      const formula = f10 && typeof f10 === 'object' ? f10.formula : null;

      // Must reference SUM of all sales (not just same-quarter sales)
      expect(formula).toMatch(/SUM\(\$B\$9:\$[A-Z]+\$9\)/);
      // Must reference SUM of all construction
      expect(formula).toMatch(/SUM\(\$B\$6:\$[A-Z]+\$6\)/);
      // Must reference THIS quarter's construction cell (col F, row 6)
      expect(formula).toMatch(/F6/);
      // Must multiply by CollectionPct named range
      expect(formula).toMatch(/CollectionPct/);
      // Must NOT use the old `=F9*CollectionPct` shape
      expect(formula).not.toMatch(/^=F9\*CollectionPct$/);
    });

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
    test('Dashboard charts include doughnut + combo + tornado', async () => {
      const JSZip = require('jszip');
      const buffer = await buildDealWorkbookV2(minimalContext());
      const zip = await JSZip.loadAsync(buffer);

      const chartFiles = Object.keys(zip.files).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n));
      const xmls = await Promise.all(chartFiles.map((n) => zip.file(n).async('string')));

      // Three charts on the Dashboard now
      expect(chartFiles.length).toBeGreaterThanOrEqual(3);

      // 1) Doughnut for Uses Breakdown
      expect(xmls.some((x) => x.includes('<c:doughnutChart'))).toBe(true);

      // 2) Combo (barChart + lineChart in one plotArea) for Quarterly Trend
      const comboChart = xmls.find((x) =>
        x.includes('<c:barChart>') && x.includes('<c:lineChart>')
      );
      expect(comboChart).toBeDefined();
      // Two value axes (left for bars, right for cumulative line)
      const valAxes = (comboChart.match(/<c:valAx>/g) || []).length;
      expect(valAxes).toBe(2);

      // 3) Tornado (horizontal bar with overlap=100) for Driver Impact
      const tornado = xmls.find((x) =>
        x.includes('<c:barDir val="bar"/>') && x.includes('<c:overlap val="100"/>')
      );
      expect(tornado).toBeDefined();
      // Tornado references the H/I/J columns where the driver data lives
      expect(tornado).toMatch(/\$H\$25:\$H\$26/);  // categories (driver labels)
      expect(tornado).toMatch(/\$I\$25:\$I\$26/);  // low-case deltas
      expect(tornado).toMatch(/\$J\$25:\$J\$26/);  // high-case deltas

      // Doughnut targets the Uses cells
      const doughnut = xmls.find((x) => x.includes('<c:doughnutChart'));
      expect(doughnut).toMatch(/\$A\$14:\$A\$16/);
      expect(doughnut).toMatch(/\$B\$14:\$B\$16/);
    });

    test('Dashboard tornado data table emits two driver rows with delta formulas', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const dash = wb.getWorksheet('Dashboard');

      // Row 24 = headers
      expect(String(dash.getCell('H24').value)).toBe('Driver');
      expect(String(dash.getCell('I24').value)).toBe('Low Case Δ');
      expect(String(dash.getCell('J24').value)).toBe('High Case Δ');

      // Row 25 = Selling Rate driver
      expect(String(dash.getCell('H25').value)).toContain('Selling Rate');
      // Low delta = grid[middle row][leftmost col] - base = B27 - D27
      expect(dash.getCell('I25').value.formula).toBe('=B27-D27');
      // High delta = grid[middle row][rightmost col] - base = F27 - D27
      expect(dash.getCell('J25').value.formula).toBe('=F27-D27');

      // Row 26 = Construction Cost driver
      expect(String(dash.getCell('H26').value)).toContain('Construction Cost');
      // High cost = low margin → I26 (low delta) = D29 - D27
      expect(dash.getCell('I26').value.formula).toBe('=D29-D27');
      // Low cost = high margin → J26 (high delta) = D25 - D27
      expect(dash.getCell('J26').value.formula).toBe('=D25-D27');
    });

    // Asset-class branching for the trend chart: development deals show
    // Sales vs Construction; income deals show PGI vs NOI. The series
    // labels are emitted into the chart XML.
    test('Quarterly Trend combo-chart series labels switch by asset family', async () => {
      const JSZip = require('jszip');
      // Development deal — bar series should be Sales + Construction;
      // line series should be Cumulative Net CF
      const devBuffer = await buildDealWorkbookV2(minimalContext());
      const devZip = await JSZip.loadAsync(devBuffer);
      const devChartFiles = Object.keys(devZip.files).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n));
      const devXmls = await Promise.all(devChartFiles.map((n) => devZip.file(n).async('string')));
      const devCombo = devXmls.find((x) => x.includes('<c:barChart') && x.includes('<c:lineChart'));
      expect(devCombo).toBeDefined();
      expect(devCombo).toMatch(/Sales \(Cr\)/);
      expect(devCombo).toMatch(/Construction \(Cr\)/);
      expect(devCombo).toMatch(/Cumulative Net CF \(Cr\)/);

      // Income deal — bar series should be PGI + NOI; line should be CF After Debt
      const incomeCtx = minimalContext();
      incomeCtx.deal.asset_class = 'commercial_office';
      const incomeBuffer = await buildDealWorkbookV2(incomeCtx);
      const incomeZip = await JSZip.loadAsync(incomeBuffer);
      const incomeChartFiles = Object.keys(incomeZip.files).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n));
      const incomeXmls = await Promise.all(incomeChartFiles.map((n) => incomeZip.file(n).async('string')));
      const incomeCombo = incomeXmls.find((x) => x.includes('<c:barChart') && x.includes('<c:lineChart'));
      expect(incomeCombo).toBeDefined();
      expect(incomeCombo).toMatch(/PGI \(Cr\)/);
      expect(incomeCombo).toMatch(/NOI \(Cr\)/);
      expect(incomeCombo).toMatch(/CF After Debt/);
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

      // Cost Build (rows 12–25 — expanded for the detailed soft cost
      // breakdown PR). Hard subtotal at R15, soft subtotal at R24,
      // total project cost at R25.
      expect(formulaAt('B15')).toBe('=B12+B13+B14');                      // Hard cost = Land + Construction + Approvals
      expect(formulaAt('B24')).toBe('=B16+B17+B18+B19+B20+B21+B22+B23');  // Soft cost = all 8 line items
      expect(formulaAt('B25')).toBe('=B15+B24');                          // Total cost = Hard + Soft

      // Debt Sculpting (rows 28–33). Total debt envelope refs B25
      // (Total project cost in the expanded Cost Build).
      expect(formulaAt('B29')).toBe('=B25*DebtLTV');                      // Total debt envelope
      expect(formulaAt('B30')).toBe('=B25*(1-DebtLTV)');                  // Equity envelope
      expect(formulaAt('B31')).toBe('=B29*DebtRatePct');                  // Annualised interest
      expect(formulaAt('B32')).toBe('=B31/4');                            // Quarterly accrual
      expect(formulaAt('B33')).toBe('=B31/SaleableAreaSqft*10000000');    // Per-sqft proxy

      // None of those formulas should reference their own cell.
      ['B15', 'B24', 'B25', 'B29', 'B30', 'B31', 'B32', 'B33'].forEach((cellRef) => {
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
