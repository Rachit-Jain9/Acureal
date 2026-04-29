const express = require('express');
const { body, query: qv } = require('express-validator');
const propertyService = require('../services/property.service');
const parcelIntelligenceService = require('../services/parcelIntelligence.service');
const parcelVerifyService = require('../services/parcelIntelligenceVerify.service');
const parcelNarrativeService = require('../services/parcelNarrative.service');
const { authenticate, requireAdminOrAnalyst } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');
const {
  PROPERTY_TYPES,
  ZONING_TYPES,
  AREA_UNITS,
  normalizePropertyType,
  normalizeAreaUnit,
} = require('../constants/domain');

const router = express.Router();

// GET /properties
router.get(
  '/',
  authenticate,
  [
    qv('city').optional().trim(),
    qv('state').optional().trim(),
    qv('zoning').optional().isIn(ZONING_TYPES),
    qv('propertyType').optional().customSanitizer(normalizePropertyType).isIn(PROPERTY_TYPES),
    qv('geocodeStatus')
      .optional()
      .isIn(['pending', 'matched', 'verified', 'approximate', 'failed', 'manual', 'insufficient_data']),
    qv('search').optional().trim(),
    qv('page').optional().isInt({ min: 1 }),
    qv('limit').optional().isInt({ min: 1, max: 500 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const filters = {
        city: req.query.city,
        state: req.query.state,
        zoning: req.query.zoning,
        propertyType: req.query.propertyType,
        geocodeStatus: req.query.geocodeStatus,
        search: req.query.search,
        minArea: req.query.minArea,
        maxArea: req.query.maxArea,
      };
      const pagination = { page: req.query.page, limit: req.query.limit };
      const result = await propertyService.getProperties(filters, pagination);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /properties
router.post(
  '/',
  authenticate,
  requireAdminOrAnalyst,
  [
    body('name').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
    body('address').optional({ values: 'falsy' }).trim(),
    body('city').optional({ values: 'falsy' }).trim(),
    body('state').optional({ values: 'falsy' }).trim(),
    body('propertyType').optional().customSanitizer(normalizePropertyType).isIn(PROPERTY_TYPES).withMessage('Invalid property type'),
    body('zoning').optional().isIn(ZONING_TYPES).withMessage('Invalid zoning type'),
    body('landAreaSqft').optional().isFloat({ min: 0.01 }).withMessage('Land area must be positive'),
    body('landAreaValue').optional().isFloat({ min: 0.01 }).withMessage('Land area must be positive'),
    body('landAreaUnit').optional().customSanitizer(normalizeAreaUnit).isIn(AREA_UNITS).withMessage('Invalid land area unit'),
    body('circleRatePerSqft').optional().isFloat({ min: 0 }),
    body('permissibleFsi').optional().isFloat({ min: 0, max: 20 }),
    body('pid').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
    body('khataNo').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
    body('bhoomiId').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
    body('reraRegistrationNumber').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
    body('frontageMtrs').optional().isFloat({ min: 0 }),
    body('depthMtrs').optional().isFloat({ min: 0 }),
    body('lat').optional().isFloat({ min: -90, max: 90 }),
    body('lng').optional().isFloat({ min: -180, max: 180 }),
    body('zoneId').optional({ nullable: true }).custom((v) => v === null || typeof v === 'string'),
    body('zoneNotes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const property = await propertyService.createProperty(req.body, req.user.id);
      res.status(201).json({ success: true, message: 'Property created.', data: property });
    } catch (error) {
      next(error);
    }
  }
);

// GET /properties/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const property = await propertyService.getPropertyById(req.params.id);
    res.json({ success: true, data: property });
  } catch (error) {
    next(error);
  }
});

// GET /properties/:id/parcel-intelligence
router.get('/:id/parcel-intelligence', authenticate, async (req, res, next) => {
  try {
    const intelligence = await parcelIntelligenceService.getParcelIntelligence(req.params.id, req.user.id);
    res.json({ success: true, data: intelligence });
  } catch (error) {
    next(error);
  }
});

// POST /properties/:id/parcel-intelligence/refresh
router.post('/:id/parcel-intelligence/refresh', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const intelligence = await parcelIntelligenceService.refreshParcelIntelligence(req.params.id, req.user.id);
    res.json({ success: true, message: 'Parcel intelligence refreshed.', data: intelligence });
  } catch (error) {
    next(error);
  }
});

// POST /properties/:id/parcel-intelligence/narrative
// Generates a Claude-summarised executive narrative of the deterministic
// snapshot. Carries an explicit "AI-assisted — requires human review"
// disclaimer (CLAUDE.md hard rule).
router.post(
  '/:id/parcel-intelligence/narrative',
  authenticate,
  requireAdminOrAnalyst,
  async (req, res, next) => {
    try {
      const result = await parcelNarrativeService.generateNarrative({
        propertyId: req.params.id,
        userId: req.user.id,
        dealId: req.body?.deal_id || null,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /properties/:id/parcel-intelligence/verifications
// Lists manual verifications attached to the latest snapshot.
router.get('/:id/parcel-intelligence/verifications', authenticate, async (req, res, next) => {
  try {
    const result = await parcelVerifyService.listVerifications(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// POST /properties/:id/parcel-intelligence/verify-item
// One-click verify for a Needs-Verification item.
router.post(
  '/:id/parcel-intelligence/verify-item',
  authenticate,
  requireAdminOrAnalyst,
  [
    body('itemKey').isString().trim().notEmpty(),
    body('documentId').optional({ nullable: true }).isUUID(),
    body('externalUrl')
      .optional({ nullable: true, values: 'falsy' })
      .isURL({ require_protocol: true })
      .isLength({ max: 2000 }),
    body('notes').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const link = await parcelVerifyService.verifyItem({
        propertyId: req.params.id,
        itemKey: req.body.itemKey,
        documentId: req.body.documentId || null,
        externalUrl: req.body.externalUrl || null,
        notes: req.body.notes || null,
        userId: req.user.id,
      });
      res.status(201).json({ success: true, message: 'Item verified.', data: link });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /properties/:id/parcel-intelligence/verifications/:linkId
router.delete(
  '/:id/parcel-intelligence/verifications/:linkId',
  authenticate,
  requireAdminOrAnalyst,
  async (req, res, next) => {
    try {
      const result = await parcelVerifyService.removeVerification({
        propertyId: req.params.id,
        linkId: req.params.linkId,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /properties/:id
router.put(
  '/:id',
  authenticate,
  requireAdminOrAnalyst,
  [
    body('name').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
    body('address').optional({ values: 'falsy' }).trim(),
    body('city').optional({ values: 'falsy' }).trim(),
    body('state').optional({ values: 'falsy' }).trim(),
    body('propertyType').optional().customSanitizer(normalizePropertyType).isIn(PROPERTY_TYPES),
    body('zoning').optional().isIn(ZONING_TYPES),
    body('landAreaSqft').optional().isFloat({ min: 0.01 }),
    body('landAreaValue').optional().isFloat({ min: 0.01 }),
    body('landAreaUnit').optional().customSanitizer(normalizeAreaUnit).isIn(AREA_UNITS),
    body('circleRatePerSqft').optional().isFloat({ min: 0 }),
    body('permissibleFsi').optional().isFloat({ min: 0, max: 20 }),
    body('pid').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
    body('khataNo').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
    body('bhoomiId').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
    body('reraRegistrationNumber').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
    body('frontageMtrs').optional().isFloat({ min: 0 }),
    body('depthMtrs').optional().isFloat({ min: 0 }),
    body('lat').optional().isFloat({ min: -90, max: 90 }),
    body('lng').optional().isFloat({ min: -180, max: 180 }),
    body('zoneId').optional({ nullable: true }).custom((v) => v === null || typeof v === 'string'),
    body('zoneNotes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const property = await propertyService.updateProperty(req.params.id, req.body, req.user.id);
      res.json({ success: true, message: 'Property updated.', data: property });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /properties/:id
router.delete('/:id', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const result = await propertyService.deleteProperty(req.params.id);
    res.json({ success: true, message: 'Property deleted.', data: result });
  } catch (error) {
    next(error);
  }
});

// POST /properties/:id/geocode
router.post('/:id/geocode', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const property = await propertyService.geocodePropertyAddress(req.params.id);
    res.json({ success: true, message: 'Property geocoded successfully.', data: property });
  } catch (error) {
    next(error);
  }
});

// POST /properties/bulk-geocode  — re-geocodes all non-manual properties (admin only)
router.post('/bulk-geocode', authenticate, requireAdminOrAnalyst, async (req, res, next) => {
  try {
    const results = await propertyService.bulkGeocodeProperties();
    res.json({ success: true, message: `Geocoded ${results.success}/${results.total} properties.`, data: results });
  } catch (error) {
    next(error);
  }
});

// GET /properties/geocode/search — server-side Places Autocomplete proxy
// Keeps the Google Maps API key server-side only. Frontend sends address text;
// this endpoint returns suggestions without exposing the key to the browser.
router.get('/geocode/search', authenticate, async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || String(q).trim().length < 3) {
      return res.status(400).json({ success: false, message: 'Query must be at least 3 characters.' });
    }

    const axios = require('axios');
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey || !apiKey.startsWith('AIza')) {
      // Fallback to Nominatim when Google not configured
      const resp = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: { q: `${q}, India`, format: 'json', limit: 5, countrycodes: 'in', addressdetails: 1 },
        headers: { 'User-Agent': 'REDIP/1.0' },
        timeout: 8000,
      });
      const suggestions = (resp.data || []).map((r) => ({
        description: r.display_name,
        place_id: null,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        source: 'nominatim',
      }));
      return res.json({ success: true, suggestions });
    }

    // Google Places Autocomplete
    const resp = await axios.get('https://maps.googleapis.com/maps/api/place/autocomplete/json', {
      params: { input: q, components: 'country:in', key: apiKey, language: 'en' },
      timeout: 8000,
    });

    if (resp.data.status === 'OK' || resp.data.status === 'ZERO_RESULTS') {
      const suggestions = (resp.data.predictions || []).map((p) => ({
        description: p.description,
        place_id: p.place_id,
        source: 'google',
      }));
      return res.json({ success: true, suggestions });
    }

    res.json({ success: true, suggestions: [] });
  } catch (err) {
    next(err);
  }
});

// GET /properties/geocode/place/:placeId — resolve a Place ID to coordinates
router.get('/geocode/place/:placeId', authenticate, async (req, res, next) => {
  try {
    const axios = require('axios');
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey || !apiKey.startsWith('AIza')) {
      return res.status(503).json({ success: false, message: 'Geocoding provider not configured. Contact admin.' });
    }

    const resp = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
      params: {
        place_id: req.params.placeId,
        fields: 'geometry,formatted_address,address_components,place_id',
        key: apiKey,
      },
      timeout: 8000,
    });

    if (resp.data.status !== 'OK') {
      return res.status(400).json({ success: false, message: 'Place lookup failed.', status: resp.data.status });
    }

    const result = resp.data.result;
    const comps = result.address_components || [];
    const get = (type) => comps.find((c) => c.types.includes(type))?.long_name || null;

    res.json({
      success: true,
      place_id: result.place_id,
      formatted_address: result.formatted_address,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      locality: get('sublocality_level_1') || get('sublocality') || get('neighborhood'),
      city: get('locality') || get('administrative_area_level_2'),
      state: get('administrative_area_level_1'),
      country: get('country'),
      postal_code: get('postal_code'),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
