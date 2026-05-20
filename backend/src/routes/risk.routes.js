'use strict';

const express = require('express');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const riskService = require('../services/risk.service');
const riskRadarService = require('../services/riskRadar.service');
const inconsistencyDetector = require('../services/inconsistencyDetector.service');
const aiArtifacts = require('../services/aiArtifacts.service');
const dealService = require('../services/deal.service');
const { generateRiskNarrative } = require('../services/export.insights.service');
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

// GET /deals/:dealId/risk/radar
//
// Workstream B — the Deal Risk Radar: a standing, deterministic pre-mortem.
// For each failure mode (title, approvals, financial, physical, market) it
// synthesises a posture — cleared / unverified / flagged — from the deal's
// risk flags, due-diligence items, and approvals, surfacing "not yet verified"
// as a first-class state. No AI; every posture and signal is explainable.
router.get('/deals/:dealId/risk/radar', authenticate, async (req, res, next) => {
  try {
    const radar = await riskRadarService.getRiskRadar(req.params.dealId);
    return res.json({ success: true, data: radar });
  } catch (err) {
    next(err);
  }
});

// PR-NX47 (2026-05-19) — Live AI risk-narrative endpoint.
//
// Surfaces the same 2-paragraph Claude synthesis (risk profile summary
// + critical-spotlight callout) that ships in the DOCX Risk Register
// section (PR-NX43), now consumable by the frontend RiskTab in the live
// workspace — operators no longer need to download the DOCX to read the
// AI risk synthesis. Uses the same generateRiskNarrative service so the
// XLSX / DOCX / PPTX / frontend all see identical content per
// cross-product reconciliation rules.
//
// Cascade: Claude (primary) → OpenAI (secondary) → unavailable. Returns
// canonical envelope: { available, summary_paragraph,
// critical_spotlight_paragraph, confidence, provider, fallbackReason,
// disclaimer }.
//
// Fast-no-op paths: zero risks logged OR all risks closed/resolved/
// mitigated → returns { available: false, reason } without firing any
// AI call.
//
// Auth: authenticate + analyst/admin (consistent with the DOCX export
// route — same data, same gate).
router.get(
  '/deals/:dealId/risk-narrative',
  authenticate,
  requireAdminOrAnalyst,
  async (req, res, next) => {
    try {
      const dealId = req.params.dealId;
      // Fetch deal core (RLS-scoped) and risk items in parallel — both
      // are independent reads.
      const [deal, items] = await Promise.all([
        dealService.getDealById(dealId),
        riskService.listByDeal(dealId),
      ]);
      if (!deal) {
        return res.status(404).json({ success: false, message: 'Deal not found' });
      }

      // Compute severity counts inline — same shape as the export
      // pipeline's riskSummary so the service receives identical input
      // regardless of which surface called it.
      const riskCounts = items.reduce(
        (acc, r) => {
          const sev = String(r?.severity || '').toLowerCase();
          const status = String(r?.status || '').toLowerCase();
          if (status === 'open' || status === 'flagged') {
            if (sev === 'critical') acc.critical += 1;
            else if (sev === 'high') acc.high += 1;
            else if (sev === 'medium') acc.medium += 1;
            else if (sev === 'low') acc.low += 1;
          }
          return acc;
        },
        { critical: 0, high: 0, medium: 0, low: 0 },
      );

      const narrative = await generateRiskNarrative({ deal, riskCounts, items });
      return res.json({ success: true, data: narrative });
    } catch (err) {
      next(err);
    }
  },
);

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
