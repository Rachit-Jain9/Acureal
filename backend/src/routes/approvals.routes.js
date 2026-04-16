'use strict';

const express = require('express');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const approvalsService = require('../services/approvals.service');

const router = express.Router();

// GET /deals/:dealId/approvals
router.get('/deals/:dealId/approvals', authenticate, async (req, res, next) => {
  try {
    const items = await approvalsService.listByDeal(req.params.dealId);
    return res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
});

// POST /deals/:dealId/approvals/seed
router.post('/deals/:dealId/approvals/seed', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const { assetClass } = req.body;
    const items = await approvalsService.seedForDeal(req.params.dealId, assetClass);
    return res.status(201).json({
      success: true,
      data: items,
      message: `Seeded ${items.length} approval items`,
    });
  } catch (err) {
    next(err);
  }
});

// POST /deals/:dealId/approvals
router.post('/deals/:dealId/approvals', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
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
    next(err);
  }
});

// PUT /deals/:dealId/approvals/:id
router.put('/deals/:dealId/approvals/:id', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const item = await approvalsService.update(req.params.id, req.body);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Approval item not found' });
    }
    return res.json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
});

// DELETE /deals/:dealId/approvals/:id
router.delete('/deals/:dealId/approvals/:id', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const deleted = await approvalsService.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Approval item not found' });
    }
    return res.json({ success: true, data: { id: deleted.id } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
