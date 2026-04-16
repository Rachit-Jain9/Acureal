'use strict';

const express = require('express');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const riskService = require('../services/risk.service');

const router = express.Router();

// GET /deals/:dealId/risk
router.get('/deals/:dealId/risk', authenticate, async (req, res, next) => {
  try {
    const flags = await riskService.listByDeal(req.params.dealId);
    return res.json({ success: true, data: flags });
  } catch (err) {
    next(err);
  }
});

// GET /deals/:dealId/risk/score
router.get('/deals/:dealId/risk/score', authenticate, async (req, res, next) => {
  try {
    const score = await riskService.getRiskScore(req.params.dealId);
    return res.json({ success: true, data: score });
  } catch (err) {
    next(err);
  }
});

// POST /deals/:dealId/risk
router.post('/deals/:dealId/risk', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { category, title } = req.body;
    if (!category || !title) {
      return res.status(400).json({ success: false, message: 'category and title are required' });
    }

    const flag = await riskService.create(req.params.dealId, req.body, req.user.id);
    return res.status(201).json({ success: true, data: flag });
  } catch (err) {
    next(err);
  }
});

// PUT /deals/:dealId/risk/:id
router.put('/deals/:dealId/risk/:id', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const flag = await riskService.update(req.params.id, req.body);
    if (!flag) {
      return res.status(404).json({ success: false, message: 'Risk flag not found' });
    }
    return res.json({ success: true, data: flag });
  } catch (err) {
    next(err);
  }
});

// DELETE /deals/:dealId/risk/:id
router.delete('/deals/:dealId/risk/:id', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const deleted = await riskService.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Risk flag not found' });
    }
    return res.json({ success: true, data: { id: deleted.id } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
