const express = require('express');
const { body, query: qv } = require('express-validator');
const activityService = require('../services/activity.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');
const {
  ACTIVITY_TYPES,
  ACTIVITY_STATUSES,
  ACTIVITY_PRIORITIES,
} = require('../constants/domain');

const router = express.Router();

const activityWriteValidators = [
  body('type').isIn(ACTIVITY_TYPES).withMessage('Invalid activity type'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('activityDate').optional().isISO8601(),
  body('nextFollowUp').optional().isISO8601(),
  body('isImportant').optional().isBoolean(),
  body('status').optional().isIn(ACTIVITY_STATUSES),
  body('priority').optional().isIn(ACTIVITY_PRIORITIES),
];

// GET /activities
router.get(
  '/',
  authenticate,
  [
    qv('dealId').optional().isUUID(),
    qv('type').optional().isIn(ACTIVITY_TYPES),
    qv('status').optional().isIn(ACTIVITY_STATUSES),
    qv('priority').optional().isIn(ACTIVITY_PRIORITIES),
    qv('dateFrom').optional().isISO8601(),
    qv('dateTo').optional().isISO8601(),
    qv('search').optional().trim(),
    qv('page').optional().isInt({ min: 1 }),
    qv('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await activityService.listActivities(
        {
          dealId: req.query.dealId,
          type: req.query.type,
          status: req.query.status,
          priority: req.query.priority,
          performedBy: req.query.performedBy,
          dateFrom: req.query.dateFrom,
          dateTo: req.query.dateTo,
          search: req.query.search,
          isImportant: req.query.isImportant === 'true',
        },
        { page: req.query.page, limit: req.query.limit }
      );
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /activities/recent
router.get('/recent', authenticate, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const activities = await activityService.getRecentActivities(null, limit);
    res.json({ success: true, data: activities });
  } catch (error) {
    next(error);
  }
});

// GET /activities/my
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const activities = await activityService.getRecentActivities(req.user.id, limit);
    res.json({ success: true, data: activities });
  } catch (error) {
    next(error);
  }
});

// GET /activities/:dealId
router.get(
  '/:dealId',
  authenticate,
  [
    qv('type').optional().isIn(ACTIVITY_TYPES),
    qv('status').optional().isIn(ACTIVITY_STATUSES),
    qv('priority').optional().isIn(ACTIVITY_PRIORITIES),
    qv('page').optional().isInt({ min: 1 }),
    qv('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const filters = {
        type: req.query.type,
        status: req.query.status,
        priority: req.query.priority,
        performedBy: req.query.performedBy,
        isImportant: req.query.isImportant === 'true',
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
        search: req.query.search,
      };
      const pagination = { page: req.query.page, limit: req.query.limit };
      const result = await activityService.getActivities(req.params.dealId, filters, pagination);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /activities (dealId in body)
router.post(
  '/',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    body('dealId').isUUID().withMessage('Valid deal ID is required'),
    ...activityWriteValidators,
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const activity = await activityService.logActivity(
        req.body.dealId,
        req.body.type,
        req.body.description,
        req.user.id,
        req.body.activityDate,
        req.body.nextFollowUp,
        req.body.isImportant,
        req.body.status,
        req.body.priority
      );
      res.status(201).json({ success: true, message: 'Activity logged.', data: activity });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /activities/entry/:activityId
router.put(
  '/entry/:activityId',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    body('type').optional().isIn(ACTIVITY_TYPES),
    body('description').optional().trim().notEmpty(),
    body('activityDate').optional().isISO8601(),
    body('nextFollowUp').optional({ nullable: true }).isISO8601(),
    body('isImportant').optional().isBoolean(),
    body('status').optional().isIn(ACTIVITY_STATUSES),
    body('priority').optional().isIn(ACTIVITY_PRIORITIES),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const activity = await activityService.updateActivity(
        req.params.activityId,
        req.body,
        req.user.id,
        req.user.role
      );
      res.json({ success: true, message: 'Activity updated.', data: activity });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /activities/entry/:activityId/status
router.patch(
  '/entry/:activityId/status',
  authenticate,
  requireRole('admin', 'analyst'),
  [body('status').isIn(ACTIVITY_STATUSES)],
  handleValidation,
  async (req, res, next) => {
    try {
      const activity = await activityService.setActivityStatus(
        req.params.activityId,
        req.body.status,
        req.user.id,
        req.user.role
      );
      res.json({ success: true, message: 'Activity status updated.', data: activity });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /activities/entry/:activityId
router.delete('/entry/:activityId', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const result = await activityService.deleteActivity(req.params.activityId, req.user.id, req.user.role);
    res.json({ success: true, message: 'Activity deleted.', data: result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
