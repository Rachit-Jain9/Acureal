'use strict';

/**
 * Extraction status semantics: notes vs errors (2026-07-16).
 *
 * `extraction_status = 'partial'` renders "Document partially extracted —
 * some fields may be missing. Please review." to the operator. That sentence
 * must ONLY appear when data is genuinely missing.
 *
 * Until this fix, two purely INFORMATIONAL events degraded the status:
 *   1. the optional Claude/GPT formatting-normalization pass timing out
 *      (production evidence: it takes ~35 s against a 5 s cap, so it timed out
 *      on 100% of calls) — skipping it removes nothing from the payload; and
 *   2. a successful Claude-fallback extraction after Gemini was down.
 * Both produced complete extractions (9 and 18 fields in the live cases) yet
 * told the reviewer fields might be missing — training operators to distrust
 * good extractions, exactly what CLAUDE.md's honesty rules forbid.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock('../src/config/storage', () => ({ getDownloadUrl: jest.fn(async () => 'https://signed.example/file') }));
jest.mock('../src/services/ai/providerRegistry', () => ({
  getProviderAvailability: jest.fn(() => ({ gemini: true, claude: true, gpt_compatible: true })),
}));
jest.mock('../src/services/ai/aiRouter', () => ({
  runGeminiInline: jest.fn(),
  runClaudeReasoning: jest.fn(),
  runClaudeWithDocument: jest.fn(),
  tryParseAndValidate: jest.requireActual('../src/services/ai/aiRouter').tryParseAndValidate,
}));
jest.mock('../src/services/evidenceIngestion.service', () => ({ ingestExtraction: jest.fn(async () => ({})) }));
jest.mock('../src/services/embeddings.service', () => ({ indexDocumentText: jest.fn(async () => ({})) }));
jest.mock('axios', () => ({ get: jest.fn() }));

const axios = require('axios');
const { query } = require('../src/config/database');
const { runGeminiInline, runClaudeReasoning, runClaudeWithDocument } = require('../src/services/ai/aiRouter');
const extractionService = require('../src/services/extraction.service');

// Capture the UPDATE that finalises the extraction row.
const finalUpdate = () => {
  const call = query.mock.calls.find(([sql]) => /UPDATE document_extractions[\s\S]*doc_type\s*=\s*\$1/i.test(sql));
  if (!call) return null;
  const [, params] = call;
  return { status: params[1], structuredFields: params[3], errorMessage: params[6], language: params[7] };
};

beforeEach(() => {
  jest.clearAllMocks();
  query.mockResolvedValue({ rows: [{ exists: true, id: 'ext-1' }] });
  axios.get.mockResolvedValue({ headers: { 'content-type': 'application/pdf' }, data: Buffer.from('bytes') });
  runGeminiInline.mockResolvedValue(JSON.stringify({ grantor: 'A', grantee: 'B', area_sqft: 4500 }));
  runClaudeReasoning.mockResolvedValue(JSON.stringify({ grantor: 'A', grantee: 'B', area_sqft: 4500 }));
});

describe('an optional normalization skip does NOT mark a complete extraction partial', () => {
  test('normalization timeout → status completed, fields intact, note recorded', async () => {
    runClaudeReasoning.mockRejectedValueOnce(new Error('Claude extraction normalization timed out after 5000ms'));

    await extractionService.extractDocument('doc-1', 'https://f', 'deed.pdf', null, 'deal-1', 'u1', { docType: 'title_deed' });

    const row = finalUpdate();
    expect(row.status).toBe('completed'); // was 'partial' — the bug
    // The payload is untouched: skipping a formatting pass loses no fields.
    expect(JSON.parse(row.structuredFields)).toMatchObject({ grantor: 'A', grantee: 'B', area_sqft: 4500 });
    // The skip stays visible for diagnostics, phrased as a note, not a defect.
    expect(row.errorMessage).toMatch(/normalization pass skipped/i);
    expect(row.errorMessage).toMatch(/Extracted values are unchanged/);
  });

  test('normalization success → status completed with no note at all', async () => {
    await extractionService.extractDocument('doc-1', 'https://f', 'deed.pdf', null, 'deal-1', 'u1', { docType: 'title_deed' });
    const row = finalUpdate();
    expect(row.status).toBe('completed');
    expect(row.errorMessage).toBeNull();
  });
});

describe('a Claude-fallback extraction is complete, not partial', () => {
  test('Gemini down → Claude reads the doc → status completed with a provenance note', async () => {
    runGeminiInline.mockRejectedValueOnce(new Error('gemini 503'));
    runClaudeWithDocument.mockResolvedValueOnce(JSON.stringify({ grantor: 'A', grantee: 'B' }));

    await extractionService.extractDocument('doc-1', 'https://f', 'deed.pdf', null, 'deal-1', 'u1', { docType: 'title_deed' });

    const row = finalUpdate();
    expect(row.status).toBe('completed'); // was 'partial' — the bug
    expect(row.errorMessage).toMatch(/Claude fallback after Gemini failed/);
    expect(JSON.parse(row.structuredFields)).toMatchObject({ grantor: 'A' });
  });
});

describe('a genuine data problem still marks the extraction partial', () => {
  test('unparseable model output → status partial (the label keeps its meaning)', async () => {
    runGeminiInline.mockResolvedValue('this is not json at all');

    await extractionService.extractDocument('doc-1', 'https://f', 'deed.pdf', null, 'deal-1', 'u1', { docType: 'title_deed' });

    const row = finalUpdate();
    expect(row.status).toBe('partial');
    expect(row.errorMessage).toMatch(/JSON parse failed/);
  });

  test('a real parse error outranks any note', async () => {
    runGeminiInline.mockRejectedValueOnce(new Error('gemini 503'));
    runClaudeWithDocument.mockResolvedValueOnce('still not json');

    await extractionService.extractDocument('doc-1', 'https://f', 'deed.pdf', null, 'deal-1', 'u1', { docType: 'title_deed' });

    const row = finalUpdate();
    expect(row.status).toBe('partial');
    expect(row.errorMessage).toMatch(/JSON parse failed/);
    // The fallback note must not mask the actual failure.
    expect(row.errorMessage).not.toMatch(/^Extracted via Claude fallback/);
  });
});
