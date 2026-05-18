'use strict';

// Mock all the external dependencies the service fans out to. The
// service's job is orchestration + payload shape — the underlying
// adapters have their own tests.
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));
jest.mock('../src/utils/geocode', () => ({
  geocodeAddress: jest.fn(),
}));
jest.mock('../src/services/adapters/kgis.adapter', () => ({
  fetchKgisContext: jest.fn(),
}));
jest.mock('../src/services/masterplan.service', () => ({
  searchBbmpStreets: jest.fn(),
}));

const { query } = require('../src/config/database');
const { geocodeAddress } = require('../src/utils/geocode');
const { fetchKgisContext } = require('../src/services/adapters/kgis.adapter');
const masterplanService = require('../src/services/masterplan.service');

const parcelContextService = require('../src/services/parcelContext.service');
const { deriveParcelContextFromAddress, _internal } = parcelContextService;

const stubStreetMatch = {
  id: 'street-uuid-1',
  street_name_en: 'BRIGADE ROAD',
  ward_no: 117,
  page_number: 23,
  aro_section: 'ARO South',
  zone_code: 'A',
  guidance_value_band_min_inr: 35000,
  guidance_value_band_max_inr: 50000,
  row_excerpt: 'Brigade Road, central CBD',
};

const stubKgis = {
  provider: 'kgis',
  status: 'matched',
  confidence: 0.65,
  message: 'OK',
  hierarchy: { district: 'Bangalore Urban', taluk: 'Bangalore South', hobli: 'Bangalore', village: 'Begur' },
  survey_numbers: [{ survey_number: '12/3', village_code: 'V1' }],
  selected_survey: { survey_number: '12/3', village_code: 'V1' },
  geometry_geojson: { type: 'Polygon', coordinates: [[[77.6, 12.97], [77.61, 12.97], [77.61, 12.98], [77.6, 12.98], [77.6, 12.97]]] },
  raw: {},
};

const stubPdFactRow = {
  fact_value: [
    { pd_code: 'PD-01', pd_name: 'Central Business District', population_2011: 593883, area_ha: 2774.3, gross_density_pph: 214, wards_in_pd: 19, villages_count: 0, notes: 'Population (2011 Census): 593,883; Area of PD: 2774.3 ha; ...' },
    { pd_code: 'PD-11', pd_name: 'Whitefield / Kadugodi growth belt', population_2011: 207212, area_ha: 4238.4, gross_density_pph: 49, wards_in_pd: 4, villages_count: 0 },
  ],
};

const stubPdListRow = (codeName) => ({
  rows: [
    { id: 'pd-1', pd_code: 'PD-01', pd_name: 'Central Business District', city: 'Bengaluru' },
    { id: 'pd-2', pd_code: 'PD-11', pd_name: 'Whitefield / Kadugodi growth belt', city: 'Bengaluru' },
    { id: 'pd-3', pd_code: 'PD-14', pd_name: 'Banashankari / Jayanagar', city: 'Bengaluru' },
  ],
});

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so mockResolvedValueOnce queues from
  // prior tests don't leak forward when those tests short-circuited the call.
  jest.resetAllMocks();
  // Default DB query routing: planning_districts list, then the rich PD
  // demographics fact, then the city-level callouts fact list.
  query.mockImplementation((sql) => {
    if (/FROM regulatory_data\.planning_districts/i.test(sql) && /pd_code/i.test(sql)) {
      return Promise.resolve(stubPdListRow());
    }
    if (/jsonb_typeof\(fact_value\) = 'array'/i.test(sql) && /planning_districts/i.test(sql)) {
      return Promise.resolve({ rows: [stubPdFactRow] });
    }
    if (/fact_type IN \('sdz', 'heritage', 'environmental', 'road_network'\)/.test(sql)) {
      return Promise.resolve({
        rows: [
          { fact_type: 'sdz', fact_key: 'special_development_zones', fact_value: [{ name: 'SDZ Sarjapur Road' }], source_section: '10.1', page_number: 88, confidence_score: 0.85 },
          { fact_type: 'heritage', fact_key: 'heritage_zones', fact_value: [{ name: 'Central Administrative Heritage Zone' }], source_section: '11.2', page_number: 145, confidence_score: 0.85 },
        ],
      });
    }
    return Promise.resolve({ rows: [] });
  });
});

describe('parcelContext.service — input validation', () => {
  test('throws 400 when neither address nor coords are provided', async () => {
    await expect(deriveParcelContextFromAddress({})).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('parcelContext.service — address-only path', () => {
  test('geocodes the address and fans out to every authoritative source', async () => {
    geocodeAddress.mockResolvedValueOnce({
      found: true,
      lat: 12.9750,
      lng: 77.6050,
      displayName: '100 Brigade Road, Bengaluru, Karnataka',
      placeId: 'pid-x',
      provider: 'google',
      confidence: 0.92,
      status: 'verified',
    });
    fetchKgisContext.mockResolvedValueOnce(stubKgis);
    masterplanService.searchBbmpStreets.mockResolvedValueOnce({
      rows: [stubStreetMatch],
      summary: { enriched_pct: 100 },
    });

    const ctx = await deriveParcelContextFromAddress({ address: '100 Brigade Road' });

    expect(geocodeAddress).toHaveBeenCalledWith('100 Brigade Road', 'Bengaluru', 'Karnataka', null);
    expect(fetchKgisContext).toHaveBeenCalledWith({ lat: 12.9750, lng: 77.6050 });
    expect(masterplanService.searchBbmpStreets).toHaveBeenCalled();

    expect(ctx.coordinates.lat).toBe(12.9750);
    expect(ctx.coordinates.lng).toBe(77.6050);
    expect(ctx.coordinates.formatted_address).toMatch(/Brigade Road/);
    expect(ctx.bbmpJurisdiction.withinBbmp).toBe(true);
    expect(ctx.bbmpJurisdiction.ward).toEqual(expect.objectContaining({ ward_no: 117 }));
    expect(ctx.streetIndex.match).toEqual(expect.objectContaining({ street_name_en: 'BRIGADE ROAD', zone_code: 'A' }));
    expect(ctx.bbmpZone).toEqual(expect.objectContaining({ zone_code: 'A', guidance_value_band_min_inr: 35000 }));
    expect(ctx.kgis.hierarchy.village).toBe('Begur');
    expect(ctx.applicableWarnings.length).toBeGreaterThan(0);
    expect(ctx.verifyLinks.length).toBeGreaterThan(0);
    expect(ctx.aiDisclaimer).toMatch(/AI-assisted/);
    expect(ctx.derivedAt).toMatch(/T/);
  });
});

describe('parcelContext.service — coords-only path', () => {
  test('skips the geocode call when lat/lng are supplied directly', async () => {
    fetchKgisContext.mockResolvedValueOnce(stubKgis);
    masterplanService.searchBbmpStreets.mockResolvedValueOnce({ rows: [], summary: {} });

    const ctx = await deriveParcelContextFromAddress({ lat: 12.972, lng: 77.598 });

    expect(geocodeAddress).not.toHaveBeenCalled();
    expect(fetchKgisContext).toHaveBeenCalledWith({ lat: 12.972, lng: 77.598 });
    expect(ctx.coordinates.source).toBe('caller_supplied');
    expect(ctx.coordinates.confidence).toBe(1.0);
    expect(ctx.bbmpJurisdiction.withinBbmp).toBe(true);
  });
});

describe('parcelContext.service — outside-BMA graceful', () => {
  test('marks withinBbmp=false and skips BBMP-specific lookups for non-Bengaluru coords', async () => {
    fetchKgisContext.mockResolvedValueOnce({
      provider: 'kgis', status: 'partial', confidence: 0.35, hierarchy: { district: 'Mumbai' }, survey_numbers: [], geometry_geojson: null,
    });

    const ctx = await deriveParcelContextFromAddress({ lat: 19.07, lng: 72.88 }); // Mumbai

    expect(ctx.bbmpJurisdiction.withinBbmp).toBe(false);
    expect(ctx.streetIndex.match).toBeNull();
    expect(ctx.bbmpZone).toBeNull();
    expect(masterplanService.searchBbmpStreets).not.toHaveBeenCalled();
  });
});

describe('parcelContext.service — failure modes', () => {
  test('K-GIS down → response still returned with kgis.status=error, no 500', async () => {
    geocodeAddress.mockResolvedValueOnce({
      found: true, lat: 12.97, lng: 77.59, displayName: 'Test', placeId: 'p', provider: 'google', confidence: 0.9, status: 'verified',
    });
    fetchKgisContext.mockRejectedValueOnce(new Error('K-GIS timeout'));
    masterplanService.searchBbmpStreets.mockResolvedValueOnce({ rows: [stubStreetMatch], summary: {} });

    const ctx = await deriveParcelContextFromAddress({ address: 'Test Address' });

    expect(ctx.kgis.status).toBe('error');
    expect(ctx.kgis.message).toMatch(/K-GIS error/);
    expect(ctx.streetIndex.match).not.toBeNull(); // other sources still worked
  });

  test('street index empty → bbmpZone is null, bbmpWard is null, no crash', async () => {
    geocodeAddress.mockResolvedValueOnce({
      found: true, lat: 12.97, lng: 77.59, displayName: 'Test', placeId: 'p', provider: 'google', confidence: 0.9, status: 'verified',
    });
    fetchKgisContext.mockResolvedValueOnce(stubKgis);
    masterplanService.searchBbmpStreets.mockResolvedValueOnce({ rows: [], summary: {} });

    const ctx = await deriveParcelContextFromAddress({ address: 'Some unknown street' });
    expect(ctx.streetIndex.match).toBeNull();
    expect(ctx.bbmpZone).toBeNull();
    expect(ctx.bbmpJurisdiction.ward).toBeNull();
  });

  test('geocoder failure → coords carry status=failed, BBMP lookups skipped', async () => {
    geocodeAddress.mockResolvedValueOnce({ found: false, status: 'failed', message: 'No match' });

    const ctx = await deriveParcelContextFromAddress({ address: 'Nonsense xyzzy' });
    expect(ctx.coordinates.status).toBe('failed');
    expect(ctx.bbmpJurisdiction.withinBbmp).toBe(false);
    expect(ctx.streetIndex.match).toBeNull();
    expect(fetchKgisContext).not.toHaveBeenCalled();
  });
});

describe('parcelContext.service — master plan zone honesty rule', () => {
  test('does NOT auto-derive master_plan_zone (geom not populated)', async () => {
    geocodeAddress.mockResolvedValueOnce({
      found: true, lat: 12.97, lng: 77.59, displayName: 'X', placeId: 'p', provider: 'google', confidence: 0.9, status: 'verified',
    });
    fetchKgisContext.mockResolvedValueOnce(stubKgis);
    masterplanService.searchBbmpStreets.mockResolvedValueOnce({ rows: [], summary: {} });

    const ctx = await deriveParcelContextFromAddress({ address: 'X' });
    expect(ctx.masterPlanZone.auto_derived).toBe(false);
    expect(ctx.masterPlanZone.reason).toMatch(/polygons not yet imported/i);
  });
});

describe('parcelContext.service — low-confidence geocode gate (Jigani regression)', () => {
  // Reproduces the 2026-05-18 screenshot bug: user typed a Jigani
  // address. Google had no key set; Nominatim fell back to central
  // Bengaluru at 45% confidence. Downstream BBMP lookups chained on
  // the WRONG coords and produced Ward 109 / Zone B / PD-08 — none
  // of which apply to Jigani. The gate must skip those lookups when
  // confidence < 0.7 AND mark the bbmpJurisdiction as gated.
  test('gates BBMP street-index + PD lookups when geocoder confidence is below threshold', async () => {
    geocodeAddress.mockResolvedValueOnce({
      found: true,
      lat: 12.97679,           // central Bengaluru (Cubbon Park)
      lng: 77.59008,
      displayName: 'Bengaluru, Karnataka, India',
      placeId: null,
      provider: 'nominatim',
      confidence: 0.45,        // <-- below the 0.7 trust threshold
      status: 'verified',      // Nominatim's loose 'verified' for city-level matches
    });
    fetchKgisContext.mockResolvedValueOnce({
      provider: 'kgis', status: 'matched', confidence: 0.65,
      hierarchy: { taluk: 'Anekal', village: 'Jigani' }, survey_numbers: [], geometry_geojson: null,
    });

    const ctx = await deriveParcelContextFromAddress({
      address: 'block Thyme Park Apartments, No 704 A, Industrial Bypass, Jigani, Bengaluru, Karnataka 560105',
    });

    // The BBMP street search must NOT have fired — coords aren't trusted.
    expect(masterplanService.searchBbmpStreets).not.toHaveBeenCalled();
    // Jurisdiction must claim the gate, not the bbox match.
    expect(ctx.bbmpJurisdiction.withinBbmp).toBe(false);
    expect(ctx.bbmpJurisdiction.detection_method).toBe('low_confidence_geocode_blocked');
    // The streetIndex.match + bbmpZone + planningDistrict must be null.
    expect(ctx.streetIndex.match).toBeNull();
    expect(ctx.bbmpZone).toBeNull();
    expect(ctx.bbmpJurisdiction.ward).toBeNull();
    // K-GIS is still resolved (geographic, not BBMP-scoped).
    expect(ctx.kgis.hierarchy.taluk).toBe('Anekal');
    // The gate object surfaces the reason + message to the frontend.
    expect(ctx.coordinatesGate.gated).toBe(true);
    expect(ctx.coordinatesGate.reason).toBe('low_confidence_geocode');
    expect(ctx.coordinatesGate.confidence).toBe(0.45);
    expect(ctx.coordinatesGate.message).toMatch(/approximate match/i);
    expect(ctx.coordinatesGate.message).toMatch(/Switch to "By coordinates"/i);
    // The first applicable warning must be the gate notice (high severity).
    expect(ctx.applicableWarnings[0]).toMatchObject({
      kind: 'Geocode is approximate',
      fact_type: 'coordinate_uncertainty',
      severity: 'high',
    });
  });

  test('does NOT gate when caller supplies lat/lng directly (confidence is 1.0)', async () => {
    fetchKgisContext.mockResolvedValueOnce(stubKgis);

    const ctx = await deriveParcelContextFromAddress({ lat: 12.972, lng: 77.598 });
    expect(ctx.coordinatesGate.gated).toBe(false);
    expect(ctx.bbmpJurisdiction.withinBbmp).toBe(true);
    expect(ctx.bbmpJurisdiction.detection_method).toBe('bma_bbox_check');
  });

  test('does NOT gate when geocoder returns high confidence + verified status', async () => {
    geocodeAddress.mockResolvedValueOnce({
      found: true, lat: 12.97, lng: 77.59, displayName: '100 Brigade Road, Bengaluru, Karnataka, India',
      provider: 'google', confidence: 0.92, status: 'verified',
    });
    fetchKgisContext.mockResolvedValueOnce(stubKgis);
    masterplanService.searchBbmpStreets.mockResolvedValueOnce({ rows: [stubStreetMatch], summary: {} });

    const ctx = await deriveParcelContextFromAddress({ address: '100 Brigade Road' });
    expect(ctx.coordinatesGate.gated).toBe(false);
    expect(ctx.bbmpJurisdiction.withinBbmp).toBe(true);
    expect(ctx.bbmpJurisdiction.detection_method).toBe('bma_bbox_check');
    expect(masterplanService.searchBbmpStreets).toHaveBeenCalled();
  });

  test('gates when status is "approximate" even if numeric confidence is above threshold', async () => {
    // Edge case: Google's city-level fallback returns confidence ~0.45
    // AND status='approximate'. The status check should fire regardless
    // of numeric value.
    geocodeAddress.mockResolvedValueOnce({
      found: true, lat: 12.97, lng: 77.59, displayName: 'Bengaluru, IN',
      provider: 'google', confidence: 0.85, status: 'approximate',
    });
    fetchKgisContext.mockResolvedValueOnce({ provider: 'kgis', status: 'matched', confidence: 0.65, hierarchy: {}, survey_numbers: [], geometry_geojson: null });

    const ctx = await deriveParcelContextFromAddress({ address: 'Bengaluru' });
    expect(ctx.coordinatesGate.gated).toBe(true);
    expect(masterplanService.searchBbmpStreets).not.toHaveBeenCalled();
  });
});

describe('parcelContext.service — internal helpers', () => {
  test('isWithinBmaApprox matches central BLR, rejects Mumbai', () => {
    expect(_internal.isWithinBmaApprox({ lat: 12.97, lng: 77.59 })).toBe(true);
    expect(_internal.isWithinBmaApprox({ lat: 19.07, lng: 72.88 })).toBe(false);
  });

  test('isCoordinateTrustworthy honors caller-supplied + threshold + status', () => {
    expect(_internal.isCoordinateTrustworthy({ source: 'caller_supplied', confidence: 1.0, status: 'verified' })).toBe(true);
    expect(_internal.isCoordinateTrustworthy({ source: 'google', confidence: 0.92, status: 'verified' })).toBe(true);
    expect(_internal.isCoordinateTrustworthy({ source: 'nominatim', confidence: 0.45, status: 'verified' })).toBe(false);
    expect(_internal.isCoordinateTrustworthy({ source: 'google', confidence: 0.85, status: 'approximate' })).toBe(false);
    expect(_internal.isCoordinateTrustworthy({ source: 'google', confidence: 0.92, status: 'failed' })).toBe(false);
    expect(_internal.isCoordinateTrustworthy(null)).toBe(false);
    expect(_internal.GEOCODE_TRUST_THRESHOLD).toBe(0.7);
  });

  test('extractAddressTokens drops stop-words + short tokens', () => {
    const tokens = _internal.extractAddressTokens('100 Brigade Road, Bengaluru, Karnataka, India 560001');
    expect(tokens).toContain('Brigade');
    expect(tokens).not.toContain('Road');         // stop-word
    expect(tokens).not.toContain('Bengaluru');    // stop-word
    expect(tokens).not.toContain('Karnataka');    // stop-word
    expect(tokens).not.toContain('India');        // stop-word
  });

  test('scorePdAgainstAddress matches PD names by token presence', () => {
    const pd = { pd_name: 'Whitefield / Kadugodi growth belt' };
    expect(_internal.scorePdAgainstAddress(pd, ['Whitefield', 'ITPL'])).toBeGreaterThanOrEqual(1);
    expect(_internal.scorePdAgainstAddress(pd, ['CBD', 'MG'])).toBe(0);
  });
});

describe('parcelContext.service — planning district enrichment', () => {
  test('matches PD by address token and enriches with demographics', async () => {
    geocodeAddress.mockResolvedValueOnce({
      found: true, lat: 12.97, lng: 77.74, displayName: '100 Whitefield Main Road, Bengaluru, Karnataka', placeId: 'p', provider: 'google', confidence: 0.9, status: 'verified',
    });
    fetchKgisContext.mockResolvedValueOnce(stubKgis);
    masterplanService.searchBbmpStreets.mockResolvedValueOnce({ rows: [stubStreetMatch], summary: {} });

    const ctx = await deriveParcelContextFromAddress({ address: '100 Whitefield Main Road' });
    expect(ctx.planningDistrict).not.toBeNull();
    expect(ctx.planningDistrict.pd_code).toBe('PD-11');
    expect(ctx.planningDistrict.population_2011).toBe(207212);
    expect(ctx.planningDistrict.gross_density_pph).toBe(49);
    expect(ctx.planningDistrict.source).toBe('address-token-fuzz');
  });
});
