'use strict';

/**
 * Best Use Simulator — Phase 2 / Pillar 2.
 *
 * For a parcel + micro-market briefing, scores the seven core asset classes
 * on fitness to monetise the site:
 *
 *   1. residential_apartments
 *   2. plotted_development
 *   3. commercial_office
 *   4. retail
 *   5. industrial_warehousing
 *   6. hospitality
 *   7. mixed_use
 *
 * Output per asset class:
 *   { asset_class, label, score (0-100), band ('high'|'medium'|'low'),
 *     verdict (closed-dictionary), rationale (3 lines), factors (5 sub-scores) }
 *
 * Scoring is **deterministic** — no AI. Five sub-scorers, each pure,
 * each documented:
 *
 *   • Factor 1 (0-30): Demand fit — depth of published benchmarks +
 *                       absorption pressure in this (locality, asset_class).
 *   • Factor 2 (0-25): Price realisability — headline revenue metric
 *                       present + band tightness + source confidence.
 *   • Factor 3 (0-15): Growth signal — price YoY + qualitative buyer-mix.
 *   • Factor 4 (0-15): Approval-timeline risk (inverse-scored) — per-class
 *                       deterministic baseline.
 *   • Factor 5 (0-15): Capital intensity — per-class deterministic baseline,
 *                       tier-multiplier adjusted (premium tier costs more).
 *
 * Total: 0-100. Verdict via closed verb dictionary
 * (Recommend / Consider / Re-examine / Stress-test / Flag) — per the
 * CLAUDE.md "no absolute verbs" rule. No AI narration.
 *
 * The simulator never invents numbers. Every factor cites the benchmark /
 * signal that produced its score (or honestly reports the absence). The
 * three-line rationale is composed from the five factor signals.
 *
 * Public surface:
 *   - simulateFromCoordinates(lat, lng) → fetches the briefing + scores
 *   - scoreFromBriefing({ locality, benchmarks, demandSignals }) → pure;
 *     reused by the workspace slice so it doesn't re-fetch the briefing
 */

const microMarketIntelligence = require('./microMarketIntelligence.service');

// ─────────────────────────────────────────────────────────────────────────────
//  Per-asset-class deterministic baselines
//
//  Approval months: typical end-to-end Bengaluru approval pipeline
//    (BBMP / BDA / RERA / KSPCB / KIADB) for an MVP-shape project. These are
//    the operator-known typical timelines, not promises. The simulator
//    surfaces the relative risk; the deal team verifies on their actual deal.
//
//  Construction cost: typical INR/sqft on a Grade-A build, ex-land.
//    Sources: published JLL / Knight Frank / Cushman cost-per-sqft notes for
//    Bengaluru MVP fit-out. Same posture: relative baseline, not a quote.
// ─────────────────────────────────────────────────────────────────────────────

const ASSET_CLASS_PROFILES = Object.freeze({
  residential_apartments: {
    label: 'Residential Apartments',
    approval_months: 12,
    construction_cost_inr_per_sqft: 3500,
    revenue_metric: 'sale_rate_per_sqft_inr',
    rationale_revenue: 'sale rate',
    approval_summary: 'RERA + Form-B + plan sanction',
  },
  plotted_development: {
    label: 'Plotted Development',
    approval_months: 8,
    construction_cost_inr_per_sqft: 400,
    revenue_metric: 'plot_rate_per_sqft_inr',
    rationale_revenue: 'plot rate',
    approval_summary: 'RERA + layout sanction',
  },
  commercial_office: {
    label: 'Commercial Office',
    approval_months: 9,
    construction_cost_inr_per_sqft: 4500,
    revenue_metric: 'office_rent_per_sqft_month_inr',
    rationale_revenue: 'office rent',
    approval_summary: 'Plan sanction + KSPCB',
  },
  retail: {
    label: 'Retail',
    approval_months: 7,
    construction_cost_inr_per_sqft: 3800,
    revenue_metric: 'retail_rent_per_sqft_month_inr',
    rationale_revenue: 'retail rent',
    approval_summary: 'Plan sanction + trade licence',
  },
  industrial_warehousing: {
    label: 'Industrial / Warehousing',
    approval_months: 14,
    construction_cost_inr_per_sqft: 2200,
    revenue_metric: 'rent_per_sqft_month_inr',
    rationale_revenue: 'industrial rent',
    approval_summary: 'KIADB + KSPCB consent',
  },
  hospitality: {
    label: 'Hospitality',
    approval_months: 16,
    construction_cost_inr_per_sqft: 6500,
    revenue_metric: 'cap_rate_pct',
    rationale_revenue: 'cap rate',
    approval_summary: 'Plan sanction + hospitality licence + KSPCB',
  },
  mixed_use: {
    label: 'Mixed Use',
    approval_months: 14,
    construction_cost_inr_per_sqft: 4000,
    revenue_metric: 'sale_rate_per_sqft_inr',
    rationale_revenue: 'sale rate',
    approval_summary: 'Combined RERA + plan + KSPCB',
  },
});

const CORE_ASSET_CLASSES = Object.freeze(Object.keys(ASSET_CLASS_PROFILES));

// Per-tier capital-intensity multiplier. Premium-tier locations command
// premium fit-out + soft-cost loading. Emerging-tier discounts the typical
// MVP build cost.
const TIER_MULTIPLIER = Object.freeze({
  premium: 1.30,
  prime: 1.20,
  secondary: 1.00,
  emerging: 0.85,
});

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
//  Sub-scorers — each pure, each cites its evidence
// ─────────────────────────────────────────────────────────────────────────────

const formatINR = (n) => `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;

// Factor 1: Demand fit (0-30). Depth of published benchmarks for this
// (locality, asset_class) + favorable absorption signals.
const scoreDemandFit = ({ benchmarksForClass }) => {
  let score = 0;
  const reasons = [];

  const benchCount = benchmarksForClass.length;
  if (benchCount >= 6) {
    score += 25;
    reasons.push(`${benchCount} published benchmarks`);
  } else if (benchCount >= 3) {
    score += 18;
    reasons.push(`${benchCount} published benchmarks`);
  } else if (benchCount >= 1) {
    score += 8;
    reasons.push(`${benchCount} published benchmark${benchCount === 1 ? '' : 's'}`);
  }

  // Absorption pressure favorable (<= 1.0) gives a boost
  const absPressure = benchmarksForClass.find((b) => b.metric_kind === 'absorption_pressure');
  if (absPressure && absPressure.p50 != null && Number(absPressure.p50) <= 1.0) {
    score += 5;
    reasons.push(`absorption pressure ${absPressure.p50} (favorable)`);
  } else if (absPressure && absPressure.p50 != null && Number(absPressure.p50) > 1.15) {
    reasons.push(`absorption pressure ${absPressure.p50} (oversupply risk)`);
  }

  // Fast absorption quarters → mention in rationale
  const absQuarters = benchmarksForClass.find((b) => b.metric_kind === 'absorption_quarters');
  if (absQuarters && absQuarters.p50 != null && Number(absQuarters.p50) <= 2 && !absPressure) {
    reasons.push(`absorption ${absQuarters.p50} quarters`);
  }

  return {
    score: Math.min(score, 30),
    of: 30,
    signal: reasons.join('; ') || 'no demand benchmarks published for this asset class',
  };
};

// Factor 2: Price realisability (0-25). Headline revenue metric present +
// band tightness + source confidence.
const scorePriceRealisability = ({ profile, benchmarksForClass }) => {
  const headline = benchmarksForClass.find((b) => b.metric_kind === profile.revenue_metric);
  if (!headline || headline.p50 == null) {
    return {
      score: 0,
      of: 25,
      signal: `no ${profile.rationale_revenue} benchmark published`,
    };
  }

  let score = 15; // baseline for the headline metric being present
  const p25 = Number(headline.p25);
  const p50 = Number(headline.p50);
  const p75 = Number(headline.p75);

  let signal = `${profile.rationale_revenue} p50 ${formatINR(p50)}`;
  if (Number.isFinite(p25) && Number.isFinite(p75) && p50 > 0) {
    const bandWidth = (p75 - p25) / p50;
    if (bandWidth < 0.15) {
      score += 7;
      signal += `, band tight (±${Math.round(bandWidth * 50)}%)`;
    } else if (bandWidth < 0.30) {
      score += 4;
      signal += `, band moderate (±${Math.round(bandWidth * 50)}%)`;
    } else {
      signal += `, band wide (±${Math.round(bandWidth * 50)}%)`;
    }
  }

  if (headline.confidence === 'high') score += 3;
  else if (headline.confidence === 'medium') score += 1;

  return { score: Math.min(score, 25), of: 25, signal };
};

// Factor 3: Growth signal (0-15). Price YoY + qualitative buyer-segment.
const scoreGrowth = ({ benchmarksForClass, signalsForClass }) => {
  let score = 0;
  const reasons = [];

  const yoyBench = benchmarksForClass.find((b) => b.metric_kind === 'price_yoy_pct');
  if (yoyBench && yoyBench.p50 != null) {
    const yoy = Number(yoyBench.p50);
    if (yoy >= 10) {
      score += 10;
      reasons.push(`price +${yoy}% YoY`);
    } else if (yoy >= 5) {
      score += 7;
      reasons.push(`price +${yoy}% YoY`);
    } else if (yoy >= 0) {
      score += 4;
      reasons.push(`price +${yoy}% YoY`);
    } else {
      reasons.push(`price ${yoy}% YoY (declining)`);
    }
  }

  // Qualitative buyer-segment / demand-driver signal — values_text is free
  // text like "IT professionals 60%, NRI 20%, investor 20%".
  const segmentSignal = signalsForClass.find((s) => s.signal_kind === 'demand_buyer_segment');
  if (segmentSignal && segmentSignal.value_text) {
    score += 5;
    reasons.push(`buyer mix: ${segmentSignal.value_text}`);
  }

  return {
    score: Math.min(score, 15),
    of: 15,
    signal: reasons.join('; ') || 'no growth signal published',
  };
};

// Factor 4: Approval-timeline risk (0-15). Inverse-scored — shorter = better.
// 6 months → 15, 12 → 9, 18 → 3, 24+ → 0. Per-class deterministic baseline.
const scoreApprovalRisk = ({ profile }) => {
  const months = profile.approval_months;
  const raw = 15 * (1 - months / 24);
  const score = Math.max(0, Math.min(15, Math.round(raw)));
  return {
    score,
    of: 15,
    signal: `${months}-month typical approval pipeline (${profile.approval_summary})`,
  };
};

// Factor 5: Capital intensity (0-15). Lower per-sqft construction cost = higher
// score (lower capital lock-up). Tier multiplier loaded.
//   2,000/sf → 15, 4,000 → 10, 6,500 → 3, 8,000+ → 0.
const scoreCapitalIntensity = ({ profile, tier }) => {
  const tierMult = TIER_MULTIPLIER[tier] || 1.0;
  const adjustedCost = profile.construction_cost_inr_per_sqft * tierMult;
  const raw = 15 - (adjustedCost - 2000) / 400;
  const score = Math.max(0, Math.min(15, Math.round(raw)));
  return {
    score,
    of: 15,
    signal: `${formatINR(adjustedCost)}/sf typical build cost${tier ? ` (${tier} tier)` : ''}`,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
//  Composer — runs the five sub-scorers for one asset class and assembles
//  the result. Pure.
// ─────────────────────────────────────────────────────────────────────────────

const scoreAssetClass = ({ assetClass, locality, benchmarks, demandSignals }) => {
  const profile = ASSET_CLASS_PROFILES[assetClass];
  if (!profile) return null;

  const benchmarksForClass = (benchmarks || []).filter((b) => b.asset_class === assetClass);
  const signalsForClass = (demandSignals || []).filter(
    (s) => s.asset_class === assetClass || s.asset_class === null
  );
  const tier = locality?.tier || null;

  const ctx = { profile, benchmarksForClass, signalsForClass, tier };

  const f1 = scoreDemandFit(ctx);
  const f2 = scorePriceRealisability(ctx);
  const f3 = scoreGrowth(ctx);
  const f4 = scoreApprovalRisk(ctx);
  const f5 = scoreCapitalIntensity(ctx);

  const score = f1.score + f2.score + f3.score + f4.score + f5.score;

  // Compose the 3-line rationale from the most informative factors. Always
  // surface demand fit + price realisability first; then growth or cost.
  const rationale = [];
  if (locality && locality.name) {
    rationale.push(`${locality.name}: ${f1.signal}`);
  } else {
    rationale.push(f1.signal);
  }
  if (f2.score > 0) rationale.push(f2.signal);
  if (f3.score > 0) rationale.push(f3.signal);
  if (rationale.length < 3) rationale.push(f5.signal);
  if (rationale.length < 3) rationale.push(f4.signal);

  return {
    asset_class: assetClass,
    label: profile.label,
    score,
    band: bandFor(score),
    verdict: verdictFor(score),
    rationale: rationale.slice(0, 3),
    factors: {
      demand_fit: f1,
      price_realisability: f2,
      growth_signal: f3,
      approval_risk: f4,
      capital_intensity: f5,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
//  Public surface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure scorer — takes an already-fetched briefing payload (locality,
 * benchmarks, demand_signals) and returns the ranked scores for the
 * seven core asset classes. Used by the workspace slice so it doesn't
 * re-fetch the briefing.
 *
 * Returns `{ scores: [], reason: 'no_locality' }` honestly when the
 * briefing has no locality. Empty briefings → empty scores.
 */
const scoreFromBriefing = (briefing) => {
  if (!briefing || !briefing.locality) {
    return { scores: [], reason: 'no_locality' };
  }
  const scores = CORE_ASSET_CLASSES
    .map((ac) =>
      scoreAssetClass({
        assetClass: ac,
        locality: briefing.locality,
        benchmarks: briefing.benchmarks || [],
        demandSignals: briefing.demand_signals || [],
      })
    )
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return { scores, reason: null };
};

/**
 * Simulate Best Use from a (lat, lng) — convenience wrapper that fetches
 * the briefing and scores. Used by the standalone route.
 */
// Number(null) is 0, which passes Number.isFinite — so reject null/undefined/''
// explicitly before coercion.
const isValidCoord = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

const simulateFromCoordinates = async (lat, lng) => {
  const empty = (reason) => ({
    classification: { locality_code: null, name: null, distance_km: null, tier: null, confidence: null },
    locality: null,
    scores: [],
    reason,
  });
  if (!isValidCoord(lat) || !isValidCoord(lng)) {
    return empty('no_coordinates');
  }
  const classification = await microMarketIntelligence.classifyParcel(lat, lng);
  if (!classification.locality_code) {
    return { ...empty('no_micro_market_match'), classification };
  }
  const briefing = await microMarketIntelligence.getBriefing(classification.locality_code);
  if (!briefing.locality) {
    return { ...empty('no_briefing_data'), classification };
  }
  const { scores } = scoreFromBriefing(briefing);
  return { classification, locality: briefing.locality, scores, reason: null };
};

module.exports = {
  // Public
  simulateFromCoordinates,
  scoreFromBriefing,
  // Exported for unit tests + workspace integration
  scoreAssetClass,
  scoreDemandFit,
  scorePriceRealisability,
  scoreGrowth,
  scoreApprovalRisk,
  scoreCapitalIntensity,
  verdictFor,
  bandFor,
  ASSET_CLASS_PROFILES,
  CORE_ASSET_CLASSES,
  TIER_MULTIPLIER,
  VERDICT_DICT,
};
