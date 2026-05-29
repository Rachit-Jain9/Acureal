'use strict';

const {
  extractAllSignals,
  extractLandCostShareOfGdv,
  extractIrrVsHurdle,
  extractPriceVsCompBand,
  extractAbsorptionVsCompBand,
  extractSaleableAreaMismatch,
  extractReraRegistrationMissing,
  extractApprovalGapCount,
  extractOverdueDdCount,
  extractDealBreakerDdCount,
} = require('../src/services/recommendation/signalExtractors');

const {
  generateRecommendations,
  RECOMMENDATION_VERBS,
  TOPICS,
  isLegalTopic,
} = require('../src/services/recommendation/recommendationRules');

const recommendationEngine = require('../src/services/recommendation');

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const makeWorkspace = (overrides = {}) => ({
  deal: {
    id: 'deal-1',
    asset_class: 'residential_apartments',
    deal_structure: 'jda',
    stage: 'underwriting',
    ...overrides.deal,
  },
  financial: {
    summary: {
      kpis: overrides.kpis || null,
    },
  },
  comps: { entries: overrides.comps || [] },
  approvals: overrides.approvals || [],
  dd: { items: overrides.ddItems || [] },
  risk: { flags: overrides.riskFlags || [] },
});

// ─────────────────────────────────────────────────────────────────────────────
// signalExtractors — unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('signalExtractors — extractLandCostShareOfGdv', () => {
  test('returns null when financial summary is missing', () => {
    expect(extractLandCostShareOfGdv(makeWorkspace())).toBeNull();
  });

  test('computes the ratio when both land and revenue are present', () => {
    const ws = makeWorkspace({ kpis: { landCr: 38, revenue: 100 } });
    const s = extractLandCostShareOfGdv(ws);
    expect(s).not.toBeNull();
    expect(s.kind).toBe('land_cost_share_of_gdv');
    expect(s.value).toBeCloseTo(0.38, 4);
    expect(s.meta.ratio_pct).toBe(38);
    expect(s.evidence.length).toBeGreaterThanOrEqual(2);
  });

  test('falls back to deal.land_ask_price_cr when kernel does not have landCr', () => {
    const ws = makeWorkspace({
      deal: { land_ask_price_cr: 18 },
      kpis: { revenue: 60 },
    });
    const s = extractLandCostShareOfGdv(ws);
    expect(s).not.toBeNull();
    expect(s.value).toBeCloseTo(0.30, 4);
  });
});

describe('signalExtractors — extractIrrVsHurdle', () => {
  test('returns null when irr is missing', () => {
    expect(extractIrrVsHurdle(makeWorkspace({ kpis: { revenue: 100 } }))).toBeNull();
  });

  test('uses default 16% hurdle when not specified on the deal', () => {
    const ws = makeWorkspace({ kpis: { irr: 0.142 } });
    const s = extractIrrVsHurdle(ws);
    expect(s.value.hurdle).toBe(0.16);
    expect(s.value.gap_bps).toBe(-180);
  });

  test('honours deal.hurdle_irr_pct when set', () => {
    const ws = makeWorkspace({
      deal: { hurdle_irr_pct: 0.20 },
      kpis: { irr: 0.142 },
    });
    const s = extractIrrVsHurdle(ws);
    expect(s.value.hurdle).toBe(0.20);
    expect(s.value.gap_bps).toBe(-580);
  });
});

describe('signalExtractors — extractPriceVsCompBand', () => {
  test('returns null with fewer than 3 comps', () => {
    const ws = makeWorkspace({
      deal: { sales_price_per_sqft: 12000 },
      comps: [{ price_per_sqft: 10000 }, { price_per_sqft: 11000 }],
    });
    expect(extractPriceVsCompBand(ws)).toBeNull();
  });

  test('emits deviation when comp median is far from assumption', () => {
    const ws = makeWorkspace({
      deal: { sales_price_per_sqft: 13200 },
      comps: [
        { price_per_sqft: 11000 },
        { price_per_sqft: 11200 },
        { price_per_sqft: 11400 },
        { price_per_sqft: 11000 },
        { price_per_sqft: 11500 },
      ],
    });
    const s = extractPriceVsCompBand(ws);
    expect(s).not.toBeNull();
    expect(s.value.n_comps).toBe(5);
    expect(s.value.comp_median).toBeCloseTo(11200, -2);
    expect(s.value.deviation_pct).toBeGreaterThan(0.10);
  });
});

describe('signalExtractors — extractAbsorptionVsCompBand', () => {
  test('emits multiple when sales velocity is well above comps', () => {
    const ws = makeWorkspace({
      deal: { absorption_units_per_quarter: 28 },
      comps: [
        { absorption_units_per_quarter: 12 },
        { absorption_units_per_quarter: 13 },
        { absorption_units_per_quarter: 14 },
        { absorption_units_per_quarter: 13 },
      ],
    });
    const s = extractAbsorptionVsCompBand(ws);
    expect(s.value.multiple).toBeCloseTo(28 / 13, 2);
    expect(s.value.multiple).toBeGreaterThanOrEqual(2.0);
  });
});

describe('signalExtractors — extractSaleableAreaMismatch', () => {
  test('flags when extracted and input deviate >5%', () => {
    const ws = makeWorkspace({
      deal: { saleable_sqft: 46000, extracted_saleable_sqft: 42800 },
    });
    const s = extractSaleableAreaMismatch(ws);
    expect(s).not.toBeNull();
    expect(s.meta.deviation_pct).toBeGreaterThan(5);
  });

  test('skips when deviation is within 5%', () => {
    const ws = makeWorkspace({
      deal: { saleable_sqft: 46000, extracted_saleable_sqft: 45000 },
    });
    expect(extractSaleableAreaMismatch(ws)).toBeNull();
  });
});

describe('signalExtractors — extractReraRegistrationMissing', () => {
  test('fires for residential when no RERA entry exists', () => {
    const ws = makeWorkspace({
      deal: { asset_class: 'residential_apartments' },
      approvals: [{ approval_type: 'fire_noc', is_validated: true }],
    });
    expect(extractReraRegistrationMissing(ws)).not.toBeNull();
  });

  test('does NOT fire for commercial deals', () => {
    const ws = makeWorkspace({
      deal: { asset_class: 'commercial_office' },
      approvals: [],
    });
    expect(extractReraRegistrationMissing(ws)).toBeNull();
  });

  test('does NOT fire when RERA is validated', () => {
    const ws = makeWorkspace({
      deal: { asset_class: 'residential_apartments' },
      approvals: [{ approval_type: 'rera', name: 'RERA Karnataka', is_validated: true }],
    });
    expect(extractReraRegistrationMissing(ws)).toBeNull();
  });
});

describe('signalExtractors — extractCrossDocInconsistencies (P1-PR4)', () => {
  const { extractCrossDocInconsistencies } = require('../src/services/recommendation/signalExtractors');

  test('returns null when no risk flags exist', () => {
    const ws = makeWorkspace({ riskFlags: [] });
    expect(extractCrossDocInconsistencies(ws)).toBeNull();
  });

  test('returns null when no flags carry source=ai_detector', () => {
    const ws = makeWorkspace({
      riskFlags: [
        { title: 'manual flag', severity: 'high', status: 'open', source: 'manual' },
      ],
    });
    expect(extractCrossDocInconsistencies(ws)).toBeNull();
  });

  test('returns null when ai_detector flags are all closed/resolved', () => {
    const ws = makeWorkspace({
      riskFlags: [
        { title: 'seller mismatch', severity: 'high', status: 'closed', source: 'ai_detector' },
      ],
    });
    expect(extractCrossDocInconsistencies(ws)).toBeNull();
  });

  test('aggregates open ai_detector flags by severity', () => {
    const ws = makeWorkspace({
      riskFlags: [
        { title: 'seller mismatch (sale deed ↔ EC)', severity: 'critical', status: 'open', source: 'ai_detector', category: 'title' },
        { title: 'FSI conflict (plan ↔ approval)', severity: 'high', status: 'open', source: 'ai_detector', category: 'physical' },
        { title: 'area drift across deeds', severity: 'medium', status: 'flagged', source: 'ai_detector', category: 'physical' },
        { title: 'RERA filing gap', severity: 'high', status: 'open', source: 'ai_detector', category: 'regulatory' },
        // Should be ignored — manual source.
        { title: 'manual flag', severity: 'critical', status: 'open', source: 'manual' },
      ],
    });
    const s = extractCrossDocInconsistencies(ws);
    expect(s).not.toBeNull();
    expect(s.kind).toBe('cross_document_inconsistencies');
    expect(s.value.total).toBe(4);
    expect(s.value.by_severity).toEqual({ critical: 1, high: 2, medium: 1, low: 0 });
    expect(s.value.top_findings).toHaveLength(3);
    expect(s.value.top_findings[0].title).toMatch(/seller mismatch/);
  });
});

describe('signalExtractors — extractDealBreakerDdCount (Deal-Pulse parity)', () => {
  test('counts required deal_breaker items not in a ready status', () => {
    const ws = makeWorkspace({
      ddItems: [
        { is_required: true, severity: 'deal_breaker', status: 'pending' },
        { is_required: true, severity: 'deal_breaker', status: 'in_progress' },
        { is_required: true, severity: 'deal_breaker', status: 'flagged' },
      ],
    });
    const s = extractDealBreakerDdCount(ws);
    expect(s.value.count).toBe(3);
    expect(s.evidence[0].label).toMatch(/3 unresolved deal-breaker/);
  });

  test('excludes completed and not_applicable deal-breakers (matches READY_STATUSES)', () => {
    const ws = makeWorkspace({
      ddItems: [
        { is_required: true, severity: 'deal_breaker', status: 'pending' },
        { is_required: true, severity: 'deal_breaker', status: 'completed' },
        { is_required: true, severity: 'deal_breaker', status: 'not_applicable' },
      ],
    });
    expect(extractDealBreakerDdCount(ws).value.count).toBe(1);
  });

  test('excludes non-required deal-breaker items (Deal Pulse counts required only)', () => {
    const ws = makeWorkspace({
      ddItems: [
        { is_required: true, severity: 'deal_breaker', status: 'pending' },
        { is_required: false, severity: 'deal_breaker', status: 'pending' },
      ],
    });
    expect(extractDealBreakerDdCount(ws).value.count).toBe(1);
  });

  test("does NOT count 'critical' severity — that is a risk severity, not a DD severity", () => {
    // Regression for the 5-vs-6 discrepancy: a stray critical-tagged DD row
    // used to inflate this card above the Deal Pulse count.
    const ws = makeWorkspace({
      ddItems: [
        { is_required: true, severity: 'deal_breaker', status: 'pending' },
        { is_required: true, severity: 'critical', status: 'pending' },
      ],
    });
    expect(extractDealBreakerDdCount(ws).value.count).toBe(1);
  });

  test('returns null when no qualifying deal-breakers', () => {
    expect(extractDealBreakerDdCount(makeWorkspace({ ddItems: [] }))).toBeNull();
    expect(
      extractDealBreakerDdCount(makeWorkspace({
        ddItems: [{ is_required: true, severity: 'secondary', status: 'pending' }],
      })),
    ).toBeNull();
  });
});

describe('signalExtractors — extractApprovalGapCount', () => {
  test('counts required-open approvals', () => {
    const ws = makeWorkspace({
      approvals: [
        { is_required: true, is_validated: false, status: 'pending' },
        { is_required: true, is_validated: true, status: 'validated' },
        { is_required: false, is_validated: false, status: 'pending' },
        { is_required: true, is_validated: false, status: 'in_progress' },
      ],
    });
    const s = extractApprovalGapCount(ws);
    expect(s.value.required_open).toBe(2);
    expect(s.value.required_total).toBe(3);
  });
});

describe('signalExtractors — extractOverdueDdCount', () => {
  test('counts required pending items with past due dates', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const ws = makeWorkspace({
      ddItems: [
        { is_required: true, status: 'pending', due_date: yesterday },
        { is_required: true, status: 'pending', due_date: tomorrow },
        { is_required: true, status: 'completed', due_date: yesterday },
        { is_required: false, status: 'pending', due_date: yesterday },
      ],
    });
    const s = extractOverdueDdCount(ws);
    expect(s.value.count).toBe(1);
  });
});

describe('signalExtractors — extractAllSignals', () => {
  test('orchestrator drops nulls and never throws', () => {
    const ws = makeWorkspace({
      kpis: { landCr: 40, revenue: 100, irr: 0.12 },
      deal: { asset_class: 'residential_apartments', sales_price_per_sqft: 13000 },
      comps: [
        { price_per_sqft: 11000 },
        { price_per_sqft: 11100 },
        { price_per_sqft: 11200 },
        { price_per_sqft: 11300 },
      ],
    });
    const signals = extractAllSignals(ws);
    expect(signals.length).toBeGreaterThan(0);
    const kinds = signals.map((s) => s.kind);
    expect(kinds).toContain('land_cost_share_of_gdv');
    expect(kinds).toContain('irr_vs_hurdle');
    expect(kinds).toContain('price_vs_comp_band');
    expect(kinds).toContain('rera_registration_missing'); // residential, no approvals
  });

  test('returns [] for null / empty workspace', () => {
    expect(extractAllSignals(null)).toEqual([]);
    expect(extractAllSignals({})).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// recommendationRules — unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('recommendationRules', () => {
  test('verbs are exactly the five allowed', () => {
    expect(RECOMMENDATION_VERBS).toEqual(
      expect.arrayContaining(['Recommend', 'Consider', 'Re-examine', 'Flag', 'Stress-test'])
    );
    expect(RECOMMENDATION_VERBS.length).toBe(5);
  });

  test('every topic declares its ai_narratable flag', () => {
    for (const key of Object.keys(TOPICS)) {
      expect(typeof TOPICS[key].ai_narratable).toBe('boolean');
      expect(typeof TOPICS[key].label).toBe('string');
    }
  });

  test('isLegalTopic identifies the four legal carve-outs', () => {
    expect(isLegalTopic('legal_title')).toBe(true);
    expect(isLegalTopic('legal_rera')).toBe(true);
    expect(isLegalTopic('legal_approvals')).toBe(true);
    expect(isLegalTopic('legal_encumbrance')).toBe(true);
    expect(isLegalTopic('pricing')).toBe(false);
    expect(isLegalTopic('capital_stack')).toBe(false);
  });

  test('empty signals → empty recommendations', () => {
    expect(generateRecommendations([])).toEqual([]);
    expect(generateRecommendations(null)).toEqual([]);
  });

  test('land-cost-share-high fires when ratio ≥30%', () => {
    const signals = [
      { kind: 'land_cost_share_of_gdv', value: 0.38, evidence: [], meta: {} },
      { kind: 'irr_vs_hurdle', value: { irr: 0.12, hurdle: 0.16, gap: -0.04, gap_bps: -400 }, evidence: [], meta: { gap_bps: -400, hurdle: 0.16 } },
    ];
    const out = generateRecommendations(signals);
    const card = out.find((r) => r.id === 'land-cost-share-high');
    expect(card).toBeTruthy();
    expect(card.verb).toBe('Recommend');
    expect(card.topic).toBe('land_price');
    expect(card.ai_narratable).toBe(true);
    expect(card.severity).toBeGreaterThanOrEqual(3);
  });

  test('land-cost-share-high does NOT fire when ratio is below 30%', () => {
    const signals = [{ kind: 'land_cost_share_of_gdv', value: 0.25, evidence: [], meta: {} }];
    const out = generateRecommendations(signals);
    expect(out.find((r) => r.id === 'land-cost-share-high')).toBeUndefined();
  });

  test('rera-registration-missing is ALWAYS deterministic (ai_narratable: false)', () => {
    const signals = [
      { kind: 'rera_registration_missing', value: { reason: 'no_entry' }, evidence: [], meta: { reason: 'no_entry' } },
    ];
    const out = generateRecommendations(signals);
    const card = out.find((r) => r.id === 'rera-registration-missing');
    expect(card).toBeTruthy();
    expect(card.ai_narratable).toBe(false);
    expect(card.topic).toBe('legal_rera');
    expect(card.verb).toBe('Flag');
    expect(card.severity).toBe(5);
  });

  test('overdue DD items fires with severity proportional to count', () => {
    const sigsLow = [{ kind: 'overdue_dd_count', value: { count: 1 }, evidence: [], meta: { count: 1 } }];
    const sigsHigh = [{ kind: 'overdue_dd_count', value: { count: 5 }, evidence: [], meta: { count: 5 } }];
    const low = generateRecommendations(sigsLow)[0];
    const high = generateRecommendations(sigsHigh)[0];
    expect(high.severity).toBeGreaterThan(low.severity);
  });

  test('all rules use only the allowed verbs', () => {
    // Generate against a broad fixture; every emitted card must use an allowed verb.
    const signals = [
      { kind: 'land_cost_share_of_gdv', value: 0.42, evidence: [], meta: { ratio_pct: 42 } },
      { kind: 'irr_vs_hurdle', value: { irr: 0.10, hurdle: 0.16, gap: -0.06, gap_bps: -600 }, evidence: [], meta: { gap_bps: -600, hurdle: 0.16 } },
      { kind: 'equity_multiple_vs_target', value: { em: 1.2, target: 1.8, gap: -0.6 }, evidence: [], meta: {} },
      { kind: 'dscr_breach_month', value: { month: 18, value: 0.85 }, evidence: [], meta: {} },
      { kind: 'price_vs_comp_band', value: { assumed: 13000, comp_median: 11000, deviation_pct: 0.18, n_comps: 5 }, evidence: [], meta: { assumed: 13000, comp_median: 11000, deviation_pct: 18, n_comps: 5 } },
      { kind: 'absorption_vs_comp_band', value: { assumed: 28, comp_median: 13, multiple: 2.15, n_comps: 9 }, evidence: [], meta: {} },
      { kind: 'cap_rate_vs_comp_band', value: { assumed: 7.25, band_lo: 7.6, band_hi: 8.1, n_comps: 5 }, evidence: [], meta: { direction: 'below' } },
      { kind: 'extracted_area_mismatch', value: { input: 46000, extracted: 42800, deviation_pct: 0.075 }, evidence: [], meta: { input: 46000, extracted: 42800, deviation_pct: 7.5 } },
      { kind: 'rera_registration_missing', value: { reason: 'no_entry' }, evidence: [], meta: { reason: 'no_entry' } },
      { kind: 'approval_gap_count', value: { required_open: 4, required_total: 8 }, evidence: [], meta: {} },
      { kind: 'overdue_dd_count', value: { count: 3 }, evidence: [], meta: { count: 3 } },
      { kind: 'deal_breaker_dd_count', value: { count: 1 }, evidence: [], meta: {} },
      { kind: 'promoter_delivery_slippage', value: { avg_delay_months: 10 }, evidence: [], meta: {} },
    ];
    const out = generateRecommendations(signals);
    expect(out.length).toBeGreaterThan(0);
    for (const card of out) {
      expect(RECOMMENDATION_VERBS).toContain(card.verb);
    }
  });

  test('output is sorted by severity descending', () => {
    const signals = [
      { kind: 'overdue_dd_count', value: { count: 1 }, evidence: [], meta: { count: 1 } },
      { kind: 'rera_registration_missing', value: { reason: 'no_entry' }, evidence: [], meta: { reason: 'no_entry' } },
    ];
    const out = generateRecommendations(signals);
    expect(out[0].severity).toBeGreaterThanOrEqual(out[out.length - 1].severity);
  });

  test('every legal-carve-out card has ai_narratable: false', () => {
    const signals = [
      { kind: 'rera_registration_missing', value: { reason: 'no_entry' }, evidence: [], meta: { reason: 'no_entry' } },
      { kind: 'approval_gap_count', value: { required_open: 4, required_total: 8 }, evidence: [], meta: {} },
    ];
    const out = generateRecommendations(signals);
    for (const card of out) {
      if (card.topic.startsWith('legal_')) {
        expect(card.ai_narratable).toBe(false);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// recommendation/index.js orchestrator — integration
// ─────────────────────────────────────────────────────────────────────────────

describe('recommendation orchestrator', () => {
  test('end-to-end: empty workspace produces empty recommendations + a stable hash', async () => {
    const result = await recommendationEngine.generateForWorkspace(null);
    expect(result.recommendations).toEqual([]);
    expect(typeof result.snapshot_hash).toBe('string');
    expect(result.snapshot_hash.length).toBe(64); // sha256 hex
  });

  test('end-to-end: a realistic underwriting fixture produces actionable cards', async () => {
    const workspace = makeWorkspace({
      deal: {
        asset_class: 'residential_apartments',
        deal_structure: 'jda',
        sales_price_per_sqft: 13200,
        absorption_units_per_quarter: 28,
        saleable_sqft: 46000,
        extracted_saleable_sqft: 42800,
      },
      kpis: { landCr: 40, revenue: 100, irr: 0.12 },
      comps: [
        { price_per_sqft: 11000, absorption_units_per_quarter: 12 },
        { price_per_sqft: 11200, absorption_units_per_quarter: 13 },
        { price_per_sqft: 11300, absorption_units_per_quarter: 14 },
        { price_per_sqft: 11400, absorption_units_per_quarter: 13 },
      ],
      approvals: [],
    });
    const result = await recommendationEngine.generateForWorkspace(workspace);
    expect(result.recommendations.length).toBeGreaterThanOrEqual(4);
    const topics = result.recommendations.map((r) => r.topic);
    expect(topics).toContain('land_price');
    expect(topics).toContain('capital_stack');
    expect(topics).toContain('pricing');
    expect(topics).toContain('absorption');
    expect(topics).toContain('data_consistency');
    expect(topics).toContain('legal_rera');
  });

  test('snapshot hash is deterministic across repeat calls on the same workspace', async () => {
    const ws = makeWorkspace({ kpis: { landCr: 40, revenue: 100, irr: 0.12 } });
    const a = await recommendationEngine.generateForWorkspace(ws);
    const b = await recommendationEngine.generateForWorkspace(ws);
    expect(a.snapshot_hash).toBe(b.snapshot_hash);
  });

  test('snapshot hash changes when underlying inputs change', async () => {
    const ws1 = makeWorkspace({ kpis: { landCr: 40, revenue: 100, irr: 0.12 } });
    const ws2 = makeWorkspace({ kpis: { landCr: 50, revenue: 100, irr: 0.12 } });
    const a = await recommendationEngine.generateForWorkspace(ws1);
    const b = await recommendationEngine.generateForWorkspace(ws2);
    expect(a.snapshot_hash).not.toBe(b.snapshot_hash);
  });

  test('narrator hook is honoured for AI-narratable cards but bypassed for legal carve-outs', async () => {
    const ws = makeWorkspace({
      deal: { asset_class: 'residential_apartments' },
      kpis: { landCr: 40, revenue: 100, irr: 0.12 },
      approvals: [],
    });
    const narratedIds = [];
    const result = await recommendationEngine.generateForWorkspace(ws, {
      narrate: async (card) => {
        narratedIds.push(card.id);
        return { headline: `NARRATED: ${card.headline}`, detail: card.detail };
      },
    });
    // Legal cards must NOT be narrated
    const reraCard = result.recommendations.find((r) => r.topic === 'legal_rera');
    expect(reraCard).toBeTruthy();
    expect(reraCard.headline).not.toMatch(/^NARRATED/);
    expect(narratedIds).not.toContain('rera-registration-missing');
    // At least one non-legal card must be narrated
    const narratedCard = result.recommendations.find((r) => r.headline?.startsWith('NARRATED'));
    expect(narratedCard).toBeTruthy();
    expect(narratedCard.narrated).toBe(true);
  });

  test('narrator failure on one card does not cascade — others still render', async () => {
    const ws = makeWorkspace({
      deal: { asset_class: 'residential_apartments' },
      kpis: { landCr: 40, revenue: 100, irr: 0.12 },
      approvals: [],
    });
    const result = await recommendationEngine.generateForWorkspace(ws, {
      narrate: async () => { throw new Error('boom'); },
    });
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  // ─── Learning-loop team feedback (P8-PR1) ──────────────────────────────

  describe('teamFeedback integration', () => {
    const buildFixtureWorkspace = () =>
      makeWorkspace({
        deal: {
          asset_class: 'residential_apartments',
          deal_structure: 'jda',
          sales_price_per_sqft: 13200,
          absorption_units_per_quarter: 28,
        },
        kpis: { landCr: 40, revenue: 100, irr: 0.12 },
        comps: [
          { price_per_sqft: 11000, absorption_units_per_quarter: 12 },
          { price_per_sqft: 11200, absorption_units_per_quarter: 13 },
          { price_per_sqft: 11300, absorption_units_per_quarter: 14 },
          { price_per_sqft: 11400, absorption_units_per_quarter: 13 },
        ],
        approvals: [],
      });

    test('without teamFeedback, no cards carry the team_feedback field', async () => {
      const ws = buildFixtureWorkspace();
      const result = await recommendationEngine.generateForWorkspace(ws);
      for (const card of result.recommendations) {
        expect(card.team_feedback).toBeUndefined();
        expect(card.effective_severity).toBeUndefined();
      }
    });

    test('with an empty teamFeedback Map, behaviour matches no-feedback path', async () => {
      const ws = buildFixtureWorkspace();
      const a = await recommendationEngine.generateForWorkspace(ws);
      const b = await recommendationEngine.generateForWorkspace(ws, { teamFeedback: new Map() });
      expect(b.recommendations.map((c) => c.id)).toEqual(a.recommendations.map((c) => c.id));
      for (const card of b.recommendations) {
        expect(card.team_feedback).toBeUndefined();
      }
    });

    test('a heavily-dismissed non-legal rule de-ranks via effective_severity', async () => {
      const ws = buildFixtureWorkspace();
      const baseline = await recommendationEngine.generateForWorkspace(ws);
      // Identify a non-legal card we can target. The fixture reliably emits
      // 'land-cost-share-high' (severity 4) and several others.
      const targetId = 'land-cost-share-high';
      const baselineCard = baseline.recommendations.find((c) => c.id === targetId);
      expect(baselineCard).toBeTruthy();
      // Build feedback that hammers the target rule
      const feedback = new Map([
        [targetId, { dismiss_count: 8, snooze_count: 0, acted_count: 0, total_count: 8, last_verdict_at: '2026-05-26' }],
      ]);
      const adjusted = await recommendationEngine.generateForWorkspace(ws, { teamFeedback: feedback });
      const adjustedCard = adjusted.recommendations.find((c) => c.id === targetId);
      expect(adjustedCard.team_feedback).toMatchObject({
        multiplier: 0.7,
        dismiss_count: 8,
      });
      expect(adjustedCard.team_feedback.reason).toMatch(/8×/);
      expect(adjustedCard.effective_severity).toBeCloseTo(adjustedCard.severity * 0.7);
      // Sort moved the de-ranked card lower than before (or at least not above)
      const baselineIdx = baseline.recommendations.findIndex((c) => c.id === targetId);
      const adjustedIdx = adjusted.recommendations.findIndex((c) => c.id === targetId);
      expect(adjustedIdx).toBeGreaterThanOrEqual(baselineIdx);
    });

    test('legal carve-out topic is never de-ranked even with extreme dismissals', async () => {
      const ws = buildFixtureWorkspace();
      // RERA card emits with severity 5 — heavy feedback would otherwise crush it
      const feedback = new Map([
        ['rera-registration-missing', { dismiss_count: 99, snooze_count: 0, acted_count: 0, total_count: 99, last_verdict_at: '2026-05-26' }],
      ]);
      const adjusted = await recommendationEngine.generateForWorkspace(ws, { teamFeedback: feedback });
      const reraCard = adjusted.recommendations.find((c) => c.id === 'rera-registration-missing');
      expect(reraCard).toBeTruthy();
      expect(reraCard.team_feedback.multiplier).toBe(1.0);
      expect(reraCard.team_feedback.reason).toBeNull();
      // It surfaces counts (so the operator can see what was captured) but is not de-ranked
      expect(reraCard.team_feedback.dismiss_count).toBe(99);
      expect(reraCard.effective_severity).toBeCloseTo(reraCard.severity); // multiplier=1.0
    });

    test('acted_count >= dismiss_count keeps multiplier at 1.0 (positive feedback)', async () => {
      const ws = buildFixtureWorkspace();
      const feedback = new Map([
        ['land-cost-share-high', { dismiss_count: 4, snooze_count: 0, acted_count: 5, total_count: 9, last_verdict_at: '2026-05-26' }],
      ]);
      const result = await recommendationEngine.generateForWorkspace(ws, { teamFeedback: feedback });
      const card = result.recommendations.find((c) => c.id === 'land-cost-share-high');
      expect(card.team_feedback.multiplier).toBe(1.0);
      expect(card.team_feedback.acted_count).toBe(5);
    });

    test('original severity is preserved — only effective_severity reflects the multiplier', async () => {
      const ws = buildFixtureWorkspace();
      const feedback = new Map([
        ['land-cost-share-high', { dismiss_count: 8, snooze_count: 0, acted_count: 0, total_count: 8, last_verdict_at: '2026-05-26' }],
      ]);
      const baseline = await recommendationEngine.generateForWorkspace(ws);
      const adjusted = await recommendationEngine.generateForWorkspace(ws, { teamFeedback: feedback });
      const baseCard = baseline.recommendations.find((c) => c.id === 'land-cost-share-high');
      const adjCard = adjusted.recommendations.find((c) => c.id === 'land-cost-share-high');
      expect(adjCard.severity).toBe(baseCard.severity);
      expect(adjCard.effective_severity).toBeLessThan(baseCard.severity);
    });

    test('non-Map teamFeedback values are ignored (defensive)', async () => {
      const ws = buildFixtureWorkspace();
      const result = await recommendationEngine.generateForWorkspace(ws, { teamFeedback: { 'foo': { dismiss_count: 9 } } });
      for (const card of result.recommendations) {
        expect(card.team_feedback).toBeUndefined();
      }
    });
  });
});
