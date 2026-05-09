const {
  ASSET_CLASSES,
  FINANCIAL_ASSET_CLASSES,
  resolveFinancialModelClass,
} = require('../src/constants/assetClasses');

describe('asset class contract', () => {
  test('exposes the 9 canonical domain asset classes to backend validators', () => {
    expect(ASSET_CLASSES).toHaveLength(9);
    expect(FINANCIAL_ASSET_CLASSES).toHaveLength(9);
    expect(FINANCIAL_ASSET_CLASSES).toEqual(ASSET_CLASSES);
    expect(ASSET_CLASSES).not.toContain('raw_land');
  });

  test('keeps canonical underwriting classes first-class and maps legacy land aliases', () => {
    expect(resolveFinancialModelClass('villas')).toBe('villas');
    expect(resolveFinancialModelClass('mixed_use')).toBe('mixed_use');
    expect(resolveFinancialModelClass('raw_land')).toBe('plotted_development');
    expect(resolveFinancialModelClass('land_parcel')).toBe('plotted_development');
    expect(resolveFinancialModelClass('redevelopment')).toBe('redevelopment');
  });
});
