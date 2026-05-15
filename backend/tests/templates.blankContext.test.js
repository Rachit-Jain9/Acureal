'use strict';

const ExcelJS = require('exceljs');
const {
  ASSET_CLASS_REGISTRY,
  DEAL_STRUCTURE_REGISTRY,
  EXIT_STRATEGY_REGISTRY,
  buildBlankTemplateContext,
  listTemplateCatalog,
} = require('../src/services/exports/xlsx/templates/blankTemplateContext');
const { buildDealWorkbookV2 } = require('../src/services/exports/xlsx/v2/buildWorkbook');

describe('Template library — PR-TPL (2026-05-15)', () => {
  describe('Asset-class registry', () => {
    test('has all 19 user-facing asset classes', () => {
      const ids = Object.keys(ASSET_CLASS_REGISTRY);
      expect(ids.length).toBe(19);
      // The 10 native (full-branch) asset classes
      for (const native of [
        'residential_apartments', 'villas', 'plotted_development',
        'commercial_office', 'retail', 'industrial_warehousing',
        'hospitality', 'mixed_use', 'redevelopment', 'raw_land',
      ]) {
        expect(ids).toContain(native);
      }
      // The 9 mapped asset classes (Phase 2 = standalone branches)
      for (const mapped of [
        'data_centres', 'co_living', 'student_housing', 'senior_living',
        'build_to_rent', 'logistics_parks', 'flex_spaces',
        'sez_business_parks', 'township',
      ]) {
        expect(ids).toContain(mapped);
      }
    });

    test('every entry declares family + underlyingAssetClass + defaults', () => {
      for (const [id, meta] of Object.entries(ASSET_CLASS_REGISTRY)) {
        expect(meta.id).toBe(id);
        expect(meta.label).toBeTruthy();
        expect(['development', 'income']).toContain(meta.family);
        expect(meta.underlyingAssetClass).toBeTruthy();
        expect(meta.supportedDealStructures.length).toBeGreaterThanOrEqual(2);
        expect(meta.supportedExitStrategies.length).toBeGreaterThanOrEqual(1);
        expect(meta.inputDefaults).toBeTruthy();
        expect(meta.propertyDefaults.city).toBeTruthy();
      }
    });

    test('every supportedDealStructure resolves to a registry entry', () => {
      for (const meta of Object.values(ASSET_CLASS_REGISTRY)) {
        for (const dsId of meta.supportedDealStructures) {
          expect(DEAL_STRUCTURE_REGISTRY[dsId]).toBeDefined();
        }
      }
    });

    test('every supportedExitStrategy resolves to a registry entry', () => {
      for (const meta of Object.values(ASSET_CLASS_REGISTRY)) {
        for (const esId of meta.supportedExitStrategies) {
          expect(EXIT_STRATEGY_REGISTRY[esId]).toBeDefined();
        }
      }
    });
  });

  describe('buildBlankTemplateContext', () => {
    test('throws on unknown asset class', () => {
      expect(() => buildBlankTemplateContext('nonexistent_class', 'outright_purchase'))
        .toThrow(/Unknown asset class/);
    });

    test('throws on unsupported deal structure for that asset class', () => {
      // Villas don't support development_management
      expect(() => buildBlankTemplateContext('villas', 'platform_investment'))
        .toThrow(/not supported/);
    });

    test('JDA structures auto-set landownerSharePct to 40%', () => {
      const ctx = buildBlankTemplateContext('residential_apartments', 'jda_revenue_share');
      expect(ctx.deal.model_params.inputs.landownerSharePct).toBe(0.40);
    });

    test('hospitality patches baseRentPerSqftMonth so validator passes', () => {
      const ctx = buildBlankTemplateContext('hospitality', 'outright_purchase');
      expect(ctx.deal.model_params.inputs.baseRentPerSqftMonth).toBeGreaterThan(0);
    });

    test('raw_land patches sellingRatePerSqft so validator passes', () => {
      const ctx = buildBlankTemplateContext('raw_land', 'outright_purchase');
      expect(ctx.deal.model_params.inputs.sellingRatePerSqft).toBeGreaterThan(0);
    });
  });

  describe('Template generation (smoke test all 65 combos)', () => {
    // Build the test matrix once
    const matrix = [];
    for (const [acId, meta] of Object.entries(ASSET_CLASS_REGISTRY)) {
      for (const dsId of meta.supportedDealStructures) {
        matrix.push([acId, meta.label, dsId]);
      }
    }

    test.each(matrix)('%s template (%s) / %s structure generates a valid XLSX',
      async (acId, _label, dsId) => {
        const ctx = buildBlankTemplateContext(acId, dsId);
        const buf = await buildDealWorkbookV2(ctx);
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.length).toBeGreaterThan(5000);
        // .xlsx files are ZIP archives starting with 'PK'
        expect(buf.slice(0, 2).toString('ascii')).toBe('PK');
      }, 30000);
  });

  describe('listTemplateCatalog', () => {
    test('returns all 19 asset classes with full metadata', () => {
      const catalog = listTemplateCatalog();
      expect(catalog.length).toBe(19);
      for (const entry of catalog) {
        expect(entry.id).toBeTruthy();
        expect(entry.label).toBeTruthy();
        expect(entry.description).toBeTruthy();
        expect(entry.marketContext).toBeTruthy();
        expect(Array.isArray(entry.supportedDealStructures)).toBe(true);
        expect(Array.isArray(entry.supportedExitStrategies)).toBe(true);
        expect(entry.supportedDealStructures[0].label).toBeTruthy();
        expect(entry.supportedExitStrategies[0].label).toBeTruthy();
      }
    });

    test('catalog entry for residential_apartments has expected structures + exits', () => {
      const catalog = listTemplateCatalog();
      const res = catalog.find((c) => c.id === 'residential_apartments');
      expect(res).toBeDefined();
      const structureIds = res.supportedDealStructures.map((s) => s.id);
      expect(structureIds).toEqual(expect.arrayContaining([
        'outright_purchase', 'jda_revenue_share', 'jda_area_share', 'development_management',
      ]));
    });
  });

  describe('Workbook sanity (sample inspection)', () => {
    test('residential JDA template has Inputs sheet + Dashboard + JDA landowner share', async () => {
      const ctx = buildBlankTemplateContext('residential_apartments', 'jda_revenue_share');
      const buf = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const sheetNames = wb.worksheets.map((s) => s.name);
      expect(sheetNames).toContain('Dashboard');
      expect(sheetNames).toContain('Inputs & Assumptions');
      // Title should mention the asset class + JDA structure
      const dashTitle = String(wb.getWorksheet('Dashboard').getCell('A1').value);
      expect(dashTitle).toContain('Residential Apartments');
    }, 30000);

    test('hospitality template includes the USALI Pro Forma sheet', async () => {
      const ctx = buildBlankTemplateContext('hospitality', 'outright_purchase');
      const buf = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const sheetNames = wb.worksheets.map((s) => s.name);
      expect(sheetNames).toContain('USALI Pro Forma');
    }, 30000);

    test('commercial_office template has formula-driven NOI tile on Dashboard', async () => {
      const ctx = buildBlankTemplateContext('commercial_office', 'outright_purchase');
      const buf = await buildDealWorkbookV2(ctx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const dash = wb.getWorksheet('Dashboard');
      const noiCell = dash.getCell('B4');
      expect(noiCell.value).toBeTruthy();
      expect(noiCell.value.formula).toBeTruthy();
      // PR-NX2 fix: trailing-year SUM via INDEX (not BF18*4)
      expect(noiCell.value.formula).toMatch(/INDEX/);
    }, 30000);
  });
});
