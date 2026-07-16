'use strict';

// AI-extraction BRIDGE for deal registers — turn an uploaded rent-roll document
// into staged, review-gated register rows.
//
// This is deliberately thin. It owns NO AI logic and NO math:
//   • The vision/OCR pass is the shared extraction pipeline
//     (extraction.service#extractDocument, docType 'rent_roll'). That pipeline
//     already logs cost, caches by file+prompt sha, falls back Gemini→Claude,
//     redacts PII, and PERSISTS the result to document_extractions. We reuse it
//     verbatim so a rent roll is metered and audited exactly like every other
//     doctype.
//   • Every extracted field is re-validated deterministically against the
//     single-source column catalog via rentRollImport#normalizeRecord — the
//     SAME normaliser a template row passes through. A model can only ever
//     propose a value the catalog would have accepted from a human; bad enums /
//     dates / numbers are dropped with a warning, never written.
//   • Nothing is written on preview. Commit RE-READS the persisted extraction
//     server-authoritatively (never trusts client-supplied rows) and inserts
//     via rentRoll.service#bulkUpsertRecords(source:'extraction', verified:false)
//     so the rows land as unverified, provenance-tagged, and fully audited.
//
// Scope (MVP): lease-income registers only (kind 'lease'). Other families fall
// back to template import. The gate is explicit so extending to sales/hotel is
// a catalog + prompt change, not a rewrite.

const { query } = require('../config/database');
const { getProviderAvailability } = require('./ai/providerRegistry');
const extractionService = require('./extraction.service');
const rentRollService = require('./rentRoll.service');
const { normalizeRecord } = require('./rentRollImport.service');
const { KINDS_BY_FAMILY } = require('../constants/rentRollImportColumns');
const log = require('../lib/logger').child({ module: 'rentRollExtract' });

const EXTRACT_DOC_TYPE = 'rent_roll';
const SUPPORTED_FAMILY = 'lease_income';
// A single register document is a handful of pages; a real rent roll rarely
// exceeds a few hundred leases. Cap defensively (truncation is reported, never
// silent) so a runaway model response can't balloon a commit.
const ROW_CAP = 2000;

const err = (status, message) => {
  const e = new Error(message);
  e.statusCode = status;
  return e;
};

// The kind an extraction maps into, for a given family. Lease-income → 'lease'.
const kindForFamily = (family) => (KINDS_BY_FAMILY[family] || [])[0] || null;

// Pull the records array out of an extraction's structured_fields, tolerant of
// prompt drift: prefer { records: [...] }, accept a bare top-level array, else
// fall back to the first array-valued property. Anything else → [].
const extractRecordsArray = (structuredFields) => {
  if (Array.isArray(structuredFields)) return structuredFields;
  if (!structuredFields || typeof structuredFields !== 'object') return [];
  if (Array.isArray(structuredFields.records)) return structuredFields.records;
  const firstArray = Object.values(structuredFields).find((v) => Array.isArray(v));
  return Array.isArray(firstArray) ? firstArray : [];
};

/**
 * Map an AI records[] array → normalised register rows for `kind`, dropping any
 * field the column catalog rejects (with a warning) and skipping wholly-empty
 * records. Pure + deterministic — the unit-testable heart of the bridge.
 *
 * @returns {{ rows: object[], warnings: object[], truncated: boolean }}
 */
function mapRecordsToRows(records, kind, opts = {}) {
  const rowCap = Number(opts.rowCap) > 0 ? Number(opts.rowCap) : ROW_CAP;
  const rows = [];
  const warnings = [];
  let truncated = false;

  const list = Array.isArray(records) ? records : [];
  for (let i = 0; i < list.length; i += 1) {
    if (rows.length >= rowCap) { truncated = true; break; }
    const raw = list[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const { record, warnings: fieldWarnings } = normalizeRecord(kind, raw, i + 1);
    warnings.push(...fieldWarnings);
    if (Object.keys(record).length > 0) rows.push(record);
  }
  return { rows, warnings, truncated };
}

// Load a deal-scoped, org-scoped document + the deal/property context the
// extraction prompt uses for matching. Mirrors extraction.routes' SELECT but
// pins the document to THIS deal so a register can only ingest its own files.
async function loadDealDocument(dealId, documentId) {
  const res = await query(
    `SELECT
        doc.id,
        doc.deal_id,
        doc.file_url,
        doc.name       AS file_name,
        doc.file_type  AS mime_type,
        d.name         AS deal_name,
        p.name         AS property_name,
        p.address      AS property_address,
        p.city,
        p.state,
        p.pincode
       FROM documents doc
       LEFT JOIN deals d ON d.id = doc.deal_id
       LEFT JOIN properties p ON p.id = d.property_id
      WHERE doc.id = $1
        AND doc.deal_id = $2
        AND doc.organization_id = current_organization_id()
        AND doc.deleted_at IS NULL`,
    [documentId, dealId],
  );
  return res.rows[0] || null;
}

// Re-read a persisted extraction, pinned to this deal + org. This is the
// server-authoritative source for commit — the client never gets to hand us
// the rows to write.
async function loadExtraction(dealId, extractionId) {
  const res = await query(
    `SELECT id, deal_id, document_id, doc_type, extraction_status,
            structured_fields, confidence_scores
       FROM document_extractions
      WHERE id = $1
        AND deal_id = $2
        AND organization_id = current_organization_id()`,
    [extractionId, dealId],
  );
  return res.rows[0] || null;
}

/**
 * Stage a preview from an uploaded document — NO writes.
 *
 * Runs the shared extraction pipeline (which persists to document_extractions),
 * maps the result to normalised lease rows, and returns a staged preview shaped
 * like the template-import preview so the review modal can render either source
 * identically. The returned `extractionId` is what commit re-reads.
 *
 * @param {string} dealId
 * @param {string} documentId
 * @param {string} userId
 */
async function stagePreview(dealId, documentId, userId) {
  if (!getProviderAvailability().gemini) {
    throw err(503, 'AI extraction is not configured. Ask your administrator to set the GEMINI_API_KEY '
      + 'setting, or fill the register with the downloadable template instead.');
  }

  const { family } = await rentRollService.getDealRegisterInfo(dealId);
  if (family !== SUPPORTED_FAMILY) {
    throw err(422, 'AI extraction currently supports rent-roll (lease income) registers only. '
      + 'For this register type, download the template and import a filled copy.');
  }
  const kind = kindForFamily(family);
  if (!kind) throw err(500, 'No record kind is configured for this register family.');

  const doc = await loadDealDocument(dealId, documentId);
  if (!doc) throw err(404, 'That document was not found on this deal.');
  if (!doc.file_url) throw err(400, 'That document has no stored file to read.');

  // The shared pipeline: forces the rent-roll prompt (docType), meters cost,
  // and PERSISTS the extraction row (status completed/partial/failed).
  const extraction = await extractionService.extractDocument(
    doc.id,
    doc.file_url,
    doc.file_name,
    doc.mime_type,
    dealId,
    userId,
    {
      docType: EXTRACT_DOC_TYPE,
      context: {
        deal_name: doc.deal_name,
        property_name: doc.property_name,
        address: doc.property_address,
        city: doc.city,
        state: doc.state,
        pincode: doc.pincode,
      },
    },
  );

  if (!extraction || extraction.extraction_status === 'failed') {
    throw err(422, `The document could not be read${extraction?.error_message ? `: ${extraction.error_message}` : '.'}`);
  }

  const records = extractRecordsArray(extraction.structured_fields);
  const { rows, warnings, truncated } = mapRecordsToRows(records, kind, { rowCap: ROW_CAP });

  log.info('rent_roll_extract_preview', {
    deal_id: dealId, document_id: documentId, extraction_id: extraction.id,
    records: records.length, rows: rows.length, truncated,
  });

  return {
    family,
    source: 'extraction',
    extractionId: extraction.id,
    documentId: doc.id,
    documentName: doc.file_name || null,
    docType: extraction.doc_type || EXTRACT_DOC_TYPE,
    confidence: extraction.confidence_scores?._overall ?? null,
    // Same per-kind shape as the import preview (kinds[kind].rows/count).
    kinds: { [kind]: { rows, count: rows.length } },
    totalRows: rows.length,
    truncated,
    warnings,
    // Non-fatal note (e.g. Claude-fallback / partial parse) surfaced for review.
    parseError: extraction.error_message || null,
  };
}

/**
 * Commit a staged extraction: RE-READ the persisted extraction server-side
 * (authoritative — never trusts client rows), re-map to normalised rows, and
 * bulk-insert as unverified, provenance-tagged register records.
 *
 * @param {string} dealId
 * @param {string} extractionId
 * @param {string} userId
 */
async function commitFromExtraction(dealId, extractionId, userId) {
  const { family } = await rentRollService.getDealRegisterInfo(dealId);
  if (family !== SUPPORTED_FAMILY) {
    throw err(422, 'AI extraction currently supports rent-roll (lease income) registers only.');
  }
  const kind = kindForFamily(family);

  const extraction = await loadExtraction(dealId, extractionId);
  if (!extraction) throw err(404, 'That extraction was not found on this deal.');

  const records = extractRecordsArray(extraction.structured_fields);
  const { rows, warnings, truncated } = mapRecordsToRows(records, kind, { rowCap: ROW_CAP });
  if (rows.length === 0) {
    throw err(422, 'No lease rows could be read from this document. Review the preview, or fill the '
      + 'register with the downloadable template instead.');
  }

  const inserted = await rentRollService.bulkUpsertRecords(dealId, kind, rows, {
    source: 'extraction',
    sourceDocumentId: extraction.document_id || null,
    userId: userId || null,
  });

  log.info('rent_roll_extract_commit', {
    deal_id: dealId, extraction_id: extractionId, kind, committed: inserted.length,
  });

  return {
    total: inserted.length,
    byKind: { [kind]: inserted.length },
    family,
    warnings,
    truncated,
  };
}

module.exports = {
  stagePreview,
  commitFromExtraction,
  // exported for unit tests
  __internal: { mapRecordsToRows, extractRecordsArray, kindForFamily, ROW_CAP },
};
