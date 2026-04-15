const { resolveAssetClass, inferAssetClass } = require('../src/utils/assetClass');

describe('assetClass utility', () => {
  test('resolves commercial retail labels to retail', () => {
    expect(resolveAssetClass('Commercial Retail')).toBe('retail');
    expect(resolveAssetClass('Retail Mall')).toBe('retail');
  });

  test('infers retail from title and operating signals even when property type is land', () => {
    const assetClass = inferAssetClass({
      deal: {
        name: 'Commercial Retail',
        property_name: 'Commercial Retail',
        property_type: 'land',
        zoning: 'commercial',
      },
      inputs: {
        baseRentPerSqftMonth: 95,
        exitCapRate: 7.5,
      },
    });

    expect(assetClass).toBe('retail');
  });
});
