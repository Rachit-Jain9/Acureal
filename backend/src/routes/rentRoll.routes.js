'use strict';

// Deal Registers routes — the per-deal rent roll / sales & collections /
// hotel operating / occupant registers. Mounted at the bare `/api` prefix
// (routes own their full nested paths), mirroring yieldStudio.routes.js.
// authenticate on all; requireAdminOrAnalyst on mutations. Logic lives in
// services/rentRoll.service.js — handlers stay thin.

const express = require('express');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const rentRollService = require('../services/rentRoll.service');
const rentRollTemplate = require('../services/rentRollTemplate.service');
const rentRollImport = require('../services/rentRollImport.service');
const rentRollExtract = require('../services/rentRollExtract.service');

const { exportAudit } = require('../middleware/exportAudit');

const router = express.Router();

// Attachment responses here (the register-template XLSX download) land in the
// export_events audit ledger, same as everything under /api/exports.
router.use(exportAudit);

const decodeUpload = (body) => {
  const fileBase64 = body && body.fileBase64;
  if (!fileBase64 || typeof fileBase64 !== 'string') return null;
  // Tolerate a data-URI prefix if the client sends one.
  const b64 = fileBase64.includes(',') ? fileBase64.slice(fileBase64.indexOf(',') + 1) : fileBase64;
  return Buffer.from(b64, 'base64');
};

// GET /deals/:dealId/rent-roll/template → a schema-correct blank XLSX to fill
// offline, adapted to the deal's register family. Available before any register
// exists (resolves the family from the deal's asset class).
router.get('/deals/:dealId/rent-roll/template', authenticate, async (req, res, next) => {
  try {
    const { dealName, family } = await rentRollService.getDealRegisterInfo(req.params.dealId);
    const buffer = await rentRollTemplate.buildTemplateWorkbook(family, { dealName });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${rentRollTemplate.templateFileName(family, dealName)}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// GET /deals/:dealId/rent-roll → register + all live records (register: null = empty state)
router.get('/deals/:dealId/rent-roll', authenticate, async (req, res, next) => {
  try {
    const data = await rentRollService.getRegister(req.params.dealId);
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// POST /deals/:dealId/rent-roll/import/preview → parse a filled template into a
// STAGED preview (no writes). Body: { fileBase64 }. Family is checked against
// the deal so a wrong-type template is rejected with a readable reason.
router.post('/deals/:dealId/rent-roll/import/preview', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const buffer = decodeUpload(req.body);
    if (!buffer) return res.status(400).json({ success: false, message: 'fileBase64 is required' });
    const { family } = await rentRollService.getDealRegisterInfo(req.params.dealId);
    const preview = await rentRollImport.parseTemplateBuffer(buffer, { expectedFamily: family });
    return res.json({ success: true, data: preview });
  } catch (err) {
    next(err);
  }
});

// POST /deals/:dealId/rent-roll/import/commit → re-parse (authoritative) + write.
router.post('/deals/:dealId/rent-roll/import/commit', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const buffer = decodeUpload(req.body);
    if (!buffer) return res.status(400).json({ success: false, message: 'fileBase64 is required' });
    const { family } = await rentRollService.getDealRegisterInfo(req.params.dealId);
    const result = await rentRollImport.commitImport(req.params.dealId, buffer, { expectedFamily: family, userId: req.user.id });
    return res.status(201).json({ success: true, data: result, message: `Imported ${result.total} record(s)` });
  } catch (err) {
    next(err);
  }
});

// POST /deals/:dealId/rent-roll/extract/preview → read an already-uploaded
// register document with AI into a STAGED preview (no writes). Body:
// { documentId }. Reuses the metered/audited extraction pipeline; every field
// is re-validated against the column catalog before it can be reviewed.
router.post('/deals/:dealId/rent-roll/extract/preview', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { documentId } = req.body || {};
    if (!documentId) return res.status(400).json({ success: false, message: 'documentId is required' });
    const preview = await rentRollExtract.stagePreview(req.params.dealId, documentId, req.user.id);
    return res.json({ success: true, data: preview });
  } catch (err) {
    next(err);
  }
});

// POST /deals/:dealId/rent-roll/extract/commit → re-read the persisted
// extraction server-side (authoritative) + write the rows as unverified,
// provenance-tagged records. Body: { extractionId }.
router.post('/deals/:dealId/rent-roll/extract/commit', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { extractionId } = req.body || {};
    if (!extractionId) return res.status(400).json({ success: false, message: 'extractionId is required' });
    const result = await rentRollExtract.commitFromExtraction(req.params.dealId, extractionId, req.user.id);
    return res.status(201).json({ success: true, data: result, message: `Imported ${result.total} record(s)` });
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
