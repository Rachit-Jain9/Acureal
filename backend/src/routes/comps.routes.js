const express = require('express');
const { body, param, query: qv } = require('express-validator');
const compsService = require('../services/comps.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

// GET /comps
router.get(
  '/',
  authenticate,
  [
    qv('city').optional().trim(),
    qv('locality').optional().trim(),
    qv('projectType').optional().isIn(['residential', 'commercial', 'mixed_use']),
    qv('minRate').optional().isFloat({ min: 0 }),
    qv('maxRate').optional().isFloat({ min: 0 }),
    qv('launchYear').optional().isInt({ min: 2000, max: 2050 }),
    qv('search').optional().trim(),
    qv('page').optional().isInt({ min: 1 }),
    qv('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const filters = {
        city: req.query.city,
        locality: req.query.locality,
        projectType: req.query.projectType,
        minRate: req.query.minRate,
        maxRate: req.query.maxRate,
        launchYear: req.query.launchYear,
        search: req.query.search,
      };
      const pagination = { page: req.query.page, limit: req.query.limit };
      const result = await compsService.getComps(filters, pagination);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /comps/nearby
router.get(
  '/nearby',
  authenticate,
  [
    qv('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    qv('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
    qv('radius').optional().isFloat({ min: 0.1, max: 100 }),
    qv('projectType').optional().isIn(['residential', 'commercial', 'mixed_use']),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const comps = await compsService.getCompsNearLocation(
        parseFloat(req.query.lat),
        parseFloat(req.query.lng),
        parseFloat(req.query.radius) || 5,
        req.query.projectType
      );
      res.json({ success: true, data: comps });
    } catch (error) {
      next(error);
    }
  }
);

// GET /comps/benchmarks
router.get(
  '/benchmarks',
  authenticate,
  [
    qv('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    qv('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
    qv('projectType').optional().isIn(['residential', 'commercial', 'mixed_use']),
    qv('radius').optional().isFloat({ min: 0.1, max: 100 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const benchmarks = await compsService.getPricingBenchmarks(
        parseFloat(req.query.lat),
        parseFloat(req.query.lng),
        req.query.projectType || 'residential',
        parseFloat(req.query.radius) || 5
      );
      res.json({ success: true, data: benchmarks });
    } catch (error) {
      next(error);
    }
  }
);

// POST /comps
router.post(
  '/',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    body('projectName').trim().notEmpty().withMessage('Project name is required').isLength({ max: 500 }),
    body('city').trim().notEmpty().withMessage('City is required'),
    body('ratePerSqft').isFloat({ min: 1 }).withMessage('Rate per sqft must be positive'),
    body('developer').optional().trim(),
    body('locality').optional().trim(),
    body('projectType').optional().isIn(['residential', 'commercial', 'mixed_use']),
    body('lat').optional().isFloat({ min: -90, max: 90 }),
    body('lng').optional().isFloat({ min: -180, max: 180 }),
    body('carpetAreaSqft').optional().isFloat({ min: 0 }),
    body('superBuiltupAreaSqft').optional().isFloat({ min: 0 }),
    body('totalUnits').optional().isInt({ min: 0 }),
    body('launchYear').optional().isInt({ min: 2000, max: 2050 }),
    body('possessionYear').optional().isInt({ min: 2000, max: 2060 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const comp = await compsService.addComp(req.body, req.user.id);
      res.status(201).json({ success: true, message: 'Comparable added.', data: comp });
    } catch (error) {
      next(error);
    }
  }
);

// GET /comps/ranked/:dealId — top comps for a deal, scored by similarity
router.get(
  '/ranked/:dealId',
  authenticate,
  [
    param('dealId').isUUID(),
    qv('radiusKm').optional().isFloat({ min: 0.5, max: 50 }),
    qv('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await compsService.getRankedCompsForDeal(req.params.dealId, {
        radiusKm: req.query.radiusKm ? parseFloat(req.query.radiusKm) : 8,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : 25,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /comps/score/:dealId/:compId — single subject-vs-comp delta + factors
router.get(
  '/score/:dealId/:compId',
  authenticate,
  [param('dealId').isUUID(), param('compId').isUUID()],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await compsService.scoreSubjectAgainstComp(req.params.dealId, req.params.compId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /comps/:id
router.delete('/:id', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const result = await compsService.deleteComp(req.params.id);
    res.json({ success: true, message: 'Comparable deleted.', data: result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
