'use strict';

/**
 * Deal-Structure Recommender routes — Phase 2 / Pillar 3 (first half).
 *
 * Routes are deal-INDEPENDENT — the per-deal recommendation already lives on
 * the dealWorkspace endpoint (composed into `workspace.deal_structure_recommender`).
 * The one endpoint here serves a stateless "what would you recommend for an
 * asset class + promoter posture?" query — useful for sourcing-stage
 * exploration before a deal record exists.
 *
 *   POST /api/deal-structure-recommender/score
 *     Body: { asset_class, promoter_posture?, micro_market? }
 *     Returns: { scores: [...], reason }
 */

const express = require('express');
const { body } = require('express-validator');
const recommender = require('../services/dealStructureRecommender.service');
const { authenticate } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

router.post(
  '/score',
  authenticate,
  [
    body('asset_class').isString().isLength({ min: 1, max: 60 }),
    body('promoter_posture').optional({ nullable: true }).isIn(['cleared', 'unverified', 'flagged']),
    body('micro_market').optional({ nullable: true }).isObject(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const out = recommender.scoreFromContext({
        assetClass: req.body.asset_class,
        promoterPosture: req.body.promoter_posture || 'unverified',
        microMarket: req.body.micro_market || null,
      });
      res.json({ success: true, data: out });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
