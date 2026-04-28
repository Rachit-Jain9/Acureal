// Parity guard: backend and frontend each ship a copy of parcelBuildability.js
// (CommonJS for backend, ESM for the SPA). The two are read by different
// runtimes so we can't import from one place — but they MUST stay identical.
// This test reads the frontend file as text, strips the ESM `export ` keywords,
// evals it under a CommonJS shim, and runs both implementations through
// the same fixtures. Any divergence fails the build.

const fs = require('fs');
const path = require('path');
const Module = require('module');

const backend = require('../src/utils/parcelBuildability');

const frontendSrc = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'parcelBuildability.js'),
  'utf8'
);

// Convert `export const X` / `export function X` to plain declarations + a
// trailing module.exports object. This is faithful to ESM's named exports.
const exportNames = [];
const stripped = frontendSrc.replace(/^export\s+(const|function|let)\s+(\w+)/gm, (_, kind, name) => {
  exportNames.push(name);
  return `${kind} ${name}`;
});
const cjsSource = `${stripped}\nmodule.exports = { ${exportNames.join(', ')} };\n`;

const m = new Module('frontend-parcelBuildability');
m._compile(cjsSource, 'frontend/src/utils/parcelBuildability.js');
const frontend = m.exports;

const baseRule = {
  id: 'rule-1',
  org_id: null,
  zone_code: 'R-PZ-A',
  planning_zone: 'A',
  land_use_family: 'residential',
  plot_area_min_sqm: 750,
  plot_area_max_sqm: 2000,
  road_width_min_m: 15.5,
  road_width_max_m: 18.5,
  base_far: 1.8,
  additional_far: 0.6,
  max_far: 2.4,
  ground_coverage_pct: 60,
  front_setback_m: 3.5,
  rear_setback_m: 3.0,
  side_setback_m: 1.5,
  plan_version: 'RMP 2031 Draft',
  plan_status: 'draft_reference',
  source_section: 'Table 6',
  source_page: 63,
  review_status: 'approved',
  confidence_score: 0.95,
};

const altRule = {
  ...baseRule,
  id: 'rule-2',
  road_width_min_m: 18.5,
  road_width_max_m: 24,
  base_far: 2.25,
  additional_far: 0.5,
  max_far: 2.75,
};

const rules = [baseRule, altRule];

const fixtures = [
  {
    name: 'pristine residential parcel matches rule-1',
    args: { landAreaSqft: 10763.91, roadWidthMtrs: 18, landUseFamily: 'residential' },
    property: { land_area_sqft: 10763.91, road_width_mtrs: 18 },
  },
  {
    name: 'wider road kicks selection to rule-2',
    args: { landAreaSqft: 10763.91, roadWidthMtrs: 22, landUseFamily: 'residential' },
    property: { land_area_sqft: 10763.91, road_width_mtrs: 22 },
  },
  {
    name: 'no road width — selectFarRule returns null with reason',
    args: { landAreaSqft: 10763.91, roadWidthMtrs: null, landUseFamily: 'residential' },
    property: { land_area_sqft: 10763.91, road_width_mtrs: null },
  },
  {
    name: 'tiny plot — out of band',
    args: { landAreaSqft: 500, roadWidthMtrs: 18, landUseFamily: 'residential' },
    property: { land_area_sqft: 500, road_width_mtrs: 18 },
  },
  {
    name: 'manual FSI fallback when no rule',
    args: { landAreaSqft: 5000, roadWidthMtrs: 12, landUseFamily: 'residential' },
    property: { land_area_sqft: 5000, road_width_mtrs: 12, permissible_fsi: 1.5 },
  },
];

describe('parcelBuildability — backend ↔ frontend parity', () => {
  test('exports the same named functions', () => {
    expect(Object.keys(frontend).sort()).toEqual(
      expect.arrayContaining([
        'SQFT_PER_SQM',
        'toNumber',
        'round',
        'sqftToSqm',
        'sqmToSqft',
        'selectFarRule',
        'computeBuildabilityFromRule',
        'citeFarRule',
        'estimateSetbackImpact',
      ])
    );
  });

  test('SQFT_PER_SQM constant identical', () => {
    expect(frontend.SQFT_PER_SQM).toBe(backend.SQFT_PER_SQM);
  });

  fixtures.forEach((fixture) => {
    test(`selectFarRule parity — ${fixture.name}`, () => {
      const beResult = backend.selectFarRule(rules, fixture.args);
      const feResult = frontend.selectFarRule(rules, fixture.args);
      expect(feResult).toEqual(beResult);
    });

    test(`computeBuildabilityFromRule parity — ${fixture.name}`, () => {
      const { rule } = backend.selectFarRule(rules, fixture.args);
      const beOut = backend.computeBuildabilityFromRule({ property: fixture.property, rule });
      const feOut = frontend.computeBuildabilityFromRule({ property: fixture.property, rule });
      expect(feOut).toEqual(beOut);
    });
  });
});
