'use strict';

/**
 * Unit tests for rera/consistency — the cockpit-facing shaper over the existing
 * deterministic inconsistencyDetector. Pure shaping + graceful degradation.
 */

jest.mock('../src/services/extraction.service', () => ({
  getDealExtractions: jest.fn(),
}));
// Partial mock — keep the real nameSimilarity (used by groundTruthChecks), mock
// only the cross-document comparator entry point.
jest.mock('../src/services/inconsistencyDetector.service', () => {
  const actual = jest.requireActual('../src/services/inconsistencyDetector.service');
  return { ...actual, runAllComparators: jest.fn() };
});

const extractionService = require('../src/services/extraction.service');
const inconsistencyDetector = require('../src/services/inconsistencyDetector.service');
const reraConsistency = require('../src/services/rera/consistency');

beforeEach(() => {
  extractionService.getDealExtractions.mockReset();
  inconsistencyDetector.runAllComparators.mockReset();
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
  test('merges detector + ground-truth findings, marks available', async () => {
    extractionService.getDealExtractions.mockResolvedValue({
      extractions: [{}, {}, {}],
      field_map: { khata_number: { value: 'KH-999' } },
    });
    inconsistencyDetector.runAllComparators.mockReturnValue([
      { pair_key: 'area:1:2', severity: 'high', title: 'Area mismatch', evidence: [] },
    ]);
    const deal = { khata_no: 'KH-111', owner_name: null };
    const out = await reraConsistency.composeReraConsistency('deal-1', deal);
    expect(out.available).toBe(true);
    expect(out.extractions_count).toBe(3);
    const titles = out.findings.map((f) => f.title);
    expect(titles).toContain('Area mismatch');
    expect(titles).toContain('Khata number on file differs from the document');
  });

  test('no deal → detector findings only (no ground-truth)', async () => {
    extractionService.getDealExtractions.mockResolvedValue({ extractions: [], field_map: { khata_number: { value: 'KH-999' } } });
    inconsistencyDetector.runAllComparators.mockReturnValue([]);
    const out = await reraConsistency.composeReraConsistency('deal-1', null);
    expect(out.findings).toEqual([]);
  });

  test('degrades to unavailable on error (never throws)', async () => {
    extractionService.getDealExtractions.mockRejectedValue(new Error('extractions table absent'));
    const out = await reraConsistency.composeReraConsistency('deal-1', {});
    expect(out.available).toBe(false);
    expect(out.findings).toEqual([]);
    expect(out.summary.total).toBe(0);
  });
});
