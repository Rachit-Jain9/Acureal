'use strict';

// Tests the export recompute slice. The pg layer is mocked; computeSiteYield +
// buildEngineAssumptions run for real (integration), so these lock that a saved
// study recomputes correctly, the fallback synthesises from the deal, and the
// slice is null when there's nothing to render.

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
const { query } = require('../src/config/database');
const { buildSiteYieldSlice } = require('../src/services/exports/yieldProgramme.service');

const ACRE = 43560;
beforeEach(() => query.mockReset());

describe('buildSiteYieldSlice', () => {
  test('recomputes a SAVED study (UI-shaped → engine) and badges mode=saved', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ asset_class: 'residential_apartments', envelope: { landAreaSqft: String(ACRE), effectiveFsi: '2.5' }, assumptions: { loadingFactorPct: 30, mix: [{ key: '2bhk', label: '2 BHK', carpet_sqft: 1000, share_pct: 100 }] }, updated_at: '2026-06-30' }] }) // study
      .mockResolvedValueOnce({ rows: [] }); // boundary
    const slice = await buildSiteYieldSlice({ deal: { id: 'd1', property_id: 'p1', asset_class: 'residential_apartments' } });
    expect(slice.mode).toBe('saved');
    expect(slice.computed.ok).toBe(true);
    expect(slice.computed.envelope.realized_gfa_sqft).toBe(Math.round(ACRE * 2.5));
    expect(slice.computed.totals.units).toBeGreaterThan(0);
  });

  test('falls back to a screening envelope from the deal when no study (mode=screening_defaults)', async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // no study
      .mockResolvedValueOnce({ rows: [] }); // no boundary
    const slice = await buildSiteYieldSlice({ deal: { id: 'd1', property_id: 'p1', asset_class: 'commercial_office', land_area_sqft: ACRE, permissible_fsi: 3.0 } });
    expect(slice.mode).toBe('screening_defaults');
    expect(slice.computed.areaSchedule.leasable_sqft).toBeGreaterThan(0);
  });

  test('boundary area_sqft overrides the deal land area in fallback', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ area_sqft: ACRE * 2, source: 'kml', review_status: 'pending', confidence_score: null }] });
    const slice = await buildSiteYieldSlice({ deal: { id: 'd1', property_id: 'p1', asset_class: 'commercial_office', land_area_sqft: ACRE, permissible_fsi: 2 } });
    expect(slice.computed.envelope.realized_gfa_sqft).toBe(Math.round(ACRE * 2 * 2)); // boundary 2-acre × FSI 2
    expect(slice.boundary.source).toBe('kml');
  });

  test('returns null when there is nothing to compute (no study, no land area)', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const slice = await buildSiteYieldSlice({ deal: { id: 'd1', property_id: 'p1', asset_class: 'residential_apartments' } });
    expect(slice).toBeNull();
  });

  test('tolerates the tables being absent (42P01) → null', async () => {
    query.mockRejectedValue(Object.assign(new Error('relation "yield_studies" does not exist'), { code: '42P01' }));
    const slice = await buildSiteYieldSlice({ deal: { id: 'd1', property_id: 'p1', asset_class: 'residential_apartments', land_area_sqft: ACRE, permissible_fsi: 2 } });
    // study + boundary both 42P01 → no study, fallback uses deal land+fsi
    expect(slice.mode).toBe('screening_defaults');
  });
});
