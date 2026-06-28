'use strict';

// Parity guard: backend and frontend each ship a copy of siteYield.js. They are
// read by different runtimes (Node CJS vs Vite ESM) so we can't import from one
// place — but they MUST stay identical. This reads the frontend file, strips the
// ESM `export` keywords, evals it under a CommonJS shim, and runs identical
// fixtures through both. Any divergence fails the build.

const fs = require('fs');
const path = require('path');
const Module = require('module');

const backend = require('../src/utils/siteYield');

const frontendSrc = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'siteYield.js'),
  'utf8',
);

const exportNames = [];
const stripped = frontendSrc.replace(/^export\s+(const|function|let)\s+(\w+)/gm, (_, kind, name) => {
  exportNames.push(name);
  return `${kind} ${name}`;
});
const cjsSource = `${stripped}\nmodule.exports = { ${exportNames.join(', ')} };\n`;
const m = new Module('frontend-siteYield');
m._compile(cjsSource, 'frontend/src/utils/siteYield.js');
const frontend = m.exports;

const ACRE = 43560;

const fixtures = [
  { label: 'residential FAR-bound', assetClass: 'residential_apartments', envelope: { land_sqft: ACRE, effective_fsi: 2.5 } },
  { label: 'residential coverage-bound', assetClass: 'residential_apartments', envelope: { land_sqft: ACRE, effective_fsi: 3.25, ground_coverage_pct: 40, height: { allowed_max_m: 20 } } },
  { label: 'office', assetClass: 'commercial_office', envelope: { land_sqft: ACRE, effective_fsi: 3.0 } },
  { label: 'retail', assetClass: 'retail', envelope: { land_sqft: ACRE, effective_fsi: 2.0 } },
  { label: 'warehouse', assetClass: 'industrial_warehousing', envelope: { land_sqft: ACRE * 2, effective_fsi: 1.5 } },
  { label: 'hospitality', assetClass: 'hospitality', envelope: { land_sqft: ACRE, effective_fsi: 3.0 } },
  { label: 'plotted', assetClass: 'plotted_development', envelope: { land_sqft: ACRE * 4 } },
  { label: 'villas', assetClass: 'villas', envelope: { land_sqft: ACRE * 4 } },
  { label: 'raw land', assetClass: 'raw_land', envelope: { land_sqft: ACRE } },
  { label: 'mixed use', assetClass: 'mixed_use', envelope: { land_sqft: ACRE, effective_fsi: 3.25, ground_coverage_pct: 50, height: { allowed_max_m: 45 } } },
  { label: 'redevelopment', assetClass: 'redevelopment', envelope: { land_sqft: ACRE, effective_fsi: 2.75 } },
  { label: 'custom assumptions', assetClass: 'residential_apartments', envelope: { land_sqft: ACRE, effective_fsi: 2.5 }, assumptions: { loadingFactor: 0.25, parkingEcsPerUnit: 1.5, unitMix: [{ key: '3bhk', label: '3 BHK', carpet_sqft: 1500, share_pct: 100 }] } },
  { label: 'missing land', assetClass: 'residential_apartments', envelope: {} },
];

describe('siteYield parity (backend vs frontend)', () => {
  test('shared constants match', () => {
    expect(frontend.FAMILY_BY_ASSET_CLASS).toEqual(backend.FAMILY_BY_ASSET_CLASS);
    expect(frontend.FLOOR_TO_FLOOR_M).toEqual(backend.FLOOR_TO_FLOOR_M);
    expect(frontend.EFFICIENCY).toEqual(backend.EFFICIENCY);
    expect(frontend.DEFAULT_RESIDENTIAL_MIX).toEqual(backend.DEFAULT_RESIDENTIAL_MIX);
    expect(frontend.DEFAULT_PARKING).toEqual(backend.DEFAULT_PARKING);
    expect(frontend.DEFAULT_PLOTTED).toEqual(backend.DEFAULT_PLOTTED);
    expect(frontend.DEFAULT_BUILD_COST_PER_SQFT).toEqual(backend.DEFAULT_BUILD_COST_PER_SQFT);
  });

  test.each(fixtures)('computeSiteYield parity: $label', ({ assetClass, envelope, assumptions }) => {
    const input = { assetClass, envelope, assumptions };
    expect(frontend.computeSiteYield(input)).toEqual(backend.computeSiteYield(input));
  });

  test.each(fixtures)('resolveFamily parity: $label', ({ assetClass }) => {
    expect(frontend.resolveFamily(assetClass)).toEqual(backend.resolveFamily(assetClass));
  });
});
