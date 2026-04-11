'use strict';

const express = require('express');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const approvalsService = require('../services/approvals.service');

const router = express.Router();

// ──────────────────────────────────────────────────────────────────────────────
// GET /deals/:dealId/approvals
// ──────────────────────────────────────────────────────────────────────────────
router.get('/deals/:dealId/approvals', authenticate, async (req, res) => {
  try {
    const items = await approvalsService.listByDeal(req.params.dealId);
    return res.json({ success: true, data: items });
  } catch (err) {
    console.error('approvals.routes listByDeal error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /deals/:dealId/approvals/seed
// Must be registered BEFORE /:id routes
// ──────────────────────────────────────────────────────────────────────────────
router.post('/deals/:dealId/approvals/seed', authenticate, requireAdminOrAnalyst, async (req, res) => {
  try {
    const { assetClass } = req.body;
    const items = await approvalsService.seedForDeal(req.params.dealId, assetClass);
    return res.status(201).json({
      success: true,
      data: items,
      message: `Seeded ${items.length} approval items`,
    });
  } catch (err) {
    console.error('approvals.routes seedForDeal error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /deals/:dealId/approvals
// ──────────────────────────────────────────────────────────────────────────────
router.post('/deals/:dealId/approvals', authenticate, requireAdminOrAnalyst, async (req, res) => {
  try {
    const approvalType = req.body.approval_type || req.body.approvalType;
    const { name } = req.body;
    if (!approvalType || !name) {
      return res.status(400).json({ success: false, message: 'approval_type and name are required' });
    }

    const item = await approvalsService.create(req.params.dealId, {
      ...req.body,
      approval_type: approvalType,
    });
    return res.status(201).json({ success: true, data: item });
  } catch (err) {
    console.error('approvals.routes create error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /deals/:dealId/approvals/:id
// ──────────────────────────────────────────────────────────────────────────────
router.put('/deals/:dealId/approvals/:id', authenticate, requireAdminOrAnalyst, async (req, res) => {
  try {
    const item = await approvalsService.update(req.params.id, req.body);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Approval item not found' });
    }
    return res.json({ success: true, data: item });
  } catch (err) {
    console.error('approvals.routes update error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /deals/:dealId/approvals/:id
// ──────────────────────────────────────────────────────────────────────────────
router.delete('/deals/:dealId/approvals/:id', authenticate, requireAdminOrAnalyst, async (req, res) => {
  try {
    const deleted = await approvalsService.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Approval item not found' });
    }
    return res.json({ success: true, data: { id: deleted.id } });
  } catch (err) {
    console.error('approvals.routes delete error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
