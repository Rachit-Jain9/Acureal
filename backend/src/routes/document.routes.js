const express = require('express');
const { query: qv } = require('express-validator');
const documentService = require('../services/document.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');
const { uploadSingle } = require('../middleware/upload');

const router = express.Router();

// Forensics threaded into the document-access audit log (document_access_log)
// on every download. `trust proxy` is set in server.js, so req.ip is the real
// client IP behind Vercel's proxy.
const accessContextFrom = (req) => ({
  userId: req.user?.id || null,
  organizationId: req.user?.organization_id || null,
  ip: req.ip || null,
  userAgent: req.get('user-agent') || null,
});

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

// POST /documents/:dealId/upload  (legacy: through-server, subject to Vercel 4.5 MB limit)
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
        req.body.description,
        req.user.organization_id
      );
      res.status(201).json({ success: true, message: 'Document uploaded.', data: doc });
    } catch (error) {
      next(error);
    }
  }
);

// POST /documents/:dealId/upload-url  (step 1: get presigned URL for direct-to-Supabase upload)
router.post(
  '/:dealId/upload-url',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const { fileName, fileSize } = req.body;
      if (!fileName) {
        return res.status(400).json({ success: false, message: 'fileName is required.' });
      }
      const result = await documentService.getPresignedUploadUrl(
        req.params.dealId,
        fileName,
        fileSize || 0,
        req.user.id,
        req.user.organization_id
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /documents/:dealId/confirm-upload  (step 2: save metadata after direct upload)
router.post(
  '/:dealId/confirm-upload',
  authenticate,
  requireRole('admin', 'analyst'),
  async (req, res, next) => {
    try {
      const { storagePath, originalName, fileType, fileSize, category, description } = req.body;
      const doc = await documentService.confirmDirectUpload(
        req.params.dealId,
        storagePath,
        originalName,
        fileType,
        fileSize,
        category || 'other',
        description,
        req.user.id,
        req.user.organization_id
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
    const result = await documentService.getSignedUrl(
      req.params.documentId,
      req.params.dealId,
      accessContextFrom(req),
    );
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// GET /documents/:dealId/download/:documentId/file
router.get('/:dealId/download/:documentId/file', authenticate, async (req, res, next) => {
  try {
    await documentService.streamDownload(
      req.params.documentId,
      res,
      req.params.dealId,
      accessContextFrom(req),
    );
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
      const result = await documentService.deleteDocument(req.params.documentId, req.user.id, req.params.dealId);
      res.json({ success: true, message: 'Document deleted.', data: result });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
