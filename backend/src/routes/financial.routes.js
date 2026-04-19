const express = require('express');
const { body } = require('express-validator');
const financialService = require('../services/financial.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');
const { FINANCIAL_ASSET_CLASSES } = require('../constants/assetClasses');

const router = express.Router();

const baseValidation = [
  body('assetClass').optional().isIn(FINANCIAL_ASSET_CLASSES).withMessage('Invalid asset class'),
];

const modelValidation = [
  // Land & site
  body('plotAreaSqft').optional().isFloat({ min: 1 }),
  body('fsi').optional().isFloat({ min: 0.1, max: 20 }),
  body('loadingFactor').optional().isFloat({ min: 0, max: 1 }),
  // Construction
  body('constructionCostPerSqft').optional().isFloat({ min: 1 }),
  body('constructionStartMonths').optional().isInt({ min: 0, max: 180 }),
  body('constructionEndMonths').optional().isInt({ min: 1, max: 180 }),
  body('contingencyPct').optional().isFloat({ min: 0, max: 25 }),
  // Soft costs
  body('approvalCostCr').optional().isFloat({ min: 0 }),
  body('approvalCostPerSqft').optional().isFloat({ min: 0 }),
  body('gstPct').optional().isFloat({ min: 0, max: 100 }),
  body('architectFeePct').optional().isFloat({ min: 0, max: 10 }),
  body('pmcFeePct').optional().isFloat({ min: 0, max: 10 }),
  // Revenue & pricing
  body('sellingRatePerSqft').optional().isFloat({ min: 1 }),
  body('landCostCr').optional().isFloat({ min: 0 }),
  body('marketingCostPct').optional().isFloat({ min: 0, max: 100 }),
  body('pricingEscalationPct').optional().isFloat({ min: 0, max: 50 }),
  body('developerMarginPct').optional().isFloat({ min: 0, max: 100 }),
  // Financing & capital stack
  body('financeCostPct').optional().isFloat({ min: 0, max: 100 }),
  body('debtLTV').optional().isFloat({ min: 0, max: 1 }),
  body('avgUnitSizeSqft').optional().isFloat({ min: 100, max: 20000 }),
  body('debtRatePct').optional().isFloat({ min: 0, max: 30 }),
  // Project timeline
  body('projectDurationMonths').optional().isInt({ min: 12, max: 180 }),
  body('discountRatePct').optional().isFloat({ min: 0, max: 100 }),
  // Plotted-specific
  body('totalLandSqft').optional().isFloat({ min: 1 }),
  body('saleableLandPct').optional().isFloat({ min: 10, max: 90 }),
  body('avgPlotSizeSqft').optional().isFloat({ min: 100 }),
  body('sellingRatePerSqyd').optional().isFloat({ min: 1 }),
  body('devCostPerSqft').optional().isFloat({ min: 0 }),
  // Income asset specific
  body('leasableAreaSqft').optional().isFloat({ min: 1 }),
  body('baseRentPerSqftMonth').optional().isFloat({ min: 1 }),
  body('rentEscalationPct').optional().isFloat({ min: 0, max: 30 }),
  body('vacancyPct').optional().isFloat({ min: 0, max: 100 }),
  body('opexPct').optional().isFloat({ min: 0, max: 100 }),
  body('tiPerSqft').optional().isFloat({ min: 0 }),
  body('lcMonths').optional().isFloat({ min: 0, max: 24 }),
  body('entryCapRate').optional().isFloat({ min: 1, max: 30 }),
  body('exitCapRate').optional().isFloat({ min: 1, max: 30 }),
  body('exitStrategy').optional().isIn(['cap_rate_sale', 'lrd', 'forward_purchase']),
  body('holdPeriodYears').optional().isInt({ min: 1, max: 20 }),
  body('debtCoverage').optional().isFloat({ min: 0, max: 1 }),
  body('lrdLTV').optional().isFloat({ min: 0, max: 1 }),
  body('lrdInterestRatePct').optional().isFloat({ min: 0, max: 50 }),
  body('lrdRefinanceYear').optional().isFloat({ min: 1, max: 20 }),
  body('amortizationYears').optional().isFloat({ min: 5, max: 30 }),
  body('forwardPurchasePriceCr').optional().isFloat({ min: 0 }),
  body('interestRatePct').optional().isFloat({ min: 0, max: 50 }),
  body('anchorPct').optional().isFloat({ min: 0, max: 100 }),
  body('anchorRentDiscount').optional().isFloat({ min: 0, max: 80 }),
  // Hospitality-specific
  body('keys').optional().isInt({ min: 1, max: 5000 }),
  body('adr').optional().isFloat({ min: 1 }),
  body('stabilizedOccPct').optional().isFloat({ min: 10, max: 100 }),
  body('constructionCostPerKey').optional().isFloat({ min: 0 }),
  body('preOpeningCostPerKey').optional().isFloat({ min: 0 }),
  body('gopMarginPct').optional().isFloat({ min: 0, max: 100 }),
  body('ebitdaMarginPct').optional().isFloat({ min: 0, max: 100 }),
  body('fbRevPct').optional().isFloat({ min: 0, max: 100 }),
  body('otherRevPct').optional().isFloat({ min: 0, max: 100 }),
  body('adrGrowthPct').optional().isFloat({ min: 0, max: 30 }),
];

// POST /financials/:dealId/calculate
router.post(
  '/:dealId/calculate',
  authenticate,
  requireRole('admin', 'analyst'),
  [...baseValidation, ...modelValidation],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await financialService.calculateAndSave(req.params.dealId, req.body);
      res.status(201).json({ success: true, message: 'Financials calculated and saved.', data: result });
    } catch (error) {
      // Engine validation errors should surface as 422 with the actual message
      if (error.message && !error.code && !error.statusCode) {
        return res.status(422).json({ success: false, message: error.message });
      }
      next(error);
    }
  }
);

// GET /financials/:dealId
router.get('/:dealId', authenticate, async (req, res, next) => {
  try {
    const financials = await financialService.getFinancials(req.params.dealId);
    res.json({ success: true, data: financials });
  } catch (error) {
    next(error);
  }
});

// PUT /financials/:dealId
router.put(
  '/:dealId',
  authenticate,
  requireRole('admin', 'analyst'),
  [...baseValidation, ...modelValidation],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await financialService.updateFinancials(req.params.dealId, req.body);
      res.json({ success: true, message: 'Financials updated.', data: result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /financials/:dealId/sensitivity
router.post('/:dealId/sensitivity', authenticate, async (req, res, next) => {
  try {
    const matrix = await financialService.runSensitivity(req.params.dealId, req.body);
    res.json({ success: true, data: matrix });
  } catch (error) {
    next(error);
  }
});

// GET /financials/:dealId/scenarios — returns base/bull/bear scenario comparison
router.get('/:dealId/scenarios', authenticate, async (req, res, next) => {
  try {
    const scenarios = await financialService.getScenarios(req.params.dealId);
    res.json({ success: true, data: scenarios });
  } catch (error) {
    next(error);
  }
});

// GET /financials/:dealId/export/csv — download financial model as CSV
router.get('/:dealId/export/csv', authenticate, async (req, res, next) => {
  try {
    const csv = await financialService.exportFinancialCSV(req.params.dealId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="financial-model-${req.params.dealId}.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
