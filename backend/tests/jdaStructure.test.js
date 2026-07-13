'use strict';

const { asShare, resolveLandownerShare, applyJdaStructureAdjustment } = require('../src/utils/jdaStructure');

describe('jdaStructure — share resolution', () => {
  it('accepts a decimal or a percent, rejects nonsense', () => {
    expect(asShare(0.25)).toBeCloseTo(0.25, 6);
    expect(asShare(25)).toBeCloseTo(0.25, 6);
    expect(asShare(0)).toBeNull();
    expect(asShare(1)).toBeNull();     // 100% share is not a valid developer deal
    expect(asShare(150)).toBeNull();
    expect(asShare('x')).toBeNull();
  });

  it('reads the share from any of the landowner fields', () => {
    expect(resolveLandownerShare({ landownerSharePct: 0.3 })).toBeCloseTo(0.3, 6);
    expect(resolveLandownerShare({ landownerRevenueShare: 40 })).toBeCloseTo(0.4, 6);
    expect(resolveLandownerShare({ landownerAreaSharePct: 0.33 })).toBeCloseTo(0.33, 6);
    expect(resolveLandownerShare({})).toBeNull();
  });
});

describe('jdaStructure — the adjustment', () => {
  it('is a no-op without a valid landowner share (outright deal)', () => {
    const input = { landCostCr: 90, sellingRatePerSqft: 12000 };
    const { input: out, adjustment } = applyJdaStructureAdjustment(input);
    expect(adjustment).toBeNull();
    expect(out).toBe(input); // untouched reference
  });

  it('zeroes land and nets the sell rate by the share (revenue basis)', () => {
    // 25% to landowner → developer keeps 75%.
    const { input: out, adjustment } = applyJdaStructureAdjustment({
      landCostCr: 90, sellingRatePerSqft: 12000, landownerSharePct: 0.25,
    });
    expect(out.landCostCr).toBe(0);
    expect(out.sellingRatePerSqft).toBeCloseTo(9000, 6); // 12000 × 0.75
    expect(adjustment.applied).toBe(true);
    expect(adjustment.landownerShare).toBeCloseTo(0.25, 6);
    expect(adjustment.grossLandCostCr).toBe(90); // gross preserved for provenance
  });

  it('nets rent for an income-family JDA', () => {
    const { input: out } = applyJdaStructureAdjustment({
      landCostCr: 50, baseRentPerSqftMonth: 100, landownerSharePct: 0.2,
    });
    expect(out.landCostCr).toBe(0);
    expect(out.baseRentPerSqftMonth).toBeCloseTo(80, 6); // 100 × 0.8
  });

  it('does not mutate the caller input', () => {
    const input = { landCostCr: 90, sellingRatePerSqft: 12000, landownerSharePct: 0.25 };
    applyJdaStructureAdjustment(input);
    expect(input.landCostCr).toBe(90);
    expect(input.sellingRatePerSqft).toBe(12000);
  });
});
