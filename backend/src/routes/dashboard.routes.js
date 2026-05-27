const express = require('express');
const dashboardService = require('../services/dashboard.service');
const portfolioRiskRadarService = require('../services/portfolioRiskRadar.service');
const portfolioReadinessService = require('../services/portfolioReadiness.service');
const attentionService = require('../services/attention.service');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /dashboard
router.get('/', authenticate, async (req, res, next) => {
  try {
    const stats = await dashboardService.getDashboardStats(req.user.id);
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

// GET /dashboard/portfolio-risk-radar
//
// Workspace-level rollup of the per-deal Risk Radar. Returns counts of deals
// by posture (flagged / unverified / cleared), open-severity totals across
// the portfolio, per-failure-mode breakdowns, the top-5 deals at risk, and
// the last 5 risk flags raised in the past 7 days. All scoped to the
// caller's organization via RLS; closed / dead / archived deals are excluded.
router.get('/portfolio-risk-radar', authenticate, async (req, res, next) => {
  try {
    const radar = await portfolioRiskRadarService.getPortfolioRiskRadar();
    res.json({ success: true, data: radar });
  } catch (error) {
    next(error);
  }
});

// GET /dashboard/portfolio-readiness
//
// Phase 4 prologue — workspace-level rollup of per-deal IC + RERA readiness.
// Returns: tier counts (IC-ready / Pre-IC / Diligence / Early), portfolio-
// average score, top portfolio-wide blockers (sorted by severity + affected
// count), top-5 IC-ready deals, top-5 needs-attention deals. Pairs with the
// per-deal IC Readiness Pack on the DD tab — this is the same posture
// surfaced at portfolio zoom.
//
// Architecture: single join-heavy SQL query against deals + financials +
// dd_items + approval_items + documents + deal_promoter_profiles. No
// N+1 over the workspace composer. Migration-tolerant.
router.get('/portfolio-readiness', authenticate, async (req, res, next) => {
  try {
    const includeArchived = String(req.query.includeArchived || '').toLowerCase() === 'true';
    const readiness = await portfolioReadinessService.getPortfolioReadiness({ includeArchived });
    res.json({ success: true, data: readiness });
  } catch (error) {
    next(error);
  }
});

// GET /dashboard/attention
//
// Today's Attention — specific item-level signals across the portfolio that
// need action. Five disjoint lists (overdue required DD, approvals expiring
// in 30 days, risk flags raised in the last 7 days, deals with no activity
// in 14+ days, last 10 audit-log entries). Pairs with the Portfolio Risk
// Radar's aggregate counts: the radar says "3 overdue DD items"; this says
// "which 3, and on which deals". Each individual list degrades to empty
// independently on a query failure.
router.get('/attention', authenticate, async (req, res, next) => {
  try {
    const attention = await attentionService.getAttention();
    res.json({ success: true, data: attention });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
