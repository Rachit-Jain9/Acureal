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
const routingConfigService = require('../services/ai/routingConfig');
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

module.exports = router;
