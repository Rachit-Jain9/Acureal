'use strict';

/**
 * Extraction-reliability guards (PR-D, 2026-06-02).
 *
 * The deal-document pipeline inserts a row in 'processing' and runs the AI
 * extraction synchronously inside the request. If the Vercel function is
 * killed mid-run the row is orphaned in 'processing' forever — invisible to
 * the deal workspace and un-retryable. These tests pin:
 *   1. reapStuckExtractions flips stale 'processing' rows to 'failed',
 *      org-scoped, swallowing DB errors so the read path never breaks.
 *   2. getDealExtractions runs the reaper, then returns `failures` +
 *      `coverage` + a per-extraction `has_data` flag (no-data vs failed).
 */

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  getClient: jest.fn(),
}));
jest.mock('../src/services/evidenceIngestion.service', () => ({
  ingestExtraction: jest.fn(async () => ({})),
  ingestRegulatoryFields: jest.fn(async () => ({})),
}));
jest.mock('../src/services/embeddings.service', () => ({
  indexDocumentText: jest.fn(async () => ({})),
}));

const { query } = require('../src/config/database');
const extractionService = require('../src/services/extraction.service');

const ORG_FILTER = /organization_id\s*=\s*current_organization_id\(\)/;
const STUCK_THRESHOLD_MS = 6 * 60 * 1000;

const completedRow = (overrides = {}) => ({
  id: 'e1',
  document_id: 'd1',
  doc_type: 'sale_deed',
  extraction_status: 'completed',
  structured_fields: { owner_name: 'Asha' },
  confidence_scores: { owner_name: 1 },
  human_corrections: {},
  correction_history: [],
  language_detected: 'en',
  extracted_at: '2026-06-02T00:00:00Z',
  reviewed_at: null,
  document_name: 'Deed.pdf',
  file_url: 'https://x/deed.pdf',
  ...overrides,
});

describe('reapStuckExtractions', () => {
  beforeEach(() => query.mockReset());

  test('flips stale processing rows for a deal — org-scoped, deal-scoped, returns rowCount', async () => {
    query.mockResolvedValueOnce({ rowCount: 2 });
    const n = await extractionService.reapStuckExtractions('deal-1');

    expect(n).toBe(2);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/UPDATE document_extractions/);
    expect(sql).toMatch(/extraction_status\s*=\s*'failed'/);     // SET terminal state
    expect(sql).toMatch(/extraction_status\s*=\s*'processing'/); // WHERE guard
    expect(sql).toMatch(ORG_FILTER);
    expect(sql).toMatch(/deal_id = \$2/);
    expect(query.mock.calls[0][1]).toEqual([STUCK_THRESHOLD_MS, 'deal-1']);
  });

  test('without a dealId reaps org-wide (no deal clause)', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 });
    await extractionService.reapStuckExtractions();
    const sql = query.mock.calls[0][0];
    expect(sql).not.toMatch(/deal_id = \$2/);
    expect(query.mock.calls[0][1]).toEqual([STUCK_THRESHOLD_MS]);
  });

  test('threshold sits above the 300s Vercel maxDuration so live jobs are never reaped', () => {
    expect(STUCK_THRESHOLD_MS).toBeGreaterThan(300 * 1000);
  });

  test('swallows DB errors and returns 0 — the read path must not break', async () => {
    query.mockRejectedValueOnce(new Error('db down'));
    const n = await extractionService.reapStuckExtractions('deal-1');
    expect(n).toBe(0);
  });
});

describe('getDealExtractions — reaper + failures + coverage', () => {
  // getDealExtractions feature-detects the `field_quality` column once per warm
  // instance (canStoreFieldQuality, added 2026-07-16). Warm that cache here so
  // the per-test mock chains below reflect only the reaper + SELECT + failures
  // queries and don't have to account for the one-time detect.
  beforeAll(async () => {
    query.mockReset();
    query.mockResolvedValue({ rows: [{ exists: true }] });
    await extractionService.getDealExtractions('warm-cache').catch(() => {});
  });

  beforeEach(() => query.mockReset());

  test('reaps first, then returns extractions, failures and a coverage breakdown', async () => {
    query
      // 1) reaper UPDATE
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      // 2) main extractions SELECT (one with data, one no-data)
      .mockResolvedValueOnce({
        rows: [
          completedRow({ id: 'e1', document_id: 'd1' }),
          completedRow({
            id: 'e2',
            document_id: 'd2',
            structured_fields: {},
            confidence_scores: {},
            document_name: 'Blank.pdf',
          }),
        ],
      })
      // 3) failures SELECT
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'e3',
            document_id: 'd3',
            doc_type: 'ec',
            extraction_status: 'failed',
            error_message: 'Gemini failed; Claude fallback also failed.',
            extracted_at: null,
            updated_at: '2026-06-02T01:00:00Z',
            document_name: 'EC.pdf',
          },
        ],
      });

    const out = await extractionService.getDealExtractions('deal-1');

    // Reaper ran first, as an org-scoped UPDATE on processing rows.
    expect(query.mock.calls[0][0]).toMatch(/UPDATE document_extractions/);
    expect(query.mock.calls[0][0]).toMatch(ORG_FILTER);

    // no-data vs has-data distinction.
    expect(out.extractions.find((e) => e.id === 'e1').has_data).toBe(true);
    expect(out.extractions.find((e) => e.id === 'e2').has_data).toBe(false);

    // failures surfaced with the retry-oriented error message.
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0]).toMatchObject({
      document_id: 'd3',
      status: 'failed',
      error_message: 'Gemini failed; Claude fallback also failed.',
    });

    // failures query is org-scoped too.
    const failuresCall = query.mock.calls[2][0];
    expect(failuresCall).toMatch(/extraction_status IN \('failed','processing'\)/);
    expect(failuresCall).toMatch(ORG_FILTER);

    expect(out.coverage).toEqual({ with_data: 1, no_data: 1, failed: 1, processing: 0 });
  });

  test('a document that failed then succeeded on retry is NOT reported as a failure', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // reaper
      .mockResolvedValueOnce({ rows: [completedRow({ id: 'e1', document_id: 'd1' })] }) // d1 usable
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'e0',
            document_id: 'd1', // same doc — an older failed attempt
            doc_type: 'sale_deed',
            extraction_status: 'failed',
            error_message: 'old transient error',
            extracted_at: null,
            updated_at: '2026-06-01T00:00:00Z',
            document_name: 'Deed.pdf',
          },
        ],
      });

    const out = await extractionService.getDealExtractions('deal-1');
    expect(out.failures).toHaveLength(0); // d1 has a usable extraction → not nagged
    expect(out.coverage.failed).toBe(0);
  });

  test('a still-processing document (within threshold) is reported as processing, not failed', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // reaper (nothing stale yet)
      .mockResolvedValueOnce({ rows: [] }) // no usable extractions
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'e9',
            document_id: 'd9',
            doc_type: 'other',
            extraction_status: 'processing',
            error_message: null,
            extracted_at: null,
            updated_at: '2026-06-02T02:00:00Z',
            document_name: 'InFlight.pdf',
          },
        ],
      });

    const out = await extractionService.getDealExtractions('deal-1');
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].status).toBe('processing');
    expect(out.coverage).toEqual({ with_data: 0, no_data: 0, failed: 0, processing: 1 });
  });
});
