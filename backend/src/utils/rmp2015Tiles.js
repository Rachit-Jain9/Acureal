'use strict';

/**
 * RMP 2015 tile geometry — pure, deterministic, no network.
 *
 * Shared by the master-plan tile proxy (which serves tiles) and the mirror
 * script (which populates Acureal-owned storage from Map Warper). Keeping the
 * Web-Mercator math + the coverage bbox in one place means the proxy's bbox
 * cull and the mirror's work-list can never drift apart.
 *
 * Coverage = Map Warper layer 2147 ("Bengaluru RMP 2015 PLU" — BDA Revised
 * Master Plan 2015 Proposed Land Use, base year 2007, 77 rectified sheets).
 */

// Coverage bbox (Map Warper layer 2147 extent / BDA LPA core).
const RMP2015_BBOX = { west: 77.379326, south: 12.743347, east: 77.859283, north: 13.190987 };

// Zoom band. MIN_Z..PROXY_MAX_Z is what the proxy will serve (upscaling beyond
// the mirrored native level). MIRROR_MAX_Z is the deepest native level we
// actually fetch + store — env-overridable to trade storage for crispness.
const MIN_Z = 9;
const PROXY_MAX_Z = 19;
const MIRROR_MAX_Z = (() => {
  const v = Number(process.env.MASTER_PLAN_MIRROR_MAX_Z);
  return Number.isInteger(v) && v >= MIN_Z && v <= 18 ? v : 15;
})();

// Deterministic storage key for a tile (same layout the proxy expects under its
// MASTER_PLAN_RMP2015_TILE_BASE).
const tileStorageKey = (z, x, y) => `master-plan/rmp2015/${z}/${x}/${y}.png`;

// Web-Mercator XYZ tile → lon/lat of its NW corner.
const tileNwLonLat = (x, y, z) => {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lon, lat };
};

// lon/lat → the XYZ tile index containing it, at zoom z.
const lonToTileX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToTileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z);
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

// Inclusive XY tile-index range covering the bbox at zoom z (clamped to valid
// indices). Lets the enumerator scan only the relevant window, not the world.
const bboxTileRange = (z) => {
  const max = 2 ** z - 1;
  const clamp = (v) => Math.max(0, Math.min(max, v));
  return {
    xMin: clamp(lonToTileX(RMP2015_BBOX.west, z)),
    xMax: clamp(lonToTileX(RMP2015_BBOX.east, z)),
    yMin: clamp(latToTileY(RMP2015_BBOX.north, z)), // north → smaller y
    yMax: clamp(latToTileY(RMP2015_BBOX.south, z)),
  };
};

/**
 * Every tile (z in [zMin, zMax]) whose extent intersects the coverage bbox —
 * the mirror's work-list. Bounded by bboxTileRange so it never scans the whole
 * world; the per-tile intersect test trims the bbox's corners.
 */
function enumerateTiles(zMin = MIN_Z, zMax = MIRROR_MAX_Z) {
  const tiles = [];
  for (let z = zMin; z <= zMax; z += 1) {
    const { xMin, xMax, yMin, yMax } = bboxTileRange(z);
    for (let x = xMin; x <= xMax; x += 1) {
      for (let y = yMin; y <= yMax; y += 1) {
        if (tileIntersectsBbox(z, x, y)) tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

const isIntStr = (v) => /^\d{1,9}$/.test(String(v));

module.exports = {
  RMP2015_BBOX,
  MIN_Z,
  PROXY_MAX_Z,
  MIRROR_MAX_Z,
  tileStorageKey,
  tileNwLonLat,
  lonToTileX,
  latToTileY,
  tileIntersectsBbox,
  bboxTileRange,
  enumerateTiles,
  isIntStr,
};
