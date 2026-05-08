'use strict';

/**
 * comps_review_queue service.
 *
 * Owns the lifecycle of staged comp ingestion: list/get for the reviewer
 * UI, run extraction (Gemini → structured_payload), accept reviewer edits,
 * approve+commit into the production `comps` table, or reject.
 *
 * Status transitions handled here:
 *   pending_extraction → extracting → pending_review
 *   pending_review     → approved → committed
 *   pending_review     → rejected (terminal)
 *   extracting         → failed (terminal until reprocessed)
 *
 * Per CLAUDE.md AI-routing hard rule:
 *   - Gemini does extraction (text/image → structured JSON).
 *   - All math (sqft↔acres, ₹↔Cr, asset-class normalization, rate
 *     bounds) lives in deterministic JS in this file. Never the LLM.
 *
 * Per security hard rule: every operation pulls organization context
 * from the request scope (or accepts it explicitly for cron callers)
 * and writes only within that scope. Cross-tenant access is impossible
 * because RLS enforces it at the DB layer too.
 */

const crypto = require('crypto');
const { query, transaction } = require('../config/database');
const { runWithRequestContext, getRequestContext } = require('../lib/requestContext');
const { createError } = require('../middleware/errorHandler');
const { uploadFile } = require('../config/storage');
const extractionService = require('./extraction.service');
const log = require('../lib/logger').child({ module: 'compsReviewQueue' });

// MIME allowlist for manual uploads. Tighter than the multer middleware's
// generic doc allowlist — only the formats the queue's extraction prompts
// (comps_rate_sheet / ipc_report / broker_quote) actually understand.
const MANUAL_UPLOAD_ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/tiff',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]);

const sanitizeFileName = (name) =>
  (name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

// Queue source → preferred extraction doctype. The worker uses this to
// pick the right Gemini prompt without re-running classification — the
// source already tells us what to expect.
const SOURCE_TO_DOCTYPE = Object.freeze({
  email_broker_quote: 'comps_rate_sheet',
  email_ipc_report: 'ipc_report',
  email_other: null, // fall through to classify
  manual_upload: null, // caller provides docType explicitly
  api_listing_portal: 'comps_rate_sheet',
});

// Map a free-text asset class string to the comps.project_type enum
// (residential | commercial | mixed_use). Deterministic; no LLM.
const RESIDENTIAL_TOKENS = [
  'resi', 'apart', 'flat', 'villa', 'plot', 'plotted', 'builder floor',
  'rowhouse', 'row house', 'land', 'farmhouse',
];
const COMMERCIAL_TOKENS = [
  'office', 'commercial', 'retail', 'mall', 'high street', 'warehouse',
  'industrial', 'logistics', 'data center', 'data centre', 'hospitality',
  'hotel', 'serviced', 'co-working', 'coworking',
];
const MIXED_USE_TOKENS = ['mixed', 'mixed-use', 'mixed_use'];

function normalizeProjectType(rawAssetClass, rawProjectType) {
  const blob = `${rawAssetClass || ''} ${rawProjectType || ''}`.toLowerCase();
  if (!blob.trim()) return 'residential'; // safe default

  for (const tok of MIXED_USE_TOKENS) {
    if (blob.includes(tok)) return 'mixed_use';
  }
  for (const tok of COMMERCIAL_TOKENS) {
    if (blob.includes(tok)) return 'commercial';
  }
  for (const tok of RESIDENTIAL_TOKENS) {
    if (blob.includes(tok)) return 'residential';
  }
  return 'residential'; // unknown → residential default
}

// Convert a numeric-or-string rate to a positive number, or null.
function toPositiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function toIntInRange(value, min, max) {
  const n = toPositiveNumber(value);
  if (n === null) return null;
  const i = Math.round(n);
  if (i < min || i > max) return null;
  return i;
}

// Convert a comp row from the queue's structured shape to the columns
// expected by the comps table. Returns { row, missing } where `missing`
// lists required fields that couldn't be filled — caller decides whether
// to skip or fail.
function mapToCompsRow(comp, organizationId) {
  const projectName = (comp.project_name || '').trim() || null;
  const city = (comp.city || '').trim() || null;
  const rate = toPositiveNumber(comp.rate_per_sqft);

  const missing = [];
  if (!projectName) missing.push('project_name');
  if (!city) missing.push('city');
  if (!rate) missing.push('rate_per_sqft');

  if (missing.length) {
    return { row: null, missing };
  }

  const projectType = normalizeProjectType(comp.asset_class, comp.project_type_raw || comp.project_type);
  const lat = comp.lat !== undefined ? toPositiveNumber(comp.lat) || null : null;
  const lng = comp.lng !== undefined ? toPositiveNumber(comp.lng) || null : null;
  const launchYear = toIntInRange(comp.launch_year, 1990, 2050);
  const possessionYear = toIntInRange(comp.possession_year, 1990, 2060);

  const row = {
    organization_id: organizationId,
    project_name: projectName.slice(0, 500),
    developer: (comp.developer || '').trim() || null,
    city: city.slice(0, 100),
    locality: (comp.locality || '').trim() || null,
    lat,
    lng,
    project_type: projectType,
    bhk_config: (comp.bhk_config || '').trim() || null,
    carpet_area_sqft: toPositiveNumber(comp.carpet_area_sqft),
    super_builtup_area_sqft: toPositiveNumber(comp.super_builtup_area_sqft),
    rate_per_sqft: rate,
    rate_per_sqft_min: toPositiveNumber(comp.rate_per_sqft_min),
    rate_per_sqft_max: toPositiveNumber(comp.rate_per_sqft_max),
    total_units: toIntInRange(comp.total_units, 1, 100000),
    launch_year: launchYear,
    possession_year: possessionYear,
    rera_number: (comp.rera_number || '').trim() || null,
    amenities: Array.isArray(comp.amenities) ? comp.amenities : null,
    source: (comp.source || '').trim() || null,
    is_verified: Boolean(comp.is_verified),
  };

  return { row, missing: [] };
}

// ──────────────────────────────────────────────────────────────────────────
// List / get
// ──────────────────────────────────────────────────────────────────────────

const listQueue = async ({ status, source, limit = 50, offset = 0 } = {}) => {
  const conditions = ['organization_id = current_organization_id()'];
  const values = [];
  let idx = 1;
  if (status) { conditions.push(`status = $${idx++}`); values.push(status); }
  if (source) { conditions.push(`source = $${idx++}`); values.push(source); }

  const cappedLimit = Math.min(parseInt(limit, 10) || 50, 200);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const where = conditions.join(' AND ');
  const countResult = await query(`SELECT COUNT(*) FROM comps_review_queue WHERE ${where}`, values);
  const result = await query(
    `SELECT id, organization_id, source, source_meta, raw_doc_url, raw_doc_mime,
            raw_doc_size_bytes, status, confidence_scores, reviewer_notes,
            rejection_reason, failure_reason, email_thread_id,
            committed_comp_ids, reviewed_at, reviewed_by, committed_at,
            created_at, updated_at
       FROM comps_review_queue
       WHERE ${where}
       ORDER BY
         CASE status
           WHEN 'pending_review' THEN 0
           WHEN 'pending_extraction' THEN 1
           WHEN 'extracting' THEN 2
           WHEN 'approved' THEN 3
           WHEN 'failed' THEN 4
           WHEN 'rejected' THEN 5
           WHEN 'committed' THEN 6
           ELSE 7
         END,
         created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
    [...values, cappedLimit, safeOffset]
  );

  return {
    data: result.rows,
    pagination: {
      total: parseInt(countResult.rows[0].count, 10),
      limit: cappedLimit,
      offset: safeOffset,
    },
  };
};

const getQueueRow = async (id) => {
  const result = await query(
    `SELECT * FROM comps_review_queue
       WHERE id = $1 AND organization_id = current_organization_id()
       LIMIT 1`,
    [id]
  );
  return result.rows[0] || null;
};

// ──────────────────────────────────────────────────────────────────────────
// Process (run extraction)
// ──────────────────────────────────────────────────────────────────────────

const transitionStatus = async (id, status, fields = {}) => {
  const setClauses = ['status = $2', 'updated_at = NOW()'];
  const values = [id, status];
  let paramIdx = 3;
  for (const [col, val] of Object.entries(fields)) {
    setClauses.push(`${col} = $${paramIdx++}`);
    values.push(val);
  }
  await query(
    `UPDATE comps_review_queue
        SET ${setClauses.join(', ')}
      WHERE id = $1 AND organization_id = current_organization_id()`,
    values
  );
};

/**
 * Run Gemini extraction on a single queue row, persist the structured
 * payload + confidence scores, and transition to pending_review (or
 * failed if extraction errored).
 *
 * Idempotent: if the row is already past extracting, returns a no-op
 * with reason='already_processed'. Cron callers can safely re-trigger.
 */
const processQueueRow = async (id) => {
  const row = await getQueueRow(id);
  if (!row) {
    throw createError('Queue row not found.', 404);
  }
  if (row.status === 'pending_review') {
    return { id, status: 'pending_review', reason: 'already_processed' };
  }
  if (row.status === 'committed' || row.status === 'rejected') {
    return { id, status: row.status, reason: 'terminal' };
  }
  if (!row.raw_doc_url) {
    // Body-only queue rows (no attachment) skip extraction and go
    // straight to pending_review with the email body in source_meta.
    await transitionStatus(id, 'pending_review', {
      structured_payload: JSON.stringify({
        comps: [],
        report_metadata: { notes: 'Body-only ingest — no attachment to extract.' },
      }),
    });
    return { id, status: 'pending_review', reason: 'body_only' };
  }

  await transitionStatus(id, 'extracting');

  const docType = SOURCE_TO_DOCTYPE[row.source] || null;

  try {
    const { docType: resolvedDocType, structuredFields, confidenceScores } =
      await extractionService.extractStoredFileFields({
        fileUrl: row.raw_doc_url,
        fileName: row.source_meta?.attachment_name || 'attachment',
        mimeType: row.raw_doc_mime,
        options: {
          docType,
          context: {
            ingestion_source: row.source,
            queue_row_id: row.id,
            email_subject: row.source_meta?.subject,
            email_from: row.source_meta?.from,
          },
        },
      });

    await transitionStatus(id, 'pending_review', {
      structured_payload: JSON.stringify(structuredFields || {}),
      confidence_scores: JSON.stringify(confidenceScores || {}),
    });

    return {
      id,
      status: 'pending_review',
      doc_type: resolvedDocType,
      confidence_overall: confidenceScores?._overall ?? null,
    };
  } catch (err) {
    log.warn('comps_queue_extraction_failed', {
      queue_id: id,
      error: err.message,
    });
    await transitionStatus(id, 'failed', {
      failure_reason: (err.message || 'extraction_failed').slice(0, 1000),
    });
    return { id, status: 'failed', error: err.message };
  }
};

/**
 * Cron-driven batch worker. Picks up to N rows in pending_extraction
 * status (FIFO by created_at) and processes each. Returns a summary.
 *
 * Caller must establish request context (organizationId) before invoking,
 * since the routes use authentication middleware and RLS enforcement.
 */
const processPendingBatch = async ({ limit = 5 } = {}) => {
  const cappedLimit = Math.min(parseInt(limit, 10) || 5, 25);
  const result = await query(
    `SELECT id FROM comps_review_queue
       WHERE organization_id = current_organization_id()
         AND status = 'pending_extraction'
       ORDER BY created_at ASC
       LIMIT $1`,
    [cappedLimit]
  );

  const summary = { picked: result.rows.length, processed: 0, failed: 0, skipped: 0 };
  for (const { id } of result.rows) {
    try {
      const r = await processQueueRow(id);
      if (r.status === 'pending_review') summary.processed += 1;
      else if (r.status === 'failed') summary.failed += 1;
      else summary.skipped += 1;
    } catch (err) {
      summary.failed += 1;
      log.warn('comps_queue_batch_row_failed', { id, error: err.message });
    }
  }
  return summary;
};

// ──────────────────────────────────────────────────────────────────────────
// Reviewer edits
// ──────────────────────────────────────────────────────────────────────────

const applyReviewerEdits = async (id, edits, userId) => {
  const row = await getQueueRow(id);
  if (!row) throw createError('Queue row not found.', 404);
  if (row.status === 'committed' || row.status === 'rejected') {
    throw createError('Cannot edit a row that is already committed or rejected.', 409);
  }

  const result = await query(
    `UPDATE comps_review_queue
        SET reviewer_edits = $1::jsonb,
            reviewer_notes = $2,
            updated_at     = NOW()
      WHERE id = $3 AND organization_id = current_organization_id()
      RETURNING *`,
    [
      JSON.stringify(edits?.payload || edits || {}),
      edits?.notes || null,
      id,
    ]
  );

  return result.rows[0] || null;
};

// ──────────────────────────────────────────────────────────────────────────
// Approve + commit
// ──────────────────────────────────────────────────────────────────────────

const buildCommitCandidates = (row) => {
  // reviewer_edits.comps is the source of truth at commit time. If empty,
  // fall back to structured_payload.comps. If both empty AND the
  // structured_payload looks like a single-comp shape, treat it as one.
  const reviewerComps = row.reviewer_edits?.comps;
  const payloadComps = row.structured_payload?.comps;

  if (Array.isArray(reviewerComps) && reviewerComps.length > 0) {
    return reviewerComps;
  }
  if (Array.isArray(payloadComps) && payloadComps.length > 0) {
    return payloadComps;
  }
  // Single-comp fallback: treat top-level structured_payload as one comp.
  if (
    row.structured_payload &&
    typeof row.structured_payload === 'object' &&
    !Array.isArray(row.structured_payload)
  ) {
    const top = row.structured_payload;
    if (top.project_name || top.rate_per_sqft || top.asking_price_per_sqft) {
      return [
        {
          project_name: top.project_name || top.property_address || '',
          developer: top.developer || top.seller_name || '',
          city: top.city || top.report_metadata?.city || '',
          locality: top.locality || top.report_metadata?.submarket || '',
          rate_per_sqft: top.rate_per_sqft || top.asking_price_per_sqft,
          super_builtup_area_sqft: top.super_builtup_area_sqft || top.total_area_sqft,
        },
      ];
    }
  }
  return [];
};

/**
 * Approve the queue row and commit each comp into the production
 * `comps` table. Wraps the inserts + the queue update in a single
 * transaction so partial commits are impossible.
 *
 * Returns { committed_count, skipped_count, skipped_reasons, comp_ids }.
 */
const approveAndCommit = async (id, userId) => {
  const row = await getQueueRow(id);
  if (!row) throw createError('Queue row not found.', 404);
  if (row.status !== 'pending_review' && row.status !== 'approved') {
    throw createError(
      `Cannot approve a row in status "${row.status}". Expected pending_review.`,
      409
    );
  }

  const candidates = buildCommitCandidates(row);
  if (candidates.length === 0) {
    throw createError('No comps to commit — payload is empty.', 400);
  }

  const orgId = row.organization_id;

  return transaction(async (client) => {
    const compIds = [];
    const skippedReasons = [];

    for (const candidate of candidates) {
      const { row: compRow, missing } = mapToCompsRow(candidate, orgId);
      if (!compRow) {
        skippedReasons.push({
          source_index: candidate._source_index ?? null,
          missing,
        });
        continue;
      }

      const insertResult = await client.query(
        `INSERT INTO comps (
           organization_id, project_name, developer, city, locality, lat, lng,
           project_type, bhk_config, carpet_area_sqft, super_builtup_area_sqft,
           rate_per_sqft, rate_per_sqft_min, rate_per_sqft_max,
           total_units, launch_year, possession_year, rera_number, amenities,
           source, is_verified, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         RETURNING id`,
        [
          compRow.organization_id, compRow.project_name, compRow.developer,
          compRow.city, compRow.locality, compRow.lat, compRow.lng,
          compRow.project_type, compRow.bhk_config, compRow.carpet_area_sqft,
          compRow.super_builtup_area_sqft, compRow.rate_per_sqft,
          compRow.rate_per_sqft_min, compRow.rate_per_sqft_max,
          compRow.total_units, compRow.launch_year, compRow.possession_year,
          compRow.rera_number, compRow.amenities, compRow.source,
          compRow.is_verified, userId || null,
        ]
      );
      compIds.push(insertResult.rows[0].id);
    }

    if (compIds.length === 0) {
      // All candidates were rejected — surface rather than silently committing
      // a no-op.
      throw createError(
        `All ${candidates.length} candidate comps were rejected. Reasons: ${JSON.stringify(skippedReasons)}`,
        422
      );
    }

    await client.query(
      `UPDATE comps_review_queue
          SET status              = 'committed',
              committed_comp_ids  = $1,
              committed_at        = NOW(),
              committed_by        = $2,
              reviewed_by         = COALESCE(reviewed_by, $2),
              reviewed_at         = COALESCE(reviewed_at, NOW()),
              updated_at          = NOW()
        WHERE id = $3 AND organization_id = current_organization_id()`,
      [compIds, userId || null, id]
    );

    return {
      committed_count: compIds.length,
      skipped_count: skippedReasons.length,
      skipped_reasons: skippedReasons,
      comp_ids: compIds,
    };
  });
};

// ──────────────────────────────────────────────────────────────────────────
// Reject
// ──────────────────────────────────────────────────────────────────────────

const reject = async (id, reason, userId) => {
  const row = await getQueueRow(id);
  if (!row) throw createError('Queue row not found.', 404);
  if (row.status === 'committed') {
    throw createError('Cannot reject a row that is already committed.', 409);
  }

  const result = await query(
    `UPDATE comps_review_queue
        SET status            = 'rejected',
            rejection_reason  = $1,
            reviewed_by       = $2,
            reviewed_at       = NOW(),
            updated_at        = NOW()
      WHERE id = $3 AND organization_id = current_organization_id()
      RETURNING *`,
    [reason || null, userId || null, id]
  );
  return result.rows[0] || null;
};

// ──────────────────────────────────────────────────────────────────────────
// Cron worker entrypoint — establishes its own request context
// ──────────────────────────────────────────────────────────────────────────

/**
 * Entry point for cron-triggered processing. Walks every organization
 * that has pending rows and processes a small batch per org. Used by
 * the /api/cron/comps-queue/process-pending route which is auth'd by
 * CRON_SECRET, not user JWT.
 */
const processPendingBatchAcrossOrgs = async ({ limitPerOrg = 5 } = {}) => {
  // Pick orgs with pending rows — service role bypasses RLS so the LEFT
  // JOIN sees all organizations, but the inner query is scoped to
  // pending_extraction only.
  const orgsResult = await query(
    `SELECT DISTINCT organization_id
       FROM comps_review_queue
      WHERE status = 'pending_extraction'`,
    []
  );

  const summaries = [];
  for (const { organization_id } of orgsResult.rows) {
    const result = await runWithRequestContext(
      { organizationId: organization_id, userId: null },
      () => processPendingBatch({ limit: limitPerOrg })
    );
    summaries.push({ organization_id, ...result });
  }
  return { orgs_processed: orgsResult.rows.length, summaries };
};

// ──────────────────────────────────────────────────────────────────────────
// Manual upload — analyst-driven path (no email needed)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Persist a file uploaded directly through the reviewer UI as a queue
 * row with source='manual_upload'. Mirrors the email-ingestion flow
 * (sha256 dedupe, signed-URL storage, queue insert) but skips the
 * Postmark dependency entirely so the flywheel works pre-domain.
 *
 * Required when the analyst already has the source PDF in hand and
 * doesn't want to wait for the email round-trip. Also useful during
 * Postmark outages.
 *
 * Args:
 *   buffer       — file bytes (multer's req.file.buffer)
 *   fileName     — original filename
 *   mimeType     — MIME type (multer pre-validated)
 *   organizationId — usually req.user.organization_id
 *   userId       — uploader's user id (recorded in source_meta)
 *   metadata     — optional { sender, subject, notes } captured in the
 *                  upload modal
 *
 * Returns: { row, deduplicated }
 *   • deduplicated=true means the same byte-identical file was already
 *     ingested; the existing row is returned (no error).
 */
async function manualUpload({
  buffer,
  fileName,
  mimeType,
  organizationId,
  userId,
  metadata = {},
}) {
  if (!buffer || !buffer.length) {
    throw createError('File is empty.', 400);
  }
  if (!organizationId) {
    throw createError('Organization context is required.', 400);
  }
  if (!MANUAL_UPLOAD_ALLOWED_MIMES.has(mimeType)) {
    throw createError(
      `Unsupported file type "${mimeType}". Allowed: PDF, images, Office docs, CSV.`,
      400,
    );
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const safeName = sanitizeFileName(fileName);

  // Synthetic path key — manual uploads don't belong to a deal, so we
  // namespace them under `comps-queue-manual-<random>` to keep them
  // separate from email and direct-upload deal documents.
  const pathKey = `comps-queue-manual-${crypto.randomUUID().slice(0, 12)}`;

  let storageUrl;
  try {
    const result = await uploadFile(buffer, safeName, mimeType, pathKey, organizationId);
    storageUrl = result.url;
  } catch (uploadErr) {
    log.warn('comps_queue_manual_upload_storage_failed', {
      fileName: safeName,
      error: uploadErr.message,
    });
    throw createError('Storage upload failed. Please retry.', 500);
  }

  const sourceMeta = {
    uploaded_by_user_id: userId || null,
    uploaded_at: new Date().toISOString(),
    attachment_name: safeName,
    sender: cleanString(metadata.sender),
    subject: cleanString(metadata.subject),
    notes: cleanString(metadata.notes),
  };

  try {
    const result = await query(
      `INSERT INTO comps_review_queue
         (organization_id, source, source_meta, raw_doc_url, raw_doc_mime,
          raw_doc_size_bytes, raw_doc_sha256, status)
       VALUES ($1, 'manual_upload', $2, $3, $4, $5, $6, 'pending_extraction')
       RETURNING *`,
      [
        organizationId,
        JSON.stringify(sourceMeta),
        storageUrl,
        mimeType,
        buffer.length,
        sha256,
      ],
    );
    return { row: result.rows[0], deduplicated: false };
  } catch (err) {
    if (err && err.code === '23505') {
      // Same byte-identical file was already ingested for this org —
      // surface the existing row so the analyst can jump to it instead
      // of getting a confusing duplicate error.
      const existing = await query(
        `SELECT * FROM comps_review_queue
          WHERE organization_id = $1 AND raw_doc_sha256 = $2
          LIMIT 1`,
        [organizationId, sha256],
      );
      return { row: existing.rows[0], deduplicated: true };
    }
    throw err;
  }
}

const cleanString = (s) => {
  if (s == null) return null;
  const trimmed = String(s).trim().slice(0, 1000);
  return trimmed || null;
};

module.exports = {
  // List / get
  listQueue,
  getQueueRow,
  // Process
  processQueueRow,
  processPendingBatch,
  processPendingBatchAcrossOrgs,
  // Reviewer flow
  applyReviewerEdits,
  approveAndCommit,
  reject,
  // Manual upload
  manualUpload,
  MANUAL_UPLOAD_ALLOWED_MIMES,
  // Helpers — exported for tests
  normalizeProjectType,
  mapToCompsRow,
  buildCommitCandidates,
  SOURCE_TO_DOCTYPE,
};
