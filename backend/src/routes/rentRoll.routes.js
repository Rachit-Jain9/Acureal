'use strict';

// Deal Registers routes — the per-deal rent roll / sales & collections /
// hotel operating / occupant registers. Mounted at the bare `/api` prefix
// (routes own their full nested paths), mirroring yieldStudio.routes.js.
// authenticate on all; requireAdminOrAnalyst on mutations. Logic lives in
// services/rentRoll.service.js — handlers stay thin.

const express = require('express');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const rentRollService = require('../services/rentRoll.service');

const router = express.Router();

// GET /deals/:dealId/rent-roll → register + all live records (register: null = empty state)
router.get('/deals/:dealId/rent-roll', authenticate, async (req, res, next) => {
  try {
    const data = await rentRollService.getRegister(req.params.dealId);
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// PUT /deals/:dealId/rent-roll → register settings (creates the register lazily)
router.put('/deals/:dealId/rent-roll', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const register = await rentRollService.updateSettings(req.params.dealId, req.body || {}, req.user.id);
    return res.json({ success: true, data: register });
  } catch (err) {
    next(err);
  }
});

// POST /deals/:dealId/rent-roll/records → create one record ({ kind, ...fields })
router.post('/deals/:dealId/rent-roll/records', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { kind, ...data } = req.body || {};
    if (!kind) {
      return res.status(400).json({ success: false, message: 'kind is required' });
    }
    const record = await rentRollService.createRecord(req.params.dealId, kind, data, req.user.id);
    return res.status(201).json({ success: true, data: record });
  } catch (err) {
    next(err);
  }
});

// POST /deals/:dealId/rent-roll/records/bulk → bulk insert ({ kind, rows, source? })
router.post('/deals/:dealId/rent-roll/records/bulk', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { kind, rows, source, source_document_id: sourceDocumentId } = req.body || {};
    if (!kind || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'kind and a non-empty rows array are required' });
    }
    const inserted = await rentRollService.bulkUpsertRecords(req.params.dealId, kind, rows, {
      source: source === 'extraction' ? 'extraction' : 'import',
      sourceDocumentId: sourceDocumentId || null,
      userId: req.user.id,
    });
    return res.status(201).json({
      success: true,
      data: inserted,
      message: `Imported ${inserted.length} record(s)`,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /deals/:dealId/rent-roll/records/:kind/:recordId → partial update
router.patch('/deals/:dealId/rent-roll/records/:kind/:recordId', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const record = await rentRollService.updateRecord(
      req.params.dealId, req.params.kind, req.params.recordId, req.body || {}, req.user.id,
    );
    return res.json({ success: true, data: record });
  } catch (err) {
    next(err);
  }
});

// DELETE /deals/:dealId/rent-roll/records/:kind/:recordId → soft delete
router.delete('/deals/:dealId/rent-roll/records/:kind/:recordId', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const deleted = await rentRollService.deleteRecord(
      req.params.dealId, req.params.kind, req.params.recordId, req.user.id,
    );
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Record not found' });
    }
    return res.json({ success: true, data: { id: deleted.id } });
  } catch (err) {
    next(err);
  }
});

// POST /deals/:dealId/rent-roll/snapshots → freeze an immutable snapshot
router.post('/deals/:dealId/rent-roll/snapshots', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { label, trigger } = req.body || {};
    const snapshot = await rentRollService.createSnapshot(
      req.params.dealId,
      { label: label || null, trigger: trigger === 'apply_to_financials' || trigger === 'export' || trigger === 'import' ? trigger : 'manual' },
      req.user.id,
    );
    return res.status(201).json({ success: true, data: snapshot });
  } catch (err) {
    next(err);
  }
});

// GET /deals/:dealId/rent-roll/snapshots → recent snapshots (metadata only)
router.get('/deals/:dealId/rent-roll/snapshots', authenticate, async (req, res, next) => {
  try {
    const snapshots = await rentRollService.listSnapshots(req.params.dealId, req.query.limit);
    return res.json({ success: true, data: snapshots });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
