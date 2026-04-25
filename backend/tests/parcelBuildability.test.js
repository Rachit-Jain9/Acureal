const {
  computeBuildabilityFromRule,
  estimateSetbackImpact,
  selectFarRule,
  sqftToSqm,
} = require('../src/utils/parcelBuildability');

const residentialPzaRules = [
  {
    id: 'r-pz-a-360-750',
    zone_code: 'R-PZ-A',
    planning_zone: 'A',
    land_use_family: 'residential',
    plot_area_min_sqm: 360,
    plot_area_max_sqm: 750,
    road_width_min_m: 15.5,
    road_width_max_m: 18.5,
    base_far: 1.8,
    additional_far: 0.45,
    max_far: 2.25,
    ground_coverage_pct: 65,
    front_setback_m: 2.5,
    source_page: 63,
    source_section: 'Table 6: FAR and ground coverage for residential category in Planning Zone A up to 20,000 sqm',
    plan_status: 'draft_reference',
    review_status: 'approved',
    confidence_score: 0.95,
  },
];

const residentialPzbRules = [
  {
    id: 'r-pz-b-2000-4000',
    zone_code: 'R-PZ-B',
    planning_zone: 'B',
    land_use_family: 'residential',
    plot_area_min_sqm: 2000,
    plot_area_max_sqm: 4000,
    road_width_min_m: 24.5,
    road_width_max_m: 30.5,
    base_far: 2,
    additional_far: 1,
    max_far: 3,
    ground_coverage_pct: 50,
    source_page: 64,
    source_section: 'Table 7: FAR and ground coverage for residential category in Planning Zone B up to 20,000 sqm',
    plan_status: 'draft_reference',
    review_status: 'approved',
    confidence_score: 0.95,
  },
];

describe('parcel buildability FAR matrix utilities', () => {
  test('matches residential PZ-A by plot-size and road-width band', () => {
    const landAreaSqft = 500 * 10.76391041671;
    const { rule, reason } = selectFarRule(residentialPzaRules, {
      landAreaSqft,
      roadWidthMtrs: 18,
      landUseFamily: 'residential',
    });

    expect(reason).toBeNull();
    expect(rule.id).toBe('r-pz-a-360-750');
  });

  test('calculates base, additional, max FAR and ground coverage from matched rule', () => {
    const property = {
      land_area_sqft: 500 * 10.76391041671,
      road_width_mtrs: 18,
    };
    const result = computeBuildabilityFromRule({
      property,
      zone: { zone_code: 'R-PZ-A', planning_zone: 'A' },
      rule: residentialPzaRules[0],
    });

    expect(result.status).toBe('needs_verification');
    expect(result.values.base_far).toBe(1.8);
    expect(result.values.additional_far).toBe(0.45);
    expect(result.values.max_far).toBe(2.25);
    expect(result.values.gross_max_buildable_area_sqft).toBeCloseTo(property.land_area_sqft * 2.25, 0);
    expect(result.values.max_buildable_area_sqft).toBeLessThan(result.values.gross_max_buildable_area_sqft);
    expect(result.values.setback_deduction_pct).toBeGreaterThan(0);
    expect(result.values.setback_input_status).toBe('partial');
    expect(result.values.max_ground_coverage_sqft).toBeCloseTo(property.land_area_sqft * 0.65, 0);
    expect(result.citations[0].page).toBe(63);
  });

  test('matches residential PZ-B higher FAR band from Volume 6 Table 7', () => {
    const landAreaSqft = 2500 * 10.76391041671;
    const { rule } = selectFarRule(residentialPzbRules, {
      landAreaSqft,
      roadWidthMtrs: 30,
      landUseFamily: 'residential',
    });

    expect(sqftToSqm(landAreaSqft)).toBeCloseTo(2500, 5);
    expect(rule.max_far).toBe(3);
    expect(rule.additional_far).toBe(1);
  });

  test('returns explicit fallback instead of inventing buildability when no rule matches', () => {
    const { rule, reason } = selectFarRule(residentialPzaRules, {
      landAreaSqft: 900 * 10.76391041671,
      roadWidthMtrs: 12,
      landUseFamily: 'residential',
    });
    const result = computeBuildabilityFromRule({
      property: { land_area_sqft: 9000, road_width_mtrs: 12, permissible_fsi: 1.5 },
      rule,
    });

    expect(rule).toBeNull();
    expect(reason).toBe('no_matching_far_rule');
    expect(result.status).toBe('needs_verification');
    expect(result.source).toBe('user_provided_fsi');
  });

  test('uses supplied frontage and depth when estimating setback impact', () => {
    const impact = estimateSetbackImpact({
      property: {
        land_area_sqft: 1000 * 10.76391041671,
        frontage_mtrs: 25,
        depth_mtrs: 40,
      },
      rule: {
        front_setback_m: 3,
        rear_setback_m: 2,
        side_setback_m: 1,
      },
    });

    expect(impact.method).toBe('user_dimensions');
    expect(impact.setback_input_status).toBe('complete');
    expect(impact.setback_deduction_pct).toBeGreaterThan(10);
    expect(impact.effective_area_sqft).toBeLessThan(1000 * 10.76391041671);
  });
});
