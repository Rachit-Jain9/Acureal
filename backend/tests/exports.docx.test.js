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

    // Audit #9/#21 — the AI general-knowledge market augment paths must surface
    // the market-intelligence caveat (unverified source + confidence) per the
    // CLAUDE.md hard rule, WITHOUT a per-section AI banner or provider name
    // (operator disclosure policy — the cover disclaimer covers synthesis).
    test('AI market augment renders an unverified-source + confidence provenance line (#9/#21)', async () => {
      const JSZip = require('jszip');
      const ctx = minimalContext();
      ctx.market.demographics = null; // force the general-knowledge augment path
      ctx.market.aiAugment = {
        demographics: {
          available: true,
          paragraph: 'Whitefield skews toward upper-middle tech households with strong rental demand.',
          confidence: 'medium',
          provider: 'claude',
          disclaimer: 'AI-GENERATED FROM GENERAL KNOWLEDGE',
        },
      };
      const buffer = await buildDealReportDocx(ctx);
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file('word/document.xml').async('string');
      // The synthesized prose renders…
      expect(docXml).toContain('upper-middle tech households');
      // …followed by the unverified-source caveat + capitalized confidence.
      expect(docXml).toContain('Unverified market context');
      expect(docXml).toContain('Confidence: Medium');
      // Operator policy: the raw "AI-GENERATED…" framing + provider name are NOT
      // rendered into the customer DOCX (the cover disclaimer covers synthesis).
      expect(docXml).not.toContain('AI-GENERATED FROM GENERAL KNOWLEDGE');
    }, 30000);
  });

  // ────────────────────────────────────────────────────────────────────
  // PR-NX18 (2026-05-16): AI-Assisted Briefing section
  // ────────────────────────────────────────────────────────────────────
  // Cross-product parity with XLSX Executive Briefing (PR-NX7 / PR-NX12)
  // and PPTX briefing slide. Same shared `generateDealBriefing` service.
  describe('PR-NX18 + NX74: Executive Briefing section (cross-product parity)', () => {
    const JSZip = require('jszip');

    const extractDocXmlText = async (buffer) => {
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file('word/document.xml').async('string');
      // Strip XML tags, keep text content for easy regex matching
      return docXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    };

    test('DOCX includes "Executive Briefing" section heading (renamed from "AI-Assisted Briefing" per PR-NX74)', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/Executive Briefing/);
      // PR-NX74: the loud per-section AI-Assisted Briefing label is gone.
      expect(text).not.toMatch(/AI-Assisted Briefing/);
    });

    test('PR-NX74: DOCX has cover-page Arial-7pt disclaimer but no per-section "REQUIRES HUMAN REVIEW" banner', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      // Cover-page disclaimer is the single canonical reference to AI usage.
      expect(text).toMatch(/model-assisted synthesis/i);
      expect(text).toMatch(/deterministic underwriting kernel/i);
      // Per-section "REQUIRES HUMAN REVIEW" banners are removed.
      expect(text).not.toMatch(/REQUIRES HUMAN REVIEW/);
    });

    test('DOCX briefing surfaces asset-class-aware language for residential', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
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
      expect(text).toMatch(/USALI|keys|ADR|hospitality/i);
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

    test('PR-NX74: DOCX footer does not leak provider name, auto-failover JSON, or cross-product copy', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      // Pre-NX74 the footer said: "Synthesis: Claude Sonnet 4.6 · auto-
      // failover: 401 {error JSON} · This briefing mirrors the AI-assisted
      // Executive Briefing tab in the XLSX export and the AI-Assisted
      // Briefing slide in the PPTX deck — all three reuse the same
      // shared service for cross-product consistency." — all stripped.
      expect(text).not.toMatch(/Synthesis: (Claude|OpenAI|gpt)/);
      expect(text).not.toMatch(/auto-failover/);
      expect(text).not.toMatch(/cross-product consistency/);
      expect(text).not.toMatch(/AI-assisted Executive Briefing tab/);
      expect(text).not.toMatch(/authentication_error/);
      expect(text).not.toMatch(/invalid x-api-key/);
    });

    test('DOCX briefing precedes Executive Summary (briefing is section 2, exec summary is section 3)', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      const briefingIdx = text.indexOf('Executive Briefing');
      const execIdx = text.indexOf('Executive Summary');
      expect(briefingIdx).toBeGreaterThan(-1);
      expect(execIdx).toBeGreaterThan(-1);
      expect(briefingIdx).toBeLessThan(execIdx);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // PR-NX35 (2026-05-17): Risk Register / DD Status / Approvals Tracker
  // ────────────────────────────────────────────────────────────────────
  // Three new platform-data sections between Financials and Pros & Cons.
  // Operator-curated facts read BEFORE the AI-synthesised Pros & Cons.
  describe('PR-NX35: Risk Register / DD Status / Approvals Tracker', () => {
    const JSZip = require('jszip');

    const extractDocXmlText = async (buffer) => {
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file('word/document.xml').async('string');
      return docXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    };

    // ── Section headings exist ────────────────────────────────────────
    test('renders Risk Register, Due Diligence Status, Approvals Tracker headings', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/Risk Register/);
      expect(text).toMatch(/Due Diligence Status/);
      expect(text).toMatch(/Approvals Tracker/);
    });

    // ── Honest empty-states when data is missing ──────────────────────
    test('Risk Register renders empty-state when no risks logged', async () => {
      const buffer = await buildDealReportDocx(minimalContext()); // no risks.items
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/No risks have been logged for this deal yet/);
      expect(text).toMatch(/Manual input required/);
    });

    test('DD Status renders empty-state when no DD checklist seeded', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/No DD checklist has been seeded/);
    });

    test('Approvals Tracker renders empty-state with Karnataka template hint', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/No approvals have been seeded/);
      // Karnataka-specific template citation
      expect(text).toMatch(/CDP\/Zoning|Khata|BWSSB|BESCOM|RERA/);
    });

    // ── Risk Register populated case ──────────────────────────────────
    test('Risk Register renders rows with severity + status + summary line', async () => {
      const ctx = minimalContext();
      ctx.risks = {
        summary: { critical: 1, high: 2, medium: 1, low: 0, total: 4 },
        items: [
          { severity: 'critical', category: 'title_ownership', title: 'Pending mutation', status: 'open', mitigation: 'Fast-track via revenue office', created_by_name: 'Rachit' },
          { severity: 'high', category: 'statutory', title: 'RERA registration not filed', status: 'flagged', mitigation: 'File before Q3', created_by_name: 'Rachit' },
          { severity: 'high', category: 'physical_technical', title: 'Soil report outdated', status: 'mitigated', mitigation: 'New report commissioned', created_by_name: 'Rachit' },
          { severity: 'medium', category: 'commercial', title: 'Anchor tenant LOI pending', status: 'open', mitigation: 'Backup tenant identified', created_by_name: 'Rachit' },
        ],
      };
      const buffer = await buildDealReportDocx(ctx);
      const text = await extractDocXmlText(buffer);
      // Summary line surfaces the breakdown
      expect(text).toMatch(/4 risks logged.*1 critical, 2 high, 1 medium/);
      // Each title shows
      expect(text).toMatch(/Pending mutation/);
      expect(text).toMatch(/RERA registration not filed/);
      expect(text).toMatch(/Anchor tenant LOI pending/);
      // Categories labelized (snake_case → "Title Ownership")
      expect(text).toMatch(/Title Ownership/);
    });

    // ── DD Status populated case ──────────────────────────────────────
    test('DD Status renders summary with deal-breaker count + open items', async () => {
      const ctx = minimalContext();
      ctx.dd = {
        summary: {
          total_required: 12,
          completed_required: 9,
          completed_count: 9,
          flagged_count: 1,
          deal_breakers_total: 3,
          deal_breakers_done: 2,
        },
        items: [
          { category: 'title_ownership', item_name: 'Mother deed traced', severity: 'deal_breaker', status: 'completed', notes: 'Done 2026-04-15' },
          { category: 'statutory', item_name: 'RERA filing', severity: 'deal_breaker', status: 'pending', notes: 'Awaiting plan sanction' },
          { category: 'physical_technical', item_name: 'Boundary survey', severity: 'buildability_blocker', status: 'in_progress', notes: 'Surveyor onsite' },
          { category: 'commercial', item_name: 'Vendor due diligence', severity: 'commercial_blocker', status: 'flagged', notes: 'Disputed price escalation' },
        ],
      };
      const buffer = await buildDealReportDocx(ctx);
      const text = await extractDocXmlText(buffer);
      // Summary line: "9 of 12 required ... 1 deal-breaker open ... 1 flagged"
      expect(text).toMatch(/9 of 12 required items completed/);
      expect(text).toMatch(/1 deal-breaker open/);
      expect(text).toMatch(/1 flagged/);
      // Item names appear
      expect(text).toMatch(/Mother deed traced/);
      expect(text).toMatch(/RERA filing/);
      expect(text).toMatch(/Boundary survey/);
      // Severity labelization (deal_breaker → Deal Breaker)
      expect(text).toMatch(/Deal Breaker/);
    });

    // ── Approvals Tracker populated case ──────────────────────────────
    test('Approvals Tracker renders summary with validated / in-progress / issue counts', async () => {
      const ctx = minimalContext();
      ctx.approvals = {
        summary: { total: 5, validated: 2, in_progress: 2, issue: 1 },
        items: [
          { approval_type: 'rera', name: 'RERA Registration', is_required: true, is_validated: true, status: 'validated', reference_number: 'PRM/KA/RERA/1251/308/PR/2025', issuing_authority: 'K-RERA', expiry_date: null, next_action: null },
          { approval_type: 'plan', name: 'Sanctioned Building Plan', is_required: true, is_validated: false, status: 'in_progress', issuing_authority: 'BBMP', next_action: 'Resubmit drawings' },
          { approval_type: 'fire', name: 'Fire NOC', is_required: true, is_validated: false, status: 'issue', issuing_authority: 'KSFES', next_action: 'Width compliance pending' },
          { approval_type: 'water', name: 'BWSSB Water Connection', is_required: true, is_validated: true, status: 'validated', reference_number: 'BW/2024/12345', issuing_authority: 'BWSSB' },
          { approval_type: 'power', name: 'BESCOM Power Connection', is_required: true, is_validated: false, status: 'in_progress', issuing_authority: 'BESCOM' },
        ],
      };
      const buffer = await buildDealReportDocx(ctx);
      const text = await extractDocXmlText(buffer);
      // Summary line
      expect(text).toMatch(/5 required of 5 tracked/);
      expect(text).toMatch(/2 validated/);
      expect(text).toMatch(/2 in progress/);
      expect(text).toMatch(/1 with issue/);
      // Each name appears
      expect(text).toMatch(/RERA Registration/);
      expect(text).toMatch(/Sanctioned Building Plan/);
      expect(text).toMatch(/Fire NOC/);
      expect(text).toMatch(/BWSSB Water Connection/);
      // Authority appears
      expect(text).toMatch(/BBMP/);
      expect(text).toMatch(/BESCOM/);
    });

    // ── Order: 3 new sections sit between Financials and Pros & Cons ─
    test('section order: Financials → Risk Register → DD Status → Approvals Tracker → Pros & Cons', async () => {
      const ctx = minimalContext();
      // Populate all three so each renders fully
      ctx.risks = { summary: { total: 1 }, items: [{ severity: 'high', category: 'x', title: 'r-test', status: 'open' }] };
      ctx.dd = { summary: { total_required: 1, completed_required: 0 }, items: [{ category: 'x', item_name: 'dd-test', severity: 'secondary', status: 'pending' }] };
      ctx.approvals = { summary: {}, items: [{ approval_type: 'rera', name: 'approval-test', is_required: true, status: 'pending' }] };
      const buffer = await buildDealReportDocx(ctx);
      const text = await extractDocXmlText(buffer);
      // Headings containing "&" are XML-escaped as "&amp;" in the doc XML.
      // Use a regex that matches either form.
      const financialsIdx = text.search(/Financials &(?:amp;)? KPIs/);
      const riskIdx = text.indexOf('Risk Register');
      const ddIdx = text.indexOf('Due Diligence Status');
      const approvalsIdx = text.indexOf('Approvals Tracker');
      const prosConsIdx = text.search(/Pros &(?:amp;)? Cons/);
      expect(financialsIdx).toBeGreaterThan(-1);
      expect(riskIdx).toBeGreaterThan(financialsIdx);
      expect(ddIdx).toBeGreaterThan(riskIdx);
      expect(approvalsIdx).toBeGreaterThan(ddIdx);
      expect(prosConsIdx).toBeGreaterThan(approvalsIdx);
    });

    // ── All three sections carry platformBadge (no AI badge) ──────────
    test('all three sections carry the PLATFORM DATA badge (not AI-ASSISTED)', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      // The doc should have PLATFORM DATA appearing multiple times now
      // (existing Site Information / Overview / Comparables / Financials use it too).
      const platformOccurrences = (text.match(/PLATFORM DATA/g) || []).length;
      expect(platformOccurrences).toBeGreaterThanOrEqual(4); // existing 3+ + 3 new sections
    });

    // ── __internal helpers ────────────────────────────────────────────
    describe('__internal helpers', () => {
      test('labelFromCode snake_case → Title Case', () => {
        expect(__internal.labelFromCode('deal_breaker')).toBe('Deal Breaker');
        expect(__internal.labelFromCode('in_progress')).toBe('In Progress');
        expect(__internal.labelFromCode('a_khata')).toBe('A Khata');
        expect(__internal.labelFromCode(null)).toBe('–');
        expect(__internal.labelFromCode('')).toBe('–');
      });

      test('severityColor maps tones for critical / high / medium / completed / validated / mitigated', () => {
        // Just check it returns a non-empty 6-char hex (we don't need to pin exact palette tokens here)
        expect(__internal.severityColor('critical')).toMatch(/^[0-9A-F]{6}$/i);
        expect(__internal.severityColor('high')).toMatch(/^[0-9A-F]{6}$/i);
        expect(__internal.severityColor('completed')).toMatch(/^[0-9A-F]{6}$/i);
        expect(__internal.severityColor('validated')).toMatch(/^[0-9A-F]{6}$/i);
        expect(__internal.severityColor('mitigated')).toMatch(/^[0-9A-F]{6}$/i);
        // Critical and completed should NOT collide (sanity check)
        expect(__internal.severityColor('critical')).not.toBe(__internal.severityColor('completed'));
      });

      test('severityColor returns muted-high fallback for unknown severity', () => {
        const known = __internal.severityColor('medium');
        const unknown = __internal.severityColor('not_a_real_severity');
        expect(unknown).toBe(known); // both fall through to mutedHigh
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // PR-NX36 (2026-05-17): Provenance / Source Register
  // ────────────────────────────────────────────────────────────────────
  // Surfaces uploaded documents (with extraction status per doc) and
  // the auto-fill audit trail in a dedicated section. Sits after the
  // platform-data sections (risks/DD/approvals) and BEFORE Pros & Cons.
  describe('PR-NX36: Provenance / Source Register', () => {
    const JSZip = require('jszip');
    const extractDocXmlText = async (buffer) => {
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file('word/document.xml').async('string');
      return docXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    };

    test('renders the "Provenance & Source Register" section heading', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/Provenance &(?:amp;)? Source Register/);
    });

    test('renders empty-state when no documents and no auto-fill events', async () => {
      const buffer = await buildDealReportDocx(minimalContext()); // no documents / provenance fields
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/No source documents or auto-fill events recorded/);
    });

    test('renders document table when documents are present', async () => {
      const ctx = minimalContext();
      ctx.documents = {
        summary: { total: 2 },
        items: [
          { id: 'd1', name: 'sale-deed.pdf', file_type: 'application/pdf', doc_category: 'legal', created_at: '2026-04-15T00:00:00Z' },
          { id: 'd2', name: 'sanctioned-plan.pdf', file_type: 'application/pdf', doc_category: 'approvals', created_at: '2026-04-20T00:00:00Z' },
        ],
      };
      const buffer = await buildDealReportDocx(ctx);
      const text = await extractDocXmlText(buffer);
      // eyebrow() helper renders subsection labels as UPPERCASE.
      expect(text).toMatch(/UPLOADED SOURCE DOCUMENTS/i);
      expect(text).toMatch(/sale-deed\.pdf/);
      expect(text).toMatch(/sanctioned-plan\.pdf/);
      // Categories labelized
      expect(text).toMatch(/Legal/);
      expect(text).toMatch(/Approvals/);
    });

    test('document row surfaces extraction status when present', async () => {
      const ctx = minimalContext();
      ctx.documents = {
        summary: { total: 1 },
        items: [
          { id: 'd1', name: 'sale-deed.pdf', file_type: 'application/pdf', doc_category: 'legal', created_at: '2026-04-15T00:00:00Z' },
        ],
      };
      ctx.provenance = {
        autoFillEvents: [],
        extractionStatus: [
          { id: 'ex1', document_id: 'd1', doc_type: 'sale_deed', provider: 'gemini', extraction_status: 'completed', field_count: 12, history_count: 1, extracted_at: '2026-04-15T00:30:00Z', created_at: '2026-04-15T00:30:00Z' },
        ],
      };
      const buffer = await buildDealReportDocx(ctx);
      const text = await extractDocXmlText(buffer);
      // "12 fields · gemini"
      expect(text).toMatch(/12 fields .* gemini/);
    });

    test('document with no extraction shows em-dash, errored extraction shows "Failed"', async () => {
      const ctx = minimalContext();
      ctx.documents = {
        summary: { total: 2 },
        items: [
          { id: 'd1', name: 'no-extraction.pdf', file_type: 'application/pdf', doc_category: 'other', created_at: '2026-04-15T00:00:00Z' },
          { id: 'd2', name: 'failed-extraction.pdf', file_type: 'application/pdf', doc_category: 'other', created_at: '2026-04-16T00:00:00Z' },
        ],
      };
      ctx.provenance = {
        autoFillEvents: [],
        extractionStatus: [
          { id: 'ex1', document_id: 'd2', doc_type: 'unknown', provider: 'gemini', extraction_status: 'error', field_count: 0, history_count: 0 },
        ],
      };
      const buffer = await buildDealReportDocx(ctx);
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/Failed/);
    });

    test('auto-fill events table renders when events are present', async () => {
      const ctx = minimalContext();
      ctx.documents = {
        summary: { total: 0 },
        items: [],
      };
      ctx.provenance = {
        autoFillEvents: [
          {
            id: 'af1',
            applied_at: '2026-04-20T10:00:00Z',
            actor_id: 'u1',
            applied_fields_count: 7,
            source_extraction_ids: ['ex1', 'ex2'],
            target_table: 'deals',
            ontology_version: '1.0.0',
            changed_fields: ['rera_number', 'negotiated_price_cr'],
          },
          {
            id: 'af2',
            applied_at: '2026-04-21T11:00:00Z',
            actor_id: 'u1',
            applied_fields_count: 4,
            source_extraction_ids: ['ex3'],
            target_table: 'properties',
            ontology_version: '1.0.0',
            changed_fields: ['survey_number', 'khata_no'],
          },
        ],
        extractionStatus: [],
      };
      const buffer = await buildDealReportDocx(ctx);
      const text = await extractDocXmlText(buffer);
      // Eyebrow is uppercased; the arrow "→" is in the heading text
      expect(text).toMatch(/AUTO-FILL EVENTS/);
      // Field counts in event rows
      expect(text).toMatch(/7 fields/);
      expect(text).toMatch(/4 fields/);
      // Target table labels
      expect(text).toMatch(/Deal record/);
      expect(text).toMatch(/Linked property/);
      // Source extraction counts
      expect(text).toMatch(/2 extractions/);
      expect(text).toMatch(/1 extraction/);
      // Ontology version stamp
      expect(text).toMatch(/v1\.0\.0/);
    });

    test('truncates document list at 30 rows with a "showing first 30 of N" note', async () => {
      const ctx = minimalContext();
      ctx.documents = {
        summary: { total: 35 },
        items: Array.from({ length: 35 }, (_, i) => ({
          id: `d${i}`,
          name: `document-${i}.pdf`,
          file_type: 'application/pdf',
          doc_category: 'other',
          created_at: '2026-04-15T00:00:00Z',
        })),
      };
      const buffer = await buildDealReportDocx(ctx);
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/Showing first 30 of 35 documents/);
    });

    test('Provenance section sits after Approvals Tracker, before Pros & Cons', async () => {
      const ctx = minimalContext();
      // Need at least one doc to render the section body (not just empty-state)
      ctx.documents = {
        summary: { total: 1 },
        items: [{ id: 'd1', name: 'sale-deed.pdf', file_type: 'application/pdf', doc_category: 'legal', created_at: '2026-04-15T00:00:00Z' }],
      };
      const buffer = await buildDealReportDocx(ctx);
      const text = await extractDocXmlText(buffer);
      const approvalsIdx = text.indexOf('Approvals Tracker');
      const provenanceIdx = text.search(/Provenance &(?:amp;)? Source Register/);
      const prosConsIdx = text.search(/Pros &(?:amp;)? Cons/);
      expect(approvalsIdx).toBeGreaterThan(-1);
      expect(provenanceIdx).toBeGreaterThan(approvalsIdx);
      expect(prosConsIdx).toBeGreaterThan(provenanceIdx);
    });

    test('Provenance carries the PLATFORM DATA badge (not AI-ASSISTED)', async () => {
      const ctx = minimalContext();
      ctx.documents = {
        summary: { total: 1 },
        items: [{ id: 'd1', name: 'sale-deed.pdf', file_type: 'application/pdf', doc_category: 'legal', created_at: '2026-04-15T00:00:00Z' }],
      };
      const buffer = await buildDealReportDocx(ctx);
      const text = await extractDocXmlText(buffer);
      const provenanceIdx = text.search(/Provenance &(?:amp;)? Source Register/);
      // PLATFORM DATA badge must appear AFTER the Provenance heading
      const platformAfter = text.indexOf('PLATFORM DATA', provenanceIdx);
      expect(platformAfter).toBeGreaterThan(provenanceIdx);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // PR-NX37 (2026-05-17): Table of Contents + Methodology & Assumptions
  // ────────────────────────────────────────────────────────────────────
  describe('PR-NX37: Table of Contents + Methodology & Assumptions appendix', () => {
    const JSZip = require('jszip');
    const extractDocXmlText = async (buffer) => {
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file('word/document.xml').async('string');
      return docXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    };

    // ── Table of Contents ────────────────────────────────────────────
    test('renders Table of Contents heading after Cover', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/Table of Contents/);
      // ToC appears before Executive Briefing (section 1 after PR-NX74 rename).
      const tocIdx = text.indexOf('Table of Contents');
      const briefingIdx = text.indexOf('Executive Briefing');
      expect(tocIdx).toBeGreaterThan(-1);
      expect(briefingIdx).toBeGreaterThan(tocIdx);
    });

    test('Table of Contents lists every section in canonical order with numbers', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      // PR-NX74 (2026-05-19): section 1 renamed from "AI-Assisted
      // Briefing" to "Executive Briefing" per operator policy.
      expect(text).toMatch(/1\. *Executive Briefing/);
      expect(text).toMatch(/2\. *Executive Summary/);
      // 'Site Yield & Massing' inserted at position 5 (after Overview), shifting
      // every later section number by +1.
      expect(text).toMatch(/5\. *Site Yield &(?:amp;)? Massing/);
      expect(text).toMatch(/14\. *Risk Register/);
      expect(text).toMatch(/16\. *Approvals Tracker/);
      expect(text).toMatch(/17\. *Provenance &(?:amp;)? Source Register/);
      expect(text).toMatch(/18\. *Document-Derived Insights/);
      expect(text).toMatch(/21\. *Methodology &(?:amp;)? Assumptions/);
      expect(text).toMatch(/22\. *Disclaimer/);
    });

    test('PR-NX74: Table of Contents no longer tags AI vs Platform per section', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      // Pre-NX74 the ToC tagged each entry as "· AI-Assisted" or
      // "· Platform Data". Removed per operator policy.
      expect(text).not.toMatch(/· AI-Assisted/);
      expect(text).not.toMatch(/· Platform Data/);
    });

    test('SECTION_ORDER exports the 22 canonical section names', () => {
      expect(Array.isArray(__internal.SECTION_ORDER)).toBe(true);
      expect(__internal.SECTION_ORDER).toHaveLength(22);
      // PR-NX74 (2026-05-19) — first section renamed "AI-Assisted Briefing" → "Executive Briefing".
      expect(__internal.SECTION_ORDER[0]).toBe('Executive Briefing');
      expect(__internal.SECTION_ORDER[__internal.SECTION_ORDER.length - 1]).toBe('Disclaimer');
      expect(__internal.SECTION_ORDER).toContain('Document-Derived Insights');
      expect(__internal.SECTION_ORDER).toContain('Site Yield & Massing');
    });

    // ── Methodology & Assumptions ────────────────────────────────────
    test('renders Methodology & Assumptions appendix before Disclaimer', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      const methodologyIdx = text.search(/Methodology &(?:amp;)? Assumptions/);
      const disclaimerIdx = text.indexOf('Disclaimer');
      expect(methodologyIdx).toBeGreaterThan(-1);
      expect(disclaimerIdx).toBeGreaterThan(methodologyIdx);
    });

    test('Methodology section explains kernel + Indian operating reality', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/deterministic TypeScript financial kernel/);
      // PR-NX74: the "no AI numerics" / "no large language model ever
      // produces a number" callout was removed from the Methodology
      // section per operator policy. The deterministic-kernel guarantee
      // is intact via the previous assertion.
      expect(text).toMatch(/RERA 70\/30 escrow|GST tiers|BBMP UAV/);
    });

    test('Methodology empty-state when no inputs provided', async () => {
      const buffer = await buildDealReportDocx(minimalContext()); // no assumptions
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/No model inputs are recorded on this deal yet/);
      // eyebrow uppercases — match either form
      expect(text).toMatch(/0 ENTRIES|0 entries/i);
    });

    test('Methodology lists every operator input in the assumptions table', async () => {
      const ctx = minimalContext();
      ctx.assumptions = [
        { key: 'sellRatePerSqft', label: 'Sell Rate Per Sqft', value: 12000 },
        { key: 'baseRentPerSqftMonth', label: 'Base Rent Per Sqft Month', value: 95 },
        { key: 'occupancyPct', label: 'Occupancy Pct', value: 0.85 },
        { key: 'debtLTV', label: 'Debt L T V', value: 0.55 },
        { key: 'debtRatePct', label: 'Debt Rate Pct', value: 0.105 },
      ];
      const buffer = await buildDealReportDocx(ctx);
      const text = await extractDocXmlText(buffer);
      // Heading reflects the count (eyebrow renders uppercase)
      expect(text).toMatch(/5 ENTRIES|5 entries/i);
      // Each label appears alphabetically sorted
      expect(text).toMatch(/Base Rent Per Sqft Month/);
      expect(text).toMatch(/Debt L T V/);
      expect(text).toMatch(/Sell Rate Per Sqft/);
      // Values appear
      expect(text).toMatch(/12000/);
      expect(text).toMatch(/0\.85/);
    });

    test('Methodology truncates at 80 inputs with a note', async () => {
      const ctx = minimalContext();
      ctx.assumptions = Array.from({ length: 90 }, (_, i) => ({
        key: `input${i.toString().padStart(3, '0')}`,
        label: `Input ${i}`,
        value: i,
      }));
      const buffer = await buildDealReportDocx(ctx);
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/Showing first 80 of 90 operator inputs/);
    });

    test('boolean and string assumption values render correctly', async () => {
      const ctx = minimalContext();
      ctx.assumptions = [
        { key: 'isFlag', label: 'Is Flag', value: true },
        { key: 'isOther', label: 'Is Other', value: false },
        { key: 'label', label: 'Asset Class', value: 'residential_apartments' },
      ];
      const buffer = await buildDealReportDocx(ctx);
      const text = await extractDocXmlText(buffer);
      expect(text).toMatch(/Yes/);
      expect(text).toMatch(/No/);
      expect(text).toMatch(/residential_apartments/);
    });

    test('Methodology carries the PLATFORM DATA badge (not AI-ASSISTED)', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      const methodologyIdx = text.search(/Methodology &(?:amp;)? Assumptions/);
      const platformAfter = text.indexOf('PLATFORM DATA', methodologyIdx);
      expect(platformAfter).toBeGreaterThan(methodologyIdx);
    });

    test('End-to-end document order: Cover → ToC → Briefing → ... → Methodology → Disclaimer', async () => {
      const buffer = await buildDealReportDocx(minimalContext());
      const text = await extractDocXmlText(buffer);
      const tocIdx = text.indexOf('Table of Contents');
      // PR-NX74 (2026-05-19): section renamed "AI-Assisted Briefing" → "Executive Briefing".
      const briefingIdx = text.indexOf('Executive Briefing');
      const execIdx = text.indexOf('Executive Summary');
      const financialsIdx = text.search(/Financials &(?:amp;)? KPIs/);
      const provenanceIdx = text.search(/Provenance &(?:amp;)? Source Register/);
      const prosConsIdx = text.search(/Pros &(?:amp;)? Cons/);
      const scoreIdx = text.indexOf('Overall Score');
      const methodologyIdx = text.search(/Methodology &(?:amp;)? Assumptions/);
      const disclaimerIdx = text.indexOf('Disclaimer');
      // Strict ordering check
      expect(tocIdx).toBeGreaterThan(-1);
      expect(briefingIdx).toBeGreaterThan(tocIdx);
      expect(execIdx).toBeGreaterThan(briefingIdx);
      expect(financialsIdx).toBeGreaterThan(execIdx);
      expect(provenanceIdx).toBeGreaterThan(financialsIdx);
      expect(prosConsIdx).toBeGreaterThan(provenanceIdx);
      expect(scoreIdx).toBeGreaterThan(prosConsIdx);
      expect(methodologyIdx).toBeGreaterThan(scoreIdx);
      expect(disclaimerIdx).toBeGreaterThan(methodologyIdx);
    });
  });
});
