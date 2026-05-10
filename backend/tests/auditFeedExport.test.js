'use strict';

// Tests for the merged-audit-feed CSV exporter and the bulk-batch
// pivot endpoint introduced alongside the AuditTab UX upgrade.

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

// The exporter calls listDealEvents, which calls getFinancials for
// the visibility gate. Mock both at the auditService boundary so
// these tests stay focused on CSV shape and don't pull the kernel.
jest.mock('../src/services/audit.service', () => ({
  listEvents: jest.fn(),
  summarizeEventOutputs: jest.fn(() => null),
}));
jest.mock('../src/services/dealAuditLog.service', () => ({
  listForDeal: jest.fn(),
}));

const { query } = require('../src/config/database');
const auditService = require('../src/services/audit.service');
const dealAuditLog = require('../src/services/dealAuditLog.service');
const financialService = require('../src/services/financial.service');

beforeEach(() => {
  jest.clearAllMocks();
});

// ── exportAuditFeedCSV ────────────────────────────────────────────────────

describe('exportAuditFeedCSV', () => {
  test('emits a header banner + column row + one data row per event', async () => {
    // Visibility gate — getFinancials hits the deals table.
    query.mockResolvedValueOnce({
      rows: [{ deal_id: 'd-1', irr_pct: 18, total_revenue_cr: 75 }],
    });
    auditService.listEvents.mockResolvedValueOnce([
      {
        id: 'fin-1',
        event_type: 'calculate_and_save',
        engine_version: 'kernel-v2',
        actor_id: 'u-1',
        inputs_hash: 'a'.repeat(64),
        outputs_hash: 'b'.repeat(64),
        signature: 'c'.repeat(64),
        created_at: '2026-05-09T10:00:00Z',
        outputs_json: { irr_pct: 22.4 },
      },
    ]);
    auditService.summarizeEventOutputs.mockReturnValueOnce({
      irr_pct: 22.4,
      npv_cr: 14,
      total_revenue_cr: 75,
      total_cost_cr: 42,
      gross_profit_cr: 33,
      gross_margin_pct: 43.3,
      equity_multiple: 1.85,
      residual_land_value_cr: 13,
    });
    dealAuditLog.listForDeal.mockResolvedValueOnce([
      {
        id: 'mut-1',
        deal_id: 'd-1',
        actor_id: 'u-1',
        event_type: 'stage_changed',
        before_json: { stage: 'sourced' },
        after_json: { stage: 'screening' },
        metadata: { notes: 'moved through gating' },
        created_at: '2026-05-09T11:00:00Z',
      },
    ]);
    // Actor lookup
    query.mockResolvedValueOnce({
      rows: [{ id: 'u-1', name: 'Rachit Jain', email: 'r@x.io' }],
    });

    const csv = await financialService.exportAuditFeedCSV('d-1');
    const lines = csv.split('\n');
    expect(lines[0]).toMatch(/REDIP Deal Audit Feed Export/);
    expect(lines[0]).toMatch(/d-1/);
    expect(lines[1]).toMatch(/Generated /);
    // line 2 is blank by design
    expect(lines[2]).toBe('');
    // header
    expect(lines[3]).toContain('created_at,kind,event_type,actor_name');
    // one row per event (mutation comes first because its created_at
    // is later than the financial event)
    expect(lines).toHaveLength(6);
    expect(lines[4]).toContain('mutation,stage_changed,Rachit Jain');
    expect(lines[5]).toContain('financial,calculate_and_save,Rachit Jain');
    expect(lines[5]).toContain('22.4'); // KPI snapshot column
  });

  test('escapes commas, quotes, newlines in CSV cells', async () => {
    query.mockResolvedValueOnce({
      rows: [{ deal_id: 'd-2' }],
    });
    auditService.listEvents.mockResolvedValueOnce([]);
    dealAuditLog.listForDeal.mockResolvedValueOnce([
      {
        id: 'm1',
        deal_id: 'd-2',
        actor_id: null,
        event_type: 'archived',
        before_json: { is_archived: false },
        after_json: { is_archived: true, archived_reason: 'Owner backed out, deal "dead"' },
        metadata: {},
        created_at: '2026-05-09T12:00:00Z',
      },
    ]);

    const csv = await financialService.exportAuditFeedCSV('d-2');
    // Reason contains both a comma and embedded quotes; should be
    // wrapped in quotes and have internal quotes doubled.
    expect(csv).toContain('"{""is_archived"":true,""archived_reason"":""Owner backed out, deal \\""dead\\""""}"');
  });
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
