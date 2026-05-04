'use strict';

/**
 * Semantic search over the workspace's indexed documents (pgvector via
 * embeddings.service). Mounted at /api/search.
 *
 * Two endpoints:
 *   GET  /api/search/semantic?q=...&documentId=...&kind=...&k=8
 *      Returns ranked chunks. Org-scoped via RLS.
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
    // Pull the latest extraction text. RLS on documents + evidence_sources
    // ensures org scoping.
    const text = await fetchLatestExtractionText(documentId);
    if (!text) {
      return res.status(404).json({
        success: false,
        message: 'No extracted text found for this document. Run extraction first.',
      });
    }
    // Wipe prior embeddings for this document so we don't accumulate stale
    // chunks from older extraction runs.
    await query(
      `DELETE FROM public.document_embeddings WHERE document_id = $1`,
      [documentId],
    );
    const result = await embeddings.indexDocumentText({
      organizationId: req.user.organization_id,
      documentId,
      text,
      sourceKind: 'document_chunk',
      metadata: { reindexed_at: new Date().toISOString(), reindexed_by: req.user.id },
    });
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
