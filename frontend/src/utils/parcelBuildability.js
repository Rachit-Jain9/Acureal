// Pure-JS parcel buildability math — mirror of backend/src/utils/parcelBuildability.js.
// Identical logic so what-if sliders recompute client-side without a server roundtrip.
// Parity-tested against the backend copy (backend/tests/parcelBuildability.parity.test.js).
// Keep these two files in lockstep — change one, change both, run the parity test.

export const SQFT_PER_SQM = 10.76391041671;

export const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const round = (value, precision = 2) => {
  const numeric = toNumber(value);
  if (numeric === null) return null;
  const factor = 10 ** precision;
  return Math.round(numeric * factor) / factor;
};

export const sqftToSqm = (sqft) => {
  const numeric = toNumber(sqft);
  return numeric === null ? null : numeric / SQFT_PER_SQM;
};

export const sqmToSqft = (sqm) => {
  const numeric = toNumber(sqm);
  return numeric === null ? null : numeric * SQFT_PER_SQM;
};

const inLowerInclusiveUpperExclusiveBand = (value, min, max) => {
  const numeric = toNumber(value);
  const minValue = toNumber(min) ?? 0;
  const maxValue = toNumber(max);

  if (numeric === null) return false;
  if (numeric < minValue) return false;
  if (maxValue !== null && numeric >= maxValue) return false;
  return true;
};

export const citeFarRule = (rule = {}) => ({
  id: rule.id ? `far-rule-${rule.id}` : 'far-rule',
  kind: 'rmp_far_rule',
  // Operative source = RMP 2015 Vol III (BDA; G.O. UDD 540 BEM AA SE 2004 dated
  // 22-06-2007). Keep in lockstep with backend/src/utils/parcelBuildability.js.
  label: rule.source_section || 'RMP 2015 Vol III FAR rule',
  source_title:
    rule.source_title
    || 'Revised Master Plan 2015 — Volume III: Zoning of Land Use and Regulations (BDA)',
  source_url: rule.source_url || null,
  authority: rule.authority_name || 'Bangalore Development Authority (RMP 2015, operative)',
  page: rule.source_page || null,
  section: rule.source_section || null,
  status: rule.plan_status || 'operative',
});

export const selectFarRule = (rules = [], { landAreaSqft, roadWidthMtrs, landUseFamily } = {}) => {
  const areaSqm = sqftToSqm(landAreaSqft);
  const roadWidthM = toNumber(roadWidthMtrs);
  const normalizedUse = (landUseFamily || '').toLowerCase();

  if (!areaSqm) {
    return { rule: null, reason: 'land_area_missing' };
  }

  if (roadWidthM === null) {
    return { rule: null, reason: 'road_width_missing' };
  }

  const matches = rules
    .filter((rule) => !normalizedUse || String(rule.land_use_family || '').toLowerCase() === normalizedUse)
    .filter((rule) => inLowerInclusiveUpperExclusiveBand(areaSqm, rule.plot_area_min_sqm, rule.plot_area_max_sqm))
    .filter((rule) => inLowerInclusiveUpperExclusiveBand(roadWidthM, rule.road_width_min_m, rule.road_width_max_m))
    .sort((a, b) => {
      const aOrg = a.org_id ? 1 : 0;
      const bOrg = b.org_id ? 1 : 0;
      if (aOrg !== bOrg) return bOrg - aOrg;
      const aSpecificity = (toNumber(a.plot_area_min_sqm) || 0) + (toNumber(a.road_width_min_m) || 0);
      const bSpecificity = (toNumber(b.plot_area_min_sqm) || 0) + (toNumber(b.road_width_min_m) || 0);
      return bSpecificity - aSpecificity;
    });

  return { rule: matches[0] || null, reason: matches[0] ? null : 'no_matching_far_rule' };
};

export const estimatePlotDimensionsM = ({ landAreaSqft, frontageMtrs, depthMtrs } = {}) => {
  const areaSqm = sqftToSqm(landAreaSqft);
  const frontage = toNumber(frontageMtrs);
  const depth = toNumber(depthMtrs);

  if (!areaSqm) {
    return { frontage_m: null, depth_m: null, method: 'missing_area' };
  }

  if (frontage && depth) {
    return { frontage_m: frontage, depth_m: depth, method: 'user_dimensions' };
  }

  if (frontage) {
    return { frontage_m: frontage, depth_m: areaSqm / frontage, method: 'frontage_derived_depth' };
  }

  if (depth) {
    return { frontage_m: areaSqm / depth, depth_m: depth, method: 'depth_derived_frontage' };
  }

  const side = Math.sqrt(areaSqm);
  return { frontage_m: side, depth_m: side, method: 'square_plot_estimate' };
};

export const estimateSetbackImpact = ({ property = {}, rule = {} } = {}) => {
  const landAreaSqft = toNumber(property.land_area_sqft);
  const areaSqm = sqftToSqm(landAreaSqft);

  if (!areaSqm) {
    return {
      effective_area_sqft: null,
      setback_deduction_sqft: null,
      setback_deduction_pct: null,
      setback_input_status: 'missing_area',
      method: 'not_applied',
    };
  }

  const front = toNumber(rule.front_setback_m);
  const rear = toNumber(rule.rear_setback_m);
  const side = toNumber(rule.side_setback_m);
  const setbackValues = [front, rear, side].filter((value) => value !== null);

  if (!setbackValues.length) {
    return {
      effective_area_sqft: round(landAreaSqft, 0),
      setback_deduction_sqft: 0,
      setback_deduction_pct: 0,
      setback_input_status: 'not_configured',
      method: 'gross_area_no_setback_rule',
    };
  }

  const dimensions = estimatePlotDimensionsM({
    landAreaSqft,
    frontageMtrs: property.frontage_mtrs,
    depthMtrs: property.depth_mtrs,
  });

  const frontage = dimensions.frontage_m;
  const depth = dimensions.depth_m;
  const frontDeductionSqm = front ? front * frontage : 0;
  const rearDeductionSqm = rear ? rear * frontage : 0;
  const residualDepth = Math.max(0, depth - (front || 0) - (rear || 0));
  const sideDeductionSqm = side ? side * 2 * residualDepth : 0;
  const totalDeductionSqm = Math.min(areaSqm, frontDeductionSqm + rearDeductionSqm + sideDeductionSqm);
  const effectiveAreaSqm = Math.max(0, areaSqm - totalDeductionSqm);
  const configuredCount = setbackValues.length;

  return {
    effective_area_sqft: round(sqmToSqft(effectiveAreaSqm), 0),
    setback_deduction_sqft: round(sqmToSqft(totalDeductionSqm), 0),
    setback_deduction_pct: round((totalDeductionSqm / areaSqm) * 100, 2),
    setback_input_status: configuredCount === 3 ? 'complete' : 'partial',
    method: dimensions.method,
    estimated_frontage_m: round(frontage, 2),
    estimated_depth_m: round(depth, 2),
  };
};

export const computeBuildabilityFromRule = ({ property = {}, zone = null, rule = null } = {}) => {
  const landAreaSqft = toNumber(property.land_area_sqft);
  const roadWidthMtrs = toNumber(property.road_width_mtrs);
  const manualFsi = toNumber(property.permissible_fsi);

  if (!landAreaSqft) {
    return {
      status: 'needs_verification',
      source: 'missing_input',
      message: 'Land area is required before buildable area can be calculated.',
      message_key: 'buildability.missing_input.land_area',
      citations: [],
      values: null,
    };
  }

  if (!rule) {
    return {
      status: 'needs_verification',
      source: manualFsi ? 'user_provided_fsi' : 'missing_rule',
      message: manualFsi
        ? 'Only a user-provided FSI is available. Match an approved FAR matrix rule before using this as reference buildability.'
        : 'No approved FAR matrix rule matched this parcel.',
      message_key: manualFsi
        ? 'buildability.missing_rule.with_user_fsi'
        : 'buildability.missing_rule.no_user_fsi',
      citations: [],
      values: manualFsi
        ? {
            manual_fsi: round(manualFsi, 3),
            manual_buildable_area_sqft: round(landAreaSqft * manualFsi, 0),
          }
        : null,
    };
  }

  const baseFar = toNumber(rule.base_far);
  const additionalFar = toNumber(rule.additional_far) || 0;
  const maxFar = toNumber(rule.max_far);
  const groundCoveragePct = toNumber(rule.ground_coverage_pct);
  const citation = citeFarRule(rule);
  const setbackImpact = estimateSetbackImpact({ property, rule });
  const effectiveAreaSqft = toNumber(setbackImpact.effective_area_sqft);
  const calculationAreaSqft = effectiveAreaSqft === null ? landAreaSqft : effectiveAreaSqft;
  const grossBaseBuildable = baseFar ? landAreaSqft * baseFar : null;
  const grossAdditionalBuildable = additionalFar ? landAreaSqft * additionalFar : 0;
  const grossMaxBuildable = maxFar ? landAreaSqft * maxFar : null;
  const screeningBaseBuildable = baseFar ? calculationAreaSqft * baseFar : null;
  const screeningAdditionalBuildable = additionalFar ? calculationAreaSqft * additionalFar : 0;
  const screeningMaxBuildable = maxFar ? calculationAreaSqft * maxFar : null;
  const coverageFootprintSqft = groundCoveragePct ? (landAreaSqft * groundCoveragePct) / 100 : null;
  const screeningFootprintSqft = [coverageFootprintSqft, effectiveAreaSqft]
    .filter((value) => value !== null && value !== undefined)
    .reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);

  return {
    status: additionalFar > 0 ? 'needs_verification' : 'reference_match',
    source: rule.org_id ? 'org_override' : 'global_reference',
    message:
      additionalFar > 0
        ? 'Base FAR is reference-matched. Additional/TDR FAR remains pending authority and project-specific verification. Buildable area is a screening estimate after available setback deductions.'
        : 'FAR is matched to an approved reference rule. Buildable area is a screening estimate after available setback deductions.',
    message_key:
      additionalFar > 0
        ? 'buildability.status.reference_match.with_additional'
        : 'buildability.status.reference_match.global',
    zone_code: rule.zone_code || zone?.zone_code || null,
    planning_zone: rule.planning_zone || zone?.planning_zone || null,
    land_use_family: rule.land_use_family || null,
    citations: [citation],
    values: {
      land_area_sqft: round(landAreaSqft, 0),
      land_area_sqm: round(sqftToSqm(landAreaSqft), 2),
      road_width_mtrs: round(roadWidthMtrs, 2),
      base_far: round(baseFar, 3),
      additional_far: round(additionalFar, 3),
      max_far: round(maxFar, 3),
      gross_base_buildable_area_sqft: grossBaseBuildable !== null ? round(grossBaseBuildable, 0) : null,
      gross_additional_buildable_area_sqft: round(grossAdditionalBuildable, 0),
      gross_max_buildable_area_sqft: grossMaxBuildable !== null ? round(grossMaxBuildable, 0) : null,
      base_buildable_area_sqft: screeningBaseBuildable !== null ? round(screeningBaseBuildable, 0) : null,
      additional_buildable_area_sqft: round(screeningAdditionalBuildable, 0),
      max_buildable_area_sqft: screeningMaxBuildable !== null ? round(screeningMaxBuildable, 0) : null,
      ground_coverage_pct: round(groundCoveragePct, 2),
      max_ground_coverage_sqft: groundCoveragePct ? round((landAreaSqft * groundCoveragePct) / 100, 0) : null,
      screening_footprint_limit_sqft:
        Number.isFinite(screeningFootprintSqft) ? round(screeningFootprintSqft, 0) : null,
      effective_plot_area_sqft: round(calculationAreaSqft, 0),
      setback_deduction_sqft: setbackImpact.setback_deduction_sqft,
      setback_deduction_pct: setbackImpact.setback_deduction_pct,
      setback_input_status: setbackImpact.setback_input_status,
      setback_method: setbackImpact.method,
      estimated_frontage_m: setbackImpact.estimated_frontage_m || null,
      estimated_depth_m: setbackImpact.estimated_depth_m || null,
      front_setback_m: round(rule.front_setback_m, 2),
      rear_setback_m: round(rule.rear_setback_m, 2),
      side_setback_m: round(rule.side_setback_m, 2),
    },
    rule: {
      id: rule.id,
      plan_version: rule.plan_version,
      plan_status: rule.plan_status || 'operative',
      source_section: rule.source_section,
      source_page: rule.source_page,
      review_status: rule.review_status,
      confidence_score: round(rule.confidence_score, 3),
    },
  };
};
