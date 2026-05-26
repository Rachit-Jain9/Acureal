'use strict';

/**
 * Deal-Structure Recommender — Phase 2 / Pillar 3 (first half).
 *
 * For a deal's asset class + promoter posture + market posture, scores the
 * eight deal structures on fit:
 *
 *   1. outright       — purchase the land outright, develop, sell / lease
 *   2. jv             — joint venture with a co-investor / co-developer
 *   3. jda            — joint-development agreement (landowner stays on title)
 *   4. revenue_share  — share top-line revenue with landowner
 *   5. area_share     — split built area between landowner and developer
 *   6. profit_share   — share project profit after audited cost recovery
 *   7. ground_lease   — long-tenure lease of land for develop-then-operate
 *   8. hybrid         — bespoke combination (e.g. JDA + revenue share)
 *
 * Output per structure:
 *   { deal_structure, label, score (0-100), band, verdict (closed dict),
 *     rationale (2-3 lines), factors (5 sub-scores) }
 *
 * Five deterministic sub-scorers, all pure:
 *
 *   • Factor 1 (0-25) Structural validity   — auto-pass unless dealStructureMatrix
 *                                              blocks the (class, structure) pair
 *   • Factor 2 (0-25) Promoter compatibility — posture × structure preference
 *                                              table (flagged promoter + JDA risky;
 *                                              cleared promoter + outright is safest)
 *   • Factor 3 (0-20) Capital efficiency    — equity tie-up per structure
 *                                              (outright max, ground_lease min)
 *   • Factor 4 (0-15) Market posture        — high absorption → outright captures;
 *                                              oversupply → revenue_share shares
 *                                              downside
 *   • Factor 5 (0-15) Execution complexity  — inverse-scored (outright simplest;
 *                                              hybrid hardest)
 *
 * Total 0-100. Verdict via closed verb dictionary per CLAUDE.md
 * (Recommend / Consider / Re-examine / Stress-test / Flag) — no absolute
 * verbs.
 *
 * This recommender is the *strategic-fit* lane. The kernel still does the
 * deterministic math (IRR / NPV / DSCR per scenario); the recommender
 * answers "given this asset class + this promoter + this market, which
 * structure best fits?" — a question that's intrinsically multi-factor
 * and easier than financial math to compose cleanly.
 *
 * Pure compute over already-fetched workspace slices. No DB calls.
 */

const dealStructureMatrix = require('../utils/dealStructureMatrix');
const microMarketIntelligence = require('./microMarketIntelligence.service');
const promoterProfile = require('./promoterProfile.service');

// ─────────────────────────────────────────────────────────────────────────────
//  Per-structure deterministic baselines
// ─────────────────────────────────────────────────────────────────────────────

const STRUCTURE_PROFILES = Object.freeze({
  outright: {
    label: 'Outright',
    capital_efficiency: 4,   // 0-20: 4 = high equity tie-up
    execution_complexity: 14, // 0-15 (raw difficulty before inversion): 14 = simplest
    one_liner: 'Purchase the land, develop, capture full upside / downside.',
  },
  jv: {
    label: 'Joint Venture',
    capital_efficiency: 13,
    execution_complexity: 9,
    one_liner: 'Co-invest with a partner; SPV-governed equity + capital calls.',
  },
  jda: {
    label: 'Joint Development Agreement',
    capital_efficiency: 17,
    execution_complexity: 6,
    one_liner: 'Landowner stays on title; developer builds; share revenue / area.',
  },
  revenue_share: {
    label: 'Revenue Share',
    capital_efficiency: 15,
    execution_complexity: 8,
    one_liner: 'Share top-line; escrow-waterfall enforced.',
  },
  area_share: {
    label: 'Area Share',
    capital_efficiency: 17,
    execution_complexity: 5,
    one_liner: 'Allocate built area between landowner and developer.',
  },
  profit_share: {
    label: 'Profit Share',
    capital_efficiency: 14,
    execution_complexity: 3,
    one_liner: 'Share net profit post audit; cost discipline is non-negotiable.',
  },
  ground_lease: {
    label: 'Ground Lease',
    capital_efficiency: 20,  // highest — no land outlay
    execution_complexity: 7,
    one_liner: 'Long-tenure (90-99 yr) lease; develop, hold, exit via LRD.',
  },
  hybrid: {
    label: 'Hybrid',
    capital_efficiency: 12,
    execution_complexity: 2,  // most complex
    one_liner: 'Bespoke combination of legs; master agreement scope is critical.',
  },
});

const DEAL_STRUCTURES = Object.freeze(Object.keys(STRUCTURE_PROFILES));

// ─────────────────────────────────────────────────────────────────────────────
//  Promoter-posture × structure compatibility table
//
//  Each cell is a 0-25 score. Reasoning:
//    - 'flagged' promoter: outright is bad (you're trapped with them on title;
//      no escrow protection); revenue_share with escrow + JV with SPV
//      governance are safer; JDA without mortgage permission is dangerous.
//    - 'cleared' promoter: outright captures full upside; JDA / JV are clean
//      options too.
//    - 'unverified' promoter: outright is unsafe (do the diligence first);
//      revenue_share or profit_share with audit clauses are safer until
//      verified.
// ─────────────────────────────────────────────────────────────────────────────

const PROMOTER_COMPATIBILITY = Object.freeze({
  cleared: {
    outright:      25,
    jv:            22,
    jda:           22,
    revenue_share: 20,
    area_share:    20,
    profit_share:  18,
    ground_lease:  20,
    hybrid:        18,
  },
  unverified: {
    outright:      10,  // doing the diligence first matters
    jv:            16,
    jda:           14,
    revenue_share: 20,  // escrow protects downside
    area_share:    18,
    profit_share:  20,  // audit rights protect
    ground_lease:  16,
    hybrid:        14,
  },
  flagged: {
    outright:      5,   // dangerous — you're tied to them
    jv:            12,  // SPV adds governance
    jda:           8,   // landowner risk is high here
    revenue_share: 18,  // escrow waterfall protects
    area_share:    12,
    profit_share:  20,  // audit rights are the strongest protection
    ground_lease:  16,  // you don't transfer freehold
    hybrid:        12,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Market-posture sub-scorer
//
//  Reads absorption_pressure + price_yoy from the micro-market briefing.
//    - absorption_pressure ≤ 1.0 (tight market) → outright captures upside
//    - absorption_pressure ≥ 1.15 (oversupply) → revenue_share / area_share
//      shifts downside risk back to the landowner
//    - price_yoy > 8% → outright wins
//    - price_yoy declining → JDA / revenue_share over outright
// ─────────────────────────────────────────────────────────────────────────────

const scoreMarketPosture = ({ structure, microMarket, assetClass }) => {
  if (!microMarket || !microMarket.locality) {
    return {
      score: 8, // neutral default
      of: 15,
      signal: 'no micro-market data — neutral market posture',
    };
  }
  const benchmarks = microMarket.benchmarks || [];
  const benchmarksForClass = benchmarks.filter((b) => b.asset_class === assetClass);

  const absPressure = benchmarksForClass.find((b) => b.metric_kind === 'absorption_pressure');
  const yoyBench = benchmarksForClass.find((b) => b.metric_kind === 'price_yoy_pct');

  const pressure = absPressure && absPressure.p50 != null ? Number(absPressure.p50) : null;
  const yoy = yoyBench && yoyBench.p50 != null ? Number(yoyBench.p50) : null;

  const reasons = [];
  let score = 8; // baseline

  // Tight market / strong growth favours capturing upside → outright wins
  if (pressure != null && pressure <= 1.0) {
    if (structure === 'outright' || structure === 'jv') {
      score += 4;
      reasons.push(`tight market favours capturing upside`);
    }
    if (structure === 'revenue_share' || structure === 'area_share') {
      score -= 2;
      reasons.push(`tight market — sharing upside leaves money on the table`);
    }
  }
  // Oversupply / weak market — share the downside
  if (pressure != null && pressure >= 1.15) {
    if (structure === 'revenue_share' || structure === 'area_share' || structure === 'profit_share') {
      score += 4;
      reasons.push(`oversupply — sharing downside protects the developer`);
    }
    if (structure === 'outright') {
      score -= 3;
      reasons.push(`oversupply — outright absorbs full downside`);
    }
  }
  // Growth boost
  if (yoy != null && yoy >= 8) {
    if (structure === 'outright') {
      score += 3;
      reasons.push(`+${yoy}% YoY — outright captures the growth`);
    }
  }
  if (yoy != null && yoy < 0) {
    if (structure === 'outright') {
      score -= 2;
      reasons.push(`${yoy}% YoY — outright absorbs the decline`);
    }
    if (structure === 'jda') {
      score += 2;
      reasons.push(`${yoy}% YoY — JDA defers land cost outlay`);
    }
  }

  return {
    score: Math.max(0, Math.min(15, score)),
    of: 15,
    signal: reasons.join('; ') || 'neutral market posture',
  };
};

// ─────────────────────────────────────────────────────────────────────────────
//  Verdict + band mapping — closed verb dictionary per CLAUDE.md
// ─────────────────────────────────────────────────────────────────────────────

const VERDICT_DICT = Object.freeze(['Recommend', 'Consider', 'Re-examine', 'Stress-test', 'Flag']);

const verdictFor = (score) => {
  if (score >= 75) return 'Recommend';
  if (score >= 55) return 'Consider';
  if (score >= 35) return 'Re-examine';
  if (score >= 15) return 'Stress-test';
  return 'Flag';
};

const bandFor = (score) => {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
};

// ─────────────────────────────────────────────────────────────────────────────
//  Composer — score one structure for the deal
// ─────────────────────────────────────────────────────────────────────────────

const scoreStructure = ({ structure, assetClass, promoterPosture, microMarket }) => {
  const profile = STRUCTURE_PROFILES[structure];
  if (!profile) return null;

  // Factor 1: Structural validity — 0 if invalid pair, else 25.
  const validity = dealStructureMatrix.isValidPair(assetClass, structure);
  const f1 = validity.valid
    ? { score: 25, of: 25, signal: `Compatible with ${assetClass}` }
    : { score: 0, of: 25, signal: validity.reason || `Invalid pair with ${assetClass}` };

  // Factor 2: Promoter compatibility — lookup table.
  const promoterRow = PROMOTER_COMPATIBILITY[promoterPosture] || PROMOTER_COMPATIBILITY.unverified;
  const promoterScore = promoterRow[structure] ?? 12;
  const f2 = {
    score: promoterScore,
    of: 25,
    signal: `${promoterPosture || 'unverified'} promoter × ${structure} compatibility`,
  };

  // Factor 3: Capital efficiency — per-structure baseline.
  const f3 = {
    score: profile.capital_efficiency,
    of: 20,
    signal:
      profile.capital_efficiency >= 16
        ? 'low equity tie-up — capital-efficient'
        : profile.capital_efficiency >= 10
          ? 'moderate equity tie-up'
          : 'high equity tie-up',
  };

  // Factor 4: Market posture — depends on absorption + price YoY.
  const f4 = scoreMarketPosture({ structure, microMarket, assetClass });

  // Factor 5: Execution complexity — inverse-scored (already inverted in the
  // profile — higher number = simpler).
  const f5 = {
    score: profile.execution_complexity,
    of: 15,
    signal:
      profile.execution_complexity >= 12
        ? 'execution simple'
        : profile.execution_complexity >= 7
          ? 'execution moderate'
          : 'execution complex — bespoke contracts',
  };

  // Hard floor: invalid pair always scores below "Stress-test" so it never
  // ranks above legitimate options.
  let total = f1.score + f2.score + f3.score + f4.score + f5.score;
  if (!validity.valid) {
    total = Math.min(total, 12); // forces Flag
  }

  // Compose the rationale — 2-3 lines, lead with the headline reason.
  const rationale = [];
  if (!validity.valid) {
    rationale.push(validity.reason);
  } else {
    rationale.push(profile.one_liner);
    if (f4.signal !== 'neutral market posture' && f4.signal !== 'no micro-market data — neutral market posture') {
      rationale.push(f4.signal);
    }
    if (rationale.length < 3) rationale.push(f2.signal);
  }

  return {
    deal_structure: structure,
    label: profile.label,
    score: total,
    band: bandFor(total),
    verdict: verdictFor(total),
    rationale: rationale.slice(0, 3),
    factors: {
      structural_validity:    f1,
      promoter_compatibility: f2,
      capital_efficiency:     f3,
      market_posture:         f4,
      execution_complexity:   f5,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
//  Public surface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure scorer — takes already-fetched context and returns ranked structures.
 * Used by the workspace slice (no extra round-trips).
 *
 * Args:
 *   assetClass        — required; the deal's asset class
 *   promoterPosture   — 'cleared' | 'unverified' | 'flagged' | null (defaults to 'unverified')
 *   microMarket       — { locality, benchmarks, demand_signals } or null
 *
 * Returns: { scores: [...] } sorted desc by score, plus a `reason` if asset
 * class is missing (empty scores).
 */
const scoreFromContext = ({ assetClass, promoterPosture = 'unverified', microMarket = null }) => {
  if (!assetClass) return { scores: [], reason: 'no_asset_class' };
  const scores = DEAL_STRUCTURES
    .map((s) =>
      scoreStructure({
        structure: s,
        assetClass,
        promoterPosture,
        microMarket,
      })
    )
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return { scores, reason: null };
};

/**
 * Convenience wrapper: fetches promoter posture + micro-market briefing,
 * then scores. Used by the standalone route.
 */
const recommendForDeal = async (deal) => {
  if (!deal || !deal.id) return { scores: [], reason: 'no_deal' };
  if (!deal.asset_class) return { scores: [], reason: 'no_asset_class' };

  // Pull promoter posture
  const promoterData = await promoterProfile.getProfileWithAssessment(deal.id);
  const promoterPosture = promoterData?.assessment?.posture || 'unverified';

  // Pull micro-market briefing — only if the deal has coordinates
  let microMarket = null;
  const lat = Number(deal.property_lat ?? deal.parcel_lat ?? deal.latitude);
  const lng = Number(deal.property_lng ?? deal.parcel_lng ?? deal.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const classification = await microMarketIntelligence.classifyParcel(lat, lng);
    if (classification.locality_code) {
      microMarket = await microMarketIntelligence.getBriefing(classification.locality_code);
    }
  }

  return scoreFromContext({
    assetClass: deal.asset_class,
    promoterPosture,
    microMarket,
  });
};

module.exports = {
  // Public
  scoreFromContext,
  recommendForDeal,
  // Exported for unit tests + workspace integration
  scoreStructure,
  scoreMarketPosture,
  verdictFor,
  bandFor,
  STRUCTURE_PROFILES,
  DEAL_STRUCTURES,
  PROMOTER_COMPATIBILITY,
  VERDICT_DICT,
};
