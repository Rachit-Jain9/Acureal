'use strict';

// The 15-day hard-purge cron for soft-deleted deal child entities.
// Critical guarantees: documents delete their stored bytes BEFORE the DB row,
// the purge targets only tombstones older than the retention window, and one
// failing table never aborts the others.

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/config/storage', () => ({ deleteStorageFile: jest.fn() }));
jest.mock('../src/services/dealAuditLog.service', () => ({ recordAudit: jest.fn() }));

const { query } = require('../src/config/database');
const { deleteStorageFile } = require('../src/config/storage');
const dealAuditLog = require('../src/services/dealAuditLog.service');
const entityPurge = require('../src/services/entityPurge.service');

beforeEach(() => jest.clearAllMocks());

describe('entityPurge — daily hard-purge of soft-deleted entities', () => {
  test('purgeDocuments deletes storage BEFORE the DB row, then audits the purge', async () => {
    const order = [];
    deleteStorageFile.mockImplementation(async () => { order.push('storage'); });
    query.mockImplementation(async (sql) => {
      if (/SELECT id, deal_id, file_url FROM documents/i.test(sql)) {
        return { rows: [{ id: 'doc1', deal_id: 'd1', file_url: 'blob://x' }] };
      }
      if (/DELETE FROM documents/i.test(sql)) { order.push('db_delete'); return { rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    });

    const res = await entityPurge.purgeDocuments();

    expect(deleteStorageFile).toHaveBeenCalledWith('blob://x');
    expect(order).toEqual(['storage', 'db_delete']); // storage first — no orphaned bytes
    expect(dealAuditLog.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'document_purged', dealId: 'd1' }),
    );
    expect(res.rows_purged).toBe(1);
  });

  test('purgeDocuments with nothing expired touches neither storage nor a DB delete', async () => {
    query.mockResolvedValue({ rows: [] });
    const res = await entityPurge.purgeDocuments();
    expect(deleteStorageFile).not.toHaveBeenCalled();
    expect(res.rows_purged).toBe(0);
  });

  test('purgeTable hard-deletes only tombstones older than the retention window', async () => {
    query.mockResolvedValue({ rowCount: 3 });
    const res = await entityPurge.purgeTable('risk_flags');
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/DELETE FROM risk_flags/i);
    expect(sql).toMatch(/deleted_at IS NOT NULL/i);
    expect(sql).toMatch(/INTERVAL '1 day'/i);
    expect(query.mock.calls[0][1]).toEqual([entityPurge.RETENTION_DAYS]);
    expect(res.rows_purged).toBe(3);
  });

  test('runSweep covers documents + the three simple tables and isolates a failure', async () => {
    query.mockImplementation(async (sql) => {
      if (/FROM documents/i.test(sql)) return { rows: [] };
      if (/DELETE FROM approval_items/i.test(sql)) throw new Error('boom');
      return { rowCount: 0 };
    });
    const res = await entityPurge.runSweep();
    expect(res).toHaveProperty('documents');
    expect(res).toHaveProperty('risk_flags');
    expect(res).toHaveProperty('dd_items');
    expect(res.approval_items).toEqual({ error: 'boom' }); // isolated, not fatal
    expect(res.retention_days).toBe(entityPurge.RETENTION_DAYS);
  });
});
