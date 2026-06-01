'use strict';

/**
 * Parcel Context Auto-Derive Orchestrator
 * ---------------------------------------
 * Single-call backend that takes either an address or (lat, lng) and
 * fans out to every authoritative dataset already loaded in REDIP:
 *
 *   1. Coordinates       — geocodeAddress() (Google + Nominatim fallback)
 *   2. K-GIS hierarchy   — fetchKgisContext()  (taluk/village/survey + geometry)
 *   3. BBMP street index — searchBbmpStreets() (street → ward + BBMP zone A-F + guidance value)
 *   4. Planning District — planningDistricts + evidence_facts (best-effort by address fuzz)
 *   5. Applicable warns  — evidence_facts (heritage/SDZ/NGT/PRR at city level)
 *   6. Verify links      — buildVerificationLinks() (Kaveri/Bhoomi/BBMP-eAasthi/RERA/K-GIS/Google sat)
 *
 * Returns ONE structured payload the frontend AutoFillParcelContextCard
 * can render with per-field source chips + confidence + edit controls.
 *
 * Honesty rules (per CLAUDE.md):
 *   - Never fabricate a zone if we can't determine it spatially.
 *   - Master plan zone (use-classification + FSI) is NOT auto-derived
 *     because master_plan_zones.geom is not populated yet — the response
 *     carries "manual selection required" instead of a guess.
 *   - Every derived value carries source + confidence so reviewers can
 *     tell apart "from gazette" vs "fuzzy address match" vs "K-GIS heuristic".
 */

const { query } = require('../config/database');
const { geocodeAddress } = require('../utils/geocode');
const { fetchKgisContext } = require('./adapters/kgis.adapter');
const masterplanService = require('./masterplan.service');
const { buildVerificationLinks } = require('../utils/parcelVerificationLinks');

// BBMP (Bruhat Bengaluru Mahanagara Palike) city-corporation bbox.
// Tightened 2026-05-18 from the prior BMA-wide rectangle (12.70-13.30,
// 77.30-77.95) — that rectangle included all of BMA (Bangalore
// Metropolitan Area), which covers neighbouring Planning Authorities
// like Anekal, Hosakote, Nelamangala, Magadi, Kanakapura, Devanahalli,
// Doddaballapur. Jigani-style addresses (lat ~12.78) landed inside the
// loose bbox even though they're Anekal Planning Authority, not BBMP.
//
// New bounds approximate BBMP's 198-ward jurisdiction. Sources:
//   - BBMP ward map (RMP 2031 Volume 4)
//   - BMA / BBMP overlay published at K-GIS
// The bbox is intentionally a hair generous so genuine fringe BBMP
// wards aren't false-negative; the K-GIS-taluk override below catches
// the false-positives the bbox lets through.
const BBMP_BBOX = {
  minLat: 12.83,  // BBMP South Zone (Banashankari fringe)
  maxLat: 13.14,  // BBMP North Zone (Yelahanka new town fringe)
  minLng: 77.45,  // BBMP West Zone (Vijayanagar fringe)
  maxLng: 77.78,  // BBMP East Zone (Whitefield / Marathahalli fringe)
};

// Taluks that fall inside the BBMP bbox (false-positives) but are
// actually governed by a separate Planning Authority. K-GIS returns
// the taluk for any coordinate; we use that to override the bbox
// check when K-GIS data is available.
//
// Bangalore Urban district taluks that ARE BBMP:
//   Bangalore North, Bangalore South, Bangalore East, Yelahanka,
//   Krishnarajapuram, Mahadevapura, Bommanahalli, Dasarahalli.
// Everything else in or adjacent to BMA is NOT BBMP.
const NON_BBMP_TALUKS = new Set([
  'anekal',           // Anekal PA — Jigani, Bommasandra, Hosa Road
  'hosakote',         // Hosakote PA — east, towards Whitefield-Hoskote rd
  'nelamangala',      // Nelamangala PA — northwest
  'magadi',           // Magadi PA — west
  'kanakapura',       // Kanakapura PA — southwest
  'devanahalli',      // Devanahalli PA — north, near airport
  'doddaballapur',    // Doddaballapur PA — far north
  'doddaballapura',   // alternate spelling sometimes returned by K-GIS
  'ramanagara',       // Ramanagara — even further west
  'bidadi',           // Bidadi PA — far west
]);

const isWithinBbmpBbox = ({ lat, lng }) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= BBMP_BBOX.minLat &&
  lat <= BBMP_BBOX.maxLat &&
  lng >= BBMP_BBOX.minLng &&
  lng <= BBMP_BBOX.maxLng;

// Decide whether the coordinate is inside BBMP city limits using a
// two-stage check:
//   Stage 1: BBMP bbox (rough). If outside → definitely outside.
//   Stage 2: K-GIS taluk (authoritative). If the taluk K-GIS returned
//            is a known non-BBMP Planning Authority, override the
//            bbox's "yes" answer to "no" and surface the taluk in the
//            reason so the frontend can render a specific banner.
//
// If K-GIS is unavailable or returned no taluk, fall back to bbox only.
const detectBbmpJurisdiction = (coords, kgisHierarchy) => {
  if (!Number.isFinite(coords?.lat) || !Number.isFinite(coords?.lng)) {
    return { withinBbmp: false, detection_method: 'unknown', reason: null };
  }
  const insideBbox = isWithinBbmpBbox(coords);
  if (!insideBbox) {
    return {
      withinBbmp: false,
      detection_method: 'bbmp_bbox_check',
      reason: 'Coordinate falls outside the BBMP city-limits bbox.',
    };
  }
  const taluk = kgisHierarchy?.taluk ? String(kgisHierarchy.taluk).trim().toLowerCase() : null;
  if (taluk && NON_BBMP_TALUKS.has(taluk)) {
    return {
      withinBbmp: false,
      detection_method: 'kgis_taluk_override',
      reason: `K-GIS placed this coordinate in ${kgisHierarchy.taluk} taluk, which is governed by a separate Planning Authority (not BBMP). BBMP street index, ward, and zone lookups are skipped.`,
      kgis_taluk: kgisHierarchy.taluk,
    };
  }
  return {
    withinBbmp: true,
    detection_method: taluk ? 'bbox_plus_kgis_taluk_confirmed' : 'bbmp_bbox_check',
    reason: null,
    kgis_taluk: kgisHierarchy?.taluk || null,
  };
};

// Backwards-compat shim — kept for unit tests that referenced the
// pre-2026-05-18 helper. Now an alias for the tighter BBMP bbox check.
const isWithinBmaApprox = isWithinBbmpBbox;

// Minimum geocoder confidence required before we run BBMP street index /
// planning-district lookups on the returned coordinates. Calibrated from
// the Jigani screenshot bug (2026-05-18) where a Nominatim city-fallback
// at 45% confidence resolved to central Bengaluru — and the downstream
// BBMP ward / zone / PD lookups all chained on those wrong coords,
// producing IC-defensibility-breaking output ("Ward 109 / Zone B from
// North Park Road / PD-08 northeast inner urban" for a south-of-city
// Jigani address). Anything below 0.7 is treated as point-uncertain and
// the BBMP-specific lookups are skipped.
const GEOCODE_TRUST_THRESHOLD = 0.7;

const isCoordinateTrustworthy = (coords) => {
  if (!coords) return false;
  // Caller-supplied lat/lng are 1.0 by construction — trust them.
  if (coords.source === 'caller_supplied') return true;
  // Geocoder results need both a numeric confidence above the threshold
  // AND a non-"approximate" status. Google's city-level fallback returns
  // status='approximate' even when confidence reads 0.45.
  const numericOk = typeof coords.confidence === 'number' && coords.confidence >= GEOCODE_TRUST_THRESHOLD;
  const statusOk = coords.status !== 'approximate' && coords.status !== 'failed' && coords.status !== 'error';
  return numericOk && statusOk;
};

// Pull the salient address tokens for searching the BBMP street index.
// Drops stop-words like "Bengaluru/Bangalore/India/Karnataka" because
// those would dominate the trigram similarity score.
const STREET_INDEX_STOPWORDS = new Set([
  'india', 'karnataka', 'bengaluru', 'bangalore', 'bbmp', 'bda',
  'road', 'rd', 'street', 'st', 'cross', 'main', 'lane', 'ln',
]);
const extractAddressTokens = (text) => {
  if (!text) return [];
  return String(text)
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => s.split(/\s+/))
    .filter((t) => t.length >= 3 && !STREET_INDEX_STOPWORDS.has(t.toLowerCase()))
    .slice(0, 8);
};

// Score a planning district against an address by counting how many of
// the address tokens appear inside the PD's name/description string.
const scorePdAgainstAddress = (pd, addressTokens) => {
  const haystack = `${pd.pd_name || ''}`.toLowerCase();
  let hits = 0;
  for (const tok of addressTokens) {
    if (haystack.includes(tok.toLowerCase())) hits += 1;
  }
  return hits;
};

// Normalize a free-text place string to the canonical form stored in
// district_localities.locality_norm (lowercase, alphanumerics only) so a
// geocoded address can be substring-matched against the curated index.
const normalizeLocalityText = (text) =>
  String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// PRIMARY Planning-District resolver. Substring-matches the geocoded address
// against regulatory_data.district_localities — the curated locality -> PD
// index seeded VERBATIM from RMP 2031 Vol-4 PDR + Index Map (authoritative BDA
// numbering). Most-specific (longest) locality wins. When the same locality
// name maps to >1 PD (cross-boundary village names) the match is flagged
// ambiguous and confidence is reduced. Returns null on no-match OR if the
// table is not present yet — callers fall back to the name-fuzz heuristic, so
// this is safe to deploy before the seed migration is applied.
const matchPlanningDistrictByLocality = async (addressText) => {
  const norm = normalizeLocalityText(addressText);
  if (norm.length < 4) return null;
  try {
    const result = await query(
      `SELECT pd_code, pd_name, pd_number, locality, confidence, kind,
              length(locality_norm) AS spec
         FROM regulatory_data.district_localities
        WHERE city = 'Bengaluru'
          AND length(locality_norm) >= 4
          AND position(locality_norm IN $1) > 0
        ORDER BY spec DESC, (confidence = 'high') DESC, (kind = 'pd_label') DESC`,
      [norm],
    );
    const rows = result.rows || [];
    if (!rows.length) return null;
    const best = rows[0];
    const sameName = rows.filter(
      (r) => normalizeLocalityText(r.locality) === normalizeLocalityText(best.locality),
    );
    const ambiguous = new Set(sameName.map((r) => r.pd_code)).size > 1;
    return {
      pd_code: best.pd_code,
      pd_name: best.pd_name,
      matched_locality: best.locality,
      confidence: ambiguous ? 0.55 : best.confidence === 'high' ? 0.85 : 0.6,
      ambiguous,
      alternates: rows
        .filter((r) => r.pd_code !== best.pd_code)
        .slice(0, 3)
        .map((r) => ({ pd_code: r.pd_code, pd_name: r.pd_name, matched_locality: r.locality })),
      source: 'locality-index',
    };
  } catch (err) {
    return null;
  }
};

// FALLBACK PD lookup by address-token fuzz against the planning_districts
// registry. Lower precision (name-token presence only) — used only when the
// locality index returns no match. Returns null on no-match so the frontend
// can show "Select planning district" instead of guessing.
const matchPlanningDistrictByNameFuzz = async (addressTokens) => {
  if (!addressTokens.length) return null;
  try {
    const result = await query(
      `SELECT id, pd_code, pd_name, city
       FROM regulatory_data.planning_districts
       WHERE city = 'Bengaluru'
         AND pd_name IS NOT NULL
         AND pd_code NOT ILIKE 'Planning Zone%'
         AND pd_code <> 'Multiple'`,
    );
    const candidates = result.rows
      .map((pd) => ({ pd, score: scorePdAgainstAddress(pd, addressTokens) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!candidates.length) return null;
    const best = candidates[0];
    return {
      pd_code: best.pd.pd_code,
      pd_name: best.pd.pd_name,
      match_score: best.score,
      alternates: candidates.slice(1, 4).map((c) => ({
        pd_code: c.pd.pd_code,
        pd_name: c.pd.pd_name,
        match_score: c.score,
      })),
      confidence: Math.min(0.7, 0.3 + 0.15 * best.score),
      source: 'address-token-fuzz',
    };
  } catch (err) {
    // PD table missing or some other issue — degrade gracefully.
    return null;
  }
};

// Orchestrator: locality index first (precise, authoritative), name-token
// fuzz as a backstop. addressText is the geocoded formatted address (or raw
// input); addressTokens feed the fuzz fallback.
const matchPlanningDistrict = async (addressTokens, addressText) => {
  const byLocality = await matchPlanningDistrictByLocality(addressText);
  if (byLocality) return byLocality;
  return matchPlanningDistrictByNameFuzz(addressTokens || []);
};

// Per-district Existing Land-Use mix (RMP PD report, 2015 baseline). Joined to
// a resolved planning district by PD code; present only for the 7 central PDs
// (PD-01..PD-07) that have a digitised report. Reference / pending review —
// surfaced with the same "verify before IC" caveat the rest of the card uses.
const fetchPdExistingLandUse = async (pdCode) => {
  const digits = String(pdCode || '').replace(/\D/g, '');
  // Compare by integer, not string — facts store 'PD-01' (→ '01') while a
  // resolved PD code may be '1'/'PD-1'/'PD-01'. '01' !== '1' as text.
  const pdInt = digits ? parseInt(digits, 10) : null;
  if (pdInt == null) return null;
  try {
    const r = await query(
      `SELECT fact_value
         FROM regulatory_data.evidence_facts
        WHERE fact_type = 'pd_existing_land_use'
          AND NULLIF(regexp_replace(fact_value->>'pd_code', '\\D', '', 'g'), '')::int = $1
        LIMIT 1`,
      [pdInt],
    );
    const fv = r.rows[0]?.fact_value;
    if (!fv || !Array.isArray(fv.categories)) return null;
    const categories = fv.categories
      .filter((c) => Number(c.pct) > 0)
      .sort((a, b) => Number(b.pct) - Number(a.pct))
      .map((c) => ({ category: c.category, pct: Number(c.pct), area_ha: Number(c.area_ha) }));
    if (categories.length === 0) return null;
    return {
      baseline_year: fv.baseline_year ?? 2015,
      total_area_ha: fv.total_area_ha ?? null,
      categories,
      source: 'RMP 2031 planning-district report (2015 existing-use baseline)',
    };
  } catch (err) {
    return null;
  }
};

// Enrich the matched PD with its demographics from the evidence_facts
// aggregate (planning_districts fact) shipped in PR A2.
const enrichPdWithDemographics = async (matched) => {
  if (!matched) return null;
  // Existing land-use mix joined by PD code (present for PD-01..PD-07 only).
  const existing_land_use = await fetchPdExistingLandUse(matched.pd_code);
  try {
    // Two 42-element planning_districts arrays exist in evidence_facts (the
    // rich PDR demographics + a code/name routing list). Both share the same
    // length, so ordering by length alone is a non-deterministic tie that
    // flipped the DOCX Demographics section between full and blank. Prefer
    // the array whose first element actually carries population_2011.
    const r = await query(
      `SELECT fact_value
       FROM regulatory_data.evidence_facts
       WHERE fact_type = 'rmp_table'
         AND fact_key  = 'planning_districts'
         AND jsonb_typeof(fact_value) = 'array'
       ORDER BY jsonb_exists(fact_value -> 0, 'population_2011') DESC,
                jsonb_array_length(fact_value) DESC,
                id ASC
       LIMIT 1`,
    );
    const arr = Array.isArray(r.rows[0]?.fact_value) ? r.rows[0].fact_value : [];
    // Compare by the numeric PD index so 'PD-08', 'PD 8', and '8' all match.
    const pdNum = (code) => {
      const digits = String(code || '').replace(/\D/g, '');
      return digits ? parseInt(digits, 10) : null;
    };
    const matchedNum = pdNum(matched.pd_code);
    const entry = matchedNum != null
      ? arr.find((e) => pdNum(e?.pd_code) === matchedNum)
      : null;
    if (!entry) return { ...matched, existing_land_use };
    return {
      ...matched,
      population_2011: entry.population_2011 ?? null,
      area_ha: entry.area_ha ?? null,
      gross_density_pph: entry.gross_density_pph ?? null,
      wards_in_pd: entry.wards_in_pd ?? null,
      villages_count: entry.villages_count ?? null,
      notes: entry.notes ?? null,
      existing_land_use,
    };
  } catch (err) {
    return { ...matched, existing_land_use };
  }
};

// Surface the city-level callout facts (SDZ corridors, heritage zones,
// NGT classification, regional parks, PRR) so the deal team can verify
// each one against the parcel's location. NOT spatial — we don't have
// polygons. Returns each callout as a "warning to verify" item.
const fetchApplicableCallouts = async () => {
  try {
    const r = await query(
      `SELECT fact_type, fact_key, fact_value, source_section, page_number, confidence_score
       FROM regulatory_data.evidence_facts
       WHERE fact_type IN ('sdz', 'heritage', 'environmental', 'road_network')
         AND fact_key IN (
           'special_development_zones',
           'heritage_zones',
           'regional_parks',
           'ngt_drainage_classification',
           'peripheral_ring_road'
         )`,
    );
    return r.rows.map((row) => {
      const kindLabels = {
        sdz: 'Special Development Zone',
        heritage: 'Heritage proximity',
        environmental: row.fact_key.includes('ngt') ? 'NGT drainage buffer' : 'Regional park / environmental',
        road_network: 'PRR / road alignment',
      };
      const severityMap = {
        sdz: 'medium',
        heritage: 'high',
        environmental: 'high',
        road_network: 'medium',
      };
      const valueCount = Array.isArray(row.fact_value) ? row.fact_value.length : 1;
      return {
        kind: kindLabels[row.fact_type] || row.fact_key,
        fact_type: row.fact_type,
        fact_key: row.fact_key,
        severity: severityMap[row.fact_type] || 'medium',
        item_count: valueCount,
        source_section: row.source_section,
        source_page: row.page_number,
        confidence_score: row.confidence_score ? Number(row.confidence_score) : null,
        verification_required: true,
        message: `${kindLabels[row.fact_type] || row.fact_key} (${valueCount} item${valueCount === 1 ? '' : 's'} city-wide) — verify whether this parcel falls within or near.`,
        fact_value: row.fact_value, // full data so the frontend can render the inventory
      };
    });
  } catch (err) {
    return [];
  }
};

// Main entry point. All steps are wrapped in best-effort try/catch so a
// single upstream failure (e.g. K-GIS timeout) doesn't drop the whole
// response — the caller still gets a useful payload with the gap clearly
// marked.
async function deriveParcelContextFromAddress({ address, lat, lng } = {}) {
  const startedAt = Date.now();
  const trimmedAddress = address ? String(address).trim() : null;
  const numLat = lat === null || lat === undefined || lat === '' ? null : Number(lat);
  const numLng = lng === null || lng === undefined || lng === '' ? null : Number(lng);

  if (!trimmedAddress && (!Number.isFinite(numLat) || !Number.isFinite(numLng))) {
    const error = new Error('Provide either an address or (lat, lng).');
    error.statusCode = 400;
    throw error;
  }

  // ─── Step 1: resolve coordinates ────────────────────────────────────
  let coords = {
    lat: Number.isFinite(numLat) ? numLat : null,
    lng: Number.isFinite(numLng) ? numLng : null,
    source: Number.isFinite(numLat) ? 'caller_supplied' : null,
    confidence: Number.isFinite(numLat) ? 1.0 : null,
    formatted_address: null,
    place_id: null,
  };

  if (!coords.lat && trimmedAddress) {
    try {
      const geo = await geocodeAddress(trimmedAddress, 'Bengaluru', 'Karnataka', null);
      if (geo?.found) {
        coords = {
          lat: geo.lat,
          lng: geo.lng,
          source: geo.provider || 'geocoder',
          confidence: geo.confidence ?? null,
          formatted_address: geo.displayName || null,
          place_id: geo.placeId || null,
          status: geo.status,
        };
      } else {
        coords.status = geo?.status || 'failed';
        coords.message = geo?.message || 'Geocoding failed.';
      }
    } catch (err) {
      coords.status = 'error';
      coords.message = `Geocoder error: ${err.message}`;
    }
  }

  const hasCoords = Number.isFinite(coords.lat) && Number.isFinite(coords.lng);
  const coordinatesTrustworthy = isCoordinateTrustworthy(coords);
  // Provisional BBMP check — uses the tighter BBMP bbox (PR-2 follow-up,
  // 2026-05-18). Final BBMP decision is made AFTER K-GIS returns its
  // taluk, because the bbox can false-positive on Anekal-style fringe
  // addresses that geometrically land inside the rectangle.
  const provisionallyInsideBbmp =
    hasCoords && coordinatesTrustworthy && isWithinBbmpBbox(coords);

  // Tokens used for street-index + PD fuzzy matching. Prefer the
  // formatted address from Google because it's normalised.
  const tokens = extractAddressTokens(coords.formatted_address || trimmedAddress);

  // ─── Step 2-5: parallel data fetches ───────────────────────────────
  // K-GIS gets the coords regardless — it's geographic, not BBMP-scoped,
  // and returns its own confidence + status. Street index / PD lookups
  // are gated on the provisional BBMP check. If K-GIS later reveals the
  // taluk is non-BBMP, we discard the BBMP results (rare and OK — the
  // BBMP search just returns nothing for those addresses anyway).
  const [kgisResult, streetIndexResult, pdMatched, callouts] = await Promise.all([
    hasCoords
      ? fetchKgisContext({ lat: coords.lat, lng: coords.lng }).catch((err) => ({
          provider: 'kgis',
          status: 'error',
          confidence: 0,
          message: `K-GIS error: ${err.message}`,
          hierarchy: null,
          survey_numbers: [],
          geometry_geojson: null,
        }))
      : Promise.resolve(null),
    provisionallyInsideBbmp && tokens.length
      ? masterplanService
          .searchBbmpStreets({ search: tokens[0], limit: 5 })
          .catch(() => ({ rows: [], summary: {} }))
      : Promise.resolve({ rows: [], summary: {} }),
    provisionallyInsideBbmp ? matchPlanningDistrict(tokens, coords.formatted_address || trimmedAddress) : Promise.resolve(null),
    fetchApplicableCallouts(),
  ]);

  // ─── Final BBMP jurisdiction decision (bbox + K-GIS taluk) ──────────
  // Now that K-GIS has returned, apply the two-stage detection. If the
  // taluk override fires, discard BBMP results to avoid surfacing a
  // false "Ward N / Zone X" — the wards in the index are BBMP-only,
  // so any "match" returned for an Anekal address is coincidental
  // (rare since the address tokens won't intersect the BBMP street
  // names) but worth guarding against.
  const bbmpDetection = coordinatesTrustworthy
    ? detectBbmpJurisdiction(coords, kgisResult?.hierarchy)
    : { withinBbmp: false, detection_method: 'low_confidence_geocode_blocked', reason: null };
  const withinBmaApprox = bbmpDetection.withinBbmp;
  // If K-GIS just downgraded us from provisionally-in to confirmed-out
  // (the Jigani case), wipe the BBMP results so the response is honest.
  const finalStreetIndexResult =
    provisionallyInsideBbmp && !withinBmaApprox
      ? { rows: [], summary: streetIndexResult?.summary || {} }
      : streetIndexResult;
  const finalPdMatched =
    provisionallyInsideBbmp && !withinBmaApprox ? null : pdMatched;

  // Enrich PD with demographics (separate await so we can use the matched
  // PD's pd_code). Use finalPdMatched so the K-GIS taluk override
  // correctly nulls the PD when the parcel is outside BBMP.
  const planningDistrict = await enrichPdWithDemographics(finalPdMatched);

  // ─── Synthesise BBMP street + ward ──────────────────────────────────
  // Pick the best fuzzy hit on the BBMP street index. We rely on the
  // service's existing trigram + ILIKE ordering — the first row is the
  // best candidate. Use finalStreetIndexResult so taluk-override
  // empties out the rows when K-GIS confirms non-BBMP jurisdiction.
  const streetRows = Array.isArray(finalStreetIndexResult?.rows) ? finalStreetIndexResult.rows : [];
  const streetMatch = streetRows[0] || null;
  const streetAlternates = streetRows.slice(1, 4);

  const bbmpWard = streetMatch?.ward_no
    ? {
        ward_no: streetMatch.ward_no,
        source: 'bbmp_street_index_match',
        confidence: 0.55, // trigram-derived; analyst should sanity-check
      }
    : null;

  const bbmpZone = streetMatch?.zone_code
    ? {
        zone_code: streetMatch.zone_code,
        zone_name: `Zone ${streetMatch.zone_code}`,
        guidance_value_band_min_inr: streetMatch.guidance_value_band_min_inr ?? null,
        guidance_value_band_max_inr: streetMatch.guidance_value_band_max_inr ?? null,
        source: 'bbmp_street_index_match',
        source_street: streetMatch.street_name_en,
        source_page: streetMatch.page_number,
        confidence: 0.55,
      }
    : null;

  // ─── Verify links ──────────────────────────────────────────────────
  const verifyLinks = buildVerificationLinks({
    property: {
      lat: coords.lat,
      lng: coords.lng,
      address: trimmedAddress,
      city: 'Bengaluru',
    },
    kgis: kgisResult || {},
  });

  // ─── Coordinate-trust gate metadata ─────────────────────────────────
  // Used by the frontend to render an explicit "geocode is approximate,
  // BBMP lookups skipped" banner so the user knows WHY rows are missing
  // and can switch to coords-input mode to recover.
  const coordinatesGate = hasCoords && !coordinatesTrustworthy
    ? {
        gated: true,
        reason: 'low_confidence_geocode',
        threshold: GEOCODE_TRUST_THRESHOLD,
        confidence: coords.confidence ?? null,
        provider: coords.source ?? null,
        message:
          `Geocoder returned an approximate match (confidence ${
            coords.confidence != null ? `${Math.round(coords.confidence * 100)}%` : 'unknown'
          }, ${coords.source || 'unknown source'}). BBMP street index, ward, zone, and Planning District lookups are skipped — those would chain on inaccurate coordinates and produce misleading values. Switch to "By coordinates" and paste a precise lat/lng (e.g. right-click the parcel pin in Google Maps → copy coordinates) to continue.`,
      }
    : { gated: false };

  // Prepend the gate as a high-severity warning so it's the FIRST callout
  // the frontend renders. Better one extra warning than a silent half-
  // truthful field list.
  const allWarnings = coordinatesGate.gated
    ? [
        {
          kind: 'Geocode is approximate',
          fact_type: 'coordinate_uncertainty',
          fact_key: 'low_confidence_geocode',
          severity: 'high',
          item_count: 1,
          source_section: coords.source ?? null,
          source_page: null,
          confidence_score: coords.confidence ?? null,
          verification_required: true,
          message: coordinatesGate.message,
          fact_value: null,
        },
        ...callouts,
      ]
    : callouts;

  // ─── Assemble payload ──────────────────────────────────────────────
  return {
    inputs: {
      address: trimmedAddress,
      lat: numLat,
      lng: numLng,
    },
    coordinates: coords,
    coordinatesGate,
    bbmpJurisdiction: {
      withinBbmp: withinBmaApprox,
      detection_method: coordinatesGate.gated
        ? 'low_confidence_geocode_blocked'
        : bbmpDetection.detection_method,
      reason: bbmpDetection.reason,
      kgis_taluk: bbmpDetection.kgis_taluk || kgisResult?.hierarchy?.taluk || null,
      bbox: BBMP_BBOX,
      ward: bbmpWard,
    },
    streetIndex: {
      match: streetMatch
        ? {
            id: streetMatch.id,
            street_name_en: streetMatch.street_name_en,
            ward_no: streetMatch.ward_no,
            page_number: streetMatch.page_number,
            aro_section: streetMatch.aro_section,
            zone_code: streetMatch.zone_code,
            row_excerpt: streetMatch.row_excerpt,
          }
        : null,
      alternates: streetAlternates.map((r) => ({
        id: r.id,
        street_name_en: r.street_name_en,
        ward_no: r.ward_no,
        zone_code: r.zone_code,
      })),
      search_token_used: tokens[0] || null,
      search_summary: finalStreetIndexResult?.summary || null,
    },
    bbmpZone,
    masterPlanZone: {
      // We don't auto-derive use-classification zones because
      // master_plan_zones.geom is not populated. Surface honestly.
      auto_derived: false,
      reason: 'Master-plan zone polygons not yet imported. Use the Zone Lookup picker on the Zoning tab to assign a use-classification zone manually; FSI rules apply once selected.',
      candidate_zone_codes_in_db: null, // could be populated in a future PR
    },
    planningDistrict,
    kgis: kgisResult,
    applicableWarnings: allWarnings,
    verifyLinks,
    aiDisclaimer:
      'AI-assisted parcel context — every derived value carries a source + confidence. Verify against the linked authority portals before quoting in IC memos.',
    derivedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
  };
}

module.exports = {
  deriveParcelContextFromAddress,
  // PR-NX41 (2026-05-18) — exported for dealExport.service so the DOCX
  // export pipeline can enrich the deal's auto_derived_pd_code with the
  // 2011-census + RMP-table demographics that already live in
  // regulatory_data.evidence_facts. Pre-NX41 the DOCX Demographics
  // section silently fell through to a "manual input required" placeholder
  // for every Bengaluru deal even though the data was present.
  enrichPdWithDemographics,
  // Exported for tests
  _internal: {
    isWithinBmaApprox,        // backwards-compat alias for isWithinBbmpBbox
    isWithinBbmpBbox,
    detectBbmpJurisdiction,
    isCoordinateTrustworthy,
    extractAddressTokens,
    scorePdAgainstAddress,
    normalizeLocalityText,
    matchPlanningDistrictByLocality,
    GEOCODE_TRUST_THRESHOLD,
    BBMP_BBOX,
    NON_BBMP_TALUKS,
  },
};
