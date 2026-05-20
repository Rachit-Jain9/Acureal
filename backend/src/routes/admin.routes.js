'use strict';

/**
 * Admin / operator-only routes. Mounted at /api/admin in server.js.
 *
 * Currently hosts the AI usage dashboard endpoint. Other admin tooling
 * (model routing config, AI artifact moderation, retention sweep manual
 * trigger) will land here as Tier 2/3 of `docs/AI_ROADMAP.md` ships.
 *
 * All routes here require role admin or analyst. The cookie-based session
 * auth (PR #142) plus the `requireRole` guard are the gate; org scoping
 * happens at the data layer via RLS.
 */

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const aiUsageService = require('../services/aiUsage.service');
const aiHealthService = require('../services/aiHealth.service'); // PR-NX22
const learningSignalsService = require('../services/learningSignals.service'); // PR-NX96
const routingConfigService = require('../services/ai/routingConfig');
const abEvalPersistence = require('../services/ai/abEvalPersistence.service');
const { query } = require('../config/database');

const router = express.Router();

// GET /api/admin/users
//
// Org-scoped list of active users — used by the Comps Review Queue's
// bulk-reassign user-picker modal. Returns only the public fields the
// picker needs (id / name / email / role); password hashes etc. never
// leave the server.
router.get('/users', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, email, role
         FROM users
        WHERE organization_id = current_organization_id()
          AND COALESCE(is_active, true) = true
        ORDER BY name ASC, email ASC
        LIMIT 200`,
      [],
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/recent-events?limit=10
//
// Org-scoped tail of `deal_events` (the HMAC-signed financial-computation
// audit log). Used by the dashboard's Audit-trail-tail widget. Joined
// against deals + users so the timeline can render deal name + actor
// without per-row lookups.
//
// Read-only. RLS on deal_events filters to current_organization_id()
// automatically; this endpoint just joins for display.
router.get('/recent-events', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const result = await query(
      `SELECT e.id, e.deal_id, e.event_type, e.engine_version, e.asset_class,
              e.created_at,
              d.name AS deal_name,
              u.id   AS actor_id,
              u.name AS actor_name
         FROM deal_events e
         LEFT JOIN deals d ON d.id = e.deal_id
         LEFT JOIN users u ON u.id = e.actor_id
        ORDER BY e.created_at DESC
        LIMIT $1`,
      [limit],
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/ai-usage?days=30
//
// Returns rollups over `ai_call_logs` for the trailing window:
//   • summary — total calls / cost / cache-hit rate / latency p95 / retry recovery
//   • daily — per-day series for the chart
//   • by_task_provider — top 25 (task × provider × model) cells by cost
//   • by_doctype — extraction quality by doctype × language (PR #155 cols)
//
// Org-scoped via RLS on ai_call_logs. Read-only.
router.get('/ai-usage', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const days = req.query.days ? parseInt(req.query.days, 10) : 30;
    const data = await aiUsageService.getUsageDashboard({ days });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/ai-health
//
// PR-NX22 (2026-05-16): live operational status for the 3 AI providers
// (Gemini / Claude / OpenAI). Complements /ai-usage (cost lens) with
// the WORKING-RIGHT-NOW lens. Returns per-provider: env-var configured,
// most recent call status + latency + error, 7-day success rate + p50/p95
// latency, and a coarse healthBand classification (healthy/degraded/
// unhealthy/unknown) for at-a-glance UI rendering.
//
// Soft-fails if ai_call_logs is unavailable — returns configuration
// status only, never throws.
//
// Org-scoped via RLS on ai_call_logs. Read-only.
router.get('/ai-health', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const snapshot = await aiHealthService.getHealthSnapshot();
    res.json({ success: true, data: snapshot });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/extraction-quality?days=90
//
// PR-NX96 (Phase 5.2 seed): extraction-accuracy from real human corrections.
// Aggregates the `extraction_field_review` learning signals into a per-field
// correction rate — "which fields does the model get wrong" — over a trailing
// window. Operator-only (per the AI-disclosure policy this stays off the
// customer surface). Soft-fails to an empty shape if 20260608 is unapplied.
//
// Org-scoped via current_organization_id() inside the aggregate query.
router.get('/extraction-quality', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const days = req.query.days ? parseInt(req.query.days, 10) : 90;
    const data = await learningSignalsService.getExtractionAccuracy({ days });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/ai-routing
//
// Returns every row in the ai_routing_config table. Admin/owner-gated.
// Used by the Settings page routing editor + ops debugging.
router.get('/ai-routing', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const rows = await routingConfigService.listRoutingConfig();
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

// PUT /api/admin/ai-routing/:task
//
// Update or insert routing for a task. Admin-only. Body shape:
//   { provider, model?, fallbackProvider?, fallbackModel?, notes? }
//
// Effective immediately on the next AI call (the in-process cache is
// invalidated on success).
router.put('/ai-routing/:task', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { provider, model, fallbackProvider, fallbackModel, notes } = req.body || {};
    if (!provider) {
      return res.status(400).json({ success: false, message: 'provider is required' });
    }
    const allowed = new Set(['gemini', 'claude', 'openai']);
    if (!allowed.has(provider)) {
      return res.status(400).json({ success: false, message: `provider must be one of ${[...allowed].join(', ')}` });
    }
    if (fallbackProvider && !allowed.has(fallbackProvider)) {
      return res.status(400).json({ success: false, message: 'fallbackProvider invalid' });
    }
    const updated = await routingConfigService.upsertRouting({
      task: req.params.task,
      provider,
      model: model ?? null,
      fallbackProvider: fallbackProvider ?? null,
      fallbackModel: fallbackModel ?? null,
      notes: notes ?? null,
      changedBy: req.user.id,
    });
    return res.json({ success: true, data: updated });
  } catch (error) {
    return next(error);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// A/B eval harness — Tier 2 #14 finish.
// Wraps the existing CLI harness (backend/scripts/run-ab-eval.js) with
// admin-only HTTP routes that persist results to ab_eval_runs +
// ab_eval_results. Surfaced on AdminAbEvalPage on the frontend.
// ──────────────────────────────────────────────────────────────────────────

// GET /api/admin/ab-eval/runs?limit=50 — list past runs, newest first
router.get('/ab-eval/runs', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const rows = await abEvalPersistence.listRuns({
      limit: Number(req.query.limit) || 50,
    });
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/ab-eval/runs/:id — full detail incl. per-fixture rows
router.get('/ab-eval/runs/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const run = await abEvalPersistence.getRunDetail(req.params.id);
    if (!run) {
      return res.status(404).json({ success: false, message: 'Run not found.' });
    }
    return res.json({ success: true, data: run });
  } catch (error) {
    return next(error);
  }
});

// POST /api/admin/ab-eval/runs — trigger a new evaluation
//
// Body:
//   { task: 'parcel_narrative' | 'export_insights',
//     candidates: ['claude:claude-sonnet-4-6', 'openai:gpt-5.4-mini'],
//     limit: 10 }
//
// Sync — the request blocks until the eval completes. With the
// 10-fixture default and 2 candidates, expect ~30–40s end-to-end.
// Vercel function timeout is 60s; harness internally caps at 50
// fixtures per run.
router.post('/ab-eval/runs', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const {
      task = 'parcel_narrative',
      candidates = ['claude:claude-sonnet-4-6', 'openai:gpt-5.4-mini'],
      limit = 10,
    } = req.body || {};
    const run = await abEvalPersistence.runAndPersist({
      organizationId: req.user.organization_id,
      triggeredBy: req.user.id,
      task,
      candidateSpecs: candidates,
      limit,
    });
    return res.json({ success: true, data: run });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
