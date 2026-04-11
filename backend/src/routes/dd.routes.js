'use strict';

const express = require('express');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const ddService = require('../services/dd.service');

const router = express.Router();

// ──────────────────────────────────────────────────────────────────────────────
// GET /deals/:dealId/dd
// List all DD items for a deal
// ──────────────────────────────────────────────────────────────────────────────
router.get('/deals/:dealId/dd', authenticate, async (req, res) => {
  try {
    const items = await ddService.listByDeal(req.params.dealId);
    return res.json({ success: true, data: items });
  } catch (err) {
    console.error('dd.routes listByDeal error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /deals/:dealId/dd/score
// Must be registered BEFORE /:id routes to avoid :id capturing "score"
// ──────────────────────────────────────────────────────────────────────────────
router.get('/deals/:dealId/dd/score', authenticate, async (req, res) => {
  try {
    const score = await ddService.getDDScore(req.params.dealId);
    return res.json({ success: true, data: score });
  } catch (err) {
    console.error('dd.routes getDDScore error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /deals/:dealId/dd/seed
// Seed default DD checklist
// Must be registered BEFORE /:id routes
// ──────────────────────────────────────────────────────────────────────────────
router.post('/deals/:dealId/dd/seed', authenticate, requireAdminOrAnalyst, async (req, res) => {
  try {
    const { assetClass, dealStructure } = req.body;
    const items = await ddService.seedForDeal(req.params.dealId, assetClass, dealStructure);
    return res.status(201).json({
      success: true,
      data: items,
      message: `Seeded ${items.length} DD items`,
    });
  } catch (err) {
    console.error('dd.routes seedForDeal error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /deals/:dealId/dd
// Create a single DD item
// ──────────────────────────────────────────────────────────────────────────────
router.post('/deals/:dealId/dd', authenticate, requireAdminOrAnalyst, async (req, res) => {
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
    console.error('dd.routes create error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /deals/:dealId/dd/:id
// Update a DD item
// ──────────────────────────────────────────────────────────────────────────────
router.put('/deals/:dealId/dd/:id', authenticate, requireAdminOrAnalyst, async (req, res) => {
  try {
    const item = await ddService.update(req.params.id, req.body);
    if (!item) {
      return res.status(404).json({ success: false, message: 'DD item not found' });
    }
    return res.json({ success: true, data: item });
  } catch (err) {
    console.error('dd.routes update error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /deals/:dealId/dd/:id/status
// Update status only (quick transition)
// ──────────────────────────────────────────────────────────────────────────────
router.patch('/deals/:dealId/dd/:id/status', authenticate, requireAdminOrAnalyst, async (req, res) => {
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
    console.error('dd.routes updateStatus error:', err);
    return res.status(400).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /deals/:dealId/dd/:id
// ──────────────────────────────────────────────────────────────────────────────
router.delete('/deals/:dealId/dd/:id', authenticate, requireAdminOrAnalyst, async (req, res) => {
  try {
    const deleted = await ddService.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'DD item not found' });
    }
    return res.json({ success: true, data: { id: deleted.id } });
  } catch (err) {
    console.error('dd.routes delete error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
