'use strict';

const express = require('express');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const masterplanService = require('../services/masterplan.service');

const router = express.Router();

// Vercel serverless functions stay alive for `waitUntil`-bound work even
// after the response is sent. Locally / outside Vercel, the import is a
// no-op and we just let the promise run unawaited (Express won't exit
// before the event loop drains).
let waitUntil = null;
try {
  // eslint-disable-next-line global-require
  waitUntil = require('@vercel/functions').waitUntil;
} catch {
  // Package not installed in this environment — fine, fall back to unawaited promise.
}

function fireAndForget(promise) {
  if (typeof waitUntil === 'function') {
    try {
      waitUntil(promise);
    } catch {
      // waitUntil unavailable at runtime (e.g. cold-start error) — let it run unawaited.
    }
  }
  promise.catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[masterplan.extract] background job error:', err);
  });
}

// T3 — Zoning overlay GeoJSON for the deal map.
// Returns a FeatureCollection of master_plan_zones whose `geom` is non-null,
// optionally filtered to a bbox around a centre lat/lng for performance.
// Empty `features` array is a valid response — UI renders a "no zone
// geometry uploaded yet" empty state when the array is empty.
router.get('/zones/geojson', authenticate, async (req, res, next) => {
  try {
    const radiusKm = Math.min(20, Math.max(0.5, Number(req.query.radius_km) || 5));
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    const result = await masterplanService.listZoneGeoJSON({ lat, lng, radiusKm });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

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

// PUT /api/master-plan/documents/:id/metadata
router.put('/documents/:id/metadata', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { changeReason, ...payload } = req.body || {};
    const doc = await masterplanService.updateSourceDocumentMetadata(
      req.params.id,
      payload,
      req.user.id,
      { changeReason },
    );
    res.json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
});

// GET /api/master-plan/documents/:id/versions
router.get('/documents/:id/versions', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const versions = await masterplanService.getSourceDocumentVersions(req.params.id);
    res.json({ success: true, data: versions });
  } catch (err) {
    next(err);
  }
});

// GET /api/master-plan/documents/:id/pages
router.get('/documents/:id/pages', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const data = await masterplanService.listSourceDocumentPages(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// POST /api/master-plan/documents/:id/pages/prepare
router.post('/documents/:id/pages/prepare', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const data = await masterplanService.prepareSourceDocumentPages(req.params.id, {
      pageCount: req.body?.pageCount,
    });
    res.status(data.schema_ready ? 201 : 200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/master-plan/documents/:id/download
router.get('/documents/:id/download', authenticate, async (req, res, next) => {
  try {
    // Forensics for the immutable document-access log (document_access_log).
    // `trust proxy` is set in server.js, so req.ip is the real client IP.
    const data = await masterplanService.getSourceDocumentDownload(req.params.id, {
      userId: req.user?.id || null,
      organizationId: req.user?.organization_id || null,
      ip: req.ip || null,
      userAgent: req.get('user-agent') || null,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// POST /api/master-plan/documents/:id/extract
// Queues a background extraction. The HTTP response returns immediately
// once the row has been transitioned to in_progress, so reviewers can keep
// working while Gemini runs. The reaper handles any job that exceeds the
// function timeout.
router.post('/documents/:id/extract', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const queued = await masterplanService.queueExtractionJob(req.params.id, {
      docType: req.body?.docType,
    });
    fireAndForget(masterplanService.runExtractionJob(req.params.id, {
      docType: req.body?.docType,
      userId: req.user.id,
    }));
    res.status(202).json({ success: true, data: { document: queued.document, status: 'queued' } });
  } catch (err) {
    next(err);
  }
});

// POST /api/master-plan/documents/extract-batch
// Queues background extractions for every supplied document id. Documents
// that aren't extractable (wrong file type, OCR-required, manual_entry) are
// reported in the response but skipped — the call never throws because of a
// single bad doc.
router.post('/documents/extract-batch', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids must be a non-empty array' });
    }
    if (ids.length > 25) {
      return res.status(400).json({ success: false, message: 'Batch limited to 25 documents per request.' });
    }

    const queued = [];
    const skipped = [];
    for (const id of ids) {
      try {
        const result = await masterplanService.queueExtractionJob(id, {});
        fireAndForget(masterplanService.runExtractionJob(id, { userId: req.user.id }));
        queued.push({ id, plan_name: result.document?.plan_name });
      } catch (err) {
        skipped.push({
          id,
          reason: err.message || 'Could not queue extraction',
          status_code: err.statusCode || 500,
        });
      }
    }

    return res.status(202).json({
      success: true,
      data: {
        queued_count: queued.length,
        skipped_count: skipped.length,
        queued,
        skipped,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/master-plan/corpus
// Returns the canonical Bengaluru RMP 2031 source corpus with upload status.
// Reviewers see the 12 expected files, their pre-classification, and which
// have already been uploaded. No facts get promoted from this endpoint —
// classification metadata only.
router.get('/corpus', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const data = await masterplanService.listMasterplanCorpus({ city: req.query.city });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/master-plan/intelligence/land-use
// Returns the BMA land-use intelligence (2015 baseline vs 2031 proposed)
// extracted from Existing/Proposed Land Use maps and Volume 4 PDR.
// GET /api/master-plan/coverage
// Regulatory coverage read model — the operative planning authorities REDIP
// holds a rulebook for (BDA/RMP 2015 + the LPAs), with FAR-rule/zone counts and
// whether a georeferenced map overlay exists. Powers the Master Plan Explorer
// "Regulatory coverage" panel. Global reference data; any authenticated user.
router.get('/coverage', authenticate, async (req, res, next) => {
  try {
    const data = await masterplanService.getRegulatoryCoverage();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/intelligence/land-use', authenticate, async (req, res, next) => {
  try {
    const data = await masterplanService.getLandUseIntelligence();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/master-plan/intelligence/districts
// Returns 42 Bengaluru Planning Districts enriched with per-district
// demographics from Volume 4 PDR + city-wide callouts (SDZs, heritage
// zones, NGT buffers, landmarks).
router.get('/intelligence/districts', authenticate, async (req, res, next) => {
  try {
    const data = await masterplanService.getDistrictIntelligence();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/master-plan/intelligence/sources
// Source-explorer feed: every evidence_source with its facts grouped by
// page_number, plus a city-level summary. Powers the Source Explorer UI
// where reviewers click a fact and land on the exact PDF page it came from.
router.get('/intelligence/sources', authenticate, async (req, res, next) => {
  try {
    const data = await masterplanService.getSourceExplorer();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/master-plan/intelligence/review-queue
// Confidence + review-status buckets for every extracted fact. Returns
// counts by (bucket × status) cell plus the actual rows that still need
// human verification (anything not high-confidence + approved).
router.get('/intelligence/review-queue', authenticate, async (req, res, next) => {
  try {
    const data = await masterplanService.getReviewQueue();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/master-plan/intelligence/uav-benchmark
// BBMP UAV rate card pivoted into a (zone × property_use) matrix with
// ratios vs Zone A so deal teams can benchmark transaction pricing
// against the property-tax authority's own rate tiers.
router.get('/intelligence/uav-benchmark', authenticate, async (req, res, next) => {
  try {
    const data = await masterplanService.getUavBenchmark({ city: req.query.city });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/master-plan/intelligence/ward-summary
// Ward-level rollup of the BBMP street index — one row per ward with
// street count, dominant zone, dominant-zone share %, and median
// guidance-value midpoint. Powers the admin "Ward summary" panel.
router.get('/intelligence/ward-summary', authenticate, async (req, res, next) => {
  try {
    const data = await masterplanService.getBbmpWardSummary();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/master-plan/intelligence/street-lookup?search=...&limit=...&zone=A&register=residential
// Fuzzy-search the BBMP street index sourced from the Guidance Value PDF
// (both gazette registers: residential pages 17-362, non-residential pages
// 363-686 — the same street can carry different UAV zones per register).
// Each hit carries the ward + source page + register so the user can verify
// the zone classification in the original document. Optional zone filter
// (A-F) and register filter (residential | non_residential).
router.get('/intelligence/street-lookup', authenticate, async (req, res, next) => {
  try {
    const data = await masterplanService.searchBbmpStreets({
      search: req.query.search,
      limit: req.query.limit,
      zone: req.query.zone,
      register: req.query.register,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/master-plan/bbmp-uav
router.get('/bbmp-uav', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const data = await masterplanService.listBbmpUavEntries({
      documentId: req.query.documentId,
      city: req.query.city,
      status: req.query.status,
      search: req.query.search,
      limit: req.query.limit,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// POST /api/master-plan/zones/import-geojson
// Imports polygon geometry for already-reviewed zones from a GeoJSON
// FeatureCollection. Never creates new zones — only attaches geometry
// to zones that already exist in the registry (by zone_code + plan_version).
// Every change is logged to zone_versions for the audit trail.
router.post('/zones/import-geojson', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const summary = await masterplanService.importZoneGeoJSON({
      featureCollection: req.body?.featureCollection,
      planVersion: req.body?.planVersion,
      changeReason: req.body?.changeReason,
      overwriteGeom: Boolean(req.body?.overwriteGeom),
      userId: req.user.id,
    });
    res.status(201).json({ success: true, data: summary });
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
