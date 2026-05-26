'use strict';

/**
 * Capital-Stack Optimizer routes — Phase 2 / Pillar 3 (second half).
 *
 * Routes are deal-INDEPENDENT — the per-deal scoring already lives on the
 * dealWorkspace endpoint (composed into `workspace.capital_stack_optimizer`).
 * The one endpoint here serves a stateless "what would you recommend for a
 * project of this cost / DSCR / asset class?" query — useful for IC-stage
 * sensitivity analysis or sourcing-stage what-if exploration.
 *
 *   POST /api/capital-stack-optimizer/score
 *     Body: { asset_class, total_cost_cr, gross_sales_value_cr?, dscr? }
 *     Returns: { scenarios: [...], inputs, reason }
 */

const express = require('express');
const { body } = require('express-validator');
const optimizer = require('../services/capitalStackOptimizer.service');
const { authenticate } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

router.post(
  '/score',
  authenticate,
  [
    body('asset_class').isString().isLength({ min: 1, max: 60 }),
    body('total_cost_cr').isFloat({ gt: 0 }),
    body('gross_sales_value_cr').optional({ nullable: true }).isFloat({ gt: 0 }),
    body('dscr').optional({ nullable: true }).isFloat({ gt: 0 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      // Shape the inputs as a synthetic financials row so the pure scorer
      // can consume them uniformly with the workspace path.
      const synthFinancials = {
        total_cost_cr: req.body.total_cost_cr,
        total_revenue_cr: req.body.gross_sales_value_cr,
        kpis: { extras: { dscr: req.body.dscr } },
      };
      const out = optimizer.scoreFromFinancials({
        assetClass: req.body.asset_class,
        financials: synthFinancials,
      });
      res.json({ success: true, data: out });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
