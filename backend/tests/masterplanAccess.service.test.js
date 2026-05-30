'use strict';

// getSourceDocumentDownload must publish a DOCUMENT_ACCESSED audit event for
// the regulatory source PDF — the masterplan half of "log access to sensitive
// documents". Mirrors the mock header of masterplan.service.test.js, plus an
// eventBus mock so the publish can be asserted.

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/config/storage', () => ({
  createUploadUrl: jest.fn(),
  getDownloadUrl: jest.fn(async () => 'https://signed.example/masterplan.pdf'),
}));
jest.mock('../src/services/extraction.service', () => ({ extractStoredFileFields: jest.fn() }));
jest.mock('../src/services/evidenceIngestion.service', () => ({ ingestRegulatoryFields: jest.fn() }));
jest.mock('../src/lib/eventBus', () => ({
  EVENTS: { DOCUMENT_ACCESSED: 'document.accessed' },
  publish: jest.fn(),
}));

const { query } = require('../src/config/database');
const { EVENTS, publish } = require('../src/lib/eventBus');
const service = require('../src/services/masterplan.service');

beforeEach(() => jest.clearAllMocks());

describe('masterplan getSourceDocumentDownload — access audit', () => {
  const DOC = {
    id: 'mp-1',
    plan_name: 'RMP 2031 Volume 3',
    file_url: 'organizations/org-1/masterplan/vol3.pdf',
    org_id: 'org-7',
  };

  test('publishes DOCUMENT_ACCESSED (masterplan_source / signed_url) with caller forensics', async () => {
    query.mockResolvedValueOnce({ rows: [DOC] }); // getSourceDocumentById
    const out = await service.getSourceDocumentDownload('mp-1', {
      userId: 'user-2',
      organizationId: 'org-2',
      ip: '198.51.100.4',
      userAgent: 'UA/2.0',
    });
    expect(out.url).toBe('https://signed.example/masterplan.pdf');
    expect(publish).toHaveBeenCalledWith(
      EVENTS.DOCUMENT_ACCESSED,
      expect.objectContaining({
        documentId: 'mp-1',
        action: 'signed_url',
        documentKind: 'masterplan_source',
        documentName: 'RMP 2031 Volume 3',
        organizationId: 'org-2', // caller org wins over doc.org_id
        userId: 'user-2',
        dealId: null,
        ip: '198.51.100.4',
        userAgent: 'UA/2.0',
      }),
    );
  });

  test('does NOT log access when the source document is missing', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // not found
    await expect(service.getSourceDocumentDownload('nope', {})).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  test('does NOT log access when the document has no stored file reference', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'mp-2', plan_name: 'No File', org_id: 'org-1' }] });
    await expect(service.getSourceDocumentDownload('mp-2', {})).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  test('falls back to the document org_id when caller context omits org', async () => {
    query.mockResolvedValueOnce({ rows: [DOC] });
    await service.getSourceDocumentDownload('mp-1', {});
    expect(publish).toHaveBeenCalledWith(
      EVENTS.DOCUMENT_ACCESSED,
      expect.objectContaining({ organizationId: 'org-7', userId: null }),
    );
  });
});
