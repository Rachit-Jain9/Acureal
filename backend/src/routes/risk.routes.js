'use strict';

const express = require('express');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const riskService = require('../services/risk.service');
const inconsistencyDetector = require('../services/inconsistencyDetector.service');
const aiArtifacts = require('../services/aiArtifacts.service');
const { query } = require('../config/database');

const router = express.Router();

// GET /deals/:dealId/risk
router.get('/deals/:dealId/risk', authenticate, async (req, res, next) => {
  try {
    const flags = await riskService.listByDeal(req.params.dealId);
    return res.json({ success: true, data: flags });
  } catch (err) {
    next(err);
  }
});

// GET /deals/:dealId/risk/score
router.get('/deals/:dealId/risk/score', authenticate, async (req, res, next) => {
  try {
    const score = await riskService.getRiskScore(req.params.dealId);
    return res.json({ success: true, data: score });
  } catch (err) {
    next(err);
  }
});

// POST /deals/:dealId/risk
router.post('/deals/:dealId/risk', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { category, title } = req.body;
    if (!category || !title) {
      return res.status(400).json({ success: false, message: 'category and title are required' });
    }

    const flag = await riskService.create(req.params.dealId, req.body, req.user.id);
    return res.status(201).json({ success: true, data: flag });
  } catch (err) {
    next(err);
  }
});

// PUT /deals/:dealId/risk/:id
router.put('/deals/:dealId/risk/:id', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const flag = await riskService.update(req.params.id, req.body);
    if (!flag) {
      return res.status(404).json({ success: false, message: 'Risk flag not found' });
    }
    return res.json({ success: true, data: flag });
  } catch (err) {
    next(err);
  }
});

// DELETE /deals/:dealId/risk/:id
router.delete('/deals/:dealId/risk/:id', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const deleted = await riskService.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Risk flag not found' });
    }
    return res.json({ success: true, data: { id: deleted.id } });
  } catch (err) {
    next(err);
  }
});

// POST /deals/:dealId/risk/ai/inconsistency-check
// Tier-1 #4 — runs the cross-document inconsistency detector against the
// deal's extractions, persists each finding as a risk_flag with
// source='ai_detector', and synthesises a risk_brief artifact via Claude.
// Idempotent — re-running on the same extractions dedupes by title so
// duplicate flags don't accumulate.
router.post(
  '/deals/:dealId/risk/ai/inconsistency-check',
  authenticate,
  requireAdminOrAnalyst,
  async (req, res, next) => {
    try {
      // Look up deal name for the narrative — best-effort.
      let dealName = null;
      try {
        const r = await query('SELECT name FROM deals WHERE id = $1 LIMIT 1', [req.params.dealId]);
        dealName = r.rows[0]?.name || null;
      } catch {
        // ignore — narrative just gets a generic header
      }

      const result = await inconsistencyDetector.detectAndPersist(req.params.dealId, {
        userId: req.user.id,
        dealName,
        organizationId: req.user.organization_id,
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// GET /deals/:dealId/risk/ai/brief
// Returns the most recent risk_brief artifact for the deal, or null on miss.
// Renders below the risk-flags list so reviewers see the latest synthesised
// narrative without re-running the detector.
router.get(
  '/deals/:dealId/risk/ai/brief',
  authenticate,
  async (req, res, next) => {
    try {
      const cached = await aiArtifacts.getLatestArtifact({
        dealId: req.params.dealId,
        artifactType: 'risk_brief',
      });
      if (!cached) {
        return res.json({ success: true, data: null });
      }
      return res.json({
        success: true,
        data: {
          id: cached.id,
          contentMd: cached.content_md,
          contentJsonb: cached.content_jsonb,
          generatedAt: cached.generated_at,
          status: cached.status,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
