'use strict';

const express = require('express');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const ddService = require('../services/dd.service');

const router = express.Router();

// GET /deals/:dealId/dd
router.get('/deals/:dealId/dd', authenticate, async (req, res, next) => {
  try {
    const items = await ddService.listByDeal(req.params.dealId);
    return res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
});

// GET /deals/:dealId/dd/score
router.get('/deals/:dealId/dd/score', authenticate, async (req, res, next) => {
  try {
    const score = await ddService.getDDScore(req.params.dealId);
    return res.json({ success: true, data: score });
  } catch (err) {
    next(err);
  }
});

// POST /deals/:dealId/dd/seed
router.post('/deals/:dealId/dd/seed', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { assetClass, dealStructure } = req.body;
    const items = await ddService.seedForDeal(req.params.dealId, assetClass, dealStructure);
    return res.status(201).json({
      success: true,
      data: items,
      message: `Seeded ${items.length} DD items`,
    });
  } catch (err) {
    next(err);
  }
});

// POST /deals/:dealId/dd
router.post('/deals/:dealId/dd', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { category, item_name, name } = req.body;
    if (!category || !(item_name || name)) {
      return res.status(400).json({ success: false, message: 'category and item_name are required' });
    }

    const item = await ddService.create(
      req.params.dealId,
      { ...req.body, item_name: item_name || name },
      req.user.id,
    );
    return res.status(201).json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
});

// PUT /deals/:dealId/dd/:id
router.put('/deals/:dealId/dd/:id', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const item = await ddService.update(req.params.id, req.body);
    if (!item) {
      return res.status(404).json({ success: false, message: 'DD item not found' });
    }
    return res.json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
});

// PATCH /deals/:dealId/dd/:id/status
router.patch('/deals/:dealId/dd/:id/status', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: 'status is required' });
    }

    const item = await ddService.updateStatus(req.params.id, status, req.user.id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'DD item not found' });
    }
    return res.json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
});

// DELETE /deals/:dealId/dd/:id
router.delete('/deals/:dealId/dd/:id', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const deleted = await ddService.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'DD item not found' });
    }
    return res.json({ success: true, data: { id: deleted.id } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
