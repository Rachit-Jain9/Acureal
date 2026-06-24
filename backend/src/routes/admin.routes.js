'use strict';

/**
 * Admin / operator routes. Mounted at /api/admin in server.js.
 *
 * Two gating tiers live here, deliberately:
 *
 *   1. `requirePlatformAdmin` — REDIP operator only (email allowlist). Used for
 *      anything that mutates GLOBAL state (AI provider routing config), spends
 *      shared platform AI budget (A/B eval runs), or is an operator-only
 *      analytics surface with no customer consumer (audit-trail page,
 *      learning-signals, extraction-quality, ai-health). These must NOT be
 *      reachable by an ordinary org admin.
 *
 *   2. `requireRole('admin', 'analyst')` — org admin/analyst. Used ONLY for the
 *      three endpoints that back customer-facing surfaces and return strictly
 *      org-scoped data: `/users` (Deals + Comps-Queue assignee pickers),
 *      `/recent-events` (dashboard audit-tail widget), `/ai-usage` (dashboard
 *      AI-cost widget). Locking these would 403 normal users' dashboards.
 *
 * Cookie-based session auth (PR #142) runs first via `authenticate`; org
 * scoping happens at the data layer (app-layer `current_organization_id()`).
 */

const express = require('express');
const { authenticate, requireRole, requirePlatformAdmin } = require('../middleware/auth');
const aiUsageService = require('../services/aiUsage.service');
const aiHealthService = require('../services/aiHealth.service'); // PR-NX22
const extractionVerdictsService = require('../services/extractionVerdicts.service');
const routingConfigService = require('../services/ai/routingConfig');
const abEvalPersistence = require('../services/ai/abEvalPersistence.service');
// E7-PR1 (2026-05-27) — admin view of the learning-loop telemetry.
const learningSignalsAdminReport = require('../services/learningSignals.adminReport.service');
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
// Read-only. Org scoping is enforced at the APP layer by the explicit
// `e.organization_id = current_organization_id()` filter below — NOT by RLS.
// The pooled DB role bypasses row-level security (see audit #858/#28), so the
// WHERE clause is the only real tenant boundary. The joins are display-only.
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
        WHERE e.organization_id = current_organization_id()
        ORDER BY e.created_at DESC
        LIMIT $1`,
      [limit],
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/audit-trail?days=7&eventType=X&dealId=Y&limit=100
//
// E7-PR2 (2026-05-27) — admin audit-trail tail with filters. The dashboard's
// `recent-events` widget keeps the old flat-array shape; this endpoint
// returns a structured payload tuned for the admin page:
//   { events[], event_type_catalog[], window_days, limit }
//
// Org-scoped at the APP layer via `e.organization_id = current_organization_id()`
// (added to the WHERE builder + the catalog query below). The pooled DB role
// bypasses RLS, so this explicit filter — not the deal_events RLS policy — is the
// tenant boundary. Operator-only (requirePlatformAdmin) and scoped to the
// operator's OWN org; a platform-wide oversight view would be a separate,
// explicitly platform-scoped endpoint. Read-only.
router.get('/audit-trail', authenticate, requirePlatformAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const days = req.query.days ? Math.min(Math.max(parseInt(req.query.days, 10), 1), 365) : 7;
    const eventType = typeof req.query.eventType === 'string' && req.query.eventType.length > 0
      ? req.query.eventType
      : null;
    const dealId = typeof req.query.dealId === 'string' && req.query.dealId.length > 0
      ? req.query.dealId
      : null;

    const where = [
      // App-layer tenant boundary (the pooled DB role bypasses RLS — #858/#28).
      'e.organization_id = current_organization_id()',
      `e.created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
    ];
    const params = [days];
    let paramCount = 2;
    if (eventType) {
      where.push(`e.event_type = $${paramCount}`);
      params.push(eventType);
      paramCount += 1;
    }
    if (dealId) {
      where.push(`e.deal_id = $${paramCount}::uuid`);
      params.push(dealId);
      paramCount += 1;
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const [rowsResult, catalogResult] = await Promise.all([
      query(
        `SELECT e.id, e.deal_id, e.event_type, e.engine_version, e.asset_class,
                e.created_at, e.metadata,
                d.name AS deal_name,
                u.id   AS actor_id,
                u.name AS actor_name
           FROM deal_events e
           LEFT JOIN deals d ON d.id = e.deal_id
           LEFT JOIN users u ON u.id = e.actor_id
           ${whereSql}
          ORDER BY e.created_at DESC
          LIMIT $${paramCount}`,
        [...params, limit],
      ),
      query(
        `SELECT event_type, COUNT(*)::int AS count
           FROM deal_events
          WHERE organization_id = current_organization_id()
            AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
          GROUP BY event_type
          ORDER BY count DESC, event_type ASC`,
        [days],
      ),
    ]);

    res.json({
      success: true,
      data: {
        events: rowsResult.rows,
        event_type_catalog: catalogResult.rows,
        window_days: days,
        limit,
        filter: { eventType, dealId },
      },
    });
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
// Org-scoped at the APP layer: aiUsage.service's aggregate queries each carry
// `organization_id = current_organization_id()` (the pooled DB role bypasses
// RLS — #858/#28). Reachable by any org admin/analyst, so it MUST be org-scoped,
// not platform-wide. Read-only.
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
// Org-scoped at the APP layer: aiHealth.service filters ai_call_logs by
// `organization_id = current_organization_id()` (the pooled DB role bypasses
// RLS — #858/#28). Read-only.
router.get('/ai-health', authenticate, requirePlatformAdmin, async (req, res, next) => {
  try {
    const snapshot = await aiHealthService.getHealthSnapshot();
    res.json({ success: true, data: snapshot });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/learning-signals?days=30
//
// E7-PR1 (2026-05-27) — admin view of the learning-loop telemetry that
// PR #618's consumer-side aggregator uses to re-rank recommendation cards.
// Returns one composite payload: summary counts (dismissed / snoozed /
// acted, attribution rate, distinct rules), top-10 most-dismissed rules,
// top-10 most-applied rules, the list of currently de-ranked rules
// (multiplier < 1.0 — mirrors the consumer's policy exactly), and a daily
// time-series for the trend chart.
//
// Org-scoped at the APP layer: learningSignals.adminReport's queries each carry
// `organization_id = current_organization_id()` (the pooled DB role bypasses
// RLS — #858/#28). Read-only. Migration-tolerant (returns zeros if the table is
// missing). Operator-only — kept off the customer surface per the AI-disclosure
// policy.
router.get('/learning-signals', authenticate, requirePlatformAdmin, async (req, res, next) => {
  try {
    const days = req.query.days ? parseInt(req.query.days, 10) : 30;
    const data = await learningSignalsAdminReport.getDashboard({ days });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/extraction-quality?days=90
//
// Workstream C — the standing extraction-quality system. Aggregates the
// `extraction_field_verdicts` ledger into a per-(doc_type, canonical field)
// acceptance rate — "which fields does the model get wrong" — measured from
// the real accept/override verdicts operators make when they apply
// AI-extracted fields to a deal. Operator-only (per the AI-disclosure policy
// this stays off the customer surface). Soft-fails to an empty shape if
// 20260611 is unapplied.
//
// Org-scoped via current_organization_id() inside the aggregate query.
router.get('/extraction-quality', authenticate, requirePlatformAdmin, async (req, res, next) => {
  try {
    const days = req.query.days ? parseInt(req.query.days, 10) : 90;
    const data = await extractionVerdictsService.getExtractionAccuracy({ days });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/ai-routing
//
// Returns every row in the ai_routing_config table. Admin/owner-gated.
// Used by the Settings page routing editor + ops debugging.
router.get('/ai-routing', authenticate, requirePlatformAdmin, async (req, res, next) => {
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
router.put('/ai-routing/:task', authenticate, requirePlatformAdmin, async (req, res, next) => {
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
router.get('/ab-eval/runs', authenticate, requirePlatformAdmin, async (req, res, next) => {
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
router.get('/ab-eval/runs/:id', authenticate, requirePlatformAdmin, async (req, res, next) => {
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
//   { task: 'export_insights',
//     candidates: ['claude:claude-sonnet-4-6', 'openai:gpt-5.4-mini'],
//     limit: 10 }
//
// Sync — the request blocks until the eval completes. With the
// 10-fixture default and 2 candidates, expect ~30–40s end-to-end.
// Vercel function timeout is 60s; harness internally caps at 50
// fixtures per run.
router.post('/ab-eval/runs', authenticate, requirePlatformAdmin, async (req, res, next) => {
  try {
    const {
      task = 'export_insights',
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

// ──────────────────────────────────────────────────────────────────────────
// Standing quality monitor — Workstream C3. Promotes the on-demand A/B
// harness into a continuous quality signal: a baseline run scores the
// current production config, and the trend tracks it over time.
// ──────────────────────────────────────────────────────────────────────────

// GET /api/admin/ab-eval/quality-trend?days=90
//
// Aggregates the baseline eval runs (single current-production candidate)
// per AI task over a trailing window into a quality trend: the score
// series, the latest score, the trailing-average baseline, the delta, and
// a regression flag. Soft-fails to an empty shape if ab_eval is unavailable.
router.get('/ab-eval/quality-trend', authenticate, requirePlatformAdmin, async (req, res, next) => {
  try {
    const days = req.query.days ? parseInt(req.query.days, 10) : 90;
    const data = await abEvalPersistence.getQualityTrendByTask({ days });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/ab-eval/baseline
//
// Runs a single-config baseline of the current production reasoning model
// against the fixture set, persists it, and so feeds the standing quality
// trend. Body: { task?, limit? }. Sync — blocks until the run completes
// (~30s for the default 10-fixture slice).
router.post('/ab-eval/baseline', authenticate, requirePlatformAdmin, async (req, res, next) => {
  try {
    const { task = 'export_insights', limit = 10 } = req.body || {};
    const run = await abEvalPersistence.runBaselineAndPersist({
      organizationId: req.user.organization_id,
      triggeredBy: req.user.id,
      task,
      limit,
    });
    return res.json({ success: true, data: run });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
