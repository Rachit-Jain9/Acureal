'use strict';

/**
 * P4 — Parcel cron routes. Cron-secret guarded via shared `requireCronAuth`.
 * Triggered daily by Vercel cron (vercel.json crons array).
 */

const express = require('express');
const { requireCronAuth } = require('../middleware/cronAuth');
const { runSweep } = require('../services/parcelCacheSweep.service');
const { runSweep: runRetentionSweep } = require('../services/retentionSweep.service');
const { runSweep: runEntityPurge } = require('../services/entityPurge.service');
const queueService = require('../services/compsReviewQueue.service');
const abEvalPersistence = require('../services/ai/abEvalPersistence.service');
const { runHealthCheck } = require('../services/healthCheck.service');

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
    // Same daily slot also enforces the 15-day hard-purge of soft-deleted deal
    // child entities (risk flags / approvals / DD items / documents). Folded in
    // here rather than a 6th Vercel cron entry — Hobby caps the cron count, and
    // runEntityPurge is fail-open (never throws), so it can't break retention.
    const entityPurge = await runEntityPurge();
    res.json({ success: true, scheduled: true, ...summary, entity_purge: entityPurge });
  } catch (error) {
    next(error);
  }
});

// GET /api/cron/entity-purge/daily
// Standalone trigger for the 15-day soft-delete purge (also runs inside
// retention-sweep/daily). Intentionally NOT in the Vercel crons array — exposed
// for manual or external-scheduler invocation. Cron-secret-gated.
router.get('/entity-purge/daily', requireCronAuth, async (req, res, next) => {
  try {
    const summary = await runEntityPurge();
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

// GET /api/cron/quality-baseline/daily
// Workstream C3 — the standing AI-quality monitor's automatic trigger. Runs
// a baseline of the current production reasoning model against the held-out
// fixtures for each monitored task and persists it, so the quality trend
// accrues a fresh data point every day. Cron-secret-gated; the run is
// attributed to the oldest organisation (the eval measures REDIP's own AI,
// not tenant data). Fail-soft per task — runScheduledBaselines never throws.
router.get('/quality-baseline/daily', requireCronAuth, async (req, res, next) => {
  try {
    const summary = await abEvalPersistence.runScheduledBaselines();
    res.json({ success: true, ...summary });
  } catch (error) {
    next(error);
  }
});

// GET /api/cron/health-check/hourly
// The liveness watchdog — the one thing that watches everything else. Reads
// (UNSCOPED, across all orgs) the four subsystems that have failed SILENTLY
// before: AI provider error share, audit-write liveness, stuck extractions, and
// the tenant-isolation fail-closed canary. Raises a fingerprinted Sentry alert
// per unhealthy subsystem (the endpoint stays 200 — unhealthy is data, not an
// HTTP error — so alerting must be explicit; Sentry only auto-reports >=500).
// Replaces the retired `/api/fx/refresh/daily` cron slot (net-zero cron count).
router.get('/health-check/hourly', requireCronAuth, async (req, res, next) => {
  try {
    const summary = await runHealthCheck({ raiseAlerts: true });
    res.json({ success: true, scheduled: true, ...summary });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
