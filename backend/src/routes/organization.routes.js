'use strict';

/**
 * Organization-level settings routes. Mounted at /api/organization.
 *
 * Currently hosts the benchmark-contribution control — Workstream C2, the
 * org-level half of the docs/DATA_GOVERNANCE.md Layer-4 consent gate. An
 * owner/admin decides whether the organisation's de-identified deal data may
 * contribute to the planned anonymized market-benchmark layer.
 *
 * Reads are open to any member (transparency: every member may see the
 * organisation's data-governance posture). Writes are owner/admin-only — the
 * route guard is the gate; org scoping happens at the data layer via RLS.
 */

const express = require('express');
const { body } = require('express-validator');
const organizationConsent = require('../services/organizationConsent.service');
const benchmarkEligibility = require('../services/benchmarkEligibility.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

// Assemble the benchmark-setting payload: the org-level opt-out state, its
// append-only change history, and — for the calling user — whether deals they
// create would currently be eligible to contribute (both gate conditions).
const buildBenchmarkPayload = async (organizationId, userId) => {
  const [{ state, available }, history, yourEligibility] = await Promise.all([
    organizationConsent.getOrgConsentState(organizationId),
    organizationConsent.getOrgConsentHistory(organizationId),
    benchmarkEligibility.evaluateEligibility({ organizationId, userId }),
  ]);
  return {
    opted_out: state.benchmark_opt_out,
    available,
    history,
    your_eligibility: yourEligibility,
  };
};

// GET /api/organization/benchmark-setting
//
// Authenticated — any member may see the organisation's benchmark-contribution
// posture. Returns the org-level opt-out state, its change history, and the
// calling user's own current contribution eligibility.
router.get('/benchmark-setting', authenticate, async (req, res, next) => {
  try {
    const data = await buildBenchmarkPayload(req.user.organization_id, req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// PUT /api/organization/benchmark-setting
//
// Owner/admin only. Engages or releases the org-level "do not benchmark"
// opt-out. Body: { optedOut: boolean }. The decision is appended as a new
// ledger row — the organisation's governance history is preserved, never
// overwritten.
router.put(
  '/benchmark-setting',
  authenticate,
  requireRole('owner', 'admin'),
  [body('optedOut').isBoolean().withMessage('optedOut must be true or false.')],
  handleValidation,
  async (req, res, next) => {
    try {
      const organizationId = req.user.organization_id;
      await organizationConsent.recordOrgConsent({
        organizationId,
        purpose: 'benchmark_opt_out',
        granted: req.body.optedOut === true,
        changedBy: req.user.id,
        source: 'settings',
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      });
      const data = await buildBenchmarkPayload(organizationId, req.user.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
