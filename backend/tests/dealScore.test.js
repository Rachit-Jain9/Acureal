'use strict';

const { computeDealScore, BENCHMARKS, __internal } = require('../src/utils/scoring/dealScore');

describe('utils/scoring/dealScore', () => {
  describe('interpolate (internal)', () => {
    test('returns 0 below floor, max above target, linear in between', () => {
      const { interpolate } = __internal;
      expect(interpolate(10, 16, 22, 25)).toBe(0);
      expect(interpolate(22, 16, 22, 25)).toBe(25);
      expect(interpolate(30, 16, 22, 25)).toBe(25);
      expect(interpolate(19, 16, 22, 25)).toBe(13); // halfway → ~12.5 → rounded
    });

    test('returns 0 for null / undefined value', () => {
      const { interpolate } = __internal;
      expect(interpolate(null, 0, 100, 25)).toBe(0);
      expect(interpolate(undefined, 0, 100, 25)).toBe(0);
    });
  });

  describe('bandFor (internal)', () => {
    const { bandFor } = __internal;
    test.each([
      [85, 'strong'],
      [80, 'strong'],
      [79, 'above_benchmark'],
      [65, 'above_benchmark'],
      [50, 'in_line'],
      [49, 'below_benchmark'],
      [35, 'below_benchmark'],
      [34, 'weak'],
      [0, 'weak'],
    ])('%i → %s', (input, expected) => {
      expect(bandFor(input)).toBe(expected);
    });
  });

  describe('computeDealScore', () => {
    // Previously asserted the opposite ("risk-baseline still awarded"): an
    // empty input object scored ≥25 because zero OPEN risks was indistinguishable
    // from a register nobody had opened. Absence is not clearance — the baseline
    // is now earned only by an explicitly populated register, fail-closed.
    test('zero inputs → no risk baseline, because nothing was ever assessed', () => {
      const result = computeDealScore({});
      expect(result.score).toBe(0);
      expect(result.band).toBe('weak');
      expect(result.breakdown).toHaveLength(6);
      const risk = result.breakdown.find((b) => /Risk register/.test(b.component));
      expect(risk.awarded).toBe(0);
      expect(risk.reason).toMatch(/not populated/i);
    });

    test('an empty register never scores as well as a populated, clean one', () => {
      const empty = computeDealScore({ riskRegisterPopulated: false });
      const clean = computeDealScore({
        riskRegisterPopulated: true,
        riskCounts: { critical: 0, high: 0, medium: 0, low: 0 },
      });
      expect(empty.score).toBeLessThan(clean.score);
    });

    test('strong residential deal scores high', () => {
      const result = computeDealScore({
        assetClass: 'residential_apartments',
        irrPct: 26,
        equityMultiple: 2.1,
        grossMarginPct: 32,
        ddCompletionPct: 90,
        riskCounts: { critical: 0, high: 0, medium: 1, low: 2 },
        riskRegisterPopulated: true,
        financialModelPresent: true,
      });
      expect(result.score).toBeGreaterThanOrEqual(80);
      expect(result.band).toBe('strong');
    });

    test('weak deal with critical risks scores low', () => {
      const result = computeDealScore({
        assetClass: 'residential_apartments',
        irrPct: 12,
        equityMultiple: 1.2,
        grossMarginPct: 12,
        ddCompletionPct: 10,
        riskCounts: { critical: 2, high: 3, medium: 0, low: 0 },
        financialModelPresent: false,
      });
      // 0 IRR pts + 0 EM pts + 0 margin pts + 2 DD pts + 0 risk (deduction maxes) + 0 model = ~2
      expect(result.score).toBeLessThanOrEqual(15);
      expect(result.band).toBe('weak');
    });

    test('asset-class benchmark applies (commercial vs residential)', () => {
      // 16% IRR is at the residential floor (0 pts) but the commercial target (full pts).
      const resi = computeDealScore({
        assetClass: 'residential_apartments',
        irrPct: 16,
        equityMultiple: 1.0,
        grossMarginPct: 0,
        ddCompletionPct: 0,
        riskCounts: {},
        riskRegisterPopulated: true,
        financialModelPresent: false,
      });
      const comm = computeDealScore({
        assetClass: 'commercial_office',
        irrPct: 16,
        equityMultiple: 1.0,
        grossMarginPct: 0,
        ddCompletionPct: 0,
        riskCounts: {},
        riskRegisterPopulated: true,
        financialModelPresent: false,
      });
      expect(comm.score).toBeGreaterThan(resi.score);
    });

    test('returns valid band and disclaimer always', () => {
      const result = computeDealScore({});
      expect(['strong','above_benchmark','in_line','below_benchmark','weak']).toContain(result.band);
      expect(typeof result.disclaimer).toBe('string');
      expect(result.disclaimer.length).toBeGreaterThan(20);
    });

    test('breakdown items each have component / max / awarded / reason', () => {
      const result = computeDealScore({ assetClass: 'commercial_office', irrPct: 18 });
      result.breakdown.forEach((item) => {
        expect(item).toHaveProperty('component');
        expect(item).toHaveProperty('max');
        expect(item).toHaveProperty('awarded');
        expect(item).toHaveProperty('reason');
        expect(item.awarded).toBeLessThanOrEqual(item.max);
        expect(item.awarded).toBeGreaterThanOrEqual(0);
      });
    });

    test('score never exceeds 100 even with extreme inputs', () => {
      const result = computeDealScore({
        assetClass: 'residential_apartments',
        irrPct: 200,
        equityMultiple: 10,
        grossMarginPct: 99,
        ddCompletionPct: 100,
        riskCounts: { critical: 0, high: 0, medium: 0, low: 0 },
        financialModelPresent: true,
      });
      expect(result.score).toBeLessThanOrEqual(100);
    });

    test('dataCompleteness reports percentage when totals provided', () => {
      const a = computeDealScore({ dataPointsKnown: 7, dataPointsTotal: 10 });
      expect(a.dataCompleteness).toBe(70);
      const b = computeDealScore({});
      expect(b.dataCompleteness).toBeNull();
    });
  });

  describe('BENCHMARKS', () => {
    test('every supported asset class has the full benchmark shape', () => {
      Object.entries(BENCHMARKS).forEach(([cls, bm]) => {
        ['irrTarget','irrFloor','emTarget','emFloor','marginTarget','marginFloor'].forEach((k) => {
          expect(typeof bm[k]).toBe('number');
        });
        expect(bm.irrTarget).toBeGreaterThan(bm.irrFloor);
        expect(bm.emTarget).toBeGreaterThan(bm.emFloor);
        expect(bm.marginTarget).toBeGreaterThan(bm.marginFloor);
      });
    });
  });
});

// Tiny helper for the band-range expectation above. Avoids adding a custom
// matcher import; just monkey-patches expect inline.
expect.extend({
  toBeOneOf(received, expected) {
    const pass = expected.includes(received);
    return {
      message: () => `expected ${received} to be one of ${expected.join(', ')}`,
      pass,
    };
  },
});
