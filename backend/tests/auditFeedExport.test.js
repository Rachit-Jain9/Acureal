'use strict';

// Tests for the bulk-batch pivot endpoint introduced alongside the
// AuditTab UX upgrade.

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../src/config/database');
const financialService = require('../src/services/financial.service');

beforeEach(() => {
  jest.clearAllMocks();
});

// ── listDealsForBulkBatch ─────────────────────────────────────────────────

describe('listDealsForBulkBatch', () => {
  test('returns [] for missing bulk_id without hitting the DB', async () => {
    const rows = await financialService.listDealsForBulkBatch(null);
    expect(rows).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  test('returns the list of deal-batch rows joined to deal name + stage', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { deal_id: 'd-1', event_type: 'bulk_archived', deal_name: 'A', deal_stage: 'screening', deal_is_archived: true,  before_json: {}, after_json: {}, created_at: '2026-05-09T10:00:00Z' },
        { deal_id: 'd-2', event_type: 'bulk_archived', deal_name: 'B', deal_stage: 'screening', deal_is_archived: true,  before_json: {}, after_json: {}, created_at: '2026-05-09T10:00:00Z' },
      ],
    });
    const rows = await financialService.listDealsForBulkBatch('batch-1');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ deal_id: 'd-1', deal_name: 'A' });
    // Verify the bulk_id is passed through into the JSONB filter.
    const sql = query.mock.calls[0][0];
    const params = query.mock.calls[0][1];
    expect(sql).toMatch(/metadata->>'bulk_id'/);
    expect(params).toEqual(['batch-1']);
  });

  test('returns [] when the migration has not been applied yet (42P01)', async () => {
    const err = new Error('relation "deal_audit_log" does not exist');
    err.code = '42P01';
    query.mockRejectedValueOnce(err);
    const rows = await financialService.listDealsForBulkBatch('batch-1');
    expect(rows).toEqual([]);
  });

  test('rethrows on a generic DB error', async () => {
    const err = new Error('connection terminated');
    query.mockRejectedValueOnce(err);
    await expect(financialService.listDealsForBulkBatch('batch-1'))
      .rejects.toThrow('connection terminated');
  });
});
