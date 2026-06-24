'use strict';

// Approval items — soft-delete + append-only audit (legal-four lane: statutory
// approval status). Same guarantees as the risk-flag suite, plus the re-seed
// dedup must ignore soft-deleted names so a deleted approval can be re-created.

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/lib/eventBus', () => ({
  EVENTS: { APPROVAL_STATUS_CHANGED: 'approval.status_changed' },
  publish: jest.fn(),
}));
jest.mock('../src/services/dealAuditLog.service', () => ({ recordAudit: jest.fn() }));

const { query } = require('../src/config/database');
const dealAuditLog = require('../src/services/dealAuditLog.service');
const approvalsService = require('../src/services/approvals.service');

const row = (over = {}) => ({
  id: 'a1', deal_id: 'd1', approval_type: 'rera', name: 'RERA Karnataka Registration',
  status: 'pending', is_validated: false, is_required: true,
  issued_date: null, expiry_date: null, reference_number: null, issuing_authority: null,
  document_id: null, is_available: false, is_uploaded: false, notes: null, next_action: null, ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('approvals.service — soft-delete + audit trail', () => {
  test('listByDeal excludes soft-deleted rows', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await approvalsService.listByDeal('d1');
    expect(query.mock.calls[0][0]).toMatch(/a\.deleted_at IS NULL/i);
  });

  test('create writes an approval_created audit row', async () => {
    query.mockResolvedValueOnce({ rows: [row()] });
    await approvalsService.create('d1', { approval_type: 'rera', name: 'RERA Karnataka Registration' }, 'u1');
    const arg = dealAuditLog.recordAudit.mock.calls[0][0];
    expect(arg.eventType).toBe('approval_created');
    expect(arg.dealId).toBe('d1');
    expect(arg.actorId).toBe('u1');
    expect(arg.after).toMatchObject({ approval_type: 'rera', name: 'RERA Karnataka Registration', status: 'pending' });
  });

  test('delete soft-deletes (UPDATE, never DELETE) and writes approval_deleted audit', async () => {
    query.mockResolvedValueOnce({ rows: [row()] });
    const res = await approvalsService.delete('a1', 'u1');
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/UPDATE approval_items/i);
    expect(sql).toMatch(/SET deleted_at = NOW\(\)/i);
    expect(sql).not.toMatch(/DELETE FROM approval_items/i);
    expect(sql).toMatch(/deleted_at IS NULL/i);
    expect(res).toEqual({ id: 'a1' });
    expect(dealAuditLog.recordAudit.mock.calls[0][0].eventType).toBe('approval_deleted');
  });

  test('delete of an already-gone item returns null and writes no audit row', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await approvalsService.delete('missing', 'u1')).toBeNull();
    expect(dealAuditLog.recordAudit).not.toHaveBeenCalled();
  });

  test('update writes approval_updated with a before/after diff (approved → validated)', async () => {
    query
      .mockResolvedValueOnce({ rows: [row({ status: 'pending' })] })   // before-snapshot
      .mockResolvedValueOnce({ rows: [row({ status: 'validated' })] }); // UPDATE … RETURNING
    await approvalsService.update('a1', { status: 'approved' }, 'u1');
    const arg = dealAuditLog.recordAudit.mock.calls[0][0];
    expect(arg.eventType).toBe('approval_updated');
    expect(arg.before).toEqual({ status: 'pending' });
    expect(arg.after).toEqual({ status: 'validated' });
  });

  test('update with no actual change writes no audit row', async () => {
    query
      .mockResolvedValueOnce({ rows: [row({ notes: 'same' })] })
      .mockResolvedValueOnce({ rows: [row({ notes: 'same' })] });
    await approvalsService.update('a1', { notes: 'same' }, 'u1');
    expect(dealAuditLog.recordAudit).not.toHaveBeenCalled();
  });

  test('empty-body update reads org + live scoped and writes no audit row', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'a1' }] });
    await approvalsService.update('a1', {}, 'u1');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/deleted_at IS NULL/i);
    expect(dealAuditLog.recordAudit).not.toHaveBeenCalled();
  });

  test('seedForDeal dedup ignores soft-deleted names (so a deleted approval can re-seed)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ asset_class: 'plotted_development', deal_structure: null }] }) // deal lookup
      .mockResolvedValueOnce({ rows: [] })  // existing-names dedup read
      .mockResolvedValueOnce({ rows: [] }); // INSERT … RETURNING
    await approvalsService.seedForDeal('d1', null, null);
    const dedup = query.mock.calls.find((c) => /SELECT name FROM approval_items/i.test(c[0]));
    expect(dedup[0]).toMatch(/deleted_at IS NULL/i);
  });
});
