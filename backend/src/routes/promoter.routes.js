'use strict';

const express = require('express');
const { body } = require('express-validator');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');
const promoterProfileService = require('../services/promoterProfile.service');

const router = express.Router();

// GET /deals/:dealId/promoter
//
// Authenticated. The promoter / builder track-record profile plus its
// computed execution posture. Returns
// { profile: null, assessment: { posture: 'unverified', ... } } when nothing
// has been recorded yet — promoter execution stays a first-class unverified
// state, not a silent gap.
router.get('/deals/:dealId/promoter', authenticate, async (req, res, next) => {
  try {
    const data = await promoterProfileService.getProfileWithAssessment(req.params.dealId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// PUT /deals/:dealId/promoter
//
// Authenticated + analyst/admin. Records the promoter track record — a
// full-document upsert (the editor holds every field and submits the whole
// profile). Numeric fields and entity_type are sanitised in the service;
// here we only bound the free-text payload.
router.put(
  '/deals/:dealId/promoter',
  authenticate,
  requireAdminOrAnalyst,
  [
    body('promoter_name').optional({ nullable: true }).isString().isLength({ max: 300 }),
    body('notes').optional({ nullable: true }).isString().isLength({ max: 5000 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const profile = await promoterProfileService.upsertProfile(
        req.params.dealId,
        req.body,
        req.user.id
      );
      const assessment = promoterProfileService.assessPromoter(profile);
      res.json({ success: true, data: { profile, assessment } });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
