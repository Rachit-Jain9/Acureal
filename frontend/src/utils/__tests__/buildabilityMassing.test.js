import { describe, it, expect } from 'vitest';
import { buildMassingModel } from '../buildabilityMassing';

describe('buildMassingModel', () => {
  it('returns null without a plot area or a coverage rule', () => {
    expect(buildMassingModel()).toBeNull();
    expect(buildMassingModel({ values: { ground_coverage_pct: 50 } })).toBeNull();
    expect(buildMassingModel({ values: {}, landAreaSqft: 43560 })).toBeNull();
    expect(
      buildMassingModel({ values: { ground_coverage_pct: 0 }, landAreaSqft: 43560 }),
    ).toBeNull();
  });

  it('derives the footprint and floor count from FAR and coverage', () => {
    const m = buildMassingModel({
      values: { ground_coverage_pct: 50, max_far: 2.5, max_buildable_area_sqft: 108900 },
      landAreaSqft: 43560,
    });
    expect(m.plotSqft).toBe(43560);
    expect(m.footprintSqft).toBe(21780); // 50% of 43560
    expect(m.coveragePct).toBe(50);
    expect(m.openGroundPct).toBe(50);
    expect(m.floors).toBe(5); // 108900 / 21780
    expect(m.footprintRatio).toBeCloseTo(Math.sqrt(0.5), 5);
  });

  it('falls back to plot area x FAR when max buildable area is absent', () => {
    const m = buildMassingModel({
      values: { ground_coverage_pct: 40, max_far: 3.25 },
      landAreaSqft: 20000,
    });
    expect(m.footprintSqft).toBe(8000); // 40% of 20000
    expect(m.floors).toBe(8); // round(65000 / 8000)
  });

  it('caps coverage at 100% and keeps a floor minimum of 1', () => {
    const m = buildMassingModel({
      values: { ground_coverage_pct: 140, max_far: 0.5 },
      landAreaSqft: 10000,
    });
    expect(m.coveragePct).toBe(100);
    expect(m.floors).toBe(1); // 5000 buildable / 10000 footprint rounds below 1
  });
});
