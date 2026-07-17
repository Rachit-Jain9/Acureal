'use strict';

/**
 * The coverage receipt — REDIP's account of what it did with every page of a
 * document.
 *
 * ── The promise this implements ─────────────────────────────────────────────
 *   "Upload the whole pack. REDIP tells you exactly what it processed, page by
 *    page, and precisely what it did not."
 *
 * A green "Extraction completed" badge is not that. It says a network call
 * returned 200. It says nothing about whether page 847 of a 900-page pack
 * contributed anything, or was silently dropped at the provider's limit.
 * Silent truncation on a diligence document is the worst failure this product
 * can have: it looks like success.
 *
 * ── The discipline: never claim the model READ anything ─────────────────────
 * Every field name here is chosen to be defensible. We say `submitted_pages`,
 * never `read_pages`, because a 200 from Gemini is not evidence that a model
 * attended to a given page — and we have no way to prove that it did. What we
 * CAN prove is mechanical and stated here:
 *
 *   detected_pages   pdf-lib counted them in the file
 *   decoded_pages    pdf-lib opened them without error
 *   submitted_pages  REDIP sent them to a provider
 *
 * `evidence_pages` — pages actually cited by an extracted fact — is the honest
 * fourth measure and is NOT available yet: it needs per-field page citations,
 * which the extraction prompts do not request. Rather than approximate it (the
 * exact sin that produced the fill-rate "confidence" score this codebase spent
 * a day removing), the receipt reports it as `null` and says why. An absent
 * measure is a fact; a fabricated one is a lie.
 *
 * ── Why receipts exist even for refusals ────────────────────────────────────
 * A document REDIP declines to read still gets a receipt. "0 of 327 pages
 * submitted — the file is 61 MB and the reader's limit is 50 MB" is a useful,
 * actionable, TRUE statement. Refusing silently, or saying "failed", is not.
 */

const REASON_COPY = Object.freeze({
  too_large_to_read: (c) =>
    `This document is ${fmtMb(c.sizeBytes)} — larger than the ${c.maxExtractionMb} MB the document reader accepts. It is stored, versioned and downloadable, but no page was sent for reading.`,
  too_many_pages_to_read: (c) =>
    `This document has ${fmtNum(c.detectedPages)} pages — more than the ${fmtNum(c.providerPageCap)}-page limit of the document reader. It is stored in full, but no page was sent for reading.`,
  too_large_and_too_many_pages: (c) =>
    `This document is ${fmtMb(c.sizeBytes)} across ${fmtNum(c.detectedPages)} pages — beyond both the ${c.maxExtractionMb} MB and ${fmtNum(c.providerPageCap)}-page limits of the document reader. It is stored in full, but no page was sent for reading.`,
  password_protected: () =>
    'This PDF is password-protected, so REDIP could not open it. Upload an unlocked copy to have it read.',
  unreadable_file: (c) =>
    `REDIP could not open this PDF${c.detail ? ` (${c.detail})` : ''}. The file is stored as uploaded; a re-export from the source may read cleanly.`,
  unsupported_format: () =>
    'REDIP cannot read this file type. It is stored, versioned and downloadable.',
  not_a_pdf: () => null, // handled by tier routing; no receipt copy needed
});

const fmtNum = (n) => (Number.isFinite(n) ? n.toLocaleString('en-IN') : '—');
const fmtMb = (bytes) =>
  (Number.isFinite(bytes) ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : '—');

/**
 * Build the receipt.
 *
 * @param {object} input
 * @param {'native_pdf'|'parsed_text'|'image'|'not_submitted'} input.method
 *        How the document reached the provider — the receipt means different
 *        things per route, and saying which is part of being honest:
 *          native_pdf   the PDF bytes went to the model (page-addressable)
 *          parsed_text  REDIP transcribed it first; "pages" are not meaningful
 *          image        a single-image document; one page by definition
 *          not_submitted nothing was sent — `reason` says why
 * @param {number|null} input.detectedPages
 * @param {number|null} input.decodedPages
 * @param {number|null} input.submittedPages
 * @param {string|null} input.reason        machine key when nothing was sent
 * @param {number|null} input.sizeBytes
 * @param {number} input.maxExtractionMb
 * @param {number} input.providerPageCap
 * @param {string|null} input.detail
 * @param {string[]} input.notes            extra truths (e.g. truncation)
 */
const buildCoverageReceipt = ({
  method,
  detectedPages = null,
  decodedPages = null,
  submittedPages = null,
  reason = null,
  sizeBytes = null,
  maxExtractionMb = null,
  providerPageCap = null,
  detail = null,
  notes = [],
} = {}) => {
  const ctx = { detectedPages, sizeBytes, maxExtractionMb, providerPageCap, detail };
  const copyFn = reason ? REASON_COPY[reason] : null;
  const summary = copyFn ? copyFn(ctx) : null;

  const receipt = {
    // Schema version: this shape is an operator-facing contract and will grow
    // (evidence_pages, ocr_pages). Consumers must branch on it rather than
    // assume a field exists.
    version: 1,
    method,
    // ── Deterministic measures ────────────────────────────────────────────
    detected_pages: detectedPages,
    decoded_pages: decodedPages,
    submitted_pages: submittedPages,
    // Pages that could NOT be opened — detected minus decoded. Explicit,
    // because "3 of 327 pages are damaged" is exactly the kind of thing a
    // reviewer must be told rather than left to infer from two numbers.
    undecodable_pages:
      Number.isInteger(detectedPages) && Number.isInteger(decodedPages)
        ? Math.max(0, detectedPages - decodedPages)
        : null,
    submitted_ratio:
      Number.isInteger(detectedPages) && detectedPages > 0 && Number.isInteger(submittedPages)
        ? Number((submittedPages / detectedPages).toFixed(4))
        : null,
    // ── The honest gap ────────────────────────────────────────────────────
    // Not measurable until extraction prompts request per-field page
    // citations. Reported as null WITH its reason, never approximated.
    evidence_pages: null,
    evidence_pages_unavailable_because:
      'Per-field page citations are not yet captured, so REDIP cannot say which pages a value came from.',
    // ── Why nothing (or only part) was sent ───────────────────────────────
    reason,
    summary,
    limits: {
      max_extraction_mb: maxExtractionMb,
      provider_page_cap: providerPageCap,
    },
    size_bytes: sizeBytes,
    notes: Array.isArray(notes) ? notes.filter(Boolean) : [],
  };

  // A page-addressable route with full submission earns a plain-English
  // statement of exactly that — the operator's receipt for a clean read.
  if (!reason && method === 'native_pdf' && Number.isInteger(detectedPages)) {
    receipt.summary = receipt.undecodable_pages
      ? `${fmtNum(submittedPages)} of ${fmtNum(detectedPages)} pages were sent to the document reader; ${fmtNum(receipt.undecodable_pages)} could not be opened.`
      : `All ${fmtNum(detectedPages)} pages were sent to the document reader.`;
  }
  if (!reason && method === 'parsed_text') {
    receipt.summary =
      'REDIP transcribed this file to text and sent the transcription to the document reader. Page numbers do not apply to this format.';
  }
  if (!reason && method === 'image') {
    receipt.summary = 'This image was sent to the document reader in full.';
  }

  return receipt;
};

/**
 * `document_extractions.pages_processed` is an INTEGER that has been NULL on
 * every row ever written ("pages_processed not available from inline
 * extraction"). The receipt can finally populate it — with the only number
 * that column can honestly hold: pages SUBMITTED.
 */
const pagesProcessedFromReceipt = (receipt) =>
  (receipt && Number.isInteger(receipt.submitted_pages) ? receipt.submitted_pages : null);

module.exports = { buildCoverageReceipt, pagesProcessedFromReceipt, REASON_COPY };
