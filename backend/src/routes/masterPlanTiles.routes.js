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
const {
  RMP2015_BBOX,
  MIN_Z,
  PROXY_MAX_Z,
  tileNwLonLat,
  tileIntersectsBbox,
  isIntStr,
} = require('../utils/rmp2015Tiles');

const router = express.Router();

// Swappable upstream base. Default = Map Warper layer 2147 ("Bengaluru RMP 2015
// PLU" — BDA Revised Master Plan 2015 Proposed Land Use, base year 2007, 77
// rectified sheets). To self-host later, set this env to a REDIP-owned XYZ base.
const RMP2015_TILE_BASE = (process.env.MASTER_PLAN_RMP2015_TILE_BASE
  || 'https://mapwarper.net/layers/tile/2147').replace(/\/+$/, '');

const UPSTREAM_TIMEOUT_MS = 8000;

// Map Warper returns 403 to the default Node/undici `User-Agent: node`. A polite,
// identifying Mozilla-compatible UA is accepted (verified) — we are proxying
// public reference tiles on behalf of a browser map.
const UPSTREAM_USER_AGENT = 'Mozilla/5.0 (compatible; REDIP-tile-proxy/1.0; +https://redip.vercel.app)';

// Tile geometry (coverage bbox, zoom band, coord validation) is shared with the
// mirror script via ../utils/rmp2015Tiles so the two can never drift. Tiles
// outside the bbox are blank → short-circuited to 204 (Leaflet renders them
// transparent), saving an upstream hop for the rest of the world.

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
  if (zi < MIN_Z || zi > PROXY_MAX_Z || xi >= maxIndex || yi >= maxIndex) {
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
    const upstreamHeaders = { Accept: 'image/png,image/*', 'User-Agent': UPSTREAM_USER_AGENT };
    // When the upstream is REDIP-self-hosted tiles on a (private) Vercel Blob
    // store, authenticate with the Blob token. This runs server-side only — the
    // browser receives the bytes same-origin and never sees the token.
    if (/\.blob\.vercel-storage\.com/i.test(RMP2015_TILE_BASE) && process.env.BLOB_READ_WRITE_TOKEN) {
      upstreamHeaders.Authorization = `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`;
    }
    const upstream = await fetch(`${RMP2015_TILE_BASE}/${zi}/${xi}/${yi}.png`, {
      signal: controller.signal,
      headers: upstreamHeaders,
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
  MAX_Z: PROXY_MAX_Z,
  handler: router.stack.find((l) => l.route)?.route?.stack?.[0]?.handle || null,
};
