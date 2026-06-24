'use strict';

// Documents — soft-delete keeps the stored bytes (recoverable for the retention
// window) + writes a deal_audit_log row. The bytes are only removed later by the
// purge cron (see entityPurge.service.test.js), NEVER on the user delete.

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/config/storage', () => ({
  uploadFile: jest.fn(), createUploadUrl: jest.fn(), getDownloadUrl: jest.fn(),
  getStoredObjectSize: jest.fn(), fetchStoredFile: jest.fn(), deleteStorageFile: jest.fn(),
}));
jest.mock('../src/lib/eventBus', () => ({ EVENTS: {}, publish: jest.fn() }));
jest.mock('../src/services/dealAuditLog.service', () => ({ recordAudit: jest.fn() }));

const { query } = require('../src/config/database');
const { deleteStorageFile } = require('../src/config/storage');
const dealAuditLog = require('../src/services/dealAuditLog.service');
const documentService = require('../src/services/document.service');

const liveDoc = {
  id: 'doc1', deal_id: 'd1', name: 'Sale deed.pdf', doc_category: 'title',
  file_url: 'blob://x', organization_id: 'o1', deal_archived: false, deal_stage: 'diligence',
};

beforeEach(() => jest.clearAllMocks());

describe('document.service.deleteDocument — soft-delete keeps bytes + audits', () => {
  test('soft-deletes the row, does NOT delete storage, writes a document_deleted audit', async () => {
    query
      .mockResolvedValueOnce({ rows: [liveDoc] }) // org + live-scoped pre-fetch
      .mockResolvedValueOnce({ rowCount: 1 });     // soft-delete UPDATE

    const res = await documentService.deleteDocument('doc1', 'u1', 'd1');

    // pre-fetch is live-scoped
    expect(query.mock.calls[0][0]).toMatch(/deleted_at IS NULL/i);
    // the mutation is a soft-delete UPDATE, never a hard DELETE
    expect(query.mock.calls[1][0]).toMatch(/UPDATE documents SET deleted_at = NOW\(\)/i);
    expect(query.mock.calls.some((c) => /DELETE FROM documents/i.test(c[0]))).toBe(false);
    // the stored bytes MUST survive until purge
    expect(deleteStorageFile).not.toHaveBeenCalled();

    expect(dealAuditLog.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'document_deleted', dealId: 'd1', actorId: 'u1' }),
    );
    expect(res).toEqual({ deleted: true, id: 'doc1' });
  });

  test('404s on a missing or already soft-deleted document, no storage touch, no audit', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // pre-fetch finds nothing (live-scoped)
    await expect(documentService.deleteDocument('gone', 'u1', 'd1')).rejects.toThrow(/not found/i);
    expect(deleteStorageFile).not.toHaveBeenCalled();
    expect(dealAuditLog.recordAudit).not.toHaveBeenCalled();
  });
});
