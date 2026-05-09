'use strict';

/**
 * comps_review_queue REST API.
 *
 * Surface for the reviewer UI (PR 4 of the Tier-0 sequence) — list
 * pending items, drill into one, apply edits, approve+commit, reject.
 *
 * Authenticated; requires admin or analyst role for any mutating
 * operation. List + get are role-gated to the same set so unauthorized
 * users can't introspect the queue at all.
 */

const express = require('express');
const { body, param, query: qv } = require('express-validator');
const { authenticate, requireRole } = require('../middleware/auth');
const { uploadSingle } = require('../middleware/upload');
const { handleValidation } = require('../middleware/validate');
const queueService = require('../services/compsReviewQueue.service');

const router = express.Router();

const QUEUE_STATUSES = [
  'pending_extraction',
  'extracting',
  'pending_review',
  'approved',
  'rejected',
  'committed',
  'failed',
];

const QUEUE_SOURCES = [
  'email_broker_quote',
  'email_ipc_report',
  'email_other',
  'manual_upload',
  'api_listing_portal',
];

// GET /api/comps-review-queue — list with status/source filter + pagination.
// `assignedToMe=true` scopes to rows where assigned_to = current user
// (the "Assigned to me" filter pill on the queue page). The user id is
// taken from the auth session; the query string just toggles the filter.
router.get(
  '/',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    qv('status').optional().isIn(QUEUE_STATUSES),
    qv('source').optional().isIn(QUEUE_SOURCES),
    qv('limit').optional().isInt({ min: 1, max: 200 }),
    qv('offset').optional().isInt({ min: 0 }),
    qv('assignedToMe').optional().isBoolean(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const assignedToMe =
        req.query.assignedToMe === 'true' || req.query.assignedToMe === '1';
      const result = await queueService.listQueue({
        status: req.query.status,
        source: req.query.source,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : 50,
        offset: req.query.offset ? parseInt(req.query.offset, 10) : 0,
        assignedToMe,
        currentUserId: req.user.id,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/comps-review-queue/manual-upload — analyst-driven ingestion
// path. Accepts a single multipart file ("file" field) plus optional
// metadata (sender / subject / notes) and creates a queue row with
// source='manual_upload'. Used while waiting on a custom domain for
// Postmark or whenever the analyst already has the source PDF in hand.
//
// Registered BEFORE /:id so the literal path matches first.
router.post(
  '/manual-upload',
  authenticate,
  requireRole('admin', 'analyst'),
  uploadSingle('file'),
  [
    body('sender').optional().isString().isLength({ max: 1000 }),
    body('subject').optional().isString().isLength({ max: 1000 }),
    body('notes').optional().isString().isLength({ max: 4000 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          success: false,
          message: 'No file received. Send the file under the "file" field as multipart/form-data.',
        });
      }
      const result = await queueService.manualUpload({
        buffer: req.file.buffer,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        organizationId: req.user.organization_id,
        userId: req.user.id,
        metadata: {
          sender: req.body.sender,
          subject: req.body.subject,
          notes: req.body.notes,
        },
      });
      res.status(result.deduplicated ? 200 : 201).json({
        success: true,
        data: {
          id: result.row.id,
          status: result.row.status,
          deduplicated: result.deduplicated,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/comps-review-queue/process-pending — batch trigger for the
// reviewer to process the entire pending_extraction backlog in one click.
// Crucial on Vercel Hobby where the daily cron's worst-case lag is 24h;
// without this, freshly-ingested rows would block the reviewer until the
// next 03:50 UTC sweep.
//
// Registered BEFORE /:id so the literal path matches first (Express
// matches in registration order).
router.post(
  '/process-pending',
  authenticate,
  requireRole('admin', 'analyst'),
  [qv('limit').optional().isInt({ min: 1, max: 50 })],
  handleValidation,
  async (req, res, next) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 25;
      const summary = await queueService.processPendingBatch({ limit });
      res.json({ success: true, data: summary });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/comps-review-queue/:id — full row with structured payload + edits
router.get(
  '/:id',
  authenticate,
  requireRole('admin', 'analyst'),
  [param('id').isUUID()],
  handleValidation,
  async (req, res, next) => {
    try {
      const row = await queueService.getQueueRow(req.params.id);
      if (!row) {
        return res.status(404).json({ success: false, message: 'Queue row not found.' });
      }
      res.json({ success: true, data: row });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/comps-review-queue/:id/process — manual trigger for extraction
// Useful when the cron worker hasn't run yet and the reviewer wants to
// pull a row forward.
router.post(
  '/:id/process',
  authenticate,
  requireRole('admin', 'analyst'),
  [param('id').isUUID()],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await queueService.processQueueRow(req.params.id);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/comps-review-queue/:id — save reviewer edits without committing
router.patch(
  '/:id',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    param('id').isUUID(),
    // `optional({ values: 'null' })` skips validation when the field is
    // explicitly null, not just undefined. Without this, a frontend
    // sending `{ notes: null }` (the natural shape when no value is
    // entered) hits .isString() and trips Validation failed.
    body('payload').optional({ values: 'null' }).isObject(),
    body('notes').optional({ values: 'null' }).isString().isLength({ max: 4000 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const updated = await queueService.applyReviewerEdits(
        req.params.id,
        { payload: req.body.payload, notes: req.body.notes },
        req.user.id
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// ──────────────────────────────────────────────────────────────────────────
// Bulk operations — multi-row approve / reject from the queue page
//
// Body shape:
//   { ids: ["<uuid>", "<uuid>", ...], reason?: "..." }
//
// Per-id partial failures are collected and returned in the response —
// the request itself always succeeds with HTTP 200 unless the body is
// invalid. The UI shows a per-row breakdown so the analyst can retry
// only the failed ids without re-sending the whole batch.
// ──────────────────────────────────────────────────────────────────────────

// POST /api/comps-review-queue/bulk/approve { ids: [...] }
router.post(
  '/bulk/approve',
  authenticate,
  requireRole('admin', 'analyst'),
  [body('ids').isArray({ min: 1, max: 50 })],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await queueService.bulkApprove(req.body.ids, req.user.id);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/comps-review-queue/bulk/reject { ids: [...], reason?: "..." }
router.post(
  '/bulk/reject',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    body('ids').isArray({ min: 1, max: 50 }),
    body('reason').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await queueService.bulkReject(
        req.body.ids,
        req.body.reason || null,
        req.user.id,
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/comps-review-queue/bulk/reassign { ids: [...], assignedTo?: "<uuid>|null" }
//
// Sets assigned_to on each row. `assignedTo: null` is "unassign". Refuses
// terminal rows (committed/rejected). Returns 503 with operator
// instructions if the assignment migration hasn't been applied yet.
router.post(
  '/bulk/reassign',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    body('ids').isArray({ min: 1, max: 50 }),
    // `assignedTo` is the new owner. Accept null/undefined for the
    // "unassign everything" case; otherwise must be a UUID.
    body('assignedTo').optional({ values: 'null' }).isUUID(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await queueService.bulkReassign(
        req.body.ids,
        req.body.assignedTo || null,
        req.user.id,
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({
          success: false,
          message: err.message,
          code: err.code || undefined,
        });
      }
      return next(err);
    }
  },
);

// POST /api/comps-review-queue/:id/approve — commit edits → comps[]
router.post(
  '/:id/approve',
  authenticate,
  requireRole('admin', 'analyst'),
  [param('id').isUUID()],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await queueService.approveAndCommit(req.params.id, req.user.id);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/comps-review-queue/:id/reject — terminal rejection with reason
router.post(
  '/:id/reject',
  authenticate,
  requireRole('admin', 'analyst'),
  [
    param('id').isUUID(),
    // `optional({ values: 'null' })` lets `null` through (the frontend
    // sends `{ reason: null }` when the textarea is empty). Without it,
    // .isString() trips on null and the reject button toasts
    // "Validation failed".
    body('reason').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const updated = await queueService.reject(
        req.params.id,
        req.body.reason || null,
        req.user.id
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
