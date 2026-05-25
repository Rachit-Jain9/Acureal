'use strict';

/**
 * Phase 1 / Pillar 1 — Micro-Market Intelligence service tests.
 *
 * Pure-function tests for the geo helper + migration-tolerant smoke tests
 * for the service (verifying every method degrades cleanly when the table
 * is missing). Real DB integration tests are out of scope for PR-1 — they
 * live in a separate integration harness in CI.
 */

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const db = require('../src/config/database');
const service = require('../src/services/microMarketIntelligence.service');

beforeEach(() => {
  db.query.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// haversineKm — pure function
// ─────────────────────────────────────────────────────────────────────────────

describe('haversineKm', () => {
  test('returns 0 for identical points', () => {
    expect(service.haversineKm(12.97, 77.6, 12.97, 77.6)).toBeCloseTo(0, 5);
  });

  test('Whitefield to MG Road CBD is ~13-15 km', () => {
    // Whitefield centroid 12.9698, 77.7500; MG Road CBD 12.9750, 77.6043
    const d = service.haversineKm(12.9698, 77.7500, 12.9750, 77.6043);
    expect(d).toBeGreaterThan(13);
    expect(d).toBeLessThan(20);
  });

  test('Hebbal to Electronic City P1 is ~20-23 km', () => {
    // Hebbal 13.0358, 77.5970; EC P1 12.8456, 77.6603
    const d = service.haversineKm(13.0358, 77.5970, 12.8456, 77.6603);
    expect(d).toBeGreaterThan(20);
    expect(d).toBeLessThan(25);
  });

  test('Devanahalli to MG Road is ~30-35 km (Airport corridor distance)', () => {
    // Devanahalli 13.2461, 77.7128; MG Road 12.9750, 77.6043
    const d = service.haversineKm(13.2461, 77.7128, 12.9750, 77.6043);
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(36);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HEADLINE_METRIC_BY_ASSET_CLASS — pure mapping
// ─────────────────────────────────────────────────────────────────────────────

describe('HEADLINE_METRIC_BY_ASSET_CLASS', () => {
  test('residential assets pick sale_rate_per_sqft_inr', () => {
    expect(service.HEADLINE_METRIC_BY_ASSET_CLASS.residential_apartments).toBe('sale_rate_per_sqft_inr');
    expect(service.HEADLINE_METRIC_BY_ASSET_CLASS.villas).toBe('sale_rate_per_sqft_inr');
    expect(service.HEADLINE_METRIC_BY_ASSET_CLASS.mixed_use).toBe('sale_rate_per_sqft_inr');
    expect(service.HEADLINE_METRIC_BY_ASSET_CLASS.redevelopment).toBe('sale_rate_per_sqft_inr');
  });

  test('plotted + raw_land pick plot_rate_per_sqft_inr', () => {
    expect(service.HEADLINE_METRIC_BY_ASSET_CLASS.plotted_development).toBe('plot_rate_per_sqft_inr');
    expect(service.HEADLINE_METRIC_BY_ASSET_CLASS.raw_land).toBe('plot_rate_per_sqft_inr');
  });

  test('income assets pick rent', () => {
    expect(service.HEADLINE_METRIC_BY_ASSET_CLASS.commercial_office).toBe('office_rent_per_sqft_month_inr');
    expect(service.HEADLINE_METRIC_BY_ASSET_CLASS.retail).toBe('retail_rent_per_sqft_month_inr');
    expect(service.HEADLINE_METRIC_BY_ASSET_CLASS.industrial_warehousing).toBe('rent_per_sqft_month_inr');
  });

  test('hospitality picks cap_rate_pct (revenue is dynamic; cap rate is the IPC-reported headline)', () => {
    expect(service.HEADLINE_METRIC_BY_ASSET_CLASS.hospitality).toBe('cap_rate_pct');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyParcel
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyParcel', () => {
  test('returns null shape for non-numeric input', async () => {
    expect(await service.classifyParcel(null, null)).toEqual({
      locality_code: null, name: null, distance_km: null, tier: null, confidence: null,
    });
    expect(await service.classifyParcel('abc', 77)).toEqual({
      locality_code: null, name: null, distance_km: null, tier: null, confidence: null,
    });
  });

  test('degrades cleanly when the table is missing (pre-migration)', async () => {
    const err = new Error('relation does not exist');
    err.code = '42P01';
    db.query.mockRejectedValueOnce(err);
    const out = await service.classifyParcel(12.97, 77.6);
    expect(out.locality_code).toBeNull();
    expect(out.confidence).toBeNull();
  });

  test('returns empty shape when the table is empty', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const out = await service.classifyParcel(12.97, 77.6);
    expect(out.locality_code).toBeNull();
  });

  test('classifies a Whitefield parcel with high confidence', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { locality_code: 'whitefield-east-orr', name: 'Whitefield', tier: 2, centroid_lat: 12.9698, centroid_lng: 77.7500, radius_km: 3.5 },
        { locality_code: 'sarjapur-orr', name: 'Sarjapur', tier: 2, centroid_lat: 12.8993, centroid_lng: 77.6868, radius_km: 3.0 },
      ],
    });
    // Parcel at centroid of Whitefield → distance ~ 0, well within 3.5km radius
    const out = await service.classifyParcel(12.9700, 77.7510);
    expect(out.locality_code).toBe('whitefield-east-orr');
    expect(out.confidence).toBe('high');
    expect(out.distance_km).toBeLessThan(1);
  });

  test('classifies a parcel at 2× radius as medium confidence', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { locality_code: 'whitefield-east-orr', name: 'Whitefield', tier: 2, centroid_lat: 12.9698, centroid_lng: 77.7500, radius_km: 3.5 },
      ],
    });
    // ~6 km from Whitefield centroid → between 3.5km and 7km (2× radius)
    const out = await service.classifyParcel(12.9698 + 0.054, 77.7500); // ~6 km north
    expect(out.locality_code).toBe('whitefield-east-orr');
    expect(out.confidence).toBe('medium');
  });

  test('returns null confidence when parcel is far from any seeded market', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { locality_code: 'whitefield-east-orr', name: 'Whitefield', tier: 2, centroid_lat: 12.9698, centroid_lng: 77.7500, radius_km: 3.5 },
      ],
    });
    // Pune coordinates — should NOT snap to Whitefield
    const out = await service.classifyParcel(18.5204, 73.8567);
    expect(out.locality_code).toBe('whitefield-east-orr');  // nearest is still surfaced
    expect(out.confidence).toBeNull();                       // but confidence is null — UI shows "outside seeded markets"
    expect(out.distance_km).toBeGreaterThan(700);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBriefing
// ─────────────────────────────────────────────────────────────────────────────

describe('getBriefing', () => {
  test('returns empty shape for missing localityCode', async () => {
    const out = await service.getBriefing(null);
    expect(out).toEqual({ locality: null, benchmarks: [], demand_signals: [] });
  });

  test('degrades cleanly when the table is missing', async () => {
    const err = new Error('relation does not exist');
    err.code = '42P01';
    db.query.mockRejectedValueOnce(err);
    const out = await service.getBriefing('whitefield-east-orr');
    expect(out).toEqual({ locality: null, benchmarks: [], demand_signals: [] });
  });

  test('returns the composed payload when the locality exists', async () => {
    // 3 parallel queries — mock in order
    db.query
      .mockResolvedValueOnce({ rows: [{ locality_code: 'whitefield-east-orr', name: 'Whitefield (East ORR)', tier: 2 }] })
      .mockResolvedValueOnce({
        rows: [
          { locality_code: 'whitefield-east-orr', asset_class: 'residential_apartments', metric_kind: 'sale_rate_per_sqft_inr', p50: 9200, confidence: 'medium' },
          { locality_code: 'whitefield-east-orr', asset_class: 'commercial_office', metric_kind: 'office_rent_per_sqft_month_inr', p50: 95, confidence: 'medium' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { locality_code: 'whitefield-east-orr', signal_kind: 'transit_proximity', value_numeric: 1.0, value_text: 'Purple Line extension live' },
        ],
      });
    const out = await service.getBriefing('whitefield-east-orr');
    expect(out.locality.locality_code).toBe('whitefield-east-orr');
    expect(out.benchmarks).toHaveLength(2);
    expect(out.demand_signals).toHaveLength(1);
  });

  test('filters by assetClass when provided', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ locality_code: 'whitefield-east-orr', name: 'Whitefield (East ORR)', tier: 2 }] })
      .mockResolvedValueOnce({
        rows: [
          { locality_code: 'whitefield-east-orr', asset_class: 'residential_apartments', metric_kind: 'sale_rate_per_sqft_inr', p50: 9200 },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const out = await service.getBriefing('whitefield-east-orr', { assetClass: 'residential_apartments' });
    expect(out.benchmarks).toHaveLength(1);
    expect(out.benchmarks[0].asset_class).toBe('residential_apartments');
    // The 3rd mock'd call (demand signals) used the asset-class filter
    const lastQueryArgs = db.query.mock.calls[2];
    expect(lastQueryArgs[1]).toEqual(['whitefield-east-orr', 'residential_apartments']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getDefaultsForDealCreate
// ─────────────────────────────────────────────────────────────────────────────

describe('getDefaultsForDealCreate', () => {
  test('returns null for missing inputs', async () => {
    expect(await service.getDefaultsForDealCreate(null, 'residential_apartments')).toBeNull();
    expect(await service.getDefaultsForDealCreate('whitefield-east-orr', null)).toBeNull();
  });

  test('returns null for unknown asset class (no headline metric mapping)', async () => {
    expect(await service.getDefaultsForDealCreate('whitefield-east-orr', 'totally-fake-asset')).toBeNull();
  });

  test('returns the p50 + band + confidence for a known cell', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        metric_kind: 'sale_rate_per_sqft_inr',
        p25: 7500, p50: 9200, p75: 10500, p95: 11000,
        confidence: 'medium',
        source_ref: 'Knight Frank India Q1 2026 + ANAROCK Q1 2026',
        source_publication_date: new Date('2026-04-01'),
        last_verified_at: new Date('2026-04-15'),
      }],
    });
    const out = await service.getDefaultsForDealCreate('whitefield-east-orr', 'residential_apartments');
    expect(out.suggested_value).toBe(9200);
    expect(out.band).toEqual({ p25: 7500, p75: 10500 });
    expect(out.confidence).toBe('medium');
    expect(out.source_ref).toMatch(/Knight Frank/);
  });

  test('returns null when the cell is absent (no seed for that locality+asset+metric)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const out = await service.getDefaultsForDealCreate('hosur-rd', 'hospitality');
    expect(out).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// listMicroMarkets
// ─────────────────────────────────────────────────────────────────────────────

describe('listMicroMarkets', () => {
  test('degrades cleanly when the table is missing', async () => {
    const err = new Error('relation does not exist');
    err.code = '42P01';
    db.query.mockRejectedValueOnce(err);
    expect(await service.listMicroMarkets()).toEqual([]);
  });

  test('returns the rows when the table exists', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { locality_code: 'koramangala', name: 'Koramangala', tier: 1 },
        { locality_code: 'whitefield-east-orr', name: 'Whitefield (East ORR)', tier: 2 },
      ],
    });
    const out = await service.listMicroMarkets();
    expect(out).toHaveLength(2);
    expect(out[0].tier).toBeLessThanOrEqual(out[1].tier); // ORDER BY tier ASC
  });
});
