const SQFT_PER_SQM = 10.76391041671;

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const round = (value, precision = 2) => {
  const numeric = toNumber(value);
  if (numeric === null) return null;
  const factor = 10 ** precision;
  return Math.round(numeric * factor) / factor;
};

const sqftToSqm = (sqft) => {
  const numeric = toNumber(sqft);
  return numeric === null ? null : numeric / SQFT_PER_SQM;
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

const citeFarRule = (rule = {}) => ({
  id: rule.id ? `far-rule-${rule.id}` : 'far-rule',
  kind: 'rmp_far_rule',
  label: rule.source_section || 'RMP 2031 FAR rule',
  source_title: rule.source_title || 'RMP 2031 Volume 6 Zoning Regulations',
  source_url: rule.source_url || null,
  authority: rule.authority_name || 'BDA / RMP 2031 reference',
  page: rule.source_page || null,
  section: rule.source_section || null,
  status: rule.plan_status || 'draft_reference',
});

const selectFarRule = (rules = [], { landAreaSqft, roadWidthMtrs, landUseFamily } = {}) => {
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

const computeBuildabilityFromRule = ({ property = {}, zone = null, rule = null } = {}) => {
  const landAreaSqft = toNumber(property.land_area_sqft);
  const roadWidthMtrs = toNumber(property.road_width_mtrs);
  const manualFsi = toNumber(property.permissible_fsi);

  if (!landAreaSqft) {
    return {
      status: 'needs_verification',
      source: 'missing_input',
      message: 'Land area is required before buildable area can be calculated.',
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

  return {
    status: additionalFar > 0 ? 'needs_verification' : 'reference_match',
    source: rule.org_id ? 'org_override' : 'global_reference',
    message:
      additionalFar > 0
        ? 'Base FAR is reference-matched. Additional/TDR FAR remains pending authority and project-specific verification.'
        : 'FAR is matched to an approved reference rule.',
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
      base_buildable_area_sqft: baseFar ? round(landAreaSqft * baseFar, 0) : null,
      additional_buildable_area_sqft: additionalFar ? round(landAreaSqft * additionalFar, 0) : 0,
      max_buildable_area_sqft: maxFar ? round(landAreaSqft * maxFar, 0) : null,
      ground_coverage_pct: round(groundCoveragePct, 2),
      max_ground_coverage_sqft: groundCoveragePct ? round((landAreaSqft * groundCoveragePct) / 100, 0) : null,
      front_setback_m: round(rule.front_setback_m, 2),
      rear_setback_m: round(rule.rear_setback_m, 2),
      side_setback_m: round(rule.side_setback_m, 2),
    },
    rule: {
      id: rule.id,
      plan_version: rule.plan_version,
      plan_status: rule.plan_status || 'draft_reference',
      source_section: rule.source_section,
      source_page: rule.source_page,
      review_status: rule.review_status,
      confidence_score: round(rule.confidence_score, 3),
    },
  };
};

module.exports = {
  SQFT_PER_SQM,
  toNumber,
  round,
  sqftToSqm,
  selectFarRule,
  computeBuildabilityFromRule,
  citeFarRule,
};
