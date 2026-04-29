'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { requireCronAuth } = require('../middleware/cronAuth');
const { refreshRates, getAllRates, getRate, convertFromINR, SUPPORTED_QUOTES } = require('../services/fx.service');

const router = express.Router();

// GET /api/fx/rates — latest stored rates for all supported currencies
router.get('/rates', authenticate, async (req, res, next) => {
  try {
    const rates = await getAllRates();
    res.json({
      success: true,
      base_currency: 'INR',
      supported_quotes: SUPPORTED_QUOTES,
      rates,
      note: rates.some((r) => r.freshness_status !== 'fresh')
        ? 'Some rates may be from a prior business day. Use POST /api/fx/refresh to update.'
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/fx/rates/:currency — latest rate for a specific currency
router.get('/rates/:currency', authenticate, async (req, res, next) => {
  try {
    const currency = req.params.currency.toUpperCase();
    if (!SUPPORTED_QUOTES.includes(currency)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported currency: ${currency}. Supported: ${SUPPORTED_QUOTES.join(', ')}`,
      });
    }

    const rate = await getRate(currency);
    if (!rate) {
      return res.status(404).json({
        success: false,
        message: `No rate found for INR → ${currency}. Run POST /api/fx/refresh first.`,
      });
    }

    res.json({ success: true, base_currency: 'INR', quote_currency: currency, ...rate });
  } catch (err) {
    next(err);
  }
});

// POST /api/fx/convert — convert INR to another currency
router.post('/convert', authenticate, async (req, res, next) => {
  try {
    const { amount_inr, currency } = req.body;

    if (!amount_inr || isNaN(amount_inr) || Number(amount_inr) < 0) {
      return res.status(400).json({ success: false, message: 'amount_inr must be a non-negative number.' });
    }

    const upperCurrency = (currency || '').toUpperCase();
    if (!SUPPORTED_QUOTES.includes(upperCurrency)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported currency: ${upperCurrency}. Supported: ${SUPPORTED_QUOTES.join(', ')}`,
      });
    }

    const result = await convertFromINR(Number(amount_inr), upperCurrency);
    if (!result) {
      return res.status(503).json({
        success: false,
        message: `No rate available for INR → ${upperCurrency}. Run POST /api/fx/refresh first.`,
      });
    }

    res.json({ success: true, input_inr: Number(amount_inr), ...result });
  } catch (err) {
    next(err);
  }
});

// POST /api/fx/refresh — trigger a live rate refresh (admin/analyst only)
router.post('/refresh', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const result = await refreshRates();
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

router.get('/refresh/daily', requireCronAuth, async (req, res, next) => {
  try {
    const result = await refreshRates();
    res.json({ success: true, scheduled: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
