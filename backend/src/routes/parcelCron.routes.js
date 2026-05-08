'use strict';

/**
 * P4 — Parcel cron routes. Cron-secret guarded via shared `requireCronAuth`.
 * Triggered daily by Vercel cron (vercel.json crons array).
 */

const express = require('express');
const { requireCronAuth } = require('../middleware/cronAuth');
const { runSweep } = require('../services/parcelCacheSweep.service');
const { runSweep: runRetentionSweep } = require('../services/retentionSweep.service');
const queueService = require('../services/compsReviewQueue.service');

const router = express.Router();

// GET /api/cron/parcel-cache-sweep/daily
router.get('/parcel-cache-sweep/daily', requireCronAuth, async (req, res, next) => {
  try {
    const summary = await runSweep();
    res.json({ success: true, scheduled: true, ...summary });
  } catch (error) {
    next(error);
  }
});

// GET /api/cron/retention-sweep/daily
// DPDP §8(7) + Privacy Policy §7 retention enforcement. Purges expired AI
// response cache rows, dead refresh-token grants past their forensic window,
// stale unlocked login_attempts rows, and AI call logs past 12 months.
router.get('/retention-sweep/daily', requireCronAuth, async (req, res, next) => {
  try {
    const summary = await runRetentionSweep();
    res.json({ success: true, scheduled: true, ...summary });
  } catch (error) {
    next(error);
  }
});

// GET /api/cron/comps-queue/process-pending
// Tier-0 data flywheel — extracts pending_extraction queue rows in
// short batches per organization. Cron-secret-gated; idempotent (rows
// in non-pending status are ignored).
//
// Schedule: once-daily at 03:50 UTC (Vercel Hobby caps cron entries to
// one run per day). For lower latency, reviewers can hit the
// authenticated POST /api/comps-review-queue/process-pending endpoint
// from the UI's "Process pending now" button. External schedulers
// (GitHub Actions cron, cron-job.org, etc.) can also call this
// cron-secret-gated route at any cadence.
router.get('/comps-queue/process-pending', requireCronAuth, async (req, res, next) => {
  try {
    const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10) || 5, 25) : 5;
    const summary = await queueService.processPendingBatchAcrossOrgs({ limitPerOrg: limit });
    res.json({ success: true, scheduled: true, ...summary });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
