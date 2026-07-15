'use strict';

// Export-QA runner: rent-roll register consistency + seeded-model staleness.
// WARN-only, fail-open, reads the already-computed export slice — the runner
// must never re-derive register math.

const { __internal } = require('../src/services/exports/xlsx/v2/marketBenchmarkValidator');

const { validateRentRollConsistency } = __internal;

const collect = () => {
  const issues = [];
  const addIssue = (severity, check, field, message, action, scope) =>
    issues.push({ severity, check, field, message, action, scope });
  return { issues, addIssue };
};

const SLICE = {
  family: 'lease_income',
  dataHash: 'hash-live',
  warnings: [
    { code: 'expiry_before_start', message: '1 lease(s) expire on or before their start date.' },
    { code: 'model_rent_drift', message: 'Register in-place rent diverges 28% from the model.' },
  ],
};

describe('validateRentRollConsistency', () => {
  test('silent when no register slice exists', () => {
    const { issues, addIssue } = collect();
    validateRentRollConsistency({ exportContext: {} }, {}, addIssue);
    expect(issues).toEqual([]);
  });

  test('surfaces register findings as WARN issues', () => {
    const { issues, addIssue } = collect();
    validateRentRollConsistency({ exportContext: { rentRoll: SLICE } }, {}, addIssue);
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.severity === 'warn')).toBe(true);
    expect(issues[0].field).toBe('expiry_before_start');
    expect(issues[1].message).toMatch(/diverges/);
  });

  test('caps listed findings and reports the remainder count', () => {
    const many = {
      ...SLICE,
      warnings: Array.from({ length: 8 }, (_, i) => ({ code: `w${i}`, message: `finding ${i}` })),
    };
    const { issues, addIssue } = collect();
    validateRentRollConsistency({ exportContext: { rentRoll: many } }, {}, addIssue);
    expect(issues).toHaveLength(6); // 5 listed + 1 remainder
    expect(issues[5].message).toMatch(/3 further register finding/);
  });

  test('flags staleness when the seeded snapshot hash differs from the live register', () => {
    const { issues, addIssue } = collect();
    validateRentRollConsistency({
      exportContext: {
        rentRoll: { ...SLICE, warnings: [] },
        deal: { model_params: { rentRollProvenance: { dataHash: 'hash-old' } } },
      },
    }, {}, addIssue);
    expect(issues).toHaveLength(1);
    expect(issues[0].check).toBe('Rent roll — model staleness');
    expect(issues[0].severity).toBe('warn'); // never a blocker
  });

  test('silent on staleness when hashes match or no provenance exists', () => {
    const { issues, addIssue } = collect();
    validateRentRollConsistency({
      exportContext: {
        rentRoll: { ...SLICE, warnings: [] },
        deal: { model_params: { rentRollProvenance: { dataHash: 'hash-live' } } },
      },
    }, {}, addIssue);
    validateRentRollConsistency({
      exportContext: { rentRoll: { ...SLICE, warnings: [] }, deal: { model_params: {} } },
    }, {}, addIssue);
    expect(issues).toEqual([]);
  });
});
