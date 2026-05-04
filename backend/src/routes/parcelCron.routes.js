'use strict';

/**
 * P4 — Parcel cron routes. Cron-secret guarded via shared `requireCronAuth`.
 * Triggered daily by Vercel cron (vercel.json crons array).
 */

const express = require('express');
const { requireCronAuth } = require('../middleware/cronAuth');
const { runSweep } = require('../services/parcelCacheSweep.service');
const { runSweep: runRetentionSweep } = require('../services/retentionSweep.service');

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

module.exports = router;
