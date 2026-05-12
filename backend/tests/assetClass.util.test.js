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

  test('descriptive deal name beats a stale residential default in asset_class', () => {
    // Operator-reported regression (2026-05-10): a "Commercial Retail"
    // deal had asset_class still on the form default residential_apartments,
    // and every export rendered the whole deck as residential. Fix:
    // when the deal name yields a confident non-residential class, prefer
    // the name over the (likely-stale) explicit field.
    const assetClass = inferAssetClass({
      deal: {
        name: 'Commercial Retail',
        asset_class: 'residential_apartments',
      },
    });
    expect(assetClass).toBe('retail');
  });

  test('honours explicit asset_class when deal name is generic', () => {
    const assetClass = inferAssetClass({
      deal: {
        name: 'Phase 2 Bengaluru',
        asset_class: 'industrial_warehousing',
      },
    });
    expect(assetClass).toBe('industrial_warehousing');
  });

  test('honours explicit asset_class when deal name resolves to residential', () => {
    // Edge case: an operator might genuinely have a "Phase 2 Apartments"
    // deal that they have re-classified as mixed_use mid-flow. Don't
    // override that.
    const assetClass = inferAssetClass({
      deal: {
        name: 'Phase 2 Apartments Tower',
        asset_class: 'mixed_use',
      },
    });
    expect(assetClass).toBe('mixed_use');
  });

  test.each([
    ['Whitefield Office Tower',         'commercial_office'],
    ['Bengaluru Industrial Park',       'industrial_warehousing'],
    ['Marriott Hotel Hospitality Deal', 'hospitality'],
    ['Whitefield Villa Project',        'villas'],
    ['North Plot Subdivision',          'plotted_development'],
    ['Mixed Use Tower Phase 2',         'mixed_use'],
    ['Land Parcel Hoskote',             'raw_land'],
    ['Heritage Redevelopment Site',     'redevelopment'],
  ])('descriptive name "%s" overrides stale residential default → %s', (name, expected) => {
    const assetClass = inferAssetClass({
      deal: { name, asset_class: 'residential_apartments' },
    });
    expect(assetClass).toBe(expected);
  });

  // 2026-05-11 inference upgrade: catch corporate / industrial / energy /
  // pharma deal names that previously fell through to residential default.
  // Operator-reported: "Pointec Pens and Energy Private Limited" was being
  // exported as residential_apartments which broke the entire Dashboard
  // (Revenue 85 Cr vs Cost 203 Cr — negative Net CF). Now classified as
  // industrial_warehousing via the Private Limited / energy keyword rules.
  describe.each([
    ['Pointec Pens and Energy Private Limited',   'industrial_warehousing'],
    ['Sundaram Steel Manufacturing Pvt Ltd',     'industrial_warehousing'],
    ['Bharat Pharma Biotech Park',                'industrial_warehousing'],
    ['Reliance Chemical Plant',                   'industrial_warehousing'],
    ['Wipro Manufacturing Facility',              'industrial_warehousing'],
    ['Tata Cement Factory Hoskote',               'industrial_warehousing'],
    ['Indus Foundry Pvt Ltd',                     'industrial_warehousing'],
  ])('industrial / corporate keyword inference: "%s" → %s', (name, expected) => {
    test(`"${name}" → ${expected}`, () => {
      expect(inferAssetClass({ deal: { name, asset_class: 'residential_apartments' } })).toBe(expected);
    });
  });

  // Guard: "Energy" / "Power" should NOT mis-classify clearly-residential
  // complexes that use those words as marketing. The inference checks for
  // residential descriptor words (tower / apartment / residence / villa /
  // park / garden) and falls through to residential when present.
  describe.each([
    ['Sunshine Energy Towers',          'residential_apartments'],
    ['Powerhouse Residences',           'residential_apartments'],
    ['Green Energy Garden Apartments',  'residential_apartments'],
  ])('residential-marketing names that contain "energy"/"power": "%s" → %s', (name, expected) => {
    test(`"${name}" → ${expected}`, () => {
      expect(inferAssetClass({ deal: { name } })).toBe(expected);
    });
  });
});
