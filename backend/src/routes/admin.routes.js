'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticate, requireRole } = require('../middleware/auth');
const { query } = require('../config/database');

const router = express.Router();

// POST /api/admin/reset-demo-data — wipe all user-entered business data.
// Requires admin role + an explicit confirmation token in the body to avoid
// accidental invocation. Users, RERA registry, and system seeds are preserved.
router.post(
  '/reset-demo-data',
  authenticate,
  requireRole('admin'),
  [
    body('confirm')
      .equals('RESET-REDIP-DEMO-DATA')
      .withMessage('confirm token must be the literal string RESET-REDIP-DEMO-DATA'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    // Ordered from child → parent to respect FKs. Uses CASCADE via DELETE not
    // TRUNCATE since RLS + replication identity rules prefer row-level deletes.
    const tables = [
      'deal_stage_history',
      'activities',
      'risk_flags',
      'dd_items',
      'approvals',
      'financials',
      'documents',
      'comps',
      'deals',
      'properties',
    ];

    const counts = {};
    try {
      await query('BEGIN');
      for (const table of tables) {
        try {
          const r = await query(`DELETE FROM ${table}`);
          counts[table] = r.rowCount ?? 0;
        } catch (err) {
          // Non-existent table — record and continue; don't abort the reset.
          counts[table] = { skipped: true, error: err.message };
        }
      }
      await query('COMMIT');
    } catch (err) {
      await query('ROLLBACK').catch(() => {});
      return next(err);
    }

    return res.json({
      success: true,
      message: 'All deal / property / document / DD data erased. Users and RERA registry preserved.',
      deleted: counts,
    });
  }
);

module.exports = router;
