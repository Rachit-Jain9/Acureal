'use strict';

/**
 * Deterministic PDF inspection — the stage that runs BEFORE any model sees a
 * document.
 *
 * WHY THIS EXISTS
 * Until now REDIP judged a document by ONE number: its byte size. That is the
 * wrong measure, and it hid two genuinely different failure modes behind a
 * single 50 MB threshold:
 *
 *   BYTE-BOUND   a 50-page deed scanned at 600 DPI is 60 MB — it fails on
 *                bytes while using 5% of the provider's page budget.
 *   PAGE-BOUND   a 1,200-page DD pack of native text is 25 MB — it fails on
 *                pages while using half the byte budget.
 *
 * Gemini accepts a PDF only when it is within BOTH 50 MB *and* 1,000 pages, so
 * a size check alone cannot tell an operator whether their document is
 * readable. Worse, it cannot tell them WHY it was not. This module answers
 * both questions deterministically, before a single token is spent.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It reports only what it can PROVE by opening the file: page count, whether
 * the bytes decode, whether the document is encrypted. It does not claim a
 * page was "read", "understood", or "covered" — a successful provider call is
 * not evidence that a model attended to page 847. Everything here is
 * mechanical: pdf-lib either opened the page or it did not.
 *
 * No new dependency: pdf-lib is already used for PDF manipulation elsewhere.
 */

const { PDFDocument } = require('pdf-lib');
const log = require('../../lib/logger').child({ module: 'pdf.preflight' });

/**
 * Gemini's hard PDF ceiling: a PDF is accepted only when BOTH hold.
 * These are the PROVIDER's limits, not REDIP's product policy — they are not
 * configurable and no paid plan raises them, so they live in code as facts.
 * https://ai.google.dev/gemini-api/docs/document-processing
 */
const PROVIDER_PDF_PAGE_CAP = 1000;
const PROVIDER_PDF_BYTE_CAP = 50 * 1024 * 1024;

/** `%PDF-` — the only reliable way to know bytes are a PDF, whatever the name says. */
const PDF_MAGIC = Buffer.from('%PDF-');

const looksLikePdf = (buffer) =>
  Buffer.isBuffer(buffer) && buffer.length >= 5 && buffer.subarray(0, 5).equals(PDF_MAGIC);

/**
 * Inspect a PDF without interpreting it.
 *
 * Never throws: a document REDIP cannot open is a fact to report, not an
 * exception to propagate. Callers branch on `readable` + `reason`.
 *
 * @param {Buffer} buffer raw file bytes
 * @returns {Promise<{
 *   isPdf: boolean, readable: boolean, reason: string|null,
 *   pageCount: number|null, decodedPages: number|null,
 *   encrypted: boolean, corrupted: boolean, detail: string|null
 * }>}
 */
const preflightPdf = async (buffer) => {
  const base = {
    isPdf: false, readable: false, reason: null,
    pageCount: null, decodedPages: null,
    encrypted: false, corrupted: false, detail: null,
  };

  if (!looksLikePdf(buffer)) {
    // Not a PDF at all — the caller's own tier routing owns this case; we just
    // decline to guess.
    return { ...base, isPdf: false, readable: false, reason: 'not_a_pdf' };
  }

  let doc;
  try {
    // ignoreEncryption:false so an encrypted document REPORTS ITSELF rather
    // than loading into a half-usable state and failing mysteriously later at
    // the provider. A password-protected deed is a normal thing to receive;
    // it deserves "we need the password", not "extraction failed".
    doc = await PDFDocument.load(buffer, { ignoreEncryption: false, updateMetadata: false });
  } catch (err) {
    const message = String(err?.message || err);
    const encrypted = /encrypt/i.test(message);
    return {
      ...base,
      isPdf: true,
      readable: false,
      encrypted,
      corrupted: !encrypted,
      reason: encrypted ? 'password_protected' : 'unreadable_file',
      detail: message.slice(0, 200),
    };
  }

  let pageCount = null;
  try {
    pageCount = doc.getPageCount();
  } catch (err) {
    return {
      ...base, isPdf: true, readable: false, corrupted: true,
      reason: 'unreadable_file', detail: String(err?.message || err).slice(0, 200),
    };
  }

  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return { ...base, isPdf: true, readable: false, corrupted: true, reason: 'unreadable_file', detail: 'PDF reports no pages.' };
  }

  // Probe every page. A pack assembled from mixed scanners can carry a single
  // broken page object among 300 good ones; that page is a fact the coverage
  // receipt must state, not a reason to reject the other 299.
  let decodedPages = 0;
  for (let i = 0; i < pageCount; i += 1) {
    try {
      doc.getPage(i);
      decodedPages += 1;
    } catch {
      // counted by omission — surfaced as detected − decoded
    }
  }

  return {
    isPdf: true,
    readable: decodedPages > 0,
    reason: decodedPages > 0 ? null : 'unreadable_file',
    pageCount,
    decodedPages,
    encrypted: false,
    corrupted: decodedPages < pageCount,
    detail: decodedPages < pageCount
      ? `${pageCount - decodedPages} of ${pageCount} pages could not be opened.`
      : null,
  };
};

/**
 * Copy a page range into a new, standalone PDF.
 *
 * The engine behind two things: cheap classification (send page 1, not 500 —
 * a document's type is legible from its first page, and paying to ship 500
 * pages to answer "is this a sale deed?" is pure waste), and, later, splitting
 * a page-bound pack into provider-sized pieces.
 *
 * The source buffer is never mutated — pdf-lib copies into a fresh document,
 * so the original stays byte-identical. That matters: the uploaded file is
 * evidence, and a derived artefact must never be mistaken for it.
 *
 * @returns {Promise<Buffer|null>} null when the slice cannot be produced —
 *          callers fall back to the whole document rather than fail.
 */
const extractPageRange = async (buffer, startIndex, count) => {
  try {
    const src = await PDFDocument.load(buffer, { ignoreEncryption: false, updateMetadata: false });
    const total = src.getPageCount();
    const from = Math.max(0, Math.min(startIndex, total - 1));
    const to = Math.min(total, from + Math.max(1, count));
    const indices = [];
    for (let i = from; i < to; i += 1) indices.push(i);
    if (indices.length === 0) return null;

    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, indices);
    for (const page of pages) out.addPage(page);
    return Buffer.from(await out.save());
  } catch (err) {
    log.warn('pdf_page_slice_failed', { error: String(err?.message || err).slice(0, 200) });
    return null;
  }
};

/**
 * Can this PDF be sent to the provider as-is?
 * Separates the two failure modes so the operator is told which one applies.
 */
const assessProviderFit = ({ pageCount, sizeBytes }) => {
  const overPages = Number.isInteger(pageCount) && pageCount > PROVIDER_PDF_PAGE_CAP;
  const overBytes = Number.isFinite(sizeBytes) && sizeBytes > PROVIDER_PDF_BYTE_CAP;
  if (overPages && overBytes) return { fits: false, reason: 'too_large_and_too_many_pages' };
  if (overPages) return { fits: false, reason: 'too_many_pages_to_read' };
  if (overBytes) return { fits: false, reason: 'too_large_to_read' };
  return { fits: true, reason: null };
};

module.exports = {
  preflightPdf,
  extractPageRange,
  assessProviderFit,
  looksLikePdf,
  PROVIDER_PDF_PAGE_CAP,
  PROVIDER_PDF_BYTE_CAP,
};
