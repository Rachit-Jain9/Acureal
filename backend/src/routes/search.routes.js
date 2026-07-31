'use strict';

/**
 * Semantic search over the workspace's indexed documents (pgvector via
 * embeddings.service). Mounted at /api/search.
 *
 *   GET  /api/search/semantic?q=...&documentId=...&kind=...&k=8
 *      Returns ranked chunks.
 *   POST /api/search/reindex/:documentId
 *      Re-runs chunk → embed → store for one document. Admin/analyst gated.
 *   POST /api/search/reindex-all
 *      Backfills every document that has extracted text but no chunks.
 *
 * ORG SCOPING — corrected 2026-07-31. These handlers used to carry the note
 * "the pooled DB role bypasses RLS", so app-layer filters were treated as the
 * only guard. That has been FALSE since the M1 tenant-isolation flip
 * (2026-07-28): the app connects as `redip_app`, which is NOBYPASSRLS and does
 * not own the tables, so row-level security genuinely applies. Both layers are
 * now live and both are kept deliberately — RLS is the enforcement boundary,
 * the explicit `organization_id` predicates are defence in depth and keep the
 * intent legible at the call site.
 */

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const embeddings = require('../services/embeddings.service');
const { query } = require('../config/database');

const router = express.Router();

// GET /api/search/semantic
router.get('/semantic', authenticate, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ success: false, message: 'q is required' });
    const k = Math.max(1, Math.min(50, parseInt(req.query.k, 10) || 8));
    const documentId = req.query.documentId || null;
    const sourceKind = req.query.kind || null;
    const rows = await embeddings.searchSimilar({ query: q, k, documentId, sourceKind });
    return res.json({ success: true, data: rows });
  } catch (error) {
    return next(error);
  }
});

// POST /api/search/reindex/:documentId — admin-only re-embed of one doc.
//
// Pulls the most recent extraction's raw text from evidence_sources and
// re-runs the embedding pipeline. Useful after embedding model upgrades
// or to backfill documents uploaded before pgvector landed.
router.post('/reindex/:documentId', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const documentId = req.params.documentId;
    const organizationId = req.user.organization_id;
    const text = await fetchLatestExtractionText(documentId, organizationId);
    if (!text) {
      return res.status(404).json({
        success: false,
        message: 'No extracted text found for this document. Run extraction first.',
      });
    }
    // Index FIRST, then retire the OLD chunks — never the other way round.
    // The previous order DELETEd then re-indexed, so a failed embedding call
    // left the document with ZERO embeddings (silently dark in search) AND
    // still returned 200. Capture the prior chunk ids, index the new ones, and
    // only drop the old chunks once indexing actually produced rows.
    const priorIds = (
      await query(
        `SELECT id FROM public.document_embeddings
          WHERE document_id = $1 AND organization_id = $2`,
        [documentId, organizationId],
      )
    ).rows.map((r) => r.id);

    const result = await embeddings.indexDocumentText({
      organizationId,
      documentId,
      text,
      sourceKind: 'document_chunk',
      metadata: {
        // See fetchLatestExtractionText: the persisted text is the model's
        // reading, not the document's own prose.
        text_source: 'model_reading',
        reindexed_at: new Date().toISOString(),
        reindexed_by: req.user.id,
      },
    });

    if (result?.error || !(result?.rows_inserted > 0)) {
      // Re-index produced nothing — keep the prior embeddings intact and report
      // the failure rather than silently dark-ing the document behind a 200.
      return res.status(502).json({
        success: false,
        message: 'Re-index produced no chunks; previous embeddings left intact.',
        data: result,
      });
    }

    // New chunks are in — now retire the stale ones captured before indexing.
    if (priorIds.length > 0) {
      await query(`DELETE FROM public.document_embeddings WHERE id = ANY($1::uuid[])`, [priorIds]);
    }
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

// Pull the most recent extracted text for a document.
//
// This used to SELECT from `evidence_sources`, a table that does not exist in
// the schema. Every call threw, the bare `catch` returned null, and the
// reindex endpoint answered 404 "no extracted text" for every document ever —
// so the one backfill mechanism was itself inoperable.
//
// The text actually lives in `document_extractions.raw_extraction->>'raw_text'`.
// Note what that is: the MODEL'S reply, not the document's prose (the live
// pipeline prefers `documentText` when a file is machine-parseable, but that
// transcription is never persisted). Chunks created here are therefore
// labelled `text_source: 'model_reading'` so a citation never implies it is
// quoting the document verbatim.
const fetchLatestExtractionText = async (documentId, organizationId) => {
  const result = await query(
    `SELECT raw_extraction->>'raw_text' AS raw_text
       FROM public.document_extractions
      WHERE document_id = $1
        AND organization_id = $2
        AND raw_extraction->>'raw_text' IS NOT NULL
        AND length(raw_extraction->>'raw_text') > 50
      ORDER BY created_at DESC
      LIMIT 1`,
    [documentId, organizationId],
  );
  return result.rows[0]?.raw_text || null;
};

// POST /api/search/reindex-all — backfill every document that has extracted
// text but no chunks. Exists because the indexing step was inert until
// 2026-07-31, so documents uploaded before then are invisible to search and
// uncitable by Q&A; nothing re-extracts them on its own.
//
// Bounded and resumable rather than clever: it processes a capped batch per
// call and reports what remains, so a workspace with hundreds of documents is
// several quick calls instead of one request that dies at the function
// timeout. Already-indexed documents are skipped, making it safe to re-run.
router.post('/reindex-all', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const organizationId = req.user.organization_id;
    const limit = Math.max(1, Math.min(25, parseInt(req.body?.limit, 10) || 10));

    const pending = await query(
      `SELECT DISTINCT ON (de.document_id)
              de.document_id,
              de.raw_extraction->>'raw_text' AS raw_text,
              de.doc_type
         FROM public.document_extractions de
         JOIN public.documents d
           ON d.id = de.document_id AND d.deleted_at IS NULL
        WHERE de.organization_id = $1
          AND de.raw_extraction->>'raw_text' IS NOT NULL
          AND length(de.raw_extraction->>'raw_text') > 50
          AND NOT EXISTS (
                SELECT 1 FROM public.document_embeddings e
                 WHERE e.document_id = de.document_id
              )
        ORDER BY de.document_id, de.created_at DESC
        LIMIT $2`,
      [organizationId, limit],
    );

    const results = [];
    for (const row of pending.rows) {
      // Sequential on purpose: each iteration is an embedding-provider call,
      // and firing a whole batch concurrently is the fastest way to trip a
      // rate limit and fail the entire backfill instead of part of it.
      // eslint-disable-next-line no-await-in-loop
      const outcome = await embeddings.indexDocumentText({
        organizationId,
        documentId: row.document_id,
        text: row.raw_text,
        sourceKind: 'document_chunk',
        metadata: {
          doc_type: row.doc_type || null,
          text_source: 'model_reading',
          backfilled_at: new Date().toISOString(),
          backfilled_by: req.user.id,
        },
      });
      results.push({
        document_id: row.document_id,
        rows_inserted: outcome?.rows_inserted || 0,
        error: outcome?.error || null,
      });
    }

    const remaining = await query(
      `SELECT count(DISTINCT de.document_id)::int AS remaining
         FROM public.document_extractions de
         JOIN public.documents d
           ON d.id = de.document_id AND d.deleted_at IS NULL
        WHERE de.organization_id = $1
          AND de.raw_extraction->>'raw_text' IS NOT NULL
          AND length(de.raw_extraction->>'raw_text') > 50
          AND NOT EXISTS (
                SELECT 1 FROM public.document_embeddings e
                 WHERE e.document_id = de.document_id
              )`,
      [organizationId],
    );

    const indexed = results.filter((r) => r.rows_inserted > 0).length;
    return res.json({
      success: true,
      data: {
        processed: results.length,
        indexed,
        failed: results.length - indexed,
        remaining: remaining.rows[0]?.remaining ?? 0,
        results,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
