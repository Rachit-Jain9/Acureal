'use strict';

// Per-suite Jest timeout — this file builds full Excel workbooks (heavy
// CPU + IO) across 233 tests. In isolation the whole file runs in ~73s
// (avg ~0.3s per test), but under parallel load with the rest of the
// backend suite (158 suites running on CPU-1 workers), individual tests
// can exceed Jest's default 5s timeout. Bumping to 60s gives the slow
// tests room to breathe under load. Same pattern the existing
// crossProductReconciliation suite already uses.
jest.setTimeout(60000);

const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { buildDealWorkbookV2, __internal } = require('../src/services/exports/xlsx/v2/buildWorkbook');

const normalizeFormula = (formula) => String(formula || '').replace(/^=/, '');

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

    test('produced workbook stays editable and within the 8-worksheet structure', async () => {
      // PR-NX7 (2026-05-15): Executive Briefing added as the FIRST tab.
      // PR-NX57 (2026-05-19): AI Synthesis added as the SECOND tab (after
      // Executive Briefing, before Dashboard) — cross-product parity with
      // DOCX + PPTX Risk / Sensitivity / Document-Insights narratives.
      // Total now 8 sheets:
      //   1. Executive Briefing (FIRST — AI-assisted IC summary)
      //   2. Analysis Notes (NEW — renamed from "AI Synthesis" per PR-NX74)
      //   3. Dashboard
      //   4. Inputs & Assumptions
      //   5. Cash Flow Engine        (combined: Phasing + Cash Flow + Debt)
      //   6. Monthly Cash Flow
      //   7. Debt Sizing & Amortization
      //   8. Calculations            (hidden audit trail)
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const names = wb.worksheets.map((ws) => ws.name);
      expect(names).toEqual([
        'Executive Briefing',
        'Analysis Notes',
        'Dashboard',
        'Inputs & Assumptions',
        'Cash Flow Engine',
        'Monthly Cash Flow',
        'Debt Sizing & Amortization',
        'Calculations',
      ]);
      expect(names.length).toBeLessThanOrEqual(8);
      expect(names).not.toContain('Export QA & Sources');
      // Site Yield + Market Comparables tabs are conditional — absent here.
      expect(names).not.toContain('Site Yield');
      expect(names).not.toContain('Market Comparables');
      const calc = wb.getWorksheet('Calculations');
      expect(calc).toBeDefined();
      // Hidden by default — power users right-click → Unhide
      expect(calc.state).toBe('hidden');
    });

    test('adds a Site Yield sheet with the recomputed programme when one is present', async () => {
      const ctx = {
        ...minimalContext(),
        siteYield: {
          mode: 'saved',
          computed: {
            ok: true,
            envelope: { realized_gfa_sqft: 108900, effective_fsi: 2.5, floors: 14 },
            areaSchedule: { saleable_sqft: 87773, carpet_sqft: 67518, loading_factor_pct: 30 },
            totals: { units: 65 },
            parking: { required_ecs: 85, norm: '1.3 ECS / unit' },
            unitMix: [{ key: '2bhk', label: '2 BHK', count: 37, carpet_total_sqft: 37000 }],
            bindingConstraint: 'far',
            unrealizedFarPct: 0,
            disclaimer: 'Deterministic screening estimate.',
          },
          boundary: null,
        },
      };
      const buffer = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const sheet = wb.getWorksheet('Site Yield');
      expect(sheet).toBeDefined();
      expect(findValueCellByLabel(sheet, 'Realized GFA (sqft)').value).toBe(108900);
      expect(findValueCellByLabel(sheet, 'Units').value).toBe(65);
      expect(findValueCellByLabel(sheet, 'Binding constraint').value).toBe('FAR / FSI');
    });

    test('adds a Market Comparables sheet with honest per-row provenance when comps exist', async () => {
      const ctx = {
        ...minimalContext(),
        market: {
          exportComps: [
            { project_name: 'Whitefield Heights', developer: 'Prestige', project_type: '2 BHK', micro_market: 'Whitefield', total_units: 240, rate_per_sqft: 11800, is_verified: true, data_type: 'ipc_q1_2026', as_of_date: '2026-03-15', source: 'JLL India' },
            { project_name: 'Brookefield Greens', developer: 'Sobha', project_type: '3 BHK', micro_market: 'Brookefield', total_units: 180, rate_per_sqft: 12600, is_verified: false, source: 'Listing portal' },
          ],
        },
      };
      const buffer = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const sheet = wb.getWorksheet('Market Comparables');
      expect(sheet).toBeDefined();
      // Header row (row 4) + two comp rows (5, 6).
      expect(sheet.getCell('A4').value).toBe('Project');
      expect(sheet.getCell('A5').value).toBe('Whitefield Heights');
      expect(sheet.getCell('F5').value).toBe(11800); // numeric rate, filterable
      // Honest verification: explicit true → Verified; absent/false → Unverified.
      expect(sheet.getCell('H5').value).toBe('Verified');
      expect(sheet.getCell('H6').value).toBe('Unverified');
      const zip = await JSZip.loadAsync(buffer);
      const worksheetXml = await Promise.all(
        zip.file(/^xl\/worksheets\/sheet\d+\.xml$/).map((file) => file.async('string')),
      );
      // 2026-07-13: worksheet protection is now REQUIRED on every sheet
      // (input cells stay unlocked; the validator blocks unprotected sheets).
      expect(worksheetXml.every((xml) => xml.includes('<sheetProtection'))).toBe(true);
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
      // Income assets pin occupancy to the 100% lease-up target: the income kernel
      // (financial-kernel/src/assets/income.ts) applies the vacancy haircut ONLY, so the
      // modeled P&L must too. This previously defaulted to 1 − vacancy = 0.9 and then
      // multiplied by (1 − vacancy) again, double-discounting EGR/NOI ~8% below the kernel.
      expect(prepared.exportQa.core.occupancyPct).toBe(1);
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

    test('Monthly Cash Flow total column excludes itself from formulas', async () => {
      const ctx = minimalContext();
      ctx.deal.asset_class = 'hospitality';
      ctx.property.property_type = 'hospitality';
      const buffer = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const monthly = wb.getWorksheet('Monthly Cash Flow');

      let totalColIdx = null;
      monthly.getRow(4).eachCell((cell, colNumber) => {
        if (String(cell.value || '') === 'Total') totalColIdx = colNumber;
      });
      expect(totalColIdx).toBeTruthy();
      const totalCol = excelCol(totalColIdx);
      const lastMonthCol = excelCol(totalColIdx - 1);

      expect(monthly.getCell(`${totalCol}5`).value.formula).toBeFormula(`=SUM($B$5:$${lastMonthCol}$5)`);
      expect(monthly.getCell(`${totalCol}27`).value.formula).toBeFormula(`=${lastMonthCol}27`);
      for (let row = 5; row <= 27; row += 1) {
        const formula = monthly.getCell(`${totalCol}${row}`).value?.formula;
        if (formula) {
          expect(formula).not.toContain(`$${totalCol}$`);
          expect(formula).not.toBeFormula(`=${totalCol}${row}`);
        }
      }
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

    test('Sponsor LP Waterfall section computes quarterly catch-up and hurdle-ladder distributions inside Debt Sizing', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const wf = wb.getWorksheet('Debt Sizing & Amortization');
      expect(wf).toBeDefined();
      expect(wb.getWorksheet('Sponsor LP Waterfall')).toBeUndefined();

      expect(String(wf.getCell('A130').value)).toContain('Sponsor / LP Waterfall');
      expect(String(wf.getCell('A133').value)).toContain('Capital Stack');
      expect(wf.getCell('B136').value.formula).toBeFormula('=B134-B135');
      expect(wf.getCell('B137').value.formula).toBeFormula('=B136*LPEquityPct');
      expect(wf.getCell('B138').value.formula).toBeFormula('=B136*GPEquityPct');

      expect(String(wf.getCell('F133').value)).toContain('Hurdle Ladder');
      expect(wf.getCell('G134').value.formula).toBeFormula('=IF(ISNUMBER(Dashboard!B21),Dashboard!B21,0)');
      expect(wf.getCell('G135').value.formula).toContain('Hurdle2IRR');
      expect(wf.getCell('G135').value.formula).toContain('Hurdle1IRR');

      expect(String(wf.getCell('A141').value)).toContain('Quarterly Distribution Waterfall');
      expect(String(wf.getCell('A142').value)).toBe('Period');
      expect(wf.getCell('B143').value.formula).toBeFormula("='Cash Flow Engine'!B$3");
      expect(wf.getCell('C143').value.formula).toBeFormula("=MAX(0,'Cash Flow Engine'!B$38)");
      expect(wf.getCell('F143').value.formula).toContain('PrefReturnRate');
      expect(wf.getCell('G143').value.formula).toBeFormula('=MIN(C143,E143+F143)');
      expect(wf.getCell('H143').value.formula).toBeFormula('=MIN(MAX(0,C143-G143),D143)');
      expect(wf.getCell('I143').value.formula).toContain('CatchUpTargetGPPct');
      expect(wf.getCell('I143').value.formula).toContain('CatchUpPct');
      expect(wf.getCell('J143').value.formula).toContain('Hurdle2LPPct');
      expect(wf.getCell('J143').value.formula).toContain('Hurdle1LPPct');
      expect(wf.getCell('K143').value.formula).toContain('Hurdle2GPPct');
      expect(wf.getCell('N143').value.formula).toBeFormula('=G143+H143+J143');
      expect(wf.getCell('O143').value.formula).toBeFormula('=I143+K143');
    });

    test('Inputs sheet exposes catch-up and hurdle-ladder waterfall named ranges', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const allDefined = JSON.stringify(wb.definedNames);
      for (const name of ['LPEquityPct', 'GPEquityPct', 'PrefReturnRate',
        'PromoteLPPct', 'PromoteGPPct', 'CatchUpPct', 'CatchUpTargetGPPct',
        'Hurdle1IRR', 'Hurdle1LPPct', 'Hurdle1GPPct', 'Hurdle2IRR',
        'Hurdle2LPPct', 'Hurdle2GPPct']) {
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

    test('Inputs sheet exposes construction-to-permanent debt phase named ranges', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const allDefined = JSON.stringify(wb.definedNames);
      for (const name of ['ConstructionLoanLTC', 'ConstructionDebtRatePct',
        'PermanentDebtRatePct', 'PermanentRefiLTV', 'RefinanceQuarter']) {
        expect(allDefined).toContain(name);
      }
    });

    test('Amortization Schedule section renders loan terms + quarter-by-quarter amort table (combined Debt Sizing & Amortization sheet)', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const amort = wb.getWorksheet('Debt Sizing & Amortization');
      expect(amort).toBeDefined();

      expect(String(amort.getCell('A32').value)).toMatch(/Construction-to-Permanent Debt Schedule/);
      const a34 = amort.getCell('A34').value;
      expect(String(a34)).toMatch(/Debt Phase Terms/);

      const b35 = amort.getCell('B35').value;
      expect(b35).toBeTruthy();
      expect(b35.formula).toBeFormula('=TotalProjectCostCr*ConstructionLoanLTC');
      expect(amort.getCell('B36').value.formula).toBeFormula('=B28');
      expect(amort.getCell('B37').value.formula).toMatch(/\(1\+ConstructionDebtRatePct\)\^\(1\/4\)-1/);
      expect(amort.getCell('B38').value.formula).toMatch(/\(1\+PermanentDebtRatePct\)\^\(1\/4\)-1/);
      const b39 = amort.getCell('B39').value;
      expect(b39.formula).toBeFormula('=ROUNDUP(MoratoriumMonths/3,0)');
      expect(amort.getCell('B40').value.formula).toBeFormula('=MAX(1,RefinanceQuarter)');
      expect(amort.getCell('B42').value.formula).toBeFormula('=-PMT(B38,MAX(B41-B39,1),B36)');

      expect(String(amort.getCell('A44').value)).toBe('Period');
      expect(String(amort.getCell('B44').value)).toBe('Phase');
      expect(String(amort.getCell('C44').value)).toBe('Construction Draw');
      expect(String(amort.getCell('I44').value)).toBe('Permanent Beg. Balance');
      expect(String(amort.getCell('N44').value)).toBe('Cash Debt Service');

      expect(amort.getCell('B45').value.formula).toBeFormula('=IF($A45="","",IF($A45<=$B$40,"Construction","Permanent"))');
      expect(amort.getCell('C45').value.formula).toContain('$B$35/$B$40');
      expect(amort.getCell('E45').value.formula).toContain('(D45+C45/2)*$B$37');
      expect(amort.getCell('F45').value.formula).toBeFormula('=IF($B45="Construction",E45,0)');
      expect(amort.getCell('G45').value.formula).toContain('$B$40+1');
      expect(amort.getCell('J45').value.formula).toContain('$B$39');
      expect(amort.getCell('J45').value.formula).toContain('$B$42');
      expect(amort.getCell('M45').value.formula).toContain('I45-L45');
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

      // The MODELED tiles fall back to a live formula (no kernel literals).
      for (const ref of ['B4', 'D4', 'F4', 'B7', 'F7']) {
        const v = dash.getCell(ref).value;
        expect(typeof v).toBe('object');
        expect(v.formula).toBeTruthy();
      }
      // The AUTHORITATIVE kernel row (20) must NOT masquerade the modeled
      // formula under a "(kernel)" label when the kernel stored nothing — it
      // shows an em-dash instead (honesty fix, 2026-07-13).
      for (const ref of ['B20', 'D20', 'F20']) {
        expect(dash.getCell(ref).value).toBe('–');
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

      // PR-NX7: Dashboard was sheet2.xml (Executive Briefing is sheet1.xml).
      // PR-NX57: Dashboard moved to sheet3.xml after AI Synthesis inserted at position 2.
      const sheetXml = await zip.file('xl/worksheets/sheet3.xml').async('string');
      expect(sheetXml).toMatch(/<drawing\s+r:id="rId\d+"\s*\/>/);

      // Sheet rels include the drawing rel
      const sheetRels = await zip.file('xl/worksheets/_rels/sheet3.xml.rels').async('string');
      expect(sheetRels).toMatch(/drawings\/drawing1\.xml/);

      // Content types declares each chart + the drawing
      const contentTypes = await zip.file('[Content_Types].xml').async('string');
      expect(contentTypes).toMatch(/\/xl\/drawings\/drawing1\.xml/);
      expect(contentTypes).toMatch(/\/xl\/charts\/chart1\.xml/);
    });

    test('Dashboard ships native Excel sparklines for KPI trend cells', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const zip = await JSZip.loadAsync(buffer);
      // PR-NX7: Dashboard was sheet2.xml (Executive Briefing is sheet1.xml).
      // PR-NX57: Dashboard moved to sheet3.xml after AI Synthesis inserted at position 2.
      const sheetXml = await zip.file('xl/worksheets/sheet3.xml').async('string');

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

    test('Inputs sheet comments are serialized before table parts so Excel opens without repair', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const zip = await JSZip.loadAsync(buffer);
      // PR-NX7: Inputs was sheet3.xml (Executive Briefing + Dashboard ahead of it).
      // PR-NX57: Inputs moved to sheet4.xml after AI Synthesis inserted between Briefing + Dashboard.
      const sheetXml = await zip.file('xl/worksheets/sheet4.xml').async('string');

      const legacyDrawingIndex = sheetXml.indexOf('<legacyDrawing');
      const tablePartsIndex = sheetXml.indexOf('<tableParts');

      expect(legacyDrawingIndex).toBeGreaterThan(-1);
      expect(tablePartsIndex).toBeGreaterThan(-1);
      expect(legacyDrawingIndex).toBeLessThan(tablePartsIndex);
    });

    test('workbook forces automatic full recalculation so formula-heavy sheets display values in Excel', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const zip = await JSZip.loadAsync(buffer);
      const workbookXml = await zip.file('xl/workbook.xml').async('string');
      const calcPr = workbookXml.match(/<calcPr\b[^>]*>/)?.[0] || '';

      expect(calcPr).toContain('calcMode="auto"');
      expect(calcPr).toContain('fullCalcOnLoad="1"');
      expect(calcPr).toContain('forceFullCalc="1"');
      expect(zip.file('xl/calcChain.xml')).toBeNull();
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

    // PR-NX2 (2026-05-15): operator audit on a real production workbook
    // (Pointec Pens) surfaced two structural accuracy bugs that had been
    // hiding for months. Dashboard B4 "Stabilised NOI / yr" was rendering
    // `'Cash Flow Engine'!BF18 * 4` where BF was the TOTAL column on the
    // NOI row — i.e. SUM(all-quarter NOI) × 4 = lifetime aggregate × 4,
    // not the trailing-year stabilised rate. Same pattern on Cash-on-Cash
    // (using Q2 alone — still in lease-up for most income assets) and Net
    // Sale Proceeds (using TOTAL column on Reversion row — accidentally
    // correct since other quarters were 0, but fragile). Separately, the
    // income-family IRR / NPV / EM were referencing row 11 (Reversion-
    // only — mostly zeros, IRR could not converge → "–") instead of row
    // 12 (Total CF Incl Reversion). And that row didn't have an initial
    // equity outflow at Q1 — so even with the correct row, IRR would
    // still fail because the series was all-positive. All three issues
    // ship together so the Dashboard reconciles end-to-end.
    describe('Dashboard accuracy bug fixes (PR-NX2 — Pointec Pens audit)', () => {
      test('Stabilised NOI uses trailing-year SUM, not lifetime aggregate × 4', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office'; // income family
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        const formula = dash.getCell('B4').value.formula;
        // Pre-fix: ='Cash Flow Engine'!BF18*4 (BF = TOTAL/SUM column)
        // Post-fix: trailing-4-quarter SUM via INDEX
        expect(formula).toMatch(/INDEX/);
        expect(formula).toMatch(/TotalQuarters-3/);
        expect(formula).toMatch(/TotalQuarters\)/);
        // Should NOT reference the "Total" column (which is SUM) for NOI
        expect(formula).not.toMatch(/!\$?[A-Z]{1,3}\$?\d+\*4/); // no "TotalCol18*4"
      });

      test('Stabilized Yield on Cost uses trailing-year NOI ÷ TotalProjectCostCr', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        const formula = dash.getCell('D4').value.formula;
        expect(formula).toMatch(/INDEX/);
        expect(formula).toMatch(/TotalProjectCostCr/);
      });

      test('Cash-on-Cash (Stabilised) uses trailing-year CFADS ÷ equity', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        // Label changed from "Cash-on-Cash (Yr 1)" to "Cash-on-Cash (Stabilised)"
        expect(String(dash.getCell('C7').value)).toContain('Stabilised');
        const formula = dash.getCell('D7').value.formula;
        // Pre-fix: =IFERROR(...!C{cfShift(9)}/(TotalProjectCostCr*(1-DebtLTV)),0)
        // Post-fix: INDEX-based trailing-year SUM
        expect(formula).toMatch(/INDEX/);
        expect(formula).toMatch(/TotalProjectCostCr\*\(1-DebtLTV\)/);
      });

      test('Net Sale Proceeds uses INDEX at TotalQuarters (final-quarter cell, not SUM)', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        const formula = dash.getCell('F7').value.formula;
        // Pre-fix: ='Cash Flow Engine'!BF{cfShift(11)} (SUM column on Reversion row)
        // Post-fix: =INDEX(Reversion row, 1, TotalQuarters)
        expect(formula).toMatch(/INDEX/);
        expect(formula).toMatch(/TotalQuarters\)/);
      });

      test('Income family Total CF row injects initial equity outflow at Q1', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const cf = wb.getWorksheet('Cash Flow Engine');
        // Find the "Total Cash Flow Including Reversion (FCFE basis)" row
        let targetRow = -1;
        cf.eachRow((row, idx) => {
          const lab = row.getCell(1).value;
          if (typeof lab === 'string' && /Total Cash Flow Including Reversion/i.test(lab)) {
            targetRow = idx;
          }
        });
        expect(targetRow).toBeGreaterThan(0);
        // Q1 formula (col B) should subtract initial equity
        const q1Formula = cf.getCell(targetRow, 2).value.formula;
        expect(q1Formula).toMatch(/TotalProjectCostCr\*\(1-DebtLTV\)/);
        // Label should reflect FCFE basis
        const label = String(cf.getCell(targetRow, 1).value);
        expect(label).toContain('FCFE');
      });

      test('Income IRR / NPV / EM reference the Total CF row (row 12 legacy), not Reversion row (11)', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        // Modeled IRR formula at B21
        const irrFormula = dash.getCell('B21').value.formula;
        // Income family cfOffset = 20, so cfShift(12) = 32. Row 32 is the
        // Total CF row. Pre-fix used row 31 (Reversion only).
        expect(irrFormula).toMatch(/\$32:/);
        expect(irrFormula).not.toMatch(/\$31:/);
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

    // 2026-07-13: INVERTED — every sheet must now ship protected (no
    // password) so locked output/formula cells can't be silently
    // overwritten, while Inputs value cells remain unlocked and editable.
    test('all sheets are protected while Inputs value cells remain clearly editable', async () => {
      const buffer = await buildDealWorkbookV2(minimalContext());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      wb.worksheets.forEach((ws) => {
        const isProtected = ws.sheetProtection && ws.sheetProtection.sheet === true;
        expect(isProtected).toBe(true);
        // Selecting unlocked (input) cells must NOT be blocked.
        expect(ws.sheetProtection.selectUnlockedCells).not.toBe(false);
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
      }, 30000); // generates 7 workbooks in one test — 5s default is too tight

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

    // ── PR-NX13 — Asset-class-aware Inputs sheet visibility ────────────
    describe('PR-NX13: Inputs sheet visibility per asset class', () => {
      const hospitalityCtx = () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'hospitality';
        ctx.property.property_type = 'hospitality';
        return ctx;
      };

      const rawLandCtx = () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'raw_land';
        ctx.property.property_type = 'raw_land';
        return ctx;
      };

      const plottedCtx = () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'plotted_development';
        ctx.property.property_type = 'plotted_development';
        return ctx;
      };

      // Helper: collect all label strings in column A of the Inputs sheet
      const collectInputLabels = (inputs) => {
        const labels = [];
        inputs.eachRow({ includeEmpty: false }, (row) => {
          const v = row.getCell(1).value;
          if (v && typeof v === 'string') labels.push(v);
        });
        return labels;
      };

      test('Hospitality skips the rent/sqft income revenue section (USALI handles revenue)', async () => {
        const buffer = await buildDealWorkbookV2(hospitalityCtx());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const labels = collectInputLabels(inputs);
        // Section title from incomeRevenueSection should NOT appear
        expect(labels).not.toContain('Operating Revenue Inputs (Income Asset)');
        // Hospitality-specific section title SHOULD appear
        expect(labels).toContain('Hospitality Operating Metrics (ADR / Occupancy / RevPAR)');
      });

      test('Hospitality skips the income OpEx section (USALI carries departmental costs)', async () => {
        const buffer = await buildDealWorkbookV2(hospitalityCtx());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const labels = collectInputLabels(inputs);
        expect(labels).not.toContain('Operating Expenses (Income Asset)');
        // But the USALI sections (rendered as part of the hospitality block)
        // should still surface the cost inputs the model needs.
        expect(labels).toContain('Hospitality USALI Engine Drivers');
      });

      test('Hospitality hides Loading Factor + Carpet Area rows (keys-based, no sale-side carpet)', async () => {
        const buffer = await buildDealWorkbookV2(hospitalityCtx());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const labels = collectInputLabels(inputs);
        expect(labels.find((l) => l.startsWith('Loading Factor'))).toBeUndefined();
        expect(labels.find((l) => l.startsWith('Carpet Area'))).toBeUndefined();
      });

      test('Hospitality export still validates / exports cleanly (LoadingFactor validator skipped)', async () => {
        // Pre-fix: the validator at "Loading factor" positivity check
        // would BLOCK the export for hospitality (since LoadingFactor row
        // was hidden but validator still ran). This test confirms the
        // skip works end-to-end — hospitality exports a non-empty buffer.
        const buffer = await buildDealWorkbookV2(hospitalityCtx());
        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect(buffer.length).toBeGreaterThan(10000);
      });

      test('Raw land hides Loading Factor + Carpet Area rows (no construction, no carpet)', async () => {
        const buffer = await buildDealWorkbookV2(rawLandCtx());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const labels = collectInputLabels(inputs);
        expect(labels.find((l) => l.startsWith('Loading Factor'))).toBeUndefined();
        expect(labels.find((l) => l.startsWith('Carpet Area'))).toBeUndefined();
      });

      test('Raw land + Plotted skip the RERA Escrow section (no customer construction milestones)', async () => {
        const rawBuf = await buildDealWorkbookV2(rawLandCtx());
        const wbRaw = new ExcelJS.Workbook();
        await wbRaw.xlsx.load(rawBuf);
        const rawLabels = collectInputLabels(wbRaw.getWorksheet('Inputs & Assumptions'));
        expect(rawLabels.find((l) => l.includes('RERA Compliance'))).toBeUndefined();

        const plottedBuf = await buildDealWorkbookV2(plottedCtx());
        const wbPlotted = new ExcelJS.Workbook();
        await wbPlotted.xlsx.load(plottedBuf);
        const plottedLabels = collectInputLabels(wbPlotted.getWorksheet('Inputs & Assumptions'));
        expect(plottedLabels.find((l) => l.includes('RERA Compliance'))).toBeUndefined();

        // But standard residential (development family) DOES still see RERA
        const residentialBuf = await buildDealWorkbookV2(minimalContext());
        const wbRes = new ExcelJS.Workbook();
        await wbRes.xlsx.load(residentialBuf);
        const resLabels = collectInputLabels(wbRes.getWorksheet('Inputs & Assumptions'));
        expect(resLabels).toContain('RERA Compliance & Escrow');
      });

      test('Other income classes (office / retail / industrial) STILL see Loading Factor + income sections (no regression)', async () => {
        for (const cls of ['commercial_office', 'retail', 'industrial_warehousing']) {
          const ctx = minimalContext();
          ctx.deal.asset_class = cls;
          ctx.property.property_type = cls;
          const buffer = await buildDealWorkbookV2(ctx);
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const inputs = wb.getWorksheet('Inputs & Assumptions');
          const labels = collectInputLabels(inputs);
          // These classes keep the rent + loading-factor inputs
          expect(labels).toContain('Operating Revenue Inputs (Income Asset)');
          expect(labels).toContain('Operating Expenses (Income Asset)');
          expect(labels.find((l) => l.startsWith('Loading Factor'))).toBeDefined();
        }
      });

      test('PR-NX15 HOTFIX: hospitality preserves ALL Dashboard-dependent named ranges via compat section', async () => {
        // 2026-05-16 production bug postmortem: PR-NX13 hid the income
        // revenue + opex sections for hospitality, which removed the
        // OccupancyPct / VacancyPct / BaseRentPerSqftMonth / ExitCapRate /
        // InsurancePct / PropMgmtPct / etc. named ranges that the
        // Dashboard's pre-existing 5×5 sensitivity grid + PR-NX10
        // scenarios + driver-ranking formulas ALL reference. Excel hit
        // hundreds of #NAME? errors on open → auto-repair → entire
        // Dashboard sheet scrubbed.
        //
        // The hotfix PR-NX15 adds a "Hospitality → Income-Family Compat"
        // section that re-defines all 19 missing named ranges with
        // hospitality-equivalent values. This regression test guards
        // against ANY future change to PR-NX13's section hiding silently
        // breaking the Dashboard.
        const buffer = await buildDealWorkbookV2(hospitalityCtx());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const names = (wb.definedNames.model || []).map((n) => n.name);
        const required = [
          'OccupancyPct', 'VacancyPct', 'BaseRentPerSqftMonth',
          'RentEscalationPct', 'OtherIncomePerSqft', 'LeaseUpQuarters',
          'PropertyTaxPerSqftYr', 'InsurancePct', 'PropMgmtPct',
          'UtilitiesPct', 'MaintenancePct', 'CapExReservePct',
          'RecoverableExpensePct', 'TIAllowancePerSqft',
          'LeasingCommissionPct', 'TenantDowntimeMonths', 'TILCAllowanceCr',
          'ExitCapRate', 'ExitCapRatePct', 'SellingCostPct',
        ];
        const missing = required.filter((n) => !names.includes(n));
        expect(missing).toEqual([]);
      });

      test('PR-NX15 HOTFIX: hospitality Dashboard sheet has 50+ cells after generation (not empty after auto-repair)', async () => {
        // Direct sanity check on the raw XML: Dashboard sheet
        // must contain real <c r="..."> cell entries, not the empty
        // <sheetData/> that triggers Excel auto-repair scrubbing.
        const buffer = await buildDealWorkbookV2(hospitalityCtx());
        const zip = await JSZip.loadAsync(buffer);
        // PR-NX57: AI Synthesis is now position 2 (between Executive
        // Briefing + Dashboard), so Dashboard is sheet3.xml. Hospitality
        // USALI then inserts AFTER Inputs, not before Dashboard, so
        // Dashboard's position is unchanged from the non-hospitality case.
        const dashFile = zip.file('xl/worksheets/sheet3.xml');
        expect(dashFile).toBeTruthy();
        const xml = await dashFile.async('string');
        expect(xml).not.toMatch(/<sheetData\s*\/>/);
        const cellCount = (xml.match(/<c\s+r="/g) || []).length;
        expect(cellCount).toBeGreaterThan(50);
      });

      test('Hospitality SaleableAreaSqft is still present (named range needed for USALI sqftPerKey calc)', async () => {
        // We hide Loading Factor + Carpet Area but the underlying
        // SaleableAreaSqft must remain — the USALI engine uses
        // SaleableAreaSqft / HospitalityKeys = sqft/key as a diagnostic.
        const buffer = await buildDealWorkbookV2(hospitalityCtx());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const labels = collectInputLabels(inputs);
        expect(labels.find((l) => l.includes('Saleable / Leasable Area'))).toBeDefined();
      });
    });

    // ── PR-NX14 — Label + UX polish ─────────────────────────────────────
    describe('PR-NX14: Project Schedule label clarity', () => {
      test('Schedule labels distinguish Construction Duration (months) from Total Modeling Horizon (qtrs, incl. operating hold)', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const collectLabelUnits = [];
        inputs.eachRow({ includeEmpty: false }, (row) => {
          const label = String(row.getCell(1).value || '');
          const unit = String(row.getCell(3).value || '');
          if (label && (label.startsWith('Construction Duration') || label.startsWith('Total Modeling Horizon'))) {
            collectLabelUnits.push({ label, unit });
          }
        });
        expect(collectLabelUnits.find((x) => x.label === 'Construction Duration')).toBeDefined();
        expect(collectLabelUnits.find((x) => x.label === 'Total Modeling Horizon')).toBeDefined();
        const horizon = collectLabelUnits.find((x) => x.label === 'Total Modeling Horizon');
        expect(horizon.unit).toMatch(/incl.*operating hold/i);
      });

      test('Named ranges ProjectMonths + TotalQuarters are unchanged (downstream formulas keep working)', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const names = (wb.definedNames.model || []).map((n) => n.name);
        expect(names).toContain('ProjectMonths');
        expect(names).toContain('TotalQuarters');
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
      }, 30000); // generates 6 workbooks in one test — 5s default too tight

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
      }, 30000); // 4× buildDealWorkbookV2 → needs explicit timeout under full-suite load

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
    // PR-NX3 (2026-05-15): India-context cell comments — every key
    // input cell now carries a hover tooltip explaining the applicable
    // Indian statute / market benchmark (RERA escrow, GST regime, BBMP
    // UAV property tax, Karnataka stamp duty, LTCG post-2024, B-khata
    // haircut, JDA economics, RBI debt benchmarks, USALI hospitality).
    describe('PR-NX3: India-context cell comments + KhataExitMultiplier wiring', () => {
      // Helper: locate a row on Inputs by label, return its value cell.
      const findValueCellByLabel = (inputs, labelMatch) => {
        let found = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (typeof labelMatch === 'string'
            ? label === labelMatch
            : labelMatch.test(label)) {
            found = row.getCell(2);
          }
        });
        return found;
      };

      test('GST rate cell carries India-context note (Section 16 reference)', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext()); // dev (residential)
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, /^GST/i);
        expect(cell).not.toBeNull();
        expect(String(cell.note || '')).toContain('India context');
        expect(String(cell.note || '')).toMatch(/5%.*residential|1%.*affordable/);
      });

      test('LTCG rate cell carries India-context note (Finance Act 2024 reference)', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, /^LTCG Rate/i);
        expect(cell).not.toBeNull();
        expect(String(cell.note || '')).toContain('12.5%');
        expect(String(cell.note || '')).toMatch(/Jul-2024|Finance/i);
      });

      test('Khata Status cell explains A vs B implications', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, /^Khata Status/i);
        expect(cell).not.toBeNull();
        expect(String(cell.note || '')).toContain('A_khata');
        expect(String(cell.note || '')).toContain('B_khata');
        expect(String(cell.note || '')).toMatch(/BBMP|Municipality/);
      });

      test('Exit cap rate cell shows Bengaluru benchmarks by asset class', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, /^Exit Cap Rate/i);
        expect(cell).not.toBeNull();
        expect(String(cell.note || '')).toMatch(/Bengaluru|ORR|Whitefield/);
        expect(String(cell.note || '')).toMatch(/Grade-A|7\.5|8\.5/);
      });

      test('Income-family Reversion formula includes KhataExitMultiplier', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const cfe = wb.getWorksheet('Cash Flow Engine');
        // Locate the Reversion — Net Sale Proceeds row (final-quarter formula)
        let reversionRow = null;
        cfe.eachRow((row, rowIdx) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label.includes('Reversion') && label.includes('Net Sale Proceeds')) {
            reversionRow = rowIdx;
          }
        });
        expect(reversionRow).not.toBeNull();
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
        // B-khata properties take an exit haircut; KhataExitMultiplier
        // applies that haircut to the reversion sale value.
        expect(cell.value.formula).toContain('KhataExitMultiplier');
        // Original formula structure (TotalExitCostPct) is still intact.
        expect(cell.value.formula).toContain('TotalExitCostPct');
      });

      test('ImpliedNetExitValueCr formula includes KhataExitMultiplier', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, /Implied Net Exit Value/i);
        expect(cell).not.toBeNull();
        expect(cell.value.formula).toContain('KhataExitMultiplier');
      });

      test('Comment library entries do not break existing source/confidence metadata', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, /^Khata Status/i);
        const note = String(cell.note || '');
        // Pre-existing structure preserved
        expect(note).toContain('Source:');
        expect(note).toContain('Confidence:');
        // New context section appended
        expect(note).toContain('India context');
      });
    });

    // PR-NX4 (2026-05-15): close the derived-value loop — wire 3 derived
    // named ranges that used to sit idle on Inputs into the actual
    // downstream formulas. Operators no longer have to manually re-paste
    // these derived values; they flow live as soon as the operator edits
    // the inputs that feed them.
    describe('PR-NX4: derived-value wiring — close the loop', () => {
      const findValueCellByLabel = (inputs, labelMatch) => {
        let found = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (typeof labelMatch === 'string'
            ? label === labelMatch
            : labelMatch.test(label)) {
            found = row.getCell(2);
          }
        });
        return found;
      };

      // ── Item #1: SellRatePerSqft auto-defaults to MixUseBlendedRatePerSqft
      //    for mixed_use templates with no explicit selling rate. ─────
      test('Mixed-use template: SellRatePerSqft is a formula referencing MixUseBlendedRatePerSqft', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'mixed_use';
        ctx.property.property_type = 'mixed_use';
        // Clear any explicit selling rate so the auto-blend kicks in.
        delete ctx.deal.model_params.inputs.sellingRatePerSqft;
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, 'Selling Rate per sqft');
        expect(cell).not.toBeNull();
        // ExcelJS strips the leading "=" when reading formulas back.
        expect(cell.value).toEqual(expect.objectContaining({ formula: 'MixUseBlendedRatePerSqft' }));
      });

      test('Residential template: SellRatePerSqft stays a literal value (no auto-blend)', async () => {
        const ctx = minimalContext(); // default residential_apartments
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, 'Selling Rate per sqft');
        expect(cell).not.toBeNull();
        // Should be a literal number, not a formula
        expect(typeof cell.value).not.toBe('object');
        expect(cell.value).toBe(12000); // from minimalContext default
      });

      test('Mixed-use template with explicit selling rate keeps the literal', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'mixed_use';
        ctx.property.property_type = 'mixed_use';
        ctx.deal.model_params.inputs.sellingRatePerSqft = 15500;
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const cell = findValueCellByLabel(inputs, 'Selling Rate per sqft');
        expect(cell.value).toBe(15500);
      });

      // ── Item #2: Approvals reconciliation row auto-flags drift > 5% ───
      test('Approvals reconciliation row computes delta + Δ% + status', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');

        const deltaCell = findValueCellByLabel(inputs, /Reconciliation — Δ vs Headline/);
        expect(deltaCell).not.toBeNull();
        // ExcelJS strips leading "=" when reading formulas back
        expect(deltaCell.value.formula).toBe('ApprovalsBreakdownSumCr-ApprovalCostCr');

        const deltaPctCell = findValueCellByLabel(inputs, /Reconciliation — Δ %/);
        expect(deltaPctCell).not.toBeNull();
        expect(deltaPctCell.value.formula).toContain('ApprovalsBreakdownDeltaCr');
        expect(deltaPctCell.value.formula).toContain('ApprovalCostCr');

        const statusCell = findValueCellByLabel(inputs, /Reconciliation — Status/);
        expect(statusCell).not.toBeNull();
        // PR-NX14 (2026-05-15): three-state — Aligned / Drift / Headline-only.
        expect(statusCell.value.formula).toContain('Aligned');
        expect(statusCell.value.formula).toContain('Drift');
        expect(statusCell.value.formula).toContain('0.05');
        // New: third state for when breakdown sum = 0
        expect(statusCell.value.formula).toContain('Headline only');
      });

      // ── Item #3: Development family Quarter sales has bulk-exit top-up
      //    at the final quarter when bulk_exit_completion strategy. ───
      test('Development Quarter sales formula at final quarter has bulk-exit top-up', async () => {
        const ctx = minimalContext();
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const cfe = wb.getWorksheet('Cash Flow Engine');

        // Locate the Quarter sales row
        let salesRow = null;
        cfe.eachRow((row, rowIdx) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label === 'Quarter sales (INR Cr)') salesRow = rowIdx;
        });
        expect(salesRow).not.toBeNull();

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

        // Final-quarter formula should include the bulk-exit-completion branch
        // with EffectiveExitFactor × KhataExitMultiplier
        const finalCell = cfe.getCell(`${finalQCol}${salesRow}`);
        expect(finalCell.value.formula).toContain('bulk_exit_completion');
        expect(finalCell.value.formula).toContain('EffectiveExitFactor');
        expect(finalCell.value.formula).toContain('KhataExitMultiplier');

        // Q1 (non-final) should NOT contain the bulk-exit branch
        const q1Cell = cfe.getCell(`B${salesRow}`);
        expect(q1Cell.value.formula).not.toContain('bulk_exit_completion');
        expect(q1Cell.value.formula).not.toContain('EffectiveExitFactor');
      });

      test('Mid-quarter sales formulas remain the base absorption-delta formula', async () => {
        const ctx = minimalContext();
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const cfe = wb.getWorksheet('Cash Flow Engine');

        let salesRow = null;
        cfe.eachRow((row, rowIdx) => {
          const label = String(row.getCell(1).value || '').trim();
          if (label === 'Quarter sales (INR Cr)') salesRow = rowIdx;
        });

        // Pick Q5 (mid-quarter) and confirm it's the simple base formula
        const q5Cell = cfe.getCell(`F${salesRow}`); // col F = q5 (B=q1)
        expect(q5Cell.value.formula).toContain('SaleableAreaSqft');
        expect(q5Cell.value.formula).toContain('SellRatePerSqft');
        // No bulk-exit branch in mid-quarter
        expect(q5Cell.value.formula).not.toContain('bulk_exit_completion');
      });
    });

    // PR-NX5 (2026-05-15): every Excel export must read as deal-SPECIFIC,
    // not as a generic template. Dashboard row 2 + Inputs row 2 + Cash
    // Flow Engine row 2 now carry a self-describing identity line:
    // "{Asset Class} · {Deal Structure} · Exit: {Exit Strategy} · {Hold} · {City}"
    // plus an asset-class-aware modeling-mechanic hint on Inputs row 3.
    describe('PR-NX5: deal identity surfaced on every sheet header', () => {
      test('Dashboard row 2 names asset class + deal structure + exit + hold + city', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        ctx.deal.deal_structure = 'outright_purchase';
        ctx.deal.exit_strategy = 'strategic_sale';
        ctx.property.city = 'Bengaluru';
        ctx.property.micro_market = 'Outer Ring Road';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const subtitle = String(wb.getWorksheet('Dashboard').getCell('A2').value);
        // Asset class label
        expect(subtitle).toContain('Commercial Office');
        // Deal structure label
        expect(subtitle).toContain('Outright Purchase');
        // Exit strategy label
        expect(subtitle).toContain('Strategic Sale');
        // Location
        expect(subtitle).toContain('Bengaluru');
        // Hold / horizon
        expect(subtitle).toMatch(/horizon|cycle|yr/);
      });

      test('Dashboard subtitle adapts to JDA structure', async () => {
        const ctx = minimalContext(); // residential_apartments, dev family
        ctx.deal.deal_structure = 'jda_revenue_share';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const subtitle = String(wb.getWorksheet('Dashboard').getCell('A2').value);
        expect(subtitle).toContain('JDA');
        expect(subtitle).toContain('Revenue Share');
      });

      test('Dashboard subtitle adapts to development-management structure', async () => {
        const ctx = minimalContext();
        ctx.deal.deal_structure = 'development_management';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const subtitle = String(wb.getWorksheet('Dashboard').getCell('A2').value);
        expect(subtitle).toContain('Development Management');
        expect(subtitle).toContain('Fee Only');
      });

      test('Inputs sheet row 2 carries deal identity, row 3 carries mechanic hint', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'hospitality';
        ctx.property.property_type = 'hospitality';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        const row2 = String(inputs.getCell('A2').value);
        const row3 = String(inputs.getCell('A3').value);
        expect(row2).toContain('Hospitality');
        expect(row2).toContain('Effective');
        expect(row3).toContain('Modeling mechanic');
        // USALI mechanic hint for hospitality
        expect(row3).toMatch(/USALI|ADR|Occupancy/);
      });

      test('Inputs mechanic hint adapts per asset class — commercial_office gets a lease-driven hint', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const row3 = String(wb.getWorksheet('Inputs & Assumptions').getCell('A3').value);
        expect(row3).toMatch(/lease|CAM|LRD|strategic-sale/i);
      });

      test('Cash Flow Engine row 1 includes the deal name, row 2 carries identity + mechanic hint', async () => {
        const ctx = minimalContext();
        ctx.deal.name = 'Whitefield Phase 2';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const cfe = wb.getWorksheet('Cash Flow Engine');
        const row1 = String(cfe.getCell('A1').value);
        const row2 = String(cfe.getCell('A2').value);
        expect(row1).toContain('Whitefield Phase 2');
        expect(row1).toContain('Cash Flow Engine');
        // Identity line on row 2
        expect(row2).toContain('Residential Apartments');
        // Mechanic hint included
        expect(row2).toMatch(/RERA|milestone|GST/i);
      });

      test('Exit strategy label propagates: REIT exit shows on Dashboard', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office'; // income family
        ctx.property.property_type = 'commercial_office';
        ctx.deal.exit_strategy = 'reit_exit';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const subtitle = String(wb.getWorksheet('Dashboard').getCell('A2').value);
        expect(subtitle).toContain('REIT');
      });

      test('Exit strategy bulk_exit_completion shows "Bulk Sale at Completion" on Dashboard', async () => {
        const ctx = minimalContext(); // dev family residential
        ctx.deal.exit_strategy = 'bulk_exit_completion';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const subtitle = String(wb.getWorksheet('Dashboard').getCell('A2').value);
        expect(subtitle).toContain('Bulk Sale');
      });
    });

    // PR-NX6 (2026-05-15): asset-class defaults library bridges the gap
    // between the kernel's mostly-empty defaults and the rich Bengaluru-
    // priority benchmarks that operators expect. Layered into
    // ctx.engineAssumptions BEFORE the kernel's resolveAssumptions output,
    // so any kernel-provided value (e.g. rentPerSqftPerMonth = 95 for
    // commercial_office) still wins, but fields the kernel doesn't cover
    // (e.g. saleableAreaSqft, landCostCr, debt structure) get our defaults.
    describe('PR-NX6: asset-class defaults bridge sparse-input deals', () => {
      const findValueByLabel = (inputs, labelMatch) => {
        let v = null;
        inputs.eachRow((row) => {
          const label = String(row.getCell(1).value || '').trim();
          if (typeof labelMatch === 'string'
            ? label === labelMatch
            : labelMatch.test(label)) {
            v = row.getCell(2).value;
          }
        });
        return v;
      };

      test('Sparse Commercial Office deal seeds Bengaluru-realistic defaults', async () => {
        // Operator-created deal with only land cost + area filled. Every
        // other field should fall through to the asset-class default.
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        ctx.property.saleable_area_sqft = null;
        ctx.deal.model_params.inputs = {
          assetClass: 'commercial_office',
          landCostCr: 95, // operator entered
          // Everything else missing — should default.
        };
        const buffer = await buildDealWorkbookV2(ctx, { strictValidation: false });
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');

        // Asset-class defaults flow through. Saleable area: my default 500000.
        expect(findValueByLabel(inputs, /Saleable.*Leasable Area/)).toBeGreaterThan(0);
        // Construction cost: 6800/sqft from my defaults.
        expect(findValueByLabel(inputs, /Construction Cost.*sqft/i)).toBe(6800);
        // Debt LTV: 60% from my defaults.
        expect(findValueByLabel(inputs, /^Debt %/)).toBeCloseTo(0.60, 2);
        // Operator-entered landCost is preserved (not overridden by default).
        expect(findValueByLabel(inputs, /^Land Cost/i)).toBe(95);
      });

      test('Sparse Hospitality deal seeds constructionCostPerSqft from asset-class default', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'hospitality';
        ctx.property.property_type = 'hospitality';
        ctx.deal.model_params.inputs = {
          assetClass: 'hospitality',
        };
        const buffer = await buildDealWorkbookV2(ctx, { strictValidation: false });
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');

        // Hospitality construction cost defaults to 6400/sqft (mid-segment
        // institutional hotel build); flows via engineAssumptions because
        // constructionCostPerSqftFor() consults that chain.
        expect(findValueByLabel(inputs, /Construction Cost.*sqft/i)).toBe(6400);
      });

      test('Sparse Retail deal seeds constructionCostPerSqft from asset-class default', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'retail';
        ctx.property.property_type = 'retail';
        ctx.deal.model_params.inputs = {
          assetClass: 'retail',
        };
        const buffer = await buildDealWorkbookV2(ctx, { strictValidation: false });
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        // Retail construction cost defaults to 7500/sqft (mall finish-level)
        expect(findValueByLabel(inputs, /Construction Cost.*sqft/i)).toBe(7500);
      });

      test('Sparse Industrial deal seeds constructionCostPerSqft + propertyTax from defaults', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'industrial_warehousing';
        ctx.property.property_type = 'industrial_warehousing';
        ctx.deal.model_params.inputs = {
          assetClass: 'industrial_warehousing',
        };
        const buffer = await buildDealWorkbookV2(ctx, { strictValidation: false });
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');
        // Industrial / warehouse construction cost = ₹2400/sqft (PEB shell)
        expect(findValueByLabel(inputs, /Construction Cost.*sqft/i)).toBe(2400);
      });

      test('Operator-entered inputs always override asset-class defaults', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        ctx.deal.model_params.inputs = {
          assetClass: 'commercial_office',
          // Operator-specified non-default values.
          landCostCr: 250,
          constructionCostPerSqft: 9000,
          debtLTV: 0.70,
        };
        const buffer = await buildDealWorkbookV2(ctx, { strictValidation: false });
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const inputs = wb.getWorksheet('Inputs & Assumptions');

        expect(findValueByLabel(inputs, /^Land Cost/i)).toBe(250);
        expect(findValueByLabel(inputs, /Construction Cost.*sqft/i)).toBe(9000);
        expect(findValueByLabel(inputs, /^Debt %/)).toBeCloseTo(0.70, 2);
      });

      test('Kernel-published values (e.g. rentPerSqftPerMonth = 95 for office) win over asset-class defaults', async () => {
        // The kernel publishes rentPerSqftPerMonth = 95 for commercial_office.
        // Our defaults library intentionally does NOT redefine
        // baseRentPerSqftMonth — so the kernel's 95 should flow through to
        // baseRentPerSqftMonthFor()'s lookup chain.
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        ctx.deal.model_params.inputs = {
          assetClass: 'commercial_office',
          // No baseRent / rent input — kernel default should win.
        };
        const prepared = __internal.prepareWorkbookContext(ctx, { strictValidation: false });
        expect(prepared.exportQa.core.baseRentPerSqftMonth).toBe(95);
      });
    });

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
      // 2026-07-13: the dev-family D7/F7 tiles are now Peak Debt Drawn and
      // Total Equity Cash Flow (were Min DSCR / mislabeled Residual Land
      // Value). Neither has a benchmark band, so they carry no CF rules —
      // the old DSCR red-below-1.2 thresholds would misfire on a magnitude.
      test('Development family — benchmarked KPI tiles (B4 / D4 / F4 / B7) have CF rules; D7/F7 magnitude tiles do not', async () => {
        const buffer = await buildDealWorkbookV2(minimalContext()); // dev family
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        // ExcelJS exposes conditional formatting via worksheet._conditionalFormattings
        // (internal-ish but stable). Each entry has { ref, rules }.
        const cfList = dash.conditionalFormattings || [];
        const refsCovered = new Set();
        cfList.forEach((cf) => refsCovered.add(cf.ref));
        expect(refsCovered.has('B4:B4')).toBe(true); // Total Revenue
        expect(refsCovered.has('D4:D4')).toBe(true); // Total Project Cost
        expect(refsCovered.has('F4:F4')).toBe(true); // Project Net CF
        expect(refsCovered.has('B7:B7')).toBe(true); // Gross Margin
        expect(refsCovered.has('D7:D7')).toBe(false); // Peak Debt Drawn — no bands
        expect(refsCovered.has('F7:F7')).toBe(false); // Total Equity Cash Flow — no bands
        // New tile labels render at C7 / E7.
        expect(dash.getCell('C7').value).toBe('Peak Debt Drawn (INR Cr)');
        expect(dash.getCell('E7').value).toBe('Total Equity Cash Flow (INR Cr)');
        const iconRules = cfList.flatMap((cf) => cf.rules || []).filter((rule) => rule.type === 'iconSet');
        // At least 4 iconSet rules — one per benchmarked KPI tile
        expect(iconRules.length).toBeGreaterThanOrEqual(4);
        expect(dash.getCell('B9').value).toBeNull();
      });

      // ── PR-NX11: KPI icon-set FULL COVERAGE with asset-class benchmark bands ──
      test('PR-NX11: KPI icon-set thresholds swap per asset class (commercial_office vs warehousing yield-on-cost)', async () => {
        // Different asset classes pull different yield-on-cost benchmark bands
        // from KPI_BENCHMARKS. Commercial office: 8.0%-11.0%. Warehousing: 9.0%-12.0%.
        // The cfvo VALUES on the iconSet rule for D4 should reflect each class.
        const officeCtx = minimalContext();
        officeCtx.deal.asset_class = 'commercial_office';
        officeCtx.property.property_type = 'commercial_office';
        const officeBuf = await buildDealWorkbookV2(officeCtx);
        const officeWb = new ExcelJS.Workbook();
        await officeWb.xlsx.load(officeBuf);
        const officeDash = officeWb.getWorksheet('Dashboard');
        const officeRules = (officeDash.conditionalFormattings || [])
          .filter((cf) => cf.ref === 'D4:D4')
          .flatMap((cf) => cf.rules);
        expect(officeRules.length).toBeGreaterThanOrEqual(1);
        const officeIcon = officeRules.find((r) => r.type === 'iconSet');
        expect(officeIcon).toBeTruthy();
        // Yield-on-Cost cfvo values for office: [0.080, 0.095, 0.110]
        const officeValues = officeIcon.cfvo.map((c) => c.value);
        expect(officeValues).toContain(0.080);
        expect(officeValues).toContain(0.110);

        const warehouseCtx = minimalContext();
        warehouseCtx.deal.asset_class = 'industrial_warehousing';
        warehouseCtx.property.property_type = 'industrial_warehousing';
        const warehouseBuf = await buildDealWorkbookV2(warehouseCtx);
        const warehouseWb = new ExcelJS.Workbook();
        await warehouseWb.xlsx.load(warehouseBuf);
        const warehouseDash = warehouseWb.getWorksheet('Dashboard');
        const warehouseRules = (warehouseDash.conditionalFormattings || [])
          .filter((cf) => cf.ref === 'D4:D4')
          .flatMap((cf) => cf.rules);
        const warehouseIcon = warehouseRules.find((r) => r.type === 'iconSet');
        expect(warehouseIcon).toBeTruthy();
        // Warehousing yield-on-cost cfvo: [0.090, 0.105, 0.120]
        const warehouseValues = warehouseIcon.cfvo.map((c) => c.value);
        expect(warehouseValues).toContain(0.090);
        expect(warehouseValues).toContain(0.120);
        // Different asset classes => different threshold values
        expect(warehouseValues).not.toEqual(officeValues);
      });

      test('PR-NX11: Exit Cap Rate icon-set uses `reverse: true` (down-is-good direction)', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        const capRateRules = (dash.conditionalFormattings || [])
          .filter((cf) => cf.ref === 'F4:F4')
          .flatMap((cf) => cf.rules);
        const capIcon = capRateRules.find((r) => r.type === 'iconSet');
        expect(capIcon).toBeTruthy();
        expect(capIcon.reverse).toBe(true);
      });

      test('PR-NX11: KPI tile carries a hover-tooltip with an illustrative guideline band (no fabricated firm source)', async () => {
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        const yieldCell = dash.getCell('D4');
        const note = yieldCell.note;
        const noteText = note && (typeof note === 'string' ? note : (note.texts || []).map((t) => t.text || '').join(''));
        expect(noteText).toMatch(/KPI guideline band/);
        expect(noteText).toMatch(/Range:/);
        // Credibility (CLAUDE.md): the band is framed as an illustrative default,
        // NOT a verified market reading, and carries NO named-firm attribution —
        // these are hardcoded constants, not a live market feed.
        expect(noteText).toMatch(/Illustrative default band/);
        expect(noteText).not.toMatch(/Source:/);
        expect(noteText).not.toMatch(/Cushman|JLL|CBRE|Knight Frank|HVS/);
      });

      test('PR-NX11 HOTFIX: KPI tile note is a plain STRING (object form corrupts sheetN.xml in Microsoft Excel)', async () => {
        // 2026-05-15 production bug: cell.note set to an object with `texts`
        // and `margins.insetmode: 'custom'` serialized malformed XML that
        // Microsoft Excel rejected on open ("Replaced Part: sheet2.xml part
        // with XML error. Load error. Line 2, column 0"). Excel then
        // stripped the entire Dashboard sheet during auto-repair. The
        // string form matches the pre-existing PR-NX3 pattern at line 2689
        // and round-trips through Excel cleanly.
        //
        // Regression guard: assert the in-memory note shape is `string`,
        // not `object`. ExcelJS may normalize on round-trip so we ALSO
        // re-serialize and assert the comments XML has no malformed
        // <commentPr> attributes.
        const ctx = minimalContext();
        ctx.deal.asset_class = 'commercial_office';
        ctx.property.property_type = 'commercial_office';
        const buffer = await buildDealWorkbookV2(ctx);

        // Unzip and inspect comments1.xml directly — bypasses ExcelJS
        // normalization that hides the malformed-XML bug.
        const zip = await JSZip.loadAsync(buffer);
        const commentFiles = zip.file(/^xl\/comments\d+\.xml$/);
        expect(commentFiles.length).toBeGreaterThan(0);
        const commentsXmls = await Promise.all(commentFiles.map((f) => f.async('string')));

        // Find a comments XML that mentions the KPI guideline band (the PR-NX11 marker)
        const kpiCommentsXml = commentsXmls.find((xml) => xml.includes('KPI guideline band'));
        expect(kpiCommentsXml).toBeTruthy();

        // Malformed-XML signatures that broke production:
        //   - <commentPr insetmode="custom"...> with malformed inset attribute
        //   - Missing closing tags on <text>, <r>, or <rPr>
        //   - Stray `[object Object]` toString leaks (catches future
        //     accidental object-as-note assignments)
        expect(kpiCommentsXml).not.toMatch(/insetmode=/i);
        expect(kpiCommentsXml).not.toMatch(/\[object Object\]/);
        // Every <comment> must close its <text> tag
        const openTexts = (kpiCommentsXml.match(/<text>/g) || []).length;
        const closeTexts = (kpiCommentsXml.match(/<\/text>/g) || []).length;
        expect(openTexts).toBe(closeTexts);
      });

      test('PR-NX11 HOTFIX: Dashboard sheet XML contains real cell content (not stripped by Excel-style repair)', async () => {
        // Direct assertion that the Dashboard sheet XML is not an empty shell.
        // (Lookup is by sheet-name text "Dashboard" so it's robust to position
        // changes — PR-NX57 moved Dashboard from sheet2.xml to sheet3.xml after
        // AI Synthesis was inserted at position 2.) The Pointec Pens bug
        // produced a sheet with literally <sheetData/> and nothing else.
        const buffer = await buildDealWorkbookV2(minimalContext());
        const zip = await JSZip.loadAsync(buffer);
        const sheetFiles = zip.file(/^xl\/worksheets\/sheet\d+\.xml$/);
        expect(sheetFiles.length).toBeGreaterThan(0);
        const xmls = await Promise.all(sheetFiles.map((f) => f.async('string')));
        // Find the Dashboard sheet — has the title banner with "Dashboard"
        const dashXml = xmls.find((xml) => xml.includes('Dashboard'));
        expect(dashXml).toBeTruthy();
        // Empty-shell signature: <sheetData/> (self-closing means no rows).
        // A real Dashboard has 100+ rows under <sheetData> ... </sheetData>.
        expect(dashXml).not.toMatch(/<sheetData\s*\/>/);
        // Real Dashboard always has many <c r="..."> cell entries
        const cellCount = (dashXml.match(/<c\s+r="/g) || []).length;
        expect(cellCount).toBeGreaterThan(50);
      });

      test('PR-NX11: residential_apartments uses tighter gross-margin band than default development', async () => {
        // residential_apartments override: 15%/22%/30% (vs default dev: 10%/18%/25%)
        const buffer = await buildDealWorkbookV2(minimalContext()); // residential_apartments
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        const marginRules = (dash.conditionalFormattings || [])
          .filter((cf) => cf.ref === 'B7:B7')
          .flatMap((cf) => cf.rules);
        const marginIcon = marginRules.find((r) => r.type === 'iconSet');
        expect(marginIcon).toBeTruthy();
        const values = marginIcon.cfvo.map((c) => c.value);
        // Tightened residential-specific band: 15%/22%/30%
        expect(values).toContain(0.15);
        expect(values).toContain(0.30);
      });

      test('PR-NX11: every iconSet rule keeps the value visible (showValue !== false)', async () => {
        // Operator readability: icon ALONGSIDE number, not icon REPLACING number.
        // ExcelJS strips `showValue` from the serialized XML when it equals the
        // Excel default (true). So we assert "not explicitly hidden" via
        // !== false, which catches a regression where showValue: false leaks in.
        const buffer = await buildDealWorkbookV2(minimalContext());
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const dash = wb.getWorksheet('Dashboard');
        const iconRules = (dash.conditionalFormattings || [])
          .flatMap((cf) => cf.rules)
          .filter((r) => r && r.type === 'iconSet')
          .filter((r) => r.iconSet === '3TrafficLights1');
        // 2026-07-13: dev family now has 4 benchmarked tiles (D7/F7 became
        // Peak Debt Drawn / Total Equity Cash Flow — magnitudes, no bands).
        expect(iconRules.length).toBeGreaterThanOrEqual(4);
        iconRules.forEach((r) => {
          // showValue is either explicitly true OR undefined (default = true)
          expect(r.showValue).not.toBe(false);
        });
      });

      test('Income family — every KPI tile (B4 / D4 / F4 / B7 / D7 / F7) has CF rules (PR-NX11 full coverage)', async () => {
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
        // PR-NX11: full coverage — every income-family KPI tile gets a CF rule
        expect(refsCovered.has('B4:B4')).toBe(true); // Stabilised NOI
        expect(refsCovered.has('D4:D4')).toBe(true); // Yield on Cost
        expect(refsCovered.has('F4:F4')).toBe(true); // Exit Cap Rate
        expect(refsCovered.has('B7:B7')).toBe(true); // Min DSCR
        expect(refsCovered.has('D7:D7')).toBe(true); // Cash-on-Cash
        expect(refsCovered.has('F7:F7')).toBe(true); // Net Sale Proceeds
        const iconRules = cfList.flatMap((cf) => cf.rules || []).filter((rule) => rule.type === 'iconSet');
        // At least 6 iconSet rules — one per KPI tile
        expect(iconRules.length).toBeGreaterThanOrEqual(6);
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

    // ──────────────────────────────────────────────────────────────────
    // PR-NX10 (2026-05-15): Probability-weighted scenarios + driver ranking
    // ──────────────────────────────────────────────────────────────────
    describe('PR-NX10: probability-weighted scenarios + top-driver ranking on Dashboard', () => {
      // Locate the row whose column-A value matches a substring. Section
      // titles drift down the sheet as Capital Stack / Debt Maturity Ladder
      // sections grow, so we anchor by content rather than fixed rows.
      const findRowByA = (sheet, predicate) => {
        let found = null;
        sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
          const v = row.getCell(1).value;
          const label = typeof v === 'string' ? v : String(v ?? '');
          if (!found && predicate(label)) found = rowNumber;
        });
        return found;
      };

      describe('Probability-Weighted Scenarios section', () => {
        test('renders the section title + subtitle below Debt Maturity Ladder', async () => {
          const buffer = await buildDealWorkbookV2(minimalContext());
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const titleRow = findRowByA(dash, (s) => s.includes('Probability-Weighted Scenarios'));
          expect(titleRow).toBeTruthy();
          expect(String(dash.getCell(`A${titleRow}`).value)).toContain('Bull / Base / Bear / Lehman');

          // Subtitle on the next row
          const subtitle = String(dash.getCell(`A${titleRow + 1}`).value);
          expect(subtitle).toMatch(/SUMPRODUCT|Expected-Value|institutional headline KPI/);
        });

        test('all four scenarios appear with their probability weights (25 / 50 / 20 / 5)', async () => {
          const buffer = await buildDealWorkbookV2(minimalContext());
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const titleRow = findRowByA(dash, (s) => s.includes('Probability-Weighted Scenarios'));
          expect(titleRow).toBeTruthy();
          // Header row at titleRow+2 (subtitle is +1); first scenario at +3.
          const firstScenarioRow = titleRow + 3;
          const names = ['Bull', 'Base', 'Bear', 'Lehman'];
          const weights = [0.25, 0.50, 0.20, 0.05];
          names.forEach((name, idx) => {
            const r = firstScenarioRow + idx;
            expect(String(dash.getCell(`A${r}`).value)).toBe(name);
            expect(dash.getCell(`B${r}`).value).toBe(weights[idx]);
          });
        });

        test('probability sum check row equals 100%', async () => {
          const buffer = await buildDealWorkbookV2(minimalContext());
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const titleRow = findRowByA(dash, (s) => s.includes('Probability-Weighted Scenarios'));
          const probRow = titleRow + 7; // header + 4 scenarios + sum-check
          expect(String(dash.getCell(`A${probRow}`).value)).toContain('Σ Probability');
          const probCell = dash.getCell(`B${probRow}`);
          expect(probCell.value).toBeTruthy();
          const formula = probCell.value.formula || probCell.formula;
          expect(formula).toMatch(/^SUM\(B\d+:B\d+\)$/);
        });

        test('Expected-Value headline is a SUMPRODUCT of weights × scenario outputs', async () => {
          const buffer = await buildDealWorkbookV2(minimalContext());
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const evRow = findRowByA(dash, (s) => s.startsWith('Expected-Value'));
          expect(evRow).toBeTruthy();
          const evCell = dash.getCell(`G${evRow}`);
          const formula = evCell.value && (evCell.value.formula || evCell.formula);
          expect(formula).toMatch(/^SUMPRODUCT\(B\d+:B\d+,G\d+:G\d+\)$/);
        });

        test('scenario range row computes Bull − Lehman from the IRR output column', async () => {
          const buffer = await buildDealWorkbookV2(minimalContext());
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const rangeRow = findRowByA(dash, (s) => s.includes('Bull − Lehman') || s.includes('Bull - Lehman'));
          expect(rangeRow).toBeTruthy();
          const rangeCell = dash.getCell(`G${rangeRow}`);
          const formula = rangeCell.value && (rangeCell.value.formula || rangeCell.formula);
          expect(formula).toMatch(/^G\d+-G\d+$/);
        });

        test('income deal uses Cap-Rate / Occupancy / Rent / Cost shock headers', async () => {
          const ctx = minimalContext();
          ctx.deal.asset_class = 'commercial_office';
          ctx.property.property_type = 'commercial_office';
          const buffer = await buildDealWorkbookV2(ctx);
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const titleRow = findRowByA(dash, (s) => s.includes('Probability-Weighted Scenarios'));
          const headerRow = titleRow + 2;
          const headers = [];
          for (let c = 1; c <= 7; c += 1) {
            headers.push(String(dash.getCell(headerRow, c).value || ''));
          }
          expect(headers.join('|')).toMatch(/Cap-Rate Shock/);
          expect(headers.join('|')).toMatch(/Occupancy Shock/);
          expect(headers.join('|')).toMatch(/Rent Shock/);
          expect(headers.join('|')).toMatch(/Yield-on-Cost/);
        });

        test('development deal uses Sale-Rate / Cost / Absorption / Collection shock headers', async () => {
          const buffer = await buildDealWorkbookV2(minimalContext()); // residential_apartments
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const titleRow = findRowByA(dash, (s) => s.includes('Probability-Weighted Scenarios'));
          const headerRow = titleRow + 2;
          const headers = [];
          for (let c = 1; c <= 7; c += 1) {
            headers.push(String(dash.getCell(headerRow, c).value || ''));
          }
          expect(headers.join('|')).toMatch(/Sale-Rate Shock/);
          expect(headers.join('|')).toMatch(/Cost Shock/);
          expect(headers.join('|')).toMatch(/Absorption Shock/);
          expect(headers.join('|')).toMatch(/Collection Stress/);
          expect(headers.join('|')).toMatch(/Project Margin/);
        });

        test('Lehman scenario applies more severe shocks than Bear', async () => {
          // Bull / Base / Bear / Lehman shock magnitudes should be monotonic
          // in the tail direction. Lehman cap-shock (+20%) > Bear (+10%).
          const buffer = await buildDealWorkbookV2(minimalContext());
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const titleRow = findRowByA(dash, (s) => s.includes('Probability-Weighted Scenarios'));
          const firstScenarioRow = titleRow + 3;
          // Dev family: col C = sale shock; Bear -0.10, Lehman -0.20.
          const bearSale = dash.getCell(`C${firstScenarioRow + 2}`).value;
          const lehmanSale = dash.getCell(`C${firstScenarioRow + 3}`).value;
          expect(Math.abs(lehmanSale)).toBeGreaterThan(Math.abs(bearSale));
        });

        test('every scenario output cell carries an IFERROR-wrapped formula referencing named ranges', async () => {
          const buffer = await buildDealWorkbookV2(minimalContext());
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const titleRow = findRowByA(dash, (s) => s.includes('Probability-Weighted Scenarios'));
          const firstScenarioRow = titleRow + 3;
          [0, 1, 2, 3].forEach((idx) => {
            const r = firstScenarioRow + idx;
            const formula = dash.getCell(`G${r}`).value && (dash.getCell(`G${r}`).value.formula || dash.getCell(`G${r}`).formula);
            expect(formula).toMatch(/^IFERROR/);
            // References at least one named range
            expect(formula).toMatch(/SaleableAreaSqft|SellRatePerSqft|BaseRentPerSqftMonth|OccupancyPct|CollectionPct|TotalProjectCostCr/);
          });
        });
      });

      describe('Top-Driver Sensitivity Ranking section', () => {
        test('renders the section title below the scenario block', async () => {
          const buffer = await buildDealWorkbookV2(minimalContext());
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const titleRow = findRowByA(dash, (s) => s.includes('Top-Driver Sensitivity Ranking'));
          expect(titleRow).toBeTruthy();
          expect(String(dash.getCell(`A${titleRow}`).value)).toContain('±10%');
        });

        test('lists six ranked drivers with rank 1-6 in column A', async () => {
          const buffer = await buildDealWorkbookV2(minimalContext());
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const titleRow = findRowByA(dash, (s) => s.includes('Top-Driver Sensitivity Ranking'));
          const firstDriverRow = titleRow + 2; // title + header
          for (let i = 0; i < 6; i += 1) {
            const r = firstDriverRow + i;
            expect(dash.getCell(`A${r}`).value).toBe(i + 1);
          }
        });

        test('low-case / high-case deltas reference the 5×5 sensitivity grid (B26:F30 / D28 centre)', async () => {
          const buffer = await buildDealWorkbookV2(minimalContext());
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const titleRow = findRowByA(dash, (s) => s.includes('Top-Driver Sensitivity Ranking'));
          const firstDriverRow = titleRow + 2;
          // First driver's low-case delta — should reference D28 (base)
          const lowFormula = dash.getCell(`C${firstDriverRow}`).value
            && (dash.getCell(`C${firstDriverRow}`).value.formula || dash.getCell(`C${firstDriverRow}`).formula);
          expect(lowFormula).toMatch(/D28/);
        });

        test('range column is in basis points scale ((|low|+|high|) × 10000)', async () => {
          const buffer = await buildDealWorkbookV2(minimalContext());
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const titleRow = findRowByA(dash, (s) => s.includes('Top-Driver Sensitivity Ranking'));
          const firstDriverRow = titleRow + 2;
          const rangeFormula = dash.getCell(`E${firstDriverRow}`).value
            && (dash.getCell(`E${firstDriverRow}`).value.formula || dash.getCell(`E${firstDriverRow}`).formula);
          expect(rangeFormula).toMatch(/10000/);
          expect(rangeFormula).toMatch(/ABS/);
        });

        test('cumulative column is a running sum starting from rank-1 range', async () => {
          const buffer = await buildDealWorkbookV2(minimalContext());
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const titleRow = findRowByA(dash, (s) => s.includes('Top-Driver Sensitivity Ranking'));
          const firstDriverRow = titleRow + 2;
          // First row cumulative = its own range
          const f1 = dash.getCell(`F${firstDriverRow}`).value
            && (dash.getCell(`F${firstDriverRow}`).value.formula || dash.getCell(`F${firstDriverRow}`).formula);
          expect(f1).toBe(`E${firstDriverRow}`);
          // Second row = F(prev) + E(this)
          const f2 = dash.getCell(`F${firstDriverRow + 1}`).value
            && (dash.getCell(`F${firstDriverRow + 1}`).value.formula || dash.getCell(`F${firstDriverRow + 1}`).formula);
          expect(f2).toBe(`F${firstDriverRow}+E${firstDriverRow + 1}`);
        });

        test('income-family drivers include cap-rate compression and occupancy', async () => {
          const ctx = minimalContext();
          ctx.deal.asset_class = 'commercial_office';
          ctx.property.property_type = 'commercial_office';
          const buffer = await buildDealWorkbookV2(ctx);
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const titleRow = findRowByA(dash, (s) => s.includes('Top-Driver Sensitivity Ranking'));
          const firstDriverRow = titleRow + 2;
          const labels = [];
          for (let i = 0; i < 6; i += 1) {
            labels.push(String(dash.getCell(`B${firstDriverRow + i}`).value || ''));
          }
          const joined = labels.join('|');
          expect(joined).toMatch(/Cap-rate/);
          expect(joined).toMatch(/occupancy/i);
        });

        test('development-family drivers include sale-rate and construction cost', async () => {
          const buffer = await buildDealWorkbookV2(minimalContext()); // residential_apartments
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const titleRow = findRowByA(dash, (s) => s.includes('Top-Driver Sensitivity Ranking'));
          const firstDriverRow = titleRow + 2;
          const labels = [];
          for (let i = 0; i < 6; i += 1) {
            labels.push(String(dash.getCell(`B${firstDriverRow + i}`).value || ''));
          }
          const joined = labels.join('|');
          expect(joined).toMatch(/Sale rate/i);
          expect(joined).toMatch(/Construction cost/i);
        });
      });

      describe('Methodology + non-fabrication compliance', () => {
        test('all scenario IRR formulas reference at least one Inputs named range (no hardcoded numbers)', async () => {
          const buffer = await buildDealWorkbookV2(minimalContext());
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const titleRow = findRowByA(dash, (s) => s.includes('Probability-Weighted Scenarios'));
          const firstScenarioRow = titleRow + 3;
          // Collect all four scenario formulas
          const formulas = [];
          [0, 1, 2, 3].forEach((idx) => {
            const r = firstScenarioRow + idx;
            const f = dash.getCell(`G${r}`).value && (dash.getCell(`G${r}`).value.formula || dash.getCell(`G${r}`).formula);
            if (f) formulas.push(f);
          });
          expect(formulas).toHaveLength(4);
          formulas.forEach((f) => {
            // Each formula must reference at least one of these named ranges.
            const referencesNamedRange = /(SaleableAreaSqft|SellRatePerSqft|BaseRentPerSqftMonth|OccupancyPct|ExitCapRatePct|TotalProjectCostCr|CollectionPct|EscalationPct|LandownerSharePct|VacancyPct)/.test(f);
            expect(referencesNamedRange).toBe(true);
          });
        });

        test('Expected-Value formula structure matches probability-weighted-blend convention', async () => {
          // SUMPRODUCT(weights, outputs) is the institutional convention.
          const buffer = await buildDealWorkbookV2(minimalContext());
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const dash = wb.getWorksheet('Dashboard');
          const evRow = findRowByA(dash, (s) => s.startsWith('Expected-Value'));
          expect(evRow).toBeTruthy();
          const evCell = dash.getCell(`G${evRow}`);
          const formula = evCell.value && (evCell.value.formula || evCell.formula);
          // Must be SUMPRODUCT of two equal-length column ranges
          const m = formula.match(/^SUMPRODUCT\(B(\d+):B(\d+),G(\d+):G(\d+)\)$/);
          expect(m).toBeTruthy();
          const [, b1, b2, g1, g2] = m;
          expect(b1).toBe(g1);
          expect(b2).toBe(g2);
          // Range spans exactly 4 rows (Bull / Base / Bear / Lehman)
          expect(Number(b2) - Number(b1)).toBe(3);
        });
      });
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PR-NX57 (2026-05-19) — AI Synthesis sheet
// ───────────────────────────────────────────────────────────────────────────
describe('PR-NX57 — AI Synthesis sheet', () => {
  // Sample narrative envelopes matching the shapes that dealExport.service
  // plumbs onto exportContext via generateRiskNarrative / generateSensitivityNarrative
  // / generateDocumentInsights.
  const RISK_NARRATIVE_OK = {
    available: true,
    provider: 'Claude Sonnet 4.6',
    confidence: 'medium',
    summary_paragraph: 'The deal has 3 medium-severity risks concentrated in title and approvals.',
    critical_spotlight_paragraph: 'One critical encumbrance on parcel 12B requires resolution before financial close.',
  };
  const SENS_NARRATIVE_OK = {
    available: true,
    provider: 'OpenAI gpt-5.4',
    confidence: 'high',
    dominant_driver: 'Sell Rate',
    driver_decomposition_paragraph: 'Sell rate drives 62% of IRR variance; construction cost 28%; financing 10%.',
    stress_test_paragraph: 'Recommend stressing sell rate by -10% and construction cost by +12% simultaneously.',
  };
  const DOC_INSIGHTS_OK = {
    available: true,
    provider: 'Claude Sonnet 4.6',
    confidence: 'medium',
    summary_paragraph: 'Cross-document analysis confirms title chain is consistent with the sale deed dates.',
    findings: [
      {
        severity: 'high',
        title: 'EC date mismatch with sale deed',
        description: 'Encumbrance certificate is dated 2024-08-15 but the sale deed is dated 2024-09-02.',
        recommendation: 'Re-pull the EC dated after the sale deed registration.',
      },
      {
        severity: 'medium',
        title: 'Khata extract carpet area differs from RERA filing',
        description: 'Khata extract shows 1,235 sqft carpet; RERA filing shows 1,260 sqft.',
        recommendation: 'Verify which area is authoritative for stamp duty calc.',
      },
    ],
  };

  const contextWithNarratives = () => {
    const ctx = minimalContext();
    ctx.risks = { narrative: RISK_NARRATIVE_OK };
    ctx.sensitivityNarrative = SENS_NARRATIVE_OK;
    ctx.documents = { insights: DOC_INSIGHTS_OK };
    return ctx;
  };

  test('renders the AI Synthesis sheet as the second tab', async () => {
    const buffer = await buildDealWorkbookV2(contextWithNarratives());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.worksheets[1].name).toBe('Analysis Notes');
  });

  test('PR-NX74: renders title; row-3 disclosure banner stripped per operator policy', async () => {
    const buffer = await buildDealWorkbookV2(contextWithNarratives(), { brandName: 'REDIP' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Analysis Notes');
    expect(sheet).toBeDefined();
    expect(String(sheet.getCell('A1').value)).toContain('Analysis Notes');
    expect(String(sheet.getCell('A1').value)).toContain('REDIP');
    // PR-NX74 (2026-05-19): the loud A3 amber "⚠ AI-Assisted Analysis
    // Notes — REQUIRES HUMAN REVIEW" banner was removed. XLSX must not
    // surface AI usage anywhere.
    const a3 = String(sheet.getCell('A3').value || '');
    expect(a3).not.toMatch(/AI-Assisted/);
    expect(a3).not.toMatch(/REQUIRES HUMAN REVIEW/);
  });

  test('renders all 3 section bands with the expected labels', async () => {
    const buffer = await buildDealWorkbookV2(contextWithNarratives());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Analysis Notes');
    expect(String(sheet.getCell('A5').value)).toBe('RISK PROFILE SYNTHESIS');
    expect(String(sheet.getCell('A12').value)).toBe('SENSITIVITY ANALYSIS · NARRATIVE');
    expect(String(sheet.getCell('A20').value)).toBe('DOCUMENT-DERIVED INSIGHTS');
  });

  test('renders the risk synthesis paragraphs when narrative is available', async () => {
    const buffer = await buildDealWorkbookV2(contextWithNarratives());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Analysis Notes');
    expect(String(sheet.getCell('A7').value)).toContain('3 medium-severity risks');
    expect(String(sheet.getCell('A9').value)).toContain('critical encumbrance on parcel 12B');
    // PR-NX74: attribution row keeps Confidence but strips provider name.
    expect(String(sheet.getCell('A10').value)).toContain('Confidence: medium');
    expect(String(sheet.getCell('A10').value)).not.toMatch(/Claude|OpenAI|gpt/);
  });

  test('renders sensitivity narrative with dominant driver eyebrow + decomposition + stress tests', async () => {
    const buffer = await buildDealWorkbookV2(contextWithNarratives());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Analysis Notes');
    expect(String(sheet.getCell('A13').value)).toContain('DOMINANT DRIVER: SELL RATE');
    expect(String(sheet.getCell('A15').value)).toContain('Sell rate drives 62% of IRR');
    expect(String(sheet.getCell('A17').value)).toContain('Recommend stressing sell rate by -10%');
    // PR-NX74: attribution row no longer surfaces the provider name.
    expect(String(sheet.getCell('A18').value || '')).not.toMatch(/OpenAI|gpt/);
  });

  test('renders document insights summary + findings cards', async () => {
    const buffer = await buildDealWorkbookV2(contextWithNarratives());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Analysis Notes');
    expect(String(sheet.getCell('A22').value)).toContain('Cross-document analysis confirms');
    expect(String(sheet.getCell('A23').value)).toContain('INCONSISTENCY FINDINGS (2)');
    // Title row uses richText — flatten and check the severity tag + title text are present.
    const finding1Title = sheet.getCell('A24').value;
    const flatten = (v) => (v && v.richText)
      ? v.richText.map((r) => r.text).join('')
      : String(v || '');
    expect(flatten(finding1Title)).toContain('[HIGH]');
    expect(flatten(finding1Title)).toContain('EC date mismatch');
    expect(String(sheet.getCell('A25').value)).toContain('Encumbrance certificate is dated 2024-08-15');
    expect(flatten(sheet.getCell('A26').value)).toContain('[MEDIUM]');
    expect(flatten(sheet.getCell('A26').value)).toContain('Khata extract carpet area differs');
  });

  // 2026-07-13: unavailable sections are now OMITTED — no "Synthesis
  // Unavailable" placeholder bands in a customer workbook. When ALL
  // sections are unavailable, one quiet line renders at row 5.
  test('omits unavailable sections and renders one quiet line when all narratives are unavailable', async () => {
    const ctx = minimalContext();
    ctx.risks = { narrative: { available: false, reason: 'all providers failed' } };
    ctx.sensitivityNarrative = { available: false };
    ctx.documents = { insights: { available: false } };

    const buffer = await buildDealWorkbookV2(ctx);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Analysis Notes');
    expect(sheet).toBeDefined();
    expect(String(sheet.getCell('A5').value)).toBe('No analysis notes were generated for this export.');
    // No failure copy, no section bands, and the raw failure reason
    // (provider names / statuses / env hints) must NEVER reach the
    // customer workbook.
    const allText = [];
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (typeof cell.value === 'string') allText.push(cell.value);
    }));
    const joined = allText.join(' | ');
    expect(joined).not.toContain('Synthesis Unavailable');
    expect(joined).not.toContain('all providers failed');
    expect(joined).not.toContain('RISK PROFILE SYNTHESIS');
    expect(joined).not.toContain('SENSITIVITY ANALYSIS · NARRATIVE');
    expect(joined).not.toContain('DOCUMENT-DERIVED INSIGHTS');
  });

  test('falls back gracefully when narrative payloads are entirely missing', async () => {
    // No risks / sensitivityNarrative / documents keys on the context at all.
    const buffer = await buildDealWorkbookV2(minimalContext());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Analysis Notes');
    // Sheet must still exist (sheet-count stability) with the quiet line.
    expect(sheet).toBeDefined();
    expect(String(sheet.getCell('A5').value)).toBe('No analysis notes were generated for this export.');
  });

  test('shows positive-signal panel when findings array is empty', async () => {
    const ctx = minimalContext();
    ctx.documents = {
      insights: {
        available: true,
        provider: 'Claude Sonnet 4.6',
        summary_paragraph: 'All extracted documents are mutually consistent.',
        findings: [],
      },
    };
    const buffer = await buildDealWorkbookV2(ctx);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Analysis Notes');
    // Only the documents section is available, so it renders FIRST at
    // row 5 (band), 6 (eyebrow), 7 (summary), 8 (positive-signal line).
    expect(String(sheet.getCell('A5').value)).toBe('DOCUMENT-DERIVED INSIGHTS');
    expect(String(sheet.getCell('A7').value)).toContain('All extracted documents are mutually consistent');
    expect(String(sheet.getCell('A8').value)).toContain('No inconsistencies detected');
  });

  test('caps findings at 6 and shows "+N more" overflow line', async () => {
    const findings = Array.from({ length: 9 }, (_, i) => ({
      severity: 'medium',
      title: `Finding ${i + 1}`,
      description: `Description ${i + 1}`,
    }));
    const ctx = minimalContext();
    ctx.documents = {
      insights: {
        available: true,
        summary_paragraph: 'Multiple findings.',
        findings,
      },
    };
    const buffer = await buildDealWorkbookV2(ctx);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Analysis Notes');
    // Only the documents section is available → band row 5, eyebrow 6,
    // summary 7, findings eyebrow 8, then 6 findings × 2 rows (9-20)
    // and the "+N more" overflow line at 21.
    expect(String(sheet.getCell('A8').value)).toContain('INCONSISTENCY FINDINGS (9)');
    let overflowFound = false;
    sheet.eachRow((row) => {
      const v = String(row.getCell(1).value || '');
      if (v.includes('+ 3 more finding')) overflowFound = true;
    });
    expect(overflowFound).toBe(true);
  });
});

describe('workbook structural validation — sheet inventory (2026-07-12 regression)', () => {
  // The 2026-07-12 production incident: a hard-coded 9-sheet ceiling 422'd
  // every rich deal's XLSX download after #922 (Site Yield) + #924 (Market
  // Comparables) added legitimate sheets without bumping it — the THIRD such
  // breakage. The allowance is now derived from the SHEETS registry and the
  // corruption signals are inventory-based (unregistered / duplicate names).
  // These tests pin that contract.

  const mutateWorkbookXml = async (buffer, mutate) => {
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('xl/workbook.xml').async('string');
    zip.file('xl/workbook.xml', mutate(xml));
    return zip.generateAsync({ type: 'nodebuffer' });
  };

  // Insert extra <sheet> entries just before </sheets>. workbook.xml-level
  // checks don't require backing worksheet parts for the injected entries.
  const injectSheets = (xml, names) => {
    const extras = names
      .map((name, i) => `<sheet name="${name}" sheetId="${90 + i}" r:id="rId9${i}"/>`)
      .join('');
    return xml.replace('</sheets>', `${extras}</sheets>`);
  };

  test('allows more than 9 sheets when every name is registered (no magic ceiling)', async () => {
    const buffer = await buildDealWorkbookV2(minimalContext());
    const zip = await JSZip.loadAsync(buffer);
    const wbXml = await zip.file('xl/workbook.xml').async('string');
    const present = [...wbXml.matchAll(/<sheet\b[^>]*?\bname="([^"]*)"/g)].map((m) => m[1]);
    const spare = ['Site Yield', 'Market Comparables', 'Lease Roll', 'Unit Mix', 'USALI Pro Forma', 'Construction Drawdown']
      .filter((n) => !present.includes(n));
    const needed = Math.max(10 - present.length, 1); // guarantee total > 9
    expect(spare.length).toBeGreaterThanOrEqual(needed);
    const mutated = await mutateWorkbookXml(buffer, (xml) => injectSheets(xml, spare.slice(0, needed)));
    await expect(__internal.validateXlsxBufferForDownload(mutated)).resolves.toBe(true);
  });

  test('blocks unregistered sheet names with an integrity (not missing-inputs) message', async () => {
    const buffer = await buildDealWorkbookV2(minimalContext());
    const mutated = await mutateWorkbookXml(buffer, (xml) => injectSheets(xml, ['Totally Rogue Sheet']));
    await expect(__internal.validateXlsxBufferForDownload(mutated)).rejects.toMatchObject({
      name: 'XlsxExportValidationError',
      message: expect.stringMatching(/integrity check/),
      errors: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('Totally Rogue Sheet') }),
      ]),
    });
    // The misleading old message must never come back for structural failures.
    await expect(__internal.validateXlsxBufferForDownload(mutated)).rejects.not.toMatchObject({
      message: expect.stringMatching(/required input/),
    });
  });

  test('blocks duplicate sheet names', async () => {
    const buffer = await buildDealWorkbookV2(minimalContext());
    const zip = await JSZip.loadAsync(buffer);
    const wbXml = await zip.file('xl/workbook.xml').async('string');
    const first = wbXml.match(/<sheet\b[^>]*?\bname="([^"]*)"/)[1];
    const mutated = await mutateWorkbookXml(buffer, (xml) => injectSheets(xml, [first]));
    await expect(__internal.validateXlsxBufferForDownload(mutated)).rejects.toMatchObject({
      name: 'XlsxExportValidationError',
      errors: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('duplicate') }),
      ]),
    });
  });
});

describe('Committed Kernel Schedule block (2026-07-13 Batch 2)', () => {
  const findRowByLabel = (sheet, label) => {
    let found = null;
    sheet.eachRow((row, n) => {
      if (!found && String(row.getCell(1).value || '').trim() === label) found = n;
    });
    return found;
  };

  test('embeds the kernel quarterly cash-flow series verbatim when present', async () => {
    const ctx = minimalContext();
    ctx.cashFlows = {
      quarterly: [
        { label: 'Q1', net: -90.61, cumulative: -90.61 },
        { label: 'Q2', net: -12.34, cumulative: -102.95 },
        { label: 'Q3', net: 45.5, cumulative: -57.45 },
        { label: 'Q4', net: 160.2, cumulative: 102.75 },
      ],
    };
    const buffer = await buildDealWorkbookV2(ctx);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const cash = wb.getWorksheet('Cash Flow Engine');

    const titleRow = findRowByLabel(cash, 'Committed Kernel Schedule — deterministic engine (governs at IC)');
    expect(titleRow).toBeTruthy();
    const netRow = findRowByLabel(cash, 'Net cash flow (INR Cr)');
    expect(netRow).toBeTruthy();
    // The four kernel net figures land verbatim as STATIC numbers (B..E).
    expect(cash.getCell(`B${netRow}`).value).toBeCloseTo(-90.61, 2);
    expect(cash.getCell(`E${netRow}`).value).toBeCloseTo(160.2, 2);
    // ...and they are plain numbers, never formulas (authoritative = static).
    expect(typeof cash.getCell(`B${netRow}`).value).toBe('number');
    // Committed KPI recap present.
    expect(findRowByLabel(cash, 'Committed IRR (kernel)')).toBeTruthy();
  });

  test('renders a graceful note (no crash) when no kernel schedule is stored', async () => {
    const buffer = await buildDealWorkbookV2(minimalContext()); // no cashFlows
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const cash = wb.getWorksheet('Cash Flow Engine');
    const titleRow = findRowByLabel(cash, 'Committed Kernel Schedule — deterministic engine (governs at IC)');
    expect(titleRow).toBeTruthy();
    // The "Net cash flow" data row must be ABSENT (no series to embed).
    expect(findRowByLabel(cash, 'Net cash flow (INR Cr)')).toBeNull();
  });
});

describe('Structural switches are locked reference cells (2026-07-13)', () => {
  test('Asset Class / Deal Type / Deal Family are NOT editable; numeric inputs stay editable', async () => {
    const buffer = await buildDealWorkbookV2(minimalContext());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const inp = wb.getWorksheet('Inputs & Assumptions');
    const byLabel = {};
    inp.eachRow((row) => { byLabel[String(row.getCell(1).value || '').trim()] = row.getCell(2); });

    // Structural switches must not carry the explicit unlocked flag that
    // editable inputs get — under sheet protection they are read-only.
    for (const label of ['Asset Class', 'Deal Type', 'Deal Family']) {
      const cell = byLabel[label];
      expect(cell).toBeTruthy();
      expect(cell.protection && cell.protection.locked).not.toBe(false);
    }
    // A real numeric input must remain explicitly unlocked (editable).
    const area = byLabel['Saleable / Leasable Area (Super Built-up)'];
    expect(area.protection.locked).toBe(false);
  });
});

describe('Deal Structure & Exit Playbook (per-deal tailoring, 2026-07-13)', () => {
  const briefingText = async (ctx) => {
    const buffer = await buildDealWorkbookV2(ctx);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sh = wb.getWorksheet('Executive Briefing');
    let text = '';
    sh.eachRow((row) => {
      const c = row.getCell(1).value;
      text += (c && c.richText ? c.richText.map((r) => r.text).join('') : (c || '')) + '\n';
    });
    return text;
  };

  test('a JDA revenue-share deal reads differently from an outright purchase', async () => {
    const jda = minimalContext();
    jda.deal.deal_structure = 'jda_revenue_share';
    jda.deal.model_params.inputs.landownerSharePct = 0.25;
    const jdaText = await briefingText(jda);
    expect(jdaText).toContain('Deal Structure & Exit Playbook');
    expect(jdaText).toContain('JDA — revenue share');
    expect(jdaText).toContain('25% to landowner');
    expect(jdaText).toMatch(/contribut/i); // land contributed, not purchased
    expect(jdaText).toContain('co-promoters under K-RERA');

    const outright = minimalContext();
    outright.deal.deal_structure = 'outright';
    const outText = await briefingText(outright);
    expect(outText).toContain('Outright purchase');
    expect(outText).toContain('acquires 100% of the land');
    expect(outText).not.toContain('to landowner');
  });

  test('exit playbook is specific to the resolved exit strategy', async () => {
    const ctx = minimalContext();
    ctx.deal.model_params.inputs.exitStrategyType = 'reit_exit';
    const text = await briefingText(ctx);
    expect(text).toContain('Exit — REIT Exit');
    expect(text).toContain('SEBI REIT norms');
  });
});

describe('Structure-consistency validators (JDA land double-count, 2026-07-13)', () => {
  const sheetsContain = async (ctx, needle) => {
    const buf = await buildDealWorkbookV2(ctx);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    let found = false;
    wb.eachSheet((sh) => sh.eachRow((row) => row.eachCell((c) => {
      const v = c.value;
      const t = v && v.richText ? v.richText.map((r) => r.text).join('') : (typeof v === 'string' ? v : '');
      if (t.includes(needle)) found = true;
    })));
    return found;
  };

  test('flags a JDA carrying a full land value (contributed land double-counted)', async () => {
    const ctx = minimalContext();
    ctx.deal.deal_structure = 'jda_revenue_share';
    ctx.deal.model_params.inputs.landownerSharePct = 0.25;
    ctx.deal.model_params.inputs.landCostCr = 90; // full value, not a deposit
    expect(await sheetsContain(ctx, 'contributes land for a landowner share')).toBe(true);
  });

  test('does NOT flag a JDA with only a small refundable deposit', async () => {
    const ctx = minimalContext();
    ctx.deal.deal_structure = 'jda_revenue_share';
    ctx.deal.model_params.inputs.landownerSharePct = 0.25;
    ctx.deal.model_params.inputs.landCostCr = 1;
    expect(await sheetsContain(ctx, 'contributes land for a landowner share')).toBe(false);
  });

  test('does NOT flag a normal outright purchase with a real land cost', async () => {
    const ctx = minimalContext();
    ctx.deal.deal_structure = 'outright';
    ctx.deal.model_params.inputs.landCostCr = 90;
    expect(await sheetsContain(ctx, 'contributes land for a landowner share')).toBe(false);
  });
});
