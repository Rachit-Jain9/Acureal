'use strict';

/**
 * Deterministic PDF preflight + the coverage receipt.
 *
 * These two modules exist to end a specific class of dishonesty: judging a
 * document by its byte size alone, and reporting "completed" without being
 * able to say what happened to page 847.
 *
 * The tests below pin the properties that make them trustworthy:
 *   • the two failure modes (byte-bound / page-bound) are told apart
 *   • nothing is ever claimed to have been "read"
 *   • an unmeasurable value is null WITH a reason, never approximated
 *   • the source document is never mutated
 *   • an unopenable file is a fact to report, not an exception to throw
 */

const { PDFDocument } = require('pdf-lib');
const {
  preflightPdf, extractPageRange, assessProviderFit, looksLikePdf,
  PROVIDER_PDF_PAGE_CAP, PROVIDER_PDF_BYTE_CAP,
} = require('../src/services/ai/pdfPreflight');
const { buildCoverageReceipt, pagesProcessedFromReceipt } = require('../src/utils/coverageReceipt');

const makePdf = async (pages) => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage();
  return Buffer.from(await doc.save());
};

describe('looksLikePdf — trust the bytes, not the filename', () => {
  test('detects a real PDF by its %PDF- magic', async () => {
    expect(looksLikePdf(await makePdf(1))).toBe(true);
  });

  test('a file merely NAMED .pdf is not a PDF', () => {
    // The registry derives MIME from the extension, so bytes are the only
    // honest check before handing anything to a PDF parser.
    expect(looksLikePdf(Buffer.from('this is plain text, not a pdf'))).toBe(false);
    expect(looksLikePdf(Buffer.from(''))).toBe(false);
    expect(looksLikePdf(null)).toBe(false);
  });
});

describe('preflightPdf — report facts, never throw', () => {
  test('counts and decodes every page of a real PDF', async () => {
    const pf = await preflightPdf(await makePdf(12));
    expect(pf).toMatchObject({
      isPdf: true, readable: true, reason: null,
      pageCount: 12, decodedPages: 12,
      encrypted: false, corrupted: false,
    });
  });

  test('a single-page document reports 1, not 0', async () => {
    const pf = await preflightPdf(await makePdf(1));
    expect(pf.pageCount).toBe(1);
    expect(pf.readable).toBe(true);
  });

  test('corrupt bytes are a REPORTED fact, not a thrown error', async () => {
    // A malformed PDF must not blow up the extraction pipeline; the caller
    // needs to tell the operator "we could not open this", not 500.
    const corrupt = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('garbage not a pdf body')]);
    const pf = await preflightPdf(corrupt);
    expect(pf.isPdf).toBe(true);
    expect(pf.readable).toBe(false);
    expect(pf.reason).toBe('unreadable_file');
    expect(pf.corrupted).toBe(true);
  });

  test('non-PDF bytes decline cleanly rather than guessing', async () => {
    const pf = await preflightPdf(Buffer.from('PK\x03\x04 zip bytes'));
    expect(pf).toMatchObject({ isPdf: false, readable: false, reason: 'not_a_pdf' });
  });

  test.each([[null], [undefined], [Buffer.alloc(0)]])('%p never throws', async (input) => {
    await expect(preflightPdf(input)).resolves.toMatchObject({ readable: false });
  });
});

describe('assessProviderFit — the two failure modes are DIFFERENT', () => {
  // This distinction is the point of the whole module. Gemini accepts a PDF
  // only within BOTH 50 MB and 1,000 pages, and conflating them is why a size
  // check alone could never tell an operator why their file was refused.
  test('page-bound: a 1,200-page pack that is only 25 MB', () => {
    expect(assessProviderFit({ pageCount: 1200, sizeBytes: 25 * 1024 * 1024 }))
      .toEqual({ fits: false, reason: 'too_many_pages_to_read' });
  });

  test('byte-bound: a 50-page scan that is 60 MB', () => {
    expect(assessProviderFit({ pageCount: 50, sizeBytes: 60 * 1024 * 1024 }))
      .toEqual({ fits: false, reason: 'too_large_to_read' });
  });

  test('both at once is named as both', () => {
    expect(assessProviderFit({ pageCount: 1200, sizeBytes: 60 * 1024 * 1024 }))
      .toEqual({ fits: false, reason: 'too_large_and_too_many_pages' });
  });

  test('a document inside both ceilings fits', () => {
    expect(assessProviderFit({ pageCount: 900, sizeBytes: 40 * 1024 * 1024 }))
      .toEqual({ fits: true, reason: null });
  });

  test('exactly AT each cap still fits (the caps are inclusive)', () => {
    expect(assessProviderFit({ pageCount: PROVIDER_PDF_PAGE_CAP, sizeBytes: PROVIDER_PDF_BYTE_CAP }).fits).toBe(true);
  });

  test('the provider caps are the documented Gemini PDF ceiling', () => {
    // Not REDIP policy and not configurable — no paid plan raises these.
    expect(PROVIDER_PDF_PAGE_CAP).toBe(1000);
    expect(PROVIDER_PDF_BYTE_CAP).toBe(50 * 1024 * 1024);
  });
});

describe('extractPageRange — the classification cost cut', () => {
  test('slices the first pages into a smaller standalone PDF', async () => {
    const src = await makePdf(40);
    const slice = await extractPageRange(src, 0, 2);
    const pf = await preflightPdf(slice);
    expect(pf.pageCount).toBe(2);
    expect(slice.length).toBeLessThan(src.length);
  });

  test('NEVER mutates the source document — the upload is evidence', async () => {
    const src = await makePdf(10);
    const before = Buffer.from(src);
    await extractPageRange(src, 0, 2);
    expect(src.equals(before)).toBe(true);
  });

  test('a range beyond the end clamps instead of failing', async () => {
    const src = await makePdf(3);
    const slice = await extractPageRange(src, 0, 50);
    expect((await preflightPdf(slice)).pageCount).toBe(3);
  });

  test('returns null (not a throw) on unusable input, so callers fall back to the whole file', async () => {
    // A cost optimisation must never cost accuracy: if slicing fails the
    // caller sends the full document.
    expect(await extractPageRange(Buffer.from('not a pdf'), 0, 2)).toBeNull();
  });
});

describe('the coverage receipt — say only what can be proven', () => {
  test('a clean native PDF reports SUBMITTED pages, never "read"', () => {
    const r = buildCoverageReceipt({
      method: 'native_pdf', detectedPages: 327, decodedPages: 327, submittedPages: 327,
      maxExtractionMb: 50, providerPageCap: 1000, sizeBytes: 24117248,
    });
    expect(r.submitted_pages).toBe(327);
    expect(r.submitted_ratio).toBe(1);
    expect(r.undecodable_pages).toBe(0);
    expect(r.summary).toBe('All 327 pages were sent to the document reader.');
    // The vocabulary is the guarantee: a 200 from the provider is not proof a
    // model attended to page 847.
    expect(JSON.stringify(r)).not.toMatch(/\bread_pages\b|pages_read/);
    expect(r.summary).not.toMatch(/\bread\b(?!er)/);
  });

  test('evidence_pages is null WITH a reason — never approximated', () => {
    // Approximating an unmeasurable signal is exactly how the fill-rate
    // "confidence" score came to lie. An absent measure is a fact.
    const r = buildCoverageReceipt({ method: 'native_pdf', detectedPages: 5, decodedPages: 5, submittedPages: 5 });
    expect(r.evidence_pages).toBeNull();
    expect(r.evidence_pages_unavailable_because).toMatch(/page citations are not yet captured/i);
  });

  test('damaged pages are stated explicitly, not left to inference', () => {
    const r = buildCoverageReceipt({
      method: 'native_pdf', detectedPages: 327, decodedPages: 324, submittedPages: 324,
      detail: '3 of 327 pages could not be opened.',
    });
    expect(r.undecodable_pages).toBe(3);
    expect(r.summary).toMatch(/324 of 327 pages were sent/);
    expect(r.summary).toMatch(/3 could not be opened/);
    expect(r.submitted_ratio).toBeCloseTo(0.9908, 3);
  });

  test.each([
    ['too_large_to_read', { sizeBytes: 64 * 1024 * 1024, maxExtractionMb: 50 }, /64\.0 MB.*larger than the 50 MB/],
    ['too_many_pages_to_read', { detectedPages: 1200, providerPageCap: 1000 }, /1,200 pages.*more than the 1,000-page limit/],
    ['password_protected', {}, /password-protected.*Upload an unlocked copy/],
    ['unsupported_format', {}, /cannot read this file type.*stored, versioned and downloadable/],
  ])('a refusal (%s) explains itself in plain English', (reason, extra, expected) => {
    const r = buildCoverageReceipt({ method: 'not_submitted', reason, submittedPages: 0, ...extra });
    expect(r.summary).toMatch(expected);
    expect(r.submitted_pages).toBe(0);
    expect(r.reason).toBe(reason);
  });

  test('a refusal still says the document is KEPT — it is not a loss', () => {
    const r = buildCoverageReceipt({
      method: 'not_submitted', reason: 'too_large_to_read', submittedPages: 0,
      sizeBytes: 64 * 1024 * 1024, maxExtractionMb: 50,
    });
    expect(r.summary).toMatch(/stored, versioned and downloadable/);
  });

  test('a transcribed file says page numbers do not apply', () => {
    const r = buildCoverageReceipt({ method: 'parsed_text' });
    expect(r.summary).toMatch(/transcribed this file to text/);
    expect(r.summary).toMatch(/Page numbers do not apply/);
  });

  test('carries the limits so the operator can see what it was judged against', () => {
    const r = buildCoverageReceipt({ method: 'native_pdf', detectedPages: 3, decodedPages: 3, submittedPages: 3, maxExtractionMb: 50, providerPageCap: 1000 });
    expect(r.limits).toEqual({ max_extraction_mb: 50, provider_page_cap: 1000 });
  });

  test('is versioned — the shape is an operator-facing contract that will grow', () => {
    expect(buildCoverageReceipt({ method: 'image' }).version).toBe(1);
  });

  test('pages_processed takes the SUBMITTED count, and null when there is none', () => {
    // The column has been NULL on every row ever written; this is the only
    // number it can honestly hold.
    expect(pagesProcessedFromReceipt(buildCoverageReceipt({ method: 'native_pdf', detectedPages: 9, decodedPages: 9, submittedPages: 9 }))).toBe(9);
    expect(pagesProcessedFromReceipt(buildCoverageReceipt({ method: 'parsed_text' }))).toBeNull();
    expect(pagesProcessedFromReceipt(null)).toBeNull();
  });
});
