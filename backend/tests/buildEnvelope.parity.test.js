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
  id: 'zone-r-pz-a',
  zone_code: 'R-PZ-A',
  zone_name: 'Residential (Planning Zone A — inside ORR)',
  plan_version: 'RMP 2031 Provisional',
  permissible_fsi_base: 1.5,
  permissible_fsi_max: 2.7,
  ground_coverage_pct: 65,
  building_height_max_m: 60,
  source_page: 45,
  source_section: '5.3 Table 6',
  fsi_road_width_rules: [
    { road_width_m:  6.0, fsi: 1.50, max_ground_coverage_pct: 75 },
    { road_width_m:  9.5, fsi: 1.50, max_ground_coverage_pct: 75 },
    { road_width_m: 12.5, fsi: 1.50, max_ground_coverage_pct: 70 },
    { road_width_m: 15.5, fsi: 1.50, max_ground_coverage_pct: 70 },
    { road_width_m: 18.5, fsi: 2.25, max_ground_coverage_pct: 65, tdr_addition: 0.45 },
    { road_width_m: 24.5, fsi: 2.40, max_ground_coverage_pct: 60, tdr_addition: 0.60 },
    { road_width_m: 30.5, fsi: 2.50, max_ground_coverage_pct: 50, tdr_addition: 0.70 },
  ],
};

const fixtures = [
  { label: 'small plot, narrow road, low building', zone: sampleZone, inputs: { roadWidthM: 9.0, plotAreaSqm: 100, buildingHeightM: 9.5 } },
  { label: 'mid plot, mid road, mid building', zone: sampleZone, inputs: { roadWidthM: 18.0, plotAreaSqm: 500, buildingHeightM: 15.0 } },
  { label: 'large plot, wide road, tall building', zone: sampleZone, inputs: { roadWidthM: 30.5, plotAreaSqm: 4000, buildingHeightM: 60.0 } },
  { label: 'no inputs', zone: sampleZone, inputs: {} },
  { label: 'only road width', zone: sampleZone, inputs: { roadWidthM: 18.0 } },
  { label: 'only height', zone: sampleZone, inputs: { buildingHeightM: 30.0 } },
  { label: 'plot area pushes G+1 tier into G+2 tier', zone: sampleZone, inputs: { roadWidthM: 12.0, plotAreaSqm: 200, buildingHeightM: 9.0 } },
  { label: 'TDR-eligible tier', zone: sampleZone, inputs: { roadWidthM: 24.5, plotAreaSqm: 2000, buildingHeightM: 24.0 } },
];

describe('buildEnvelope parity (backend vs frontend)', () => {
  test('FRONT_SETBACK_BY_ROAD_WIDTH constants match', () => {
    expect(frontend.FRONT_SETBACK_BY_ROAD_WIDTH).toEqual(backend.FRONT_SETBACK_BY_ROAD_WIDTH);
  });
  test('SETBACK_BY_HEIGHT constants match', () => {
    expect(frontend.SETBACK_BY_HEIGHT).toEqual(backend.SETBACK_BY_HEIGHT);
  });

  test.each(fixtures)('frontSetbackByRoadWidth parity: $label', ({ inputs }) => {
    expect(frontend.frontSetbackByRoadWidth(inputs.roadWidthM)).toEqual(
      backend.frontSetbackByRoadWidth(inputs.roadWidthM),
    );
  });

  test.each(fixtures)('setbackByHeight parity: $label', ({ inputs }) => {
    expect(frontend.setbackByHeight(inputs.buildingHeightM, inputs.plotAreaSqm)).toEqual(
      backend.setbackByHeight(inputs.buildingHeightM, inputs.plotAreaSqm),
    );
  });

  test.each(fixtures)('effectiveFARFromZone parity: $label', ({ zone, inputs }) => {
    expect(frontend.effectiveFARFromZone(zone, inputs.roadWidthM)).toEqual(
      backend.effectiveFARFromZone(zone, inputs.roadWidthM),
    );
  });

  test.each(fixtures)('calculateBuildEnvelope parity: $label', ({ zone, inputs }) => {
    expect(frontend.calculateBuildEnvelope(zone, inputs)).toEqual(
      backend.calculateBuildEnvelope(zone, inputs),
    );
  });
});

describe('buildEnvelope numeric correctness', () => {
  test('front setback for 6m road = 1.0m', () => {
    expect(backend.frontSetbackByRoadWidth(6.0)).toMatchObject({ front_m: 1.0 });
  });

  test('front setback for 18m road = 3.5m', () => {
    expect(backend.frontSetbackByRoadWidth(18.0)).toMatchObject({ front_m: 3.5 });
  });

  test('front setback for 60m road = 6.0m (top tier)', () => {
    expect(backend.frontSetbackByRoadWidth(60.0)).toMatchObject({ front_m: 6.0 });
  });

  test('setback for G+1 (≤9.5m) on 60sqm plot = 1.0/0.5/0.5', () => {
    expect(backend.setbackByHeight(9.0, 60)).toMatchObject({ front_m: 1.0, rear_m: 0.5, side_m: 0.5 });
  });

  test('setback for G+5 (15-18m) = 6.0/6.0/6.0 regardless of plot area', () => {
    expect(backend.setbackByHeight(17.0, 5000)).toMatchObject({ front_m: 6.0, rear_m: 6.0, side_m: 6.0 });
  });

  test('setback for G+19 (54-60m) = 15.0/15.0/15.0', () => {
    expect(backend.setbackByHeight(60.0, 5000)).toMatchObject({ front_m: 15.0, rear_m: 15.0, side_m: 15.0 });
  });

  test('effective FAR for R-PZ-A on 18.5m road = base 2.25 + TDR 0.45 = max 2.70', () => {
    const result = backend.effectiveFARFromZone(sampleZone, 18.5);
    expect(result).toMatchObject({ base_fsi: 2.25, tdr_addition: 0.45 });
    expect(result.max_fsi).toBeCloseTo(2.70, 2);
  });

  test('effective FAR for narrow road falls back to lowest tier', () => {
    const result = backend.effectiveFARFromZone(sampleZone, 5.0);
    expect(result).toMatchObject({ base_fsi: 1.50 });
  });

  test('full envelope: 1000 sqm plot, 18m road, 15m building → buildable, footprint, height cap', () => {
    const env = backend.calculateBuildEnvelope(sampleZone, { roadWidthM: 18.0, plotAreaSqm: 1000, buildingHeightM: 15.0 });
    expect(env.ok).toBe(true);
    expect(env.far.base_fsi).toBe(1.50); // tier 12.5 (15.5 not yet reached at exactly 18.0)
    expect(env.setbacks.front_m).toBeCloseTo(4.0, 2); // max(road=3.5, height=4.0)
    expect(env.setbacks.rear_m).toBe(4.0);
    expect(env.setbacks.side_m).toBe(4.0);
    expect(env.height.road_cap_m).toBeCloseTo(30.5, 2); // 1.5*18 + 3.5
    expect(env.height.allowed_max_m).toBeCloseTo(30.5, 2); // road cap < zone max (60)
    expect(env.capacity.buildable_base_sqm).toBe(1500); // 1000 * 1.5
    expect(env.capacity.footprint_cap_sqm).toBe(700); // 1000 * 70%
  });

  test('envelope without zone returns ok=false', () => {
    expect(backend.calculateBuildEnvelope(null, { roadWidthM: 12 })).toMatchObject({ ok: false });
  });
});
