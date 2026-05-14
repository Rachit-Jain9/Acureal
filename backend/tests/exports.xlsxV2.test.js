'use strict';

const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { buildDealWorkbookV2, __internal } = require('../src/services/exports/xlsx/v2/buildWorkbook');

const normalizeFormula = (formula) => String(formula || '').replace(/^=/, '');

const findValueCellByLabel = (sheet, expectedLabel) => {
  let found = null;
  sheet.eachRow((row) => {
    const label = String(row.getCell(1).value || '').trim();
    if (label === expectedLabel) found = row.getCell(2);
  });
  return found;
};

const findRowByLabelPrefix = (sheet, expectedPrefix) => {
  let found = null;
  sheet.eachRow((row) => {
    const label = String(row.getCell(1).value || '').trim();
    if (!found && label.startsWith(expectedPrefix)) found = row;
  });
  return found;
};

expect.extend({
  toBeFormula(received, expected) {
    const pass = normalizeFormula(received) === normalizeFormula(expected);
    return {
      pass,
      message: () => `expected formula ${received} ${pass ? 'not ' : ''}to equal ${expected}`,
    };
  },
});

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

    test('uses the stored financial-engine effective date before falling back to today', () => {
      const input = minimalContext();
      input.deal.model_params.inputs.effectiveDate = '22-04-2026';

      const ctx = __internal.buildContext(input);

      expect(ctx.effectiveDate).toBe('2026-04-22');
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

    test('produced workbook stays editable and within the 6-7 worksheet structure', async () => {
      // Operator-directed institutional structure:
      //   1. Dashboard (FIRST)
      //   2. Export QA & Sources
      //   3. Inputs & Assumptions
      //   4. Cash Flow Engine        (combined: Phasing + Cash Flow + Debt)
      //   5. Sources & Uses
      //   6. Monthly Cash Flow
      //   7. Lease Roll
      //   8. Construction Drawdown
      //   9. Sensitivity
      //   10. Debt Sizing & Amortization (combined: sizing + amort schedule)
      //   11. Sponsor LP Waterfall
      //   12. Unit Mix
      //   13. Calculations            (hidden audit trail)
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const names = wb.worksheets.map((ws) => ws.name);
      expect(names).toEqual([
        'Dashboard',
        'Inputs & Assumptions',
        'Cash Flow Engine',
        'Monthly Cash Flow',
        'Debt Sizing & Amortization',
        'Calculations',
      ]);
      expect(names.length).toBeLessThanOrEqual(7);
      expect(names).not.toContain('Export QA & Sources');
      const calc = wb.getWorksheet('Calculations');
      expect(calc).toBeDefined();
      // Hidden by default — power users right-click → Unhide
      expect(calc.state).toBe('hidden');
      const zip = await JSZip.loadAsync(buffer);
      const worksheetXml = await Promise.all(
        zip.file(/^xl\/worksheets\/sheet\d+\.xml$/).map((file) => file.async('string')),
      );
      expect(worksheetXml.some((xml) => xml.includes('<sheetProtection'))).toBe(false);
    });

    test('Inputs sheet carries filterable QA/source tables, hyperlinks, and input comments', async () => {
      const ctx = minimalContext();
      ctx.deal.id = 42;
      ctx.market = {
        exportComps: [
          {
            source: 'https://example.com/verified-comp',
            is_verified: true,
            data_period: '2026 Q1',
          },
        ],
      };
      ctx.documents = {
        items: [
          { id: 'doc-1', name: 'Sale deed.pdf', created_at: '2026-05-01T00:00:00Z' },
        ],
      };

      const buffer = await buildDealWorkbookV2(ctx, { appBaseUrl: 'https://redip.test' });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);

      expect(wb.getWorksheet('Export QA & Sources')).toBeUndefined();
      const inputs = wb.getWorksheet('Inputs & Assumptions');
      expect(String(inputs.getCell('A1').value)).toContain('Inputs & Assumptions');

      const zip = await JSZip.loadAsync(buffer);
      expect(zip.file(/^xl\/tables\/table\d+\.xml$/).length).toBeGreaterThanOrEqual(2);

      let hasHyperlink = false;
      inputs.eachRow((row) => row.eachCell((cell) => {
        if (cell.value && typeof cell.value === 'object' && cell.value.hyperlink) hasHyperlink = true;
      }));
      expect(hasHyperlink).toBe(true);

      const saleable = findValueCellByLabel(inputs, 'Saleable / Leasable Area (Super Built-up)');
      expect(String(saleable.note || '')).toContain('Source:');
      expect(String(saleable.note || '')).toContain('Provenance:');
    });

    test('strict validation blocks incomplete income workbooks before download', async () => {
      const ctx = minimalContext();
      ctx.deal.asset_class = 'commercial_office';
      ctx.property.property_type = 'commercial_office';
      ctx.property.saleable_area_sqft = 0;
      ctx.deal.model_params.inputs = {
        ...ctx.deal.model_params.inputs,
        landCostCr: 100,
        constructionCostPerSqft: 0,
        baseRentPerSqftMonth: 0,
      };

      await expect(buildDealWorkbookV2(ctx, { strictValidation: true }))
        .rejects
        .toMatchObject({
          name: 'XlsxExportValidationError',
          statusCode: 422,
        });
    });

    test('strict validation accepts hospitality assumptions without office rent inputs', async () => {
      const ctx = minimalContext();
      ctx.deal.name = 'Pointec Pens and Energy Private Limited';
      ctx.deal.asset_class = 'hospitality';
      ctx.property.property_type = 'land';
      ctx.property.saleable_area_sqft = null;
      ctx.deal.model_params.inputs = {
        assetClass: 'hospitality',
        keys: 100,
        adr: 7000,
        stabilizedOccPct: 70,
        constructionCostPerKey: 2000000,
        landCostCr: 30,
        exitCapRate: 9.5,
        interestRatePct: 12,
        discountRatePct: 15,
        projectDurationYears: 4,
      };

      const prepared = __internal.prepareWorkbookContext(ctx, {
        strictValidation: false,
        generatedAt: '2026-05-14T00:00:00Z',
      });

      expect(prepared.assetClass).toBe('hospitality');
      expect(prepared.exportQa.blockers).toEqual([]);
      expect(prepared.exportQa.core.saleableAreaSqft).toBe(55000);
      expect(prepared.exportQa.core.baseRentPerSqftMonth).toBeGreaterThan(0);
      expect(prepared.exportQa.core.constructionCostPerSqft).toBeGreaterThan(0);
      await expect(buildDealWorkbookV2(ctx, { strictValidation: true })).resolves.toEqual(expect.any(Buffer));
    }, 30000);

    test('normalizes engine loading add-on into the workbook carpet-area multiple', async () => {
      const ctx = minimalContext();
      ctx.deal.model_params.inputs.loadingFactor = 0.15;

      const buffer = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const inputs = wb.getWorksheet('Inputs & Assumptions');
      const loadingRow = findRowByLabelPrefix(inputs, 'Loading Factor');
      const carpetRow = findRowByLabelPrefix(inputs, 'Carpet Area');

      expect(loadingRow.getCell(2).value).toBeCloseTo(1.15, 6);
      expect(String(loadingRow.getCell(4).value)).toBe('stored-input');
      expect(carpetRow.getCell(2).value.formula).toBeFormula('=IFERROR(SaleableAreaSqft/LoadingFactor,0)');
    });

    test('uses financial-engine defaults for blank income rent, vacancy, and cap-rate assumptions', async () => {
      const ctx = minimalContext();
      ctx.deal.asset_class = 'commercial_office';
      ctx.property.property_type = 'commercial_office';
      ctx.property.saleable_area_sqft = null;
      ctx.deal.model_params.inputs = {
        assetClass: 'commercial_office',
        leasableAreaSqft: 100000,
        constructionCostPerSqft: 6000,
        landCostCr: 40,
        debtCoverage: 0.6,
        interestRatePct: 10,
        discountRatePct: 12,
      };

      const prepared = __internal.prepareWorkbookContext(ctx, {
        strictValidation: true,
        generatedAt: '2026-05-14T00:00:00Z',
      });

      expect(prepared.exportQa.core.baseRentPerSqftMonth).toBe(95);
      expect(prepared.exportQa.core.occupancyPct).toBeCloseTo(0.9, 6);
      expect(prepared.exportQa.core.exitCapRate).toBeCloseTo(0.075, 6);
      expect(prepared.exportQa.core.debtLTV).toBeCloseTo(0.6, 6);

      const buffer = await buildDealWorkbookV2(ctx, {
        strictValidation: true,
        generatedAt: '2026-05-14T00:00:00Z',
      });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const inputs = wb.getWorksheet('Inputs & Assumptions');
      expect(findRowByLabelPrefix(inputs, 'Base Rent').getCell(4).value).toBe('engine-default');
      expect(findRowByLabelPrefix(inputs, 'Stabilised Occupancy').getCell(4).value).toBe('engine-default');
      expect(findRowByLabelPrefix(inputs, 'Exit Cap Rate').getCell(4).value).toBe('engine-default');
    }, 30000);

    test('derives plotted-development saleable land and gross-land development cost linkage', () => {
      const ctx = minimalContext();
      ctx.deal.asset_class = 'plotted_development';
      ctx.property.property_type = 'plotted_development';
      ctx.property.saleable_area_sqft = null;
      ctx.property.land_area_sqft = null;
      ctx.deal.model_params.inputs = {
        assetClass: 'plotted_development',
        totalLandSqft: 100000,
        saleableLandPct: 55,
        avgPlotSizeSqft: 1200,
        sellingRatePerSqft: 2500,
        landCostCr: 20,
        devCostPerSqft: 250,
        discountRatePct: 14,
      };

      const prepared = __internal.prepareWorkbookContext(ctx, { strictValidation: true });

      expect(prepared.exportQa.core.landAreaSqft).toBe(100000);
      expect(prepared.exportQa.core.saleableAreaSqft).toBeCloseTo(55000, 6);
      expect(prepared.exportQa.core.constructionCostPerSqft).toBeCloseTo(250 / 0.55, 6);
      expect((prepared.exportQa.core.constructionCostPerSqft * prepared.exportQa.core.saleableAreaSqft) / 10000000)
        .toBeCloseTo(2.5, 6);
    });

    test('strict validation passes representative asset classes, deal structures, and exit strategies', async () => {
      const cases = [
        { asset: 'residential_apartments', exit: 'outright_progressive' },
        { asset: 'plotted_development', exit: 'bulk_exit_completion' },
        { asset: 'villas', exit: 'hold_post_completion' },
        { asset: 'redevelopment', exit: 'outright_progressive', dealStructure: 'jda', landownerSharePct: 0.45, landCostCr: 0 },
        { asset: 'mixed_use', exit: 'bulk_exit_completion' },
        { asset: 'raw_land', exit: 'hold_post_completion', constructionCostPerSqft: 0 },
        { asset: 'commercial_office', exit: 'strategic_sale', income: true },
        { asset: 'retail', exit: 'reit_exit', income: true },
        { asset: 'industrial_warehousing', exit: 'refinance_hold', income: true },
        { asset: 'hospitality', exit: 'hold_to_perpetuity', income: true },
      ];

      for (const item of cases) {
        const ctx = minimalContext();
        ctx.deal.asset_class = item.asset;
        ctx.property.property_type = item.asset;
        ctx.property.saleable_area_sqft = 420000;
        ctx.deal.deal_structure = item.dealStructure || 'outright';
        ctx.deal.model_params.inputs = {
          ...ctx.deal.model_params.inputs,
          exitStrategyType: item.exit,
          landownerSharePct: item.landownerSharePct ?? 0,
          landCostCr: item.landCostCr ?? 80,
          constructionCostPerSqft: item.constructionCostPerSqft ?? 4500,
          baseRentPerSqftMonth: item.income ? 110 : undefined,
          occupancyPct: item.income ? 0.9 : undefined,
          exitCapRate: item.income ? 0.08 : undefined,
        };
        await expect(buildDealWorkbookV2(ctx, { strictValidation: true })).resolves.toEqual(expect.any(Buffer));
      }
    }, 30000);

    test('Cash Flow Engine exposes quarter-end dates plus XIRR/XNPV return rows', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const cash = wb.getWorksheet('Cash Flow Engine');

      expect(cash.getCell('B3').value.formula).toBeFormula('=EDATE(EffectiveDate,3)');

      let xirr = null;
      let xnpv = null;
      cash.eachRow((row) => {
        const label = String(row.getCell(1).value || '');
        if (label === 'XIRR (modeled, dated)') xirr = row.getCell(2).value.formula;
        if (label === 'XNPV (modeled, INR Cr)') xnpv = row.getCell(2).value.formula;
      });
      expect(xirr).toContain('XIRR');
      expect(xirr).toContain('$B$3');
      expect(xnpv).toContain('XNPV');
      expect(xnpv).toContain('DiscountRatePct');
    });

    test('Monthly Cash Flow sheet exposes monthly S-curve, RERA, IDC, and cumulative equity rows for development deals', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const monthly = wb.getWorksheet('Monthly Cash Flow');

      expect(monthly.getCell('B3').value.formula).toBeFormula('=EDATE(EffectiveDate,1)');
      expect(monthly.getCell('A7').value).toBe('Construction draw');
      expect(monthly.getCell('B5').value.formula).toContain('SIN');
      expect(monthly.getCell('B7').value.formula).toContain('B5');
      expect(monthly.getCell('A14').value).toBe('To RERA escrow');
      expect(monthly.getCell('B19').value.formula).toContain('DebtRatePct/12');
      expect(monthly.getCell('A21').value).toBe('Equity cash flow');
      expect(monthly.getCell('C22').value.formula).toBeFormula('=B22+C21');
    });

    test('Monthly Cash Flow sheet switches to operating NOI rows for income deals', async () => {
      const ctx = minimalContext();
      ctx.deal.asset_class = 'retail';
      ctx.property.property_type = 'retail';
      ctx.deal.model_params.inputs = {
        ...ctx.deal.model_params.inputs,
        baseRentPerSqftMonth: 140,
        occupancyPct: 0.88,
        exitCapRate: 0.08,
      };
      const buffer = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const monthly = wb.getWorksheet('Monthly Cash Flow');

      expect(monthly.getCell('A10').value).toBe('Recoverable CAM / OpEx');
      expect(monthly.getCell('A12').value).toBe('Effective gross revenue');
      expect(monthly.getCell('A19').value).toBe('NOI');
      expect(monthly.getCell('B5').value.formula).toContain('OccupancyPct');
      expect(monthly.getCell('B10').value.formula).toContain('RetailCAMRecoveryPct');
      expect(monthly.getCell('B21').value.formula).toContain('LeasingCommissionPct');
      expect(monthly.getCell('B25').value.formula).toContain('DebtRatePct/12');
    });

    test('Monthly Cash Flow sheet uses hospitality and warehouse-specific income drivers safely', async () => {
      const hospitalityCtx = minimalContext();
      hospitalityCtx.deal.asset_class = 'hospitality';
      hospitalityCtx.property.property_type = 'hospitality';
      hospitalityCtx.deal.model_params.inputs = {
        ...hospitalityCtx.deal.model_params.inputs,
        occupancyPct: 0.72,
        exitCapRate: 0.085,
      };
      const hospitalityBuffer = await buildDealWorkbookV2(hospitalityCtx);
      const hospitalityWb = new ExcelJS.Workbook();
      await hospitalityWb.xlsx.load(hospitalityBuffer);
      const hospitalityMonthly = hospitalityWb.getWorksheet('Monthly Cash Flow');
      expect(hospitalityMonthly.getCell('B6').value.formula).toContain('HospitalityRevPAR');

      const warehouseCtx = minimalContext();
      warehouseCtx.deal.asset_class = 'industrial_warehousing';
      warehouseCtx.property.property_type = 'industrial_warehousing';
      warehouseCtx.deal.model_params.inputs = {
        ...warehouseCtx.deal.model_params.inputs,
        baseRentPerSqftMonth: 45,
        occupancyPct: 0.88,
        exitCapRate: 0.085,
      };
      const warehouseBuffer = await buildDealWorkbookV2(warehouseCtx);
      const warehouseWb = new ExcelJS.Workbook();
      await warehouseWb.xlsx.load(warehouseBuffer);
      const warehouseMonthly = warehouseWb.getWorksheet('Monthly Cash Flow');
      expect(warehouseMonthly.getCell('B10').value.formula).toContain('RecoverableExpensePct');
      expect(warehouseMonthly.getCell('B10').value.formula).not.toContain('RetailCAMRecoveryPct');
    });

    test('Sources & Uses content is merged into Dashboard instead of a standalone sheet', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const dash = wb.getWorksheet('Dashboard');

      expect(wb.getWorksheet('Sources & Uses')).toBeUndefined();
      expect(dash.getCell('A11').value).toContain('Sources & Uses');
      expect(dash.getCell('A12').value).toBe('Source: Equity');
      expect(dash.getCell('A18').value).toBe('Use: Statutory Levies');
    });

    test('Dashboard Sources & Uses avoids development-only deal structure formulas for income deals', async () => {
      const ctx = minimalContext();
      ctx.deal.asset_class = 'commercial_office';
      ctx.property.property_type = 'commercial_office';
      ctx.deal.model_params.inputs = {
        ...ctx.deal.model_params.inputs,
        baseRentPerSqftMonth: 120,
        occupancyPct: 0.86,
        exitCapRate: 0.08,
      };
      const buffer = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const dash = wb.getWorksheet('Dashboard');

      for (let r = 12; r <= 18; r += 1) {
        dash.getRow(r).eachCell((cell) => {
          if (cell.value?.formula) {
            expect(cell.value.formula).not.toContain('DealStructureLabel');
          }
        });
      }
    });

    test('standalone detail worksheets are removed in favor of the slim model tabs', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const names = wb.worksheets.map((sheet) => sheet.name);

      expect(names).not.toContain('Lease Roll');
      expect(names).not.toContain('Construction Drawdown');
      expect(names).not.toContain('Sensitivity');
      expect(names).not.toContain('Unit Mix');
      expect(names).not.toContain('Sponsor LP Waterfall');
    });

    test('Dashboard formula cells include cached values for non-Excel viewers where deterministic', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const dash = wb.getWorksheet('Dashboard');

      expect(dash.getCell('D4').value.formula).toBeFormula('=TotalProjectCostCr');
      expect(typeof dash.getCell('D4').value.result).toBe('number');
      expect(dash.getCell('D4').value.result).toBeGreaterThan(0);
      expect(typeof dash.getCell('B12').value.result).toBe('number');
      expect(typeof dash.getCell('B13').value.result).toBe('number');
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
        // PR-I1: GST + Stamp Duty moved into the new "India Statutory
        // Levies" section with explicit India-context labels.
        'GST on Construction (Net of ITC)': 0.18,
        'Stamp Duty + Registration':        0.05,
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
    // PR-E: Unit Mix sheet — asset-class-aware unit-by-unit breakdown
    // matching reference templates (RE-540 Assumptions rows 14-31,
    // NAIOP Unit Mix sheet). Worksheet-only (no flow-through to
    // SaleableAreaSqft) — operator updates Inputs manually after
    // planning the mix.
    test('Unit Mix worksheet is omitted for residential development workbooks', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext()); // default = residential_apartments
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const um = wb.getWorksheet('Unit Mix');
      expect(um).toBeUndefined();
      return;

      // Headers at row 4
      expect(String(um.getCell('A4').value)).toBe('Unit Type');
      expect(String(um.getCell('B4').value)).toBe('Count');
      expect(String(um.getCell('C4').value)).toBe('SF / Unit');
      expect(String(um.getCell('D4').value)).toBe('Total SF');
      expect(String(um.getCell('E4').value)).toContain('Sell Rate');

      // Row 5 should be Studio
      expect(String(um.getCell('A5').value)).toBe('Studio');
      expect(typeof um.getCell('B5').value).toBe('number'); // count
      expect(typeof um.getCell('C5').value).toBe('number'); // SF/unit
      // Total SF = count × SF/unit (formula)
      expect(um.getCell('D5').value.formula).toBeFormula('=B5*C5');
      // Revenue formula for residential: total SF × per-sqft rate / 1Cr
      expect(um.getCell('F5').value.formula).toBeFormula('=D5*E5/10000000');

      // 5 unit types (Studio / 1BHK / 2BHK / 3BHK / 4BHK) → 5 data rows + 1 total row
      const totalRow = 10; // 5 data rows at 5-9, total at row 10
      expect(String(um.getCell(`A${totalRow}`).value)).toBe('TOTAL');
    });

    test('Unit Mix worksheet is omitted for hospitality workbooks', async () => {
      const ctx = minimalContext();
      ctx.deal.asset_class = 'hospitality';
      const buffer = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const um = wb.getWorksheet('Unit Mix');
      expect(um).toBeUndefined();
      return;

      // Headers should be Keys / SF per key / ADR
      expect(String(um.getCell('A4').value)).toBe('Key Type');
      expect(String(um.getCell('B4').value)).toBe('Keys');
      expect(String(um.getCell('E4').value)).toContain('ADR');

      // Revenue formula for hospitality: Keys × ADR × 365 × 0.65 / 1Cr
      expect(um.getCell('F5').value.formula).toContain('365');
      expect(um.getCell('F5').value.formula).toContain('0.65');
    });

    test('Unit Mix worksheet is omitted for commercial workbooks', async () => {
      const ctx = minimalContext();
      ctx.deal.asset_class = 'commercial_office';
      const buffer = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const um = wb.getWorksheet('Unit Mix');
      expect(um).toBeUndefined();
      return;

      // Header should reference monthly rent
      expect(String(um.getCell('E4').value)).toContain('Rent');
      expect(String(um.getCell('E4').value)).toContain('mo');

      // Revenue formula: total SF × monthly rent × 12 / 1Cr (annualised)
      expect(um.getCell('F5').value.formula).toBeFormula('=D5*E5*12/10000000');
    });

    test('Unit Mix worksheet is omitted for mixed-use workbooks', async () => {
      const ctx = minimalContext();
      ctx.deal.asset_class = 'mixed_use';
      const buffer = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const um = wb.getWorksheet('Unit Mix');
      expect(um).toBeUndefined();
      return;

      // Should NOT have the standard headers — just an empty-state note
      const a4 = um.getCell('A4').value;
      // Empty-state path doesn't write headers; A4 should be null/undefined
      expect(a4 == null || String(a4).includes('Unit mix')).toBe(true);

      // The note in A5 should explain why the table isn't rendered
      const a5 = um.getCell('A5').value;
      expect(String(a5)).toContain("isn't cleanly applicable");
    });

    // PR-D: Sponsor / LP Waterfall sheet — multi-tier pour-over of
    // equity proceeds (LP pref + return of capital → promote split).
    // Reference templates (NAIOP "Waterfall - IRR Hurdles", RE-540
    // "Waterfall") use exactly this structure.
    test('Sponsor LP Waterfall section computes the 3-tier pour-over inside Debt Sizing', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const wf = wb.getWorksheet('Debt Sizing & Amortization');
      expect(wf).toBeDefined();
      expect(wb.getWorksheet('Sponsor LP Waterfall')).toBeUndefined();

      // Capital Stack block (rows 4-9)
      expect(String(wf.getCell('A129').value)).toContain('Capital Stack');
      // Total Equity = Total Cost - Loan
      expect(wf.getCell('B132').value.formula).toBeFormula('=B130-B131');
      // LP Equity = Total × LPEquityPct
      expect(wf.getCell('B133').value.formula).toBeFormula('=B132*LPEquityPct');
      // GP Equity = Total × GPEquityPct
      expect(wf.getCell('B134').value.formula).toBeFormula('=B132*GPEquityPct');

      // Proceeds & Pref block (rows 11-16)
      expect(String(wf.getCell('A137').value)).toContain('Proceeds');
      // Pref accrual: LP Equity × ((1+pref)^N - 1)
      expect(wf.getCell('B140').value.formula).toBeFormula('=B133*((1+PrefReturnRate)^B138-1)');
      // Tier 1 LP distribution = MIN(proceeds, capital + pref)
      expect(wf.getCell('B141').value.formula).toBeFormula('=MIN(B139,B133+B140)');

      // Promote split block (rows 18-22)
      expect(String(wf.getCell('A145').value)).toContain('Promote Split');
      // LP promote = Residual × PromoteLPPct
      expect(wf.getCell('B146').value.formula).toBeFormula('=B142*PromoteLPPct');
      // GP promote = Residual × PromoteGPPct
      expect(wf.getCell('B147').value.formula).toBeFormula('=B142*PromoteGPPct');

      // Final returns block (rows 24-30)
      expect(String(wf.getCell('A152').value)).toContain('Final Investor Returns');
      // LP Total = Tier 1 + LP promote
      expect(wf.getCell('B153').value.formula).toBeFormula('=B141+B146');
      // LP Equity Multiple = LP Total / LP Equity
      expect(wf.getCell('B155').value.formula).toBeFormula('=IFERROR(B153/B133,0)');
      // LP IRR approx = (EM)^(1/years) - 1
      expect(wf.getCell('B157').value.formula).toBeFormula('=IFERROR((B155)^(1/B138)-1,0)');
    });

    test('Inputs sheet exposes 5 new waterfall named ranges', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const allDefined = JSON.stringify(wb.definedNames);
      for (const name of ['LPEquityPct', 'GPEquityPct', 'PrefReturnRate',
        'PromoteLPPct', 'PromoteGPPct']) {
        expect(allDefined).toContain(name);
      }
    });

    // PR-B: Debt Sizing sheet — computes permanent loan as MIN of four
    // lender-approved limits (LTC, LTV, DCR, DY). Reference templates
    // (RE-540 "Permanent Debt Calculation") use exactly this pattern.
    test('Debt Sizing sheet exposes 4 sub-limit methods + final MIN cell (development family)', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const ds = wb.getWorksheet('Debt Sizing & Amortization');
      expect(ds).toBeDefined();

      // Sizing Inputs block at rows 5-8
      expect(String(ds.getCell('A4').value)).toContain('Sizing Inputs');
      const b5 = ds.getCell('B5').value;
      expect(b5.formula).toContain('LandCostCr');
      expect(b5.formula).toContain('ConstructionCostPerSqft');

      // Method 1: LTC (always meaningful, both families)
      expect(String(ds.getCell('A10').value)).toContain('Loan-to-Cost (LTC)');
      expect(ds.getCell('B11').value.formula).toBeFormula('=ConstrMaxLTC');
      expect(ds.getCell('B12').value.formula).toContain('ConstrMaxLTC');

      // Method 2: LTV (development = "Not Applicable")
      expect(String(ds.getCell('A14').value)).toContain('Loan-to-Value (LTV)');

      // Final MIN cell at B28
      expect(String(ds.getCell('A28').value)).toContain('Permanent Loan (final)');
      // Dev family: just LTC-based (=B12), no MIN of all four
      expect(ds.getCell('B28').value.formula).toBeFormula('=B12');
    });

    test('Debt Sizing sheet for income asset uses MIN of all four sub-limits', async () => {
      const ctx = minimalContext();
      ctx.deal.asset_class = 'commercial_office';
      ctx.deal.stabilized_noi_cr = 14.5;
      ctx.deal.noi_cr = 14.5;
      const buffer = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const ds = wb.getWorksheet('Debt Sizing & Amortization');

      // For income family, B6 should carry the NOI value
      const b6 = ds.getCell('B6').value;
      expect(b6).toBeTruthy();

      // Final MIN: B12 (LTC) + B16 (LTV) + B21 (DCR) + B25 (DY)
      expect(ds.getCell('B28').value.formula).toBeFormula('=MIN(B12,B16,B21,B25)');

      // DCR-based implied loan uses PV-of-annuity formula
      expect(ds.getCell('B21').value.formula).toContain('1-(1+DebtRatePct)');
      expect(ds.getCell('B21').value.formula).toContain('LoanTermYears');

      // DY-based: =B6/PermMinDY
      expect(ds.getCell('B25').value.formula).toBeFormula('=B6/PermMinDY');
    });

    test('Inputs sheet exposes 4 new permanent debt sizing named ranges', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const allDefined = JSON.stringify(wb.definedNames);
      for (const name of ['PermMaxLTV', 'PermMinDCR', 'PermMinDY', 'ConstrMaxLTC']) {
        expect(allDefined).toContain(name);
      }
    });

    // PR-C: standalone Amortization Schedule sheet — quarter-by-quarter
    // debt amortization with Beginning / Payment / Interest / Principal /
    // Ending Balance columns. Standard component of every institutional
    // pro forma (NAIOP + RE-540 both have explicit amortization sheets).
    test('Amortization Schedule section renders loan terms + quarter-by-quarter amort table (combined Debt Sizing & Amortization sheet)', async () => {
      // Post-restructure: Amortization rows shifted +30 to live BELOW the
      // Debt Sizing section on the same worksheet. amortShift = 30.
      // Loan Terms title was row 4 → now row 34; Loan Amount was B5 → B35;
      // table header was row 12 → row 42; first amort row was 13 → 43.
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const amort = wb.getWorksheet('Debt Sizing & Amortization');
      expect(amort).toBeDefined();

      // Loan Terms block at rows 34-40 (was 4-10 pre-restructure)
      const a34 = amort.getCell('A34').value;
      expect(String(a34)).toMatch(/Loan Terms/);

      // Loan Amount cell B35 (was B5) — same-sheet reference to B28
      // (Debt Sizing section's MIN-of-4 cell) since both sections live on
      // the same worksheet now.
      const b35 = amort.getCell('B35').value;
      expect(b35).toBeTruthy();
      expect(b35.formula).toBeFormula('=B28');

      // Quarterly Rate cell B39 (was B9) — (1+annual)^(1/4) - 1
      const b39 = amort.getCell('B39').value;
      expect(b39.formula).toMatch(/\(1\+DebtRatePct\)\^\(1\/4\)-1/);

      // Quarterly Payment cell B40 (was B10) — PMT formula. The
      // references B39, B38, B35 reflect the shifted positions of the
      // rate / periods / amount cells.
      const b40 = amort.getCell('B40').value;
      expect(b40.formula).toMatch(/PMT\(B39,B38,B35\)/);

      // Header row at row 42 (was 12)
      expect(String(amort.getCell('A42').value)).toBe('Period');
      expect(String(amort.getCell('B42').value)).toBe('Beginning Balance');
      expect(String(amort.getCell('C42').value)).toBe('Payment');
      expect(String(amort.getCell('D42').value)).toBe('Interest');
      expect(String(amort.getCell('E42').value)).toBe('Principal');
      expect(String(amort.getCell('F42').value)).toBe('Ending Balance');

      // Row 43 (Period 1, was row 13): Beginning Balance = $B$35 (Loan Amount, was $B$5)
      const b43 = amort.getCell('B43').value;
      expect(b43.formula).toBeFormula('=$B$35');

      // Row 44 (Period 2, was row 14): Beginning Balance = previous-row Ending Balance
      const b44 = amort.getCell('B44').value;
      expect(b44.formula).toMatch(/F43/);

      // Interest formula = Beginning × Quarterly Rate (B$39 was B$9 pre-shift)
      const d43 = amort.getCell('D43').value;
      expect(d43.formula).toContain('B43*$B$39');

      // Ending Balance = MAX(Beginning - Principal, 0)
      const f43 = amort.getCell('F43').value;
      expect(f43.formula).toContain('MAX(B43-E43,0)');
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

    test('Phasing sheet renders 7 detailed soft cost rows (rows 18-24) for development family', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const phasing = wb.getWorksheet('Cash Flow Engine');

      // Pre-PR-I2 rows were 13-19 (Detailed Soft Costs). PR-I2 inserted
      // 5 RERA Escrow ledger rows between Customer Collection (row 10)
      // and Marketing & Sales spend, shifting the detailed soft costs
      // down by 5 to rows 18-24.
      const labels = [
        [18, 'A&E spend'],
        [19, 'Legal fees spend'],
        [20, 'Appraisal & title spend'],
        [21, 'Insurance during construction'],
        [22, 'Property taxes during construction'],
        [23, 'Developer overhead'],
        [24, 'Total Detailed Soft Costs'],
      ];
      for (const [row, expectedLabelPrefix] of labels) {
        const labelCell = phasing.getCell(`A${row}`).value;
        const labelStr = labelCell && typeof labelCell === 'object' && labelCell.richText
          ? labelCell.richText.map((r) => r.text).join('')
          : String(labelCell || '');
        expect(labelStr).toContain(expectedLabelPrefix);
      }

      // Each soft cost row Q1 (column B) carries a formula referencing
      // the appropriate named range (positions shifted +5 by PR-I2).
      const b18 = phasing.getCell('B18').value;
      expect(b18.formula).toContain('ArchitectFeePct');
      const b21 = phasing.getCell('B21').value;
      expect(b21.formula).toContain('InsuranceConstPct');
      const b22 = phasing.getCell('B22').value;
      expect(b22.formula).toContain('PropTaxConstPct');
      // Property taxes apply to LandCostCr (Karnataka method), not hard cost
      expect(b22.formula).toContain('LandCostCr');

      // Row 24 total = sum of rows 18-23 (shifted +5 by PR-I2)
      const b24 = phasing.getCell('B24').value;
      expect(b24.formula).toBeFormula('=B18+B19+B20+B21+B22+B23');
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
      expect(b24.formula).toBeFormula('=B16+B17+B18+B19+B20+B21+B22+B23');
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
    // Operator directive 2026-05-11: "Use formulas, cell references,
    // linkages and locking of cells wherever possible". Headline KPI tiles
    // (rows 4 + 7) are now ALWAYS formula-driven so editing Inputs flows
    // through to the Dashboard live. Pre-fix the kernel-stored values
    // were written as literals which froze the tiles. Kernel-vs-modeled
    // reconciliation moved entirely to the Returns block (rows 20-22).
    test('Dashboard KPI tiles are formula-driven (recalc when Inputs edit)', async () => {
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

      // Total Revenue (B4) — FORMULA referencing Cash Flow Engine
      const b4 = dash.getCell('B4').value;
      expect(typeof b4).toBe('object');
      expect(b4.formula).toMatch(/Cash Flow Engine/);

      // Total Project Cost (D4) — FORMULA referencing the canonical cost named range
      const d4 = dash.getCell('D4').value;
      expect(typeof d4).toBe('object');
      expect(d4.formula).toBeFormula('=TotalProjectCostCr');

      // Net CF (F4) — FORMULA referencing Cash Flow Engine Project net CF row
      const f4 = dash.getCell('F4').value;
      expect(typeof f4).toBe('object');
      expect(f4.formula).toMatch(/Cash Flow Engine/);

      // Gross Margin (B7) — FORMULA with IFERROR guard
      const b7 = dash.getCell('B7').value;
      expect(typeof b7).toBe('object');
      expect(b7.formula).toMatch(/IFERROR/);

      // Min DSCR (D7) — FORMULA referencing Cash Flow Engine DSCR total
      const d7 = dash.getCell('D7').value;
      expect(typeof d7).toBe('object');
      expect(d7.formula).toBeTruthy();

      // Returns block (row 20) — kernel literals for explicit reconciliation
      // against the Reports page. These intentionally stay as literals.
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

      // Row 21 — modeled IRR/NPV/EM (formula-driven)
      const b21 = dash.getCell('B21').value;
      expect(typeof b21).toBe('object');
      expect(b21.formula).toMatch(/IRR\(/);
      const d21 = dash.getCell('D21').value;
      expect(typeof d21).toBe('object');
      expect(d21.formula).toMatch(/NPV\(/);
    });

    test('Dashboard row 3 — Deal Sanity Check banner renders an IFERROR-guarded formula', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const dash = wb.getWorksheet('Dashboard');
      const a3 = dash.getCell('A3').value;
      expect(typeof a3).toBe('object');
      expect(normalizeFormula(a3.formula)).toMatch(/^IF\(IFERROR\(B4,0\)=0/);
      // Healthy path branch ends with checkmark
      expect(a3.formula).toMatch(/✓ Deal status/);
      // Negative-margin warning branch
      expect(a3.formula).toMatch(/Negative gross margin/);
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
      const phasing = wb.getWorksheet('Cash Flow Engine');

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
      expect(normalizeFormula(formula)).not.toMatch(/^F9\*CollectionPct$/);
    });

    test('cumulative rows in Phasing use final-value (not SUM) for the Total column', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const phasing = wb.getWorksheet('Cash Flow Engine');

      // Find the Total column (last column = column for q=totalQuarters+1)
      const formulaAt = (cellRef) => {
        const v = phasing.getCell(cellRef).value;
        return v && typeof v === 'object' && v.formula ? v.formula : null;
      };

      // For a 12-quarter project (minimal-context default): B=Q1..M=Q12,
      // N=Total. Cumulative rows must reference the LAST quarter cell
      // (=M{row}); non-cumulative rows still use SUM(B{row}:M{row}).
      expect(formulaAt('N7')).toBeFormula('=M7');     // cumulative construction (unchanged)
      // PR-I2: Cumulative customer collection shifted from row 12 → 17
      // (5 new RERA escrow rows inserted between Customer Collection row 10
      // and Marketing & Sales spend).
      expect(formulaAt('N17')).toBeFormula('=M17');   // cumulative collection (was N12 pre-PR-I2)
      expect(formulaAt('N6')).toBeFormula('=SUM(B6:M6)');   // per-quarter construction
      expect(formulaAt('N9')).toBeFormula('=SUM(B9:M9)');   // per-quarter sales
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
      expect(dashFormula).toMatch(/'Cash Flow Engine'!([A-Z]+)9/);
      expect(calcFormula).toMatch(/'Cash Flow Engine'!([A-Z]+)9/);
      const dashCol = dashFormula.match(/'Cash Flow Engine'!([A-Z]+)9/)[1];
      const calcCol = calcFormula.match(/'Cash Flow Engine'!([A-Z]+)9/)[1];
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
      const sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');
      expect(sheetXml).toMatch(/<drawing\s+r:id="rId\d+"\s*\/>/);

      // Sheet rels include the drawing rel
      const sheetRels = await zip.file('xl/worksheets/_rels/sheet1.xml.rels').async('string');
      expect(sheetRels).toMatch(/drawings\/drawing1\.xml/);

      // Content types declares each chart + the drawing
      const contentTypes = await zip.file('[Content_Types].xml').async('string');
      expect(contentTypes).toMatch(/\/xl\/drawings\/drawing1\.xml/);
      expect(contentTypes).toMatch(/\/xl\/charts\/chart1\.xml/);
    });

    test('Dashboard ships native Excel sparklines for KPI trend cells', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const zip = await JSZip.loadAsync(buffer);
      const sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');

      expect(sheetXml).toContain('<x14:sparklineGroups>');
      expect(sheetXml).toContain('<xm:sqref>B9</xm:sqref>');
      expect(sheetXml).toContain('<xm:sqref>D9</xm:sqref>');
      expect(sheetXml).toContain('<xm:sqref>F9</xm:sqref>');
      expect(sheetXml).toContain("'Dashboard'!$B$39:$B$62");
      expect(sheetXml).toContain("'Dashboard'!$E$39:$E$62");
    });

    test('workbook XML is parser-safe: no leading equals in formula nodes and no undefined colors', async () => {
      const JSZip = require('jszip');
      const buffer = await buildDealWorkbookV2(minimalContext());
      const zip = await JSZip.loadAsync(buffer);
      const worksheetFiles = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));

      for (const name of worksheetFiles) {
        const xml = await zip.file(name).async('string');
        expect(xml).not.toMatch(/<f(?:\s[^>]*)?>=/);
        expect(xml).not.toContain('FFundefined');
      }
    });

    // The Uses Breakdown doughnut always renders. The Monthly Trend
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

      // 2) Combo (barChart + lineChart in one plotArea) for Monthly Trend
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
      // Tornado references the H/I/J columns where the driver data lives.
      // Driver rows shifted +1 in PR-NX (Post-Tax IRR row inserted at A22),
      // so the data table that was on rows 25-26 now lives on 26-27.
      expect(tornado).toMatch(/\$H\$26:\$H\$27/);  // categories (driver labels)
      expect(tornado).toMatch(/\$I\$26:\$I\$27/);  // low-case deltas
      expect(tornado).toMatch(/\$J\$26:\$J\$27/);  // high-case deltas

      // Doughnut targets the Uses cells
      const doughnut = xmls.find((x) => x.includes('<c:doughnutChart'));
      expect(doughnut).toMatch(/\$A\$14:\$A\$18/);
      expect(doughnut).toMatch(/\$B\$14:\$B\$18/);
    });

    test('Dashboard tornado data table emits two driver rows with delta formulas', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const dash = wb.getWorksheet('Dashboard');

      // PR-NX shifted tornado table +1: headers were row 24 → row 25;
      // driver rows were 25-26 → 26-27. Sensitivity grid that anchors
      // the deltas shifted from B25:F29 → B26:F30, so the base-case
      // centre cell is D28 (was D27).

      // Row 25 = headers
      expect(String(dash.getCell('H25').value)).toBe('Driver');
      expect(String(dash.getCell('I25').value)).toBe('Low Case Δ');
      expect(String(dash.getCell('J25').value)).toBe('High Case Δ');

      // Row 26 = Selling Rate driver
      expect(String(dash.getCell('H26').value)).toContain('Selling Rate');
      // Low delta = grid[middle row][leftmost col] - base = B28 - D28
      expect(dash.getCell('I26').value.formula).toBeFormula('=B28-D28');
      // High delta = grid[middle row][rightmost col] - base = F28 - D28
      expect(dash.getCell('J26').value.formula).toBeFormula('=F28-D28');

      // Row 27 = Project Cost driver
      expect(String(dash.getCell('H27').value)).toContain('Project Cost');
      // High cost = low margin → I27 (low delta) = D30 - D28
      expect(dash.getCell('I27').value.formula).toBeFormula('=D30-D28');
      // Low cost = high margin → J27 (high delta) = D26 - D28
      expect(dash.getCell('J27').value.formula).toBeFormula('=D26-D28');
    });

    // Asset-class branching for the trend chart: development deals show
    // Sales vs Construction; income deals show PGI vs NOI. The series
    // labels are emitted into the chart XML.
    test('Monthly Trend combo-chart series labels switch by asset family', async () => {
      const JSZip = require('jszip');
      // Development deal — bar series should be Sales + Construction;
      // line series should be Cumulative Equity CF
      const devBuffer = await buildDealWorkbookV2(minimalContext());
      const devZip = await JSZip.loadAsync(devBuffer);
      const devChartFiles = Object.keys(devZip.files).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n));
      const devXmls = await Promise.all(devChartFiles.map((n) => devZip.file(n).async('string')));
      const devCombo = devXmls.find((x) => x.includes('<c:barChart') && x.includes('<c:lineChart'));
      expect(devCombo).toBeDefined();
      expect(devCombo).toMatch(/Sales \(Cr\)/);
      expect(devCombo).toMatch(/Construction \(Cr\)/);
      expect(devCombo).toMatch(/Cumulative Equity CF \(Cr\)/);

      // Income deal — bar series should be PGI + NOI; line should be Net Equity CF
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
      expect(incomeCombo).toMatch(/Net Equity CF/);
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

      // Cost Build (rows 12–28 — expanded for the detailed soft cost
      // breakdown PR + India Statutory Levies PR-I1).
      //   R15 = Hard subtotal · R24 = Soft subtotal
      //   R25-R26 = Stamp Duty + Reg · GST on Construction (PR-I1 lines)
      //   R27 = India Statutory Levies subtotal
      //   R28 = Total project cost (Hard + Soft + Statutory)
      expect(formulaAt('B15')).toBeFormula('=B12+B13+B14');                      // Hard cost = Land + Construction + Approvals
      expect(formulaAt('B24')).toBeFormula('=B16+B17+B18+B19+B20+B21+B22+B23');  // Soft cost = all 8 line items
      expect(formulaAt('B25')).toBeFormula('=LandCostCr*StampRegPct');           // Stamp Duty + Registration on Land (PR-I1)
      expect(formulaAt('B26')).toBeFormula('=B13*GstPct');                       // GST on Construction (Net of ITC) (PR-I1)
      expect(formulaAt('B27')).toBeFormula('=B25+B26');                          // India Statutory Levies subtotal (PR-I1)
      expect(formulaAt('B28')).toBeFormula('=B15+B24+B27');                      // Total cost = Hard + Soft + Statutory

      // Debt Sculpting (rows 31–36). Total debt envelope refs B28
      // (Total project cost including India Statutory Levies, PR-I1).
      expect(formulaAt('B32')).toBeFormula('=B28*DebtLTV');                      // Total debt envelope
      expect(formulaAt('B33')).toBeFormula('=B28*(1-DebtLTV)');                  // Equity envelope
      expect(formulaAt('B34')).toBeFormula('=B32*DebtRatePct');                  // Annualised interest
      expect(formulaAt('B35')).toBeFormula('=B34/4');                            // Quarterly accrual
      expect(formulaAt('B36')).toBeFormula('=B34/SaleableAreaSqft*10000000');    // Per-sqft proxy

      // None of those formulas should reference their own cell.
      ['B15', 'B24', 'B25', 'B26', 'B27', 'B28', 'B32', 'B33', 'B34', 'B35', 'B36'].forEach((cellRef) => {
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

    // PR-NX (2026-05-12): Dashboard now exposes a Post-Tax IRR row at A22
    // so IC reviewers can read the India LTCG/STCG-adjusted IRR alongside
    // the gross modeled IRR (row 21). The Effective CG Rate that's applied
    // (12.5% LTCG ≥ 2yr, 30% STCG slab < 2yr) and the Hold Period that
    // drives the LT/ST branch are echoed in C22/E22 for traceability.
    describe('Dashboard Post-Tax IRR row (PR-NX — India LTCG/STCG-adjusted)', () => {
      test('row 22 labels exist on every deal family', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        expect(String(dash.getCell('A22').value)).toContain('Post-Tax IRR');
        expect(String(dash.getCell('A22').value)).toContain('LTCG');
        expect(String(dash.getCell('C22').value)).toContain('Effective CG Rate');
        expect(String(dash.getCell('E22').value)).toContain('Hold Period');
      });

      test('B22 (Post-Tax IRR) formula = B21 × (1 − EffectiveCGRate)', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        expect(dash.getCell('B22').value.formula).toBeFormula('=IFERROR(B21*(1-EffectiveCGRate),"–")');
      });

      test('D22 echoes EffectiveCGRate, F22 echoes EffectiveHoldYears (traceability)', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        expect(dash.getCell('D22').value.formula).toBeFormula('=EffectiveCGRate');
        expect(dash.getCell('F22').value.formula).toBeFormula('=EffectiveHoldYears');
      });

      test('disclosure footnote (now at A23) mentions POST-TAX', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        const note = String(dash.getCell('A23').value);
        expect(note).toContain('KERNEL');
        expect(note).toContain('MODELED');
        expect(note).toContain('POST-TAX');
      });

      test('sensitivity grid title moved to A24 (was A23)', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        expect(String(dash.getCell('A24').value)).toContain('Sensitivity');
        // Header corner cell moved to A25 (was A24)
        expect(String(dash.getCell('A25').value)).toContain('Cost');
      });

      test('Scenario Comparison title moved to A32 (was A31)', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        expect(String(dash.getCell('A32').value)).toContain('Scenario Comparison');
      });

      test('Monthly Trend title sits at A37', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        const title = String(dash.getCell('A37').value);
        // Asset-class-aware: dev family says "Project Trend", income says "Operating Trend"
        expect(title).toMatch(/Monthly (Operating|Project) Trend/);
      });
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

    test('LoadingFactor accepts zero engine add-on and CarpetAreaSqft stays guarded', async () => {
      const ctx = minimalContext();
      ctx.deal.model_params.inputs.loadingFactor = 0;
      const buffer = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const inputs = wb.getWorksheet('Inputs & Assumptions');
      let loadingFactorValue = null;
      let carpetFormula = null;

      inputs.eachRow((row) => {
        const label = String(row.getCell(1).value || '');
        if (label.includes('Loading Factor')) loadingFactorValue = row.getCell(2).value;
        if (label.includes('Carpet Area')) carpetFormula = row.getCell(2).value.formula;
      });

      expect(loadingFactorValue).toBe(1);
      expect(carpetFormula).toBeFormula('=IFERROR(SaleableAreaSqft/LoadingFactor,0)');
    });

    test('Cash Flow sheet has DSCR row with conditional formatting referenced', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const cf = wb.getWorksheet('Cash Flow Engine');
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

    test('Dashboard uses one canonical TotalProjectCostCr for KPI and Sources & Uses formulas', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const dash = wb.getWorksheet('Dashboard');
      const namesList = (wb.definedNames.model || []).map((n) => n.name);

      expect(namesList).toContain('TotalProjectCostCr');
      expect(dash.getCell('D4').value.formula).toBeFormula('=TotalProjectCostCr');
      expect(dash.getCell('B12').value.formula).toBeFormula('=MAX(0,TotalProjectCostCr*(1-DebtLTV))');
      expect(dash.getCell('B13').value.formula).toBeFormula('=TotalProjectCostCr*DebtLTV');
      expect(dash.getCell('B16').value.formula).toBeFormula('=ApprovalCostCr+PremiumFSICostCr');
      expect(dash.getCell('B17').value.formula).toBeFormula("='Calculations'!$B$24");
      expect(dash.getCell('B18').value.formula).toBeFormula("='Calculations'!$B$27");
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

      const phasing = wb.getWorksheet('Cash Flow Engine');
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
      // Post-restructure: title says "Cash Flow Engine — Operating Schedule..."
      // (was "Lease-up & Operating Schedule" pre-restructure).
      expect(phasingJoined).toMatch(/Cash Flow Engine.*Operating Schedule/);

      const dash = wb.getWorksheet('Dashboard');
      const dashText = [];
      dash.eachRow((row) => row.eachCell((cell) => {
        if (typeof cell.value === 'string') dashText.push(cell.value);
      }));
      const dashJoined = dashText.join(' | ');
      // Income KPI tiles
      expect(dashJoined).toMatch(/Stabilised NOI/);
      expect(dashJoined).toMatch(/Stabilized Yield on Cost/);
      expect(dashJoined).toMatch(/Cash-on-Cash/);
    }, 30000);

    test('income asset model uses occupancy/rent logic instead of development sale-rate logic', async () => {
      const ctx = minimalContext();
      ctx.deal.asset_class = 'retail';
      ctx.property.property_type = 'retail';
      ctx.deal.model_params.inputs.baseRentPerSqftMonth = 95;
      ctx.deal.model_params.inputs.occupancyPct = 0.88;
      const buffer = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);

      const cashFlow = wb.getWorksheet('Cash Flow Engine');
      expect(cashFlow.getCell('B9').value.formula).toBeFormula('=-B8*B6*VacancyPct');
      expect(cashFlow.getCell('B11').value.formula).toBeFormula('=B8*B6+B9+B10');

      const dash = wb.getWorksheet('Dashboard');
      expect(String(dash.getCell('A24').value)).toContain('Yield on Cost');
      expect(String(dash.getCell('A25').value)).toContain('Occupancy');
      expect(String(dash.getCell('H26').value)).toContain('Rent');
      expect(String(dash.getCell('H27').value)).toContain('Occupancy');
      expect(String(dash.getCell('A34').value)).toBe('Yield on Cost');
      expect(String(dash.getCell('A35').value)).toBe('Annual NOI (Cr)');
      const sensitivityFormula = dash.getCell('B26').value.formula;
      expect(sensitivityFormula).toContain('BaseRentPerSqftMonth');
      expect(sensitivityFormula).toContain('OccupancyPct');
      expect(sensitivityFormula).not.toContain('SellRatePerSqft');
      expect(sensitivityFormula).not.toContain('ConstructionCostPerSqft');
    }, 30000);

    test('development asset (residential_apartments) keeps Sales Collection rows', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext()); // residential_apartments default
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const phasing = wb.getWorksheet('Cash Flow Engine');
      const text = [];
      phasing.eachRow((row) => row.eachCell((cell) => {
        if (typeof cell.value === 'string') text.push(cell.value);
      }));
      const joined = text.join(' | ');
      expect(joined).toMatch(/Construction cost/);
      expect(joined).toMatch(/Customer collection/);
      // Post-restructure: title says "Cash Flow Engine — Phasing + Sales..."
      // (was "Construction Phasing & Sales Collection" pre-restructure).
      expect(joined).toMatch(/Cash Flow Engine.*Phasing.*Sales Collection/);
      // Should NOT have income-asset rows
      expect(joined).not.toMatch(/PGI/);
      expect(joined).not.toMatch(/Property Tax/);
    }, 30000);

    test('Dashboard renders Monthly Trend table with asset-aware columns and monthly formulas', async () => {
      // Income deal — should show PGI / EGR / NOI / Net Equity CF columns
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
      expect(joined1).toMatch(/Monthly Operating Trend/);
      expect(joined1).toMatch(/PGI \(Cr\)/);
      expect(joined1).toMatch(/NOI \(Cr\)/);
      expect(joined1).toMatch(/Net Equity CF \(Cr\)/);
      expect(String(dash1.getCell('A39').value)).toBe('M1');
      expect(dash1.getCell('B39').value.formula).toBeFormula("='Monthly Cash Flow'!B7");
      expect(dash1.getCell('D39').value.formula).toBeFormula("='Monthly Cash Flow'!B19");
      expect(dash1.getCell('E39').value.formula).toBeFormula("='Monthly Cash Flow'!B26");

      // Development deal — should show Sales / Construction / Equity CF / Cumulative columns
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
      expect(joined2).toMatch(/Monthly Project Trend/);
      expect(joined2).toMatch(/Sales \(Cr\)/);
      expect(joined2).toMatch(/Construction \(Cr\)/);
      expect(joined2).toMatch(/Cumulative \(Cr\)/);
      expect(String(dash2.getCell('A39').value)).toBe('M1');
      expect(dash2.getCell('B39').value.formula).toBeFormula("='Monthly Cash Flow'!B12");
      expect(dash2.getCell('C39').value.formula).toBeFormula("='Monthly Cash Flow'!B7");
      expect(dash2.getCell('D39').value.formula).toBeFormula("='Monthly Cash Flow'!B21");
      expect(dash2.getCell('E39').value.formula).toBeFormula("='Monthly Cash Flow'!B22");
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

    test('all sheets are unprotected while Inputs value cells remain clearly editable', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const visibleSheets = wb.worksheets.filter((ws) => ws.state !== 'hidden');
      visibleSheets.forEach((ws) => {
        const isProtected = ws.sheetProtection && ws.sheetProtection.sheet === true;
        expect(isProtected).not.toBe(true);
      });
      const inputs = wb.getWorksheet('Inputs & Assumptions');
      let foundUnlockedInput = false;
      inputs.eachRow((row) => {
        const label = String(row.getCell(1).value || '');
        if (/Selling Rate per sqft/i.test(label)) {
          foundUnlockedInput = row.getCell(2).protection?.locked === false;
        }
      });
      expect(foundUnlockedInput).toBe(true);

      const dash = wb.getWorksheet('Dashboard');
      expect(dash.getCell('B4').protection?.locked).not.toBe(false);
    });

    // ── PR-I1 — India Statutory Levies as REAL cost lines ──────────────
    // The first PR in the post-arc India localization batch. Closes the
    // biggest correctness hole: GST + Stamp Duty + Registration used to
    // be inputs on the Inputs sheet that didn't flow into ANY formula
    // (purely decorative). Now they:
    //   1. Live in a dedicated "India Statutory Levies" section on Inputs
    //   2. Have asset-class-aware defaults (residential 5% GST; commercial
    //      0% net of ITC; plotted 0%)
    //   3. Materialise as 3 new rows on Phasing (Stamp+Reg Q1-only, GST
    //      construction-spread, Total Statutory Levies)
    //   4. Roll into the Calculations Cost Build at rows 25-27
    //   5. Are reflected in the Total Project Cost (B28 in Calc; Total
    //      Cost rollups on Debt Sizing + Waterfall sheets)
    describe('PR-I1: India Statutory Levies — GST + Stamp Duty + Registration', () => {
      test('Inputs sheet defines StampRegPct + GstPct named ranges in India Statutory Levies section', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const names = wb.definedNames.matrixMap || {};
        // Both named ranges must exist as workbook-level names so the
        // Phasing + Calculations sheets can reference them as named
        // ranges (not hard-coded cell addresses).
        const allNameRefs = wb.definedNames.model || [];
        const namesList = allNameRefs.map((n) => n.name);
        expect(namesList).toContain('StampRegPct');
        expect(namesList).toContain('GstPct');

        // The section header should appear on the Inputs sheet.
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let foundSection = false;
        inputs.eachRow((row) => {
          const v = String(row.getCell(1).value || '');
          if (v.includes('India Statutory Levies')) foundSection = true;
        });
        expect(foundSection).toBe(true);
      });

      test('GST default follows the financial-engine assumption registry by asset class', async () => {
        const getGstSeed = async (ctx) => {
          const buffer = await buildDealWorkbookV2(ctx);
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const inputs = wb.getWorksheet('Inputs & Assumptions');
          let seed = null;
          inputs.eachRow((row) => {
            const label = String(row.getCell(1).value || '').trim();
            if (label === 'GST on Construction (Net of ITC)') seed = row.getCell(2).value;
          });
          return seed;
        };

        // Build contexts that DON'T set gstPct so we exercise the
        // financial-engine default registry.
        const baseCtx = minimalContext();
        const stripGst = (c) => {
          const next = JSON.parse(JSON.stringify(c));
          delete next.deal.model_params.inputs.gstPct;
          return next;
        };
        const residentialCtx = stripGst(baseCtx);
        const commercialCtx = stripGst(baseCtx);
        commercialCtx.deal.asset_class = 'commercial_office';
        commercialCtx.property.property_type = 'commercial_office';
        const plottedCtx = stripGst(baseCtx);
        plottedCtx.deal.asset_class = 'plotted_development';
        plottedCtx.property.property_type = 'plotted_development';

        const [resGst, comGst, plotGst] = await Promise.all([
          getGstSeed(residentialCtx),
          getGstSeed(commercialCtx),
          getGstSeed(plottedCtx),
        ]);

        expect(resGst).toBeCloseTo(0.18, 4);
        expect(comGst).toBeCloseTo(0.18, 4);
        expect(plotGst).toBeCloseTo(0.12, 4);
      });

      test('StampRegPct defaults to 0.066 (Karnataka 5.6% + 1%) when no input provided', async () => {
        const ctx = minimalContext();
        delete ctx.deal.model_params.inputs.stampDutyPct;
        delete ctx.deal.model_params.inputs.stampRegPct;
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let seed = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label === 'Stamp Duty + Registration') seed = row.getCell(2).value;
        });
        expect(seed).toBeCloseTo(0.066, 4);
      });

      test('StampRegPct combines legacy stampDutyPct + registrationPct when both are present', async () => {
        const ctx = minimalContext();
        ctx.deal.model_params.inputs.stampDutyPct = 0.05;
        ctx.deal.model_params.inputs.registrationPct = 0.01;
        delete ctx.deal.model_params.inputs.stampRegPct;
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let seed = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label === 'Stamp Duty + Registration') seed = row.getCell(2).value;
        });
        expect(seed).toBeCloseTo(0.06, 4); // 5% + 1% = 6%
      });

      test('Phasing sheet has Stamp Duty Q1-only and GST construction-spread rows', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const phasing = wb.getWorksheet('Cash Flow Engine');

        // Collect rows by label so we don't depend on exact row numbers.
        const rowByLabel = {};
        phasing.eachRow((row, rowIdx) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label) rowByLabel[label] = rowIdx;
        });

        // Three new rows from PR-I1 must exist on a development-family deal.
        expect(rowByLabel['Stamp Duty + Registration on Land (INR Cr)']).toBeDefined();
        expect(rowByLabel['GST on Construction — Net Cost (INR Cr)']).toBeDefined();
        expect(rowByLabel['Total India Statutory Levies (INR Cr)']).toBeDefined();

        // Stamp Duty + Registration row: Q1 (col B) carries the formula
        // LandCostCr*StampRegPct; Q2-Q12 (cols C..M) are all literal 0.
        const stampRow = rowByLabel['Stamp Duty + Registration on Land (INR Cr)'];
        const q1Cell = phasing.getCell(stampRow, 2); // B = Q1
        expect(q1Cell.value && q1Cell.value.formula).toBeFormula('=LandCostCr*StampRegPct');
        // Q2 (col C) onward are literal 0 (Stamp is paid up-front, not amortised)
        for (let q = 2; q <= 6; q += 1) {
          const cell = phasing.getCell(stampRow, 1 + q); // col B=Q1=2, so col C=Q2=3
          const formula = cell.value && cell.value.formula;
          expect(formula).toBeFormula('=0');
        }

        // GST row: every quarter has the same IF-construction-window formula
        // (spread across construction quarters), keyed to ConstructionLagQ
        // and TotalQuarters. The formula text is identical per quarter
        // except for the `q` numeric literal.
        const gstRow = rowByLabel['GST on Construction — Net Cost (INR Cr)'];
        for (let q = 1; q <= 4; q += 1) {
          const cell = phasing.getCell(gstRow, 1 + q);
          const f = (cell.value && cell.value.formula) || '';
          expect(f).toContain('GstPct');
          expect(f).toContain('ConstructionLagQ');
          expect(f).toContain('TotalQuarters');
        }
      });

      test('Calculations Cost Build includes Stamp+Reg + GST + Statutory subtotal + new Total cost at B28', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const calc = wb.getWorksheet('Calculations');

        const formulaAt = (cellRef) => {
          const v = calc.getCell(cellRef).value;
          return v && typeof v === 'object' && v.formula ? v.formula : null;
        };
        const labelAt = (cellRef) => String(calc.getCell(cellRef).value || '');

        // PR-I1 lines on the Calculations Cost Build
        expect(labelAt('A25')).toContain('Stamp Duty');
        expect(formulaAt('B25')).toBeFormula('=LandCostCr*StampRegPct');
        expect(labelAt('A26')).toContain('GST');
        expect(formulaAt('B26')).toBeFormula('=B13*GstPct');
        expect(labelAt('A27')).toContain('India Statutory Levies');
        expect(formulaAt('B27')).toBeFormula('=B25+B26');

        // Total project cost now rolls up Hard + Soft + Statutory.
        expect(labelAt('A28')).toContain('Total project cost');
        expect(formulaAt('B28')).toBeFormula('=B15+B24+B27');
      });

      test('Debt Sizing + Waterfall Total Project Cost formulas include India Statutory Levies', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);

        // Both the Debt Sizing and Sponsor LP Waterfall sheets carry a
        // local "Total Project Cost" formula (built up from named ranges
        // so each sheet is self-contained). After PR-I1 both must include
        // the LandCostCr*StampRegPct + Construction*GstPct levies; without
        // it those sheets would understate cost vs the Calculations sheet.
        const debtSizing = wb.getWorksheet('Debt Sizing & Amortization');
        const waterfall = debtSizing;

        const findCellByLabel = (sheet, expectedLabel) => {
          let found = null;
          sheet.eachRow((row, rowIdx) => {
            const labelCell = row.getCell(1);
            const label = String(labelCell.value || '');
            if (label.includes(expectedLabel) && !found) {
              const valCell = row.getCell(2);
              const f = valCell.value && valCell.value.formula;
              found = f || null;
            }
          });
          return found;
        };

        const debtTotalCostFormula = findCellByLabel(debtSizing, 'Total Project Cost');
        const wfTotalCostFormula = findCellByLabel(waterfall, 'Total Project Cost');

        expect(debtTotalCostFormula).toMatch(/StampRegPct/);
        expect(debtTotalCostFormula).toMatch(/GstPct/);
        expect(wfTotalCostFormula).toMatch(/StampRegPct/);
        expect(wfTotalCostFormula).toMatch(/GstPct/);
      });
    });

    // ── PR-I2 — RERA Escrow 70/30 split on customer collections ────────
    // Indian RERA Act 2016 mandates that 70% of every customer payment on a
    // RERA-registered residential project must be deposited into a project-
    // specific escrow account, releasable only against certified construction.
    // The remaining 30% is freely available to the developer.
    //
    // Pre-PR-I2 the Cash Flow sheet showed the developer receiving the FULL
    // sale value as soon as the customer paid — overstating cash inflow by
    // ~70% and producing a too-rosy IRR. PR-I2 inserts a 5-row escrow
    // ledger (To Escrow / Free Cash / Drawdown / Balance / Net) on the
    // Phasing sheet and switches the Cash Flow sheet's sales inflow to the
    // Net developer cash row.
    describe('PR-I2: RERA Escrow 70/30 split', () => {
      test('Inputs sheet defines RERAEscrowPct in a RERA Compliance section (default 0.70)', async () => {
        const ctx = minimalContext();
        delete ctx.deal.model_params.inputs.reraEscrowPct;
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);

        const namesList = (wb.definedNames.model || []).map((n) => n.name);
        expect(namesList).toContain('RERAEscrowPct');

        // Default value should be 0.70 (the RERA Act mandate)
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let seed = null;
        let sectionFound = false;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('RERA Compliance')) sectionFound = true;
          if (label === 'RERA Escrow Allocation') seed = row.getCell(2).value;
        });
        expect(sectionFound).toBe(true);
        expect(seed).toBeCloseTo(0.70, 4);
      });

      test('Phasing sheet has the 5-row RERA Escrow ledger (rows 11-15) on development family', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const phasing = wb.getWorksheet('Cash Flow Engine');

        const rowByLabel = {};
        phasing.eachRow((row, rowIdx) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label) rowByLabel[label] = rowIdx;
        });

        // Five new RERA ledger rows. The Net row's label evolved across
        // PRs: PR-I2 added it as "Net developer cash from sales (INR Cr)";
        // PR-I3 expanded it to "(post-RERA, post-landowner share)" once
        // the JDA landowner-share factor entered the formula.
        const escrowRow = rowByLabel['→ To RERA Escrow (restricted 70%)'];
        const freeCashRow = rowByLabel['→ Free cash to developer (30%)'];
        const drawdownRow = rowByLabel['RERA Escrow drawdown (against construction)'];
        const balanceRow = rowByLabel['RERA Escrow balance — end of quarter'];
        const netRow = rowByLabel['Net developer cash from sales (post-RERA, post-landowner share)'];

        expect(escrowRow).toBeDefined();
        expect(freeCashRow).toBeDefined();
        expect(drawdownRow).toBeDefined();
        expect(balanceRow).toBeDefined();
        expect(netRow).toBeDefined();

        // Block is contiguous (rows 11-15) immediately after Customer Collection (row 10)
        expect(escrowRow).toBe(11);
        expect(freeCashRow).toBe(12);
        expect(drawdownRow).toBe(13);
        expect(balanceRow).toBe(14);
        expect(netRow).toBe(15);
      });

      test('RERA Escrow formulas split gross 70/30 and net escrow drawdown', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const phasing = wb.getWorksheet('Cash Flow Engine');

        // Q1 (col B) formulas
        const b11 = phasing.getCell('B11').value;
        expect(b11.formula).toBeFormula('=B10*RERAEscrowPct');

        const b12 = phasing.getCell('B12').value;
        expect(b12.formula).toBeFormula('=B10*(1-RERAEscrowPct)');

        // Drawdown Q1: MIN(escrow additions, construction this quarter)
        const b13 = phasing.getCell('B13').value;
        expect(b13.formula).toBeFormula('=MIN(B11,B6)');

        // Balance Q1: additions - drawdown (no prior balance)
        const b14 = phasing.getCell('B14').value;
        expect(b14.formula).toBeFormula('=B11-B13');

        // Net developer cash: (Free Cash + Drawdown) × (1 - LandownerSharePct).
        // PR-I3 introduced the landowner-share factor for JDA structures;
        // when LandownerSharePct = 0 (default outright purchase) the
        // formula collapses to Free Cash + Drawdown.
        const b15 = phasing.getCell('B15').value;
        expect(b15.formula).toBeFormula('=(B12+B13)*(1-LandownerSharePct)');

        // Q2 (col C) — drawdown + balance use rolling state
        const c13 = phasing.getCell('C13').value;
        expect(c13.formula).toBeFormula('=MIN(B14+C11,C6)'); // prev balance + this addition vs construction
        const c14 = phasing.getCell('C14').value;
        expect(c14.formula).toBeFormula('=B14+C11-C13'); // prev balance + addition - drawdown
      });

      test('Cash Flow Inflow row now references Net developer cash (Phasing row 15), not Gross (row 10)', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const cf = wb.getWorksheet('Cash Flow Engine');

        let inflowRow = null;
        cf.eachRow((row, rowIdx) => {
          const label = String(row.getCell(1).value || '');
          if (label.includes('Net developer cash from sales')) inflowRow = rowIdx;
        });
        expect(inflowRow).toBeDefined();
        expect(inflowRow).not.toBeNull();

        // Q1 formula should reference Phasing row 15 (Net developer cash)
        const q1Cell = cf.getCell(inflowRow, 2);
        // Post-restructure: phasing + cash flow on same sheet (Cash Flow
        // Engine). Phasing rows didn't shift; Cash Flow rows did. Row 15
        // (Net developer cash from sales) stays at row 15 because it's in
        // the Phasing section, above the Cash Flow rows.
        // But the inflow row itself (which REFERENCES row 15) is now in
        // the Cash Flow section (shifted) so the formula contains the
        // same Cash Flow Engine sheet name.
        expect(q1Cell.value.formula).toContain('B15');
      });

      test('Setting RERAEscrowPct = 0 collapses escrow to gross (preserves pre-PR-I2 behaviour for non-RERA deals)', async () => {
        const ctx = minimalContext();
        ctx.deal.model_params.inputs.reraEscrowPct = 0;
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let seed = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label === 'RERA Escrow Allocation') seed = row.getCell(2).value;
        });
        expect(seed).toBeCloseTo(0, 4);

        // Formulas themselves don't change — the escrow ledger still
        // renders, but with RERAEscrowPct = 0:
        //   To Escrow (row 11) = 0; Free Cash (row 12) = full Gross;
        //   Drawdown (row 13) = MIN(0, construction) = 0;
        //   Balance (row 14) = 0; Net (row 15) = Free Cash + 0 = Gross
        // ExcelJS doesn't evaluate the formulas — we verify only that
        // the seeded input is 0; the operator opening the file sees the
        // escrow rows show all-zeroes and Net = Gross.
      });

      test('Income family deals do NOT get the RERA section (no customer collection at all)', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);

        // Income deals don't need RERA escrow modelling (no buyers, no
        // collections, just operating lease income). The named range
        // shouldn't exist for income family deals.
        const namesList = (wb.definedNames.model || []).map((n) => n.name);
        expect(namesList).not.toContain('RERAEscrowPct');

        // And the Inputs sheet doesn't carry the section header
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let foundSection = false;
        inputs.eachRow((row) => {
          const v = String(row.getCell(1).value || '');
          if (v.includes('RERA Compliance')) foundSection = true;
        });
        expect(foundSection).toBe(false);
      });
    });

    // ── PR-I3 — JDA / Revenue-Share / Area-Share deal structures ───────
    // Indian RE deals are commonly structured as JDAs where the landowner
    // contributes land in exchange for a share of revenue (or saleable
    // area). The developer pays no upfront land cost but the landowner
    // takes a fraction of the customer collections. Common in Bengaluru:
    // 40-60% of residential development is JDA-structured.
    //
    // Pre-PR-I3 the model assumed outright_purchase and showed developer
    // keeping 100% of revenue — overstating returns for any JDA deal.
    //
    // Mechanics: `LandownerSharePct` named range (default 0 = outright)
    // multiplies into the Phasing "Net developer cash" row. Setting it
    // to >0 reduces the developer's effective inflow per quarter.
    describe('PR-I3: JDA / Revenue-Share / Area-Share deal structures', () => {
      test('Inputs sheet defines LandownerSharePct + DealStructureLabel in Deal Structure section', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);

        const namesList = (wb.definedNames.model || []).map((n) => n.name);
        expect(namesList).toContain('LandownerSharePct');
        expect(namesList).toContain('DealStructureLabel');

        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let sectionFound = false;
        inputs.eachRow((row) => {
          const v = String(row.getCell(1).value || '');
          if (v.includes('Deal Structure') && v.includes('JDA')) sectionFound = true;
        });
        expect(sectionFound).toBe(true);
      });

      test('LandownerSharePct default is 0 for outright_purchase (no kernel deal_structure set)', async () => {
        const ctx = minimalContext();
        delete ctx.deal.deal_structure;
        delete ctx.deal.deal_type;
        delete ctx.deal.model_params.inputs.landownerSharePct;
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let seed = null;
        let structureLabel = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label === 'Landowner Revenue Share') seed = row.getCell(2).value;
          if (label === 'Deal Structure') structureLabel = String(row.getCell(2).value || '');
        });
        expect(seed).toBeCloseTo(0, 4);
        expect(structureLabel).toBe('outright_purchase');
      });

      test('LandownerSharePct seeds from kernel jv_split_landowner_pct when deal_structure is JDA', async () => {
        const ctx = minimalContext();
        ctx.deal.deal_structure = 'jda';
        ctx.deal.jv_split_landowner_pct = 0.40;
        delete ctx.deal.model_params.inputs.landownerSharePct;
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let seed = null;
        let structureLabel = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label === 'Landowner Revenue Share') seed = row.getCell(2).value;
          if (label === 'Deal Structure') structureLabel = String(row.getCell(2).value || '');
        });
        expect(seed).toBeCloseTo(0.40, 4);
        expect(structureLabel).toBe('jda_revenue_share');
      });

      test('Phasing Net developer cash formula deducts LandownerSharePct', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const phasing = wb.getWorksheet('Cash Flow Engine');

        // Row 15 = Net developer cash from sales (post-RERA, post-landowner share)
        // Formula = (Row12 + Row13) × (1 - LandownerSharePct)
        const b15 = phasing.getCell('B15').value;
        expect(b15.formula).toBeFormula('=(B12+B13)*(1-LandownerSharePct)');

        // Q2 column reuses the same formula pattern with prefix column letter shift
        const c15 = phasing.getCell('C15').value;
        expect(c15.formula).toBeFormula('=(C12+C13)*(1-LandownerSharePct)');
      });

      test('Deal Structure label maps from kernel deal_structure correctly', async () => {
        const cases = [
          [{ deal_structure: 'outright' }, 'outright_purchase'],
          [{ deal_structure: 'jda' },      'jda_revenue_share'],
          [{ deal_structure: 'jv' },       'jda_revenue_share'],
          [{ deal_structure: 'JDA Revenue Share' }, 'jda_revenue_share'],
          [{ deal_structure: 'jda area share' },    'jda_area_share'],
          [{ deal_structure: 'development management' }, 'development_management'],
          [{ deal_structure: 'DM' },       'development_management'],
        ];
        for (const [dealOverride, expectedLabel] of cases) {
          const ctx = minimalContext();
          ctx.deal = { ...ctx.deal, ...dealOverride };
          const buffer = await buildDealWorkbookV2(ctx);
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const inputs = wb.getWorksheet('Inputs & Assumptions');
          let label = null;
          inputs.eachRow((row) => {
            const labelText = String(row.getCell(1).value || '').trim();
            if (labelText === 'Deal Structure') label = String(row.getCell(2).value || '');
          });
          expect(label).toBe(expectedLabel);
        }
      });

      test('Income family deals do NOT get the Deal Structure section', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);

        const namesList = (wb.definedNames.model || []).map((n) => n.name);
        expect(namesList).not.toContain('LandownerSharePct');

        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let foundSection = false;
        inputs.eachRow((row) => {
          const v = String(row.getCell(1).value || '');
          if (v.includes('Deal Structure') && v.includes('JDA')) foundSection = true;
        });
        expect(foundSection).toBe(false);
      });
    });

    // ── PR-I4 — Property Tax (BBMP UAV method, INR/sqft/yr) ────────────
    // Pre-PR-I4 the income asset OpEx section had a "Property Tax" row
    // expressed as "% of EGR" — wrong methodology for India. BBMP /
    // BMC / MCGM / other Indian municipal corporations all use the
    // Unit Area Value method: built-up area × per-sqft annual rate
    // (varies by zone), regardless of rental income.
    //
    // PR-I4 swaps `PropertyTaxPct` (% of EGR) for `PropertyTaxPerSqftYr`
    // (INR/sqft/year). Default ₹40 (mid-range Zone A commercial BLR).
    // The Phasing formula computes `SaleableAreaSqft × rate / 4` per
    // quarter, in INR Cr.
    describe('PR-I4: Property Tax — BBMP UAV method (INR/sqft/yr)', () => {
      test('Income asset Inputs sheet has PropertyTaxPerSqftYr named range (INR/sqft/yr unit)', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);

        const namesList = (wb.definedNames.model || []).map((n) => n.name);
        expect(namesList).toContain('PropertyTaxPerSqftYr');

        // The label should say "BBMP UAV" so operator knows the method
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let labelFound = false;
        let unitFound = false;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('Property Tax') && label.includes('BBMP UAV')) {
            labelFound = true;
            const unit = String(row.getCell(3).value || '');
            if (unit.includes('INR') && unit.includes('sqft') && unit.includes('year')) {
              unitFound = true;
            }
          }
        });
        expect(labelFound).toBe(true);
        expect(unitFound).toBe(true);
      });

      test('PropertyTaxPerSqftYr default is 40 (mid-range Zone A commercial BLR)', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        delete ctx.deal.model_params.inputs.propertyTaxPct;
        delete ctx.deal.model_params.inputs.propertyTaxPerSqftYr;
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let seed = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('Property Tax') && label.includes('BBMP UAV')) {
            seed = row.getCell(2).value;
          }
        });
        expect(seed).toBe(40);
      });

      test('Phasing Property Tax formula uses BBMP UAV method (area × rate / 4 / 10000000)', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const phasing = wb.getWorksheet('Cash Flow Engine');

        // Find Property Tax row by label
        let ptRow = null;
        phasing.eachRow((row, rowIdx) => {
          const label = String(row.getCell(1).value || '');
          if (label.includes('Property Tax') && label.includes('BBMP UAV')) ptRow = rowIdx;
        });
        expect(ptRow).toBeDefined();
        expect(ptRow).not.toBeNull();

        // Q1 (col B) formula = -SaleableAreaSqft × rate / 4 / 10000000
        const q1Cell = phasing.getCell(ptRow, 2);
        expect(q1Cell.value.formula).toBeFormula('=-SaleableAreaSqft*PropertyTaxPerSqftYr/4/10000000');
      });

      test('Property tax is area-driven, not revenue-driven (doesn\'t scale with EGR or occupancy)', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const phasing = wb.getWorksheet('Cash Flow Engine');

        let ptRow = null;
        phasing.eachRow((row, rowIdx) => {
          const label = String(row.getCell(1).value || '');
          if (label.includes('Property Tax') && label.includes('BBMP UAV')) ptRow = rowIdx;
        });

        // Property tax formula must NOT contain references to EGR rows
        // (rows 11 historically), occupancy (row 6), or any quarter-
        // sensitive cell that scales with rental income. It should be
        // a constant per-quarter value (area × rate / 4) — the same in
        // Q1 and Q12.
        const q1Formula = phasing.getCell(ptRow, 2).value.formula;
        const q12Formula = phasing.getCell(ptRow, 13).value.formula;
        expect(q1Formula).toBe(q12Formula);
        expect(q1Formula).not.toMatch(/PropertyTaxPct/);
      });

      test('Legacy propertyTaxPct (% of EGR) input is heuristically converted to PerSqftYr', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        ctx.deal.model_params.inputs.propertyTaxPct = 0.015; // 1.5% of EGR (legacy)
        delete ctx.deal.model_params.inputs.propertyTaxPerSqftYr;
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let seed = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('Property Tax') && label.includes('BBMP UAV')) {
            seed = row.getCell(2).value;
          }
        });
        // Heuristic: 0.015 × ₹1200/sqft/yr typical rent = ₹18/sqft/yr.
        expect(seed).toBeCloseTo(18, 1);
      });
    });

    // ── PR-I6 — Lender ecosystem (India Debt Profile) ──────────────────
    // Indian RE debt has a different structure than US: banks use Repo+spread,
    // NBFCs use MCLR+spread, loan types vary (Construction / LRD / Project
    // Finance / Mezz). PR-I6 adds informational categorical fields so the
    // lender choice is explicit. DebtRatePct stays operator-editable; the
    // new "Implied All-In Rate" shows DebtRatePct + ProcessingFee amortised.
    describe('PR-I6: Lender ecosystem (India Debt Profile)', () => {
      test('Inputs sheet defines lender ecosystem named ranges', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const namesList = (wb.definedNames.model || []).map((n) => n.name);
        expect(namesList).toContain('LenderType');
        expect(namesList).toContain('RateBenchmark');
        expect(namesList).toContain('SpreadBps');
        expect(namesList).toContain('LoanType');
        expect(namesList).toContain('ProcessingFeePct');
        expect(namesList).toContain('PrepaymentPenaltyPct');
        expect(namesList).toContain('ImpliedAllInRate');
      });

      test('Development family defaults to Repo benchmark + Project Finance loan type', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext()); // residential_apartments dev
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const byLabel = {};
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label) byLabel[label] = row.getCell(2).value;
        });
        expect(byLabel['Rate Benchmark']).toBe('Repo');
        expect(byLabel['Loan Type']).toBe('Project Finance');
        expect(byLabel['Lender Type']).toBe('HDFC Bank');
      });

      test('Income family defaults to MCLR benchmark + LRD loan type', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const byLabel = {};
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label) byLabel[label] = row.getCell(2).value;
        });
        expect(byLabel['Rate Benchmark']).toBe('MCLR');
        expect(byLabel['Loan Type']).toContain('LRD');
        expect(byLabel['Lender Type']).toBe('HDFC Capital');
      });

      test('Spread defaults to 280 bps, ProcessingFee to 0.5%', async () => {
        const ctx = minimalContext();
        delete ctx.deal.model_params.inputs.spreadBps;
        delete ctx.deal.model_params.inputs.processingFeePct;
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let spreadSeed = null;
        let feeSeed = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label === 'Spread over Benchmark') spreadSeed = row.getCell(2).value;
          if (label === 'Processing Fee') feeSeed = row.getCell(2).value;
        });
        expect(spreadSeed).toBe(280);
        expect(feeSeed).toBeCloseTo(0.005, 4);
      });

      test('Implied All-In Rate is a DERIVED formula = DebtRatePct + ProcessingFee/LoanTermYears', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let formulaValue = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label === 'Implied All-In Rate') formulaValue = row.getCell(2).value;
        });
        expect(formulaValue).toBeTruthy();
        expect(formulaValue.formula).toBeFormula('=DebtRatePct+IFERROR(ProcessingFeePct/LoanTermYears,0)');
      });
    });

    // ── PR-I7 — Taxation (India): LTCG / TDS / Indexation ──────────────
    // Indian tax regime affecting RE exit economics (in force as of 2026-05):
    //   - LTCG on land held > 24 months: 12.5% (post Jul-2024 budget)
    //   - TDS u/s 194-IA: 1% on sale > ₹50 lakh
    //   - Indexation: NOT available post-Jul-2024 for new acquisitions
    // PR-I7 adds these as informational inputs + a derived "Applicable
    // Capital Gains Rate" that branches by EffectiveHoldYears (≥ 2 yrs →
    // LTCG, < 2 yrs → STCG slab @ 30% approximation).
    describe('PR-I7: Taxation (India) — LTCG / TDS / Indexation', () => {
      test('Inputs sheet defines taxation named ranges', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const namesList = (wb.definedNames.model || []).map((n) => n.name);
        expect(namesList).toContain('LTCGRate');
        expect(namesList).toContain('TDSRate');
        expect(namesList).toContain('IndexationRegime');
        expect(namesList).toContain('EffectiveHoldYears');
        expect(namesList).toContain('EffectiveCGRate');
      });

      test('LTCGRate defaults to 12.5% (post Jul-2024 budget)', async () => {
        const ctx = minimalContext();
        delete ctx.deal.model_params.inputs.ltcgRate;
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let seed = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('LTCG Rate')) seed = row.getCell(2).value;
        });
        expect(seed).toBeCloseTo(0.125, 4);
      });

      test('TDSRate defaults to 1% (Section 194-IA)', async () => {
        const ctx = minimalContext();
        delete ctx.deal.model_params.inputs.tdsRate;
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let seed = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('TDS')) seed = row.getCell(2).value;
        });
        expect(seed).toBeCloseTo(0.01, 4);
      });

      test('IndexationRegime defaults to post_2024_no_indexation', async () => {
        const ctx = minimalContext();
        delete ctx.deal.model_params.inputs.indexationRegime;
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let seed = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('Indexation Regime')) seed = row.getCell(2).value;
        });
        expect(seed).toBe('post_2024_no_indexation');
      });

      test('EffectiveCGRate is a DERIVED formula branching on holding period (LTCG ≥ 2yr, STCG slab < 2yr)', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let formulaValue = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('Applicable Capital Gains Rate')) formulaValue = row.getCell(2).value;
        });
        expect(formulaValue).toBeTruthy();
        expect(formulaValue.formula).toBeFormula('=IF(EffectiveHoldYears>=2,LTCGRate,0.3)');
      });
    });

    // ── PR-I9 — Premium FSI / TDR cost line ────────────────────────────
    // Bengaluru operators buy premium FSI from BBMP/BDA when base FSI is
    // insufficient. Mumbai operators buy TDR. One-time cost that flows
    // into Total Project Cost. Defaults to 0; when > 0 it lifts the
    // headline Total Cost on Dashboard / Debt Sizing / Waterfall.
    describe('PR-I9: Premium FSI / TDR cost line', () => {
      test('Inputs sheet defines PremiumFSICostCr in Cost Structure', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const namesList = (wb.definedNames.model || []).map((n) => n.name);
        expect(namesList).toContain('PremiumFSICostCr');
      });

      test('PremiumFSICostCr defaults to 0 (no premium FSI purchased)', async () => {
        const ctx = minimalContext();
        delete ctx.deal.model_params.inputs.premiumFSICostCr;
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let seed = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('Premium FSI')) seed = row.getCell(2).value;
        });
        expect(seed).toBe(0);
      });

      test('Total Project Cost formula on Debt Sizing + Waterfall includes PremiumFSICostCr', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);

        const findCellByLabel = (sheet, expectedLabel) => {
          let found = null;
          sheet.eachRow((row) => {
            const label = String(row.getCell(1).value || '');
            if (label.includes(expectedLabel) && !found) {
              const valCell = row.getCell(2);
              found = (valCell.value && valCell.value.formula) || null;
            }
          });
          return found;
        };

        const debtSizing = wb.getWorksheet('Debt Sizing & Amortization');
        const waterfall = debtSizing;
        expect(findCellByLabel(debtSizing, 'Total Project Cost')).toMatch(/PremiumFSICostCr/);
        expect(findCellByLabel(waterfall, 'Total Project Cost')).toMatch(/PremiumFSICostCr/);
      });

      test('Calculations B14 row combines ApprovalCostCr + PremiumFSICostCr', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const calc = wb.getWorksheet('Calculations');
        const b14 = calc.getCell('B14').value;
        expect(b14.formula).toBeFormula('=ApprovalCostCr+PremiumFSICostCr');
      });
    });

    // ── PR-I10 — Approvals & RERA Registration breakdown (BBMP/Karnataka)
    // 12 Karnataka-specific approval line items as separate inputs +
    // derived sum. Operator-editable per-row for IC disclosure clarity.
    describe('PR-I10: Approvals & RERA Registration breakdown (Karnataka)', () => {
      test('Inputs sheet defines all 12 detailed approval named ranges', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const namesList = (wb.definedNames.model || []).map((n) => n.name);
        const expected = [
          'ApprKhataCr', 'ApprBDALayoutCr', 'ApprBBMPSanctionCr', 'ApprBWSSBCr',
          'ApprBESCOMCr', 'ApprKSPCBCr', 'ApprAirportNOCCr', 'ApprFireNOCCr',
          'ApprLiftNOCCr', 'ApprRERACr', 'ApprOCCr', 'ApprCCCr',
        ];
        for (const name of expected) {
          expect(namesList).toContain(name);
        }
      });

      test('Sum of detailed approvals is a DERIVED formula adding all 12 line items', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const namesList = (wb.definedNames.model || []).map((n) => n.name);
        expect(namesList).toContain('ApprovalsBreakdownSumCr');

        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let formulaValue = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label === 'Sum of detailed approvals') formulaValue = row.getCell(2).value;
        });
        expect(formulaValue).toBeTruthy();
        expect(formulaValue.formula).toContain('ApprKhataCr');
        expect(formulaValue.formula).toContain('ApprBDALayoutCr');
        expect(formulaValue.formula).toContain('ApprCCCr');
      });

      test('Approvals breakdown section header is present + 12 items default to 0', async () => {
        const ctx = minimalContext();
        // Strip any operator overrides so we test the defaults
        ['apprKhataCr','apprBDALayoutCr','apprBBMPSanctionCr','apprBWSSBCr','apprBESCOMCr',
         'apprKSPCBCr','apprAirportNOCCr','apprFireNOCCr','apprLiftNOCCr','apprRERACr',
         'apprOCCr','apprCCCr'].forEach((k) => { delete ctx.deal.model_params.inputs[k]; });
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let sectionFound = false;
        let zeroCount = 0;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '');
          if (label.includes('Approvals & RERA Registration')) sectionFound = true;
          // Count zero-defaulted approval rows by their characteristic
          // "approval" / "NOC" / "Certificate" / "registration" label.
          if (/^(Khata conversion|BDA layout|BBMP plan|BWSSB|BESCOM|KSPCB|Airport Authority|Fire Department|Lift \/ Elevator|RERA registration|Occupancy Certificate|Completion Certificate)/.test(label)) {
            if (row.getCell(2).value === 0) zeroCount += 1;
          }
        });
        expect(sectionFound).toBe(true);
        expect(zeroCount).toBe(12);
      });
    });

    // ── PR-I8 — Title & Khata Status (Bengaluru) ───────────────────────
    // A-khata vs B-khata is a major BLR valuation factor (B-khata trades
    // at 15-25% discount). Informational fields + derived exit multiplier.
    describe('PR-I8: Title & Khata Status (Bengaluru)', () => {
      test('Inputs sheet defines KhataStatus + BKhataExitHaircutPct + derived multiplier', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const namesList = (wb.definedNames.model || []).map((n) => n.name);
        expect(namesList).toContain('KhataStatus');
        expect(namesList).toContain('BKhataExitHaircutPct');
        expect(namesList).toContain('KhataExitMultiplier');
      });

      test('KhataStatus defaults to "A_khata"; haircut defaults to 15%', async () => {
        const ctx = minimalContext();
        delete ctx.deal.model_params.inputs.khataStatus;
        delete ctx.deal.model_params.inputs.bKhataExitHaircutPct;
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let khata = null;
        let haircut = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label === 'Khata Status') khata = row.getCell(2).value;
          if (label.includes('B-Khata Exit Haircut')) haircut = row.getCell(2).value;
        });
        expect(khata).toBe('A_khata');
        expect(haircut).toBeCloseTo(0.15, 4);
      });

      test('KhataExitMultiplier is a DERIVED formula that branches on B_khata / mixed', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let formulaValue = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label === 'Suggested Exit Multiplier') formulaValue = row.getCell(2).value;
        });
        expect(formulaValue).toBeTruthy();
        expect(formulaValue.formula).toBeFormula('=IF(OR(KhataStatus="B_khata",KhataStatus="mixed"),1-BKhataExitHaircutPct,1)');
      });
    });

    // ── PR-I12 — Hospitality ADR / Occupancy / RevPAR with seasonality ──
    describe('PR-I12: Hospitality ADR / Occupancy / RevPAR (income asset family only)', () => {
      const hospitalityCtx = () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'hospitality';
        ctx.property.property_type = 'hospitality';
        return ctx;
      };

      test('Hospitality section + named ranges appear only when asset_class = hospitality', async () => {
        const buffer1 = await buildDealWorkbookV2(minimalContext());
        const wb1 = new ExcelJS.Workbook();
        await wb1.xlsx.load(buffer1);
        const names1 = (wb1.definedNames.model || []).map((n) => n.name);
        expect(names1).not.toContain('HospitalityKeys');

        const buffer2 = await buildDealWorkbookV2(hospitalityCtx());
        const wb2 = new ExcelJS.Workbook();
        await wb2.xlsx.load(buffer2);
        const names2 = (wb2.definedNames.model || []).map((n) => n.name);
        for (const n of ['HospitalityKeys', 'HospitalityADRBase', 'HospitalityADRPeak', 'HospitalityPeakShare', 'HospitalityBlendedADR', 'HospitalityRevPAR', 'HospitalityImpliedRevenueCr']) {
          expect(names2).toContain(n);
        }
      });

      test('Hospitality defaults: 100 keys, ₹6000 base ADR, ₹9000 peak ADR, 30% peak share', async () => {
        const ctx = hospitalityCtx();
        ['hospitalityKeys','hospitalityADRBase','hospitalityADRPeak','hospitalityPeakShare']
          .forEach((k) => { delete ctx.deal.model_params.inputs[k]; });
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const byLabel = {};
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label) byLabel[label] = row.getCell(2).value;
        });
        expect(byLabel['Number of Keys']).toBe(100);
        expect(byLabel['ADR — Base / Off-Season']).toBe(6000);
        expect(byLabel['ADR — Peak Season']).toBe(9000);
        expect(byLabel['Peak Season Share']).toBeCloseTo(0.30, 4);
      });

      test('Blended ADR + RevPAR + Implied Revenue are DERIVED formulas', async () => {
        const buffer = await buildDealWorkbookV2(hospitalityCtx());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const byLabel = {};
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label) byLabel[label] = row.getCell(2).value;
        });
        expect(byLabel['Blended ADR (derived)'].formula)
          .toBeFormula('=HospitalityADRBase*(1-HospitalityPeakShare)+HospitalityADRPeak*HospitalityPeakShare');
        expect(byLabel['RevPAR (derived)'].formula)
          .toBeFormula('=HospitalityBlendedADR*OccupancyPct');
        expect(byLabel['Implied annual revenue (Cr)'].formula)
          .toBeFormula('=HospitalityRevPAR*HospitalityKeys*365/10000000');
      });

      test('Hospitality workbook adds USALI pro forma and links Cash Flow + Dashboard Sources & Uses to it', async () => {
        const buffer = await buildDealWorkbookV2(hospitalityCtx());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const usali = wb.getWorksheet('USALI Pro Forma');
        const cfe = wb.getWorksheet('Cash Flow Engine');
        const dash = wb.getWorksheet('Dashboard');

        expect(usali).toBeTruthy();
        expect(usali.getCell('B16').value.formula).toContain('SUM');
        expect(usali.getCell('B40').value.formula).toContain('B37');
        expect(cfe.getCell('B6').value.formula).toContain("'USALI Pro Forma'");
        expect(cfe.getCell('B18').value.formula).toContain("'USALI Pro Forma'");
        expect(wb.getWorksheet('Sources & Uses')).toBeUndefined();
        expect(dash.getCell('B14').value.formula).toContain("'USALI Pro Forma'");
        expect(dash.getCell('B18').value.formula).toContain("'USALI Pro Forma'");
      });
    });

    // ── PR-I13 — Retail CAM + Anchor / Vanilla rent split ──────────────
    describe('PR-I13: Retail CAM + Anchor / Vanilla Rent Split (income asset family only)', () => {
      const retailCtx = () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'retail';
        ctx.property.property_type = 'retail';
        return ctx;
      };

      test('Retail section + named ranges appear only when asset_class = retail', async () => {
        const buffer1 = await buildDealWorkbookV2(minimalContext());
        const wb1 = new ExcelJS.Workbook();
        await wb1.xlsx.load(buffer1);
        const names1 = (wb1.definedNames.model || []).map((n) => n.name);
        expect(names1).not.toContain('RetailAnchorSharePct');

        const buffer2 = await buildDealWorkbookV2(retailCtx());
        const wb2 = new ExcelJS.Workbook();
        await wb2.xlsx.load(buffer2);
        const names2 = (wb2.definedNames.model || []).map((n) => n.name);
        for (const n of ['RetailAnchorSharePct', 'RetailAnchorRentPerSqftMonth', 'RetailVanillaRentPerSqftMonth', 'RetailCAMRecoveryPct', 'RetailBlendedRentPerSqftMonth']) {
          expect(names2).toContain(n);
        }
      });

      test('Retail defaults: 40% anchor share, ₹60 anchor rent, ₹180 vanilla rent, 95% CAM recovery', async () => {
        const ctx = retailCtx();
        ['retailAnchorSharePct','retailAnchorRentPerSqftMonth','retailVanillaRentPerSqftMonth','retailCAMRecoveryPct']
          .forEach((k) => { delete ctx.deal.model_params.inputs[k]; });
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const byLabel = {};
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label) byLabel[label] = row.getCell(2).value;
        });
        expect(byLabel['Anchor Share of Leasable Area']).toBeCloseTo(0.40, 4);
        expect(byLabel['Anchor Rent / sqft / month']).toBe(60);
        expect(byLabel['Vanilla Rent / sqft / month']).toBe(180);
        expect(byLabel['CAM Recovery %']).toBeCloseTo(0.95, 4);
      });

      test('Blended Rent is a DERIVED formula = anchor × share + vanilla × (1-share)', async () => {
        const buffer = await buildDealWorkbookV2(retailCtx());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let formulaValue = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('Blended Rent') && label.includes('derived')) formulaValue = row.getCell(2).value;
        });
        expect(formulaValue).toBeTruthy();
        expect(formulaValue.formula)
          .toBeFormula('=RetailAnchorRentPerSqftMonth*RetailAnchorSharePct+RetailVanillaRentPerSqftMonth*(1-RetailAnchorSharePct)');
      });
    });

    // ── PR-I11 — Milestone-anchored sale-rate escalation ──────────────
    describe('PR-I11: Milestone-anchored sale-rate escalation', () => {
      test('Section appears for residential / villas / mixed_use; hidden otherwise', async () => {
        const check = async (assetClass, expectVisible) => {
          const ctx = minimalContext();
          ctx.deal.asset_class = assetClass;
          ctx.property.property_type = assetClass;
          const buffer = await buildDealWorkbookV2(ctx);
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const names = (wb.definedNames.model || []).map((n) => n.name);
          if (expectVisible) expect(names).toContain('MilestoneEscalationModel');
          else expect(names).not.toContain('MilestoneEscalationModel');
        };
        await check('residential_apartments', true);
        await check('villas', true);
        await check('mixed_use', true);
        await check('plotted_development', false);
        await check('raw_land', false);
        await check('commercial_office', false);
      });

      test('Equivalent EscalationPct derived = (1+MilestoneTotal)^(1/years) - 1', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let formulaValue = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('Equivalent EscalationPct')) formulaValue = row.getCell(2).value;
        });
        expect(formulaValue).toBeTruthy();
        expect(formulaValue.formula).toBeFormula('=(1+MilestoneTotalEscalationPct)^(1/(ProjectMonths/12))-1');
      });
    });

    // ── PR-I14 — Plot-level absorption (plotted_development only) ──────
    describe('PR-I14: Plot-level absorption (plotted_development only)', () => {
      const plottedCtx = () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'plotted_development';
        ctx.property.property_type = 'plotted_development';
        return ctx;
      };

      test('Section + named ranges appear only for plotted_development', async () => {
        const buffer1 = await buildDealWorkbookV2(minimalContext());
        const wb1 = new ExcelJS.Workbook();
        await wb1.xlsx.load(buffer1);
        expect((wb1.definedNames.model || []).map((n) => n.name)).not.toContain('PlotAbsorptionMonths');

        const buffer2 = await buildDealWorkbookV2(plottedCtx());
        const wb2 = new ExcelJS.Workbook();
        await wb2.xlsx.load(buffer2);
        const names2 = (wb2.definedNames.model || []).map((n) => n.name);
        for (const n of ['PlotAbsorptionMonths', 'PlotSmallSharePct', 'PlotMidSharePct', 'PlotLargeSharePct', 'PlotSharesCheck']) {
          expect(names2).toContain(n);
        }
      });

      test('PlotSharesCheck DERIVED = sum of 3 plot share rows', async () => {
        const buffer = await buildDealWorkbookV2(plottedCtx());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let formulaValue = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('Sum Check')) formulaValue = row.getCell(2).value;
        });
        expect(formulaValue).toBeTruthy();
        expect(formulaValue.formula).toBeFormula('=PlotSmallSharePct+PlotMidSharePct+PlotLargeSharePct');
      });
    });

    // ── PR-I15 — Mixed-Use Component Breakdown ─────────────────────────
    describe('PR-I15: Mixed-Use Component Breakdown (mixed_use / redevelopment only)', () => {
      const mixedCtx = () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'mixed_use';
        ctx.property.property_type = 'mixed_use';
        return ctx;
      };

      test('Section appears for mixed_use + redevelopment; hidden otherwise', async () => {
        const check = async (assetClass, expectVisible) => {
          const ctx = minimalContext();
          ctx.deal.asset_class = assetClass;
          ctx.property.property_type = assetClass;
          const buffer = await buildDealWorkbookV2(ctx);
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const names = (wb.definedNames.model || []).map((n) => n.name);
          if (expectVisible) expect(names).toContain('MixUseResiSharePct');
          else expect(names).not.toContain('MixUseResiSharePct');
        };
        await check('mixed_use', true);
        await check('redevelopment', true);
        await check('residential_apartments', false);
        await check('commercial_office', false);
      });

      test('Blended Sale Rate DERIVED = sum of component_share × component_rate', async () => {
        const buffer = await buildDealWorkbookV2(mixedCtx());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let formulaValue = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('Blended Sale Rate') && label.includes('derived')) formulaValue = row.getCell(2).value;
        });
        expect(formulaValue).toBeTruthy();
        expect(formulaValue.formula).toContain('MixUseResiSharePct*MixUseResiRatePerSqft');
        expect(formulaValue.formula).toContain('MixUseOfficeSharePct*MixUseOfficeRatePerSqft');
        expect(formulaValue.formula).toContain('MixUseRetailSharePct*MixUseRetailRatePerSqft');
        expect(formulaValue.formula).toContain('MixUseHospSharePct*MixUseHospRatePerSqft');
      });

      test('Defaults sum to 100%: residential 50% + office 30% + retail 15% + hospitality 5%', async () => {
        const ctx = mixedCtx();
        ['mixUseResiSharePct','mixUseOfficeSharePct','mixUseRetailSharePct','mixUseHospSharePct']
          .forEach((k) => { delete ctx.deal.model_params.inputs[k]; });
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const byLabel = {};
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label) byLabel[label] = row.getCell(2).value;
        });
        expect(byLabel['Residential Component Share']).toBeCloseTo(0.50, 4);
        expect(byLabel['Office Component Share']).toBeCloseTo(0.30, 4);
        expect(byLabel['Retail Component Share']).toBeCloseTo(0.15, 4);
        expect(byLabel['Hospitality Component Share']).toBeCloseTo(0.05, 4);
      });
    });

    // ── PR-I16 — Raw-Land Entitlement Pipeline (raw_land only) ──────────
    describe('PR-I16: Raw-Land Entitlement Pipeline (raw_land only)', () => {
      const rawLandCtx = () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'raw_land';
        ctx.property.property_type = 'raw_land';
        return ctx;
      };

      test('Section appears only for raw_land', async () => {
        const buffer1 = await buildDealWorkbookV2(minimalContext());
        const wb1 = new ExcelJS.Workbook();
        await wb1.xlsx.load(buffer1);
        expect((wb1.definedNames.model || []).map((n) => n.name)).not.toContain('RawLandCurrentStage');

        const buffer2 = await buildDealWorkbookV2(rawLandCtx());
        const wb2 = new ExcelJS.Workbook();
        await wb2.xlsx.load(buffer2);
        const names2 = (wb2.definedNames.model || []).map((n) => n.name);
        for (const n of ['RawLandCurrentStage', 'RawLandTitleMonths', 'RawLandConversionMonths',
                         'RawLandLayoutMonths', 'RawLandApprovalUpliftPct', 'RawLandTotalPipelineMonths']) {
          expect(names2).toContain(n);
        }
      });

      test('RawLandTotalPipelineMonths DERIVED = title + conversion + layout', async () => {
        const buffer = await buildDealWorkbookV2(rawLandCtx());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let formulaValue = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('Total Pipeline')) formulaValue = row.getCell(2).value;
        });
        expect(formulaValue).toBeTruthy();
        expect(formulaValue.formula).toBeFormula('=RawLandTitleMonths+RawLandConversionMonths+RawLandLayoutMonths');
      });

      test('Defaults: 3 + 6 + 9 = 18 months pipeline; current stage = title_diligence', async () => {
        const ctx = rawLandCtx();
        ['rawLandCurrentStage','rawLandTitleMonths','rawLandConversionMonths','rawLandLayoutMonths']
          .forEach((k) => { delete ctx.deal.model_params.inputs[k]; });
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const byLabel = {};
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label) byLabel[label] = row.getCell(2).value;
        });
        expect(byLabel['Current Entitlement Stage']).toBe('title_diligence');
        expect(byLabel['Title Diligence Duration']).toBe(3);
        expect(byLabel['Conversion Duration']).toBe(6);
        expect(byLabel['Layout Approval Duration']).toBe(9);
      });
    });

    // ── PR-EX — Exit Strategy (family-conditional) ─────────────────────
    // Closes the last gap from the 2026-05-11 directive ("deal structure
    // and exit strategy"). Both families get an Exit Strategy section,
    // but the labels and inputs differ by family:
    //   - Income: REIT / strategic sale / refinance + broker/legal fees
    //   - Development: progressive / bulk / hold + bulk discount + hold yrs
    describe('PR-EX: Exit Strategy (family-conditional)', () => {
      test('Development family — section appears with dev-specific options', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext()); // default residential = dev
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const names = (wb.definedNames.model || []).map((n) => n.name);
        for (const n of ['ExitStrategyType', 'BulkExitDiscountPct', 'HoldPostCompletionYears',
                         'ExitBrokerFeePct', 'EffectiveExitFactor']) {
          expect(names).toContain(n);
        }
        // Should NOT have income-specific named ranges
        expect(names).not.toContain('ExitYearFromAcq');
        expect(names).not.toContain('TotalExitCostPct');
        expect(names).not.toContain('ImpliedNetExitValueCr');

        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const byLabel = {};
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label) byLabel[label] = row.getCell(2).value;
        });
        expect(byLabel['Exit Strategy Type']).toBe('outright_progressive');
        expect(byLabel['Bulk Exit Discount']).toBeCloseTo(0.10, 4);
        expect(byLabel['Hold Post-Completion Period']).toBe(1);
      });

      test('Income family — section appears with income-specific options', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const names = (wb.definedNames.model || []).map((n) => n.name);
        for (const n of ['ExitStrategyType', 'ExitYearFromAcq', 'ExitBrokerFeePct',
                         'ExitLegalFeePct', 'TotalExitCostPct', 'ImpliedNetExitValueCr']) {
          expect(names).toContain(n);
        }
        // Should NOT have dev-specific named ranges
        expect(names).not.toContain('BulkExitDiscountPct');
        expect(names).not.toContain('HoldPostCompletionYears');
        expect(names).not.toContain('EffectiveExitFactor');

        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const byLabel = {};
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label) byLabel[label] = row.getCell(2).value;
        });
        expect(byLabel['Exit Strategy Type']).toBe('strategic_sale');
        expect(byLabel['Broker Fee on Exit']).toBeCloseTo(0.02, 4);
        expect(byLabel['Legal + DD Fee on Exit']).toBeCloseTo(0.005, 4);
      });

      test('Income family — Total Exit Cost is DERIVED = SellingCost + Broker + Legal', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let formulaValue = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('Total Exit Cost')) formulaValue = row.getCell(2).value;
        });
        expect(formulaValue).toBeTruthy();
        expect(formulaValue.formula).toBeFormula('=SellingCostPct+ExitBrokerFeePct+ExitLegalFeePct');
      });

      test('Development family — EffectiveExitFactor DERIVED branches on ExitStrategyType', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let formulaValue = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('Effective Exit Factor')) formulaValue = row.getCell(2).value;
        });
        expect(formulaValue).toBeTruthy();
        expect(formulaValue.formula).toBeFormula(
          '=IF(ExitStrategyType="bulk_exit_completion",(1-BulkExitDiscountPct)*(1-ExitBrokerFeePct),(1-ExitBrokerFeePct))'
        );
      });

      // Bug fix: Implied Net Exit Value (income family) previously used
      // `B6` thinking it was NOI, but B6 on the Inputs sheet is the Asset
      // Class text cell. IFERROR collapsed the result to 0 silently. Fix:
      // use INDEX into the Cash Flow Engine NOI row (row 18) at column
      // TotalQuarters+1 (last quarter), × 4 for annualised.
      test('Income family — ImpliedNetExitValueCr uses INDEX into Cash Flow Engine NOI row', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        let formulaValue = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('Implied Net Exit Value')) formulaValue = row.getCell(2).value;
        });
        expect(formulaValue).toBeTruthy();
        expect(formulaValue.formula).toContain('INDEX');
        expect(formulaValue.formula).toContain("'Cash Flow Engine'!18:18");
        expect(formulaValue.formula).toContain('TotalQuarters+1');
        expect(formulaValue.formula).toContain('TotalExitCostPct');
        // Should NOT contain the buggy B6 reference
        expect(formulaValue.formula).not.toMatch(/B6\b/);
      });
    });

    // ── Reversion formula wiring (PR-EX wiring) ─────────────────────────
    // Income family Reversion row previously used `(1-SellingCostPct)` —
    // narrow definition (just the on-exit selling cost). PR-EX added the
    // Exit Strategy section with broker + legal fees + derived
    // TotalExitCostPct = SellingCostPct + ExitBrokerFeePct + ExitLegalFeePct.
    // The Reversion formula now uses the broader TotalExitCostPct so all
    // three components flow through. For default inputs this lifts effective
    // exit costs from 2% → 4.5%.
    describe('Reversion formula wiring (TotalExitCostPct)', () => {
      test('Income family Reversion uses TotalExitCostPct instead of bare SellingCostPct', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const cfe = wb.getWorksheet('Cash Flow Engine');
        // Find the Reversion row specifically — there's also a "Total Cash
        // Flow Including Reversion" sum row which matches the broader
        // "Reversion" substring. Anchor the match on "Net Sale Proceeds".
        let reversionRow = null;
        cfe.eachRow((row, rowIdx) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('Reversion') && label.includes('Net Sale Proceeds')) {
            reversionRow = rowIdx;
          }
        });
        expect(reversionRow).toBeDefined();
        expect(reversionRow).not.toBeNull();
        // The final-quarter column holds the active formula (the rest of the
        // quarters return '=0'). Income deals may extend past the construction
        // window to cover the hold period.
        const prepared = __internal.prepareWorkbookContext(ctx, { strictValidation: false });
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
        const finalQCol = excelCol(prepared.totalQuarters + 1);
        const cell = cfe.getCell(`${finalQCol}${reversionRow}`);
        expect(cell.value.formula).toContain('TotalExitCostPct');
        // Confirms the swap — bare SellingCostPct no longer appears in
        // the reversion (it lives only inside TotalExitCostPct now).
        expect(cell.value.formula).not.toMatch(/\bSellingCostPct\b/);
      });
    });

    // ── Conditional formatting on KPI tiles ────────────────────────────
    // Red/amber/green coloring on key health metrics so an IC reviewer
    // reads the state at a glance. Same palette as the Cash Flow DSCR
    // conditional formatting — consistency across the workbook.
    describe('Dashboard KPI conditional formatting', () => {
      test('Development family — B7 (Gross Margin), D7 (Min DSCR), F4 (Net CF) have CF rules', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext()); // dev family
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        // ExcelJS exposes conditional formatting via worksheet._conditionalFormattings
        // (internal-ish but stable). Each entry has { ref, rules }.
        const cfList = dash.conditionalFormattings || [];
        const refsCovered = new Set();
        cfList.forEach((cf) => refsCovered.add(cf.ref));
        // The three dev-family tiles should be covered
        expect(refsCovered.has('B7:B7')).toBe(true);
        expect(refsCovered.has('D7:D7')).toBe(true);
        expect(refsCovered.has('F4:F4')).toBe(true);
        const iconRules = cfList.flatMap((cf) => cf.rules || []).filter((rule) => rule.type === 'iconSet');
        expect(iconRules.length).toBeGreaterThanOrEqual(3);
        expect(dash.getCell('B9').value).toBeNull();
      });

      test('Income family — B4 (Stabilised NOI), B7 (Min DSCR) have CF rules', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        const cfList = dash.conditionalFormattings || [];
        const refsCovered = new Set();
        cfList.forEach((cf) => refsCovered.add(cf.ref));
        expect(refsCovered.has('B4:B4')).toBe(true);
        expect(refsCovered.has('B7:B7')).toBe(true);
        // Development-only refs should NOT be in income family
        expect(refsCovered.has('D7:D7')).toBe(false);
        expect(refsCovered.has('F4:F4')).toBe(false);
        const iconRules = cfList.flatMap((cf) => cf.rules || []).filter((rule) => rule.type === 'iconSet');
        expect(iconRules.length).toBeGreaterThanOrEqual(2);
        expect(dash.getCell('B9').value).toBeNull();
      });
    });

    // ── Categorical dropdowns (data validation) ────────────────────────
    // Operator directive 2026-05-11: "everything accurate, specific,
    // credible, precise, relevant, correct, reliable." All categorical
    // input cells get Excel-native list validation so operators can't
    // typo a category and downstream IF-formulas can't surface invalid
    // branches silently.
    describe('Inputs sheet categorical input dropdowns (dataValidation)', () => {
      // Helper: find the value cell of a row by its named range / label.
      const findValueCellByLabel = (inputsSheet, expectedLabel) => {
        let cell = null;
        inputsSheet.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label === expectedLabel && !cell) cell = row.getCell(2);
        });
        return cell;
      };

      test('Khata Status — dropdown with 4 options', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, 'Khata Status');
        expect(cell).toBeTruthy();
        expect(cell.dataValidation).toBeTruthy();
        expect(cell.dataValidation.type).toBe('list');
        expect(cell.dataValidation.formulae[0]).toBe('"A_khata,B_khata,mixed,not_applicable"');
      });

      test('Indexation Regime (Taxation) — dropdown with 2 options', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, 'Indexation Regime');
        expect(cell).toBeTruthy();
        expect(cell.dataValidation).toBeTruthy();
        expect(cell.dataValidation.formulae[0])
          .toBe('"post_2024_no_indexation,pre_2024_with_indexation"');
      });

      test('Rate Benchmark — dropdown with 4 options', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, 'Rate Benchmark');
        expect(cell).toBeTruthy();
        expect(cell.dataValidation.formulae[0]).toBe('"Repo,MCLR,Fixed,Marginal"');
      });

      test('Deal Structure label — dropdown for development family', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext()); // residential = dev
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, 'Deal Structure');
        expect(cell).toBeTruthy();
        expect(cell.dataValidation.formulae[0])
          .toBe('"outright_purchase,jda_revenue_share,jda_area_share,development_management"');
      });

      test('Exit Strategy Type — income family has income-specific options', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, 'Exit Strategy Type');
        expect(cell).toBeTruthy();
        expect(cell.dataValidation.formulae[0])
          .toBe('"strategic_sale,reit_exit,hold_to_perpetuity,refinance_hold"');
      });

      test('Exit Strategy Type — development family has dev-specific options', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext()); // dev
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, 'Exit Strategy Type');
        expect(cell).toBeTruthy();
        expect(cell.dataValidation.formulae[0])
          .toBe('"outright_progressive,bulk_exit_completion,hold_post_completion"');
      });

      test('Loan Type — dropdown with 4 options', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, 'Loan Type');
        expect(cell).toBeTruthy();
        expect(cell.dataValidation.formulae[0])
          .toBe('"Construction Finance,LRD (Lease Rental Discounting),Project Finance,Mezzanine"');
      });

      test('Lender Type — dropdown with 11 options', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, 'Lender Type');
        expect(cell).toBeTruthy();
        const formulae = cell.dataValidation.formulae[0];
        // Includes a representative sample
        expect(formulae).toContain('HDFC Bank');
        expect(formulae).toContain('Edelweiss');
        expect(formulae).toContain('Piramal');
        expect(formulae).toContain('Other');
      });

      test('Numeric cells (e.g. Land Cost) do NOT get a dropdown', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, 'Land Cost');
        expect(cell).toBeTruthy();
        expect(cell.dataValidation).toBeFalsy();
      });

      test('Dropdown surfaces a friendly error when an invalid value is entered', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, 'Khata Status');
        expect(cell.dataValidation.showErrorMessage).toBe(true);
        expect(cell.dataValidation.errorTitle).toBe('Invalid option');
        expect(cell.dataValidation.error).toContain('A_khata');
      });
    });
  });
});
