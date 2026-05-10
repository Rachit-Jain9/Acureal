'use strict';

/**
 * Mapbox Static Images API wrapper.
 *
 * Renders site / comps / infrastructure-proximity maps as PNG buffers that
 * PPTX/DOCX builders embed inline. Bail-early if `MAPBOX_TOKEN` isn't set —
 * callers receive `null` and the builder skips the map slot rather than
 * shipping a half-rendered placeholder.
 *
 * Style: editorial light grey (`mapbox/light-v11`) — keeps the deck visual
 * weight on the data overlays, not the basemap.
 *
 * Caching: in-process LRU keyed by full URL. Map images for the same deal
 * generated multiple times during a single export request will be hit from
 * memory. The Mapbox free tier (50k loads / month) is more than enough at
 * REDIP's current export volume.
 */

const axios = require('axios');

const MAPBOX_BASE = 'https://api.mapbox.com/styles/v1';
const DEFAULT_STYLE = 'mapbox/light-v11';
const DEFAULT_USERNAME = 'mapbox';
const REQUEST_TIMEOUT_MS = 8000;

const isMapsEnabled = () => {
  const token = process.env.MAPBOX_TOKEN;
  return typeof token === 'string' && token.length > 0 && !/your[_-]/i.test(token);
};

// Tiny LRU — bounded so a long-running serverless instance doesn't grow
// memory unbounded. Map images are 200KB – 1.5MB each; cap at ~30 entries.
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
  // Short-circuit when already in canonical range to avoid floating-point
  // error from the modulo path. Mapbox accepts the full [-180, 180] range
  // verbatim, and most callers pass coordinates already in range.
  if (lng >= -180 && lng <= 180) return lng;
  let normalized = ((lng + 180) % 360 + 360) % 360 - 180;
  if (Number.isNaN(normalized)) normalized = 0;
  return normalized;
};

const buildMarker = (marker) => {
  const size = marker.size === 's' ? 's' : 'l';
  const colour = String(marker.color || 'B5793C').replace(/^#/, '').toLowerCase();
  const label = marker.label ? `-${encodeURIComponent(marker.label)}` : '';
  return `pin-${size}${label}+${colour}(${clampLongitude(marker.lng)},${clampLatitude(marker.lat)})`;
};

/**
 * Build a Mapbox Static Images URL for the given centre + zoom + markers.
 * Pure function — exposed for testing.
 */
const buildMapboxUrl = ({
  lat,
  lng,
  zoom = 14,
  width = 1280,
  height = 720,
  markers = [],
  style = DEFAULT_STYLE,
  retina = true,
}) => {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    throw new Error('staticMap: lat/lng must be finite numbers');
  }
  const safeZoom = Math.max(0, Math.min(22, zoom));
  const safeWidth = Math.max(1, Math.min(1280, Math.round(width)));
  const safeHeight = Math.max(1, Math.min(1280, Math.round(height)));
  const overlays = (Array.isArray(markers) ? markers : [])
    .filter((m) => isFiniteNumber(m?.lat) && isFiniteNumber(m?.lng))
    .map(buildMarker)
    .join(',');
  const overlaySegment = overlays ? `${overlays}/` : '';
  const retinaSuffix = retina ? '@2x' : '';
  const centre = `${clampLongitude(lng)},${clampLatitude(lat)},${safeZoom}`;
  return (
    `${MAPBOX_BASE}/${style}/static/` +
    `${overlaySegment}` +
    `${centre}/` +
    `${safeWidth}x${safeHeight}${retinaSuffix}`
  );
};

const fetchMapPng = async (url, token) => {
  const cached = cacheGet(url);
  if (cached) return cached;

  const response = await axios.get(url, {
    params: { access_token: token },
    responseType: 'arraybuffer',
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: (status) => status >= 200 && status < 300,
  });
  const buffer = Buffer.from(response.data);
  cacheSet(url, buffer);
  return buffer;
};

/**
 * Render a single-marker site map.
 *
 * Returns a structured result so callers can distinguish "no token set"
 * from "token set but Mapbox returned 401" from "token + auth fine but
 * coords were invalid." Without that distinction, downstream slides end
 * up showing a generic "not configured" placeholder even when the
 * actual cause is a bad token / scope / rate limit.
 *
 * @returns {Promise<{buffer: Buffer|null, status: 'ok'|'no_token'|'no_coords'|'fetch_failed', error: string|null, httpStatus: number|null}>}
 */
const renderSiteMapDetailed = async ({ lat, lng, zoom = 15, label = 'Site' } = {}) => {
  if (!isMapsEnabled()) {
    return { buffer: null, status: 'no_token', error: 'MAPBOX_TOKEN env var not set or placeholder.', httpStatus: null };
  }
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    return { buffer: null, status: 'no_coords', error: 'Latitude or longitude is not a finite number.', httpStatus: null };
  }
  const url = buildMapboxUrl({
    lat,
    lng,
    zoom,
    markers: [{ lat, lng, color: 'B5793C', label, size: 'l' }],
  });
  try {
    const buffer = await fetchMapPng(url, process.env.MAPBOX_TOKEN);
    return { buffer, status: 'ok', error: null, httpStatus: 200 };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[staticMap.renderSiteMap] failed:', err.message);
    const httpStatus = err?.response?.status || null;
    let friendly = err.message || 'Unknown Mapbox error';
    if (httpStatus === 401) friendly = 'Mapbox returned 401 — token invalid, expired, or lacking the styles:read scope.';
    else if (httpStatus === 403) friendly = 'Mapbox returned 403 — token rejected (URL restriction, monthly cap reached, or scope mismatch).';
    else if (httpStatus === 422) friendly = 'Mapbox returned 422 — the requested coordinates / overlay are out of range.';
    else if (httpStatus === 429) friendly = 'Mapbox returned 429 — rate-limit hit on this token.';
    else if (httpStatus >= 500) friendly = `Mapbox returned ${httpStatus} — service-side issue, retry or check status.mapbox.com.`;
    else if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') friendly = 'Network timeout reaching Mapbox after 8s.';
    return { buffer: null, status: 'fetch_failed', error: friendly, httpStatus };
  }
};

/**
 * Back-compat wrapper that returns just the buffer (or null). New code
 * should prefer `renderSiteMapDetailed` so it can show the actual reason
 * to the user when a map fails to render.
 */
const renderSiteMap = async (args) => {
  const { buffer } = await renderSiteMapDetailed(args);
  return buffer;
};

/**
 * Render a comps spread map. Centre = site, markers = up to 8 comps.
 * Auto-fits zoom to roughly include all markers (rough log-distance heuristic).
 */
const renderCompsMap = async ({ siteLat, siteLng, comps = [] } = {}) => {
  if (!isMapsEnabled() || !isFiniteNumber(siteLat) || !isFiniteNumber(siteLng)) return null;
  const validComps = (Array.isArray(comps) ? comps : [])
    .filter((c) => isFiniteNumber(c?.lat) && isFiniteNumber(c?.lng))
    .slice(0, 8);

  let zoom = 13;
  if (validComps.length) {
    const maxDist = validComps.reduce((acc, c) => {
      const dx = c.lat - siteLat;
      const dy = c.lng - siteLng;
      return Math.max(acc, Math.sqrt(dx * dx + dy * dy));
    }, 0);
    // crude zoom selection: bigger spread → lower zoom
    if (maxDist < 0.005) zoom = 15;
    else if (maxDist < 0.02) zoom = 13;
    else if (maxDist < 0.08) zoom = 11;
    else zoom = 10;
  }

  const markers = [
    { lat: siteLat, lng: siteLng, color: 'B5793C', label: 'site', size: 'l' },
    ...validComps.map((c, idx) => ({
      lat: c.lat,
      lng: c.lng,
      color: '0F7B5A',
      label: String(idx + 1),
      size: 's',
    })),
  ];

  const url = buildMapboxUrl({ lat: siteLat, lng: siteLng, zoom, markers });
  try {
    return await fetchMapPng(url, process.env.MAPBOX_TOKEN);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[staticMap.renderCompsMap] failed:', err.message);
    return null;
  }
};

/**
 * Render an infrastructure-proximity map. Centre = site, markers = social
 * infra POIs (schools, hospitals, transit, retail, expressway). Caller passes
 * the resolved points (REDIP doesn't fetch POIs from Mapbox — those come from
 * the deal's curated proximity dataset).
 */
const renderInfraMap = async ({ siteLat, siteLng, points = [] } = {}) => {
  if (!isMapsEnabled() || !isFiniteNumber(siteLat) || !isFiniteNumber(siteLng)) return null;
  const validPoints = (Array.isArray(points) ? points : [])
    .filter((p) => isFiniteNumber(p?.lat) && isFiniteNumber(p?.lng))
    .slice(0, 12);

  const markers = [
    { lat: siteLat, lng: siteLng, color: 'B5793C', label: 'site', size: 'l' },
    ...validPoints.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      color: p.color || '52606D',
      label: p.label || '',
      size: 's',
    })),
  ];

  const url = buildMapboxUrl({ lat: siteLat, lng: siteLng, zoom: 13, markers });
  try {
    return await fetchMapPng(url, process.env.MAPBOX_TOKEN);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[staticMap.renderInfraMap] failed:', err.message);
    return null;
  }
};

const __resetCache = () => cache.clear();

module.exports = {
  isMapsEnabled,
  buildMapboxUrl,
  renderSiteMap,
  renderSiteMapDetailed,
  renderCompsMap,
  renderInfraMap,
  __resetCache,
};
