const crypto = require('crypto');
const express = require('express');
const { body } = require('express-validator');
const intelligenceService = require('../services/intelligence.service');
const monitoring = require('../services/monitoring.supabase');
const { computeInvestorPackage: invokeKernelHandler } = require('../engines/investorPackage.adapter');
const { authenticate, requireRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

const sha256 = (obj) =>
  crypto.createHash('sha256').update(typeof obj === 'string' ? obj : JSON.stringify(obj)).digest('hex');

router.get('/daily-brief', authenticate, async (req, res, next) => {
  try {
    const brief = await intelligenceService.getDailyBrief(req.user.id, req.query.date);
    res.json({ success: true, data: brief });
  } catch (error) {
    next(error);
  }
});

router.post('/daily-brief', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const brief = await intelligenceService.getDailyBrief(req.user.id, req.body?.date || req.query.date);
    res.json({ success: true, data: brief });
  } catch (error) {
    next(error);
  }
});

// GET /intelligence/market-notes — returns all three sections
router.get('/market-notes', authenticate, async (req, res, next) => {
  try {
    const notes = await intelligenceService.getMarketNotes();
    res.json({ success: true, data: notes });
  } catch (error) {
    next(error);
  }
});

// PUT /intelligence/market-notes — admin only, saves one section at a time
router.put(
  '/market-notes',
  authenticate,
  requireRole('admin'),
  [
    body('section').isIn(['micro_market', 'slowdown', 'strategic']).withMessage('Invalid section'),
    body('items').isArray().withMessage('items must be an array'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const saved = await intelligenceService.saveMarketNotes(
        req.body.section,
        req.body.items,
        req.user.id
      );
      res.json({ success: true, message: 'Market notes saved.', data: saved });
    } catch (error) {
      next(error);
    }
  }
);

// GET /intelligence/market-transactions
router.get('/market-transactions', authenticate, async (req, res, next) => {
  try {
    const data = await intelligenceService.getMarketTransactions({
      city:     req.query.city,
      fy:       req.query.fy,
      quarter:  req.query.quarter,
      dealType: req.query.dealType,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /intelligence/micro-market-benchmarks
router.get('/micro-market-benchmarks', authenticate, async (req, res, next) => {
  try {
    const data = await intelligenceService.getMicroMarketBenchmarks({ city: req.query.city });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// POST /intelligence/deal-analysis/:dealId — Claude-powered deal memo
router.post('/deal-analysis/:dealId', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const result = await intelligenceService.getDealAnalysis(req.params.dealId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /intelligence/investor-package
 *
 * Thin adapter over the kernel's pure HTTP handler. Body is a full
 * `OrchestrationInput` (dealId, totalMonths, facilities, cfadsInputs,
 * waterfall, intelligence). Response mirrors the handler envelope:
 *   { package, engineVersion, flagState, reason? }
 *
 * Every call persists its cohort decision, monitoring event, and
 * (for v2 cohorts) a package snapshot — fire-and-forget so a Supabase
 * outage does not break the compute path.
 */
router.post(
  '/investor-package',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    const organizationId = req.organization?.id || req.user?.organization_id || null;
    const input = req.body || {};
    const dealId = typeof input.dealId === 'string' ? input.dealId : null;
    try {
      const result = await invokeKernelHandler(input, process.env);
      const { status, body } = result;

      if (dealId && body && typeof body === 'object' && 'flagState' in body) {
        monitoring.upsertCohortDecision({
          subjectId: dealId,
          cohort: body.engineVersion || 'v1-legacy',
          rolloutPct: body.flagState?.rolloutPct ?? 0,
          killSwitch: Boolean(body.flagState?.killSwitch),
          engineVersion: body.engineVersion || null,
          reason: body.reason || 'kernel_decision',
          payload: { source: 'backend-route' },
        }).catch(() => {});
      }

      if (status >= 200 && status < 300 && body?.package && dealId) {
        monitoring.persistInvestorPackageSnapshot({
          organizationId,
          dealId,
          engineVersion: body.engineVersion || 'v2-ts',
          source: 'backend',
          inputHash: sha256(input),
          body: body.package,
        }).catch(() => {});
      }

      monitoring.recordMonitoringEvent({
        organizationId,
        dealId,
        source: 'backend',
        event: status < 300 ? 'investor_package_ok' : 'investor_package_error',
        severity: status < 300 ? 'info' : status >= 500 ? 'high' : 'medium',
        engineVersion: body?.engineVersion || null,
        payload: {
          status,
          hasPackage: Boolean(body?.package),
          reason: body?.reason,
        },
      }).catch(() => {});

      res.status(status).json({ success: status < 400, data: body });
    } catch (error) {
      monitoring.recordMonitoringEvent({
        organizationId,
        dealId,
        source: 'backend',
        event: 'investor_package_exception',
        severity: 'critical',
        payload: { message: error.message },
      }).catch(() => {});
      next(error);
    }
  }
);

module.exports = router;
