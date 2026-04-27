'use strict';

const express = require('express');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const masterplanService = require('../services/masterplan.service');

const router = express.Router();

// GET /api/master-plan/zones
// Viewers see only approved zones; editors+ can request other statuses.
router.get('/zones', authenticate, async (req, res, next) => {
  try {
    const { search, city, pd, planVersion, limit } = req.query;
    let { status } = req.query;

    const canSeeAllStatuses = ['admin', 'owner', 'editor', 'analyst'].includes(
      String(req.user.role || '').toLowerCase(),
    );
    if (!canSeeAllStatuses) status = 'approved';

    const zones = await masterplanService.searchZones({
      search,
      city,
      pd,
      planVersion,
      status: status || 'approved',
      limit,
    });
    res.json({ success: true, data: zones });
  } catch (err) {
    next(err);
  }
});

// GET /api/master-plan/zones/:id
router.get('/zones/:id', authenticate, async (req, res, next) => {
  try {
    const zone = await masterplanService.getZoneById(req.params.id);
    if (!zone) return res.status(404).json({ success: false, message: 'Zone not found.' });

    const canSeeAllStatuses = ['admin', 'owner', 'editor', 'analyst'].includes(
      String(req.user.role || '').toLowerCase(),
    );
    if (!canSeeAllStatuses && zone.review_status !== 'approved') {
      return res.status(404).json({ success: false, message: 'Zone not found.' });
    }

    let effectiveFsi = null;
    const roadWidth = req.query.roadWidthM !== undefined ? Number(req.query.roadWidthM) : null;
    if (roadWidth !== null && Number.isFinite(roadWidth)) {
      effectiveFsi = masterplanService.calculateEffectiveFSI(zone, roadWidth);
    }

    res.json({ success: true, data: { ...zone, effective_fsi_preview: effectiveFsi } });
  } catch (err) {
    next(err);
  }
});

// GET /api/master-plan/zones/:id/versions  — amendment audit trail
router.get('/zones/:id/versions', authenticate, async (req, res, next) => {
  try {
    const versions = await masterplanService.getZoneVersions(req.params.id);
    res.json({ success: true, data: versions });
  } catch (err) {
    next(err);
  }
});

// POST /api/master-plan/zones  — editor+ only
router.post('/zones', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const zone = await masterplanService.createZone(req.body || {}, req.user.id);
    res.status(201).json({ success: true, data: zone });
  } catch (err) {
    next(err);
  }
});

// PUT /api/master-plan/zones/:id  — editor+ only; logs to zone_versions
router.put('/zones/:id', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { changeReason, ...payload } = req.body || {};
    const zone = await masterplanService.updateZone(req.params.id, payload, req.user.id, {
      changeReason,
    });
    res.json({ success: true, data: zone });
  } catch (err) {
    next(err);
  }
});

// PUT /api/master-plan/zones/:id/review  — approve/reject
router.put('/zones/:id/review', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { status, changeReason } = req.body || {};
    const zone = await masterplanService.reviewZone(req.params.id, {
      status,
      userId: req.user.id,
      changeReason,
    });
    res.json({ success: true, data: zone });
  } catch (err) {
    next(err);
  }
});

// GET /api/master-plan/documents
router.get('/documents', authenticate, async (req, res, next) => {
  try {
    const docs = await masterplanService.listDocuments({ city: req.query.city });
    res.json({ success: true, data: docs });
  } catch (err) {
    next(err);
  }
});

// POST /api/master-plan/documents/upload-url
router.post('/documents/upload-url', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { fileName, fileSize } = req.body || {};
    const data = await masterplanService.getSourceDocumentUploadUrl({
      fileName,
      fileSize,
      organizationId: req.user.organization_id,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// POST /api/master-plan/documents/confirm-upload
router.post('/documents/confirm-upload', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const doc = await masterplanService.confirmSourceDocumentUpload({
      ...(req.body || {}),
      organizationId: req.user.organization_id,
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
});

// GET /api/master-plan/documents/:id/download
router.get('/documents/:id/download', authenticate, async (req, res, next) => {
  try {
    const data = await masterplanService.getSourceDocumentDownload(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// POST /api/master-plan/documents/:id/extract
router.post('/documents/:id/extract', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const data = await masterplanService.extractSourceDocument(req.params.id, {
      docType: req.body?.docType,
      userId: req.user.id,
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// POST /api/master-plan/zones/:id/assign-property
router.post('/zones/:id/assign-property', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const data = await masterplanService.assignReviewedZoneToProperty({
      zoneId: req.params.id,
      propertyId: req.body?.propertyId,
      notes: req.body?.notes,
      userId: req.user.id,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
