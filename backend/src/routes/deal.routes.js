const express = require('express');
const { body, query: qv, param, validationResult } = require('express-validator');
const dealService = require('../services/deal.service');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  DEAL_STAGES,
  DEAL_TYPES,
  PROPERTY_TYPES,
  LAND_PRICING_BASES,
  AREA_UNITS,
  normalizePropertyType,
  normalizeAreaUnit,
  normalizeLandPricingBasis,
  ASSET_CLASSES,
  DEAL_STRUCTURES,
} = require('../constants/domain');

const router = express.Router();

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

// GET /deals
router.get(
  '/',
  authenticate,
  [
    qv('stage').optional().isIn(DEAL_STAGES),
    qv('dealType').optional().isIn(DEAL_TYPES),
    qv('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    qv('city').optional().trim(),
    qv('propertyType').optional().customSanitizer(normalizePropertyType).isIn(PROPERTY_TYPES),
    qv('includeArchived').optional().isBoolean().toBoolean(),
    qv('onlyArchived').optional().isBoolean().toBoolean(),
    qv('liveOnly').optional().isBoolean().toBoolean(),
    qv('search').optional().trim(),
    qv('page').optional().isInt({ min: 1 }),
    qv('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const filters = {
        stage: req.query.stage,
        dealType: req.query.dealType,
        assignedTo: req.query.assignedTo,
        city: req.query.city,
        propertyType: req.query.propertyType,
        search: req.query.search,
        priority: req.query.priority,
        includeArchived: req.query.includeArchived,
        onlyArchived: req.query.onlyArchived,
        liveOnly: req.query.liveOnly,
      };
      const pagination = { page: req.query.page, limit: req.query.limit };
      const result = await dealService.getDeals(filters, pagination);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /deals/pipeline
router.get('/pipeline', authenticate, async (req, res, next) => {
  try {
    const pipeline = await dealService.getDealsByStage();
    res.json({ success: true, data: pipeline });
  } catch (error) {
    next(error);
  }
});

// GET /deals/summary
router.get('/summary', authenticate, async (req, res, next) => {
  try {
    const summary = await dealService.getPipelineSummary();
    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
});

// POST /deals
router.post(
  '/',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    body('propertyId').optional({ nullable: true, checkFalsy: true }).isUUID().withMessage('Valid property ID is required'),
    body('name').trim().notEmpty().withMessage('Deal name is required').isLength({ max: 500 }),
    body('dealType').isIn(DEAL_TYPES).withMessage('Invalid deal type'),
    body('stage').optional().isIn(DEAL_STAGES),
    body('assignedTo').optional().isUUID(),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('landAskPriceCr').optional().isFloat({ min: 0 }),
    body('landPricingBasis').optional().customSanitizer(normalizeLandPricingBasis).isIn(LAND_PRICING_BASES),
    body('landPriceRateInr').optional().isFloat({ min: 0 }),
    body('landExtentInputValue').optional().isFloat({ min: 0.01 }),
    body('landExtentInputUnit').optional().customSanitizer(normalizeAreaUnit).isIn(AREA_UNITS),
    body('negotiatedPriceCr').optional().isFloat({ min: 0 }),
    body('targetLaunchDate').optional().isISO8601(),
    body('expectedCloseDate').optional().isISO8601(),
    body('assetClass').optional().isIn(ASSET_CLASSES),
    body('dealStructure').optional().isIn(DEAL_STRUCTURES),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const deal = await dealService.createDeal(req.body, req.user.id);
      res.status(201).json({ success: true, message: 'Deal created.', data: deal });
    } catch (error) {
      next(error);
    }
  }
);

// GET /deals/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const deal = await dealService.getDealById(req.params.id);
    res.json({ success: true, data: deal });
  } catch (error) {
    next(error);
  }
});

// PUT /deals/:id
router.put(
  '/:id',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    body('propertyId').optional({ nullable: true, checkFalsy: true }).isUUID(),
    body('name').optional().trim().notEmpty().isLength({ max: 500 }),
    body('dealType').optional().isIn(DEAL_TYPES),
    body('assignedTo').optional().isUUID(),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('landAskPriceCr').optional().isFloat({ min: 0 }),
    body('landPricingBasis').optional().customSanitizer(normalizeLandPricingBasis).isIn(LAND_PRICING_BASES),
    body('landPriceRateInr').optional().isFloat({ min: 0 }),
    body('landExtentInputValue').optional().isFloat({ min: 0.01 }),
    body('landExtentInputUnit').optional().customSanitizer(normalizeAreaUnit).isIn(AREA_UNITS),
    body('negotiatedPriceCr').optional().isFloat({ min: 0 }),
    body('assetClass').optional().isIn(ASSET_CLASSES),
    body('dealStructure').optional().isIn(DEAL_STRUCTURES),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const deal = await dealService.updateDeal(req.params.id, req.body);
      res.json({ success: true, message: 'Deal updated.', data: deal });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /deals/:id/stage
router.patch(
  '/:id/stage',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    body('stage').isIn(DEAL_STAGES).withMessage('Invalid stage'),
    body('notes').optional().trim(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const deal = await dealService.transitionStage(
        req.params.id,
        req.body.stage,
        req.user.id,
        req.body.notes
      );
      res.json({ success: true, message: `Deal moved to ${req.body.stage}.`, data: deal });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /deals/:id/archive
router.patch('/:id/archive', authenticate, requireRole('admin', 'analyst'), [
  body('reason').optional().trim(),
], handleValidation, async (req, res, next) => {
  try {
    const deal = await dealService.archiveDeal(req.params.id, req.user.id, req.body.reason);
    res.json({ success: true, message: 'Deal archived.', data: deal });
  } catch (error) {
    next(error);
  }
});

// PATCH /deals/:id/restore
router.patch('/:id/restore', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const deal = await dealService.restoreDeal(req.params.id);
    res.json({ success: true, message: 'Deal restored.', data: deal });
  } catch (error) {
    next(error);
  }
});

// DELETE /deals/:id
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await dealService.deleteDeal(req.params.id);
    res.json({ success: true, message: 'Deal deleted.', data: result });
  } catch (error) {
    next(error);
  }
});

// GET /deals/:id/readiness
router.get('/:id/readiness', authenticate, async (req, res, next) => {
  try {
    const deal = await dealService.getDealById(req.params.id);
    res.json({
      success: true,
      data: {
        readiness_summary: deal.readiness_summary,
        next_steps: deal.next_steps,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
