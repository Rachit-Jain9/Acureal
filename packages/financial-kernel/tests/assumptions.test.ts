import { GLOBAL_DEFAULTS, ASSET_DEFAULTS, mergeAssumptions, resolveAssumptions } from '../src/assumptions';

describe('mergeAssumptions', () => {
  test('later layer overrides earlier', () => {
    const out = mergeAssumptions({ a: 1, b: 2 }, { b: 99, c: 3 });
    expect(out).toEqual({ a: 1, b: 99, c: 3 });
  });

  test('null / undefined values are skipped', () => {
    const out = mergeAssumptions({ a: 1, b: 2 }, { a: null, b: undefined, c: 9 });
    expect(out).toEqual({ a: 1, b: 2, c: 9 });
  });

  test('undefined layer is tolerated', () => {
    const out = mergeAssumptions(undefined, { a: 5 }, null);
    expect(out).toEqual({ a: 5 });
  });
});

describe('resolveAssumptions', () => {
  test('global → asset default → deal → scenario', () => {
    const out = resolveAssumptions({
      assetClass: 'retail',
      dealOverrides: { financeCostPct: 10 },
      scenarioOverrides: { discountRatePct: 18 },
    });
    // Global default
    expect(out.stampDutyPct).toBe(GLOBAL_DEFAULTS.stampDutyPct);
    // Asset default wins over global
    expect(out.vacancyPct).toBe(ASSET_DEFAULTS.retail.vacancyPct);
    // Deal wins over asset
    expect(out.financeCostPct).toBe(10);
    // Scenario wins over deal
    expect(out.discountRatePct).toBe(18);
  });

  test('land_parcel uses 0% GST', () => {
    const out = resolveAssumptions({ assetClass: 'land_parcel' });
    expect(out.gstOnConstructionPct).toBe(0);
  });
});
