'use strict';

// Pins the canonical asset_class → comps.project_type mapper to VALID enum
// values. comps.project_type is a Postgres enum (residential | commercial |
// mixed_use); returning anything else makes the comp queries throw, which the
// read paths historically swallowed as "0 comps" (audit 2026-06-01, P1).
const { assetClassToProjectType } = require('../src/services/comps.service');

describe('assetClassToProjectType — deal asset_class → comps.project_type enum', () => {
  const VALID = new Set(['residential', 'commercial', 'mixed_use', null]);

  test.each([
    ['residential_apartments', 'residential'],
    ['villas', 'residential'],
    ['plotted_development', 'residential'],
    ['redevelopment', 'residential'],
    ['commercial_office', 'commercial'],
    ['retail', 'commercial'],
    ['industrial_warehousing', 'commercial'],
    ['hospitality', 'commercial'],
    ['mixed_use', 'mixed_use'],
    ['raw_land', null],
  ])('%s → %s', (assetClass, expected) => {
    expect(assetClassToProjectType(assetClass)).toBe(expected);
  });

  test('every asset class (and junk input) yields a valid enum value or null', () => {
    const inputs = [
      'residential_apartments', 'villas', 'plotted_development', 'commercial_office',
      'retail', 'industrial_warehousing', 'hospitality', 'redevelopment', 'mixed_use',
      'raw_land', '', null, undefined, 'garbage-value',
    ];
    for (const ac of inputs) {
      expect(VALID.has(assetClassToProjectType(ac))).toBe(true);
    }
  });

  test('property_type promotes an otherwise-residential default to commercial', () => {
    expect(assetClassToProjectType('unknown', 'office')).toBe('commercial');
    expect(assetClassToProjectType(null, 'retail')).toBe('commercial');
  });
});
