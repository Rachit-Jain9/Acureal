'use strict';

/**
 * Semantic search over the workspace's indexed documents (pgvector via
 * embeddings.service). Mounted at /api/search.
 *
 * Two endpoints:
 *   GET  /api/search/semantic?q=...&documentId=...&kind=...&k=8
 *      Returns ranked chunks. Org-scoped at the app layer (pooled role bypasses RLS).
 *   POST /api/search/reindex/:documentId
 *      Re-runs the chunk → embed → store pipeline for a single document
 *      using its current evidence-source text. Admin/analyst gated.
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
    // Pull the latest extraction text. App-layer org filters on documents +
    // evidence_sources ensure org scoping (the pooled DB role bypasses RLS).
    const text = await fetchLatestExtractionText(documentId);
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
      await query(`SELECT id FROM public.document_embeddings WHERE document_id = $1`, [documentId])
    ).rows.map((r) => r.id);

    const result = await embeddings.indexDocumentText({
      organizationId: req.user.organization_id,
      documentId,
      text,
      sourceKind: 'document_chunk',
      metadata: { reindexed_at: new Date().toISOString(), reindexed_by: req.user.id },
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

const fetchLatestExtractionText = async (documentId) => {
  // evidence_sources stores extracted raw_text per document; pick the most
  // recent. Fail soft — return null when no row exists.
  try {
    const result = await query(
      `SELECT raw_text
         FROM evidence_sources
        WHERE document_id = $1
          AND raw_text IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [documentId],
    );
    return result.rows[0]?.raw_text || null;
  } catch {
    return null;
  }
};

module.exports = router;
