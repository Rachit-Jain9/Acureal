'use strict';

const { buildDealReportDocx, __internal } = require('../src/services/exports/docx/buildReport');

const minimalContext = () => ({
  deal: {
    id: 1,
    name: 'Whitefield Phase 2',
    asset_class: 'residential_apartments',
    deal_type: 'jv',
    deal_structure: 'jv',
    stage: 'underwriting',
    city: 'Bengaluru',
    state: 'Karnataka',
    property_lat: 12.97,
    property_lng: 77.74,
    investment_thesis: 'Premium residential play in established Whitefield corridor.',
    irr_pct: 22.4,
    equity_multiple: 1.85,
    npv_cr: 38.2,
    gross_margin_pct: 26.8,
    total_cost_cr: 142.5,
    total_revenue_cr: 195.3,
    yield_on_cost_pct: 9.4,
    noi_cr: 13.5,
    exit_value_cr: 174.2,
    negotiated_price_cr: 78,
    land_ask_price_cr: 82,
    owner_name: 'Whitefield Holdings LLP',
  },
  property: {
    property_name: 'Whitefield Phase 2',
    city: 'Bengaluru',
    micro_market: 'Whitefield',
    land_area_sqft: 280000,
    saleable_area_sqft: 420000,
    existing_fsi: 1.5,
    coordinates: { latitude: 12.97, longitude: 77.74 },
  },
  market: {
    exportComps: [
      { project_name: 'Project Alpha', developer: 'Dev A', project_type: 'High-rise', total_units: 300, rate_per_sqft: 11500, is_verified: true },
      { project_name: 'Project Beta',  developer: 'Dev B', project_type: 'Mid-rise',  total_units: 220, rate_per_sqft: 12200, is_verified: true },
    ],
  },
  risks: { summary: { critical: 0, high: 1, medium: 3, low: 4 } },
  dd: { summary: { total_required: 12, completed_required: 9 } },
  ai: {
    available: true,
    ic_opinion: 'Proceed with conditions: project economics are above the residential benchmark, but DSCR cushion is thin and one high-severity DD item remains open.',
    confidence: 'medium',
  },
});

describe('services/exports/docx/buildReport', () => {
  describe('buildReportContext', () => {
    test('extracts core KPIs and computes deal score', () => {
      const ctx = __internal.buildReportContext(minimalContext(), { generatedAt: '2026-05-10' });
      expect(ctx.irr).toBe(22.4);
      expect(ctx.equityMultiple).toBe(1.85);
      expect(ctx.dealScore).toBeDefined();
      expect(typeof ctx.dealScore.score).toBe('number');
      expect(ctx.dealScore.score).toBeGreaterThanOrEqual(0);
      expect(ctx.dealScore.score).toBeLessThanOrEqual(100);
      expect(ctx.assetClassLabel).toBe('Residential Apartments');
      expect(ctx.dealTypeLabel).toBe('Joint Venture');
      expect(ctx.stageLabel).toBe('Underwriting');
    });

    test('defaults gracefully when fields are missing', () => {
      const ctx = __internal.buildReportContext({ deal: { name: 'Empty' }, property: {} });
      expect(ctx.dealTitle).toBe('Empty');
      expect(ctx.locationLine).toBe('Location not provided');
      expect(ctx.coords).toBeNull();
      expect(ctx.dealScore).toBeDefined();
    });
  });

  describe('formatters', () => {
    test('formatPct handles null and decimals', () => {
      expect(__internal.formatPct(null)).toBe('–');
      expect(__internal.formatPct(22.456, 2)).toBe('22.46%');
    });
    test('formatCrores handles null', () => {
      expect(__internal.formatCrores(null)).toBe('–');
      expect(__internal.formatCrores(123.456, 2)).toMatch(/INR 123\.4[56] Cr/);
    });
    test('formatArea + formatRate handle null', () => {
      expect(__internal.formatArea(null)).toBe('–');
      expect(__internal.formatRate(null)).toBe('–');
      expect(__internal.formatArea(280000)).toMatch(/sqft/);
      expect(__internal.formatRate(12000)).toMatch(/INR.*sqft/);
    });
  });

  describe('buildDealReportDocx', () => {
    test('returns a non-empty Buffer with the .docx ZIP signature', async () => {
      const buffer = await buildDealReportDocx(minimalContext(), {
        brandName: 'REDIP',
        userName: 'Test',
        generatedAt: '2026-05-10T00:00:00Z',
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(5000);
      expect(buffer.slice(0, 2).toString('ascii')).toBe('PK');
    }, 30000);

    test('survives a mostly-empty exportContext without throwing', async () => {
      const buffer = await buildDealReportDocx({ deal: { name: 'Empty' }, property: {} });
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(5000);
    }, 30000);

    test('renders even when AI providers unavailable', async () => {
      // No AI keys → narrative service returns unavailable; deck still builds.
      const buffer = await buildDealReportDocx(minimalContext());
      expect(Buffer.isBuffer(buffer)).toBe(true);
    }, 30000);

    test('phase-2 sections render with mostly-empty data (honest empty-state)', async () => {
      // No demographics, no infra, no intelligence briefs — every new
      // section should render its empty-state branch without throwing.
      const buffer = await buildDealReportDocx(minimalContext());
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(5000);
    }, 30000);

    test('phase-2 sections render when data is populated', async () => {
      const ctx = minimalContext();
      ctx.market.demographics = {
        population_total: 280000,
        population_density: 12500,
        median_age: 31.5,
        median_household_inr: 18.5,
        income_tier: 'Upper-middle',
        literacy_pct: 94.2,
      };
      ctx.market.intelligence_briefs = [
        {
          title: 'Whitefield GCC expansion',
          summary: 'Three multinational GCCs announced 1.2M sqft of new office space in Whitefield Q1 2026.',
          theme: 'job growth',
          published_at: '2026-04-22',
        },
      ];
      ctx.infra_proximity = {
        schools:    { count: 12, nearest_km: 0.8 },
        hospitals:  { count: 4,  nearest_km: 1.5 },
        metro:      { nearest_km: 2.1, note: 'Whitefield Purple Line' },
        airport:    { nearest_km: 38.2 },
      };
      ctx.market.market_transactions = [
        { project_name: 'Whitefield Heights', transaction_type: 'sale', transaction_date: '2026-03-15', rate_per_sqft: 11800 },
      ];
      const buffer = await buildDealReportDocx(ctx);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(5000);
    }, 30000);
  });
});
