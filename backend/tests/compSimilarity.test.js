'use strict';

const {
  scoreComp,
  rankComps,
  haversineKm,
  DEFAULT_WEIGHTS,
  _internals,
} = require('../src/utils/compSimilarity');

describe('utils/compSimilarity', () => {
  describe('haversineKm', () => {
    test('returns ~0 for identical points', () => {
      expect(haversineKm(12.97, 77.59, 12.97, 77.59)).toBeCloseTo(0, 4);
    });

    test('returns null for missing inputs', () => {
      expect(haversineKm(null, 77, 12, 77)).toBeNull();
    });

    test('matches a known Bengaluru pair within tolerance', () => {
      // Bengaluru → Whitefield ≈ 14 km on the map.
      const km = haversineKm(12.9716, 77.5946, 12.9698, 77.7500);
      expect(km).toBeGreaterThan(13);
      expect(km).toBeLessThan(18);
    });
  });

  describe('scoreComp basic shape', () => {
    test('returns a numeric overall score in [0,1] for a complete match', () => {
      const subject = {
        lat: 12.97, lng: 77.59,
        asset_class: 'residential_apartments',
        bhk_config: '2BHK, 3BHK',
        launch_year: 2024,
        total_units: 200,
        amenities: 'pool, gym, club',
        target_rate_per_sqft: 12000,
      };
      const comp = {
        lat: 12.97, lng: 77.59,
        project_type: 'residential',
        bhk_config: '2BHK, 3BHK',
        launch_year: 2024,
        total_units: 200,
        amenities: 'pool, gym, club',
        rate_per_sqft: 12000,
      };
      const result = scoreComp(subject, comp);
      expect(result.overall_score).toBeGreaterThan(0.95);
      expect(result.overall_score).toBeLessThanOrEqual(1);
      expect(result.distance_km).toBe(0);
      expect(result.rate_delta_pct).toBe(0);
    });

    test('factor scores degrade gracefully when subject inputs are missing', () => {
      const subject = { lat: 12.97, lng: 77.59, asset_class: 'residential_apartments' };
      const comp = {
        lat: 12.97, lng: 77.59,
        project_type: 'residential',
        bhk_config: '2BHK',
        launch_year: 2024,
        total_units: 100,
        amenities: 'pool',
        rate_per_sqft: 12000,
      };
      const result = scoreComp(subject, comp);
      // distance + asset_class supply data on both sides; the rest are null
      expect(result.factors.distance.score).toBe(1);
      expect(result.factors.asset_class.score).toBe(1);
      expect(result.factors.bhk_config.score).toBeNull();
      expect(result.factors.vintage.score).toBeNull();
      expect(result.factors.size_band.score).toBeNull();
      expect(result.factors.amenities.score).toBeNull();
      // Overall is the weighted average over factors with data only.
      expect(result.overall_score).toBeGreaterThan(0.9);
    });

    test('rate_delta_pct is signed and percent-scaled', () => {
      const subject = { lat: 12, lng: 77, target_rate_per_sqft: 10000 };
      const comp = { lat: 12, lng: 77, rate_per_sqft: 11500 };
      const result = scoreComp(subject, comp);
      expect(result.rate_delta_pct).toBe(15.0);
    });

    test('rate_delta_pct is null without both rates', () => {
      const subject = { lat: 12, lng: 77 };
      const comp = { lat: 12, lng: 77, rate_per_sqft: 11500 };
      expect(scoreComp(subject, comp).rate_delta_pct).toBeNull();
    });
  });

  describe('asset class normalization', () => {
    const { normalizeAssetClass } = _internals;

    test.each([
      ['residential', 'residential_apartments'],
      ['Residential Apartments', 'residential_apartments'],
      ['villa community', 'villas'],
      ['plotted layout', 'plotted_development'],
      ['Office park', 'commercial_office'],
      ['Mall', 'retail'],
      ['Warehousing', 'industrial_warehousing'],
      ['Hotel', 'hospitality'],
      ['Mixed-Use', 'mixed_use'],
      ['Raw Land', 'raw_land'],
      ['Redevelopment', 'redevelopment'],
    ])('%s → %s', (input, expected) => {
      expect(normalizeAssetClass(input)).toBe(expected);
    });
  });

  describe('rankComps', () => {
    test('orders comps by overall_score descending', () => {
      const subject = {
        lat: 12.97, lng: 77.59,
        asset_class: 'residential_apartments',
        target_rate_per_sqft: 11000,
      };
      const comps = [
        { id: 'far',   lat: 12.97, lng: 77.80, project_type: 'residential', rate_per_sqft: 10500 }, // ~22 km
        { id: 'near',  lat: 12.97, lng: 77.59, project_type: 'residential', rate_per_sqft: 11200 },
        { id: 'wrong', lat: 12.97, lng: 77.59, project_type: 'office',       rate_per_sqft: 10000 },
      ];
      const ranked = rankComps(subject, comps);
      expect(ranked[0].comp.id).toBe('near');
      expect(ranked.map((r) => r.comp.id)).not.toContain(undefined);
    });

    test('drops candidates with no scoreable factors', () => {
      const subject = {};
      const comps = [{ id: 'a' }, { id: 'b' }];
      const ranked = rankComps(subject, comps);
      expect(ranked).toEqual([]);
    });
  });

  describe('weighting & saturation', () => {
    test('distance saturates at the residential threshold', () => {
      const subject = {
        lat: 12.97, lng: 77.59,
        asset_class: 'residential_apartments',
      };
      const comp = { lat: 12.97, lng: 77.84, project_type: 'residential' }; // ~27 km east
      const result = scoreComp(subject, comp);
      expect(result.factors.distance.score).toBe(0);
    });

    test('default weights sum to 1', () => {
      const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 6);
    });
  });
});
