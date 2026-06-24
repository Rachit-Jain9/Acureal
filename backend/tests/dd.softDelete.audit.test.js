'use strict';

// DD items — soft-delete + append-only audit. Same guarantees as the risk +
// approval suites, plus the status-toggle path (updateStatus) records a
// before/after transition.

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/lib/eventBus', () => ({
  EVENTS: { DD_ITEM_STATUS_CHANGED: 'dd_item.status_changed' },
  publish: jest.fn(),
}));
jest.mock('../src/services/dealAuditLog.service', () => ({ recordAudit: jest.fn() }));

const { query } = require('../src/config/database');
const dealAuditLog = require('../src/services/dealAuditLog.service');
const ddService = require('../src/services/dd.service');

const row = (over = {}) => ({
  id: 'i1', deal_id: 'd1', category: 'title', item_name: 'Mother deed chain',
  description: null, status: 'pending', severity: 'deal_breaker', is_required: true,
  notes: null, assigned_to: null, due_date: null, document_id: null, ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('dd.service — soft-delete + audit trail', () => {
  test('listByDeal excludes soft-deleted rows', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await ddService.listByDeal('d1');
    expect(query.mock.calls[0][0]).toMatch(/d\.deleted_at IS NULL/i);
  });

  test('create writes a dd_item_created audit row', async () => {
    query.mockResolvedValueOnce({ rows: [row()] });
    await ddService.create('d1', { category: 'title', item_name: 'Mother deed chain' }, 'u1');
    const arg = dealAuditLog.recordAudit.mock.calls[0][0];
    expect(arg.eventType).toBe('dd_item_created');
    expect(arg.actorId).toBe('u1');
    expect(arg.after).toMatchObject({ category: 'title', item_name: 'Mother deed chain', status: 'pending' });
  });

  test('delete soft-deletes (UPDATE, never DELETE) and writes dd_item_deleted audit', async () => {
    query.mockResolvedValueOnce({ rows: [row()] });
    const res = await ddService.delete('i1', 'u1');
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/UPDATE dd_items/i);
    expect(sql).toMatch(/SET deleted_at = NOW\(\)/i);
    expect(sql).not.toMatch(/DELETE FROM dd_items/i);
    expect(sql).toMatch(/deleted_at IS NULL/i);
    expect(res).toEqual({ id: 'i1' });
    expect(dealAuditLog.recordAudit.mock.calls[0][0].eventType).toBe('dd_item_deleted');
  });

  test('delete of an already-gone item returns null and writes no audit row', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await ddService.delete('missing', 'u1')).toBeNull();
    expect(dealAuditLog.recordAudit).not.toHaveBeenCalled();
  });

  test('update writes dd_item_updated with a before/after diff', async () => {
    query
      .mockResolvedValueOnce({ rows: [row({ item_name: 'Old' })] }) // getById before-snapshot
      .mockResolvedValueOnce({ rows: [row({ item_name: 'New' })] }); // UPDATE … RETURNING
    await ddService.update('i1', { item_name: 'New' }, 'u1');
    const arg = dealAuditLog.recordAudit.mock.calls[0][0];
    expect(arg.eventType).toBe('dd_item_updated');
    expect(arg.before).toEqual({ item_name: 'Old' });
    expect(arg.after).toEqual({ item_name: 'New' });
  });

  test('updateStatus writes a dd_item_updated audit on a real transition', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ status: 'pending' }] })          // before-status read
      .mockResolvedValueOnce({ rows: [row({ status: 'completed' })] });  // UPDATE … RETURNING
    await ddService.updateStatus('i1', 'completed', 'u1');
    const arg = dealAuditLog.recordAudit.mock.calls[0][0];
    expect(arg.eventType).toBe('dd_item_updated');
    expect(arg.before).toEqual({ status: 'pending' });
    expect(arg.after).toEqual({ status: 'completed' });
  });

  test('updateStatus writes no audit when the status is unchanged', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ status: 'completed' }] })
      .mockResolvedValueOnce({ rows: [row({ status: 'completed' })] });
    await ddService.updateStatus('i1', 'completed', 'u1');
    expect(dealAuditLog.recordAudit).not.toHaveBeenCalled();
  });

  test('getDDScore is live-scoped', async () => {
    query.mockResolvedValueOnce({ rows: [{ total_required: '0', completed_count: '0', flagged_count: '0', deal_breakers_total: '0', deal_breakers_done: '0' }] });
    await ddService.getDDScore('d1');
    expect(query.mock.calls[0][0]).toMatch(/deleted_at IS NULL/i);
  });
});
