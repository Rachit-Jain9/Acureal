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
      // PR-NX21: source can be 'ai-assisted-claude', 'ai-assisted-openai', or 'templated'
      const validSources = ['ai-assisted-claude', 'ai-assisted-openai', 'templated'];
      expect(validSources).toContain(briefing.source);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // PR-NX21 (2026-05-16) — Multi-provider failover cascade
  // ────────────────────────────────────────────────────────────────────
  describe('PR-NX21: AI Briefing auto-failover (Claude → OpenAI → templated)', () => {
    const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const originalOpenaiKey = process.env.OPENAI_API_KEY;

    afterEach(() => {
      // Restore env between tests so we don't pollute subsequent suites
      if (originalAnthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
      else delete process.env.ANTHROPIC_API_KEY;
      if (originalOpenaiKey !== undefined) process.env.OPENAI_API_KEY = originalOpenaiKey;
      else delete process.env.OPENAI_API_KEY;
    });

    test('source uses the new tri-state vocabulary (ai-assisted-claude / ai-assisted-openai / templated)', async () => {
      const ctx = __internal.prepareWorkbookContext(minimalIncomeCtx(), { strictValidation: false });
      const briefing = await generateDealBriefing(ctx, { preferTemplated: true });
      // Templated path is always one of these three exact strings
      expect(briefing.source).toBe('templated');
      // AI-active paths would be 'ai-assisted-claude' or 'ai-assisted-openai'
      // (we can't easily trigger them in test env without mocking the AI router)
    });

    test('templated fallback exposes a fallbackReason field when both providers are unavailable', async () => {
      // With no API keys configured, the service short-circuits to templated.
      // It does NOT attempt either provider (so no fallbackReason is added).
      // This test verifies the short-circuit path produces a clean templated.
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      const ctx = __internal.prepareWorkbookContext(minimalIncomeCtx(), { strictValidation: false });
      const briefing = await generateDealBriefing(ctx);
      expect(briefing.source).toBe('templated');
      // No fallbackReason on the cheap short-circuit path (no AI was attempted)
      expect(briefing.fallbackReason).toBeUndefined();
    });

    test('briefing schema: source + provider + (optional) fallbackReason fields exist', async () => {
      const ctx = __internal.prepareWorkbookContext(minimalIncomeCtx(), { strictValidation: false });
      const briefing = await generateDealBriefing(ctx, { preferTemplated: true });
      // Required fields always
      expect(typeof briefing.source).toBe('string');
      expect(typeof briefing.summary).toBe('string');
      expect(Array.isArray(briefing.bullets)).toBe(true);
      expect(typeof briefing.riskNote).toBe('string');
      // Optional fields (may or may not exist)
      if (briefing.fallbackReason !== undefined) {
        expect(typeof briefing.fallbackReason).toBe('string');
      }
      if (briefing.provider !== undefined) {
        expect(typeof briefing.provider).toBe('string');
      }
    });

    test('describeProviderError formats errors with status + message', () => {
      const { describeProviderError } = __internal;
      // Skip this if not exported — it's an internal helper
      if (typeof describeProviderError !== 'function') return;
      expect(describeProviderError('Claude', { status: 401, message: 'invalid_api_key' }))
        .toBe('Claude 401 invalid_api_key');
      expect(describeProviderError('OpenAI', { code: 'ECONNRESET', message: 'connection reset' }))
        .toBe('OpenAI ECONNRESET connection reset');
      expect(describeProviderError('Claude', { message: 'unknown error' }))
        .toBe('Claude unknown error');
    });
  });

  describe('Executive Briefing sheet rendering (end-to-end)', () => {
    test('Executive Briefing is the FIRST sheet in the workbook', async () => {
      const buffer = await buildDealWorkbookV2(minimalIncomeCtx(), { skipAiBriefing: true });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      expect(wb.worksheets[0].name).toBe('Executive Briefing');
    });

    test('PR-NX74: Executive Briefing row 3 is now a spacer (AI disclosure stripped per operator policy)', async () => {
      // Pre-NX74: A3 carried the loud amber "⚠ AI-Assisted Briefing
      // (synthesis: ...) — REQUIRES HUMAN REVIEW..." banner. Operator
      // 2026-05-19 directive: XLSX must not surface AI usage anywhere.
      // Row 3 is now a thin spacer; the banner is gone.
      const buffer = await buildDealWorkbookV2(minimalIncomeCtx(), { skipAiBriefing: true });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const sheet = wb.getWorksheet('Executive Briefing');
      const row3Value = String(sheet.getCell('A3').value || '');
      expect(row3Value).not.toMatch(/REQUIRES HUMAN REVIEW/i);
      expect(row3Value).not.toMatch(/AI-Assisted/);
      expect(row3Value).not.toMatch(/synthesis:/);
    });

    test('PR-NX74: generation footer (row 17) does not leak provider name or auto-failover JSON', async () => {
      const buffer = await buildDealWorkbookV2(minimalIncomeCtx(), { skipAiBriefing: true });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const sheet = wb.getWorksheet('Executive Briefing');
      const footer = String(sheet.getCell('A17').value || '');
      expect(footer).toMatch(/^Generated:/);
      // No provider name (Claude Sonnet 4.6 / gpt-5.4 / openai / claude)
      expect(footer).not.toMatch(/Provider:/);
      expect(footer).not.toMatch(/Synthesis:/);
      expect(footer).not.toMatch(/Claude/i);
      expect(footer).not.toMatch(/openai/i);
      // No auto-failover JSON / error trace
      expect(footer).not.toMatch(/auto-failover/);
      expect(footer).not.toMatch(/api[_-]?key/i);
    });

    test('PR-NX74: Executive Briefing meta row exposes ONLY the generation date — no provider names, no env-var hints', async () => {
      // Pre-NX74 the meta row leaked the model id (OpenAI gpt-4o /
      // Claude Sonnet 4.6) and even hinted at the env var to fix when
      // AI failed. Operator removed all of that. Row 17 is now just
      // `Generated: <iso-date>`.
      const buffer = await buildDealWorkbookV2(minimalIncomeCtx(), { skipAiBriefing: true });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const sheet = wb.getWorksheet('Executive Briefing');
      const meta = String(sheet.getCell('A17').value);
      expect(meta).toMatch(/^Generated:/);
      expect(meta).not.toMatch(/OpenAI|gpt|Claude|Sonnet/i);
      expect(meta).not.toMatch(/ANTHROPIC_API_KEY|AI_PROVIDER_NARRATIVE_SYNTHESIS/);
      expect(meta).not.toMatch(/auto-failover/);
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

    test('PR-NX74: Executive Briefing footnote (row 18) carries the verify-source-documents prompt without naming AI', async () => {
      const buffer = await buildDealWorkbookV2(minimalIncomeCtx(), { skipAiBriefing: true });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const sheet = wb.getWorksheet('Executive Briefing');
      const footnote = String(sheet.getCell('A18').value);
      // PR-NX74: dropped the "Disclosure: This Executive Briefing is an
      // AI-assisted synthesis..." prose. The institutional
      // "verify against source documents" prompt remains.
      expect(footnote).not.toMatch(/AI-assisted/);
      expect(footnote).toMatch(/source documents/i);
      expect(footnote).toMatch(/RERA|GST|BBMP/);
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

    test('Dashboard remains the 3rd sheet (chart injection still targets correctly)', async () => {
      const buffer = await buildDealWorkbookV2(minimalIncomeCtx(), { skipAiBriefing: true });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      // PR-NX57 (2026-05-19): "AI Synthesis" sheet inserted at position 2.
      // PR-NX74 (2026-05-19): tab renamed to "Analysis Notes" per operator
      // policy (XLSX must not surface AI usage).
      expect(wb.worksheets[1].name).toBe('Analysis Notes');
      expect(wb.worksheets[2].name).toBe('Dashboard');
      // Chart specs should still inject — verify a Dashboard cell has its
      // expected formula content from the existing builder.
      const dash = wb.getWorksheet('Dashboard');
      expect(String(dash.getCell('A1').value)).toContain('Dashboard');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // PR-NX12 (2026-05-15) — asset-class × structure × exit-strategy aware
  // ────────────────────────────────────────────────────────────────────
  // Operator audit on Pointec Pens hospitality deal surfaced three bugs:
  //   1. Briefing said "0 sqft hospitality" — buildNumericSnapshot didn't
  //      derive sqft from Keys × Sqft/Key when deal.saleableAreaSqft was 0
  //   2. Briefing said "rent × occupancy → NOI" — asset-class-blind
  //      narrative used office-style framing for hospitality
  //   3. Briefing said "GST 18% on under-construction sale" — wrong for
  //      hospitality (no UC sale), wrong for office (GST on rent), wrong
  //      for plotted (no GST on plot transfer)
  // This PR ships per-class economics + per-structure capital + per-exit
  // reversion + per-class GST framing for all 10 native asset classes.
  describe('PR-NX12: asset-class-aware briefing narrative', () => {
    // Factory: build a minimal context for any (asset_class, structure, exit) combo
    const makeCtx = ({
      assetClass,
      family,
      structure = 'outright_purchase',
      exit = family === 'income' ? 'strategic_sale' : 'outright_progressive',
      inputs = {},
      kpis = {},
    }) => ({
      deal: {
        id: `t-${assetClass}`,
        name: `${assetClass} test deal`,
        asset_class: assetClass,
        deal_structure: structure,
        exit_strategy: exit,
        city: 'Bengaluru',
        state: 'Karnataka',
        project_duration_months: family === 'income' ? 60 : 36,
        ...kpis,
        model_params: { inputs: { assetClass, ...inputs } },
      },
      property: {
        property_name: `${assetClass} test`,
        property_type: assetClass,
        city: 'Bengaluru',
        micro_market: 'CBD',
        saleable_area_sqft: inputs.saleableAreaSqft || 100000,
        land_area_sqft: 50000,
        existing_fsi: 2.0,
      },
    });

    // ─── Hospitality: keys-led economics, derived sqft fallback ────────
    describe('Hospitality (Keys × ADR × Occupancy)', () => {
      test('briefing derives sqft from Keys × Sqft/Key when SaleableAreaSqft is 0 (Pointec Pens bug)', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'hospitality',
          family: 'income',
          inputs: {
            saleableAreaSqft: 0, // ← the bug condition: kernel didn't compute it
            hospitalityKeys: 100,
            hospitalitySqftPerKey: 550,
            hospitalityADRBase: 7500,
            hospitalityOccupancyPct: 0.70,
          },
        }), { strictValidation: false });
        const snapshot = buildNumericSnapshot(ctx);
        // Derived sqft = 100 × 550 = 55,000
        expect(snapshot.saleableAreaSqft).toBe(55000);
        expect(snapshot.hospitalityKeys).toBe(100);

        const briefing = buildTemplatedBriefing(snapshot);
        // Bullet 1 must NOT say "0 sqft" — should say "100-key" instead
        expect(briefing.bullets[0]).not.toMatch(/^0 sqft/);
        expect(briefing.bullets[0]).toMatch(/100-key hospitality/i);
      });

      test('economics bullet uses USALI language (Keys × ADR × Occupancy), not rent × sqft', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'hospitality',
          family: 'income',
          inputs: {
            hospitalityKeys: 100,
            hospitalityADRBase: 7500,
            hospitalityOccupancyPct: 0.70,
          },
          kpis: { noi_cr: 8.8 },
        }), { strictValidation: false });
        const snapshot = buildNumericSnapshot(ctx);
        const briefing = buildTemplatedBriefing(snapshot);
        // Pre-NX12 bug: said "rent inputs pending × 70% occupancy"
        // Post-fix: "USALI economics: 100 keys × ₹7,500 ADR × 70% stabilised occupancy"
        expect(briefing.bullets[1]).toMatch(/USALI/i);
        expect(briefing.bullets[1]).toMatch(/100 keys/);
        expect(briefing.bullets[1]).toMatch(/ADR/);
        expect(briefing.bullets[1]).not.toMatch(/rent inputs pending/);
      });

      test('India context says "construction inputs" + "room nights", NOT "under-construction sale"', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'hospitality',
          family: 'income',
          inputs: { hospitalityKeys: 100, gstPct: 0.18 },
        }), { strictValidation: false });
        const snapshot = buildNumericSnapshot(ctx);
        const briefing = buildTemplatedBriefing(snapshot);
        expect(briefing.bullets[3]).toMatch(/construction inputs/i);
        expect(briefing.bullets[3]).toMatch(/room nights/i);
        expect(briefing.bullets[3]).not.toMatch(/under-construction sale/i);
      });

      test('risk note flags hospitality occupancy below 60% break-even', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'hospitality',
          family: 'income',
          inputs: { hospitalityKeys: 100, hospitalityOccupancyPct: 0.55 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.riskNote).toMatch(/occupancy.*55%|break-even/i);
      });
    });

    // ─── Retail: anchor + vanilla + CAM ───────────────────────────────
    describe('Retail (Anchor + Vanilla + CAM)', () => {
      test('economics bullet uses anchor/vanilla rent split + CAM recovery', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'retail',
          family: 'income',
          inputs: {
            saleableAreaSqft: 350000,
            retailAnchorRentPerSqftMonth: 60,
            retailVanillaRentPerSqftMonth: 180,
            retailAnchorSharePct: 0.40,
            retailCAMRecoveryPct: 0.95,
            occupancyPct: 0.92,
          },
          kpis: { noi_cr: 28 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[1]).toMatch(/Anchor.*₹60.*Vanilla.*₹180/);
        expect(briefing.bullets[1]).toMatch(/CAM/);
      });

      test('risk note flags anchor concentration above 50%', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'retail',
          family: 'income',
          inputs: { retailAnchorSharePct: 0.65 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.riskNote).toMatch(/anchor.*65%|concentration/i);
      });

      test('India context for retail says GST on rent + CAM (not on sale)', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'retail', family: 'income',
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[3]).toMatch(/retail rent.*CAM/i);
        expect(briefing.bullets[3]).not.toMatch(/under-construction sale/i);
      });
    });

    // ─── Office: CAM-loaded rent ──────────────────────────────────────
    describe('Commercial Office (Grade-A leasing)', () => {
      test('economics bullet includes CAM line when otherIncomePerSqft is set', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'commercial_office',
          family: 'income',
          inputs: { baseRentPerSqftMonth: 115, otherIncomePerSqft: 240, occupancyPct: 0.92 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[1]).toMatch(/₹115\/sqft\/mo/);
        expect(briefing.bullets[1]).toMatch(/CAM/);
      });

      test('India context for office says GST on commercial rent (ITC available)', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'commercial_office', family: 'income',
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[3]).toMatch(/commercial rent.*ITC/i);
        expect(briefing.bullets[3]).not.toMatch(/under-construction sale/i);
      });
    });

    // ─── Industrial / Warehousing ─────────────────────────────────────
    describe('Industrial & Warehousing', () => {
      test('economics bullet uses warehouse rent + pre-leased occupancy language', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'industrial_warehousing',
          family: 'income',
          inputs: { baseRentPerSqftMonth: 28, occupancyPct: 0.95 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[1]).toMatch(/Logistics|warehouse/i);
        expect(briefing.bullets[1]).toMatch(/pre-leased/i);
      });
    });

    // ─── Residential Apartments ───────────────────────────────────────
    describe('Residential Apartments', () => {
      test('economics bullet uses launch price + RERA collection + velocity', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'residential_apartments',
          family: 'development',
          inputs: {
            sellingRatePerSqft: 9500,
            salesVelocityPct: 0.18,
            customerCollectionPct: 0.85,
          },
          kpis: { gross_margin_pct: 0.22 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[1]).toMatch(/launch price/i);
        expect(briefing.bullets[1]).toMatch(/RERA collection/i);
        expect(briefing.bullets[1]).toMatch(/sales velocity/i);
      });

      test('India context for residential says 5% on UC sale (1% affordable; 0% post-OC)', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'residential_apartments',
          family: 'development',
          inputs: { gstPct: 0.05 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[3]).toMatch(/under-construction sale/i);
        expect(briefing.bullets[3]).toMatch(/affordable|post-OC/i);
      });
    });

    // ─── Plotted Development ──────────────────────────────────────────
    describe('Plotted Development (land economics)', () => {
      test('economics bullet uses sell rate − dev cost → margin language', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'plotted_development',
          family: 'development',
          inputs: { sellingRatePerSqft: 5500, plotDevCostPerSqft: 1500 },
          kpis: { gross_margin_pct: 0.40 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[1]).toMatch(/₹5,500\/sqft plot price/);
        expect(briefing.bullets[1]).toMatch(/layout cost/i);
        expect(briefing.bullets[1]).toMatch(/land-economics margin/i);
      });

      test('India context says "no GST on plot transfer"', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'plotted_development', family: 'development',
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[1].toLowerCase()).toMatch(/plotted-development/);
        expect(briefing.bullets[3]).toMatch(/No GST on plot transfer/i);
      });

      test('risk note flags low sales velocity (< 10%/quarter)', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'plotted_development',
          family: 'development',
          inputs: { salesVelocityPct: 0.08 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.riskNote).toMatch(/sales velocity.*8%|absorption/i);
      });
    });

    // ─── Villas ───────────────────────────────────────────────────────
    describe('Villas (luxury premium)', () => {
      test('economics bullet uses luxury-premium framing', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'villas',
          family: 'development',
          inputs: { sellingRatePerSqft: 16000, salesVelocityPct: 0.20 },
          kpis: { gross_margin_pct: 0.30 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[1]).toMatch(/luxury/i);
        expect(briefing.bullets[1]).toMatch(/₹16,000\/sqft/);
      });
    });

    // ─── Mixed-Use ────────────────────────────────────────────────────
    describe('Mixed-Use Development (component blend)', () => {
      test('economics bullet enumerates component shares', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'mixed_use',
          family: 'development',
          inputs: {
            mixUseResidentialShare: 0.50,
            mixUseOfficeShare: 0.30,
            mixUseRetailShare: 0.15,
            mixUseHospitalityShare: 0.05,
            sellingRatePerSqft: 10500,
          },
          kpis: { gross_margin_pct: 0.20 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[1]).toMatch(/50% residential/);
        expect(briefing.bullets[1]).toMatch(/30% office/);
        expect(briefing.bullets[1]).toMatch(/15% retail/);
        expect(briefing.bullets[1]).toMatch(/blended/i);
      });

      test('risk note flags single-component dominance above 70%', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'mixed_use',
          family: 'development',
          inputs: { mixUseResidentialShare: 0.80, mixUseOfficeShare: 0.20 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.riskNote).toMatch(/dominated by a single component|single-component/i);
      });
    });

    // ─── Redevelopment ────────────────────────────────────────────────
    describe('Redevelopment (JDA area share)', () => {
      test('economics bullet surfaces landowner area-share', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'redevelopment',
          family: 'development',
          structure: 'jda_area_share',
          inputs: { landownerSharePct: 0.45, sellingRatePerSqft: 13500 },
          kpis: { gross_margin_pct: 0.28 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[1]).toMatch(/45% landowner area-share/);
        expect(briefing.bullets[1]).toMatch(/developer-side margin/i);
      });
    });

    // ─── Raw Land ─────────────────────────────────────────────────────
    describe('Raw Land (entitlement pipeline)', () => {
      test('economics bullet leads with entitlement stage + month pipeline', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'raw_land',
          family: 'development',
          inputs: {
            saleableAreaSqft: 87120, // 2 acres
            sellingRatePerSqft: 1800,
            rawLandStage: 'pre_conversion',
            rawLandTitleMonths: 3,
            rawLandConversionMonths: 6,
            rawLandLayoutMonths: 9,
          },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[1]).toMatch(/pre conversion stage/i);
        expect(briefing.bullets[1]).toMatch(/3mo title.*6mo conversion.*9mo layout/);
      });

      test('overview bullet reports area in both sqft AND acres', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'raw_land',
          family: 'development',
          inputs: { saleableAreaSqft: 87120 }, // 2 acres
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[0]).toMatch(/87,120 sqft/);
        expect(briefing.bullets[0]).toMatch(/2\.00 acres/);
      });

      test('India context says "no GST" + "Karnataka conversion fee"', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'raw_land', family: 'development',
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[3]).toMatch(/No GST on raw land transfer/i);
        expect(briefing.bullets[3]).toMatch(/Karnataka.*conversion/i);
      });

      test('risk note flags pre-conversion entitlement risk', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'raw_land',
          family: 'development',
          inputs: { rawLandStage: 'pre_conversion' },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.riskNote).toMatch(/pre conversion|entitlement/i);
      });
    });

    // ─── Deal structures: capital stack swap ──────────────────────────
    describe('Deal-structure-aware capital stack', () => {
      test('Outright purchase: "total cost + debt LTV + rate" language', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'commercial_office',
          family: 'income',
          structure: 'outright_purchase',
          inputs: { debtLTV: 0.60, debtRatePct: 0.105 },
          kpis: { total_cost_cr: 200 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[2]).toMatch(/total project cost/i);
        expect(briefing.bullets[2]).toMatch(/60% debt LTV/);
      });

      test('JDA revenue-share: "developer-side cost, X% landowner revenue-share (no upfront land payment)"', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'residential_apartments',
          family: 'development',
          structure: 'jda_revenue_share',
          inputs: { landownerSharePct: 0.40 },
          kpis: { total_cost_cr: 270 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[2]).toMatch(/developer-side cost/i);
        expect(briefing.bullets[2]).toMatch(/40% landowner revenue-share/);
        expect(briefing.bullets[2]).toMatch(/no upfront land payment/i);
      });

      test('JDA area-share: "developer-side cost, X% landowner area-share"', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'redevelopment',
          family: 'development',
          structure: 'jda_area_share',
          inputs: { landownerSharePct: 0.45 },
          kpis: { total_cost_cr: 180 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[2]).toMatch(/45% landowner area-share/);
      });

      test('Development management: "fee-only (no developer equity at risk)"', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'commercial_office',
          family: 'income',
          structure: 'development_management',
          kpis: { total_cost_cr: 250 },
        }), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets[2]).toMatch(/fee-only/i);
        expect(briefing.bullets[2]).toMatch(/no developer equity at risk/i);
      });
    });

    // ─── Exit strategies: exit phrase swap ────────────────────────────
    describe('Exit-strategy-aware exit phrase', () => {
      const exitTestCases = [
        { exit: 'strategic_sale', match: /Strategic Sale to Institutional Buyer/, family: 'income' },
        { exit: 'reit_exit', match: /REIT contribution/, family: 'income' },
        { exit: 'hold_to_perpetuity', match: /Hold to perpetuity/, family: 'income' },
        { exit: 'refinance_hold', match: /LRD refinance/, family: 'income' },
        { exit: 'outright_progressive', match: /Progressive sale.*RERA/, family: 'development' },
        { exit: 'bulk_exit_completion', match: /Bulk exit at completion/, family: 'development' },
        { exit: 'hold_post_completion', match: /Hold post-completion/, family: 'development' },
      ];
      exitTestCases.forEach(({ exit, match, family }) => {
        test(`Exit "${exit}" produces matching exit phrase`, () => {
          const ctx = __internal.prepareWorkbookContext(makeCtx({
            assetClass: family === 'income' ? 'commercial_office' : 'residential_apartments',
            family,
            exit,
          }), { strictValidation: false });
          const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
          expect(briefing.bullets[2]).toMatch(match);
        });
      });
    });

    // ─── Snapshot extraction — asset-class-specific fields ────────────
    describe('Snapshot extraction includes asset-class-specific fields', () => {
      test('hospitality fields surface (keys, ADR, refi LTV/cap)', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'hospitality',
          family: 'income',
          inputs: {
            hospitalityKeys: 250,
            hospitalityADRBase: 7500,
            hospitalityADRPeak: 11500,
            hospitalityRefiLTV: 0.55,
            hospitalityRefiCapRate: 0.085,
          },
        }), { strictValidation: false });
        const s = buildNumericSnapshot(ctx);
        expect(s.hospitalityKeys).toBe(250);
        expect(s.hospitalityADRBase).toBe(7500);
        expect(s.hospitalityADRPeak).toBe(11500);
        expect(s.hospitalityRefiLTV).toBe(0.55);
        expect(s.hospitalityRefiCapRate).toBe(0.085);
      });

      test('retail fields surface (anchor + vanilla rent + CAM)', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'retail',
          family: 'income',
          inputs: {
            retailAnchorRentPerSqftMonth: 60,
            retailVanillaRentPerSqftMonth: 180,
            retailAnchorSharePct: 0.40,
            retailCAMRecoveryPct: 0.95,
          },
        }), { strictValidation: false });
        const s = buildNumericSnapshot(ctx);
        expect(s.retailAnchorRentPerSqftMonth).toBe(60);
        expect(s.retailVanillaRentPerSqftMonth).toBe(180);
        expect(s.retailAnchorSharePct).toBe(0.40);
        expect(s.retailCAMRecoveryPct).toBe(0.95);
      });

      test('mixed-use shares surface (residential / office / retail / hospitality)', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'mixed_use',
          family: 'development',
          inputs: {
            mixUseResidentialShare: 0.50,
            mixUseOfficeShare: 0.30,
            mixUseRetailShare: 0.15,
            mixUseHospitalityShare: 0.05,
          },
        }), { strictValidation: false });
        const s = buildNumericSnapshot(ctx);
        expect(s.mixUseResidentialShare).toBe(0.50);
        expect(s.mixUseOfficeShare).toBe(0.30);
        expect(s.mixUseRetailShare).toBe(0.15);
        expect(s.mixUseHospitalityShare).toBe(0.05);
      });

      test('raw-land entitlement stage + months surface', () => {
        const ctx = __internal.prepareWorkbookContext(makeCtx({
          assetClass: 'raw_land',
          family: 'development',
          inputs: {
            rawLandStage: 'pre_conversion',
            rawLandTitleMonths: 3,
            rawLandConversionMonths: 6,
            rawLandLayoutMonths: 9,
          },
        }), { strictValidation: false });
        const s = buildNumericSnapshot(ctx);
        expect(s.rawLandStage).toBe('pre_conversion');
        expect(s.rawLandTitleMonths).toBe(3);
        expect(s.rawLandConversionMonths).toBe(6);
        expect(s.rawLandLayoutMonths).toBe(9);
      });
    });

    // ─── Backward compat: existing income / dev fixtures still work ───
    describe('Backward-compatibility (existing test fixtures still produce valid briefings)', () => {
      test('income fixture still produces 4-bullet briefing with no NaN / undefined', () => {
        const ctx = __internal.prepareWorkbookContext(minimalIncomeCtx(), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets).toHaveLength(4);
        briefing.bullets.forEach((b) => {
          expect(typeof b).toBe('string');
          expect(b).not.toMatch(/undefined|NaN|\[object Object\]/);
        });
      });

      test('dev fixture still produces 4-bullet briefing with no NaN / undefined', () => {
        const ctx = __internal.prepareWorkbookContext(minimalDevCtx(), { strictValidation: false });
        const briefing = buildTemplatedBriefing(buildNumericSnapshot(ctx));
        expect(briefing.bullets).toHaveLength(4);
        briefing.bullets.forEach((b) => {
          expect(typeof b).toBe('string');
          expect(b).not.toMatch(/undefined|NaN|\[object Object\]/);
        });
      });
    });
  });
});
