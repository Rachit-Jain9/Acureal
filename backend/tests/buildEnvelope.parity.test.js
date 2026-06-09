'use strict';

// Parity guard: backend and frontend each ship a copy of buildEnvelope.js.
// The two are read by different runtimes so we can't import from one place —
// but they MUST stay identical. This test reads the frontend file, strips
// the ESM `export ` keywords, evals it under a CommonJS shim, and runs
// identical fixtures through both. Any divergence fails the build.

const fs = require('fs');
const path = require('path');
const Module = require('module');

const backend = require('../src/utils/buildEnvelope');

const frontendSrc = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'buildEnvelope.js'),
  'utf8'
);

const exportNames = [];
const stripped = frontendSrc.replace(/^export\s+(const|function|let)\s+(\w+)/gm, (_, kind, name) => {
  exportNames.push(name);
  return `${kind} ${name}`;
});
const cjsSource = `${stripped}\nmodule.exports = { ${exportNames.join(', ')} };\n`;
const m = new Module('frontend-buildEnvelope');
m._compile(cjsSource, 'frontend/src/utils/buildEnvelope.js');
const frontend = m.exports;

const sampleZone = {
  id: 'zone-r-main',
  zone_code: 'R',
  zone_name: 'Residential (Main)',
  plan_version: 'RMP 2015',
  permissible_fsi_base: 1.75,
  permissible_fsi_max: 3.25,
  ground_coverage_pct: 75,
  building_height_max_m: 60,
  source_page: 27,
  source_section: 'RMP 2015 Vol III, §4.1 Table 10',
  fsi_road_width_rules: [
    { road_width_m: 0, fsi: 1.75, max_ground_coverage_pct: 75 },
    { road_width_m: 12, fsi: 2.25, max_ground_coverage_pct: 65 },
    { road_width_m: 18, fsi: 2.5, max_ground_coverage_pct: 60 },
    { road_width_m: 24, fsi: 3.0, max_ground_coverage_pct: 55 },
    { road_width_m: 30, fsi: 3.25, max_ground_coverage_pct: 50 },
  ],
};

const fixtures = [
  { label: 'low-rise small plot', inputs: { roadWidthM: 9, plotAreaSqm: 100, buildingHeightM: 9.5 } },
  { label: 'low-rise mid plot', inputs: { roadWidthM: 18, plotAreaSqm: 500, buildingHeightM: 11 } },
  { label: 'high-rise', inputs: { roadWidthM: 18, plotAreaSqm: 1000, buildingHeightM: 15 } },
  { label: 'tall high-rise, large plot', inputs: { roadWidthM: 30.5, plotAreaSqm: 4000, buildingHeightM: 60 } },
  { label: 'large plot low-rise (>4000 sqm)', inputs: { roadWidthM: 24, plotAreaSqm: 5000, buildingHeightM: 10 } },
  { label: 'no inputs', inputs: {} },
  { label: 'only road width', inputs: { roadWidthM: 18 } },
  { label: 'only height (high-rise)', inputs: { buildingHeightM: 30 } },
  { label: 'explicit site dims', inputs: { roadWidthM: 12, plotAreaSqm: 240, buildingHeightM: 9, siteWidthM: 12, siteDepthM: 20 } },
];

describe('buildEnvelope parity (backend vs frontend)', () => {
  test('HIGH_RISE_SETBACK_BY_HEIGHT constants match', () => {
    expect(frontend.HIGH_RISE_SETBACK_BY_HEIGHT).toEqual(backend.HIGH_RISE_SETBACK_BY_HEIGHT);
  });

  test.each(fixtures)('lowRiseSetback parity: $label', ({ inputs }) => {
    const args = { siteWidthM: inputs.siteWidthM, siteDepthM: inputs.siteDepthM, plotAreaSqm: inputs.plotAreaSqm };
    expect(frontend.lowRiseSetback(args)).toEqual(backend.lowRiseSetback(args));
  });

  test.each(fixtures)('highRiseSetback parity: $label', ({ inputs }) => {
    expect(frontend.highRiseSetback(inputs.buildingHeightM)).toEqual(backend.highRiseSetback(inputs.buildingHeightM));
  });

  test.each(fixtures)('setbacksForBuilding parity: $label', ({ inputs }) => {
    const args = {
      buildingHeightM: inputs.buildingHeightM,
      siteWidthM: inputs.siteWidthM,
      siteDepthM: inputs.siteDepthM,
      plotAreaSqm: inputs.plotAreaSqm,
    };
    expect(frontend.setbacksForBuilding(args)).toEqual(backend.setbacksForBuilding(args));
  });

  test.each(fixtures)('deriveSiteDimensions parity: $label', ({ inputs }) => {
    const args = { plotAreaSqm: inputs.plotAreaSqm, siteWidthM: inputs.siteWidthM, siteDepthM: inputs.siteDepthM };
    expect(frontend.deriveSiteDimensions(args)).toEqual(backend.deriveSiteDimensions(args));
  });

  test.each(fixtures)('effectiveFARFromZone parity: $label', ({ inputs }) => {
    expect(frontend.effectiveFARFromZone(sampleZone, inputs.roadWidthM)).toEqual(
      backend.effectiveFARFromZone(sampleZone, inputs.roadWidthM),
    );
  });

  test.each(fixtures)('calculateBuildEnvelope parity: $label', ({ inputs }) => {
    expect(frontend.calculateBuildEnvelope(sampleZone, inputs)).toEqual(
      backend.calculateBuildEnvelope(sampleZone, inputs),
    );
  });
});

describe('buildEnvelope numeric correctness — RMP 2015 Vol III', () => {
  // Table 9 (high-rise, > 11.5 m): uniform all-around by height.
  test('Table 9: height 12 m -> 5.0 m all sides', () => {
    expect(backend.highRiseSetback(12)).toMatchObject({ front_m: 5.0, rear_m: 5.0, left_m: 5.0, right_m: 5.0, model: 'high_rise' });
  });

  test('Table 9: height 17 m -> 6.0 m', () => {
    expect(backend.highRiseSetback(17)).toMatchObject({ front_m: 6.0, rear_m: 6.0 });
  });

  test('Table 9: height 60 m -> 16.0 m (top band)', () => {
    expect(backend.highRiseSetback(60)).toMatchObject({ front_m: 16.0, left_m: 16.0 });
  });

  // Table 8 (low-rise, <= 11.5 m): % of site width (left/right) and depth (front/rear).
  test('Table 8: site width/depth <= 6 m -> right 1.0/left 0, front 1.0/rear 0', () => {
    expect(backend.lowRiseSetback({ siteWidthM: 5, siteDepthM: 5 })).toMatchObject({
      right_m: 1.0, left_m: 0.0, front_m: 1.0, rear_m: 0.0, model: 'low_rise',
    });
  });

  test('Table 8: site 6-9 m -> 1.0 m on all sides', () => {
    expect(backend.lowRiseSetback({ siteWidthM: 8, siteDepthM: 8 })).toMatchObject({
      right_m: 1.0, left_m: 1.0, front_m: 1.0, rear_m: 1.0,
    });
  });

  test('Table 8: site > 9 m -> 8% width (right/left), 12%/8% depth (front/rear)', () => {
    // width 12 -> 0.96 ; depth 12 -> front 1.44, rear 0.96
    expect(backend.lowRiseSetback({ siteWidthM: 12, siteDepthM: 12 })).toMatchObject({
      right_m: 0.96, left_m: 0.96, front_m: 1.44, rear_m: 0.96,
    });
  });

  test('Table 8 note: plot > 4000 sqm -> 5.0 m all sides', () => {
    expect(backend.lowRiseSetback({ siteWidthM: 50, siteDepthM: 120, plotAreaSqm: 5000 })).toMatchObject({
      front_m: 5.0, rear_m: 5.0, left_m: 5.0, right_m: 5.0,
    });
  });

  test('setbacksForBuilding routes >11.5 m to Table 9 and <=11.5 m to Table 8', () => {
    expect(backend.setbacksForBuilding({ buildingHeightM: 20, siteWidthM: 30, siteDepthM: 33, plotAreaSqm: 1000 })).toMatchObject({ model: 'high_rise', front_m: 7.0 });
    expect(backend.setbacksForBuilding({ buildingHeightM: 9, siteWidthM: 12, siteDepthM: 12 })).toMatchObject({ model: 'low_rise', front_m: 1.44 });
  });

  test('deriveSiteDimensions: square estimate from area when dims absent', () => {
    expect(backend.deriveSiteDimensions({ plotAreaSqm: 100 })).toEqual({ width_m: 10, depth_m: 10, method: 'square_estimate' });
  });

  test('full envelope: R zone, 18 m road, 1000 sqm, 15 m building', () => {
    const env = backend.calculateBuildEnvelope(sampleZone, { roadWidthM: 18, plotAreaSqm: 1000, buildingHeightM: 15 });
    expect(env.ok).toBe(true);
    expect(env.far.base_fsi).toBe(2.5); // tier >= 18 m road
    expect(env.ground_coverage_pct).toBe(60);
    expect(env.setbacks).toMatchObject({ front_m: 5.0, rear_m: 5.0, side_m: 5.0, model: 'high_rise' }); // Table 9 @ 15 m
    expect(env.height.road_cap_m).toBeCloseTo(32.0, 2); // 1.5*18 + 5
    expect(env.height.allowed_max_m).toBeCloseTo(32.0, 2); // min(zone 60, 32)
    expect(env.capacity.buildable_base_sqm).toBe(2500); // 1000 * 2.5
    expect(env.capacity.footprint_cap_sqm).toBe(600); // 1000 * 60%
  });

  test('envelope without zone returns ok=false', () => {
    expect(backend.calculateBuildEnvelope(null, { roadWidthM: 12 })).toMatchObject({ ok: false });
  });
});
