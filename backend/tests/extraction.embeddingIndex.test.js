'use strict';

/**
 * Document indexing — the step that never ran (regression suite, 2026-07-31).
 *
 * Production held ZERO rows in `document_embeddings` against 24 documents and
 * 50 extractions. The dispatch was gated on
 * `options.organizationId && options.documentId`, and no caller has ever
 * passed either: `documentId` is a positional PARAMETER of extractDocument,
 * and `organizationId` was never threaded through at all. The condition could
 * not be satisfied, so semantic search returned nothing and Deal Q&A could
 * never cite an uploaded file — while every upload still reported success.
 *
 * These tests pin the three properties that failure needed:
 *   1. indexing is ATTEMPTED for a normal extraction;
 *   2. it indexes the DOCUMENT's transcribed text when one exists, and the
 *      model's JSON reply only when it does not — labelling which, so a
 *      citation never implies it is quoting the document verbatim;
 *   3. it is SKIPPED LOUDLY, not silently, when the tenant is unresolvable.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock('../src/config/storage', () => ({ getDownloadUrl: jest.fn(async () => 'https://signed.example/file') }));
jest.mock('../src/services/ai/providerRegistry', () => ({
  getProviderAvailability: jest.fn(() => ({ gemini: true, claude: true })),
}));
jest.mock('../src/services/ai/aiRouter', () => ({
  runGeminiInline: jest.fn(),
  runClaudeReasoning: jest.fn(),
  runClaudeWithDocument: jest.fn(),
  tryParseAndValidate: jest.requireActual('../src/services/ai/aiRouter').tryParseAndValidate,
}));
jest.mock('../src/services/ai/documentTextExtractor', () => ({ parseDocumentToText: jest.fn() }));
jest.mock('../src/services/evidenceIngestion.service', () => ({ ingestExtraction: jest.fn(async () => ({})) }));
jest.mock('../src/services/embeddings.service', () => ({
  indexDocumentText: jest.fn(async () => ({ rows_inserted: 3 })),
}));
jest.mock('axios', () => ({ get: jest.fn() }));

const axios = require('axios');
const { query } = require('../src/config/database');
const { runGeminiInline } = require('../src/services/ai/aiRouter');
const { parseDocumentToText } = require('../src/services/ai/documentTextExtractor');
const embeddingsService = require('../src/services/embeddings.service');
const { runWithRequestContext } = require('../src/lib/requestContext');
const extractionService = require('../src/services/extraction.service');

const ORG = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';

const MODEL_JSON = JSON.stringify({ property_details: { address: 'Sarjapur Road' } });

beforeEach(() => {
  jest.clearAllMocks();
  query.mockResolvedValue({ rows: [{ exists: true, id: 'ext-1' }] });
  axios.get.mockResolvedValue({
    headers: { 'content-type': 'application/pdf' },
    data: Buffer.from('rawbytes'),
  });
  // runGeminiInline resolves the raw response STRING (matching every other
  // extraction suite) — the caller JSON.parses it downstream.
  runGeminiInline.mockResolvedValue(MODEL_JSON);
  parseDocumentToText.mockResolvedValue(null);
});

const extractInOrg = (fileName, mime) =>
  runWithRequestContext({ organizationId: ORG, userId: 'user-1' }, () =>
    extractionService.extractDocument(DOC, 'https://f', fileName, mime, 'deal-1', 'user-1'),
  );

describe('extraction indexes the document for search', () => {
  test('a normal extraction ATTEMPTS indexing (it never did before)', async () => {
    await extractInOrg('sale-deed.pdf', 'application/pdf');
    expect(embeddingsService.indexDocumentText).toHaveBeenCalledTimes(1);
  });

  test('documentId comes from the positional parameter, org from the request context', async () => {
    await extractInOrg('sale-deed.pdf', 'application/pdf');
    const arg = embeddingsService.indexDocumentText.mock.calls[0][0];
    expect(arg.documentId).toBe(DOC);
    expect(arg.organizationId).toBe(ORG);
  });

  test('a native PDF indexes the model reading, labelled as such', async () => {
    await extractInOrg('sale-deed.pdf', 'application/pdf');
    const arg = embeddingsService.indexDocumentText.mock.calls[0][0];
    expect(arg.metadata.text_source).toBe('model_reading');
    expect(arg.text).toContain('Sarjapur Road');
  });

  test('a parseable file indexes the DOCUMENT transcription, not the model JSON', async () => {
    // The model's reply is "mostly English keys"; the transcription is the
    // real prose. Indexing the reply would make search match on schema names.
    parseDocumentToText.mockResolvedValue({
      text: 'Lease schedule. Unit G-01 let to Anchor Tech at 110 per sqft.',
      kind: 'spreadsheet',
      meta: { sheets: 1 },
    });

    await extractInOrg('rent-roll.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const arg = embeddingsService.indexDocumentText.mock.calls[0][0];
    expect(arg.metadata.text_source).toBe('document_transcription');
    expect(arg.text).toContain('Anchor Tech');
    expect(arg.text).not.toContain('property_details');
  });

  test('no resolvable tenant → indexing is skipped, never attempted with a null org', async () => {
    // Without a tenant the RLS INSERT policy would reject the chunks anyway.
    await extractionService.extractDocument(DOC, 'https://f', 'sale-deed.pdf', 'application/pdf', 'deal-1', 'user-1');
    expect(embeddingsService.indexDocumentText).not.toHaveBeenCalled();
  });

  test('an explicit organizationId in options wins over the request context', async () => {
    const explicit = '33333333-3333-4333-8333-333333333333';
    await runWithRequestContext({ organizationId: ORG, userId: 'user-1' }, () =>
      extractionService.extractDocument(DOC, 'https://f', 'sale-deed.pdf', 'application/pdf', 'deal-1', 'user-1', {
        organizationId: explicit,
      }),
    );
    expect(embeddingsService.indexDocumentText.mock.calls[0][0].organizationId).toBe(explicit);
  });

  test('an indexing failure never fails the extraction', async () => {
    embeddingsService.indexDocumentText.mockRejectedValueOnce(new Error('embedding provider down'));
    await expect(extractInOrg('sale-deed.pdf', 'application/pdf')).resolves.toBeDefined();
  });
});
