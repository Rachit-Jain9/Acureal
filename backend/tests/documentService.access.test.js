'use strict';

// The deal-document download paths must publish a DOCUMENT_ACCESSED audit
// event with the right shape — the app-layer half of the CLAUDE.md
// "log access to sensitive documents" requirement. Access is logged only on a
// genuine, successful access (URL issued / bytes streamed), never on a 404 or
// a storage failure.

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/config/storage', () => ({
  uploadFile: jest.fn(),
  createUploadUrl: jest.fn(),
  getDownloadUrl: jest.fn(async () => 'https://signed.example/file.pdf'),
  fetchStoredFile: jest.fn(),
  deleteStorageFile: jest.fn(),
}));
jest.mock('../src/lib/eventBus', () => ({
  EVENTS: { DOCUMENT_UPLOADED: 'document.uploaded', DOCUMENT_ACCESSED: 'document.accessed' },
  publish: jest.fn(),
}));

const { query } = require('../src/config/database');
const storage = require('../src/config/storage');
const { EVENTS, publish } = require('../src/lib/eventBus');
const documentService = require('../src/services/document.service');

const DOC_ROW = {
  id: 'doc-1',
  name: 'Title Deed.pdf',
  file_url: 'organizations/org-1/deals/deal-1/title.pdf',
  deal_id: 'deal-1',
  organization_id: 'org-1',
  doc_category: 'legal',
  deal_archived: false,
  deal_stage: 'due_diligence',
};

const CTX = { userId: 'user-1', organizationId: 'org-1', ip: '203.0.113.9', userAgent: 'UA/1.0' };

beforeEach(() => jest.clearAllMocks());

describe('getSignedUrl — access audit', () => {
  test('publishes DOCUMENT_ACCESSED (signed_url) after the URL is issued', async () => {
    query.mockResolvedValueOnce({ rows: [DOC_ROW] });
    const out = await documentService.getSignedUrl('doc-1', 'deal-1', CTX);
    expect(out.url).toBe('https://signed.example/file.pdf');
    expect(publish).toHaveBeenCalledWith(
      EVENTS.DOCUMENT_ACCESSED,
      expect.objectContaining({
        documentId: 'doc-1',
        action: 'signed_url',
        documentKind: 'deal_document',
        organizationId: 'org-1',
        userId: 'user-1',
        dealId: 'deal-1',
        documentName: 'Title Deed.pdf',
        ip: '203.0.113.9',
        userAgent: 'UA/1.0',
      }),
    );
  });

  test('does NOT log access when the document is not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(documentService.getSignedUrl('missing', 'deal-1', CTX)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  test('does NOT log access when URL signing fails (a failed attempt is not an access)', async () => {
    query.mockResolvedValueOnce({ rows: [DOC_ROW] });
    storage.getDownloadUrl.mockRejectedValueOnce(new Error('storage down'));
    await expect(documentService.getSignedUrl('doc-1', 'deal-1', CTX)).rejects.toMatchObject({
      statusCode: 500,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  test('falls back to the document org when the caller context omits it', async () => {
    query.mockResolvedValueOnce({ rows: [DOC_ROW] });
    await documentService.getSignedUrl('doc-1', 'deal-1', {});
    expect(publish).toHaveBeenCalledWith(
      EVENTS.DOCUMENT_ACCESSED,
      expect.objectContaining({ organizationId: 'org-1', userId: null }),
    );
  });
});

describe('streamDownload — access audit', () => {
  const makeRes = () => ({ setHeader: jest.fn(), destroy: jest.fn() });

  test('publishes DOCUMENT_ACCESSED (download) and pipes the bytes', async () => {
    query.mockResolvedValueOnce({ rows: [DOC_ROW] });
    const fakeStream = { on: jest.fn(), pipe: jest.fn() };
    storage.fetchStoredFile.mockResolvedValueOnce({ stream: fakeStream, contentType: 'application/pdf' });
    const res = makeRes();
    await documentService.streamDownload('doc-1', res, 'deal-1', CTX);
    expect(publish).toHaveBeenCalledWith(
      EVENTS.DOCUMENT_ACCESSED,
      expect.objectContaining({
        documentId: 'doc-1',
        action: 'download',
        documentKind: 'deal_document',
        userId: 'user-1',
      }),
    );
    expect(fakeStream.pipe).toHaveBeenCalledWith(res);
  });

  test('does NOT log access when the document is not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await expect(documentService.streamDownload('missing', res, 'deal-1', CTX)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(publish).not.toHaveBeenCalled();
  });
});
