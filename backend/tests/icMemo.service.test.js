'use strict';

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/ai/providerRegistry', () => ({
  getProviderAvailability: jest.fn(() => ({ claude: false, gpt_compatible: false })),
}));
jest.mock('../src/services/ai/aiRouter', () => ({
  runClaudeReasoning: jest.fn(),
  runClaudeReasoningStream: jest.fn(),
}));
jest.mock('../src/services/aiArtifacts.service', () => ({
  computeSnapshotHash: jest.fn(() => 'mocked-hash'),
  saveArtifact: jest.fn(),
  getLatestArtifact: jest.fn(),
}));
jest.mock('../src/services/numericalVerifier.service', () => ({
  snapshotFromDealAnalysisInput: jest.fn(() => ({})),
  verifyDealAnalysis: jest.fn(() => ({ drifts: [], verifiedAt: '2026-05-09T00:00:00Z' })),
}));
// Deterministic trust-signal services — mocked so the IC-memo test stays
// isolated to icMemo.service. Each has a safe default; individual tests
// override with mockResolvedValueOnce.
jest.mock('../src/services/riskRadar.service', () => ({
  getRiskRadar: jest.fn().mockResolvedValue(null),
}));
jest.mock('../src/services/modelConfidence.service', () => ({
  getModelConfidence: jest.fn().mockResolvedValue({ available: false }),
}));
jest.mock('../src/services/promoterProfile.service', () => ({
  getProfileWithAssessment: jest.fn().mockResolvedValue(null),
}));
jest.mock('../src/services/compReliance.service', () => ({
  listReliedCompIds: jest.fn().mockResolvedValue([]),
}));

const { query } = require('../src/config/database');
const { getProviderAvailability } = require('../src/services/ai/providerRegistry');
const riskRadarService = require('../src/services/riskRadar.service');
const modelConfidenceService = require('../src/services/modelConfidence.service');
const promoterProfileService = require('../src/services/promoterProfile.service');
const compRelianceService = require('../src/services/compReliance.service');
const icMemo = require('../src/services/icMemo.service');

beforeEach(() => {
  jest.clearAllMocks();
});

// Helper: shape mock for the 9 parallel queries buildIcMemoInput runs.
// In order: deal, financials, scenarios, benchmarks, comps, txns,
// risk_flags, dd_items, approval_items.
const mockQueriesInOrder = (responses) => {
  query.mockReset();
  let i = 0;
  query.mockImplementation(() => Promise.resolve(responses[i++] || { rows: [] }));
};

describe('buildIcMemoInput', () => {
  test('returns { error: "Deal not found" } when deal row missing', async () => {
    mockQueriesInOrder([{ rows: [] }]);
    const r = await icMemo.buildIcMemoInput('00000000-0000-0000-0000-000000000001');
    expect(r.error).toBe('Deal not found');
  });

  test('assembles payload with all expected sections', async () => {
    mockQueriesInOrder([
      // deal
      {
        rows: [
          {
            id: 'd1',
            name: 'Whitefield Plot 22',
            stage: 'underwriting',
            priority: 'high',
            deal_type: 'land_acquisition',
            city: 'Bengaluru',
            address: 'Whitefield, Bengaluru',
            property_type: 'residential',
            land_area_sqft: 217800,
            land_area_acres: 5,
            zoning: 'residential',
            permissible_fsi: 2.5,
            circle_rate_per_sqft: 8000,
            land_ask_price_cr: 50,
            negotiated_price_cr: 45,
            land_pricing_basis: 'per_sqft',
          },
        ],
      },
      // financials
      {
        rows: [
          {
            asset_class: 'residential_apartments',
            irr_pct: 18.5,
            npv_cr: 32.4,
            residual_land_value_cr: 47.2,
            equity_multiple: 1.85,
            gross_margin_pct: 22.4,
            total_cost_cr: 180,
            total_revenue_cr: 245,
            model_params: { kpis: { irr: 18.5 } },
          },
        ],
      },
      // scenarios
      { rows: [{ name: 'Base', irr_pct: 18.5, npv_cr: 32.4, total_revenue_cr: 245, total_cost_cr: 180 }] },
      // benchmarks
      { rows: [{ micro_market: 'Whitefield', avg_price_min_per_sqft: 14000, avg_price_max_per_sqft: 18000, yoy_growth_min_pct: 8, yoy_growth_max_pct: 12, anchor_hub: 'ITPL' }] },
      // comps
      { rows: [{ project_name: 'Brigade Gateway', locality: 'Whitefield', rate_per_sqft: 17500, bhk_config: '2/3 BHK', total_units: 320, geocode_quality: 'rooftop' }] },
      // transactions
      { rows: [] },
      // risk_flags
      { rows: [{ category: 'title', severity: 'high', title: 'EC seller mismatch', description: '...', mitigation: '...', status: 'open', source: 'ai_detector' }] },
      // dd_items
      { rows: [{ category: 'title', item_name: 'EC verification', status: 'pending', severity: 'critical', is_required: true, owner_name: 'Rachit' }] },
      // approval_items
      { rows: [{ approval_type: 'rera', name: 'RERA registration', status: 'pending', issuing_authority: 'KRERA', expiry_date: null, is_available: false }] },
    ]);

    const r = await icMemo.buildIcMemoInput('d1');
    expect(r.error).toBeUndefined();
    expect(r.dealName).toBe('Whitefield Plot 22');
    expect(r.systemPrompt).toContain('IC Memo');

    const p = r.payload;
    expect(p.deal.name).toBe('Whitefield Plot 22');
    expect(p.deal.permissibleFsi).toBe(2.5);
    expect(p.financials.irrPct).toBe(18.5);
    expect(p.financials.npvCr).toBe(32.4);
    expect(p.scenarios).toHaveLength(1);
    // Benchmarks and comps are POSTURE objects now, not bare arrays: an empty
    // set has to be able to say it is unrecorded rather than looking like
    // "nothing to worry about". The fixture's deal is in Whitefield and the
    // fixture benchmark is Whitefield, so it matches on locality.
    expect(p.marketBenchmarks.recorded).toBe(true);
    expect(p.marketBenchmarks.items).toHaveLength(1);
    expect(p.marketBenchmarks.items[0].microMarket).toBe('Whitefield');
    // No coordinates on the fixture property → no proximity comps, so the
    // city-wide set rides along explicitly flagged as NOT this site's evidence.
    expect(p.comps.recorded).toBe(false);
    expect(p.comps.scope).toBe('city_wide');
    expect(p.comps.items).toHaveLength(1);
    expect(p.risk_flags).toHaveLength(1);
    expect(p.risk_flags[0].severity).toBe('high');
    expect(p.risk_flags[0].source).toBe('ai_detector');
    expect(p.dd_items).toHaveLength(1);
    expect(p.dd_items[0].item).toBe('EC verification');
    expect(p.approval_items).toHaveLength(1);
    expect(p.approval_items[0].name).toBe('RERA registration');
    // The deterministic trust posture is always part of the payload.
    expect(p.verification).toBeDefined();
    expect(p.verification.reliedCompCount).toBe(0);
  });

  test('keeps payload skeleton when supplementary tables empty', async () => {
    mockQueriesInOrder([
      { rows: [{ id: 'd2', name: 'Empty Deal', stage: 'sourced', city: 'Bengaluru' }] },
      { rows: [] }, // no financials
      { rows: [] }, // no scenarios
      { rows: [] }, // no benchmarks
      { rows: [] }, // no comps
      { rows: [] }, // no txns
      { rows: [] }, // no risks
      { rows: [] }, // no dd
      { rows: [] }, // no approvals
    ]);
    const r = await icMemo.buildIcMemoInput('d2');
    expect(r.error).toBeUndefined();
    expect(r.payload.financials).toBeNull();
    expect(r.payload.risk_flags).toEqual([]);
    expect(r.payload.dd_items).toEqual([]);
    expect(r.payload.approval_items).toEqual([]);
    expect(r.payload.scenarios).toEqual([]);
  });
});

describe('buildVerificationContext', () => {
  test('composes the deterministic trust posture from the signal services', async () => {
    modelConfidenceService.getModelConfidence.mockResolvedValueOnce({
      available: true,
      confidencePct: 60,
      band: 'mixed',
      dealSetCount: 6,
      total: 10,
    });
    riskRadarService.getRiskRadar.mockResolvedValueOnce({
      overall_posture: 'flagged',
      categories: [
        { label: 'Title & Ownership', posture: 'flagged' },
        { label: 'Market & Demand', posture: 'unverified' },
        { label: 'Financial', posture: 'cleared' },
      ],
    });
    promoterProfileService.getProfileWithAssessment.mockResolvedValueOnce({
      profile: { promoter_name: 'Prestige' },
      assessment: { posture: 'unverified', summary: { recorded: true } },
    });
    compRelianceService.listReliedCompIds.mockResolvedValueOnce(['c1', 'c2', 'c3']);

    const v = await icMemo.buildVerificationContext('d1');

    expect(v.modelConfidence).toEqual({
      confidencePct: 60,
      band: 'mixed',
      dealSetCount: 6,
      total: 10,
    });
    expect(v.riskRadar.overallPosture).toBe('flagged');
    expect(v.riskRadar.flagged).toEqual(['Title & Ownership']);
    expect(v.riskRadar.unverified).toEqual(['Market & Demand']);
    expect(v.promoter).toEqual({ posture: 'unverified', recorded: true });
    expect(v.reliedCompCount).toBe(3);
  });

  test('degrades a failing signal to null without breaking the others', async () => {
    modelConfidenceService.getModelConfidence.mockRejectedValueOnce(new Error('boom'));
    riskRadarService.getRiskRadar.mockRejectedValueOnce(new Error('boom'));
    compRelianceService.listReliedCompIds.mockResolvedValueOnce(['c1']);

    const v = await icMemo.buildVerificationContext('d1');

    expect(v.modelConfidence).toBeNull();
    expect(v.riskRadar).toBeNull();
    expect(v.reliedCompCount).toBe(1);
  });
});

describe('generate', () => {
  test('returns reason when OpenAI not configured', async () => {
    // Post 2026-05-11: reasoning routes through OpenAI (GPT-5.4) by default.
    // The gate checks `getProviderAvailability().gpt_compatible` and the
    // error message references OPENAI_API_KEY.
    getProviderAvailability.mockReturnValueOnce({ claude: false, gpt_compatible: false });
    const r = await icMemo.generate('d1');
    expect(r.memo).toBeNull();
    expect(r.reason).toMatch(/OPENAI_API_KEY/);
  });

  test('returns deal-not-found error when deal missing', async () => {
    getProviderAvailability.mockReturnValueOnce({ claude: true, gpt_compatible: true });
    mockQueriesInOrder([{ rows: [] }]);
    const r = await icMemo.generate('missing');
    expect(r.memo).toBeNull();
    expect(r.reason).toBe('Deal not found');
  });
});

describe('SYSTEM_PROMPT', () => {
  test('mandates 8-section IC memo structure', () => {
    const p = icMemo.SYSTEM_PROMPT;
    expect(p).toMatch(/Executive Summary/);
    expect(p).toMatch(/Deal Snapshot/);
    expect(p).toMatch(/Investment Thesis/);
    expect(p).toMatch(/Underwriting Highlights/);
    expect(p).toMatch(/Risk Register/);
    expect(p).toMatch(/DD Status/);
    expect(p).toMatch(/Required Approvals/);
    expect(p).toMatch(/Recommendation/);
  });

  test('forbids fabrication and mandates grounded numbers', () => {
    const p = icMemo.SYSTEM_PROMPT;
    expect(p).toMatch(/do not invent/i);
    expect(p).toMatch(/from the supplied data/i);
  });

  test('instructs the author to honour the deterministic verification block', () => {
    const p = icMemo.SYSTEM_PROMPT;
    expect(p).toMatch(/verification/i);
    expect(p).toMatch(/Risk Radar/i);
  });

  // Three of four stored production memos reproduced the prompt's own worked
  // example — "₹ 18,500/sqft ... Whitefield Q1 benchmark of ₹ 16,000–19,000" —
  // as if it were this deal's underwriting basis and market support. The
  // fabricated ceiling (₹19,000) sat ABOVE the real recorded Whitefield ceiling,
  // so an invented rate read as market-supported. No concrete figure may appear
  // in an instruction the model is asked to imitate.
  test('carries no concrete figures the model could copy as this deal\'s data', () => {
    const p = icMemo.SYSTEM_PROMPT;
    expect(p).not.toMatch(/18,?500/);
    expect(p).not.toMatch(/16,?000\s*[–-]\s*19,?000/);
    expect(p).not.toMatch(/Whitefield/i);
    // The §4 example must be a placeholder shape, not a filled-in one.
    expect(p).toMatch(/<rate>\/sqft/);
    expect(p).toMatch(/<micro-market>/);
  });

  test('binds evidence to this site and forbids naming unsupplied markets', () => {
    const p = icMemo.SYSTEM_PROMPT;
    expect(p).toMatch(/marketBenchmarks\.items/);
    expect(p).toMatch(/comps\.items/);
    expect(p).toMatch(/UNRECORDED, never SUPPORTIVE/);
    expect(p).toMatch(/assetClassMatch/);
    expect(p).toMatch(/Not yet modelled/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Evidence posture — comps and benchmarks must belong to THIS site
// ──────────────────────────────────────────────────────────────────────────

describe('buildCompsPosture', () => {
  const near = (over = {}) => ({
    project_name: 'Mahindra Blossom', locality: 'Whitefield', rate_per_sqft: 15500,
    project_type: 'residential', distance_km: 0.43, is_verified: true, ...over,
  });

  test('proximity comps are recorded, carry distance, and win over the city set', () => {
    const out = icMemo.buildCompsPosture([near()], [{ project_name: 'Far Tower' }], 'residential');
    expect(out.recorded).toBe(true);
    expect(out.scope).toBe('nearby');
    expect(out.items[0].distanceKm).toBe(0.4);
    expect(out.items[0].assetClassMatch).toBe(true);
    expect(out.items.some((c) => c.project === 'Far Tower')).toBe(false);
  });

  // Hopefarm's real shape: commercial_office deal, every nearby comp residential.
  // A hard asset-class filter would have emptied the one deal with the best
  // local evidence — so the mismatch is carried as a LABEL, not a filter.
  test('an asset-class mismatch is labelled, never filtered out', () => {
    const out = icMemo.buildCompsPosture([near()], [], 'commercial');
    expect(out.recorded).toBe(true);
    expect(out.items[0].assetClassMatch).toBe(false);
  });

  // Jigani: zero comps within 10 km.
  test('no comps anywhere is recorded:false, not an empty array', () => {
    const out = icMemo.buildCompsPosture([], [], 'residential');
    expect(out.recorded).toBe(false);
    expect(out.items).toEqual([]);
    expect(out.reason).toMatch(/no comparable transactions/i);
  });

  test('city fallback is explicitly NOT this site\'s evidence', () => {
    const out = icMemo.buildCompsPosture([], [{ project_name: 'Indiranagar Lux', rate_per_sqft: 28000 }], 'residential');
    expect(out.recorded).toBe(false);
    expect(out.scope).toBe('city_wide');
    expect(out.reason).toMatch(/must not be cited as evidence/i);
    expect(out.items).toHaveLength(1);
  });
});

describe('buildMarketBenchmarkPosture', () => {
  const rows = [
    { micro_market: 'Indiranagar', avg_price_min_per_sqft: 24000, avg_price_max_per_sqft: 30000, yoy_growth_min_pct: 9, yoy_growth_max_pct: 12, anchor_hub: 'CBD' },
    { micro_market: 'Whitefield', avg_price_min_per_sqft: 14000, avg_price_max_per_sqft: 17800, yoy_growth_min_pct: 8, yoy_growth_max_pct: 12, anchor_hub: 'ITPL' },
  ];

  test('matches the deal\'s own locality, not the priciest market', () => {
    const out = icMemo.buildMarketBenchmarkPosture(rows, { locality: 'Whitefield', city: 'Bengaluru' });
    expect(out.recorded).toBe(true);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].microMarket).toBe('Whitefield');
  });

  test('an unmatched locality yields recorded:false — never the city top-6', () => {
    const out = icMemo.buildMarketBenchmarkPosture(rows, { locality: 'Jigani', city: 'Bengaluru' });
    expect(out.recorded).toBe(false);
    expect(out.items).toEqual([]);
    expect(out.reason).toMatch(/no micro-market benchmark/i);
  });

  test('a deal with no locality says so rather than guessing', () => {
    const out = icMemo.buildMarketBenchmarkPosture(rows, {});
    expect(out.recorded).toBe(false);
    expect(out.reason).toMatch(/no locality recorded/i);
  });
});

describe('buildAssumptionSlice', () => {
  test('carries only whitelisted, numeric, stored inputs', () => {
    const out = icMemo.buildAssumptionSlice({
      sellingRatePerSqft: '7500', exitCapRate: 8.5, notes: 'ignore me', someLegacyKey: 42,
    });
    expect(out.recorded).toBe(true);
    expect(out.sellingRatePerSqft).toBe(7500);
    expect(out.exitCapRate).toBe(8.5);
    expect(out.notes).toBeUndefined();
    expect(out.someLegacyKey).toBeUndefined();
  });

  test('an empty model is recorded:false so §4 writes "Not yet modelled"', () => {
    expect(icMemo.buildAssumptionSlice({}).recorded).toBe(false);
    expect(icMemo.buildAssumptionSlice({ notes: 'x' }).recorded).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Computation reference footer — the credibility anchor
// ──────────────────────────────────────────────────────────────────────────
// The IC memo is the decision artifact; it now carries the same signed kernel
// computation reference the Audit tab and the DOCX/XLSX/PPTX exports quote.
// The reference is appended DETERMINISTICALLY after the model writes the memo,
// never handed to the LLM — a model asked to reproduce a hex id would drift it.

describe('composeComputationFooter', () => {
  const REF = {
    ref: 'kernel-v2 · 7f3a91c4e2b8 · 2026-07-20',
    signed: true,
    sensitivity_may_be_newer: false,
  };

  test('stamps the exact reference string verbatim (no drift is possible)', () => {
    const footer = icMemo.composeComputationFooter(REF);
    expect(footer).toContain('kernel-v2 · 7f3a91c4e2b8 · 2026-07-20');
    // The whole reference travels as one literal — nothing reformats the hex.
    expect(footer).toContain('`kernel-v2 · 7f3a91c4e2b8 · 2026-07-20`');
  });

  test('scopes the claim to the signed figures only — never "every number"', () => {
    const footer = icMemo.composeComputationFooter(REF);
    expect(footer).toMatch(/returns, cost, revenue and area figures/i);
    // Must NOT over-claim coverage of the whole memo.
    expect(footer).not.toMatch(/every number/i);
    expect(footer).not.toMatch(/all figures/i);
  });

  test('says "signed" only when the signing key is available', () => {
    expect(icMemo.composeComputationFooter({ ...REF, signed: true }))
      .toMatch(/cryptographically signed/i);
    expect(icMemo.composeComputationFooter({ ...REF, signed: false }))
      .not.toMatch(/signed/i);
  });

  test('discloses when the sensitivity analysis may post-date the computation', () => {
    const withSens = icMemo.composeComputationFooter({ ...REF, sensitivity_may_be_newer: true });
    expect(withSens).toMatch(/sensitivity analysis was re-run/i);
    const withoutSens = icMemo.composeComputationFooter({ ...REF, sensitivity_may_be_newer: false });
    expect(withoutSens).not.toMatch(/sensitivity analysis was re-run/i);
  });

  test('emits NOTHING when the deal has no committed computation', () => {
    expect(icMemo.composeComputationFooter(null)).toBe('');
    expect(icMemo.composeComputationFooter({ ref: null })).toBe('');
    expect(icMemo.composeComputationFooter({})).toBe('');
  });

  test('renders as a markdown rule + italic footnote, separated from the body', () => {
    const footer = icMemo.composeComputationFooter(REF);
    expect(footer.startsWith('\n\n---\n\n')).toBe(true);
    expect(footer).toMatch(/^\n\n---\n\n\*.*\*\n$/s);
  });
});
