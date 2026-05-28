'use strict';

// Lane G — ontology parity guards.
//
// The strategic review (docs/STRATEGIC_REVIEW_2026_05_15.md §VI Priority 1)
// flagged drift risk between four places that encode the deal-structure
// and asset-class taxonomies:
//
//   - packages/real-estate-ontology/src/v1.json (single source of truth)
//   - backend/src/constants/domain.js DEAL_STRUCTURES
//   - backend/src/constants/assetClasses.js ASSET_CLASS_CONFIG[].value
//   - backend/src/utils/dealStructureMatrix.js DEAL_STRUCTURES / ASSET_CLASSES
//
// `domain.js` is now DERIVED from the ontology (see Lane G commit), so
// no parity test is needed for that pair -- they're literally the same
// list. The remaining drift surfaces are `assetClasses.js` (the rich
// config) and `dealStructureMatrix.js` (whose own parity test locks
// it to the frontend mirror). These tests catch any future drift on
// those two by comparing them back to the ontology.

const ontology = require('../../packages/real-estate-ontology/src');
const { ASSET_CLASS_CONFIG, ASSET_CLASSES } = require('../src/constants/assetClasses');
const {
  ASSET_CLASSES: MATRIX_ASSET_CLASSES,
  DEAL_STRUCTURES: MATRIX_DEAL_STRUCTURES,
} = require('../src/utils/dealStructureMatrix');
const { DEAL_STRUCTURES: DOMAIN_DEAL_STRUCTURES } = require('../src/constants/domain');

describe('ontology parity — asset class', () => {
  test('ASSET_CLASS_CONFIG keys match the ontology asset_class.values', () => {
    const configKeys = ASSET_CLASS_CONFIG.map((c) => c.value).sort();
    const ontologyKeys = ontology.getAssetClassKeys().sort();
    expect(configKeys).toEqual(ontologyKeys);
  });

  test('exported ASSET_CLASSES equals ASSET_CLASS_CONFIG[].value (no transformation in between)', () => {
    expect(ASSET_CLASSES).toEqual(ASSET_CLASS_CONFIG.map((c) => c.value));
  });

  test('dealStructureMatrix ASSET_CLASSES matches the ontology', () => {
    expect([...MATRIX_ASSET_CLASSES].sort()).toEqual(ontology.getAssetClassKeys().sort());
  });
});

describe('ontology parity — deal structure', () => {
  test('domain.js DEAL_STRUCTURES is derived from the ontology (identity check)', () => {
    // Locks the derive: if someone replaces the derive with a hardcoded
    // list, this catches the regression before it lands.
    expect(DOMAIN_DEAL_STRUCTURES).toEqual(ontology.getDealStructureKeys());
  });

  test('dealStructureMatrix DEAL_STRUCTURES matches the ontology', () => {
    expect([...MATRIX_DEAL_STRUCTURES].sort()).toEqual(ontology.getDealStructureKeys().sort());
  });
});
