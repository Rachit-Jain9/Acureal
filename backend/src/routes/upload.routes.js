const express = require('express');
const documentService = require('../services/document.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { uploadSingle } = require('../middleware/upload');

const router = express.Router();

// POST /upload/:dealId
// Compatibility alias for document upload clients that post directly to /api/upload/:dealId
router.post(
  '/:dealId',
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

module.exports = router;
