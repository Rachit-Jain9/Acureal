'use strict';

// Tests for the niche-asset-class benchmarks service introduced as the
// scaffold for Tier 1 #6–#9 (co-working, student housing, senior living,
// data centers). The migration is intentionally data-free; these tests
// pin the read-side contract so the route can soft-fail to [] when the
// table is missing and reject unknown asset classes without a 400.

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../src/config/database');
const intelligenceService = require('../src/services/intelligence.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getNicheAssetClassBenchmarks', () => {
  test('returns rows ordered by asset_class then value', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: 'r1', asset_class: 'coworking', value_avg: 9000 },
        { id: 'r2', asset_class: 'student_housing', value_avg: 22000 },
      ],
    });
    const rows = await intelligenceService.getNicheAssetClassBenchmarks({ city: 'Bengaluru' });
    expect(rows).toHaveLength(2);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/FROM niche_asset_class_benchmarks/);
    expect(sql).toMatch(/ORDER BY asset_class ASC/);
  });

  test('filters by assetClass when provided', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await intelligenceService.getNicheAssetClassBenchmarks({
      city: 'Bengaluru',
      assetClass: 'data_center',
    });
    const params = query.mock.calls[0][1];
    expect(params).toContain('data_center');
  });

  test('filters by dataType when provided', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await intelligenceService.getNicheAssetClassBenchmarks({
      city: 'Bengaluru',
      dataType: 'ipc_q1_2026',
    });
    const params = query.mock.calls[0][1];
    expect(params).toContain('ipc_q1_2026');
  });

  test('rejects unknown asset_class with [] (not an error)', async () => {
    const rows = await intelligenceService.getNicheAssetClassBenchmarks({
      city: 'Bengaluru',
      assetClass: 'fictional_asset',
    });
    expect(rows).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  test('soft-fails to [] when the migration is missing (Postgres 42P01)', async () => {
    const err = new Error('relation "niche_asset_class_benchmarks" does not exist');
    err.code = '42P01';
    query.mockRejectedValueOnce(err);
    const rows = await intelligenceService.getNicheAssetClassBenchmarks({ city: 'Bengaluru' });
    expect(rows).toEqual([]);
  });

  test('rethrows on a generic DB error so caller can surface it', async () => {
    const err = new Error('connection terminated');
    query.mockRejectedValueOnce(err);
    await expect(
      intelligenceService.getNicheAssetClassBenchmarks({ city: 'Bengaluru' }),
    ).rejects.toThrow('connection terminated');
  });

  test('NICHE_ASSET_CLASSES export covers all four classes', () => {
    expect(intelligenceService.NICHE_ASSET_CLASSES).toEqual([
      'coworking',
      'student_housing',
      'senior_living',
      'data_center',
    ]);
  });
});
