'use strict';

/**
 * P4 — Parcel cron routes. Cron-secret guarded via shared `requireCronAuth`.
 * Triggered daily by Vercel cron (vercel.json crons array).
 */

const express = require('express');
const { requireCronAuth } = require('../middleware/cronAuth');
const { runSweep } = require('../services/parcelCacheSweep.service');

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

module.exports = router;
