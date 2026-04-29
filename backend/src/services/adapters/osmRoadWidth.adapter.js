'use strict';

/**
 * T6 — OSM Overpass road-width adapter.
 *
 * Given a parcel centroid (lat/lng), query the OpenStreetMap Overpass API for
 * highways within a radius and return a confidence-tagged road-width inference.
 *
 * Critical constraints (CLAUDE.md hard rules):
 *   - This is INFERRED data, never authoritative. The caller MUST surface it
 *     as "OSM-inferred — verify on site."
 *   - Confidence is conservative. We do not lift it above 0.55 even on a
 *     direct width=N tag, because OSM crowdsourcing is variable in India.
 *   - Returns null fields gracefully when OSM has nothing — no fabricated
 *     numbers.
 *
 * Width-derivation policy (in order of preference):
 *   1. Explicit `width=N` tag (in metres) on the closest highway.
 *   2. Lane-derived: `lanes=N` × 3.0m (Indian urban lane standard).
 *   3. Highway-class default (residential ≈ 6m, tertiary ≈ 8m, secondary ≈
 *      10m, primary ≈ 12m). Lowest confidence.
 *
 * The adapter NEVER mutates property records. Caller decides whether to
 * promote the inferred value into the buildability pipeline.
 */

const axios = require('axios');

const OVERPASS_BASE_URL = process.env.OSM_OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const REQUEST_TIMEOUT_MS = Number(process.env.OSM_OVERPASS_TIMEOUT_MS || 12000);
const SEARCH_RADIUS_M = Number(process.env.OSM_ROAD_SEARCH_RADIUS_M || 80);

// Indian urban lane width — used when OSM tags `lanes=N` but no `width=N`.
const LANE_WIDTH_M = 3.0;

// Conservative defaults by highway class. Below 0.4 confidence — analyst
// must verify on site before reliance.
const HIGHWAY_DEFAULTS = {
  motorway:       { width: 30.0, confidence: 0.50 },
  trunk:          { width: 18.0, confidence: 0.50 },
  primary:        { width: 12.0, confidence: 0.45 },
  secondary:      { width: 10.0, confidence: 0.40 },
  tertiary:       { width: 8.0,  confidence: 0.40 },
  unclassified:   { width: 6.0,  confidence: 0.35 },
  residential:    { width: 6.0,  confidence: 0.35 },
  service:        { width: 4.0,  confidence: 0.30 },
  living_street:  { width: 4.0,  confidence: 0.30 },
};

const ROAD_TYPE_PRIORITY = [
  'motorway', 'trunk', 'primary', 'secondary',
  'tertiary', 'unclassified', 'residential', 'service', 'living_street',
];

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/**
 * Build the Overpass QL query — fetch every highway way within radius.
 * `out tags` is enough; we don't need geometry for width inference.
 */
const buildQuery = ({ lat, lng, radius }) => `
[out:json][timeout:${Math.floor(REQUEST_TIMEOUT_MS / 1000)}];
(
  way(around:${radius},${lat},${lng})[highway];
);
out tags ${SEARCH_RADIUS_M < 200 ? 'qt' : ''};
`.trim();

/**
 * Pick the most authoritative way out of the candidate set:
 *   1. Highest priority highway class.
 *   2. Tie-break by presence of explicit width or lanes tag.
 */
const selectBestWay = (ways = []) => {
  if (!ways.length) return null;

  const ranked = ways
    .map((way) => {
      const tags = way.tags || {};
      const highway = String(tags.highway || '').toLowerCase();
      const priority = ROAD_TYPE_PRIORITY.indexOf(highway);
      return {
        way,
        tags,
        highway,
        priority: priority === -1 ? 999 : priority,
        hasWidth: Boolean(toFiniteNumber(tags.width)),
        hasLanes: Boolean(toFiniteNumber(tags.lanes)),
        nameTag: tags.name || tags['name:en'] || null,
      };
    })
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.hasWidth !== b.hasWidth) return a.hasWidth ? -1 : 1;
      if (a.hasLanes !== b.hasLanes) return a.hasLanes ? -1 : 1;
      return 0;
    });

  return ranked[0] || null;
};

/**
 * Derive a width estimate from the chosen way's tags. Returns the inferred
 * value plus the derivation method (so the caller can surface it as a chip).
 */
const deriveWidth = (best) => {
  if (!best) return null;
  const tags = best.tags;

  const explicitWidth = toFiniteNumber(tags.width);
  if (explicitWidth && explicitWidth > 0) {
    return {
      width_m: Math.round(explicitWidth * 100) / 100,
      lanes: toFiniteNumber(tags.lanes),
      method: 'explicit_width_tag',
      confidence: 0.55,
    };
  }

  const lanes = toFiniteNumber(tags.lanes);
  if (lanes && lanes > 0) {
    return {
      width_m: Math.round(lanes * LANE_WIDTH_M * 100) / 100,
      lanes,
      method: 'lanes_times_3m',
      confidence: 0.45,
    };
  }

  const fallback = HIGHWAY_DEFAULTS[best.highway];
  if (fallback) {
    return {
      width_m: fallback.width,
      lanes: null,
      method: 'highway_class_default',
      confidence: fallback.confidence,
    };
  }

  return null;
};

/**
 * Public adapter entrypoint. Always resolves (never rejects); errors are
 * embedded in the returned object so the cache layer can write a row.
 */
const fetchRoadWidth = async ({ lat, lng } = {}) => {
  const numericLat = toFiniteNumber(lat);
  const numericLng = toFiniteNumber(lng);

  if (numericLat === null || numericLng === null) {
    return {
      provider: 'osm_overpass',
      status: 'error',
      message: 'OSM road-width inference needs valid latitude and longitude.',
      candidate_count: 0,
      inferred_width_m: null,
      inferred_lanes: null,
      inferred_highway: null,
      derivation_method: null,
      confidence: 0,
      raw: null,
    };
  }

  let response;
  try {
    response = await axios.post(
      OVERPASS_BASE_URL,
      `data=${encodeURIComponent(buildQuery({ lat: numericLat, lng: numericLng, radius: SEARCH_RADIUS_M }))}`,
      {
        timeout: REQUEST_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
  } catch (error) {
    return {
      provider: 'osm_overpass',
      status: 'error',
      message: error?.message ? `OSM Overpass error: ${error.message}` : 'OSM Overpass request failed.',
      candidate_count: 0,
      inferred_width_m: null,
      inferred_lanes: null,
      inferred_highway: null,
      derivation_method: null,
      confidence: 0,
      raw: null,
    };
  }

  const ways = Array.isArray(response.data?.elements) ? response.data.elements : [];

  if (!ways.length) {
    return {
      provider: 'osm_overpass',
      status: 'no_road_nearby',
      message: `No highways found within ${SEARCH_RADIUS_M}m of the parcel centroid in OSM.`,
      candidate_count: 0,
      inferred_width_m: null,
      inferred_lanes: null,
      inferred_highway: null,
      derivation_method: null,
      confidence: 0,
      raw: response.data,
    };
  }

  const best = selectBestWay(ways);
  const derived = deriveWidth(best);

  if (!derived) {
    return {
      provider: 'osm_overpass',
      status: 'ambiguous',
      message: 'OSM returned highways but no width or lanes tags could be derived. Manual road width entry required.',
      candidate_count: ways.length,
      inferred_width_m: null,
      inferred_lanes: null,
      inferred_highway: best?.highway || null,
      inferred_road_name: best?.nameTag || null,
      derivation_method: null,
      confidence: 0,
      raw: response.data,
    };
  }

  return {
    provider: 'osm_overpass',
    status: 'matched',
    message: `OSM-inferred road width via ${derived.method.replace(/_/g, ' ')}. Treat as reference only — verify on site.`,
    candidate_count: ways.length,
    inferred_width_m: derived.width_m,
    inferred_lanes: derived.lanes,
    inferred_highway: best.highway,
    inferred_road_name: best.nameTag,
    derivation_method: derived.method,
    confidence: derived.confidence,
    raw: response.data,
  };
};

module.exports = {
  fetchRoadWidth,
  // Exported for tests
  selectBestWay,
  deriveWidth,
  HIGHWAY_DEFAULTS,
};
