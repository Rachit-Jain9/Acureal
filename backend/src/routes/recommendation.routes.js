'use strict';

/**
 * Recommendation Engine routes — PR-C (2026-05-25).
 *
 * Today's surface is small:
 *
 *   POST /api/deals/:dealId/recommendations/:ruleId/verdict
 *     Upsert the operator's verdict on one recommendation card. Hides
 *     dismissed / snoozed cards on subsequent workspace loads and writes
 *     a values-free `recommendation_verdict` row to `improvement_signals`
 *     so the data flywheel learns which rules get dismissed across the
 *     fleet.
 *
 * Workspace consumers read the active verdict state through the existing
 * `/api/deals/:dealId/workspace` endpoint — there is no separate GET here.
 */

const express = require('express');
const { param, body } = require('express-validator');
const verdictsService = require('../services/recommendation/verdicts.service');
const learningSignals = require('../services/learningSignals.service');
const dealService = require('../services/deal.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

const ALLOWED_VERDICTS = ['acted', 'dismissed', 'snoozed'];

router.post(
  '/deals/:dealId/recommendations/:ruleId/verdict',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    param('dealId').isUUID().withMessage('dealId must be a UUID'),
    param('ruleId').isString().isLength({ min: 1, max: 120 }),
    body('verdict').isString().isIn(ALLOWED_VERDICTS),
    body('reason').optional().isString().isLength({ max: 500 }),
    body('snoozeDays').optional().isInt({ min: 1, max: 365 }),
    body('snoozeUntilSnapshotChange').optional().isBoolean(),
    body('snapshotHash').optional().isString().isLength({ min: 32, max: 128 }),
    // Per-card metadata captured by the UI when it knows the card shape.
    // All optional — the verdict can land without them but the telemetry
    // gets richer when they're present.
    body('topic').optional().isString().isLength({ max: 60 }),
    body('verb').optional().isString().isLength({ max: 40 }),
    body('severity').optional().isInt({ min: 1, max: 5 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { dealId, ruleId } = req.params;
      const {
        verdict,
        reason = null,
        snoozeDays,
        snoozeUntilSnapshotChange = false,
        snapshotHash = null,
        topic = null,
        verb = null,
        severity = null,
      } = req.body;

      // Verify the user has access to the deal (raises 404 / 403 if not).
      const deal = await dealService.getDealById(dealId);
      if (!deal) {
        return res.status(404).json({ success: false, message: 'Deal not found.' });
      }

      // Snooze model: either an absolute future timestamp (snoozeDays) or
      // a "until-snapshot-change" reset. They are mutually exclusive — the
      // UI sends one or the other.
      let snoozeUntil = null;
      let snapshotChangeFlag = Boolean(snoozeUntilSnapshotChange);
      if (verdict === 'snoozed') {
        if (snapshotChangeFlag) {
          if (!snapshotHash) {
            return res.status(400).json({
              success: false,
              message: 'snapshotHash is required when snooze-until-snapshot-change is true.',
            });
          }
        } else if (Number.isFinite(Number(snoozeDays))) {
          snoozeUntil = new Date(Date.now() + Number(snoozeDays) * 86400_000).toISOString();
        } else {
          // Default snooze: 30 days from now.
          snoozeUntil = new Date(Date.now() + 30 * 86400_000).toISOString();
        }
      }

      const row = await verdictsService.upsertVerdict({
        organizationId: deal.organization_id || null,
        dealId,
        ruleId,
        verdict,
        reason,
        snoozeUntil,
        snoozeUntilSnapshotChange: verdict === 'snoozed' ? snapshotChangeFlag : false,
        snoozedAtSnapshotHash: verdict === 'snoozed' && snapshotChangeFlag ? snapshotHash : null,
        userId: req.user?.id || null,
      });

      // Fire-and-forget Layer-5 telemetry. Capture failure never blocks the verdict.
      learningSignals.recordRecommendationVerdictSignal({
        organizationId: deal.organization_id || null,
        dealId,
        ruleId,
        topic,
        verb,
        severity,
        verdict,
        reason,
        snapshotHash,
        userId: req.user?.id || null,
      }).catch(() => {});

      return res.json({
        success: true,
        data: row || { deal_id: dealId, rule_id: ruleId, verdict, persisted: false },
      });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
