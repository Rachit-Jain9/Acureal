'use strict';

const express = require('express');
const { body } = require('express-validator');
const dsarService = require('../services/dsar.service');
const { authenticate } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');
const log = require('../lib/logger').child({ module: 'privacy.routes' });

const router = express.Router();

// GET /api/privacy/overview
// Authenticated. The Privacy Centre read model: the personal data REDIP holds
// about the caller — profile, organisation memberships, legal acceptances, and
// an active-session summary. Consent toggles are loaded separately from
// GET /api/consent (the editable surface).
router.get('/overview', authenticate, async (req, res, next) => {
  try {
    const overview = await dsarService.getPrivacyOverview(req.user.id);
    res.json({ success: true, data: overview });
  } catch (error) {
    next(error);
  }
});

// POST /api/privacy/export
// Authenticated + identity-verified. Returns the full machine-readable export
// of the caller's personal data (DPDP §11). Password re-entry is required for
// password accounts so a hijacked session cannot one-click exfiltrate the
// data; OAuth-only accounts are verified by the session itself. Rate-limited
// at the mount (heavyLimiter in server.js).
router.post(
  '/export',
  authenticate,
  [body('password').optional({ nullable: true }).isString()],
  handleValidation,
  async (req, res, next) => {
    try {
      await dsarService.verifyExportIdentity(req.user.id, req.body.password);
      const data = await dsarService.buildDataExport(req.user.id);
      // Record that an export was generated — a self-service §11 access is
      // not an incident, so this is an audit log line, not a security_events
      // row. The request body (which carries the password) is never logged.
      log.info('dsar_export_generated', { user_id: req.user.id });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
