const {
  ASSET_CLASSES,
  resolveFinancialModelClass,
} = require('../src/constants/assetClasses');

describe('asset class contract', () => {
  test('exposes all 10 domain asset classes to backend validators', () => {
    expect(ASSET_CLASSES).toHaveLength(10);
  });

  test('maps unsupported underwriting classes onto their nearest model family', () => {
    expect(resolveFinancialModelClass('villas')).toBe('residential_apartments');
    expect(resolveFinancialModelClass('mixed_use')).toBe('residential_apartments');
    expect(resolveFinancialModelClass('raw_land')).toBe('plotted_development');
    expect(resolveFinancialModelClass('redevelopment')).toBe('residential_apartments');
  });
});
