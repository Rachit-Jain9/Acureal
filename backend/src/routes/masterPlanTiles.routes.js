'use strict';

/**
 * Master-Plan tile proxy (Master-Plan Map integration — 2026-06-15).
 *
 * Serves the Bengaluru RMP 2015 Proposed-Land-Use raster as same-origin XYZ
 * tiles so REDIP's existing Leaflet maps can render it as a labeled REFERENCE
 * overlay. This is a thin, public, cached passthrough — NOT an authoritative
 * zone source (CLAUDE.md: master-plan visuals are reference, verify against the
 * official sheet; the deterministic resolver remains the source of truth).
 *
 * NOTE on the current default: the FRONTEND loads the Map Warper RMP-2015 tiles
 * CLIENT-SIDE (Map Warper's community server returns 403 to server-side/datacenter
 * fetches — including Vercel's egress — so this proxy can't reach it from prod;
 * the browser fetches them from the user's own IP, which Map Warper serves). Map
 * Warper is allow-listed in vercel.json `img-src` for that direct load.
 *
 * This proxy remains the path for REDIP-SELF-HOSTED tiles: host the rectified
 * tiles on REDIP storage (Supabase Storage / Vercel Blob — which Vercel CAN
 * fetch), set `MASTER_PLAN_RMP2015_TILE_BASE` to that base, and point the
 * frontend `VITE_MASTER_PLAN_TILE_URL` at `/api/master-plan-tiles/rmp2015/...`.
 * Its advantages then: same-origin (CSP-clean), CDN `s-maxage` caching, and a
 * single swappable upstream env — without re-hitting Map Warper per user.
 *
 * Public + unauthenticated by design: tiles are loaded as plain <img> GETs that
 * cannot carry the org header, and a public government raster holds no tenant
 * data. Mounted in server.js with its own relaxed limiter BEFORE the general
 * /api limiter (one map view = 20–60 tiles; the 120/min general cap would
 * throttle panning).
 */

const express = require('express');

const router = express.Router();

// Swappable upstream base. Default = Map Warper layer 2147 ("Bengaluru RMP 2015
// PLU" — BDA Revised Master Plan 2015 Proposed Land Use, base year 2007, 77
// rectified sheets). To self-host later, set this env to a REDIP-owned XYZ base.
const RMP2015_TILE_BASE = (process.env.MASTER_PLAN_RMP2015_TILE_BASE
  || 'https://mapwarper.net/layers/tile/2147').replace(/\/+$/, '');

// Coverage bbox (Map Warper layer 2147 extent). Tiles outside it are blank, so
// we short-circuit them to 204 (Leaflet renders transparent) — saves an
// upstream hop for the whole rest of the world.
const RMP2015_BBOX = { west: 77.379326, south: 12.743347, east: 77.859283, north: 13.190987 };

const MIN_Z = 9;
const MAX_Z = 19;
const UPSTREAM_TIMEOUT_MS = 8000;

// Map Warper returns 403 to the default Node/undici `User-Agent: node`. A polite,
// identifying Mozilla-compatible UA is accepted (verified) — we are proxying
// public reference tiles on behalf of a browser map.
const UPSTREAM_USER_AGENT = 'Mozilla/5.0 (compatible; REDIP-tile-proxy/1.0; +https://redip.vercel.app)';

// Web-Mercator XYZ tile → lon/lat of its NW corner.
const tileNwLonLat = (x, y, z) => {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lon, lat };
};

// Does tile (z,x,y) intersect the RMP-2015 coverage bbox?
const tileIntersectsBbox = (z, x, y) => {
  const nw = tileNwLonLat(x, y, z);
  const se = tileNwLonLat(x + 1, y + 1, z);
  const west = nw.lon;
  const north = nw.lat;
  const east = se.lon;
  const south = se.lat;
  return !(
    east < RMP2015_BBOX.west
    || west > RMP2015_BBOX.east
    || north < RMP2015_BBOX.south
    || south > RMP2015_BBOX.north
  );
};

const isIntStr = (v) => /^\d{1,9}$/.test(String(v));

router.get('/rmp2015/:z/:x/:y.png', async (req, res) => {
  const { z, x, y } = req.params;

  // 1. Strict integer validation — only validated ints are ever interpolated
  //    into the upstream URL (SSRF / path-traversal guard).
  if (!isIntStr(z) || !isIntStr(x) || !isIntStr(y)) {
    return res.status(400).json({ success: false, message: 'Invalid tile coordinates.' });
  }
  const zi = Number(z);
  const xi = Number(x);
  const yi = Number(y);

  // 2. Zoom clamp + XY range guard.
  const maxIndex = 2 ** zi;
  if (zi < MIN_Z || zi > MAX_Z || xi >= maxIndex || yi >= maxIndex) {
    return res.status(204).end();
  }

  // 3. Fast bbox cull — blank everywhere outside the BDA extent.
  if (!tileIntersectsBbox(zi, xi, yi)) {
    res.set('Cache-Control', 'public, max-age=86400, s-maxage=604800');
    return res.status(204).end();
  }

  // Defensive: global fetch is present on Node 18+ (Vercel runtime); degrade to
  // a transparent tile rather than a 500 if it's somehow absent.
  if (typeof fetch !== 'function') {
    return res.status(204).end();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${RMP2015_TILE_BASE}/${zi}/${xi}/${yi}.png`, {
      signal: controller.signal,
      headers: { Accept: 'image/png,image/*', 'User-Agent': UPSTREAM_USER_AGENT },
    });
    if (!upstream.ok) {
      // Upstream miss/blank (often 404 for unrectified tiles) → transparent.
      return res.status(204).end();
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/png');
    // Long CDN cache: repeats are served from Vercel's edge, not re-proxied.
    res.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    res.set('X-Tile-Source', 'Map Warper 2147 — BDA RMP 2015 PLU (community-georeferenced reference)');
    return res.status(200).end(buf);
  } catch (err) {
    // Timeout / network error → transparent tile, never a broken-image icon.
    return res.status(204).end();
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;
module.exports.RMP2015_BBOX = RMP2015_BBOX;
// Exposed for unit tests (pure logic — no network).
module.exports.__test = {
  tileNwLonLat,
  tileIntersectsBbox,
  isIntStr,
  RMP2015_BBOX,
  RMP2015_TILE_BASE,
  MIN_Z,
  MAX_Z,
  handler: router.stack.find((l) => l.route)?.route?.stack?.[0]?.handle || null,
};
