'use strict';

/**
 * RMP 2015 tile geometry util — pure-logic coverage (no network).
 * Shared by the tile proxy and the mirror script; this guards the work-list.
 */

const {
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
} = require('../src/utils/rmp2015Tiles');

describe('rmp2015Tiles — constants', () => {
  test('bbox matches the Map Warper layer-2147 extent', () => {
    expect(RMP2015_BBOX).toEqual({ west: 77.379326, south: 12.743347, east: 77.859283, north: 13.190987 });
  });

  test('zoom band is sane', () => {
    expect(MIN_Z).toBe(9);
    expect(PROXY_MAX_Z).toBe(19);
    expect(MIRROR_MAX_Z).toBeGreaterThanOrEqual(MIN_Z);
    expect(MIRROR_MAX_Z).toBeLessThanOrEqual(18);
  });

  test('storage key is the deterministic layout the proxy expects', () => {
    expect(tileStorageKey(12, 2930, 1899)).toBe('master-plan/rmp2015/12/2930/1899.png');
  });
});

describe('rmp2015Tiles — projection round-trip', () => {
  test('lon/lat → tile index → NW corner is consistent for Bengaluru', () => {
    const z = 14;
    const lng = 77.5946;
    const lat = 12.9716;
    const x = lonToTileX(lng, z);
    const y = latToTileY(lat, z);
    const nw = tileNwLonLat(x, y, z);
    // The NW corner of the containing tile must be just west/north of the point.
    expect(nw.lon).toBeLessThanOrEqual(lng);
    expect(nw.lat).toBeGreaterThanOrEqual(lat);
    // And the next tile's NW corner must be past the point.
    const nwNext = tileNwLonLat(x + 1, y + 1, z);
    expect(nwNext.lon).toBeGreaterThan(lng);
    expect(nwNext.lat).toBeLessThan(lat);
  });
});

describe('rmp2015Tiles — bboxTileRange', () => {
  test('range is ordered and within valid tile indices', () => {
    for (const z of [9, 12, 15]) {
      const r = bboxTileRange(z);
      const max = 2 ** z - 1;
      expect(r.xMin).toBeLessThanOrEqual(r.xMax);
      expect(r.yMin).toBeLessThanOrEqual(r.yMax);
      expect(r.xMin).toBeGreaterThanOrEqual(0);
      expect(r.xMax).toBeLessThanOrEqual(max);
      expect(r.yMax).toBeLessThanOrEqual(max);
    }
  });
});

describe('rmp2015Tiles — enumerateTiles', () => {
  test('every enumerated tile actually intersects the bbox', () => {
    const tiles = enumerateTiles(9, 13);
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.z).toBeGreaterThanOrEqual(9);
      expect(t.z).toBeLessThanOrEqual(13);
      expect(tileIntersectsBbox(t.z, t.x, t.y)).toBe(true);
    }
  });

  test('tile count grows monotonically with zoom (≈4× per level)', () => {
    const count = (z) => enumerateTiles(z, z).length;
    const c11 = count(11);
    const c12 = count(12);
    const c13 = count(13);
    expect(c12).toBeGreaterThan(c11);
    expect(c13).toBeGreaterThan(c12);
  });

  test('produces no duplicate tiles', () => {
    const tiles = enumerateTiles(9, 12);
    const keys = new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`));
    expect(keys.size).toBe(tiles.length);
  });
});

describe('rmp2015Tiles — isIntStr', () => {
  test('accepts integers, rejects traversal/floats/negatives', () => {
    expect(isIntStr('13')).toBe(true);
    expect(isIntStr('../etc')).toBe(false);
    expect(isIntStr('13.5')).toBe(false);
    expect(isIntStr('-1')).toBe(false);
  });
});
