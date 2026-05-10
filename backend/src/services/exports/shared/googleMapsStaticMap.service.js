'use strict';

/**
 * Google Maps Static API wrapper.
 *
 * Renders site / comps / infrastructure-proximity maps as PNG buffers
 * that PPTX/DOCX builders embed inline. Uses the Google Maps Static API
 * which is a stable, URL-based image endpoint (no client-side rendering,
 * no headless browser, no native dependencies).
 *
 * Why Google instead of Mapbox? The earlier Mapbox path repeatedly hit
 * 422 errors on long marker labels and required a separate token. Google
 * Maps Static API is already authorized in the project (`GOOGLE_MAPS_API_KEY`
 * env var), accepts any single alphanumeric label, and supports rich URL-
 * based custom styling — so we can match the deck's editorial palette
 * (cream landscape, hairline roads, soft blue water).
 *
 * Editorial style:
 *   - Landscape  → paper warm cream
 *   - Roads       → white fill, hairline grey stroke
 *   - Water       → soft slate blue
 *   - POIs        → off (clean canvas)
 *   - Transit     → simplified
 *   - Borders     → muted outline
 *
 * Caching: in-process LRU keyed by URL. Map images for the same deal
 * generated multiple times during a single export request will be hit
 * from memory.
 *
 * Error handling: never throws. Returns a structured result so callers
 * can distinguish "no token" from "token but Maps API not enabled" from
 * "valid request but coords out of range" — and surface the actual cause
 * in the export's placeholder rather than a generic "not configured."
 */

const axios = require('axios');

const GOOGLE_MAPS_BASE = 'https://maps.googleapis.com/maps/api/staticmap';
const REQUEST_TIMEOUT_MS = 8000;

const isGoogleMapsEnabled = () => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  return typeof key === 'string' && key.length > 0 && !/^your[_-]/i.test(key);
};

// Tiny LRU — bounded so a long-running serverless instance doesn't grow
// memory unbounded. Map images are 200KB – 1.5MB each.
const CACHE_LIMIT = 30;
const cache = new Map();

const cacheGet = (key) => {
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
};

const cacheSet = (key, value) => {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
};

const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);

const clampLatitude = (lat) => Math.max(-85, Math.min(85, lat));
const clampLongitude = (lng) => {
  if (lng >= -180 && lng <= 180) return lng;
  let normalized = ((lng + 180) % 360 + 360) % 360 - 180;
  if (Number.isNaN(normalized)) normalized = 0;
  return normalized;
};

// Editorial map style — desaturated palette matching the deck. Each rule
// is a `feature[:element]|property:value` triple per the Google Maps
// Static API styling syntax. Shipped as a constant so test stays in sync.
const EDITORIAL_STYLE = Object.freeze([
  'feature:landscape|color:0xF1F4F7',
  'feature:landscape.man_made|color:0xE5E9EE',
  'feature:landscape.natural|color:0xEEF2F0',
  'feature:water|color:0xCBD5E1',
  'feature:road|color:0xFFFFFF',
  'feature:road|element:geometry.stroke|color:0xD7DDE5|weight:0.5',
  'feature:road.highway|element:geometry.fill|color:0xF5F0E5',
  'feature:road.highway|element:geometry.stroke|color:0xC4B89A',
  'feature:road|element:labels.text.fill|color:0x52606D',
  'feature:road|element:labels.text.stroke|color:0xFFFFFF',
  'feature:poi|visibility:off',
  'feature:transit|visibility:simplified',
  'feature:transit|element:labels|visibility:off',
  'feature:administrative|element:geometry.stroke|color:0xB7C0CC|weight:0.6',
  'feature:administrative.locality|element:labels.text.fill|color:0x1F2933',
  'feature:administrative.country|element:labels.text.fill|color:0x52606D',
]);

// Google's marker `label` parameter accepts a single uppercase alpha-
// numeric character. Anything else is invalid (no Maki names, no
// multi-char labels). Sanitise: take the first matching char or drop.
const sanitiseLabel = (raw) => {
  if (raw == null) return '';
  const text = String(raw).trim();
  if (!text) return '';
  const match = text.match(/[A-Za-z0-9]/);
  return match ? match[0].toUpperCase() : '';
};

/**
 * Build a Google Maps Static API URL for the given centre + zoom +
 * markers. Pure function — exposed for testing.
 */
const buildGoogleMapsUrl = ({
  lat,
  lng,
  zoom = 15,
  width = 640,
  height = 480,
  markers = [],
  scale = 2,
  mapType = 'roadmap',
  style = EDITORIAL_STYLE,
} = {}) => {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    throw new Error('googleMapsStaticMap: lat/lng must be finite numbers');
  }
  const safeZoom = Math.max(0, Math.min(20, zoom));
  // Google Maps Static API caps free-tier size at 640x640 (or 2048 with Premium).
  const safeWidth = Math.max(1, Math.min(640, Math.round(width)));
  const safeHeight = Math.max(1, Math.min(640, Math.round(height)));
  const safeScale = scale === 4 ? 4 : (scale === 2 ? 2 : 1);

  const params = new URLSearchParams();
  params.append('center', `${clampLatitude(lat)},${clampLongitude(lng)}`);
  params.append('zoom', String(safeZoom));
  params.append('size', `${safeWidth}x${safeHeight}`);
  params.append('scale', String(safeScale));
  params.append('maptype', mapType);

  // Editorial style
  (Array.isArray(style) ? style : []).forEach((rule) => {
    if (typeof rule === 'string' && rule.length > 0) params.append('style', rule);
  });

  // Markers
  (Array.isArray(markers) ? markers : []).forEach((m) => {
    if (!m || !isFiniteNumber(m.lat) || !isFiniteNumber(m.lng)) return;
    const colour = String(m.color || 'B5793C').replace(/^#/, '').toUpperCase();
    const label = sanitiseLabel(m.label);
    const sizeMod = m.size === 's' ? '|size:small' : (m.size === 'tiny' ? '|size:tiny' : '|size:mid');
    const labelMod = label ? `|label:${label}` : '';
    params.append(
      'markers',
      `color:0x${colour}${labelMod}${sizeMod}|${clampLatitude(m.lat)},${clampLongitude(m.lng)}`,
    );
  });

  return `${GOOGLE_MAPS_BASE}?${params.toString()}`;
};

const fetchMapPng = async (url, key) => {
  const cached = cacheGet(url);
  if (cached) return cached;

  const response = await axios.get(url, {
    params: { key },
    responseType: 'arraybuffer',
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: (status) => status >= 200 && status < 300,
  });
  const buffer = Buffer.from(response.data);
  cacheSet(url, buffer);
  return buffer;
};

/**
 * Render a single-marker site map. Returns a structured result so
 * callers can distinguish failure modes — see staticMap.service.js for
 * the same pattern (this is the Google equivalent).
 *
 * @returns {Promise<{buffer: Buffer|null, status: 'ok'|'no_token'|'no_coords'|'fetch_failed', error: string|null, httpStatus: number|null}>}
 */
const renderSiteMapDetailed = async ({ lat, lng, zoom = 15, label = '' } = {}) => {
  if (!isGoogleMapsEnabled()) {
    return {
      buffer: null,
      status: 'no_token',
      error: 'GOOGLE_MAPS_API_KEY env var not set or placeholder.',
      httpStatus: null,
    };
  }
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    return {
      buffer: null,
      status: 'no_coords',
      error: 'Latitude or longitude is not a finite number.',
      httpStatus: null,
    };
  }
  const url = buildGoogleMapsUrl({
    lat,
    lng,
    zoom,
    markers: [{ lat, lng, color: 'B5793C', label, size: 'mid' }],
  });
  try {
    const buffer = await fetchMapPng(url, process.env.GOOGLE_MAPS_API_KEY);
    return { buffer, status: 'ok', error: null, httpStatus: 200 };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[googleMapsStaticMap.renderSiteMap] failed:', err.message);
    const httpStatus = err?.response?.status || null;
    let friendly = err.message || 'Unknown Google Maps error';
    if (httpStatus === 401 || httpStatus === 403) {
      friendly = 'Google Maps returned 401/403 — API key invalid, or the Maps Static API is not enabled in your Google Cloud project. Enable it at console.cloud.google.com → APIs & Services.';
    } else if (httpStatus === 400) {
      friendly = 'Google Maps returned 400 — request rejected (likely an invalid style rule or a coordinate out of range).';
    } else if (httpStatus === 429) {
      friendly = 'Google Maps returned 429 — rate-limit hit. Daily quota exhausted on this key.';
    } else if (httpStatus >= 500) {
      friendly = `Google Maps returned ${httpStatus} — service-side issue, retry later.`;
    } else if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      friendly = 'Network timeout reaching Google Maps after 8s.';
    }
    return { buffer: null, status: 'fetch_failed', error: friendly, httpStatus };
  }
};

/**
 * Back-compat wrapper that returns just the buffer (or null). New code
 * should prefer `renderSiteMapDetailed` so the export can show the
 * actual reason to the user when a map fails to render.
 */
const renderSiteMap = async (args) => {
  const { buffer } = await renderSiteMapDetailed(args);
  return buffer;
};

const __resetCache = () => cache.clear();

module.exports = {
  isGoogleMapsEnabled,
  buildGoogleMapsUrl,
  renderSiteMap,
  renderSiteMapDetailed,
  EDITORIAL_STYLE,
  __resetCache,
};
