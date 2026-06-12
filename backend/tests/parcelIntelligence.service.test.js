jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/guidance.service', () => ({
  findGuidanceMatches: jest.fn(),
}));

jest.mock('../src/services/adapters/landeed.adapter', () => ({
  getStatus: jest.fn(),
  lookupGuidanceValue: jest.fn(),
}));

jest.mock('../src/services/adapters/kgis.adapter', () => ({
  fetchKgisContext: jest.fn(),
}));

jest.mock('../src/services/adapters/osmRoadWidth.adapter', () => ({
  fetchRoadWidth: jest.fn(),
}));

// Mock the statutory-plan resolver so its own DB reads don't perturb the
// order-dependent `query` mock sequences below. `resolved:false` keeps the
// pre-registry behaviour: no plan scoping on loadFarRules, no audit write.
jest.mock('../src/services/regulatory/resolveStatutoryPlan', () => ({
  resolveStatutoryPlan: jest.fn().mockResolvedValue({
    resolved: false,
    authority: null,
    plan: null,
    method: 'unresolved',
    confidence: 0,
    basis: 'mock',
    needs_authority_confirmation: true,
    alternates: [],
  }),
  resolvePlanById: jest.fn().mockResolvedValue(null),
  logJurisdictionResolution: jest.fn().mockResolvedValue(null),
}));

const { query } = require('../src/config/database');
const guidanceService = require('../src/services/guidance.service');
const landeedAdapter = require('../src/services/adapters/landeed.adapter');
const kgisAdapter = require('../src/services/adapters/kgis.adapter');
const parcelIntelligenceService = require('../src/services/parcelIntelligence.service');

const baseProperty = {
  id: 'prop-1',
  name: 'Hebbal parcel',
  display_name: 'Hebbal parcel',
  address: 'Hebbal Main Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  survey_number: '12',
  land_area_sqft: 10763.91,
  road_width_mtrs: 18,
  lat: 13.035,
  lng: 77.59,
  zoning: 'residential',
  property_type: 'land',
  permissible_fsi: null,
  zone_notes: null,
};

const residentialZone = {
  id: 'zone-1',
  zone_code: 'R-PZ-A',
  zone_name: 'Residential PZ-A',
  planning_zone: 'A',
  plan_version: 'RMP 2031 Draft',
  plan_status: 'draft_reference',
};

const commercialZone = {
  id: 'zone-2',
  zone_code: 'C-3-PZ-A',
  zone_name: 'Commercial PZ-A',
  planning_zone: 'A',
  plan_version: 'RMP 2031 Draft',
  plan_status: 'draft_reference',
};

const farRule = {
  id: 'rule-1',
  org_id: null,
  zone_code: 'R-PZ-A',
  planning_zone: 'A',
  land_use_family: 'residential',
  plot_area_min_sqm: 750,
  plot_area_max_sqm: 2000,
  road_width_min_m: 15.5,
  road_width_max_m: 18.5,
  base_far: 1.8,
  additional_far: 0.6,
  max_far: 2.4,
  ground_coverage_pct: 60,
  front_setback_m: 3.5,
  source_page: 63,
  source_section: 'Table 6',
  plan_version: 'RMP 2031 Draft',
  plan_status: 'draft_reference',
  review_status: 'approved',
  confidence_score: 0.95,
};

const guidanceMatched = {
  status: 'matched',
  confidence: 0.72,
  message: 'Guidance value matched from approved reference data.',
  selected: {
    id: 'gv-1',
    locality: 'Hebbal',
    road_name: 'Main Road',
    value_inr_per_sqft: 12000,
    citation: { id: 'guidance-value-gv-1', status: 'global_reference' },
  },
  citations: [{ id: 'guidance-value-gv-1', kind: 'guidance_value' }],
};

const guidanceMissing = {
  status: 'not_available',
  confidence: 0,
  message: 'No approved guidance value rows are available for this property.',
  selected: null,
  citations: [],
};

describe('parcelIntelligence.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    guidanceService.findGuidanceMatches.mockResolvedValue(guidanceMissing);
    landeedAdapter.getStatus.mockReturnValue({
      provider: 'landeed',
      status: 'not_configured',
      message: 'Landeed business API credentials are not configured.',
    });
  });

  test('returns needs-verification output when no zone is assigned', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ ...baseProperty, zone: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'snapshot-prior', generated_at: new Date().toISOString() }] })
      .mockResolvedValueOnce({ rows: [] })   // kgis_cache read
      .mockResolvedValueOnce({ rows: [] });  // osm_road_cache read (T6)

    const result = await parcelIntelligenceService.getParcelIntelligence('prop-1', 'user-1');

    expect(result.status).toBe('needs_verification');
    expect(result.zoning.status).toBe('needs_verification');
    expect(result.buildability.status).toBe('needs_verification');
    expect(result.guidance_value.vendor.status).toBe('not_configured');
    expect(result.red_flags.map((flag) => flag.label)).toContain('Planning zone not assigned');
    expect(result.snapshot_id).toBe('snapshot-prior');
    expect(result.osm_road.status).toBe('not_requested');
    expect(query).toHaveBeenCalledTimes(4);
  });

  test('matches FAR rule, guidance value, and cached K-GIS context without refresh', async () => {
    guidanceService.findGuidanceMatches.mockResolvedValue(guidanceMatched);
    query
      .mockResolvedValueOnce({ rows: [{ ...baseProperty, zone: residentialZone }] })
      .mockResolvedValueOnce({ rows: [farRule] })
      .mockResolvedValueOnce({ rows: [{ id: 'snapshot-prior', generated_at: new Date().toISOString() }] })
      .mockResolvedValueOnce({
        rows: [
          {
            provider_status: 'matched',
            confidence_score: 0.65,
            hierarchy: { village: 'Hebbal', taluk: 'Bengaluru North' },
            survey_numbers: [{ survey_number: '12' }],
            geometry_geojson: null,
            updated_at: '2026-04-25T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })   // osm_road_cache read (T6)
      .mockResolvedValueOnce({ rows: [{ properties: null, guidance: null, evidence: null, flag_counts: null }] });  // locality intelligence (T8)

    const result = await parcelIntelligenceService.getParcelIntelligence('prop-1', 'user-1');

    expect(result.zoning.zone_code).toBe('R-PZ-A');
    expect(result.buildability.values.max_far).toBe(2.4);
    expect(result.buildability.values.gross_max_buildable_area_sqft).toBeCloseTo(25833, 0);
    expect(result.buildability.values.max_buildable_area_sqft).toBeLessThan(result.buildability.values.gross_max_buildable_area_sqft);
    expect(result.verdict.label).toBe('Proceed With Caution');
    expect(result.guidance_value.selected.value_inr_per_sqft).toBe(12000);
    expect(result.kgis.status).toBe('matched');
    expect(result.buckets.verified.some((item) => item.label === 'Reviewed FAR matrix rule')).toBe(true);
  });

  test('scopes FAR rules to the resolved statutory plan and surfaces the jurisdiction block', async () => {
    const { resolveStatutoryPlan } = require('../src/services/regulatory/resolveStatutoryPlan');
    resolveStatutoryPlan.mockResolvedValueOnce({
      resolved: true,
      authority: { id: 'auth-bda', code: 'BDA', name: 'Bangalore Development Authority', kind: 'lpa', status: 'active', status_note: 'note' },
      plan: { id: 'plan-rmp2015', code: 'RMP_2015', name: 'Revised Master Plan 2015 — Volume III', legal_status: 'operative', version_label: 'base-2007', notes: null },
      method: 'taluk_alias',
      confidence: 0.85,
      basis: 'K-GIS taluk = Bangalore South → Bangalore Development Authority',
      needs_authority_confirmation: false,
      alternates: [],
    });
    query
      .mockResolvedValueOnce({ rows: [{ ...baseProperty, zone: residentialZone, auto_derived_taluk: 'Bangalore South' }] }) // property
      .mockResolvedValueOnce({ rows: [farRule] })  // far rules (must carry the plan filter)
      .mockResolvedValueOnce({ rows: [] })         // snapshot meta
      .mockResolvedValueOnce({ rows: [] })         // kgis cache
      .mockResolvedValueOnce({ rows: [] });        // osm cache

    const result = await parcelIntelligenceService.getParcelIntelligence('prop-1', 'user-1');

    // far_rules is the 2nd query call; the resolved plan id must be threaded as $4.
    const farCall = query.mock.calls[1];
    expect(farCall[0]).toContain('fr.statutory_plan_id = $4');
    expect(farCall[1]).toContain('plan-rmp2015');
    expect(result.statutory_plan.plan_code).toBe('RMP_2015');
    expect(result.statutory_plan.authority_code).toBe('BDA');
    expect(result.statutory_plan.method).toBe('taluk_alias');
  });

  test('the analyst-assigned zone plan overrides the taluk default (fixes blank Anekal FAR)', async () => {
    const { resolveStatutoryPlan, resolvePlanById } = require('../src/services/regulatory/resolveStatutoryPlan');
    // Resolver defaults to BDA (no taluk) — the WRONG plan for an assigned Anekal zone.
    resolveStatutoryPlan.mockResolvedValueOnce({
      resolved: true,
      authority: { id: 'auth-bda', code: 'BDA', name: 'Bangalore Development Authority' },
      plan: { id: 'plan-rmp2015', code: 'RMP_2015', name: 'RMP 2015', legal_status: 'operative' },
      method: 'default_bda', confidence: 0.3, basis: 'no taluk', needs_authority_confirmation: true, alternates: [],
    });
    // The analyst-assigned zone pins the Anekal plan → authoritative.
    resolvePlanById.mockResolvedValueOnce({
      authority: { id: 'auth-anekal', code: 'ANEKAL_PA', name: 'Anekal Planning Authority', kind: 'lpa', status: 'active', status_note: null },
      plan: { id: 'plan-anekal', code: 'ANEKAL_LPA_MP_2031', name: 'Anekal LPA MP 2031 (BMRDA)', legal_status: 'operative', version_label: 'base-2014', notes: null },
    });
    const anekalZone = { ...residentialZone, zone_code: 'AN-R', statutory_plan_id: 'plan-anekal', plan_version: 'Anekal LPA MP 2031', plan_status: 'operative' };
    const anekalRule = { ...farRule, zone_code: 'AN-R', plan_version: 'Anekal LPA MP 2031', plan_status: 'operative' };
    query
      .mockResolvedValueOnce({ rows: [{ ...baseProperty, zone: anekalZone }] })  // property (zone pins plan-anekal)
      .mockResolvedValueOnce({ rows: [anekalRule] })  // far rules — must be scoped to plan-anekal
      .mockResolvedValueOnce({ rows: [] })            // snapshot meta
      .mockResolvedValueOnce({ rows: [] })            // kgis cache
      .mockResolvedValueOnce({ rows: [] });           // osm cache

    const result = await parcelIntelligenceService.getParcelIntelligence('prop-1', 'user-1');

    // FAR query scoped to the ZONE's plan (Anekal), not the BDA default.
    expect(query.mock.calls[1][1]).toContain('plan-anekal');
    expect(result.statutory_plan.plan_code).toBe('ANEKAL_LPA_MP_2031');
    expect(result.statutory_plan.authority_code).toBe('ANEKAL_PA');
    expect(result.statutory_plan.method).toBe('assigned_zone');
    expect(result.statutory_plan.needs_authority_confirmation).toBe(false);
    // FAR actually resolved (not blank) — the symptom this fix addresses.
    expect(result.buildability.values?.max_far).toBe(2.4);
  });

  test('refresh calls vendor and K-GIS adapters, caches context, and writes snapshot', async () => {
    guidanceService.findGuidanceMatches.mockResolvedValue(guidanceMatched);
    landeedAdapter.lookupGuidanceValue.mockResolvedValue({
      provider: 'landeed',
      status: 'not_configured',
      message: 'No credentials.',
    });
    kgisAdapter.fetchKgisContext.mockResolvedValue({
      provider: 'kgis',
      status: 'matched',
      confidence: 0.65,
      message: 'K-GIS hierarchy and survey geometry returned. Treat as reference only.',
      hierarchy: { village: 'Hebbal' },
      survey_numbers: [{ survey_number: '12' }],
      geometry_geojson: null,
      raw: { ok: true },
    });

    query
      .mockResolvedValueOnce({ rows: [{ ...baseProperty, zone: residentialZone }] })  // property
      .mockResolvedValueOnce({ rows: [farRule] })                                       // far rules
      .mockResolvedValueOnce({ rows: [] })                                              // latest snapshot meta
      .mockResolvedValueOnce({ rows: [] })                                              // kgis_cache UPDATE (no row)
      .mockResolvedValueOnce({ rows: [{ id: 'cache-1' }] })                             // kgis_cache INSERT
      .mockResolvedValueOnce({ rows: [] })                                              // osm_road_cache read (baseProperty has road_width=18, so OSM live skipped)
      .mockResolvedValueOnce({ rows: [{ properties: null, guidance: null, evidence: null, flag_counts: null }] })  // locality intelligence (T8)
      .mockResolvedValueOnce({ rows: [{ id: 'snapshot-1' }] });                         // snapshot INSERT

    const result = await parcelIntelligenceService.refreshParcelIntelligence('prop-1', 'user-1');

    expect(landeedAdapter.lookupGuidanceValue).toHaveBeenCalledWith(expect.objectContaining({ id: 'prop-1' }));
    expect(kgisAdapter.fetchKgisContext).toHaveBeenCalledWith(expect.objectContaining({ id: 'prop-1' }));
    expect(result.kgis.status).toBe('matched');
    expect(query.mock.calls[3][0]).toContain('UPDATE regulatory_data.kgis_cache');
    expect(query.mock.calls[4][0]).toContain('INSERT INTO regulatory_data.kgis_cache');
    expect(query.mock.calls[7][0]).toContain('INSERT INTO regulatory_data.parcel_intelligence_snapshots');
  });

  test('classifies commercial zone codes even when property zoning is default residential', () => {
    const result = parcelIntelligenceService.normalizeLandUseFamily(
      { zoning: 'residential', property_type: 'land' },
      commercialZone
    );

    expect(result).toBe('commercial');
  });
});

// ── Parity guard for the red-flag registry extraction ──────────────────────
//
// The body of `buildRedFlags` from parcelIntelligence.service.js (pre-refactor)
// is inlined below verbatim and compared against the new
// engines/parcelRedFlags.engine.runParcelRedFlags output. If the engine ever
// drifts from the original 10-rule contract, this test fails before the
// extraction can land. Once the engine is settled this guard can be removed
// in a follow-up — by then we'll have the engine's own per-rule unit tests as
// the primary contract.

const { runParcelRedFlags } = require('../src/engines/parcelRedFlags.engine');

const toNumberLegacy = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const legacyBuildRedFlags = ({ property, zone, buildability, guidance, kgis, landeed }) => {
  const flags = [];

  if (!zone?.zone_code) {
    flags.push({
      severity: 'high',
      label: 'Planning zone not assigned',
      detail: 'Assign a reviewed RMP zone before relying on FAR/buildability output.',
    });
  }

  if (!toNumberLegacy(property.land_area_sqft)) {
    flags.push({ severity: 'high', label: 'Land area missing', detail: 'Buildability cannot be calculated without land extent.' });
  }

  if (toNumberLegacy(property.road_width_mtrs) === null) {
    flags.push({ severity: 'medium', label: 'Road width missing', detail: 'FAR matrix matching needs abutting road width.' });
  }

  if (buildability?.status === 'needs_verification') {
    flags.push({
      severity: 'medium',
      label: 'Buildability pending verification',
      detail: buildability.message,
    });
  }

  if (buildability?.values?.setback_input_status === 'partial') {
    flags.push({
      severity: 'medium',
      label: 'Setback inputs are partial',
      detail: 'The screening buildable area applies available setback rules, but plot frontage/depth and full side/rear setback rules should be verified.',
    });
  }

  if (!['matched', 'low_confidence'].includes(guidance?.status)) {
    flags.push({
      severity: 'medium',
      label: 'Guidance value not matched',
      detail: guidance?.message || 'Upload a guidance report or configure approved IGR rows.',
    });
  } else if (guidance.status === 'low_confidence') {
    flags.push({
      severity: 'medium',
      label: 'Low-confidence guidance match',
      detail: 'Analyst review is required before using this guidance value in IC material.',
    });
  }

  if (landeed?.status === 'not_configured') {
    flags.push({
      severity: 'low',
      label: 'Vendor guidance backup not configured',
      detail: 'Landeed can remain disabled, but API credentials are required for vendor-backed guidance refresh.',
    });
  }

  if (kgis?.status === 'not_requested') {
    flags.push({
      severity: 'low',
      label: 'K-GIS not refreshed',
      detail: 'Run refresh when coordinates are available to cache reference hierarchy/survey context.',
    });
  }

  if (zone?.plan_status === 'draft' || buildability?.rule?.plan_status === 'draft_reference') {
    flags.push({
      severity: 'medium',
      label: 'RMP status is draft/reference',
      detail: 'Use as screening intelligence only until live authority status is verified.',
    });
  }

  return flags;
};

const fixtures = {
  // F1 — pristine: zone assigned, area+road set, guidance matched, K-GIS matched.
  pristine: {
    property: { land_area_sqft: 5000, road_width_mtrs: 18 },
    zone: { zone_code: 'R-PZ-A', plan_status: 'live' },
    buildability: {
      status: 'reference_match',
      rule: { plan_status: 'live' },
      values: { setback_input_status: 'complete' },
      message: null,
    },
    guidance: { status: 'matched', message: 'Matched.' },
    kgis: { status: 'matched' },
    landeed: { status: 'matched' },
  },
  // F2 — no zone (cascades into guidance not matched as a separate rule).
  noZone: {
    property: { land_area_sqft: 5000, road_width_mtrs: 18 },
    zone: null,
    buildability: {
      status: 'reference_match',
      rule: { plan_status: 'live' },
      values: { setback_input_status: 'complete' },
    },
    guidance: { status: 'not_available', message: null },
    kgis: { status: 'matched' },
    landeed: { status: 'matched' },
  },
  // F3 — no land area, otherwise pristine.
  noLandArea: {
    property: { land_area_sqft: null, road_width_mtrs: 18 },
    zone: { zone_code: 'R-PZ-A', plan_status: 'live' },
    buildability: {
      status: 'reference_match',
      rule: { plan_status: 'live' },
      values: { setback_input_status: 'complete' },
    },
    guidance: { status: 'matched' },
    kgis: { status: 'matched' },
    landeed: { status: 'matched' },
  },
  // F4 — no road, buildability pending, setback partial.
  buildabilityCascade: {
    property: { land_area_sqft: 5000, road_width_mtrs: null },
    zone: { zone_code: 'R-PZ-A', plan_status: 'live' },
    buildability: {
      status: 'needs_verification',
      message: 'Match a reviewed FAR matrix rule before reliance.',
      rule: { plan_status: 'live' },
      values: { setback_input_status: 'partial' },
    },
    guidance: { status: 'matched' },
    kgis: { status: 'matched' },
    landeed: { status: 'matched' },
  },
  // F5 — guidance low confidence, landeed missing, kgis not run.
  vendorAndGuidanceWeak: {
    property: { land_area_sqft: 5000, road_width_mtrs: 18 },
    zone: { zone_code: 'R-PZ-A', plan_status: 'live' },
    buildability: {
      status: 'reference_match',
      rule: { plan_status: 'live' },
      values: { setback_input_status: 'complete' },
    },
    guidance: { status: 'low_confidence' },
    kgis: { status: 'not_requested' },
    landeed: { status: 'not_configured' },
  },
  // F6 — RMP draft (zone or rule).
  rmpDraft: {
    property: { land_area_sqft: 5000, road_width_mtrs: 18 },
    zone: { zone_code: 'R-PZ-A', plan_status: 'draft' },
    buildability: {
      status: 'reference_match',
      rule: { plan_status: 'draft_reference' },
      values: { setback_input_status: 'complete' },
    },
    guidance: { status: 'matched' },
    kgis: { status: 'matched' },
    landeed: { status: 'matched' },
  },
  // F7 — empty inputs (defensive). Engine must not throw.
  empty: {
    property: {},
    zone: null,
    buildability: null,
    guidance: null,
    kgis: null,
    landeed: null,
  },
};

describe('parcelRedFlags engine — parity vs legacy buildRedFlags', () => {
  test.each(Object.entries(fixtures))(
    'fixture %s: registry output matches inlined legacy output exactly',
    (_name, input) => {
      const legacy = legacyBuildRedFlags(input);
      const next = runParcelRedFlags(input);
      expect(next).toEqual(legacy);
    },
  );

  test('high/medium/low counts are stable across all fixtures', () => {
    for (const [, input] of Object.entries(fixtures)) {
      const legacy = legacyBuildRedFlags(input);
      const next = runParcelRedFlags(input);
      const summarise = (flags) => ({
        high: flags.filter((f) => f.severity === 'high').length,
        medium: flags.filter((f) => f.severity === 'medium').length,
        low: flags.filter((f) => f.severity === 'low').length,
      });
      expect(summarise(next)).toEqual(summarise(legacy));
    }
  });
});
