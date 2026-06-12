'use strict';

/**
 * Unified confidence ladder + road-width basis (Workstream 0b)
 * -----------------------------------------------------------
 * Deterministic, source-driven. NO LLM, no probabilistic scoring beyond the
 * existing pillar averages — this only *labels* the existing `confidence.overall`
 * onto one honest, consistently-worded rung, gated by review state so a parcel
 * can never read "Verified" on unreviewed or authority-unconfirmed inputs.
 */

// Highest → lowest. `min` is the inclusive floor on confidence.overall (0..1).
const CONFIDENCE_TIERS = [
  {
    key: 'verified',
    label: 'Verified',
    band: 'success',
    min: 0.8,
    rationale:
      'Reference-grounded against reviewed sources. Suitable for screening — verify the legal-four (title, encumbrance, RERA, approvals) separately before IC.',
  },
  {
    key: 'high',
    label: 'High',
    band: 'success',
    min: 0.65,
    rationale:
      'Mostly reference-grounded. A few inputs still need authority confirmation before reliance.',
  },
  {
    key: 'indicative',
    label: 'Indicative',
    band: 'warning',
    min: 0.45,
    rationale:
      'Mixed basis — material inputs are inferred or unverified. Review the evidence buckets before using these figures.',
  },
  {
    key: 'low',
    label: 'Low',
    band: 'warning',
    min: 0.3,
    rationale: 'Assumption-led — close the open gaps before any underwriting reliance.',
  },
  {
    key: 'not_reliable',
    label: 'Not reliable',
    band: 'danger',
    min: 0,
    rationale: 'Insufficient verified inputs — do not rely on these figures for underwriting.',
  },
];

const tierByKey = (key) => CONFIDENCE_TIERS.find((t) => t.key === key) || CONFIDENCE_TIERS[CONFIDENCE_TIERS.length - 1];

/**
 * deriveConfidenceTier({ overall, zone, buildability, jurisdiction })
 * → { key, label, band, rationale }
 *
 * Starts from the numeric band, then CAPS below "Verified" unless the parcel is
 * reviewed AND conflict-free: a reviewed zone, a reference-matched FAR rule, and
 * a resolved authority that does not need confirmation. This makes "Verified" an
 * earned state, not just a high average.
 */
const deriveConfidenceTier = ({ overall, zone, buildability, jurisdiction } = {}) => {
  const value = Math.max(0, Math.min(1, Number(overall) || 0));
  let tier = CONFIDENCE_TIERS.find((t) => value >= t.min) || CONFIDENCE_TIERS[CONFIDENCE_TIERS.length - 1];

  const reviewedAndClean =
    Boolean(zone?.zone_code) &&
    buildability?.status === 'reference_match' &&
    !(jurisdiction?.resolved && jurisdiction?.needs_authority_confirmation);

  if (tier.key === 'verified' && !reviewedAndClean) {
    tier = tierByKey('high');
  }

  return { key: tier.key, label: tier.label, band: tier.band, rationale: tier.rationale };
};

/**
 * deriveRoadWidthBasis({ property, osmRoad })
 * → { basis, label, width_m, authority_verified, note }
 *
 * Source hierarchy (best → worst): site survey / authority road register ('official')
 * > operator-entered ('user') > satellite/OSM ('inferred') > none ('missing').
 * REDIP has no authority road register or survey feed yet, so today we emit
 * 'user' | 'inferred' | 'missing'. The honest point: FAR bands pivot on road
 * width, and an operator-entered or inferred width is NOT authority-verified —
 * never present inferred-width FAR as official.
 */
const deriveRoadWidthBasis = ({ property = {}, osmRoad = null } = {}) => {
  const userWidth =
    property.road_width_mtrs === null || property.road_width_mtrs === undefined
      ? null
      : Number(property.road_width_mtrs);

  if (userWidth !== null && Number.isFinite(userWidth)) {
    return {
      basis: 'user',
      label: 'As entered',
      width_m: userWidth,
      authority_verified: false,
      note: 'Road width is operator-entered, not from an authority road register. FAR bands pivot on it — verify against the sanctioned road / BBMP-BDA road line on site.',
    };
  }

  const inferred =
    osmRoad && osmRoad.inferred_width_m !== null && osmRoad.inferred_width_m !== undefined
      ? Number(osmRoad.inferred_width_m)
      : null;

  if (inferred !== null && Number.isFinite(inferred)) {
    return {
      basis: 'inferred',
      label: 'Inferred (OSM)',
      width_m: inferred,
      authority_verified: false,
      note: 'No operator road width set. OSM-inferred context is shown for reference only and does NOT set FAR — enter a verified width to compute buildability.',
    };
  }

  return {
    basis: 'missing',
    label: 'Not provided',
    width_m: null,
    authority_verified: false,
    note: 'Road width is required to band FAR. Enter the abutting road width.',
  };
};

module.exports = {
  CONFIDENCE_TIERS,
  deriveConfidenceTier,
  deriveRoadWidthBasis,
};
