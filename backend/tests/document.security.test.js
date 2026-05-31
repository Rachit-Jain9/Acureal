'use strict';

/**
 * Regression tests for the document-storage security hardening (2026-05-30).
 *
 * Three guards, all verified by the security audit:
 *   1. confirmDirectUpload must not trust the client-supplied storagePath —
 *      it must live under the caller's own organizations/<org>/deals/<deal>/
 *      folder. Otherwise a caller can confirm a documents row pointing at
 *      another org's object key (the download path signs it with the
 *      service-role key, bypassing storage RLS → cross-tenant exfiltration),
 *      or at an absolute URL (→ SSRF on download/extraction).
 *   2. storage.getDownloadUrl must only pass an absolute https URL through
 *      verbatim when it is a genuine Vercel Blob object; any other https value
 *      is refused so a poisoned file_url can't drive a server-side fetch.
 *   3. confirmDirectUpload must refuse an archived or dead deal, matching the
 *      presign step (getPresignedUploadUrl). Confirm is independently reachable,
 *      so without this guard a caller could attach a document straight into a
 *      deal that the presign step already blocks.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/lib/eventBus', () => ({
  EVENTS: { DOCUMENT_UPLOADED: 'document.uploaded' },
  publish: jest.fn(),
}));
// Mock only the low-level Supabase client wrapper; storage.js (the unit under
// test for guard #2) runs for real on top of it.
jest.mock('../src/config/supabase', () => ({
  getSupabaseConfig: jest.fn(() => ({ bucket: 'docs', keySource: 'service_role' })),
  getSupabaseClient: jest.fn(() => null),
  getStorageBucket: jest.fn(() => 'docs'),
  isSupabaseConfigured: jest.fn(() => true),
  uploadFile: jest.fn(),
  getSignedUrl: jest.fn(async (p) => `https://signed.example/${p}`),
  getObjectSize: jest.fn(async () => null),
  createSignedUploadUrl: jest.fn(),
  deleteFile: jest.fn(),
}));

const { query } = require('../src/config/database');
const documentService = require('../src/services/document.service');
const storage = require('../src/config/storage');
const supabase = require('../src/config/supabase');

const ORG = 'org-A';
const DEAL = 'deal-1';

const callConfirm = (storagePath) =>
  documentService.confirmDirectUpload(
    DEAL, storagePath, 'file.pdf', 'application/pdf', 100, 'other', null, 'user-1', ORG,
  );

describe('confirmDirectUpload — storagePath validation (cross-tenant + SSRF guard)', () => {
  beforeEach(() => {
    query.mockReset();
  });

  test('rejects a cross-org storagePath and never inserts', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: DEAL }] }); // deal-found check passes
    await expect(callConfirm(`organizations/org-B/deals/${DEAL}/x.pdf`)).rejects.toMatchObject({ statusCode: 400 });
    expect(query).toHaveBeenCalledTimes(1); // only the deal lookup; INSERT never ran
  });

  test('rejects an absolute https storagePath (SSRF-at-write)', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: DEAL }] });
    await expect(callConfirm('https://attacker.example/evil.pdf')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects a path-traversal escape out of the deal folder', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: DEAL }] });
    await expect(
      callConfirm(`organizations/${ORG}/deals/${DEAL}/../../org-B/secret.pdf`),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects a leading-slash absolute path', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: DEAL }] });
    await expect(callConfirm(`/organizations/${ORG}/deals/${DEAL}/x.pdf`)).rejects.toMatchObject({ statusCode: 400 });
  });

  test('accepts the canonical own-org/deal path and persists exactly that file_url', async () => {
    const goodPath = `organizations/${ORG}/deals/${DEAL}/1700000000000-file.pdf`;
    query
      .mockResolvedValueOnce({ rows: [{ id: DEAL }] }) // deal found
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1', name: 'file.pdf', file_url: goodPath, doc_category: 'other' }] }) // INSERT
      .mockResolvedValueOnce({ rows: [{ name: 'Alice' }] }); // uploaded_by name
    const doc = await callConfirm(goodPath);
    expect(doc.id).toBe('doc-1');
    const insertCall = query.mock.calls.find((c) => /INSERT INTO documents/.test(c[0]));
    expect(insertCall).toBeTruthy();
    expect(insertCall[1][2]).toBe(goodPath); // file_url bound verbatim, no mutation
    expect(insertCall[1][3]).toBe('application/pdf'); // file_type derived from .pdf extension
  });

  test('derives content-type from the extension, IGNORING the client-claimed fileType', async () => {
    const goodPath = `organizations/${ORG}/deals/${DEAL}/1700000000000-report.pdf`;
    query
      .mockResolvedValueOnce({ rows: [{ id: DEAL }] })
      .mockResolvedValueOnce({ rows: [{ id: 'doc-2', file_url: goodPath }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Alice' }] });
    // Client lies: claims text/html for a .pdf (the stored-XSS setup).
    await documentService.confirmDirectUpload(
      DEAL, goodPath, 'report.pdf', 'text/html', 100, 'other', null, 'user-1', ORG,
    );
    const insertCall = query.mock.calls.find((c) => /INSERT INTO documents/.test(c[0]));
    expect(insertCall[1][3]).toBe('application/pdf'); // server-derived, NOT the client's text/html
  });

  test('rejects a disallowed file extension at confirm', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: DEAL }] });
    await expect(
      documentService.confirmDirectUpload(
        DEAL, `organizations/${ORG}/deals/${DEAL}/x.exe`, 'x.exe', 'application/octet-stream', 100, 'other', null, 'user-1', ORG,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects an object whose TRUE stored size exceeds the cap (413), not the client claim', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: DEAL }] });
    // Client claimed 100 bytes at presign, but the real object is 60 MB (> 50 MB cap).
    supabase.getObjectSize.mockResolvedValueOnce(60 * 1024 * 1024);
    await expect(callConfirm(`organizations/${ORG}/deals/${DEAL}/big.pdf`)).rejects.toMatchObject({ statusCode: 413 });
  });
});

describe('confirmDirectUpload — archived/dead deal guard (parity with getPresignedUploadUrl)', () => {
  beforeEach(() => {
    query.mockReset();
  });

  // A well-formed, own-org/deal path so the rejection can ONLY come from the
  // archived/dead gate, not from the storagePath validation tested above.
  const goodPath = `organizations/${ORG}/deals/${DEAL}/1700000000000-file.pdf`;

  test('refuses to confirm an upload into an archived deal (409) and never inserts', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: DEAL, is_archived: true, stage: 'due_diligence' }] });
    await expect(callConfirm(goodPath)).rejects.toMatchObject({ statusCode: 409 });
    expect(query).toHaveBeenCalledTimes(1); // only the deal lookup; INSERT never ran
    expect(query.mock.calls.some((c) => /INSERT INTO documents/.test(c[0]))).toBe(false);
  });

  test('refuses to confirm an upload into a dead deal (409) and never inserts', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: DEAL, is_archived: false, stage: 'dead' }] });
    await expect(callConfirm(goodPath)).rejects.toMatchObject({ statusCode: 409 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.some((c) => /INSERT INTO documents/.test(c[0]))).toBe(false);
  });
});

describe('storage.getDownloadUrl — SSRF allow-list', () => {
  beforeEach(() => {
    supabase.getSignedUrl.mockClear();
  });

  test('passes a genuine Vercel Blob https URL through verbatim (no signing)', async () => {
    const blobUrl = 'https://abc123.public.blob.vercel-storage.com/deals/d/file.pdf';
    await expect(storage.getDownloadUrl(blobUrl)).resolves.toBe(blobUrl);
    expect(supabase.getSignedUrl).not.toHaveBeenCalled();
  });

  test('refuses a non-blob absolute https URL (SSRF guard)', async () => {
    await expect(storage.getDownloadUrl('https://attacker.example/x')).rejects.toThrow(/non-storage URL/i);
    expect(supabase.getSignedUrl).not.toHaveBeenCalled();
  });

  test('signs a Supabase storage path with download:true (served as attachment, never inline → no stored-XSS)', async () => {
    const p = `organizations/${ORG}/deals/${DEAL}/x.pdf`;
    await expect(storage.getDownloadUrl(p)).resolves.toBe(`https://signed.example/${p}`);
    expect(supabase.getSignedUrl).toHaveBeenCalledWith(p, 3600, { download: true });
  });
});

describe('deleteDocument — deal-ownership cross-check (IDOR guard)', () => {
  beforeEach(() => {
    query.mockReset();
  });

  test('refuses to delete a document via a mismatched dealId, and never runs the DELETE', async () => {
    // The SELECT returns a document that belongs to deal-1; the caller passes
    // a different deal id in the URL. Without the cross-check, an org member
    // with access to one deal could delete another deal's document.
    query.mockResolvedValueOnce({
      rows: [{ id: 'doc-1', deal_id: DEAL, file_url: 'x', deal_archived: false, deal_stage: 'sourcing' }],
    });
    await expect(
      documentService.deleteDocument('doc-1', 'user-1', 'deal-OTHER'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(query).toHaveBeenCalledTimes(1); // only the SELECT; the DELETE never ran
  });
});
