'use strict';

/**
 * Multi-format extraction routing (2026-07-16).
 *
 * The pipeline now reads more than PDFs + images: 'parseable'-tier files
 * (XLSX/DOCX/PPTX/CSV/JSON/KML…) are transcribed to text server-side first and
 * the TEXT rides in the prompt; 'stored_only' files (CAD/BIM/SketchUp/…) are
 * refused with a 422 BEFORE any extraction row is created — an unreadable
 * format is not a failed extraction, and must not leave a red error chip on a
 * document that behaved exactly as documented. These tests pin both paths.
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
jest.mock('../src/services/ai/documentTextExtractor', () => ({
  parseDocumentToText: jest.fn(),
}));
jest.mock('../src/services/evidenceIngestion.service', () => ({ ingestExtraction: jest.fn(async () => ({})) }));
jest.mock('../src/services/embeddings.service', () => ({ indexDocumentText: jest.fn(async () => ({})) }));
jest.mock('axios', () => ({ get: jest.fn() }));

const axios = require('axios');
const { query } = require('../src/config/database');
const { runGeminiInline } = require('../src/services/ai/aiRouter');
const { parseDocumentToText } = require('../src/services/ai/documentTextExtractor');
const extractionService = require('../src/services/extraction.service');

beforeEach(() => {
  jest.clearAllMocks();
  // Column feature-detects (doc_type + extraction_started_at) → present.
  query.mockResolvedValue({ rows: [{ exists: true, id: 'ext-1' }] });
  axios.get.mockResolvedValue({ headers: { 'content-type': 'application/octet-stream' }, data: Buffer.from('rawbytes') });
});

describe('stored_only formats are refused, not failed', () => {
  test.each(['site-plan.dwg', 'model.skp', 'schedule.xer', 'building.ifc', 'legacy.xls'])(
    '%s throws a 422 and creates NO extraction row',
    async (fileName) => {
      await expect(
        extractionService.extractDocument('doc-1', 'https://f', fileName, null, 'deal-1', 'user-1'),
      ).rejects.toMatchObject({ statusCode: 422 });

      // The honest message names the format and offers a way forward.
      await extractionService
        .extractDocument('doc-2', 'https://f', fileName, null, 'deal-1', 'user-1')
        .catch((err) => {
          expect(err.message).toMatch(/stored and downloadable/);
          expect(err.message).toMatch(/PDF, Excel, or an image/);
        });

      // No INSERT INTO document_extractions ran for the refused file.
      const insertCalls = query.mock.calls.filter(([sql]) => /INSERT INTO document_extractions/i.test(sql));
      expect(insertCalls).toHaveLength(0);
    },
  );
});

describe('parseable formats transcribe to text, then extract from the text', () => {
  test('an XLSX is parsed to text and the text rides in the prompt (no base64 to the provider)', async () => {
    parseDocumentToText.mockResolvedValue({
      text: '### Sheet: Rent Roll\nUnit\tTenant\tRent\nG-01\tAnchor\t110',
      kind: 'spreadsheet',
      meta: { sheets: 1 },
    });
    // Gemini returns a valid JSON extraction.
    runGeminiInline.mockResolvedValue(JSON.stringify({ tenant: 'Anchor', rent: 110 }));

    await extractionService.extractDocument('doc-1', 'https://f', 'roll.xlsx', null, 'deal-1', 'user-1', {
      docType: 'rent_roll',
    });

    expect(parseDocumentToText).toHaveBeenCalledTimes(1);
    // Every runGeminiInline call for a parseable file carries the transcribed
    // text in the prompt and NO base64 bytes.
    const extractionCalls = runGeminiInline.mock.calls.filter(([args]) => args.task === 'document_extraction');
    expect(extractionCalls.length).toBeGreaterThan(0);
    for (const [args] of extractionCalls) {
      expect(args.base64Data == null).toBe(true);
      expect(args.prompt).toMatch(/DOCUMENT CONTENT \(transcribed by REDIP/);
      expect(args.prompt).toMatch(/Anchor/);
    }
  });

  // CONTRACT CHANGE (2026-07-23, production incident). A parser fault used to
  // land as a 'failed' row carrying the raw JS message — an operator saw the
  // literal string "Invalid time value" and had nothing to act on. A file REDIP
  // cannot transcribe is a REFUSAL, not a fault, so it now takes the same path
  // as unsupported-format and unreadable-PDF: an honest 422 with a coverage
  // receipt, and the row removed so a retry starts clean.
  test('a corrupt parseable file is an honest 422 refusal, not a raw-message failure', async () => {
    parseDocumentToText.mockRejectedValue(new Error('KMZ archive contains no .kml document.'));

    await expect(
      extractionService.extractDocument('doc-1', 'https://f', 'parcel.kmz', null, 'deal-1', 'user-1'),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'EXTRACTION_UNREADABLE_SOURCE',
      coverageReason: 'unreadable_source',
    });

    // The row was created (kmz is parseable) and then CLEANED UP, not left
    // sitting at 'failed' — same as every other refusal path.
    const insertCalls = query.mock.calls.filter(([sql]) => /INSERT INTO document_extractions/i.test(sql));
    expect(insertCalls).toHaveLength(1);
    const deleteCall = query.mock.calls.find(([sql]) => /DELETE FROM document_extractions/i.test(sql));
    expect(deleteCall).toBeDefined();
    expect(query.mock.calls.find(([sql]) => /extraction_status\s*=\s*'failed'/i.test(sql))).toBeUndefined();
  });

  test('the refusal message is human-actionable and never leaks the raw parser error', async () => {
    parseDocumentToText.mockRejectedValue(new Error('Invalid time value'));

    await expect(
      extractionService.extractDocument('doc-1', 'https://f', 'cash-flows.xlsx', null, 'deal-1', 'user-1'),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/could not read the contents of this file/i),
    });

    // The production symptom: "Invalid time value" reaching the operator.
    await expect(
      extractionService.extractDocument('doc-1', 'https://f', 'cash-flows.xlsx', null, 'deal-1', 'user-1'),
    ).rejects.not.toMatchObject({ message: 'Invalid time value' });
  });
});

describe('native formats still send bytes to the provider', () => {
  test('a PDF sends base64 (no parse stage)', async () => {
    runGeminiInline.mockResolvedValue(JSON.stringify({ grantor: 'X' }));
    await extractionService.extractDocument('doc-1', 'https://f', 'deed.pdf', null, 'deal-1', 'user-1', {
      docType: 'title_deed',
    });
    expect(parseDocumentToText).not.toHaveBeenCalled();
    const extractionCalls = runGeminiInline.mock.calls.filter(([args]) => args.task === 'document_extraction');
    for (const [args] of extractionCalls) {
      expect(typeof args.base64Data).toBe('string');
      expect(args.mimeType).toBe('application/pdf');
    }
  });
});
