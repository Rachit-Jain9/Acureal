'use strict';

/**
 * P4 — Parcel cron routes. Cron-secret guarded.
 * Triggered daily by Vercel cron (vercel.json crons array).
 */

const express = require('express');
const { runSweep } = require('../services/parcelCacheSweep.service');

const router = express.Router();

const getCronToken = () => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return null;
  return `Bearer ${cronSecret}`;
};

// GET /api/cron/parcel-cache-sweep/daily
// Same auth pattern as /api/fx/refresh/daily.
router.get('/parcel-cache-sweep/daily', async (req, res, next) => {
  try {
    const expectedToken = getCronToken();
    if (!expectedToken) {
      return res.status(503).json({
        success: false,
        message: 'CRON_SECRET is not configured.',
      });
    }

    if (req.get('authorization') !== expectedToken) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized cron request.',
      });
    }

    const summary = await runSweep();
    res.json({ success: true, scheduled: true, ...summary });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
