'use strict';

/**
 * Unit tests for bestUseSimulator.service.js — Phase 2 / Pillar 2.
 *
 * The simulator is deterministic, so every test pins exact scoring behaviour
 * for documented sub-scorers. Mocks the micro-market service so we don't
 * touch the database.
 */

jest.mock('../src/services/microMarketIntelligence.service', () => ({
  classifyParcel: jest.fn(),
  getBriefing: jest.fn(),
}));

const microMarket = require('../src/services/microMarketIntelligence.service');
const sim = require('../src/services/bestUseSimulator.service');

beforeEach(() => jest.clearAllMocks());

// ─── Fixtures ──────────────────────────────────────────────────────────────

const WHITEFIELD = {
  locality_code: 'whitefield-east-orr',
  name: 'Whitefield (East ORR)',
  tier: 'prime',
  parent_zone: 'East Bengaluru',
};

const RESIDENTIAL_BENCHMARKS = [
  {
    locality_code: 'whitefield-east-orr',
    asset_class: 'residential_apartments',
    metric_kind: 'sale_rate_per_sqft_inr',
    p25: 11200,
    p50: 12100,
    p75: 13000,
    p95: 14500,
    confidence: 'high',
    source_ref: 'Knight Frank Q1 2026',
  },
  {
    locality_code: 'whitefield-east-orr',
    asset_class: 'residential_apartments',
    metric_kind: 'absorption_quarters',
    p25: 1.5,
    p50: 1.6,
    p75: 1.8,
    p95: 2.0,
    confidence: 'high',
    source_ref: 'Knight Frank Q1 2026',
  },
  {
    locality_code: 'whitefield-east-orr',
    asset_class: 'residential_apartments',
    metric_kind: 'absorption_pressure',
    p25: null,
    p50: 0.95,
    p75: null,
    p95: null,
    confidence: 'high',
    source_ref: 'Knight Frank Q1 2026',
  },
  {
    locality_code: 'whitefield-east-orr',
    asset_class: 'residential_apartments',
    metric_kind: 'price_yoy_pct',
    p25: null,
    p50: 8.0,
    p75: null,
    p95: null,
    confidence: 'high',
    source_ref: 'Knight Frank Q1 2026',
  },
];

const RESIDENTIAL_SIGNALS = [
  {
    locality_code: 'whitefield-east-orr',
    asset_class: 'residential_apartments',
    signal_kind: 'demand_buyer_segment',
    value_text: 'IT professionals 60%, NRI 20%, investor 20%',
    confidence: 'medium',
    source_ref: 'ANAROCK Q1 2026 buyer survey',
  },
];

// ─── Sub-scorer pins ───────────────────────────────────────────────────────

describe('scoreDemandFit', () => {
  test('zero benchmarks → zero score', () => {
    const out = sim.scoreDemandFit({ benchmarksForClass: [] });
    expect(out.score).toBe(0);
    expect(out.of).toBe(30);
    expect(out.signal).toMatch(/no demand benchmarks/);
  });

  test('a single benchmark → 8 of 30', () => {
    const out = sim.scoreDemandFit({ benchmarksForClass: [RESIDENTIAL_BENCHMARKS[0]] });
    expect(out.score).toBe(8);
    expect(out.signal).toMatch(/1 published benchmark/);
  });

  test('three benchmarks → 18 of 30', () => {
    const out = sim.scoreDemandFit({ benchmarksForClass: RESIDENTIAL_BENCHMARKS.slice(0, 3) });
    expect(out.score).toBe(18 + 5); // 18 baseline + 5 favorable absorption pressure
    expect(out.signal).toMatch(/3 published benchmarks/);
    expect(out.signal).toMatch(/absorption pressure 0.95/);
  });

  test('absorption pressure > 1.15 surfaces an oversupply warning', () => {
    const out = sim.scoreDemandFit({
      benchmarksForClass: [
        { ...RESIDENTIAL_BENCHMARKS[0] },
        {
          asset_class: 'residential_apartments',
          metric_kind: 'absorption_pressure',
          p50: 1.25,
        },
      ],
    });
    expect(out.signal).toMatch(/oversupply risk/);
  });

  test('caps at 30', () => {
    // 6+ benchmarks gives 25; if absorption is favorable, +5 → exactly 30. No overflow.
    const big = Array.from({ length: 10 }, () => ({ metric_kind: 'random' }));
    big.push({ metric_kind: 'absorption_pressure', p50: 0.8 });
    const out = sim.scoreDemandFit({ benchmarksForClass: big });
    expect(out.score).toBeLessThanOrEqual(30);
  });
});

describe('scorePriceRealisability', () => {
  test('no headline metric → 0 of 25 with honest message', () => {
    const out = sim.scorePriceRealisability({
      profile: sim.ASSET_CLASS_PROFILES.residential_apartments,
      benchmarksForClass: [],
    });
    expect(out.score).toBe(0);
    expect(out.signal).toMatch(/no sale rate benchmark/);
  });

  test('tight band + high confidence → near-max', () => {
    const out = sim.scorePriceRealisability({
      profile: sim.ASSET_CLASS_PROFILES.residential_apartments,
      benchmarksForClass: [RESIDENTIAL_BENCHMARKS[0]],
    });
    // sale_rate p50 12100, p25 11200, p75 13000 → bandWidth = 1800/12100 ≈ 0.149
    // 15 baseline + 7 (tight band) + 3 (high confidence) = 25
    expect(out.score).toBe(25);
    expect(out.signal).toMatch(/sale rate p50 ₹12,100/);
    expect(out.signal).toMatch(/band tight/);
  });

  test('wide band keeps score lower', () => {
    const wide = {
      asset_class: 'residential_apartments',
      metric_kind: 'sale_rate_per_sqft_inr',
      p25: 8000,
      p50: 12000,
      p75: 18000,
      confidence: 'low',
    };
    const out = sim.scorePriceRealisability({
      profile: sim.ASSET_CLASS_PROFILES.residential_apartments,
      benchmarksForClass: [wide],
    });
    // 15 baseline + 0 band + 0 confidence = 15
    expect(out.score).toBe(15);
    expect(out.signal).toMatch(/band wide/);
  });
});

describe('scoreGrowth', () => {
  test('strong YoY + buyer-segment signal → 15 of 15', () => {
    const out = sim.scoreGrowth({
      benchmarksForClass: [{ metric_kind: 'price_yoy_pct', p50: 12 }],
      signalsForClass: [{ signal_kind: 'demand_buyer_segment', value_text: 'IT 60%' }],
    });
    expect(out.score).toBe(15);
  });

  test('declining YoY surfaces in the rationale', () => {
    const out = sim.scoreGrowth({
      benchmarksForClass: [{ metric_kind: 'price_yoy_pct', p50: -3 }],
      signalsForClass: [],
    });
    expect(out.score).toBe(0);
    expect(out.signal).toMatch(/declining/);
  });

  test('no signal → 0 of 15 with honest message', () => {
    const out = sim.scoreGrowth({ benchmarksForClass: [], signalsForClass: [] });
    expect(out.score).toBe(0);
    expect(out.signal).toMatch(/no growth signal/);
  });
});

describe('scoreApprovalRisk', () => {
  test('shorter pipeline → higher score', () => {
    const fast = sim.scoreApprovalRisk({
      profile: sim.ASSET_CLASS_PROFILES.retail, // 7 months
    });
    const slow = sim.scoreApprovalRisk({
      profile: sim.ASSET_CLASS_PROFILES.hospitality, // 16 months
    });
    expect(fast.score).toBeGreaterThan(slow.score);
    expect(fast.signal).toMatch(/7-month/);
    expect(slow.signal).toMatch(/16-month/);
  });

  test('clamps to [0, 15]', () => {
    const out = sim.scoreApprovalRisk({ profile: { approval_months: 30, approval_summary: 'absurd' } });
    expect(out.score).toBeGreaterThanOrEqual(0);
  });
});

describe('scoreCapitalIntensity', () => {
  test('lower per-sqft cost → higher score', () => {
    const cheap = sim.scoreCapitalIntensity({
      profile: sim.ASSET_CLASS_PROFILES.industrial_warehousing, // 2200/sqft
      tier: 'secondary',
    });
    const expensive = sim.scoreCapitalIntensity({
      profile: sim.ASSET_CLASS_PROFILES.hospitality, // 6500/sqft
      tier: 'secondary',
    });
    expect(cheap.score).toBeGreaterThan(expensive.score);
  });

  test('premium tier loads the cost upward (lower score)', () => {
    const premium = sim.scoreCapitalIntensity({
      profile: sim.ASSET_CLASS_PROFILES.commercial_office, // 4500/sqft
      tier: 'premium',
    });
    const emerging = sim.scoreCapitalIntensity({
      profile: sim.ASSET_CLASS_PROFILES.commercial_office,
      tier: 'emerging',
    });
    expect(premium.score).toBeLessThan(emerging.score);
  });
});

// ─── Verdict + band dictionary ─────────────────────────────────────────────

describe('verdictFor / bandFor', () => {
  test('verdict thresholds follow the closed dictionary', () => {
    expect(sim.verdictFor(85)).toBe('Recommend');
    expect(sim.verdictFor(70)).toBe('Consider');
    expect(sim.verdictFor(45)).toBe('Re-examine');
    expect(sim.verdictFor(20)).toBe('Stress-test');
    expect(sim.verdictFor(5)).toBe('Flag');
  });

  test('every verdict is in the closed dictionary', () => {
    [0, 14, 15, 34, 35, 54, 55, 74, 75, 100].forEach((s) => {
      expect(sim.VERDICT_DICT).toContain(sim.verdictFor(s));
    });
  });

  test('bands match tiers', () => {
    expect(sim.bandFor(75)).toBe('high');
    expect(sim.bandFor(50)).toBe('medium');
    expect(sim.bandFor(30)).toBe('low');
  });
});

// ─── Composer (full asset-class score) ─────────────────────────────────────

describe('scoreAssetClass', () => {
  test('Whitefield + residential_apartments → high band with full rationale', () => {
    const out = sim.scoreAssetClass({
      assetClass: 'residential_apartments',
      locality: WHITEFIELD,
      benchmarks: RESIDENTIAL_BENCHMARKS,
      demandSignals: RESIDENTIAL_SIGNALS,
    });
    expect(out.asset_class).toBe('residential_apartments');
    expect(out.label).toBe('Residential Apartments');
    expect(out.score).toBeGreaterThanOrEqual(60);
    expect(['high', 'medium']).toContain(out.band);
    expect(out.rationale).toHaveLength(3);
    expect(out.rationale[0]).toMatch(/Whitefield/);
    expect(out.factors.demand_fit.of).toBe(30);
    expect(out.factors.price_realisability.of).toBe(25);
    expect(out.factors.growth_signal.of).toBe(15);
    expect(out.factors.approval_risk.of).toBe(15);
    expect(out.factors.capital_intensity.of).toBe(15);
  });

  test('locality without matching benchmarks → low band, honest rationale', () => {
    const out = sim.scoreAssetClass({
      assetClass: 'industrial_warehousing',
      locality: WHITEFIELD,
      benchmarks: RESIDENTIAL_BENCHMARKS, // none for industrial
      demandSignals: [],
    });
    expect(out.score).toBeLessThanOrEqual(45); // no demand, no price, no growth → mostly factors 4+5
    expect(['low', 'medium']).toContain(out.band);
    expect(out.factors.demand_fit.score).toBe(0);
    expect(out.factors.price_realisability.score).toBe(0);
  });

  test('unknown asset class → null', () => {
    expect(
      sim.scoreAssetClass({
        assetClass: 'not_a_class',
        locality: WHITEFIELD,
        benchmarks: [],
        demandSignals: [],
      })
    ).toBeNull();
  });
});

// ─── scoreFromBriefing (pure composer, used by the workspace) ──────────────

describe('scoreFromBriefing', () => {
  test('empty briefing → empty scores with honest reason', () => {
    expect(sim.scoreFromBriefing(null)).toEqual({ scores: [], reason: 'no_locality' });
    expect(sim.scoreFromBriefing({ locality: null, benchmarks: [], demand_signals: [] })).toEqual({
      scores: [],
      reason: 'no_locality',
    });
  });

  test('scores all 7 core asset classes and sorts desc', () => {
    const out = sim.scoreFromBriefing({
      locality: WHITEFIELD,
      benchmarks: RESIDENTIAL_BENCHMARKS,
      demand_signals: RESIDENTIAL_SIGNALS,
    });
    expect(out.scores).toHaveLength(7);
    expect(out.scores.map((s) => s.asset_class)).toEqual(expect.arrayContaining(sim.CORE_ASSET_CLASSES));
    // Sorted desc
    for (let i = 1; i < out.scores.length; i += 1) {
      expect(out.scores[i].score).toBeLessThanOrEqual(out.scores[i - 1].score);
    }
    // Residential should rank highest given the fixture
    expect(out.scores[0].asset_class).toBe('residential_apartments');
  });
});

// ─── simulateFromCoordinates (full I/O wrapper) ────────────────────────────

describe('simulateFromCoordinates', () => {
  test('invalid coordinates → empty with no_coordinates reason', async () => {
    const out = await sim.simulateFromCoordinates(null, null);
    expect(out.reason).toBe('no_coordinates');
    expect(out.scores).toEqual([]);
    expect(microMarket.classifyParcel).not.toHaveBeenCalled();
  });

  test('no micro-market match → empty with no_micro_market_match', async () => {
    microMarket.classifyParcel.mockResolvedValueOnce({
      locality_code: null,
      name: null,
      distance_km: null,
      tier: null,
      confidence: null,
    });
    const out = await sim.simulateFromCoordinates(12.9, 77.5);
    expect(out.reason).toBe('no_micro_market_match');
    expect(out.scores).toEqual([]);
  });

  test('match → returns ranked scores', async () => {
    microMarket.classifyParcel.mockResolvedValueOnce({
      locality_code: WHITEFIELD.locality_code,
      name: WHITEFIELD.name,
      distance_km: 0.5,
      tier: WHITEFIELD.tier,
      confidence: 'high',
    });
    microMarket.getBriefing.mockResolvedValueOnce({
      locality: WHITEFIELD,
      benchmarks: RESIDENTIAL_BENCHMARKS,
      demand_signals: RESIDENTIAL_SIGNALS,
    });
    const out = await sim.simulateFromCoordinates(12.9716, 77.7499);
    expect(out.reason).toBeNull();
    expect(out.scores).toHaveLength(7);
    expect(out.classification.confidence).toBe('high');
  });
});
