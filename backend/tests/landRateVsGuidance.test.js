'use strict';

/**
 * Land-rate-vs-guidance — full-stack unit coverage (Workstream 1, 2026-06-13).
 *
 * Covers the four layers the feature spans:
 *   1. the deterministic util (derive ₹/sqft + evaluate vs guidance)
 *   2. the signal extractor (extractLandRateVsGuidanceBand)
 *   3. the recommendation rule (land-rate-below-guidance)
 *   4. the Deal Doctor diagnostic twin (land-rate-below-guidance-benchmark)
 */

const {
  evaluateLandRateVsGuidance,
  deriveAssumedLandRatePerSqft,
  MATERIAL_SHORTFALL_THRESHOLD,
} = require('../src/utils/landRateVsGuidance');

const {
  extractLandRateVsGuidanceBand,
  extractAllSignals,
} = require('../src/services/recommendation/signalExtractors');

const { generateRecommendations } = require('../src/services/recommendation/recommendationRules');
const { generateDiagnoses } = require('../src/services/recommendation/dealDoctor');
const recommendationEngine = require('../src/services/recommendation');

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

// A confident, approved guidance match in the shape findGuidanceMatches returns.
const matchedGuidance = (valuePerSqft, overrides = {}) => ({
  status: 'matched',
  confidence: 0.92,
  selected: {
    id: 'gv-1',
    locality: 'Annamma Temple Extension',
    road_name: 'Dhanwanthari Road',
    value_inr_per_sqft: valuePerSqft,
    citation: { id: 'guidance-value-gv-1', source_title: 'IGR Gandhinagara', page: 42 },
    ...overrides.selected,
  },
  ...overrides,
});

const SQFT_PER_ACRE = 43560;

const makeWorkspace = (deal, guidance) => ({ deal, guidance });

// ─────────────────────────────────────────────────────────────────────────────
// 1. Util — deriveAssumedLandRatePerSqft
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveAssumedLandRatePerSqft', () => {
  test('per_sqft basis returns the entered rate directly', () => {
    const rate = deriveAssumedLandRatePerSqft({
      land_pricing_basis: 'per_sqft',
      land_price_rate_inr: 6000,
      land_area_sqft: SQFT_PER_ACRE,
    });
    expect(rate).toBeCloseTo(6000, 2);
  });

  test('per_acre basis converts ₹/acre → ₹/sqft', () => {
    const rate = deriveAssumedLandRatePerSqft({
      land_pricing_basis: 'per_acre',
      land_price_rate_inr: 8000 * SQFT_PER_ACRE, // = ₹8,000/sqft
      land_area_sqft: SQFT_PER_ACRE,
    });
    expect(rate).toBeCloseTo(8000, 2);
  });

  test('total_cr basis derives ₹/sqft from total ÷ area', () => {
    // ₹6 Cr over 5,000 sqft = ₹12,000/sqft.
    const rate = deriveAssumedLandRatePerSqft({
      land_pricing_basis: 'total_cr',
      negotiated_price_cr: 6,
      land_area_sqft: 5000,
    });
    expect(rate).toBeCloseTo(12000, 0);
  });

  test('total_cr prefers negotiated price over ask price', () => {
    const rate = deriveAssumedLandRatePerSqft({
      land_pricing_basis: 'total_cr',
      negotiated_price_cr: 6,
      land_ask_price_cr: 10,
      land_area_sqft: 5000,
    });
    expect(rate).toBeCloseTo(12000, 0); // 6 Cr, not 10 Cr
  });

  test('returns null when nothing can be derived', () => {
    expect(deriveAssumedLandRatePerSqft({})).toBeNull();
    expect(deriveAssumedLandRatePerSqft(null)).toBeNull();
    expect(deriveAssumedLandRatePerSqft({ land_pricing_basis: 'total_cr', negotiated_price_cr: 6 })).toBeNull(); // no area
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Util — evaluateLandRateVsGuidance
// ─────────────────────────────────────────────────────────────────────────────

describe('evaluateLandRateVsGuidance', () => {
  test('fires below_guidance with the right magnitude + severity', () => {
    const e = evaluateLandRateVsGuidance({
      assumedRatePerSqft: 12000,
      guidance: matchedGuidance(20000),
    });
    expect(e.status).toBe('below_guidance');
    expect(e.guidanceValuePerSqft).toBe(20000);
    expect(e.shortfallPct).toBeCloseTo(0.4, 4);
    expect(e.severityHint).toBe(4); // ≥40% below
    expect(e.locality).toBe('Annamma Temple Extension');
    expect(e.citation.page).toBe(42);
  });

  test('mid shortfall (25–40%) → severity 3', () => {
    const e = evaluateLandRateVsGuidance({ assumedRatePerSqft: 14000, guidance: matchedGuidance(20000) });
    expect(e.status).toBe('below_guidance');
    expect(e.shortfallPct).toBeCloseTo(0.3, 4);
    expect(e.severityHint).toBe(3);
  });

  test('shallow shortfall (15–25%) → severity 2', () => {
    const e = evaluateLandRateVsGuidance({ assumedRatePerSqft: 16000, guidance: matchedGuidance(20000) });
    expect(e.status).toBe('below_guidance');
    expect(e.shortfallPct).toBeCloseTo(0.2, 4);
    expect(e.severityHint).toBe(2);
  });

  test('marginal shortfall below the materiality threshold stays silent', () => {
    // 10% below — under the 15% floor.
    const e = evaluateLandRateVsGuidance({ assumedRatePerSqft: 18000, guidance: matchedGuidance(20000) });
    expect(e.status).toBe('within_or_above');
    expect(e.shortfallPct).toBeNull();
  });

  test('at or above guidance → within_or_above (the healthy case)', () => {
    expect(evaluateLandRateVsGuidance({ assumedRatePerSqft: 20000, guidance: matchedGuidance(20000) }).status).toBe('within_or_above');
    expect(evaluateLandRateVsGuidance({ assumedRatePerSqft: 26000, guidance: matchedGuidance(20000) }).status).toBe('within_or_above');
  });

  test('the materiality threshold is inclusive — exactly 15% below fires, 14% stays silent', () => {
    expect(MATERIAL_SHORTFALL_THRESHOLD).toBe(0.15);
    // ₹8,500 vs ₹10,000 = exactly 15% below → material, fires.
    const at = evaluateLandRateVsGuidance({ assumedRatePerSqft: 8500, guidance: matchedGuidance(10000) });
    expect(at.status).toBe('below_guidance');
    // ₹8,600 vs ₹10,000 = 14% below → under the floor, silent.
    const under = evaluateLandRateVsGuidance({ assumedRatePerSqft: 8600, guidance: matchedGuidance(10000) });
    expect(under.status).toBe('within_or_above');
  });

  test('not_evaluated when guidance is not a confident match', () => {
    expect(evaluateLandRateVsGuidance({ assumedRatePerSqft: 12000, guidance: null }).reason).toBe('no_confident_guidance_match');
    expect(evaluateLandRateVsGuidance({ assumedRatePerSqft: 12000, guidance: { status: 'low_confidence', selected: { value_inr_per_sqft: 20000 } } }).reason).toBe('no_confident_guidance_match');
    expect(evaluateLandRateVsGuidance({ assumedRatePerSqft: 12000, guidance: { status: 'not_configured' } }).reason).toBe('no_confident_guidance_match');
  });

  test('not_evaluated when there is no assumed land rate', () => {
    expect(evaluateLandRateVsGuidance({ assumedRatePerSqft: null, guidance: matchedGuidance(20000) }).reason).toBe('no_assumed_land_rate');
    expect(evaluateLandRateVsGuidance({ assumedRatePerSqft: 0, guidance: matchedGuidance(20000) }).reason).toBe('no_assumed_land_rate');
  });

  test('not_evaluated when the matched row carries no usable value', () => {
    const g = matchedGuidance(20000);
    g.selected.value_inr_per_sqft = null;
    expect(evaluateLandRateVsGuidance({ assumedRatePerSqft: 12000, guidance: g }).reason).toBe('no_guidance_value');
  });

  test('never throws on malformed input', () => {
    expect(() => evaluateLandRateVsGuidance()).not.toThrow();
    expect(() => evaluateLandRateVsGuidance({})).not.toThrow();
    expect(evaluateLandRateVsGuidance({}).status).toBe('not_evaluated');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Extractor — extractLandRateVsGuidanceBand
// ─────────────────────────────────────────────────────────────────────────────

describe('extractLandRateVsGuidanceBand', () => {
  const belowDeal = { land_pricing_basis: 'per_sqft', land_price_rate_inr: 12000, land_area_sqft: 5000 };

  test('emits the signal when the deal is materially below guidance', () => {
    const ws = makeWorkspace(belowDeal, matchedGuidance(20000));
    const s = extractLandRateVsGuidanceBand(ws);
    expect(s).not.toBeNull();
    expect(s.kind).toBe('land_rate_vs_guidance');
    expect(s.meta.assumed).toBe(12000);
    expect(s.meta.guidance).toBe(20000);
    expect(s.meta.shortfall_pct).toBeCloseTo(40, 1);
    expect(s.meta.severity_hint).toBe(4);
    // Evidence carries both the deal rate AND the citable official guidance.
    expect(s.evidence).toHaveLength(2);
    expect(s.evidence[0].label).toMatch(/Assumed land rate ₹12,000\/sqft/);
    expect(s.evidence[1].label).toMatch(/Official IGR guidance ₹20,000\/sqft/);
    expect(s.evidence[1].ref).toBe('guidance:guidance-value-gv-1');
  });

  test('returns null when at/above guidance', () => {
    const ws = makeWorkspace({ land_pricing_basis: 'per_sqft', land_price_rate_inr: 24000, land_area_sqft: 5000 }, matchedGuidance(20000));
    expect(extractLandRateVsGuidanceBand(ws)).toBeNull();
  });

  test('returns null when guidance is missing / unconfident', () => {
    expect(extractLandRateVsGuidanceBand(makeWorkspace(belowDeal, null))).toBeNull();
    expect(extractLandRateVsGuidanceBand(makeWorkspace(belowDeal, { status: 'low_confidence', selected: { value_inr_per_sqft: 20000 } }))).toBeNull();
  });

  test('returns null when the land rate cannot be derived', () => {
    expect(extractLandRateVsGuidanceBand(makeWorkspace({}, matchedGuidance(20000)))).toBeNull();
  });

  test('orchestrator includes the signal and never throws', () => {
    const ws = makeWorkspace(belowDeal, matchedGuidance(20000));
    const kinds = extractAllSignals(ws).map((s) => s.kind);
    expect(kinds).toContain('land_rate_vs_guidance');
  });

  test('a workspace without a guidance slice produces no land_rate signal (no regression)', () => {
    const kinds = extractAllSignals({ deal: belowDeal }).map((s) => s.kind);
    expect(kinds).not.toContain('land_rate_vs_guidance');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Recommendation rule — land-rate-below-guidance
// ─────────────────────────────────────────────────────────────────────────────

describe('recommendation rule — land-rate-below-guidance', () => {
  const signal = {
    kind: 'land_rate_vs_guidance',
    value: {},
    evidence: [{ ref: 'deal:land_price_rate', label: 'x' }, { ref: 'guidance:gv', label: 'y' }],
    meta: { assumed: 12000, guidance: 20000, shortfall_pct: 40, locality: 'Annamma Temple Extension', severity_hint: 4 },
  };

  test('emits a land_price / Re-examine card that is AI-narratable', () => {
    const out = generateRecommendations([signal]);
    const card = out.find((r) => r.id === 'land-rate-below-guidance');
    expect(card).toBeTruthy();
    expect(card.topic).toBe('land_price');
    expect(card.verb).toBe('Re-examine');
    expect(card.ai_narratable).toBe(true); // financial/pricing lane, not legal-four
    expect(card.severity).toBe(4);
    expect(card.headline).toMatch(/₹12,000\/sqft is 40% below the official IGR guidance value of ₹20,000\/sqft for Annamma Temple Extension/);
  });

  test('does not fire without the signal', () => {
    expect(generateRecommendations([]).find((r) => r.id === 'land-rate-below-guidance')).toBeUndefined();
  });

  test('falls back to severity 3 when no hint is present', () => {
    const card = generateRecommendations([{ ...signal, meta: { ...signal.meta, severity_hint: undefined } }]).find((r) => r.id === 'land-rate-below-guidance');
    expect(card.severity).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Deal Doctor twin — land-rate-below-guidance-benchmark
// ─────────────────────────────────────────────────────────────────────────────

describe('deal doctor — land-rate-below-guidance-benchmark', () => {
  const signal = {
    kind: 'land_rate_vs_guidance',
    value: {},
    evidence: [],
    meta: { assumed: 12000, guidance: 20000, shortfall_pct: 40, locality: 'Annamma Temple Extension', severity_hint: 4 },
  };

  test('emits a Below benchmark finding under the underwriting group', () => {
    const { findings, groups } = generateDiagnoses([signal]);
    const f = findings.find((x) => x.id === 'land-rate-below-guidance-benchmark');
    expect(f).toBeTruthy();
    expect(f.topic).toBe('land_price');
    expect(f.verb).toBe('Below benchmark');
    expect(f.severity).toBe(4);
    expect(f.finding).toMatch(/below the official guidance benchmark/);
    const underwriting = groups.find((g) => g.key === 'underwriting');
    expect(underwriting.findings.some((x) => x.id === 'land-rate-below-guidance-benchmark')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end — the full recommendation engine over a workspace with guidance
// ─────────────────────────────────────────────────────────────────────────────

describe('end-to-end — generateForWorkspace with a guidance slice', () => {
  const belowGuidanceWorkspace = () => ({
    deal: {
      id: 'deal-igr',
      asset_class: 'residential_apartments',
      land_pricing_basis: 'per_sqft',
      land_price_rate_inr: 12000,
      land_area_sqft: 5000,
    },
    guidance: matchedGuidance(20000),
  });

  test('emits the land-rate-below-guidance card through the orchestrator', async () => {
    const result = await recommendationEngine.generateForWorkspace(belowGuidanceWorkspace());
    const card = result.recommendations.find((r) => r.id === 'land-rate-below-guidance');
    expect(card).toBeTruthy();
    expect(card.topic).toBe('land_price');
    expect(card.verb).toBe('Re-examine');
  });

  test('the guidance match is part of the snapshot hash (changing it busts the cache)', async () => {
    const a = await recommendationEngine.generateForWorkspace(belowGuidanceWorkspace());
    const mutated = belowGuidanceWorkspace();
    mutated.guidance = matchedGuidance(18000); // a different matched value
    const b = await recommendationEngine.generateForWorkspace(mutated);
    expect(a.snapshot_hash).not.toBe(b.snapshot_hash);
  });

  test('no guidance slice → no land-rate card, engine still runs', async () => {
    const ws = belowGuidanceWorkspace();
    ws.guidance = null;
    const result = await recommendationEngine.generateForWorkspace(ws);
    expect(result.recommendations.find((r) => r.id === 'land-rate-below-guidance')).toBeUndefined();
    expect(typeof result.snapshot_hash).toBe('string');
  });
});
