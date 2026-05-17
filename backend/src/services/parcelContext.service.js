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

const BENGALURU_BBOX = {
  // Rough conservative bbox around the BMA. If a geocoded point falls
  // outside this, we mark `withinBbmp = false` and skip the BBMP-specific
  // derivations (street index, ward, BBMP zone).
  minLat: 12.70,
  maxLat: 13.30,
  minLng: 77.30,
  maxLng: 77.95,
};

const isWithinBmaApprox = ({ lat, lng }) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= BENGALURU_BBOX.minLat &&
  lat <= BENGALURU_BBOX.maxLat &&
  lng >= BENGALURU_BBOX.minLng &&
  lng <= BENGALURU_BBOX.maxLng;

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

// Best-effort PD lookup by address fuzz. Returns null on no-match so the
// frontend can show "Select planning district" instead of guessing.
const matchPlanningDistrict = async (addressTokens) => {
  if (!addressTokens.length) return null;
  try {
    const result = await query(
      `SELECT id, pd_code, pd_name, city
       FROM regulatory_data.planning_districts
       WHERE city = 'Bengaluru'`,
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

// Enrich the matched PD with its demographics from the evidence_facts
// aggregate (planning_districts fact) shipped in PR A2.
const enrichPdWithDemographics = async (matched) => {
  if (!matched) return null;
  try {
    const r = await query(
      `SELECT fact_value
       FROM regulatory_data.evidence_facts
       WHERE fact_type = 'rmp_table'
         AND fact_key  = 'planning_districts'
         AND jsonb_typeof(fact_value) = 'array'
       ORDER BY jsonb_array_length(fact_value) DESC
       LIMIT 1`,
    );
    const arr = Array.isArray(r.rows[0]?.fact_value) ? r.rows[0].fact_value : [];
    const entry = arr.find((e) => {
      const a = String(e?.pd_code || '').replace(/[\s-]/g, '').toLowerCase();
      const b = String(matched.pd_code || '').replace(/[\s-]/g, '').toLowerCase();
      return a && a === b;
    });
    if (!entry) return matched;
    return {
      ...matched,
      population_2011: entry.population_2011 ?? null,
      area_ha: entry.area_ha ?? null,
      gross_density_pph: entry.gross_density_pph ?? null,
      wards_in_pd: entry.wards_in_pd ?? null,
      villages_count: entry.villages_count ?? null,
      notes: entry.notes ?? null,
    };
  } catch (err) {
    return matched;
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
  const withinBmaApprox = hasCoords && isWithinBmaApprox(coords);

  // Tokens used for street-index + PD fuzzy matching. Prefer the
  // formatted address from Google because it's normalised.
  const tokens = extractAddressTokens(coords.formatted_address || trimmedAddress);

  // ─── Step 2-5: parallel data fetches ───────────────────────────────
  // K-GIS needs lat/lng. Street index + PD + warnings don't.
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
    withinBmaApprox && tokens.length
      ? masterplanService
          .searchBbmpStreets({ search: tokens[0], limit: 5 })
          .catch(() => ({ rows: [], summary: {} }))
      : Promise.resolve({ rows: [], summary: {} }),
    withinBmaApprox ? matchPlanningDistrict(tokens) : Promise.resolve(null),
    fetchApplicableCallouts(),
  ]);

  // Enrich PD with demographics (separate await so we can use the matched
  // PD's pd_code).
  const planningDistrict = await enrichPdWithDemographics(pdMatched);

  // ─── Synthesise BBMP street + ward ──────────────────────────────────
  // Pick the best fuzzy hit on the BBMP street index. We rely on the
  // service's existing trigram + ILIKE ordering — the first row is the
  // best candidate.
  const streetRows = Array.isArray(streetIndexResult?.rows) ? streetIndexResult.rows : [];
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

  // ─── Assemble payload ──────────────────────────────────────────────
  return {
    inputs: {
      address: trimmedAddress,
      lat: numLat,
      lng: numLng,
    },
    coordinates: coords,
    bbmpJurisdiction: {
      withinBbmp: withinBmaApprox,
      detection_method: hasCoords ? 'bma_bbox_check' : 'unknown',
      bbox: BENGALURU_BBOX,
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
      search_summary: streetIndexResult?.summary || null,
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
    applicableWarnings: callouts,
    verifyLinks,
    aiDisclaimer:
      'AI-assisted parcel context — every derived value carries a source + confidence. Verify against the linked authority portals before quoting in IC memos.',
    derivedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
  };
}

module.exports = {
  deriveParcelContextFromAddress,
  // Exported for tests
  _internal: {
    isWithinBmaApprox,
    extractAddressTokens,
    scorePdAgainstAddress,
  },
};
