'use strict';

/**
 * Preflight + coverage wired into the extraction pipeline.
 *
 * The unit tests next door prove the modules are honest in isolation. These
 * prove the PIPELINE uses them — which is where this kind of work silently
 * breaks.
 *
 * The load-bearing property: a document REDIP DECLINES to read leaves NO ROW,
 * exactly as the stored_only (CAD/BIM) refusal does. That is not a style
 * choice. A bespoke status like 'not_readable' would have been INVISIBLE —
 * getDealExtractions lists only ('completed','partial','reviewed') and the
 * failures query only ('failed','processing') — and evidenceIngestion coerces
 * `status !== 'failed'` to 'completed', so an unread document would have been
 * recorded as successfully extracted. Refusing before persisting avoids the
 * entire class.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock('../src/config/storage', () => ({ getDownloadUrl: jest.fn(async () => 'https://signed.example/f') }));
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
const { PDFDocument } = require('pdf-lib');
const { query } = require('../src/config/database');
const { runGeminiInline } = require('../src/services/ai/aiRouter');
const extractionService = require('../src/services/extraction.service');

const makePdf = async (pages) => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage();
  return Buffer.from(await doc.save());
};

const servePdf = (buf) => axios.get.mockResolvedValue({
  headers: { 'content-type': 'application/pdf' }, data: buf,
});

const finalUpdate = () =>
  query.mock.calls.find(([sql]) => /UPDATE document_extractions[\s\S]*doc_type\s*=\s*\$1/i.test(String(sql)));
const deleteCall = () =>
  query.mock.calls.find(([sql]) => /DELETE FROM document_extractions/i.test(String(sql)));

const paramOf = (sql, params, column) => {
  const m = String(sql).match(new RegExp(`${column}\\s*=\\s*\\$(\\d+)`));
  return m ? params[Number(m[1]) - 1] : undefined;
};

beforeEach(() => {
  jest.clearAllMocks();
  query.mockResolvedValue({ rows: [{ exists: true, id: 'ext-1' }] });
  runGeminiInline.mockResolvedValue(JSON.stringify({ owner_name: 'A', survey_number: '72' }));
});

describe('a readable PDF gets a coverage receipt', () => {
  test('persists pages_processed — the column that was NULL on every row ever written', async () => {
    servePdf(await makePdf(9));
    await extractionService.extractDocument('d1', 'https://f', 'deed.pdf', null, 'deal-1', 'u1', { docType: 'sale_deed' });

    const [sql, params] = finalUpdate();
    expect(paramOf(sql, params, 'pages_processed')).toBe(9);
  });

  test('the receipt states pages SUBMITTED, and never claims a page was "read"', async () => {
    servePdf(await makePdf(9));
    await extractionService.extractDocument('d1', 'https://f', 'deed.pdf', null, 'deal-1', 'u1', { docType: 'sale_deed' });

    const [sql, params] = finalUpdate();
    const coverage = JSON.parse(paramOf(sql, params, 'page_coverage'));
    expect(coverage).toMatchObject({
      version: 1, method: 'native_pdf',
      detected_pages: 9, decoded_pages: 9, submitted_pages: 9,
      undecodable_pages: 0, submitted_ratio: 1,
    });
    expect(coverage.summary).toBe('All 9 pages were sent to the document reader.');
    expect(coverage.evidence_pages).toBeNull();
  });

  test('a transcribed (parseable) file reports the text method, not fake page counts', async () => {
    axios.get.mockResolvedValue({
      headers: { 'content-type': 'text/csv' },
      data: Buffer.from('project,rate\nBrigade,7450\n'),
    });
    await extractionService.extractDocument('d1', 'https://f', 'comps.csv', null, 'deal-1', 'u1', { docType: 'comps_rate_sheet' });

    const [sql, params] = finalUpdate();
    const coverage = JSON.parse(paramOf(sql, params, 'page_coverage'));
    expect(coverage.method).toBe('parsed_text');
    expect(coverage.detected_pages).toBeNull(); // pages are meaningless here — say so
    expect(coverage.summary).toMatch(/Page numbers do not apply/);
    expect(paramOf(sql, params, 'pages_processed')).toBeNull();
  });
});

describe('honest refusals leave NO ROW (the stored_only pattern)', () => {
  test('a page-bound pack (>1000 pages) is refused, its row removed, and it explains itself', async () => {
    servePdf(await makePdf(1001));

    await expect(
      extractionService.extractDocument('d1', 'https://f', 'pack.pdf', null, 'deal-1', 'u1', { docType: 'sale_deed' }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'EXTRACTION_TOO_MANY_PAGES' });

    // The just-created 'processing' row is removed — no invisible row, no
    // red "failed" chip on a document that behaved exactly as documented.
    expect(deleteCall()).toBeTruthy();
    expect(finalUpdate()).toBeUndefined();
  }, 30000);

  test('the refusal carries a receipt an operator can act on', async () => {
    servePdf(await makePdf(1001));
    const err = await extractionService
      .extractDocument('d1', 'https://f', 'pack.pdf', null, 'deal-1', 'u1', { docType: 'sale_deed' })
      .catch((e) => e);

    expect(err.coverage).toMatchObject({
      method: 'not_submitted', reason: 'too_many_pages_to_read',
      submitted_pages: 0, detected_pages: 1001,
    });
    expect(err.coverage.summary).toMatch(/1,001 pages.*more than the 1,000-page limit/);
    expect(err.coverage.summary).toMatch(/stored in full/);
  }, 30000);

  test('a corrupt PDF is refused honestly, not reported as a failed extraction', async () => {
    axios.get.mockResolvedValue({
      headers: { 'content-type': 'application/pdf' },
      data: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('not a real pdf body')]),
    });

    const err = await extractionService
      .extractDocument('d1', 'https://f', 'broken.pdf', null, 'deal-1', 'u1', { docType: 'sale_deed' })
      .catch((e) => e);

    expect(err.statusCode).toBe(422);
    expect(err.coverageReason).toBe('unreadable_file');
    expect(deleteCall()).toBeTruthy();
  });

  test('a genuine provider fault STILL fails loudly — refusal handling must not swallow real errors', async () => {
    servePdf(await makePdf(3));
    runGeminiInline.mockRejectedValue(new Error('gemini 503 upstream'));
    const { runClaudeWithDocument } = require('../src/services/ai/aiRouter');
    runClaudeWithDocument.mockRejectedValue(new Error('claude also down'));

    const row = await extractionService.extractDocument('d1', 'https://f', 'deed.pdf', null, 'deal-1', 'u1', { docType: 'sale_deed' });

    // Marked failed and kept — this one IS a fault.
    const failed = query.mock.calls.find(([sql]) => /extraction_status = 'failed'/i.test(String(sql)));
    expect(failed).toBeTruthy();
    expect(deleteCall()).toBeUndefined();
    expect(row).toBeDefined();
  });
});

describe('classification pays for the first pages, not the whole document', () => {
  test('a large PDF is classified on a SLICE, then extracted in full', async () => {
    const big = await makePdf(40);
    servePdf(big);
    runGeminiInline.mockResolvedValue(JSON.stringify({ doc_type: 'sale_deed', confidence: 0.9 }));

    // No docType passed → the classifier runs.
    await extractionService.extractDocument('d1', 'https://f', 'deed.pdf', null, 'deal-1', 'u1', {});

    const classify = runGeminiInline.mock.calls.find(([a]) => a.task === 'document_classification');
    const extract = runGeminiInline.mock.calls.find(([a]) => a.task === 'document_extraction');
    expect(classify).toBeTruthy();
    expect(extract).toBeTruthy();

    // The classifier saw fewer bytes than the extractor: the whole point.
    expect(classify[0].base64Data.length).toBeLessThan(extract[0].base64Data.length);
    // The extractor still saw the ENTIRE document — the cost cut must never
    // cost coverage.
    expect(extract[0].base64Data).toBe(big.toString('base64'));
  }, 30000);

  test('the receipt discloses that the type came from a slice', async () => {
    servePdf(await makePdf(40));
    runGeminiInline.mockResolvedValue(JSON.stringify({ doc_type: 'sale_deed', confidence: 0.9 }));
    await extractionService.extractDocument('d1', 'https://f', 'deed.pdf', null, 'deal-1', 'u1', {});

    const [sql, params] = finalUpdate();
    const coverage = JSON.parse(paramOf(sql, params, 'page_coverage'));
    expect(coverage.notes.join(' ')).toMatch(/type was identified from the first 2 page\(s\); all pages were sent/);
    expect(coverage.submitted_pages).toBe(40); // every page still read
  }, 30000);

  test('a SMALL document is classified whole — the slice would save nothing and risks misreading a cover page', async () => {
    const small = await makePdf(3);
    servePdf(small);
    runGeminiInline.mockResolvedValue(JSON.stringify({ doc_type: 'sale_deed', confidence: 0.9 }));
    await extractionService.extractDocument('d1', 'https://f', 'deed.pdf', null, 'deal-1', 'u1', {});

    const classify = runGeminiInline.mock.calls.find(([a]) => a.task === 'document_classification');
    expect(classify[0].base64Data).toBe(small.toString('base64'));
  });

  test('an explicit docType skips classification entirely — no second call at all', async () => {
    servePdf(await makePdf(40));
    await extractionService.extractDocument('d1', 'https://f', 'deed.pdf', null, 'deal-1', 'u1', { docType: 'sale_deed' });
    expect(runGeminiInline.mock.calls.filter(([a]) => a.task === 'document_classification')).toHaveLength(0);
  }, 30000);
});
