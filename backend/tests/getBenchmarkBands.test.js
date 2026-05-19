'use strict';

// PR-NX52 (2026-05-19) — getBenchmarkBands tests.
//
// The structured threshold export used by the live FinancialsPage warnings.
// Mirrors the export-time validators' rules (PR-NX28 / PR-NX33).

const { getBenchmarkBands, __internal } = require('../src/services/exports/xlsx/v2/marketBenchmarkValidator');

describe('PR-NX52 — getBenchmarkBands', () => {
  describe('thresholds', () => {
    test('always returns the canonical thresholds object', () => {
      const out = getBenchmarkBands([]);
      expect(out.thresholds).toEqual({
        rbiDscrFloor: __internal.RBI_DSCR_FLOOR,
        yocVsExitCapMinSpreadBps: __internal.YOC_VS_EXIT_CAP_MIN_SPREAD_BPS,
        yocVsExitCapHealthyBps: __internal.YOC_VS_EXIT_CAP_HEALTHY_SPREAD_BPS,
        compCoverageMinForBands: __internal.COMP_COVERAGE_MIN_FOR_BANDS,
      });
    });

    test('RBI_DSCR_FLOOR is 1.20', () => {
      expect(__internal.RBI_DSCR_FLOOR).toBe(1.20);
    });

    test('YOC_VS_EXIT_CAP_MIN_SPREAD_BPS is 50 (thin threshold)', () => {
      expect(__internal.YOC_VS_EXIT_CAP_MIN_SPREAD_BPS).toBe(50);
    });

    test('YOC_VS_EXIT_CAP_HEALTHY_SPREAD_BPS is 200 (healthy threshold)', () => {
      expect(__internal.YOC_VS_EXIT_CAP_HEALTHY_SPREAD_BPS).toBe(200);
    });

    test('COMP_COVERAGE_MIN_FOR_BANDS is 5', () => {
      expect(__internal.COMP_COVERAGE_MIN_FOR_BANDS).toBe(5);
    });
  });

  describe('counts and bands', () => {
    test('empty array → count=0, verifiedCount=0, bands=null', () => {
      const out = getBenchmarkBands([]);
      expect(out.count).toBe(0);
      expect(out.verifiedCount).toBe(0);
      expect(out.bands).toBeNull();
    });

    test('non-array → defensive: returns thresholds + null bands', () => {
      const out = getBenchmarkBands(null);
      expect(out.count).toBe(0);
      expect(out.verifiedCount).toBe(0);
      expect(out.bands).toBeNull();
      expect(out.thresholds).toBeDefined();
    });

    test('counts ALL comps + only-verified bands', () => {
      const comps = [
        { is_verified: true,  rate_per_sqft: 8000 },
        { is_verified: true,  rate_per_sqft: 9000 },
        { is_verified: true,  rate_per_sqft: 10000 },
        { is_verified: false, rate_per_sqft: 7000 },
        { is_verified: false, rate_per_sqft: 12000 },
      ];
      const out = getBenchmarkBands(comps);
      expect(out.count).toBe(5);          // all comps counted
      expect(out.verifiedCount).toBe(3);   // only verified counted for percentile
      expect(out.bands).toBeTruthy();
      // p25/p50/p75/p95 computed from [8000, 9000, 10000]
      expect(out.bands.p25).toBe(8000);
      expect(out.bands.p50).toBe(9000);
      expect(out.bands.p75).toBe(10000);
      expect(out.bands.p95).toBe(10000);
    });

    test('< 3 verified comps → bands = null (too thin for percentiles)', () => {
      const comps = [
        { is_verified: true, rate_per_sqft: 8000 },
        { is_verified: true, rate_per_sqft: 9000 },
        { is_verified: false, rate_per_sqft: 7000 },
      ];
      const out = getBenchmarkBands(comps);
      expect(out.count).toBe(3);
      expect(out.verifiedCount).toBe(2);
      expect(out.bands).toBeNull();
    });

    test('skips comps with zero/null/non-numeric rate_per_sqft', () => {
      const comps = [
        { is_verified: true, rate_per_sqft: 0 },
        { is_verified: true, rate_per_sqft: null },
        { is_verified: true, rate_per_sqft: 'abc' },
        { is_verified: true, rate_per_sqft: 8000 },
        { is_verified: true, rate_per_sqft: 9000 },
        { is_verified: true, rate_per_sqft: 10000 },
      ];
      const out = getBenchmarkBands(comps);
      expect(out.count).toBe(6);
      expect(out.verifiedCount).toBe(3); // bad-rate comps excluded
      expect(out.bands).toBeTruthy();
    });

    test('large comp set computes correct percentiles', () => {
      // 20 verified comps with rates 1000..20000 step 1000
      const comps = Array.from({ length: 20 }, (_, i) => ({
        is_verified: true,
        rate_per_sqft: (i + 1) * 1000,
      }));
      const out = getBenchmarkBands(comps);
      expect(out.verifiedCount).toBe(20);
      // nearest-rank: floor(20 * 0.25) = 5 → sortedValues[5] = 6000
      expect(out.bands.p25).toBe(6000);
      // floor(20 * 0.50) = 10 → 11000
      expect(out.bands.p50).toBe(11000);
      // floor(20 * 0.75) = 15 → 16000
      expect(out.bands.p75).toBe(16000);
      // floor(20 * 0.95) = 19 → 20000
      expect(out.bands.p95).toBe(20000);
    });

    test('is_verified accepts both true and string "true"', () => {
      const comps = [
        { is_verified: true,    rate_per_sqft: 8000 },
        { is_verified: 'true',  rate_per_sqft: 9000 },
        { is_verified: 'true',  rate_per_sqft: 10000 },
      ];
      const out = getBenchmarkBands(comps);
      expect(out.verifiedCount).toBe(3);
    });
  });
});
