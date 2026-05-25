'use strict';

// Parity guard: backend and frontend each ship a copy of dealStructureMatrix.js
// (the operator's established pure-JS + parity-test pattern, mirrored from
// `buildEnvelope.parity.test.js`). The two are read by different runtimes so
// we can't import from one place, but they MUST stay identical. This test reads
// the frontend file, strips the ESM `export ` keywords, evals it under a
// CommonJS shim, and asserts every export matches the backend counterpart.

const fs = require('fs');
const path = require('path');
const Module = require('module');

const backend = require('../src/utils/dealStructureMatrix');

const frontendSrc = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'dealStructureMatrix.js'),
  'utf8',
);

const exportNames = [];
const stripped = frontendSrc.replace(
  /^export\s+(const|function|let)\s+(\w+)/gm,
  (_, kind, name) => {
    exportNames.push(name);
    return `${kind} ${name}`;
  },
);
const cjsSource = `${stripped}\nmodule.exports = { ${exportNames.join(', ')} };\n`;
const m = new Module('frontend-dealStructureMatrix');
m._compile(cjsSource, 'frontend/src/utils/dealStructureMatrix.js');
const frontend = m.exports;

describe('dealStructureMatrix parity (backend vs frontend)', () => {
  test('ASSET_CLASSES match', () => {
    expect(frontend.ASSET_CLASSES).toEqual(backend.ASSET_CLASSES);
  });
  test('DEAL_STRUCTURES match', () => {
    expect(frontend.DEAL_STRUCTURES).toEqual(backend.DEAL_STRUCTURES);
  });
  test('INVALID_PAIRS match', () => {
    expect(frontend.INVALID_PAIRS).toEqual(backend.INVALID_PAIRS);
  });
  test('STRUCTURE_APPROVALS match', () => {
    expect(frontend.STRUCTURE_APPROVALS).toEqual(backend.STRUCTURE_APPROVALS);
  });
  test('STRUCTURE_REQUIRED_DOCTYPES match', () => {
    expect(frontend.STRUCTURE_REQUIRED_DOCTYPES).toEqual(backend.STRUCTURE_REQUIRED_DOCTYPES);
  });
  test('STRUCTURE_RISK_PRESETS match', () => {
    expect(frontend.STRUCTURE_RISK_PRESETS).toEqual(backend.STRUCTURE_RISK_PRESETS);
  });
  test('STRUCTURE_SIGNAL_HINTS match', () => {
    expect(frontend.STRUCTURE_SIGNAL_HINTS).toEqual(backend.STRUCTURE_SIGNAL_HINTS);
  });
  test('ASSET_CLASS_STRUCTURE_OVERLAYS match', () => {
    expect(frontend.ASSET_CLASS_STRUCTURE_OVERLAYS).toEqual(backend.ASSET_CLASS_STRUCTURE_OVERLAYS);
  });
  test('ASSET_CLASS_RISK_BUMPS match', () => {
    expect(frontend.ASSET_CLASS_RISK_BUMPS).toEqual(backend.ASSET_CLASS_RISK_BUMPS);
  });

  // Spot-check a few lookups end-to-end with full fixtures so that any drift in
  // logic (not just constants) gets caught.
  const lookupFixtures = [
    { assetClass: 'residential_apartments', dealStructure: 'jda' },
    { assetClass: 'commercial_office', dealStructure: 'ground_lease' },
    { assetClass: 'redevelopment', dealStructure: 'jda' },
    { assetClass: 'hospitality', dealStructure: 'jv' },
    { assetClass: 'plotted_development', dealStructure: 'ground_lease' }, // invalid
    { assetClass: null, dealStructure: null },
    { assetClass: 'commercial_office', dealStructure: 'outright' },
  ];

  test.each(lookupFixtures)('isValidPair parity: $assetClass + $dealStructure', ({ assetClass, dealStructure }) => {
    expect(frontend.isValidPair(assetClass, dealStructure))
      .toEqual(backend.isValidPair(assetClass, dealStructure));
  });

  test.each(lookupFixtures)('getAdditionalApprovals parity: $assetClass + $dealStructure', ({ assetClass, dealStructure }) => {
    expect(frontend.getAdditionalApprovals(assetClass, dealStructure))
      .toEqual(backend.getAdditionalApprovals(assetClass, dealStructure));
  });

  test.each(lookupFixtures)('getRequiredDoctypes parity: $assetClass + $dealStructure', ({ assetClass, dealStructure }) => {
    expect(frontend.getRequiredDoctypes(assetClass, dealStructure))
      .toEqual(backend.getRequiredDoctypes(assetClass, dealStructure));
  });

  test.each(lookupFixtures)('getRiskPreset parity: $assetClass + $dealStructure', ({ assetClass, dealStructure }) => {
    expect(frontend.getRiskPreset(assetClass, dealStructure))
      .toEqual(backend.getRiskPreset(assetClass, dealStructure));
  });

  test.each(lookupFixtures)('getSignalHints parity: $assetClass + $dealStructure', ({ assetClass, dealStructure }) => {
    expect(frontend.getSignalHints(assetClass, dealStructure))
      .toEqual(backend.getSignalHints(assetClass, dealStructure));
  });

  test.each(lookupFixtures)('getPairBehavior parity: $assetClass + $dealStructure', ({ assetClass, dealStructure }) => {
    expect(frontend.getPairBehavior(assetClass, dealStructure))
      .toEqual(backend.getPairBehavior(assetClass, dealStructure));
  });
});
