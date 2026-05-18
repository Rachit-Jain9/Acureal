const express = require('express');
const { body, query: qv, param } = require('express-validator');
const dealService = require('../services/deal.service');
const dealWorkspaceService = require('../services/dealWorkspace.service');
const dealShareService = require('../services/dealShare.service');
const dealApplyExtractionsService = require('../services/dealApplyExtractions.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');
const {
  DEAL_STAGES,
  DEAL_TYPES,
  PROPERTY_TYPES,
  LAND_PRICING_BASES,
  AREA_UNITS,
  normalizePropertyType,
  normalizeAreaUnit,
  normalizeLandPricingBasis,
  ASSET_CLASSES,
  DEAL_STRUCTURES,
} = require('../constants/domain');
const ontology = require('../../../packages/real-estate-ontology/src');

const router = express.Router();

// GET /deals
router.get(
  '/',
  authenticate,
  [
    qv('stage').optional().isIn(DEAL_STAGES),
    qv('dealType').optional().isIn(DEAL_TYPES),
    qv('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    qv('city').optional().trim(),
    qv('propertyType').optional().customSanitizer(normalizePropertyType).isIn(PROPERTY_TYPES),
    qv('includeArchived').optional().isBoolean().toBoolean(),
    qv('onlyArchived').optional().isBoolean().toBoolean(),
    qv('liveOnly').optional().isBoolean().toBoolean(),
    // "My deals" pill on the Deals list page. When true, scopes the
    // listing to deals where assigned_to = the auth user's id. The
    // route plumbs req.user.id explicitly — the query string is
    // just a flag so the URL doesn't carry user ids.
    qv('assignedToMe').optional().isBoolean().toBoolean(),
    qv('search').optional().trim(),
    qv('page').optional().isInt({ min: 1 }),
    qv('limit').optional().isInt({ min: 1, max: 500 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      // assignedTo wins as the explicit override; assignedToMe is the
      // sugar form that fills it in from the auth user. Setting both
      // is allowed but explicit assignedTo takes precedence so admins
      // can still filter "show me Asha's queue" without the pill
      // overriding it.
      const assignedTo =
        req.query.assignedTo ||
        (req.query.assignedToMe ? req.user.id : undefined);
      const filters = {
        stage: req.query.stage,
        dealType: req.query.dealType,
        assignedTo,
        city: req.query.city,
        propertyType: req.query.propertyType,
        search: req.query.search,
        priority: req.query.priority,
        includeArchived: req.query.includeArchived,
        onlyArchived: req.query.onlyArchived,
        liveOnly: req.query.liveOnly,
      };
      const pagination = { page: req.query.page, limit: req.query.limit };
      const result = await dealService.getDeals(filters, pagination);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /deals/shared-with-me (must be before /:id)
router.get('/shared-with-me', authenticate, async (req, res, next) => {
  try {
    const shares = await dealShareService.listDealsSharedWithMe(req.user.id);
    res.json({ success: true, data: shares });
  } catch (error) {
    next(error);
  }
});

// GET /deals/pipeline
router.get('/pipeline', authenticate, async (req, res, next) => {
  try {
    const pipeline = await dealService.getDealsByStage();
    res.json({ success: true, data: pipeline });
  } catch (error) {
    next(error);
  }
});

// GET /deals/summary
router.get('/summary', authenticate, async (req, res, next) => {
  try {
    const summary = await dealService.getPipelineSummary();
    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
});

// POST /deals
router.post(
  '/',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    body('propertyId').optional({ nullable: true, checkFalsy: true }).isUUID().withMessage('Valid property ID is required'),
    body('name').trim().notEmpty().withMessage('Deal name is required').isLength({ max: 500 }),
    body('dealType').isIn(DEAL_TYPES).withMessage('Invalid deal type'),
    body('stage').optional().isIn(DEAL_STAGES),
    body('assignedTo').optional().isUUID(),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('landAskPriceCr').optional().isFloat({ min: 0 }),
    body('landPricingBasis').optional().customSanitizer(normalizeLandPricingBasis).isIn(LAND_PRICING_BASES),
    body('landPriceRateInr').optional().isFloat({ min: 0 }),
    body('landExtentInputValue').optional().isFloat({ min: 0.01 }),
    body('landExtentInputUnit').optional().customSanitizer(normalizeAreaUnit).isIn(AREA_UNITS),
    body('negotiatedPriceCr').optional().isFloat({ min: 0 }),
    body('targetLaunchDate').optional().isISO8601(),
    body('expectedCloseDate').optional().isISO8601(),
    body('assetClass').optional().isIn(ASSET_CLASSES),
    body('dealStructure').optional().isIn(DEAL_STRUCTURES),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const deal = await dealService.createDeal(req.body, req.user.id);
      res.status(201).json({ success: true, message: 'Deal created.', data: deal });
    } catch (error) {
      next(error);
    }
  }
);

// GET /deals/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const deal = await dealService.getDealById(req.params.id);
    res.json({ success: true, data: deal });
  } catch (error) {
    next(error);
  }
});

// PUT /deals/:id
router.put(
  '/:id',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    body('propertyId').optional({ nullable: true, checkFalsy: true }).isUUID(),
    body('name').optional().trim().notEmpty().isLength({ max: 500 }),
    body('dealType').optional().isIn(DEAL_TYPES),
    body('assignedTo').optional().isUUID(),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('landAskPriceCr').optional().isFloat({ min: 0 }),
    body('landPricingBasis').optional().customSanitizer(normalizeLandPricingBasis).isIn(LAND_PRICING_BASES),
    body('landPriceRateInr').optional().isFloat({ min: 0 }),
    body('landExtentInputValue').optional().isFloat({ min: 0.01 }),
    body('landExtentInputUnit').optional().customSanitizer(normalizeAreaUnit).isIn(AREA_UNITS),
    body('negotiatedPriceCr').optional().isFloat({ min: 0 }),
    body('assetClass').optional().isIn(ASSET_CLASSES),
    body('dealStructure').optional().isIn(DEAL_STRUCTURES),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const deal = await dealService.updateDeal(req.params.id, req.body, req.user?.id || null);
      res.json({ success: true, message: 'Deal updated.', data: deal });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /deals/:id/stage
router.patch(
  '/:id/stage',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    body('stage').isIn(DEAL_STAGES).withMessage('Invalid stage'),
    body('notes').optional().trim(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const deal = await dealService.transitionStage(
        req.params.id,
        req.body.stage,
        req.user.id,
        req.body.notes
      );
      res.json({ success: true, message: `Deal moved to ${req.body.stage}.`, data: deal });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /deals/:id/archive
router.patch('/:id/archive', authenticate, requireRole('admin', 'analyst'), [
  body('reason').optional().trim(),
], handleValidation, async (req, res, next) => {
  try {
    const deal = await dealService.archiveDeal(req.params.id, req.user.id, req.body.reason);
    res.json({ success: true, message: 'Deal archived.', data: deal });
  } catch (error) {
    next(error);
  }
});

// PATCH /deals/:id/restore
router.patch('/:id/restore', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const deal = await dealService.restoreDeal(req.params.id, req.user?.id || null);
    res.json({ success: true, message: 'Deal restored.', data: deal });
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Bulk operations on the Deals list — multi-select on /dashboard/deals.
// Each request accepts an `ids` array (capped at 50) and returns an
// aggregated { succeeded[], failed[] } so the UI can render per-row
// outcomes without aborting the whole batch on a single failure.
// ──────────────────────────────────────────────────────────────────────────

// POST /deals/bulk/archive { ids: [...], reason?: '...' }
router.post(
  '/bulk/archive',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    body('ids').isArray({ min: 1, max: 50 }),
    body('reason').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await dealService.bulkArchiveDeals(
        req.body.ids,
        req.user.id,
        req.body.reason || null,
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /deals/:id/apply-extractions (PR-NX25 — 2026-05-17)
//
// Operator-approved auto-fill from document extractions. Body shape:
//
//   {
//     approved: [
//       {
//         canonical_field: "survey_number",         // key in ontology.extraction_field_map
//         value: "45/2A",                            // raw value (transform applied server-side)
//         source_extraction_id: "<uuid>",            // FK to document_extractions
//         source_document_id: "<uuid>",              // optional, for audit
//         source_field: "survey_number",             // optional, the raw extraction key
//         confidence: 0.92                            // optional, for audit
//       },
//       ...
//     ]
//   }
//
// Behavior:
//   - Each item is validated + coerced via @redip/real-estate-ontology
//     (e.g., acres → sqft, ₹ → ₹Cr).
//   - Items targeting deals.* are batched into ONE UPDATE; items
//     targeting properties.* into another. Same transaction.
//   - Bad items (out-of-range, unknown field) are SKIPPED with reason;
//     good items still ship. Empty `applied` after validation → 200 with
//     the skip list (no error).
//   - Source `document_extractions` get an `applied_to_deal` entry
//     appended to their correction_history JSONB so the modal can hide
//     already-consumed extractions.
//   - Two `deal_audit_log` rows max (one for deals.*, one for properties.*)
//     with metadata.source='document_extraction'.
//
// Operator value: closes the "manually re-enter 30 fields" gap left by
// the extraction-only pipeline. Operator clicks "Auto-fill" in the
// Documents tab modal → reviews proposed values → approves → this
// endpoint persists with full audit trail.
router.post(
  '/:id/apply-extractions',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    param('id').isUUID().withMessage('deal id must be a UUID'),
    body('approved').isArray({ min: 1, max: 100 }).withMessage('approved must be a non-empty array (max 100)'),
    body('approved.*.canonical_field')
      .isString()
      .withMessage('canonical_field must be a string')
      .custom((value) => {
        if (!ontology.getExtractionField(value)) {
          throw new Error(`canonical_field "${value}" is not in the ontology (v${ontology.getOntologyVersion()})`);
        }
        return true;
      }),
    body('approved.*.value').exists({ checkNull: true }).withMessage('value is required (use empty string for explicit clear)'),
    body('approved.*.source_extraction_id').optional({ nullable: true }).isUUID(),
    body('approved.*.source_document_id').optional({ nullable: true }).isUUID(),
    body('approved.*.source_field').optional({ nullable: true }).isString().isLength({ max: 200 }),
    body('approved.*.confidence').optional({ nullable: true }).isFloat({ min: 0, max: 1 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await dealApplyExtractionsService.applyExtractionsToDeal(
        req.params.id,
        req.body.approved,
        req.user?.id || null,
      );
      const message =
        result.applied.length === 0
          ? 'No fields applied — all were rejected by validation. See `skipped` for reasons.'
          : `Applied ${result.applied.length} field(s) to the deal${result.skipped.length ? `; ${result.skipped.length} skipped` : ''}.`;
      res.json({ success: true, message, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// PR-NX50 (2026-05-19) — Field-provenance endpoint for inline chips.
//
// Surfaces a map of every deal/property field that was auto-applied via
// document_extraction (PR-NX25 `apply-extractions`). Frontend
// ProvenanceChip components consume this to render an inline (i) chip
// next to each auto-filled value, with a hover popover showing source
// document + when + which extraction + ontology version.
//
// Returns shape:
//   {
//     field_provenance: {
//       '<field_name>': {
//         source: 'document_extraction',
//         applied_at: ISO timestamp (latest),
//         applied_by: user UUID,
//         applied_by_name: human name (joined from users),
//         applied_value: the value that was written,
//         source_extraction_ids: string[],
//         source_document_names: string[],
//         source_document_types: string[],
//         target_table: 'deals' | 'properties',
//         ontology_version: string
//       },
//       ...
//     },
//     generated_at: ISO timestamp
//   }
//
// When a field has been auto-filled multiple times, the LATEST entry is
// returned (it's the value currently in the DB). Fields never auto-filled
// don't appear in the map at all (the chip simply doesn't render).
//
// Auth: authenticate (read-only on visibility-scoped audit data).
router.get(
  '/:id/field-provenance',
  authenticate,
  async (req, res, next) => {
    try {
      const dealId = req.params.id;
      // RLS visibility check via dealService first — 404 if not visible.
      const deal = await dealService.getDealById(dealId);
      if (!deal) {
        return res.status(404).json({ success: false, message: 'Deal not found' });
      }

      // Query deal_audit_log for every document_extraction event on this
      // deal, joining users for the actor name + document_extractions →
      // documents for the source document names + types.
      const { query: db } = require('../config/database');
      const result = await db(
        `WITH provenance_events AS (
           SELECT
             dal.id,
             dal.created_at,
             dal.actor_id,
             dal.after_json,
             dal.metadata,
             u.name AS actor_name
           FROM deal_audit_log dal
           LEFT JOIN users u ON u.id = dal.actor_id
           WHERE dal.deal_id = $1
             AND dal.event_type = 'updated'
             AND dal.metadata ->> 'source' = 'document_extraction'
           ORDER BY dal.created_at DESC
         )
         SELECT
           pe.id AS audit_id,
           pe.created_at,
           pe.actor_id,
           pe.actor_name,
           pe.after_json,
           pe.metadata,
           COALESCE(
             json_agg(DISTINCT jsonb_build_object(
               'extraction_id', ext.id,
               'document_name', doc.name,
               'doc_type',      ext.doc_type
             )) FILTER (WHERE ext.id IS NOT NULL),
             '[]'::json
           ) AS source_documents
         FROM provenance_events pe
         LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(pe.metadata -> 'source_extraction_ids', '[]'::jsonb)) AS ext_id_text ON true
         LEFT JOIN document_extractions ext ON ext.id::text = ext_id_text
         LEFT JOIN documents doc ON doc.id = ext.document_id
         GROUP BY pe.id, pe.created_at, pe.actor_id, pe.actor_name, pe.after_json, pe.metadata
         ORDER BY pe.created_at DESC`,
        [dealId],
      ).catch((err) => {
        // Soft-fail on missing table (42P01) — no audit log = no provenance.
        if (err && err.code === '42P01') return { rows: [] };
        throw err;
      });

      // Walk newest-first; first time we see a field, lock it in (so
      // the LATEST overwrite wins). after_json keys are the field names.
      const fieldProvenance = {};
      for (const row of result.rows) {
        const after = row.after_json || {};
        const metadata = row.metadata || {};
        const sourceDocs = Array.isArray(row.source_documents) ? row.source_documents : [];
        const docNames = [...new Set(sourceDocs.map((d) => d.document_name).filter(Boolean))];
        const docTypes = [...new Set(sourceDocs.map((d) => d.doc_type).filter(Boolean))];
        const extractionIds = sourceDocs.map((d) => d.extraction_id).filter(Boolean);

        for (const [fieldName, value] of Object.entries(after)) {
          if (fieldProvenance[fieldName]) continue; // already locked in (newer row took it)
          fieldProvenance[fieldName] = {
            source: 'document_extraction',
            applied_at: row.created_at,
            applied_by: row.actor_id,
            applied_by_name: row.actor_name,
            applied_value: value,
            source_extraction_ids: extractionIds,
            source_document_names: docNames,
            source_document_types: docTypes,
            target_table: metadata.target_table || null,
            ontology_version: metadata.ontology_version || null,
          };
        }
      }

      return res.json({
        success: true,
        data: {
          field_provenance: fieldProvenance,
          generated_at: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /deals/bulk/reassign { ids: [...], assignedTo?: '<uuid>'|null }
//
// Sets `deals.assigned_to` on each id. assignedTo: null is "unassign".
// Refuses archived rows (the bulk reassign isn't meant for cleanup
// of dead deals — restore first if that's the intent).
router.post(
  '/bulk/reassign',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    body('ids').isArray({ min: 1, max: 50 }),
    body('assignedTo').optional({ values: 'null' }).isUUID(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await dealService.bulkReassignDeals(
        req.body.ids,
        req.body.assignedTo || null,
        req.user.id,
      );
      res.json({ success: true, data: result });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      return next(err);
    }
  },
);

// POST /deals/bulk/stage { ids: [...], stage: '<stage>', notes?: '...' }
//
// Move multiple deals to the same target stage. Each transition is
// validated against canTransitionStage — incompatible rows land in
// failed[]. Iterates so the per-stage history rows + DEAL_STAGE_CHANGED
// events fire correctly per deal.
router.post(
  '/bulk/stage',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    body('ids').isArray({ min: 1, max: 50 }),
    body('stage').isIn(DEAL_STAGES),
    body('notes').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await dealService.bulkTransitionStage(
        req.body.ids,
        req.body.stage,
        req.user.id,
        req.body.notes || '',
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /deals/bulk/delete { ids: [...] }
//
// Hard-delete multiple deals. Admin-only — same `requireRole('admin')`
// gate as DELETE /deals/:id. Bulk-deletion is the most-destructive
// operation we expose; the frontend additionally requires a
// "type DELETE to confirm" pattern before sending the request, but
// the backend doesn't depend on that — anything that gets past the
// admin role check executes.
router.post(
  '/bulk/delete',
  authenticate,
  requireRole('admin'),
  [body('ids').isArray({ min: 1, max: 50 })],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await dealService.bulkDeleteDeals(req.body.ids, req.user?.id || null);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /deals/:id
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await dealService.deleteDeal(req.params.id, req.user?.id || null);
    res.json({ success: true, message: 'Deal deleted.', data: result });
  } catch (error) {
    next(error);
  }
});

// GET /deals/:id/workspace — unified read-model for the deal workspace UI.
// Composes deal + financials + scenarios + graph + DD/risk scores + audit
// events + documents + activities + waterfall into one payload so tabs can
// share a single React-Query key. RLS is enforced per-slice via the
// underlying services; no bypass here.
router.get(
  '/:id/workspace',
  authenticate,
  [param('id').isUUID().withMessage('Deal id must be a UUID.')],
  handleValidation,
  async (req, res, next) => {
    try {
      const workspace = await dealWorkspaceService.getDealWorkspace(req.params.id);
      res.json({ success: true, data: workspace });
    } catch (error) {
      next(error);
    }
  }
);

// GET /deals/:id/readiness
router.get('/:id/readiness', authenticate, async (req, res, next) => {
  try {
    const deal = await dealService.getDealById(req.params.id);
    res.json({
      success: true,
      data: {
        readiness_summary: deal.readiness_summary,
        next_steps: deal.next_steps,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── Deal Sharing ─────────────────────────────────────────────────────────

// GET /deals/:id/shares
router.get('/:id/shares', authenticate, async (req, res, next) => {
  try {
    const shares = await dealShareService.listDealShares(req.params.id, req.user.id);
    res.json({ success: true, data: shares });
  } catch (error) {
    next(error);
  }
});

// POST /deals/:id/shares
router.post(
  '/:id/shares',
  authenticate,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('permission').optional().isIn(['viewer', 'editor']).withMessage('Permission must be viewer or editor'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const share = await dealShareService.shareDeal(
        req.params.id,
        req.user.id,
        req.body.email,
        req.body.permission || 'viewer'
      );
      res.status(201).json({ success: true, message: 'Deal shared.', data: share });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /deals/:id/shares/:userId
router.delete('/:id/shares/:userId', authenticate, async (req, res, next) => {
  try {
    const result = await dealShareService.revokeDealShare(
      req.params.id,
      req.user.id,
      req.params.userId
    );
    res.json({ success: true, message: 'Share revoked.', data: result });
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Tier-2 #11 — Deal Q&A agent
// ──────────────────────────────────────────────────────────────────────────

const dealQaService = require('../services/dealQa.service');

// POST /deals/:dealId/qa { question }
// Synchronous Q&A: retrieves relevant document chunks via pgvector,
// runs Claude with mandatory-citation contract, persists to
// deal_qa_history. Returns the new history row.
router.post('/:id/qa', authenticate, async (req, res, next) => {
  try {
    const { question } = req.body || {};
    const row = await dealQaService.askQuestion({
      dealId: req.params.id,
      question,
      userId: req.user.id,
      organizationId: req.user.organization_id,
    });
    return res.status(row.cache_hit ? 200 : 201).json({ success: true, data: row });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
        // Even on failure we may have persisted a row (status='failed').
        // Surface the row so the UI can render the failed-attempt entry
        // in history without a refetch.
        ...(err.row ? { data: err.row } : {}),
      });
    }
    return next(err);
  }
});

// POST /deals/:dealId/qa/stream { question }
// SSE-streamed Q&A. Same context assembly + citation contract as the
// non-streaming POST, but writes Claude's JSON deltas back as SSE
// frames so the UI shows the answer as it generates instead of
// blocking for the full ~6-15s round-trip.
//
// Frame shape:
//   { type: 'text',  text: '<delta>' }       — incremental tokens
//   { type: 'done',  row, cacheHit, ... }    — final hydrated row
//   { type: 'error', message }               — fatal stream error
router.post('/:id/qa/stream', authenticate, async (req, res, next) => {
  try {
    const { question } = req.body || {};
    const handle = await dealQaService.streamQuestion({
      dealId: req.params.id,
      question,
      userId: req.user.id,
      organizationId: req.user.organization_id,
    });

    if (handle.error) {
      return res.status(handle.status || 500).json({ success: false, message: handle.error });
    }

    // SSE headers — disable proxy/CDN buffering so deltas hit the client
    // immediately. flushHeaders() ships before the first frame instead
    // of after.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const writeFrame = (obj) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    // Cache short-circuit — emit one done frame with the cached row,
    // no streaming needed.
    if (handle.cacheHit) {
      writeFrame({ type: 'done', row: handle.row, cacheHit: true });
      res.end();
      return undefined;
    }

    // Client disconnect → abort the upstream Anthropic call so we
    // don't burn tokens on something nobody's reading.
    let aborted = false;
    req.on('close', () => {
      if (!res.writableEnded) {
        aborted = true;
        handle.abort?.();
      }
    });

    // Stream raw JSON deltas. Frontend incrementally JSON-parses to
    // pull out the answer.field as it grows; citations land in the
    // final `done` frame with hydrated metadata.
    handle.onText((delta) => writeFrame({ type: 'text', text: delta }));

    try {
      const final = await handle.done();
      if (!aborted) {
        if (final.status === 'complete') {
          writeFrame({ type: 'done', row: final.row, cacheHit: false });
        } else {
          writeFrame({ type: 'error', message: final.failureReason || 'Q&A generation failed.', row: final.row });
        }
      }
    } catch (err) {
      if (!aborted) {
        writeFrame({ type: 'error', message: err.message || 'Stream failed' });
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
    return undefined;
  } catch (err) {
    return next(err);
  }
});

// GET /deals/:dealId/qa/history?limit=10
// Most recent N Q&A rows for a deal (newest first).
router.get('/:id/qa/history', authenticate, async (req, res, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
    const rows = await dealQaService.listHistory(req.params.id, { limit });
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// DELETE /deals/:dealId/qa/:rowId
// Remove a single Q&A row. Useful when an analyst wants to clean up a
// failed/wrong answer before sharing the deal page in IC.
router.delete('/:id/qa/:rowId', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const deleted = await dealQaService.deleteHistoryRow(req.params.rowId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Q&A row not found.' });
    }
    res.json({ success: true, data: deleted });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
