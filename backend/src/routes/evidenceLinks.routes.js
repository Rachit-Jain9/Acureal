'use strict';

/**
 * Routes for the polymorphic evidence-link primitive.
 *
 *   GET    /api/evidence-links/:ownerKind/:ownerId        list + summary
 *   POST   /api/evidence-links/:ownerKind/:ownerId        attach
 *   DELETE /api/evidence-links/:linkId                    detach
 *
 * Mounted at `/api` in server.js. Routes share the existing auth + rate
 * limiting middleware.
 */

const express = require('express');
const { body, param } = require('express-validator');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');
const evidenceLinksService = require('../services/evidenceLinks.service');

const router = express.Router();

const ownerKindParam = param('ownerKind').isIn([...evidenceLinksService.OWNER_KINDS]);
const uuidParam = (name) => param(name).isUUID();
const uuidBody  = (name) => body(name).optional({ nullable: true }).isUUID();

router.get(
  '/evidence-links/:ownerKind/:ownerId',
  authenticate,
  ownerKindParam,
  uuidParam('ownerId'),
  handleValidation,
  async (req, res, next) => {
    try {
      const [links, summary] = await Promise.all([
        evidenceLinksService.listForOwner(req.params.ownerKind, req.params.ownerId),
        evidenceLinksService.summariseForOwner(req.params.ownerKind, req.params.ownerId),
      ]);
      res.json({ success: true, data: { links, summary } });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/evidence-links/:ownerKind/:ownerId',
  authenticate,
  requireAdminOrAnalyst,
  ownerKindParam,
  uuidParam('ownerId'),
  body('linkKind').isIn([...evidenceLinksService.LINK_KINDS]),
  uuidBody('evidenceSourceId'),
  uuidBody('evidenceFactId'),
  uuidBody('documentId'),
  body('externalUrl').optional({ nullable: true }).isURL({ require_protocol: true }).isLength({ max: 2000 }),
  body('confidenceScore').optional({ nullable: true }).isFloat({ min: 0, max: 1 }),
  body('notes').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  body('pageNumber').optional({ nullable: true }).isInt({ min: 1 }),
  body('sourceSection').optional({ nullable: true }).isString().isLength({ max: 500 }),
  handleValidation,
  async (req, res, next) => {
    try {
      const link = await evidenceLinksService.attachLink({
        ownerKind: req.params.ownerKind,
        ownerId: req.params.ownerId,
        linkKind: req.body.linkKind,
        evidenceSourceId: req.body.evidenceSourceId || null,
        evidenceFactId: req.body.evidenceFactId || null,
        documentId: req.body.documentId || null,
        externalUrl: req.body.externalUrl || null,
        confidenceScore: req.body.confidenceScore ?? null,
        notes: req.body.notes || null,
        pageNumber: req.body.pageNumber ?? null,
        sourceSection: req.body.sourceSection || null,
        userId: req.user?.id || null,
      });
      res.status(201).json({ success: true, data: link });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/evidence-links/:linkId',
  authenticate,
  requireAdminOrAnalyst,
  uuidParam('linkId'),
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await evidenceLinksService.detachLink(req.params.linkId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
