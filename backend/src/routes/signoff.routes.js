'use strict';

const express = require('express');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const { SIGNOFF_ROLES, SIGNOFF_STATUSES } = require('../constants/domain');
const signoffService = require('../services/signoff.service');

const router = express.Router();

// GET /deals/:dealId/signoffs
router.get('/deals/:dealId/signoffs', authenticate, async (req, res, next) => {
  try {
    const items = await signoffService.listByDeal(req.params.dealId);
    return res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
});

// POST /deals/:dealId/signoffs/seed — seed the standard professional sign-off set
router.post('/deals/:dealId/signoffs/seed', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const items = await signoffService.seedForDeal(req.params.dealId);
    return res.status(201).json({
      success: true,
      data: items,
      message: `Seeded ${items.length} sign-off${items.length === 1 ? '' : 's'}`,
    });
  } catch (err) {
    next(err);
  }
});

// POST /deals/:dealId/signoffs
router.post('/deals/:dealId/signoffs', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const role = req.body.professional_role || req.body.professionalRole;
    const { scope } = req.body;
    if (!role || !SIGNOFF_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: 'A valid professional_role is required' });
    }
    if (!scope || !String(scope).trim()) {
      return res.status(400).json({ success: false, message: 'scope is required' });
    }
    const item = await signoffService.create(req.params.dealId, { ...req.body, professional_role: role });
    return res.status(201).json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
});

// PUT /deals/:dealId/signoffs/:id
router.put('/deals/:dealId/signoffs/:id', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    if (req.body.status !== undefined && !SIGNOFF_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const role = req.body.professional_role || req.body.professionalRole;
    if (role !== undefined && role !== null && !SIGNOFF_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid professional_role' });
    }
    const item = await signoffService.update(req.params.id, req.body);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Sign-off not found' });
    }
    return res.json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
});

// DELETE /deals/:dealId/signoffs/:id
router.delete('/deals/:dealId/signoffs/:id', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const deleted = await signoffService.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Sign-off not found' });
    }
    return res.json({ success: true, data: { id: deleted.id } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
