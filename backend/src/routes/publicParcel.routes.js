const express = require('express');

const masterplanService = require('../services/masterplan.service');
const { deriveParcelContextFromAddress } = require('../services/parcelContext.service');
const { findGuidanceMatches } = require('../services/guidance.service');

const router = express.Router();

/**
 * Public parcel evidence — the address-first front door to the Bengaluru
 * evidence base. Public + unauthenticated BY DESIGN, on the master-plan-tiles
 * precedent: every row served here is statutory reference data (the BBMP
 * Guidance-Value gazette street index, the BBMP UAV rate card, IGR guidance
 * values, RMP planning districts) — never tenant data. Requests carry no auth
 * and therefore no request context, so RLS-scoped tables return nothing even
 * if a query were added by mistake; the reference tables carry explicit
 * public-read policies (20260802).
 *
 * Anti-scrape posture (the corpus, not one row, is the asset): per-IP rate
 * limits mounted in server.js; result sets hard-capped at PUBLIC_ROW_LIMIT
 * regardless of what the query asks for; no bulk or export endpoint; the
 * expensive /resolve path (it can trigger a metered geocoder call) carries the
 * strictest limiter. CDN cache headers keep repeat traffic off the function
 * entirely.
 */

const PUBLIC_ROW_LIMIT = 12;
const MAX_QUERY_CHARS = 120;
const MAX_ADDRESS_CHARS = 200;

const cleanText = (value, maxLen) => String(value || '').trim().slice(0, maxLen);

// GET /api/public/parcel/street-lookup?q=&zone=&register=
// The gazette street index: street → ward → register → UAV zone → guidance
// band → exact gazette page. Same service as the in-app evidence room, with a
// public row cap.
router.get('/street-lookup', async (req, res, next) => {
  try {
    const search = cleanText(req.query.q ?? req.query.search, MAX_QUERY_CHARS);
    const data = await masterplanService.searchBbmpStreets({
      search,
      zone: req.query.zone || null,
      register: req.query.register || null,
      limit: PUBLIC_ROW_LIMIT,
    });
    // Reference data changes only when a gazette is re-seeded — let Vercel's
    // CDN absorb repeat lookups (keyed per full URL, so per query).
    res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /api/public/parcel/uav-benchmark
// The BBMP UAV rate card pivoted to a zone × use matrix with ratios vs Zone A.
router.get('/uav-benchmark', async (req, res, next) => {
  try {
    const data = await masterplanService.getUavBenchmark({ city: 'Bengaluru' });
    res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /api/public/parcel/resolve?address=…  (or lat= & lng=)
// The address-first resolver: geocode → locality tokens → BBMP jurisdiction →
// street-index match (ward + UAV zone + gazette citation) → planning district
// with demographics → statutory callouts → IGR guidance-value candidates.
//
// Two deliberate boundaries:
//   • K-GIS is skipped (kgis:false) — its cache is org-scoped, so an
//     unauthenticated call would hammer the live portal per request.
//     Jurisdiction detection degrades to bbox-only and says so in
//     detection_method.
//   • It stops at statutory zoning. Determining the RMP zone from a point
//     needs point-in-polygon against a plan that exists only as a raster —
//     the payload's masterPlanZone block states this honestly, and the page
//     turns the gap into the zoning-certificate upload.
router.get('/resolve', async (req, res, next) => {
  try {
    const address = cleanText(req.query.address, MAX_ADDRESS_CHARS);
    const { lat, lng } = req.query;
    if (!address && !(lat && lng)) {
      return res.status(400).json({
        success: false,
        message: 'Provide an address (or lat and lng).',
      });
    }

    const context = await deriveParcelContextFromAddress(
      { address: address || null, lat, lng },
      { kgis: false },
    );

    // Guidance-value candidates for the stated locality. Fail-open: the
    // resolver payload is useful without them, and findGuidanceMatches
    // already degrades to an honest status on its own.
    let guidance = null;
    try {
      guidance = await findGuidanceMatches({ address, city: 'Bengaluru' });
    } catch {
      guidance = { status: 'unavailable', confidence: 0, matches: [], selected: null, citations: [] };
    }

    res.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.json({ success: true, data: { ...context, guidance } });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
});

module.exports = router;
