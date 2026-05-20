'use strict';

const express = require('express');
const { body } = require('express-validator');
const consentService = require('../services/consent.service');
const legalService = require('../services/legal.service');
const { authenticate } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

// GET /api/consent
// Authenticated. Returns the catalogue of consent purposes, the user's
// current { purpose: boolean } state, and their full append-only history.
// The Privacy Centre renders its consent toggles + audit view from this.
router.get('/', authenticate, async (req, res, next) => {
  try {
    const [{ state, available }, history] = await Promise.all([
      consentService.getConsentState(req.user.id),
      consentService.getConsentHistory(req.user.id),
    ]);
    res.json({
      success: true,
      data: {
        purposes: consentService.CONSENT_PURPOSES,
        state,
        available,
        history,
      },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/consent
// Authenticated. Records one or more consent decisions from the Privacy
// Centre. Body: { decisions: { <purpose>: boolean, ... } }. Each decision
// is appended as a new ledger row (a withdrawal is granted = false), so the
// full consent history is preserved.
router.put(
  '/',
  authenticate,
  [
    body('decisions')
      .isObject()
      .withMessage('decisions must be an object of { purpose: boolean }')
      .bail()
      .custom((decisions) => {
        const keys = Object.keys(decisions);
        if (keys.length === 0) {
          throw new Error('decisions must contain at least one purpose.');
        }
        for (const key of keys) {
          if (!consentService.CONSENT_PURPOSES.includes(key)) {
            throw new Error(`Unknown consent purpose: ${key}`);
          }
          if (typeof decisions[key] !== 'boolean') {
            throw new Error(`Consent decision for "${key}" must be true or false.`);
          }
        }
        return true;
      }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      // Tie each decision to the Privacy Policy version currently in force,
      // so an auditor can see exactly which notice the user was shown.
      let policyVersion = null;
      try {
        const privacy = await legalService.getCurrentLegalDocument('privacy_policy');
        policyVersion = privacy ? privacy.version : null;
      } catch {
        // A failed legal-doc lookup must not block a consent change.
        policyVersion = null;
      }

      const recorded = await consentService.recordConsents({
        userId: req.user.id,
        decisions: req.body.decisions,
        policyVersion,
        source: 'privacy_centre',
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      });

      const { state, available } = await consentService.getConsentState(req.user.id);
      res.json({
        success: true,
        data: { recorded, state, available },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
