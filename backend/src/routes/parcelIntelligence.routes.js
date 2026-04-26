const express = require('express');
const { body, param, query: qv } = require('express-validator');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');
const parcelIntelligenceAdminService = require('../services/parcelIntelligenceAdmin.service');

const router = express.Router();

router.get('/status', authenticate, async (req, res, next) => {
  try {
    const status = await parcelIntelligenceAdminService.getStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
});

router.get(
  '/review-queue',
  authenticate,
  requireAdminOrAnalyst,
  [
    qv('type').optional().isIn(['all', 'evidence_source', 'evidence_fact', 'guidance_value', 'far_rule']),
    qv('status').optional().isIn(['all', 'pending', 'needs_review', 'approved', 'rejected']),
    qv('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const queue = await parcelIntelligenceAdminService.listReviewQueue(req.query);
      res.json({ success: true, data: queue });
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  '/review-queue/:type/:id',
  authenticate,
  requireAdminOrAnalyst,
  [
    param('type').isIn(['evidence_source', 'evidence_fact', 'guidance_value', 'far_rule']),
    param('id').isUUID(),
    body('status').isIn(['pending', 'needs_review', 'approved', 'rejected']),
    body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 4000 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const item = await parcelIntelligenceAdminService.reviewItem({
        type: req.params.type,
        id: req.params.id,
        status: req.body.status,
        notes: req.body.notes,
        userId: req.user.id,
      });
      res.json({ success: true, message: 'Review item updated.', data: item });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/review-queue/evidence_fact/promote-property/batch',
  authenticate,
  requireAdminOrAnalyst,
  [
    body('fact_ids').isArray({ min: 1, max: 80 }),
    body('fact_ids.*').isUUID(),
    body('overwrite').optional().isBoolean(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await parcelIntelligenceAdminService.promoteEvidenceFactsToProperty({
        factIds: req.body.fact_ids,
        userId: req.user.id,
        overwrite: req.body.overwrite === true,
      });
      res.json({ success: true, message: 'Approved evidence facts promoted to property inputs.', data: result });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/review-queue/evidence_fact/:id/promote-property',
  authenticate,
  requireAdminOrAnalyst,
  [
    param('id').isUUID(),
    body('overwrite').optional().isBoolean(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await parcelIntelligenceAdminService.promoteEvidenceFactToProperty({
        factId: req.params.id,
        userId: req.user.id,
        overwrite: req.body.overwrite === true,
      });
      res.json({ success: true, message: 'Evidence fact promoted to property input.', data: result });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
