'use strict';

/**
 * Tests for dealBriefing.service (PR-NX7).
 *
 * Covers:
 *   - Numeric snapshot extraction from a deal context
 *   - Templated narrative generation (deterministic, no AI)
 *   - AI response parsing (well-formed + malformed JSON paths)
 *   - End-to-end via buildDealWorkbookV2 — Executive Briefing sheet
 *     is the first tab, carries the right structure, mandatory disclaimer
 *     present.
 */

const ExcelJS = require('exceljs');
const {
  generateDealBriefing,
  buildNumericSnapshot,
  buildTemplatedBriefing,
  parseBriefingResponse,
} = require('../src/services/exports/xlsx/v2/dealBriefing.service');
const { buildDealWorkbookV2, __internal } = require('../src/services/exports/xlsx/v2/buildWorkbook');

const minimalIncomeCtx = () => ({
  deal: {
    id: 'test-1',
    name: 'Whitefield Office Tower',
    asset_class: 'commercial_office',
    deal_structure: 'outright_purchase',
    exit_strategy: 'strategic_sale',
    city: 'Bengaluru',
    state: 'Karnataka',
    project_duration_months: 60,
    irr_pct: 0.14,
    npv_cr: 35,
    equity_multiple: 1.85,
    noi_cr: 42,
    yield_on_cost_pct: 0.084,
    exit_value_cr: 520,
    model_params: { inputs: {
      assetClass: 'commercial_office',
      saleableAreaSqft: 525000,
      baseRentPerSqftMonth: 110,
      landCostCr: 95,
      constructionCostPerSqft: 6800,
      exitCapRate: 0.080,
      occupancyPct: 0.92,
      debtLTV: 0.60,
      debtRatePct: 0.105,
      gstPct: 0,
      stampDutyPct: 0.066,
      khataStatus: 'A_khata',
    } },
  },
  property: {
    property_name: 'Whitefield Office Tower',
    property_type: 'commercial_office',
    city: 'Bengaluru',
    micro_market: 'Outer Ring Road',
    saleable_area_sqft: 525000,
    land_area_sqft: 200000,
    existing_fsi: 3.25,
  },
});

const minimalDevCtx = () => ({
  deal: {
    id: 'test-2',
    name: 'Sarjapur Phase 1',
    asset_class: 'residential_apartments',
    deal_structure: 'jda_revenue_share',
    exit_strategy: 'outright_progressive',
    city: 'Bengaluru',
    project_duration_months: 48,
    irr_pct: 0.18,
    gross_margin_pct: 0.22,
    total_revenue_cr: 350,
    total_cost_cr: 270,
    model_params: { inputs: {
      assetClass: 'residential_apartments',
      saleableAreaSqft: 350000,
      sellingRatePerSqft: 9500,
      landCostCr: 65,
      constructionCostPerSqft: 4500,
      customerCollectionPct: 0.85,
      gstPct: 0.05,
      stampDutyPct: 0.066,
      khataStatus: 'A_khata',
      landownerSharePct: 0.40,
    } },
  },
  property: {
    property_name: 'Sarjapur Phase 1',
    property_type: 'residential_apartments',
    city: 'Bengaluru',
    micro_market: 'Sarjapur',
    saleable_area_sqft: 350000,
    land_area_sqft: 175000,
    existing_fsi: 2.0,
  },
});

describe('dealBriefing.service (PR-NX7)', () => {
  describe('buildNumericSnapshot', () => {
    test('extracts asset / structure / exit labels + India context from income deal', () => {
      const ctx = __internal.prepareWorkbookContext(minimalIncomeCtx(), { strictValidation: false });
      const snapshot = buildNumericSnapshot(ctx);
      expect(snapshot.assetClass).toBe('commercial_office');
      expect(snapshot.assetLabel).toBe('Commercial Office');
      expect(snapshot.structureLabel).toBe('Outright Purchase');
      expect(snapshot.exitLabel).toBe('Strategic Sale to Institutional Buyer');
      expect(snapshot.city).toBe('Bengaluru');
      expect(snapshot.microMarket).toBe('Outer Ring Road');
      expect(snapshot.irr).toBeCloseTo(0.14, 4);
      expect(snapshot.noiCr).toBe(42);
    });

    test('extracts development family signals correctly', () => {
      const ctx = __internal.prepareWorkbookContext(minimalDevCtx(), { strictValidation: false });
      const snapshot = buildNumericSnapshot(ctx);
      expect(snapshot.family).toBe('development');
      expect(snapshot.structureLabel).toContain('JDA');
      expect(snapshot.structureLabel).toContain('Revenue Share');
      expect(snapshot.exitLabel).toContain('Progressive Sale');
      expect(snapshot.grossMarginPct).toBeCloseTo(0.22, 4);
    });
  });

  describe('buildTemplatedBriefing', () => {
    test('produces a complete 4-bullet briefing for income deals', () => {
      const ctx = __internal.prepareWorkbookContext(minimalIncomeCtx(), { strictValidation: false });
      const snapshot = buildNumericSnapshot(ctx);
      const briefing = buildTemplatedBriefing(snapshot);

      expect(briefing.source).toBe('templated');
      expect(typeof briefing.summary).toBe('string');
      expect(briefing.summary.length).toBeGreaterThan(20);
      expect(briefing.bullets).toHaveLength(4);
      // Bullet 1: deal overview (area + asset + location). The asset
      // label is lowercased inside the bullet sentence for grammar.
      expect(briefing.bullets[0].toLowerCase()).toContain('commercial office');
      expect(briefing.bullets[0]).toContain('Bengaluru');
      // Bullet 2: economics (rent + occupancy + NOI for income)
      expect(briefing.bullets[1]).toMatch(/rent|NOI|occupancy/i);
      // Bullet 3: capital + exit
      expect(briefing.bullets[2]).toContain('Strategic Sale');
      // Bullet 4: India-specific
      expect(briefing.bullets[3]).toMatch(/GST|stamp|khata|RERA/i);
      // Risk note exists
      expect(typeof briefing.riskNote).toBe('string');
      expect(briefing.riskNote.length).toBeGreaterThan(10);
    });

    test('flags negative-spread risk when yield-on-cost < exit cap', () => {
      const ctx = __internal.prepareWorkbookContext({
        ...minimalIncomeCtx(),
        deal: { ...minimalIncomeCtx().deal,
          yield_on_cost_pct: 0.06, // below 8% exit cap
          exit_value_cr: 525,
        },
      }, { strictValidation: false });
      const snapshot = buildNumericSnapshot(ctx);
      const briefing = buildTemplatedBriefing(snapshot);
      expect(briefing.riskNote).toMatch(/yield|spread|exit cap/i);
    });

    test('flags low-IRR risk', () => {
      const ctx = __internal.prepareWorkbookContext({
        ...minimalIncomeCtx(),
        deal: { ...minimalIncomeCtx().deal, irr_pct: 0.08 },
      }, { strictValidation: false });
      const snapshot = buildNumericSnapshot(ctx);
      const briefing = buildTemplatedBriefing(snapshot);
      expect(briefing.riskNote).toMatch(/IRR|hurdle|stress/i);
    });

    test('handles missing kernel KPIs gracefully (early-stage deal)', () => {
      const ctx = __internal.prepareWorkbookContext({
        deal: { id: 't', name: 'Early stage', asset_class: 'plotted_development',
          deal_structure: 'outright_purchase', exit_strategy: 'outright_progressive',
          project_duration_months: 24,
          model_params: { inputs: { assetClass: 'plotted_development', sellingRatePerSqft: 5500 } } },
        property: { property_name: 'Early', city: 'Bengaluru', land_area_sqft: 100000 },
      }, { strictValidation: false });
      const snapshot = buildNumericSnapshot(ctx);
      const briefing = buildTemplatedBriefing(snapshot);
      expect(briefing.source).toBe('templated');
      expect(briefing.bullets).toHaveLength(4);
      // Should NOT throw / NaN / undefined
      briefing.bullets.forEach((b) => expect(typeof b).toBe('string'));
    });
  });

  describe('parseBriefingResponse', () => {
    test('parses clean JSON', () => {
      const text = JSON.stringify({
        summary: 'A clean summary.',
        bullets: ['B1', 'B2', 'B3', 'B4'],
        riskNote: 'A risk.',
      });
      const parsed = parseBriefingResponse(text);
      expect(parsed.source).toBe('ai-assisted');
      expect(parsed.summary).toBe('A clean summary.');
      expect(parsed.bullets).toHaveLength(4);
    });

    test('strips ```json code fences', () => {
      const text = '```json\n' + JSON.stringify({
        summary: 'S', bullets: ['a', 'b', 'c', 'd'], riskNote: 'r',
      }) + '\n```';
      const parsed = parseBriefingResponse(text);
      expect(parsed).not.toBeNull();
      expect(parsed.summary).toBe('S');
    });

    test('returns null on malformed JSON', () => {
      expect(parseBriefingResponse('not json at all')).toBeNull();
      expect(parseBriefingResponse('{')).toBeNull();
      expect(parseBriefingResponse(null)).toBeNull();
      expect(parseBriefingResponse('')).toBeNull();
    });

    test('returns null when required fields are missing', () => {
      expect(parseBriefingResponse('{"summary":"s"}')).toBeNull();
      expect(parseBriefingResponse('{"summary":"s","bullets":["a"]}')).toBeNull();
      expect(parseBriefingResponse('{"summary":"s","bullets":["a","b"],"riskNote":"r"}')).toBeNull();
    });
  });

  describe('generateDealBriefing — fallback path (preferTemplated)', () => {
    test('always returns a valid briefing when preferTemplated is true', async () => {
      const ctx = __internal.prepareWorkbookContext(minimalIncomeCtx(), { strictValidation: false });
      const briefing = await generateDealBriefing(ctx, { preferTemplated: true });
      expect(briefing.source).toBe('templated');
      expect(briefing.summary).toBeTruthy();
      expect(briefing.bullets).toHaveLength(4);
      expect(briefing.riskNote).toBeTruthy();
    });

    test('works without OPENAI_API_KEY in env (defaults to templated)', async () => {
      // In NODE_ENV=test the OPENAI_API_KEY is typically not set anyway.
      // This test confirms we never throw on missing env.
      const ctx = __internal.prepareWorkbookContext(minimalDevCtx(), { strictValidation: false });
      const briefing = await generateDealBriefing(ctx);
      expect(briefing).toBeTruthy();
      expect(['ai-assisted', 'templated']).toContain(briefing.source);
    });
  });

  describe('Executive Briefing sheet rendering (end-to-end)', () => {
    test('Executive Briefing is the FIRST sheet in the workbook', async () => {
      const buffer = await buildDealWorkbookV2(minimalIncomeCtx(), { skipAiBriefing: true });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      expect(wb.worksheets[0].name).toBe('Executive Briefing');
    });

    test('Executive Briefing carries mandatory AI disclosure label', async () => {
      const buffer = await buildDealWorkbookV2(minimalIncomeCtx(), { skipAiBriefing: true });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const sheet = wb.getWorksheet('Executive Briefing');
      const disclosure = String(sheet.getCell('A3').value);
      expect(disclosure).toMatch(/REQUIRES HUMAN REVIEW/i);
      // When AI is unavailable (test env), the disclosure should reflect that
      expect(disclosure).toMatch(/AI-Assisted|Templated Synthesis/);
    });

    test('Executive Briefing has 4 bullet rows (rows 9-12)', async () => {
      const buffer = await buildDealWorkbookV2(minimalIncomeCtx(), { skipAiBriefing: true });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const sheet = wb.getWorksheet('Executive Briefing');
      // Each bullet cell should start with the • bullet glyph
      for (let r = 9; r <= 12; r += 1) {
        const value = String(sheet.getCell(`A${r}`).value || '');
        expect(value.startsWith('•')).toBe(true);
        expect(value.length).toBeGreaterThan(5);
      }
    });

    test('Executive Briefing risk note appears at row 15 with warning label at row 14', async () => {
      const buffer = await buildDealWorkbookV2(minimalIncomeCtx(), { skipAiBriefing: true });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const sheet = wb.getWorksheet('Executive Briefing');
      expect(String(sheet.getCell('A14').value)).toBe('RISK NOTE');
      expect(String(sheet.getCell('A15').value).length).toBeGreaterThan(10);
    });

    test('Executive Briefing footnote (row 18) explains the AI-assisted disclosure', async () => {
      const buffer = await buildDealWorkbookV2(minimalIncomeCtx(), { skipAiBriefing: true });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const sheet = wb.getWorksheet('Executive Briefing');
      const footnote = String(sheet.getCell('A18').value);
      expect(footnote).toContain('Disclosure');
      expect(footnote).toContain('AI-assisted');
      expect(footnote).toMatch(/number.*sourced.*Inputs.*kernel/i);
    });

    test('Briefing adapts to deal family (income vs development) in bullets', async () => {
      const incomeBuf = await buildDealWorkbookV2(minimalIncomeCtx(), { skipAiBriefing: true });
      const devBuf = await buildDealWorkbookV2(minimalDevCtx(), { skipAiBriefing: true });

      const wbIncome = new ExcelJS.Workbook();
      await wbIncome.xlsx.load(incomeBuf);
      const wbDev = new ExcelJS.Workbook();
      await wbDev.xlsx.load(devBuf);

      const incomeBullets = [9, 10, 11, 12]
        .map((r) => String(wbIncome.getWorksheet('Executive Briefing').getCell(`A${r}`).value))
        .join(' | ');
      const devBullets = [9, 10, 11, 12]
        .map((r) => String(wbDev.getWorksheet('Executive Briefing').getCell(`A${r}`).value))
        .join(' | ');

      // Income mentions strategic sale + rent
      expect(incomeBullets).toMatch(/Strategic Sale|rent|NOI/i);
      // Development mentions JDA + RERA escrow + customer collection
      expect(devBullets).toMatch(/JDA|RERA|milestone|Progressive Sale/i);
    });

    test('Dashboard remains the 2nd sheet (chart injection still targets correctly)', async () => {
      const buffer = await buildDealWorkbookV2(minimalIncomeCtx(), { skipAiBriefing: true });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      expect(wb.worksheets[1].name).toBe('Dashboard');
      // Chart specs should still inject — verify a Dashboard cell has its
      // expected formula content from the existing builder.
      const dash = wb.getWorksheet('Dashboard');
      expect(String(dash.getCell('A1').value)).toContain('Dashboard');
    });
  });
});
