const express = require('express');
const { body, query: qv, validationResult } = require('express-validator');
const documentService = require('../services/document.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { uploadSingle } = require('../middleware/upload');

const router = express.Router();

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

// GET /documents/deals/options
router.get('/deals/options', authenticate, async (req, res, next) => {
  try {
    const deals = await documentService.getDocumentDealOptions();
    res.json({ success: true, data: deals });
  } catch (error) {
    next(error);
  }
});

// GET /documents/:dealId
router.get(
  '/:dealId',
  authenticate,
  [qv('category').optional().isIn(['om', 'financials', 'legal', 'technical', 'approvals', 'other'])],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await documentService.getDocuments(req.params.dealId, req.query.category);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /documents/:dealId/upload
router.post(
  '/:dealId/upload',
  authenticate,
  requireRole('admin', 'analyst'),
  uploadSingle('file'),
  async (req, res, next) => {
    try {
      const doc = await documentService.uploadDocument(
        req.params.dealId,
        req.file,
        req.body.category || 'other',
        req.user.id,
        req.body.description
      );
      res.status(201).json({ success: true, message: 'Document uploaded.', data: doc });
    } catch (error) {
      next(error);
    }
  }
);

// GET /documents/:dealId/download/:documentId
router.get('/:dealId/download/:documentId', authenticate, async (req, res, next) => {
  try {
    const result = await documentService.getSignedUrl(req.params.documentId, req.params.dealId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// GET /documents/:dealId/download/:documentId/file
router.get('/:dealId/download/:documentId/file', authenticate, async (req, res, next) => {
  try {
    await documentService.streamDownload(req.params.documentId, res, req.params.dealId);
  } catch (error) {
    next(error);
  }
});

// DELETE /documents/:dealId/:documentId
router.delete(
  '/:dealId/:documentId',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const result = await documentService.deleteDocument(req.params.documentId, req.user.id);
      res.json({ success: true, message: 'Document deleted.', data: result });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
