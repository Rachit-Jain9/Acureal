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
      const rera = await promoterProfileService.getReraCrossCheck(profile);
      res.json({ success: true, data: { profile, assessment, rera } });
    } catch (error) {
      next(error);
    }
  }
);

// POST /deals/:dealId/promoter/link-rera
//
// Phase 1 / Pillar 6 — confirm a K-RERA promoter as the canonical match
// for this deal's profile. Records who linked it + when + at what trigram
// similarity. The analyst-recorded findings stay sovereign — the link only
// cross-references the public K-RERA index alongside.
//
// Authenticated + analyst/admin. Body: { rera_promoter_name, match_confidence? }.
router.post(
  '/deals/:dealId/promoter/link-rera',
  authenticate,
  requireAdminOrAnalyst,
  [
    body('rera_promoter_name').isString().trim().isLength({ min: 1, max: 300 }),
    body('match_confidence').optional({ nullable: true }).isFloat({ min: 0, max: 1 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const profile = await promoterProfileService.linkReraPromoter(
        req.params.dealId,
        req.body.rera_promoter_name,
        req.user.id,
        req.body.match_confidence ?? null
      );
      const assessment = promoterProfileService.assessPromoter(profile);
      const rera = await promoterProfileService.getReraCrossCheck(profile);
      res.json({ success: true, data: { profile, assessment, rera } });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /deals/:dealId/promoter/link-rera
//
// Clear the K-RERA cross-link. The analyst-recorded findings are
// untouched; only the link metadata is cleared.
router.delete(
  '/deals/:dealId/promoter/link-rera',
  authenticate,
  requireAdminOrAnalyst,
  async (req, res, next) => {
    try {
      const profile = await promoterProfileService.unlinkReraPromoter(req.params.dealId);
      const assessment = promoterProfileService.assessPromoter(profile);
      const rera = await promoterProfileService.getReraCrossCheck(profile);
      res.json({ success: true, data: { profile, assessment, rera } });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
