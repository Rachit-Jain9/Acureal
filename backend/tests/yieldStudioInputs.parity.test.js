'use strict';

// Parity guard: backend + frontend each ship a copy of yieldStudioInputs.js
// (the UI→engine assumptions converter). They MUST stay identical so an export
// recompute matches what the analyst saw in the tab. Reads the frontend file,
// strips ESM `export`, evals under a CJS shim, runs identical fixtures.

const fs = require('fs');
const path = require('path');
const Module = require('module');

const backend = require('../src/utils/yieldStudioInputs');

const frontendSrc = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'yieldStudioInputs.js'),
  'utf8',
);
const exportNames = [];
const stripped = frontendSrc.replace(/^export\s+(const|function|let)\s+(\w+)/gm, (_, kind, name) => {
  exportNames.push(name);
  return `${kind} ${name}`;
});
const m = new Module('frontend-yieldStudioInputs');
m._compile(`${stripped}\nmodule.exports = { ${exportNames.join(', ')} };\n`, 'frontend/src/utils/yieldStudioInputs.js');
const frontend = m.exports;

const fixtures = [
  { family: 'residential', a: { loadingFactorPct: 30, parkingEcsPerUnit: 1.3, mix: [{ key: '2bhk', label: '2 BHK', carpet_sqft: 1000, share_pct: 100 }] } },
  { family: 'residential', a: { loadingFactorPct: '', parkingEcsPerUnit: '' } }, // cleared → defaults
  { family: 'commercial', a: { leasableEfficiencyPct: 80, parkingEcsPer100Sqm: 1.6 } },
  { family: 'industrial', a: { leasableEfficiencyPct: 90, parkingEcsPer100Sqm: 0.4 } },
  { family: 'hospitality', a: { grossAreaPerKeySqft: 1000, parkingEcsPerKey: 0.5 } },
  { family: 'plotted', a: { saleableLandPct: 55, avgPlotSizeSqft: 1200, villaPlotCoveragePct: 50, villaFloors: 2 } },
  { family: 'residential', a: {} },
];

describe('yieldStudioInputs parity (backend vs frontend)', () => {
  test.each(fixtures)('buildEngineAssumptions parity: $family', ({ family, a }) => {
    expect(frontend.buildEngineAssumptions(family, a)).toEqual(backend.buildEngineAssumptions(family, a));
  });

  test('cleared residential loading factor omits loadingFactor (falls back to engine default)', () => {
    expect(backend.buildEngineAssumptions('residential', { loadingFactorPct: '' })).not.toHaveProperty('loadingFactor');
    expect(backend.buildEngineAssumptions('residential', { loadingFactorPct: 25 })).toEqual({ loadingFactor: 0.25 });
  });
});
