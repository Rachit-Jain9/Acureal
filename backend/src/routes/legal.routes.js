'use strict';

const express = require('express');
const { param, body } = require('express-validator');
const legalService = require('../services/legal.service');
const { authenticate, verifyAccessToken } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

const summarizeDocument = (doc) =>
  doc
    ? {
        id: doc.id,
        kind: doc.kind,
        version: doc.version,
        effective_at: doc.effective_at,
        content_sha256: doc.content_sha256,
      }
    : null;

// GET /api/legal/active
// Public. Returns the current published version (metadata + body) for each
// signup-relevant kind. The signup form pulls version strings from here and
// echoes them back on submit.
router.get('/active', async (req, res, next) => {
  try {
    const docs = await legalService.getCurrentLegalDocuments();
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      success: true,
      data: docs,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/legal/:kind/:version
// Public. Returns a specific version (allows linking to historical versions
// from a user's acceptance log).
router.get(
  '/:kind/:version',
  [
    param('kind').isIn(legalService.SUPPORTED_KINDS).withMessage('Unknown kind'),
    param('version').isString().trim().notEmpty().isLength({ max: 64 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const doc = await legalService.getLegalDocumentByVersion(req.params.kind, req.params.version);
      if (!doc) {
        return res.status(404).json({ success: false, message: 'Legal document not found.' });
      }
      // Only the current version is publicly readable; older versions require auth.
      // Only the current version is publicly readable; archived versions
      // require a VALID session — verify the JWT, don't just check that an
      // Authorization header is present.
      if (!doc.is_current && !verifyAccessToken(req)) {
        return res
          .status(401)
          .json({ success: false, message: 'Authentication required for archived versions.' });
      }
      res.set('Cache-Control', doc.is_current ? 'public, max-age=300' : 'private, max-age=60');
      res.json({ success: true, data: doc });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/legal/me
// Authenticated. Returns the user's acceptance log + which current docs they
// are missing acceptance on. Frontend uses this to render a re-acceptance
// modal in Phase 2 work.
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const [acceptances, current] = await Promise.all([
      legalService.getUserAcceptances(req.user.id),
      legalService.getCurrentLegalDocuments(),
    ]);
    const acceptedDocIds = new Set(acceptances.map((a) => a.document_id));
    const pending = Object.values(current)
      .filter((doc) => doc && !acceptedDocIds.has(doc.id))
      .map(summarizeDocument);
    res.json({
      success: true,
      data: {
        acceptances,
        pending,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/legal/me/accept
// Authenticated. Records acceptance of one or more documents (by ID).
// Idempotent.
router.post(
  '/me/accept',
  authenticate,
  [
    body('documentIds')
      .isArray({ min: 1, max: 10 })
      .withMessage('documentIds must be a non-empty array (max 10)'),
    body('documentIds.*').isInt({ min: 1 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      await legalService.recordAcceptance({
        userId: req.user.id,
        documentIds: req.body.documentIds.map((n) => Number(n)),
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      });
      res.status(201).json({ success: true, message: 'Acceptance recorded.' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
