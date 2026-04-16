const express = require('express');
const { body } = require('express-validator');
const intelligenceService = require('../services/intelligence.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

router.get('/daily-brief', authenticate, async (req, res, next) => {
  try {
    const brief = await intelligenceService.getDailyBrief(req.user.id, req.query.date);
    res.json({ success: true, data: brief });
  } catch (error) {
    next(error);
  }
});

router.post('/daily-brief', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const brief = await intelligenceService.getDailyBrief(req.user.id, req.body?.date || req.query.date);
    res.json({ success: true, data: brief });
  } catch (error) {
    next(error);
  }
});

// GET /intelligence/market-notes — returns all three sections
router.get('/market-notes', authenticate, async (req, res, next) => {
  try {
    const notes = await intelligenceService.getMarketNotes();
    res.json({ success: true, data: notes });
  } catch (error) {
    next(error);
  }
});

// PUT /intelligence/market-notes — admin only, saves one section at a time
router.put(
  '/market-notes',
  authenticate,
  requireRole('admin'),
  [
    body('section').isIn(['micro_market', 'slowdown', 'strategic']).withMessage('Invalid section'),
    body('items').isArray().withMessage('items must be an array'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const saved = await intelligenceService.saveMarketNotes(
        req.body.section,
        req.body.items,
        req.user.id
      );
      res.json({ success: true, message: 'Market notes saved.', data: saved });
    } catch (error) {
      next(error);
    }
  }
);

// GET /intelligence/market-transactions
router.get('/market-transactions', authenticate, async (req, res, next) => {
  try {
    const data = await intelligenceService.getMarketTransactions({
      city:     req.query.city,
      fy:       req.query.fy,
      quarter:  req.query.quarter,
      dealType: req.query.dealType,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /intelligence/micro-market-benchmarks
router.get('/micro-market-benchmarks', authenticate, async (req, res, next) => {
  try {
    const data = await intelligenceService.getMicroMarketBenchmarks({ city: req.query.city });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// POST /intelligence/deal-analysis/:dealId — Claude-powered deal memo
router.post('/deal-analysis/:dealId', authenticate, requireRole('admin', 'analyst'), async (req, res, next) => {
  try {
    const result = await intelligenceService.getDealAnalysis(req.params.dealId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
