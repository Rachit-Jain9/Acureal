'use strict';

const express = require('express');
const { body, query: vquery } = require('express-validator');
const waterfallService = require('../services/waterfall.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

const jdaValidation = [
  body('totalRevenueCr').isFloat({ min: 0 }),
  body('totalConstructionCostCr').optional().isFloat({ min: 0 }),
  body('approvalCostCr').optional().isFloat({ min: 0 }),
  body('marketingCostCr').optional().isFloat({ min: 0 }),
  body('financeCostCr').optional().isFloat({ min: 0 }),
  body('landCostCr').optional().isFloat({ min: 0 }),
  body('landownerSharePct').isFloat({ min: 0, max: 100 }),
  body('structureType').optional().isIn(['area_share', 'revenue_share']),
];

const jvValidation = [
  body('totalRevenueCr').isFloat({ min: 0 }),
  body('totalCostCr').isFloat({ min: 0 }),
  body('landownerEquityCr').isFloat({ min: 0 }),
  body('developerEquityCr').isFloat({ min: 0 }),
  body('preferredReturnPct').optional().isFloat({ min: 0, max: 50 }),
  body('preferredReturnType').optional().isIn(['simple', 'compound']),
  body('holdPeriodYears').optional().isFloat({ min: 0.25, max: 30 }),
  body('developerPromotePct').optional().isFloat({ min: 0, max: 100 }),
  body('promoteThresholdMultiple').optional().isFloat({ min: 1, max: 10 }),
  body('useCatchUp').optional().isBoolean(),
];

const debtValidation = [
  body('debtDrawnCr').isFloat({ min: 0 }),
  body('debtRatePct').isFloat({ min: 0, max: 30 }),
  body('projectDurationMonths').isInt({ min: 1, max: 360 }),
  body('constructionStartMonths').optional().isInt({ min: 0, max: 360 }),
  body('constructionEndMonths').optional().isInt({ min: 1, max: 360 }),
];

// POST /api/waterfall/:dealId/jda
router.post(
  '/:dealId/jda',
  authenticate,
  requireRole('admin', 'analyst'),
  jdaValidation,
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await waterfallService.calculateAndSaveJDA(req.params.dealId, req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/waterfall/:dealId/jv
router.post(
  '/:dealId/jv',
  authenticate,
  requireRole('admin', 'analyst'),
  jvValidation,
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await waterfallService.calculateAndSaveJV(req.params.dealId, req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/waterfall/debt-schedule — stateless, no dealId required
router.post(
  '/debt-schedule',
  authenticate,
  debtValidation,
  handleValidation,
  async (req, res, next) => {
    try {
      const result = waterfallService.calculateDebtSchedule(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/waterfall/:dealId?kind=jda|jv
router.get(
  '/:dealId',
  authenticate,
  [vquery('kind').optional().isIn(['jda', 'jv'])],
  handleValidation,
  async (req, res, next) => {
    try {
      const rows = await waterfallService.getWaterfall(req.params.dealId, req.query.kind);
      res.json({ success: true, data: rows });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
