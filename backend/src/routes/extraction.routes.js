'use strict';

const express = require('express');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const extractionService = require('../services/extraction.service');
const dealService = require('../services/deal.service');
const { generateDocumentInsights } = require('../services/export.insights.service');
const { query } = require('../config/database');
const { getProviderAvailability } = require('../services/ai/providerRegistry');

const router = express.Router();

// POST /documents/:documentId/extract
router.post('/documents/:documentId/extract', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { documentId } = req.params;

    const docResult = await query(
      `SELECT
          doc.id,
          doc.deal_id,
          doc.file_url,
          doc.name AS file_name,
          doc.file_type AS mime_type,
          d.name AS deal_name,
          p.name AS property_name,
          p.address AS property_address,
          p.city,
          p.state,
          p.pincode,
          p.survey_number,
          p.pid,
          p.khata_no,
          p.bhoomi_id,
          p.land_area_sqft,
          p.road_width_mtrs
       FROM documents doc
       LEFT JOIN deals d ON d.id = doc.deal_id
       LEFT JOIN properties p ON p.id = d.property_id
       WHERE doc.id = $1
         AND doc.organization_id = current_organization_id()
         AND doc.deleted_at IS NULL`,
      [documentId],
    );

    if (!docResult.rows[0]) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const doc = docResult.rows[0];

    if (!doc.file_url) {
      return res.status(400).json({ success: false, message: 'Document has no file URL' });
    }

    if (!getProviderAvailability().gemini) {
      return res.status(503).json({
        success: false,
        message: 'Document extraction is not configured. Set GEMINI_API_KEY to enable AI extraction.',
      });
    }

    const extraction = await extractionService.extractDocument(
      doc.id,
      doc.file_url,
      doc.file_name,
      doc.mime_type,
      doc.deal_id || null,
      req.user.id,
      {
        docType: req.body?.docType,
        context: {
          deal_name: doc.deal_name,
          property_name: doc.property_name,
          address: doc.property_address,
          city: doc.city,
          state: doc.state,
          pincode: doc.pincode,
          survey_number: doc.survey_number,
          pid: doc.pid,
          khata_no: doc.khata_no,
          bhoomi_id: doc.bhoomi_id,
          land_area_sqft: doc.land_area_sqft,
          road_width_mtrs: doc.road_width_mtrs,
        },
      },
    );

    return res.status(201).json({ success: true, data: extraction });
  } catch (err) {
    next(err);
  }
});

// GET /documents/:documentId/extraction
router.get('/documents/:documentId/extraction', authenticate, async (req, res, next) => {
  try {
    const extraction = await extractionService.getExtractionByDocument(req.params.documentId);
    if (!extraction) {
      return res.status(404).json({ success: false, message: 'No extraction found for this document' });
    }
    return res.json({ success: true, data: extraction });
  } catch (err) {
    next(err);
  }
});

// GET /deals/:dealId/extractions
// Deal-scoped roll-up of every completed extraction attached to this deal,
// plus a pre-computed field_map keyed by canonical buildability/underwriting
// field names. Powers the provenance badges on the Parcel / Zoning tabs.
router.get('/deals/:dealId/extractions', authenticate, async (req, res, next) => {
  try {
    const data = await extractionService.getDealExtractions(req.params.dealId);
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// PR-NX49 (2026-05-19) — Live AI document-insights endpoint.
//
// Surfaces the same Claude-synthesized cross-document analysis +
// 0-5 inconsistency findings that ships in the DOCX
// Document-Derived Insights section (PR-NX45), now consumable by the
// frontend DocumentsTab in the live workspace — operators no longer
// need to download a DOCX to read the AI cross-document reasoning.
// Uses the same generateDocumentInsights service so the DOCX / live
// workspace see identical content per cross-product reconciliation.
//
// Cascade: Claude (primary) → OpenAI (secondary) → unavailable.
//
// Auto-no-op when no extractions have populated structured_fields
// (zero AI cost on deals without doc-ingest).
router.get('/deals/:dealId/document-insights', authenticate, async (req, res, next) => {
  try {
    const dealId = req.params.dealId;
    // Fetch the deal (org-scoped at the app layer by dealService) + every completed extraction with its
    // merged structured_fields in parallel.
    const [deal, dealExtractions] = await Promise.all([
      dealService.getDealById(dealId),
      extractionService.getDealExtractions(dealId),
    ]);
    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found' });
    }

    // Reshape the extraction-service envelope to what
    // generateDocumentInsights expects (it wants the raw structured_fields
    // key; the service exposes merged fields under `fields`).
    const items = Array.isArray(dealExtractions?.extractions)
      ? dealExtractions.extractions
      : [];
    const reshaped = items.map((ext) => ({
      id: ext.id,
      document_id: ext.document_id,
      doc_type: ext.doc_type,
      provider: ext.provider || 'gemini', // not exposed on the merged shape; default to gemini per PR-NX25
      structured_fields: ext.fields || {},
    }));

    const insights = await generateDocumentInsights({ deal, extractions: reshaped });
    return res.json({ success: true, data: insights });
  } catch (err) {
    next(err);
  }
});

// PUT /documents/:documentId/extraction/:extractionId/corrections
router.put('/documents/:documentId/extraction/:extractionId/corrections', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { corrections } = req.body;
    if (!corrections || typeof corrections !== 'object') {
      return res.status(400).json({ success: false, message: 'corrections object is required' });
    }

    const updated = await extractionService.applyCorrections(
      req.params.extractionId,
      corrections,
      req.user.id,
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Extraction not found' });
    }

    return res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
