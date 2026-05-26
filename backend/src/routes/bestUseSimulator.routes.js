'use strict';

/**
 * Best Use Simulator routes — Phase 2 / Pillar 2.
 *
 * Routes are deal-INDEPENDENT — the per-deal simulator output already lives
 * on the dealWorkspace endpoint (composed into `workspace.best_use`). The
 * one endpoint here serves parcel-first sourcing flows where the operator
 * has coordinates but hasn't yet created a deal.
 *
 *   POST /api/best-use/simulate
 *     Body: { lat, lng }
 *     Returns: { classification, locality, scores: [...], reason }
 *     Used by the deal-create form's "is this site worth pursuing?"
 *     pre-flight + any standalone parcel inspector page.
 */

const express = require('express');
const { body } = require('express-validator');
const bestUseSimulator = require('../services/bestUseSimulator.service');
const { authenticate } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

// POST /api/best-use/simulate
router.post(
  '/simulate',
  authenticate,
  [
    body('lat').isFloat({ min: -90, max: 90 }),
    body('lng').isFloat({ min: -180, max: 180 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await bestUseSimulator.simulateFromCoordinates(req.body.lat, req.body.lng);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
