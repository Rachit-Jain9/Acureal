'use strict';

/**
 * Unit tests for dealStructureRecommender.service.js — P2 / Pillar 3 (first half).
 *
 * The recommender is deterministic, so every test pins exact scoring behaviour
 * + the closed verb dictionary + the hard floor for invalid (asset_class,
 * structure) pairs.
 */

jest.mock('../src/services/microMarketIntelligence.service', () => ({
  classifyParcel: jest.fn(),
  getBriefing: jest.fn(),
}));
jest.mock('../src/services/promoterProfile.service', () => ({
  getProfileWithAssessment: jest.fn(),
}));

const microMarket = require('../src/services/microMarketIntelligence.service');
const promoterProfile = require('../src/services/promoterProfile.service');
const recommender = require('../src/services/dealStructureRecommender.service');

beforeEach(() => jest.clearAllMocks());

// ─── Fixtures ──────────────────────────────────────────────────────────────

const WHITEFIELD_TIGHT = {
  locality: { locality_code: 'whitefield-east-orr', name: 'Whitefield (East ORR)', tier: 'prime' },
  benchmarks: [
    { asset_class: 'residential_apartments', metric_kind: 'absorption_pressure', p50: 0.92 },
    { asset_class: 'residential_apartments', metric_kind: 'price_yoy_pct', p50: 10 },
  ],
  demand_signals: [],
};

const WHITEFIELD_OVERSUPPLY = {
  locality: { locality_code: 'whitefield-east-orr', name: 'Whitefield (East ORR)', tier: 'prime' },
  benchmarks: [
    { asset_class: 'residential_apartments', metric_kind: 'absorption_pressure', p50: 1.25 },
    { asset_class: 'residential_apartments', metric_kind: 'price_yoy_pct', p50: -2 },
  ],
  demand_signals: [],
};

// ─── Sub-scorer / market posture ───────────────────────────────────────────

describe('scoreMarketPosture', () => {
  test('tight market boosts outright', () => {
    const tight = recommender.scoreMarketPosture({
      structure: 'outright',
      microMarket: WHITEFIELD_TIGHT,
      assetClass: 'residential_apartments',
    });
    expect(tight.score).toBeGreaterThan(8); // baseline
    expect(tight.signal).toMatch(/tight market/);
  });

  test('tight market penalises revenue_share', () => {
    const out = recommender.scoreMarketPosture({
      structure: 'revenue_share',
      microMarket: WHITEFIELD_TIGHT,
      assetClass: 'residential_apartments',
    });
    expect(out.score).toBeLessThan(8); // below baseline — losing upside
    expect(out.signal).toMatch(/leaves money on the table/);
  });

  test('oversupply boosts revenue_share', () => {
    const out = recommender.scoreMarketPosture({
      structure: 'revenue_share',
      microMarket: WHITEFIELD_OVERSUPPLY,
      assetClass: 'residential_apartments',
    });
    expect(out.score).toBeGreaterThan(8);
    expect(out.signal).toMatch(/oversupply/);
  });

  test('oversupply penalises outright', () => {
    const out = recommender.scoreMarketPosture({
      structure: 'outright',
      microMarket: WHITEFIELD_OVERSUPPLY,
      assetClass: 'residential_apartments',
    });
    expect(out.score).toBeLessThan(8);
    expect(out.signal).toMatch(/oversupply/);
  });

  test('no micro-market data → neutral score', () => {
    const out = recommender.scoreMarketPosture({
      structure: 'outright',
      microMarket: null,
      assetClass: 'residential_apartments',
    });
    expect(out.score).toBe(8);
    expect(out.signal).toMatch(/neutral/);
  });
});

// ─── scoreStructure (full one-structure pin) ───────────────────────────────

describe('scoreStructure', () => {
  test('residential_apartments + outright + cleared promoter + tight market → Recommend', () => {
    const out = recommender.scoreStructure({
      structure: 'outright',
      assetClass: 'residential_apartments',
      promoterPosture: 'cleared',
      microMarket: WHITEFIELD_TIGHT,
    });
    expect(out.deal_structure).toBe('outright');
    expect(out.label).toBe('Outright');
    expect(out.verdict).toBe('Recommend');
    expect(out.band).toBe('high');
    expect(out.score).toBeGreaterThanOrEqual(70);
    expect(out.factors.structural_validity.score).toBe(25);
    expect(out.factors.promoter_compatibility.score).toBe(25);
  });

  test('residential_apartments + outright + flagged promoter → not Recommend', () => {
    const out = recommender.scoreStructure({
      structure: 'outright',
      assetClass: 'residential_apartments',
      promoterPosture: 'flagged',
      microMarket: WHITEFIELD_TIGHT,
    });
    // Flagged promoter row says outright = 5 → total drops well below 75
    expect(out.verdict).not.toBe('Recommend');
    expect(out.factors.promoter_compatibility.score).toBe(5);
  });

  test('residential_apartments + revenue_share + flagged + oversupply → Consider or better', () => {
    const out = recommender.scoreStructure({
      structure: 'revenue_share',
      assetClass: 'residential_apartments',
      promoterPosture: 'flagged',
      microMarket: WHITEFIELD_OVERSUPPLY,
    });
    // Escrow waterfall protects + oversupply favours revenue_share + structural valid
    expect(out.score).toBeGreaterThanOrEqual(55);
    expect(['Recommend', 'Consider']).toContain(out.verdict);
  });

  test('invalid pair (hospitality + area_share) is hard-floored at Flag', () => {
    const out = recommender.scoreStructure({
      structure: 'area_share',
      assetClass: 'hospitality',
      promoterPosture: 'cleared',
      microMarket: null,
    });
    expect(out.factors.structural_validity.score).toBe(0);
    expect(out.score).toBeLessThan(15);
    expect(out.verdict).toBe('Flag');
    expect(out.rationale[0]).toMatch(/Hotel keys cannot be sliced/);
  });

  test('invalid pair (plotted_development + ground_lease) hard-floor still applies even with great other factors', () => {
    const out = recommender.scoreStructure({
      structure: 'ground_lease',
      assetClass: 'plotted_development',
      promoterPosture: 'cleared',
      microMarket: WHITEFIELD_TIGHT,
    });
    expect(out.verdict).toBe('Flag');
    expect(out.factors.structural_validity.score).toBe(0);
  });

  test('unknown structure → null', () => {
    expect(
      recommender.scoreStructure({
        structure: 'not_a_structure',
        assetClass: 'residential_apartments',
        promoterPosture: 'cleared',
        microMarket: null,
      })
    ).toBeNull();
  });

  // ─── Rationale composition (PR rationale rewrite) ────────────────────────
  // Pins the new behaviour: each row's rationale leads with the structure
  // description, then surfaces a deal-specific score driver, then closes
  // with the promoter callout. No generic templates.

  test('rationale leads with the structure one-liner', () => {
    const out = recommender.scoreStructure({
      structure: 'ground_lease',
      assetClass: 'commercial_office',
      promoterPosture: 'cleared',
      microMarket: null,
    });
    expect(out.rationale[0]).toMatch(/lease/i);
  });

  test('rationale surfaces capital-efficiency standout when market is silent', () => {
    // ground_lease has capital_efficiency 20/20 (max). With no micro-market,
    // the score-driver picker should pull the capital-efficiency signal.
    const out = recommender.scoreStructure({
      structure: 'ground_lease',
      assetClass: 'commercial_office',
      promoterPosture: 'cleared',
      microMarket: null,
    });
    expect(out.rationale[1]).toMatch(/capital-efficient/i);
  });

  test('rationale surfaces execution standout when market is silent and capital is mid', () => {
    // hybrid has execution_complexity 2/15 (min). With no micro-market and
    // hybrid's capital_efficiency at 12/20 (just above midpoint), the
    // execution-complexity signal should win.
    const out = recommender.scoreStructure({
      structure: 'hybrid',
      assetClass: 'mixed_use',
      promoterPosture: 'cleared',
      microMarket: null,
    });
    expect(out.rationale[1]).toMatch(/bespoke contracts/i);
  });

  test('rationale surfaces market posture when informative', () => {
    const out = recommender.scoreStructure({
      structure: 'outright',
      assetClass: 'residential_apartments',
      promoterPosture: 'cleared',
      microMarket: WHITEFIELD_OVERSUPPLY,
    });
    expect(out.rationale[1]).toMatch(/oversupply/);
  });

  test('promoter callout differs by posture × score tier', () => {
    const cleared = recommender.scoreStructure({
      structure: 'outright',
      assetClass: 'residential_apartments',
      promoterPosture: 'cleared',
      microMarket: null,
    });
    const flagged = recommender.scoreStructure({
      structure: 'outright',
      assetClass: 'residential_apartments',
      promoterPosture: 'flagged',
      microMarket: null,
    });
    expect(cleared.rationale[2]).toMatch(/Cleared promoter/i);
    expect(flagged.rationale[2]).toMatch(/Flagged promoter/i);
    // Both should NOT use the old generic "× X compatibility" wording.
    expect(cleared.rationale[2]).not.toMatch(/× outright compatibility/);
    expect(flagged.rationale[2]).not.toMatch(/× outright compatibility/);
  });

  test('flagged promoter + revenue_share emphasises contained risk', () => {
    // revenue_share for flagged promoter scores 18/25 — workable tier;
    // callout should mention partial protection, not "no protection".
    const out = recommender.scoreStructure({
      structure: 'revenue_share',
      assetClass: 'residential_apartments',
      promoterPosture: 'flagged',
      microMarket: WHITEFIELD_OVERSUPPLY,
    });
    expect(out.rationale[2]).toMatch(/Flagged promoter/i);
    expect(out.rationale[2]).toMatch(/protection/i);
  });

  test('no rationale line ever contains the old generic template', () => {
    // Belt-and-braces: regress-proof the old "X promoter × Y compatibility"
    // template — sweep all 8 structures × 3 postures.
    const postures = ['cleared', 'unverified', 'flagged'];
    postures.forEach((posture) => {
      const out = recommender.scoreFromContext({
        assetClass: 'residential_apartments',
        promoterPosture: posture,
        microMarket: null,
      });
      out.scores.forEach((row) => {
        row.rationale.forEach((line) => {
          expect(line).not.toMatch(/promoter × \w+ compatibility/);
        });
      });
    });
  });
});

// ─── Verdict + band dictionary ─────────────────────────────────────────────

describe('verdictFor / bandFor', () => {
  test('verdict thresholds follow the closed dictionary', () => {
    expect(recommender.verdictFor(90)).toBe('Recommend');
    expect(recommender.verdictFor(60)).toBe('Consider');
    expect(recommender.verdictFor(40)).toBe('Re-examine');
    expect(recommender.verdictFor(20)).toBe('Stress-test');
    expect(recommender.verdictFor(10)).toBe('Flag');
  });

  test('every verdict is in the closed dictionary', () => {
    [0, 14, 15, 34, 35, 54, 55, 74, 75, 100].forEach((s) => {
      expect(recommender.VERDICT_DICT).toContain(recommender.verdictFor(s));
    });
  });
});

// ─── scoreFromContext (pure composer) ──────────────────────────────────────

describe('scoreFromContext', () => {
  test('no asset class → empty with honest reason', () => {
    expect(recommender.scoreFromContext({})).toEqual({ scores: [], reason: 'no_asset_class' });
  });

  test('ranks all 8 structures desc', () => {
    const out = recommender.scoreFromContext({
      assetClass: 'residential_apartments',
      promoterPosture: 'cleared',
      microMarket: WHITEFIELD_TIGHT,
    });
    expect(out.scores).toHaveLength(8);
    expect(out.scores.map((s) => s.deal_structure)).toEqual(
      expect.arrayContaining(recommender.DEAL_STRUCTURES)
    );
    for (let i = 1; i < out.scores.length; i += 1) {
      expect(out.scores[i].score).toBeLessThanOrEqual(out.scores[i - 1].score);
    }
    // With cleared promoter + tight market, outright should top the list
    expect(out.scores[0].deal_structure).toBe('outright');
  });

  test('flagged promoter shifts the top toward revenue_share / profit_share', () => {
    const out = recommender.scoreFromContext({
      assetClass: 'residential_apartments',
      promoterPosture: 'flagged',
      microMarket: WHITEFIELD_OVERSUPPLY,
    });
    expect(['revenue_share', 'profit_share']).toContain(out.scores[0].deal_structure);
    // Outright should rank low under flagged + oversupply
    const outrightEntry = out.scores.find((s) => s.deal_structure === 'outright');
    expect(['Re-examine', 'Stress-test', 'Flag']).toContain(outrightEntry.verdict);
  });

  test('hospitality eliminates area_share via Flag', () => {
    const out = recommender.scoreFromContext({
      assetClass: 'hospitality',
      promoterPosture: 'cleared',
      microMarket: null,
    });
    const areaShareEntry = out.scores.find((s) => s.deal_structure === 'area_share');
    expect(areaShareEntry.verdict).toBe('Flag');
    // Bottom of the list
    expect(areaShareEntry.score).toBeLessThan(15);
  });
});

// ─── recommendForDeal (full I/O wrapper) ───────────────────────────────────

describe('recommendForDeal', () => {
  test('no deal → empty', async () => {
    expect(await recommender.recommendForDeal(null)).toEqual({ scores: [], reason: 'no_deal' });
  });

  test('no asset class → empty', async () => {
    expect(await recommender.recommendForDeal({ id: 'd1' })).toEqual({
      scores: [],
      reason: 'no_asset_class',
    });
  });

  test('deal with coordinates → loads micro-market + promoter posture', async () => {
    promoterProfile.getProfileWithAssessment.mockResolvedValueOnce({
      profile: { promoter_name: 'Prestige' },
      assessment: { posture: 'cleared' },
      rera: {},
    });
    microMarket.classifyParcel.mockResolvedValueOnce({
      locality_code: 'whitefield-east-orr',
      name: 'Whitefield',
      tier: 'prime',
    });
    microMarket.getBriefing.mockResolvedValueOnce(WHITEFIELD_TIGHT);

    const out = await recommender.recommendForDeal({
      id: 'd1',
      asset_class: 'residential_apartments',
      property_lat: 12.97,
      property_lng: 77.75,
    });
    expect(out.scores).toHaveLength(8);
    expect(out.scores[0].deal_structure).toBe('outright');
    expect(promoterProfile.getProfileWithAssessment).toHaveBeenCalledWith('d1');
  });

  test('deal without coordinates falls back to no-microMarket scoring', async () => {
    promoterProfile.getProfileWithAssessment.mockResolvedValueOnce({
      profile: null,
      assessment: { posture: 'unverified' },
      rera: {},
    });
    const out = await recommender.recommendForDeal({
      id: 'd2',
      asset_class: 'commercial_office',
    });
    expect(out.scores).toHaveLength(8);
    expect(microMarket.classifyParcel).not.toHaveBeenCalled();
  });
});
