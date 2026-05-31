import { describe, it, expect } from 'vitest';
import { preflightDealInput } from '../dealInputPreflight';

// The what-if / tornado / scenario panels preflight by ASSET class (not the
// resolved financial-model class), so villas (no FSI) and redevelopment
// (society-contributed land → no land cost) are not falsely blocked with an
// "enter this field" banner while their KPIs render fine. Guards finding #4.
describe('preflightDealInput — per-asset-class requirements', () => {
  const villasInputs = {
    plotAreaSqft: 2400, constructionCostPerSqft: 3000, sellingRatePerSqft: 12000, landCostCr: 5,
  };

  it('villas does NOT require FSI', () => {
    expect(preflightDealInput(villasInputs, 'villas').ok).toBe(true);
  });

  it('redevelopment does NOT require land cost', () => {
    const redev = { plotAreaSqft: 2400, fsi: 2.5, constructionCostPerSqft: 3000, sellingRatePerSqft: 12000 };
    expect(preflightDealInput(redev, 'redevelopment').ok).toBe(true);
  });

  it('residential_apartments DOES still require FSI', () => {
    expect(preflightDealInput(villasInputs, 'residential_apartments').missing).toContain('fsi');
  });

  it('raw_land has explicit requirements (not silently skipped)', () => {
    expect(preflightDealInput({}, 'raw_land').ok).toBe(false);
    expect(preflightDealInput(
      { totalLandSqft: 10000, sellingRatePerSqft: 8000, landCostCr: 10 }, 'raw_land',
    ).ok).toBe(true);
  });
});
