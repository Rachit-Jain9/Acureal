'use strict';

// AI-extraction BRIDGE for deal registers (rent-roll program, PR-12).
// The vision/OCR pass is mocked (that path is covered by the extraction suite);
// what's pinned here is the bridge's OWN guarantees:
//   • every extracted field is re-validated against the column catalog (bad
//     enums/dates dropped, junk keys never reach a row),
//   • preview writes nothing; commit re-reads the persisted extraction and is
//     the only thing that inserts (source:'extraction'),
//   • the family gate (lease-income only) + provider gate hold,
//   • empty / malformed model output degrades to a readable error, never a
//     silent or partial write.

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/extraction.service', () => ({ extractDocument: jest.fn() }));
jest.mock('../src/services/ai/providerRegistry', () => ({ getProviderAvailability: jest.fn() }));
jest.mock('../src/services/rentRoll.service', () => ({
  getDealRegisterInfo: jest.fn(),
  bulkUpsertRecords: jest.fn(),
}));

const { query } = require('../src/config/database');
const extractionService = require('../src/services/extraction.service');
const providerRegistry = require('../src/services/ai/providerRegistry');
const rentRollService = require('../src/services/rentRoll.service');
const { stagePreview, commitFromExtraction, __internal } = require('../src/services/rentRollExtract.service');

const DOC_ROW = {
  id: 'doc1', deal_id: 'deal1', file_url: 's3://bucket/rr.pdf',
  file_name: 'broker-rent-roll.pdf', mime_type: 'application/pdf',
  deal_name: 'Whitefield Tower', property_name: null, property_address: null,
  city: 'Bengaluru', state: 'KA', pincode: '560066',
};

beforeEach(() => {
  jest.clearAllMocks();
  providerRegistry.getProviderAvailability.mockReturnValue({ gemini: true, claude: true });
  rentRollService.getDealRegisterInfo.mockResolvedValue({ family: 'lease_income', dealName: 'Whitefield Tower' });
});

// ── Pure mapper ─────────────────────────────────────────────────────────────
describe('mapRecordsToRows (pure)', () => {
  const { mapRecordsToRows } = __internal;

  test('keeps valid fields, drops bad enum/date with warnings, skips empties', () => {
    const out = mapRecordsToRows([
      { record_label: 'U1', tenant_name: 'Acme', status: 'occupied', chargeable_area_sqft: '2,500', lease_start: '2024-04-01' },
      { record_label: 'U2', status: 'ACTIVE', lease_start: '01/04/2024' }, // both invalid → dropped, label kept
      {},                                                                   // empty → skipped
      { hacker: 'DROP TABLE', chargeable_area_sqft: 900 },                  // junk key dropped; number kept
    ], 'lease');

    expect(out.rows).toHaveLength(3);
    expect(out.rows[0]).toMatchObject({ record_label: 'U1', status: 'occupied', chargeable_area_sqft: 2500, lease_start: '2024-04-01' });
    expect(out.rows[1]).toEqual({ record_label: 'U2' });
    expect(out.rows[2]).toEqual({ chargeable_area_sqft: 900 }); // no `hacker` field survives
    expect(out.rows.some((r) => 'hacker' in r)).toBe(false);
    expect(out.warnings).toHaveLength(2);
    expect(out.truncated).toBe(false);
  });

  test('respects the row cap and reports truncation', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ record_label: `U${i}` }));
    const out = mapRecordsToRows(many, 'lease', { rowCap: 3 });
    expect(out.rows).toHaveLength(3);
    expect(out.truncated).toBe(true);
  });

  test('non-array / garbage input → no rows, no throw', () => {
    expect(mapRecordsToRows(null, 'lease').rows).toEqual([]);
    expect(mapRecordsToRows(['nope', 42, null], 'lease').rows).toEqual([]);
  });
});

describe('extractRecordsArray (pure)', () => {
  const { extractRecordsArray } = __internal;
  test('unwraps { records }, bare array, first-array fallback', () => {
    expect(extractRecordsArray({ records: [1, 2] })).toEqual([1, 2]);
    expect(extractRecordsArray([9])).toEqual([9]);
    expect(extractRecordsArray({ leases: [7] })).toEqual([7]);
    expect(extractRecordsArray({ note: 'x' })).toEqual([]);
    expect(extractRecordsArray(null)).toEqual([]);
  });
});

// ── stagePreview ────────────────────────────────────────────────────────────
describe('stagePreview', () => {
  test('runs the pipeline, maps records, writes NOTHING', async () => {
    query.mockResolvedValueOnce({ rows: [DOC_ROW] }); // loadDealDocument
    extractionService.extractDocument.mockResolvedValue({
      id: 'ext1', extraction_status: 'completed', doc_type: 'rent_roll',
      confidence_scores: { _overall: 0.9 },
      structured_fields: { records: [
        { record_label: 'U1', tenant_name: 'Acme', status: 'occupied', chargeable_area_sqft: 1000 },
        { record_label: 'U2', status: 'NOT_A_STATUS' }, // enum dropped, label kept
      ] },
    });

    const out = await stagePreview('deal1', 'doc1', 'user1');

    expect(out.source).toBe('extraction');
    expect(out.extractionId).toBe('ext1');
    expect(out.family).toBe('lease_income');
    expect(out.kinds.lease.count).toBe(2);
    expect(out.kinds.lease.rows[0]).toMatchObject({ record_label: 'U1', status: 'occupied' });
    expect(out.confidence).toBe(0.9);
    expect(out.warnings.length).toBeGreaterThan(0);
    // forced the rent-roll prompt; passed deal/property context
    expect(extractionService.extractDocument).toHaveBeenCalledWith(
      'doc1', 's3://bucket/rr.pdf', 'broker-rent-roll.pdf', 'application/pdf', 'deal1', 'user1',
      expect.objectContaining({ docType: 'rent_roll', context: expect.objectContaining({ city: 'Bengaluru' }) }),
    );
    // preview is read-only
    expect(rentRollService.bulkUpsertRecords).not.toHaveBeenCalled();
  });

  test('503 when Gemini is not configured — no pipeline call', async () => {
    providerRegistry.getProviderAvailability.mockReturnValue({ gemini: false });
    await expect(stagePreview('deal1', 'doc1', 'user1')).rejects.toMatchObject({ statusCode: 503 });
    expect(extractionService.extractDocument).not.toHaveBeenCalled();
  });

  test('422 gate: non-lease register family is refused before any AI call', async () => {
    rentRollService.getDealRegisterInfo.mockResolvedValue({ family: 'hotel_operating' });
    await expect(stagePreview('deal1', 'doc1', 'user1')).rejects.toMatchObject({ statusCode: 422 });
    expect(extractionService.extractDocument).not.toHaveBeenCalled();
  });

  test('404 when the document is not on this deal', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(stagePreview('deal1', 'docX', 'user1')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('422 when the extraction itself failed', async () => {
    query.mockResolvedValueOnce({ rows: [DOC_ROW] });
    extractionService.extractDocument.mockResolvedValue({ id: 'ext1', extraction_status: 'failed', error_message: 'unreadable scan' });
    await expect(stagePreview('deal1', 'doc1', 'user1')).rejects.toMatchObject({ statusCode: 422 });
  });
});

// ── commitFromExtraction ────────────────────────────────────────────────────
describe('commitFromExtraction', () => {
  test('re-reads the persisted extraction and writes source:extraction rows', async () => {
    query.mockResolvedValueOnce({ rows: [{
      id: 'ext1', deal_id: 'deal1', document_id: 'doc1',
      structured_fields: { records: [
        { record_label: 'U1', chargeable_area_sqft: 1000, status: 'occupied' },
        { record_label: 'U2', chargeable_area_sqft: 2000 },
      ] },
    }] });
    rentRollService.bulkUpsertRecords.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);

    const out = await commitFromExtraction('deal1', 'ext1', 'user1');

    expect(out.total).toBe(2);
    expect(out.byKind).toEqual({ lease: 2 });
    expect(rentRollService.bulkUpsertRecords).toHaveBeenCalledWith(
      'deal1', 'lease',
      [
        { record_label: 'U1', chargeable_area_sqft: 1000, status: 'occupied' },
        { record_label: 'U2', chargeable_area_sqft: 2000 },
      ],
      expect.objectContaining({ source: 'extraction', sourceDocumentId: 'doc1', userId: 'user1' }),
    );
  });

  test('does NOT trust client rows — commit re-maps from the DB, so junk never lands', async () => {
    query.mockResolvedValueOnce({ rows: [{
      id: 'ext1', deal_id: 'deal1', document_id: 'doc1',
      structured_fields: { records: [{ record_label: 'U1', evil: "'; DELETE FROM lease_records; --", status: 'occupied' }] },
    }] });
    rentRollService.bulkUpsertRecords.mockResolvedValue([{ id: 'r1' }]);

    await commitFromExtraction('deal1', 'ext1', 'user1');

    const rowsWritten = rentRollService.bulkUpsertRecords.mock.calls[0][2];
    expect(rowsWritten[0]).toEqual({ record_label: 'U1', status: 'occupied' });
    expect('evil' in rowsWritten[0]).toBe(false);
  });

  test('422 when no lease rows survive — nothing is written', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'ext1', document_id: 'doc1', structured_fields: { records: [{}, { junk: 1 }] } }] });
    await expect(commitFromExtraction('deal1', 'ext1', 'user1')).rejects.toMatchObject({ statusCode: 422 });
    expect(rentRollService.bulkUpsertRecords).not.toHaveBeenCalled();
  });

  test('404 when the extraction is not found on this deal', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(commitFromExtraction('deal1', 'extX', 'user1')).rejects.toMatchObject({ statusCode: 404 });
  });
});
