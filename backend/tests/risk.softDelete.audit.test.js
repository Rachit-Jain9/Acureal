'use strict';

// Risk flags — soft-delete + append-only audit trail (audit-trail completeness).
//
// Guarantees asserted:
//   • create / update / soft-delete each write a deal_audit_log row with the
//     right event type and before/after payload (delete = soft UPDATE, never a
//     hard DELETE), so the Audit tab shows the full lifecycle.
//   • an idempotent / no-op change writes NO audit row.
//   • every read is scoped to live (deleted_at IS NULL) rows.

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/lib/eventBus', () => ({
  EVENTS: { RISK_FLAG_STATUS_CHANGED: 'risk_flag.status_changed' },
  publish: jest.fn(),
}));
jest.mock('../src/services/dealAuditLog.service', () => ({ recordAudit: jest.fn() }));

const { query } = require('../src/config/database');
const dealAuditLog = require('../src/services/dealAuditLog.service');
const riskService = require('../src/services/risk.service');

const liveRow = (over = {}) => ({
  id: 'r1', deal_id: 'd1', category: 'legal', severity: 'high', title: 'Title dispute',
  description: null, mitigation: null, status: 'open', source: 'manual', ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('risk.service — soft-delete + audit trail', () => {
  test('listByDeal excludes soft-deleted rows', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await riskService.listByDeal('d1');
    expect(query.mock.calls[0][0]).toMatch(/r\.deleted_at IS NULL/i);
  });

  test('create writes a risk_flag_created audit row', async () => {
    query.mockResolvedValueOnce({ rows: [liveRow()] });
    await riskService.create('d1', { category: 'legal', title: 'Title dispute', severity: 'high' }, 'u1');
    expect(dealAuditLog.recordAudit).toHaveBeenCalledTimes(1);
    const arg = dealAuditLog.recordAudit.mock.calls[0][0];
    expect(arg.eventType).toBe('risk_flag_created');
    expect(arg.dealId).toBe('d1');
    expect(arg.actorId).toBe('u1');
    expect(arg.after).toMatchObject({ severity: 'high', title: 'Title dispute', status: 'open' });
  });

  test('delete soft-deletes (UPDATE, never DELETE) and writes a risk_flag_deleted audit row', async () => {
    query.mockResolvedValueOnce({ rows: [liveRow()] });
    const res = await riskService.delete('r1', 'u1');

    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/UPDATE risk_flags/i);
    expect(sql).toMatch(/SET deleted_at = NOW\(\)/i);
    expect(sql).not.toMatch(/DELETE FROM risk_flags/i);
    expect(sql).toMatch(/deleted_at IS NULL/i); // re-delete idempotency guard

    expect(res).toEqual({ id: 'r1' });
    expect(dealAuditLog.recordAudit).toHaveBeenCalledTimes(1);
    const arg = dealAuditLog.recordAudit.mock.calls[0][0];
    expect(arg.eventType).toBe('risk_flag_deleted');
    expect(arg.actorId).toBe('u1');
    expect(arg.before).toMatchObject({ title: 'Title dispute', severity: 'high' });
  });

  test('delete of an already-gone flag returns null and writes no audit row', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await riskService.delete('missing', 'u1');
    expect(res).toBeNull();
    expect(dealAuditLog.recordAudit).not.toHaveBeenCalled();
  });

  test('update writes a risk_flag_updated audit row with a before/after diff', async () => {
    query
      .mockResolvedValueOnce({ rows: [liveRow({ title: 'Old' })] }) // before-snapshot
      .mockResolvedValueOnce({ rows: [liveRow({ title: 'New' })] }); // UPDATE … RETURNING
    await riskService.update('r1', { title: 'New' }, 'u1');

    expect(dealAuditLog.recordAudit).toHaveBeenCalledTimes(1);
    const arg = dealAuditLog.recordAudit.mock.calls[0][0];
    expect(arg.eventType).toBe('risk_flag_updated');
    expect(arg.before).toEqual({ title: 'Old' });
    expect(arg.after).toEqual({ title: 'New' });
  });

  test('update with no actual change writes no audit row', async () => {
    query
      .mockResolvedValueOnce({ rows: [liveRow({ title: 'Same' })] })
      .mockResolvedValueOnce({ rows: [liveRow({ title: 'Same' })] });
    await riskService.update('r1', { title: 'Same' }, 'u1');
    expect(dealAuditLog.recordAudit).not.toHaveBeenCalled();
  });

  test('empty-body update reads org + live scoped and writes no audit row', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'r1' }] });
    await riskService.update('r1', {}, 'u1');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/deleted_at IS NULL/i);
    expect(dealAuditLog.recordAudit).not.toHaveBeenCalled();
  });
});
