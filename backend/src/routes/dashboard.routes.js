const express = require('express');
const dashboardService = require('../services/dashboard.service');
const portfolioRiskRadarService = require('../services/portfolioRiskRadar.service');
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

module.exports = router;
