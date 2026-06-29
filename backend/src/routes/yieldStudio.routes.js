'use strict';

// Yield Studio persistence routes — saved study (per deal) + uploaded parcel
// boundary (per property). Mounted at the bare `/api` prefix (the routes own
// their full nested paths), mirroring risk.routes.js. authenticate on all;
// requireAdminOrAnalyst on mutations.

const express = require('express');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const yieldStudioService = require('../services/yieldStudio.service');
const parcelBoundaryService = require('../services/parcelBoundary.service');

const router = express.Router();

// ── Yield study (per deal) ──────────────────────────────────────────────────

// GET /deals/:dealId/yield-study  → the active study, or null
router.get('/deals/:dealId/yield-study', authenticate, async (req, res, next) => {
  try {
    const study = await yieldStudioService.getByDeal(req.params.dealId);
    return res.json({ success: true, data: study });
  } catch (err) {
    next(err);
  }
});

// PUT /deals/:dealId/yield-study  → replace the active study
router.put('/deals/:dealId/yield-study', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const study = await yieldStudioService.upsertForDeal(req.params.dealId, req.body || {}, req.user.id);
    return res.json({ success: true, data: study });
  } catch (err) {
    next(err);
  }
});

// DELETE /deals/:dealId/yield-study  → soft-delete the active study
router.delete('/deals/:dealId/yield-study', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const deleted = await yieldStudioService.delete(req.params.dealId, req.user.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'No active study to delete' });
    }
    return res.json({ success: true, data: { id: deleted.id } });
  } catch (err) {
    next(err);
  }
});

// ── Parcel boundary (per property) ──────────────────────────────────────────

// GET /properties/:propertyId/boundary  → the active boundary, or null
router.get('/properties/:propertyId/boundary', authenticate, async (req, res, next) => {
  try {
    const boundary = await parcelBoundaryService.getActiveBoundary({ propertyId: req.params.propertyId });
    return res.json({ success: true, data: boundary });
  } catch (err) {
    next(err);
  }
});

// PUT /properties/:propertyId/boundary  → upload/replace the active boundary
router.put('/properties/:propertyId/boundary', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.geometry_geojson || typeof body.geometry_geojson !== 'object') {
      return res.status(400).json({ success: false, message: 'geometry_geojson (object) is required' });
    }
    const boundary = await parcelBoundaryService.uploadBoundary(
      { ...body, property_id: req.params.propertyId },
      req.user.id,
    );
    return res.status(201).json({ success: true, data: boundary });
  } catch (err) {
    next(err);
  }
});

// DELETE /properties/:propertyId/boundary  → soft-delete the active boundary
router.delete('/properties/:propertyId/boundary', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const deleted = await parcelBoundaryService.delete(req.params.propertyId, req.user.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'No active boundary to delete' });
    }
    return res.json({ success: true, data: { id: deleted.id } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
