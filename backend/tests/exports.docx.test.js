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

    // SVG chart embeds (capital stack donut + cash flow trend + sensitivity
    // tornado) — added so the DOCX report has the same analytical visual
    // depth as the PPTX deck. Embedded via docx ImageRun with type 'svg'
    // and a 1×1 transparent PNG fallback (no canvas / sharp dep).
    test('embeds capital stack + cash flow trend + sensitivity tornado SVG charts in Financials', async () => {
      const JSZip = require('jszip');
      const ctx = minimalContext();
      ctx.deal.model_params = { capitalStack: { debtCr: 110, equityCr: 331 } };
      ctx.cashFlows = {
        quarterly: [
          { net: -50, label: 'Q1' }, { net: -80, label: 'Q2' },
          { net: 30,  label: 'Q3' }, { net: 60,  label: 'Q4' },
          { net: 100, label: 'Q5' }, { net: 120, label: 'Q6' },
        ],
      };
      ctx.sensitivity = {
        constructionCosts: [1800, 1900, 2000, 2100, 2200],
        sellingRates:      [6000, 6200, 6400, 6600, 6800],
        irrGrid: [
          [14.2, 15.0, 15.9, 16.8, 17.6],
          [13.4, 14.2, 15.1, 15.9, 16.8],
          [12.7, 13.5, 14.3, 15.2, 16.0],
          [11.9, 12.7, 13.5, 14.4, 15.2],
          [11.1, 11.9, 12.8, 13.6, 14.4],
        ],
      };
      const buffer = await buildDealReportDocx(ctx);
      const zip = await JSZip.loadAsync(buffer);

      const mediaPaths = Object.keys(zip.files).filter((n) => /^word\/media\/.*\.svg$/i.test(n));
      // Three SVG charts: capital stack donut, cash flow trend, sensitivity tornado.
      expect(mediaPaths.length).toBeGreaterThanOrEqual(3);

      const docXml = await zip.file('word/document.xml').async('string');
      expect(docXml).toMatch(/CAPITAL STACK/);
      expect(docXml).toMatch(/PERIOD NET CASH FLOW &amp; CUMULATIVE|PERIOD NOI &amp; CUMULATIVE/);
      expect(docXml).toMatch(/SENSITIVITY/);
    }, 30000);

    // Income-asset deal → cash-flow chart title swaps to NOI variant.
    test('cash flow trend chart title swaps to NOI for income-asset deals', async () => {
      const JSZip = require('jszip');
      const ctx = minimalContext();
      ctx.deal.asset_class = 'commercial_office';
      ctx.cashFlows = {
        quarterly: [
          { net: 12, label: 'Q1' }, { net: 14, label: 'Q2' },
          { net: 16, label: 'Q3' }, { net: 18, label: 'Q4' },
        ],
      };
      const buffer = await buildDealReportDocx(ctx);
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file('word/document.xml').async('string');
      expect(docXml).toMatch(/PERIOD NOI &amp; CUMULATIVE/);
    }, 30000);

    // Honest empty-state: when none of the chart inputs are populated, the
    // Financials section still renders the KPI table — just no SVG embeds.
    test('Financials renders without chart embeds when no chart data is provided', async () => {
      const JSZip = require('jszip');
      const buffer = await buildDealReportDocx(minimalContext()); // no model_params, no cashFlows, no sensitivity
      const zip = await JSZip.loadAsync(buffer);
      const mediaPaths = Object.keys(zip.files).filter((n) => /^word\/media\/.*\.svg$/i.test(n));
      expect(mediaPaths.length).toBe(0);
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

  // ────────────────────────────────────────────────────────────────────
  // PR-NX18 (2026-05-16): AI-Assisted Briefing section
  // ────────────────────────────────────────────────────────────────────
  // Cross-product parity with XLSX Executive Briefing (PR-NX7 / PR-NX12)
  // and PPTX briefing slide. Same shared `generateDealBriefing` service.
  describe('PR-NX18: AI-Assisted Briefing section (cross-product parity)', () => {
    const JSZip = require('jszip');

    const extractDocXmlText = async (buffer) => {
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file('word/document.xml').async('string');
      // Strip XML tags, keep text content for easy regex matching
      return docXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    };

    test('DOCX includes "AI-Assisted Briefing" section heading', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/AI-Assisted Briefing/);
    });

    test('DOCX includes mandatory disclosure banner per CLAUDE.md', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/REQUIRES HUMAN REVIEW/);
      expect(text).toMatch(/AI-Assisted Briefing/);
    });

    test('DOCX briefing surfaces asset-class-aware language for residential', async () => {
      const buffer = await buildDealReportDocx(minimalContext()); // residential_apartments
      const text = await extractDocXmlText(buffer);
      // Residential briefing per PR-NX12: "launch price"
      expect(text).toMatch(/launch price|gross margin|RERA/);
    });

    test('DOCX briefing surfaces asset-class-aware language for hospitality (NOT rent-based)', async () => {
      const ctx = minimalContext();
      ctx.deal.asset_class = 'hospitality';
      ctx.property.property_type = 'hospitality';
      ctx.deal.model_params = {
        inputs: { hospitalityKeys: 100, hospitalityADRBase: 7500, hospitalityOccupancyPct: 0.70 },
      };
      const buffer = await buildDealReportDocx(ctx);
      const text = await extractDocXmlText(buffer);
      // Hospitality per PR-NX12: "USALI economics" + "keys"
      expect(text).toMatch(/USALI|keys|ADR|hospitality/i);
      // MUST NOT use generic rent-based language for hospitality
      expect(text).not.toMatch(/rent inputs pending × \d+% occupancy/);
    });

    test('DOCX briefing surfaces asset-class-aware language for commercial_office', async () => {
      const ctx = minimalContext();
      ctx.deal.asset_class = 'commercial_office';
      ctx.property.property_type = 'commercial_office';
      ctx.deal.model_params = {
        inputs: { baseRentPerSqftMonth: 115, occupancyPct: 0.92 },
      };
      const buffer = await buildDealReportDocx(ctx);
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/office|rent|occupancy/i);
    });

    test('DOCX briefing includes a footer attributing the shared service to XLSX + PPTX', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/Synthesis:/);
      expect(text).toMatch(/cross-product consistency|XLSX|PPTX/i);
    });

    test('DOCX briefing precedes Executive Summary (briefing is section 2, exec summary is section 3)', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      const briefingIdx = text.indexOf('AI-Assisted Briefing');
      const execIdx = text.indexOf('Executive Summary');
      expect(briefingIdx).toBeGreaterThan(-1);
      expect(execIdx).toBeGreaterThan(-1);
      expect(briefingIdx).toBeLessThan(execIdx);
    });
  });
});
