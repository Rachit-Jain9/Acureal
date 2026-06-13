'use strict';

/**
 * Land-rate-vs-guidance evaluator (Workstream 1 — 2026-06-13).
 *
 * Compares a deal's assumed land-acquisition rate (₹/sqft) against the matched
 * official IGR guidance (circle-rate) value for the parcel's locality. The
 * guidance value is the State-published *floor* used to levy stamp duty; an
 * arm's-length Bengaluru land transaction is almost always ABOVE it. A deal
 * priced materially BELOW the guidance value is therefore unusual and worth
 * surfacing — it can signal an undervalued land input, an off-record cash
 * component, or (most often) a unit/area data-entry error that quietly
 * understates the true acquisition cost driving the whole model.
 *
 * Design rules (mirror the marketBenchmarkValidator + recommendation-engine
 * posture):
 *   • Deterministic. No AI, no re-derivation of the kernel's math — the ₹/sqft
 *     rate is produced by the canonical `calculateLandPricing` normalizer so
 *     this evaluator can never diverge from the Financial Engine. (CLAUDE.md
 *     hard rule: deterministic code only for area/price normalization.)
 *   • Fail-open. Any missing / malformed input returns `not_evaluated` with a
 *     machine-readable `reason` — never throws, never blocks.
 *   • Confidence-gated. Only a `matched` guidance result (locality confidence
 *     ≥ 0.55, the same bar the parcel snapshot uses) is allowed to fire a
 *     finding. A low-confidence or absent match yields `not_evaluated`, so a
 *     deal outside the seeded SRO localities never produces a spurious flag.
 *   • WARN-grade severity only (2–4). A sub-guidance land rate is advisory:
 *     the operator can justify it (distressed sale, special situation) and
 *     proceed — it is never a hard blocker (severity 5).
 *
 * The guidance value is a *factual citation* (the published circle rate), not
 * a legal conclusion about title / RERA / encumbrance / approvals, so this
 * lane is fully AI-narratable under the `land_price` topic.
 */

const { calculateLandPricing } = require('./landPricing');

// A deal priced this fraction (or more) below the guidance value is treated as
// a material divergence worth surfacing. Below this, area-estimate fuzz
// (acres↔sqft rounding, partial extent data) dominates, so we stay silent.
const MATERIAL_SHORTFALL_THRESHOLD = 0.15;

// Severity ladder for the shortfall magnitude. Capped at 4 — WARN, never a
// blocker (matches the DSCR / fundamental-economics validators).
const SEVERITY_DEEP_SHORTFALL = 0.40; // ≥40% below guidance → severity 4
const SEVERITY_MID_SHORTFALL = 0.25; // ≥25% below guidance → severity 3

const asFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Derive the deal's assumed land-acquisition rate in ₹/sqft via the canonical
 * `calculateLandPricing` normalizer (handles per_sqft / per_acre / total_cr
 * bases + acre↔sqft conversion). Reads the deal read-model fields directly.
 *
 * For the `total_cr` basis the negotiated price is preferred over the ask price
 * (it is the rate the team actually intends to transact at); the property's
 * normalized `land_area_sqft` is the area fallback when the deal carries no
 * explicit extent input.
 *
 * @param {object} deal — the deal read-model (dealWorkspace `composed.deal`)
 * @returns {number|null} ₹/sqft, or null when it cannot be derived
 */
const deriveAssumedLandRatePerSqft = (deal = {}) => {
  if (!deal || typeof deal !== 'object') return null;
  const pricing = calculateLandPricing({
    pricingBasis: deal.land_pricing_basis,
    // Prefer the negotiated consideration; fall back to the ask price. Only
    // consulted by the total_cr basis — the per_sqft/per_acre bases read the
    // rate field below.
    landAskPriceCr: deal.negotiated_price_cr ?? deal.land_ask_price_cr,
    landPriceRateInr: deal.land_price_rate_inr,
    landExtentInputValue: deal.land_extent_input_value,
    landExtentInputUnit: deal.land_extent_input_unit,
    propertyAreaSqft: deal.land_area_sqft ?? null,
  });
  const rate = asFiniteNumber(pricing.computedLandPricePerSqftInr);
  return rate !== null && rate > 0 ? rate : null;
};

/**
 * Evaluate the assumed land rate against a guidance match.
 *
 * @param {object} args
 * @param {number|null} args.assumedRatePerSqft — deal's land rate in ₹/sqft
 * @param {object|null} args.guidance — the `guidance.service.findGuidanceMatches`
 *        result (`{ status, confidence, selected, ... }`)
 * @returns {{
 *   status: 'below_guidance'|'within_or_above'|'not_evaluated',
 *   reason: string|null,
 *   assumedRatePerSqft: number|null,
 *   guidanceValuePerSqft: number|null,
 *   deviationPct: number|null,   // (assumed − guidance) / guidance (negative = below)
 *   shortfallPct: number|null,   // positive magnitude when below, else null
 *   guidanceConfidence: number|null,
 *   locality: string|null,
 *   roadName: string|null,
 *   citation: object|null,
 *   severityHint: number|null,
 * }}
 */
const evaluateLandRateVsGuidance = ({ assumedRatePerSqft, guidance } = {}) => {
  const base = {
    status: 'not_evaluated',
    reason: null,
    assumedRatePerSqft: null,
    guidanceValuePerSqft: null,
    deviationPct: null,
    shortfallPct: null,
    guidanceConfidence: null,
    locality: null,
    roadName: null,
    citation: null,
    severityHint: null,
  };

  const assumed = asFiniteNumber(assumedRatePerSqft);
  if (assumed === null || assumed <= 0) {
    return { ...base, reason: 'no_assumed_land_rate' };
  }

  // Only a confident, approved match is allowed to fire. `matched` already
  // means confidence ≥ 0.55 in guidance.service — a low_confidence /
  // not_available / not_configured result keeps us silent.
  if (!guidance || guidance.status !== 'matched' || !guidance.selected) {
    return { ...base, assumedRatePerSqft: assumed, reason: 'no_confident_guidance_match' };
  }

  const guidanceValue = asFiniteNumber(guidance.selected.value_inr_per_sqft);
  if (guidanceValue === null || guidanceValue <= 0) {
    return { ...base, assumedRatePerSqft: assumed, reason: 'no_guidance_value' };
  }

  const deviationPct = (assumed - guidanceValue) / guidanceValue;
  const common = {
    assumedRatePerSqft: assumed,
    guidanceValuePerSqft: guidanceValue,
    deviationPct,
    guidanceConfidence: asFiniteNumber(guidance.confidence),
    locality: guidance.selected.locality || null,
    roadName: guidance.selected.road_name || null,
    citation: guidance.selected.citation || null,
  };

  if (deviationPct > -MATERIAL_SHORTFALL_THRESHOLD) {
    // At, above, or only marginally below guidance — the expected, healthy case.
    return { ...base, ...common, status: 'within_or_above', shortfallPct: null, severityHint: null };
  }

  const shortfallPct = -deviationPct; // positive magnitude
  const severityHint = shortfallPct >= SEVERITY_DEEP_SHORTFALL
    ? 4
    : shortfallPct >= SEVERITY_MID_SHORTFALL
      ? 3
      : 2;

  return {
    ...base,
    ...common,
    status: 'below_guidance',
    reason: null,
    shortfallPct,
    severityHint,
  };
};

module.exports = {
  evaluateLandRateVsGuidance,
  deriveAssumedLandRatePerSqft,
  // Exported for tests.
  MATERIAL_SHORTFALL_THRESHOLD,
  SEVERITY_DEEP_SHORTFALL,
  SEVERITY_MID_SHORTFALL,
};
