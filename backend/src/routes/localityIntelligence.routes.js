'use strict';

/**
 * T8 — Locality intelligence API.
 * Read-only aggregation across the authenticated tenant's deals.
 */

const express = require('express');
const { query: qv } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');
const { getLocalityIntelligence } = require('../services/localityIntelligence.service');

const router = express.Router();

// GET /api/locality-intelligence?locality=Hebbal&city=Bengaluru&exclude_property_id=...
router.get(
  '/',
  authenticate,
  [
    qv('locality').trim().isLength({ min: 2, max: 200 }),
    qv('city').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
    qv('exclude_property_id').optional({ values: 'falsy' }).isUUID(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const result = await getLocalityIntelligence({
        locality: req.query.locality,
        city: req.query.city || null,
        excludePropertyId: req.query.exclude_property_id || null,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
