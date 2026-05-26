'use strict';

/**
 * Micro-Market Intelligence routes — Phase 1 / Pillar 1.
 *
 * Routes are deal-INDEPENDENT — the briefing for a deal lives on the
 * dealWorkspace endpoint (composed into `workspace.micro_market`). These
 * three endpoints serve the surfaces that exist BEFORE a deal is created:
 *
 *   GET  /api/micro-market/list
 *     List every seeded Bengaluru micro-market. Used by the admin tool +
 *     by the deal-create form's manual-pick dropdown when parcel
 *     coordinates aren't available yet.
 *
 *   POST /api/micro-market/classify
 *     Body: { lat, lng }. Returns the nearest micro-market + confidence.
 *     Used by the deal-create form once the operator has typed an address
 *     (and geocoded it) — pre-fills the deal-structure form's locality
 *     field before any deal row exists.
 *
 *   GET  /api/micro-market/defaults
 *     Query: ?localityCode=...&assetClass=...
 *     Returns the deal-create form's default for the headline metric
 *     (sale rate / rent / cap rate per asset class) — with confidence
 *     + source + last-verified so the UI can render a transparent
 *     "(median for {locality}, {source})" hint.
 */

const express = require('express');
const { body, query: qv } = require('express-validator');
const microMarket = require('../services/microMarketIntelligence.service');
const { authenticate } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

// GET /api/micro-market/list
router.get('/list', authenticate, async (req, res, next) => {
  try {
    const markets = await microMarket.listMicroMarkets();
    res.json({ success: true, data: markets });
  } catch (error) {
    next(error);
  }
});

// POST /api/micro-market/classify
router.post(
  '/classify',
  authenticate,
  [
    body('lat').isFloat({ min: -90, max: 90 }),
    body('lng').isFloat({ min: -180, max: 180 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const classification = await microMarket.classifyParcel(req.body.lat, req.body.lng);
      res.json({ success: true, data: classification });
    } catch (error) {
      next(error);
    }
  },
);

// GET /api/micro-market/defaults
router.get(
  '/defaults',
  authenticate,
  [
    qv('localityCode').isString().isLength({ min: 1, max: 60 }),
    qv('assetClass').isString().isLength({ min: 1, max: 60 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const defaults = await microMarket.getDefaultsForDealCreate(
        req.query.localityCode,
        req.query.assetClass,
      );
      res.json({ success: true, data: defaults });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
