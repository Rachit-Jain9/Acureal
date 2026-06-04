'use strict';

/**
 * Unit tests for rera/consistency — the cockpit-facing shaper over the existing
 * deterministic inconsistencyDetector. Pure shaping + graceful degradation.
 */

jest.mock('../src/services/inconsistencyDetector.service', () => ({
  detect: jest.fn(),
}));

const inconsistencyDetector = require('../src/services/inconsistencyDetector.service');
const reraConsistency = require('../src/services/rera/consistency');

beforeEach(() => {
  inconsistencyDetector.detect.mockReset();
});

describe('shapeConsistency', () => {
  test('sorts findings by severity and rolls up a count summary', () => {
    const out = reraConsistency.shapeConsistency([
      { pair_key: 'a', severity: 'medium', title: 'M', evidence: [] },
      { pair_key: 'b', severity: 'critical', title: 'C', evidence: [] },
      { pair_key: 'c', severity: 'low', title: 'L', evidence: [] },
      { pair_key: 'd', severity: 'high', title: 'H', evidence: [] },
    ]);
    expect(out.findings.map((f) => f.severity)).toEqual(['critical', 'high', 'medium', 'low']);
    expect(out.summary).toEqual({ total: 4, critical: 1, high: 1, medium: 1, low: 1 });
  });

  test('empty input → empty findings + zero summary', () => {
    const out = reraConsistency.shapeConsistency([]);
    expect(out.findings).toEqual([]);
    expect(out.summary.total).toBe(0);
  });

  test('tolerates missing fields (defaults severity low, evidence [])', () => {
    const out = reraConsistency.shapeConsistency([{}]);
    expect(out.findings[0].severity).toBe('low');
    expect(out.findings[0].evidence).toEqual([]);
  });
});

describe('composeReraConsistency', () => {
  test('shapes detector findings + marks available', async () => {
    inconsistencyDetector.detect.mockResolvedValue({
      findings: [{ pair_key: 'area:1:2', severity: 'high', title: 'Area mismatch', evidence: [] }],
      extractions_count: 3,
    });
    const out = await reraConsistency.composeReraConsistency('deal-1');
    expect(out.available).toBe(true);
    expect(out.extractions_count).toBe(3);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].title).toBe('Area mismatch');
  });

  test('degrades to unavailable on detector error (never throws)', async () => {
    inconsistencyDetector.detect.mockRejectedValue(new Error('extractions table absent'));
    const out = await reraConsistency.composeReraConsistency('deal-1');
    expect(out.available).toBe(false);
    expect(out.findings).toEqual([]);
    expect(out.summary.total).toBe(0);
  });
});
