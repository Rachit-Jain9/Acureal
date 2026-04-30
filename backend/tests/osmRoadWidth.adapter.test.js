'use strict';

/**
 * Tests for backend/src/services/adapters/osmRoadWidth.adapter.js (T6).
 *
 * Two layers:
 *   1. Pure-function tests for `selectBestWay`, `deriveWidth`, and the
 *      `HIGHWAY_DEFAULTS` table — exercised directly with synthetic OSM
 *      `way` objects.
 *   2. `fetchRoadWidth` integration tests — axios is mocked so the test
 *      runs without hitting the public Overpass instance. Asserts the
 *      shape of every status branch (error / no_road_nearby / ambiguous /
 *      matched) plus the CLAUDE.md confidence cap of 0.55.
 *
 * The contract this test file enforces is the one downstream code relies
 * on: every return is either a clean error object (with `confidence: 0`)
 * or a `matched`/`ambiguous` object whose `confidence` is conservative
 * (never > 0.55) and `provider` is exactly `'osm_overpass'`.
 */

jest.mock('axios');
const axios = require('axios');

const {
  fetchRoadWidth,
  selectBestWay,
  deriveWidth,
  HIGHWAY_DEFAULTS,
} = require('../src/services/adapters/osmRoadWidth.adapter');

const buildOverpassResponse = (ways = []) => ({
  data: {
    version: 0.6,
    generator: 'Overpass API mock',
    elements: ways,
  },
});

const wayWith = (tags = {}) => ({ id: Math.floor(Math.random() * 1e9), type: 'way', tags });

beforeEach(() => {
  axios.post.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────
// HIGHWAY_DEFAULTS table — sanity check the values match CLAUDE.md
// ─────────────────────────────────────────────────────────────────────────

describe('HIGHWAY_DEFAULTS', () => {
  test('every highway class has a width and confidence', () => {
    Object.entries(HIGHWAY_DEFAULTS).forEach(([cls, def]) => {
      expect(typeof def.width).toBe('number');
      expect(def.width).toBeGreaterThan(0);
      expect(typeof def.confidence).toBe('number');
      expect(def.confidence).toBeGreaterThan(0);
      expect(def.confidence).toBeLessThanOrEqual(0.55); // hard cap from CLAUDE.md
    });
  });

  test('residential is narrower than primary, primary narrower than motorway', () => {
    expect(HIGHWAY_DEFAULTS.residential.width).toBeLessThan(HIGHWAY_DEFAULTS.primary.width);
    expect(HIGHWAY_DEFAULTS.primary.width).toBeLessThan(HIGHWAY_DEFAULTS.motorway.width);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// selectBestWay
// ─────────────────────────────────────────────────────────────────────────

describe('selectBestWay', () => {
  test('returns null on empty input', () => {
    expect(selectBestWay()).toBeNull();
    expect(selectBestWay([])).toBeNull();
  });

  test('prefers higher-priority highway class over lower', () => {
    const ways = [
      wayWith({ highway: 'residential' }),
      wayWith({ highway: 'primary' }),
      wayWith({ highway: 'service' }),
    ];
    const best = selectBestWay(ways);
    expect(best.highway).toBe('primary');
  });

  test('tie-break: way with explicit width wins over way without', () => {
    const ways = [
      wayWith({ highway: 'tertiary', name: 'Sunny Street' }),
      wayWith({ highway: 'tertiary', width: '12', name: 'Tagged Road' }),
    ];
    const best = selectBestWay(ways);
    expect(best.tags.name).toBe('Tagged Road');
    expect(best.hasWidth).toBe(true);
  });

  test('tie-break: way with lanes wins when neither has width', () => {
    const ways = [
      wayWith({ highway: 'tertiary', name: 'Plain' }),
      wayWith({ highway: 'tertiary', lanes: '4', name: 'Laned' }),
    ];
    const best = selectBestWay(ways);
    expect(best.tags.name).toBe('Laned');
    expect(best.hasLanes).toBe(true);
  });

  test('unknown highway class ranks last (priority 999)', () => {
    const ways = [
      wayWith({ highway: 'cycleway' }),
      wayWith({ highway: 'unclassified' }),
    ];
    const best = selectBestWay(ways);
    expect(best.highway).toBe('unclassified');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// deriveWidth
// ─────────────────────────────────────────────────────────────────────────

describe('deriveWidth', () => {
  test('returns null on null input', () => {
    expect(deriveWidth(null)).toBeNull();
    expect(deriveWidth(undefined)).toBeNull();
  });

  test('returns explicit width when width tag present', () => {
    const best = { tags: { width: '11.5', lanes: '2' }, highway: 'tertiary' };
    const derived = deriveWidth(best);
    expect(derived.method).toBe('explicit_width_tag');
    expect(derived.width_m).toBe(11.5);
    expect(derived.lanes).toBe(2);
    expect(derived.confidence).toBe(0.55);
  });

  test('rounds explicit width to 2 decimal places', () => {
    const best = { tags: { width: '11.4567' }, highway: 'tertiary' };
    expect(deriveWidth(best).width_m).toBe(11.46);
  });

  test('falls back to lanes × 3m when no width tag', () => {
    const best = { tags: { lanes: '4' }, highway: 'tertiary' };
    const derived = deriveWidth(best);
    expect(derived.method).toBe('lanes_times_3m');
    expect(derived.width_m).toBe(12); // 4 * 3
    expect(derived.lanes).toBe(4);
    expect(derived.confidence).toBe(0.45);
  });

  test('falls back to highway-class default when no width and no lanes', () => {
    const best = { tags: {}, highway: 'residential' };
    const derived = deriveWidth(best);
    expect(derived.method).toBe('highway_class_default');
    expect(derived.width_m).toBe(HIGHWAY_DEFAULTS.residential.width);
    expect(derived.confidence).toBe(HIGHWAY_DEFAULTS.residential.confidence);
    expect(derived.lanes).toBeNull();
  });

  test('returns null when no width/lanes and unknown highway class', () => {
    const best = { tags: {}, highway: 'cycleway' };
    expect(deriveWidth(best)).toBeNull();
  });

  test('zero or negative width tag falls through to lanes', () => {
    const best = { tags: { width: '0', lanes: '2' }, highway: 'tertiary' };
    expect(deriveWidth(best).method).toBe('lanes_times_3m');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// fetchRoadWidth (axios mocked)
// ─────────────────────────────────────────────────────────────────────────

describe('fetchRoadWidth', () => {
  test('returns error status on missing lat/lng', async () => {
    const result = await fetchRoadWidth({});
    expect(result.provider).toBe('osm_overpass');
    expect(result.status).toBe('error');
    expect(result.confidence).toBe(0);
    expect(result.inferred_width_m).toBeNull();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('returns error status when axios throws', async () => {
    axios.post.mockRejectedValueOnce(new Error('ECONNRESET'));
    const result = await fetchRoadWidth({ lat: 12.97, lng: 77.59 });
    expect(result.provider).toBe('osm_overpass');
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/ECONNRESET/);
    expect(result.confidence).toBe(0);
  });

  test('returns no_road_nearby when Overpass returns zero ways', async () => {
    axios.post.mockResolvedValueOnce(buildOverpassResponse([]));
    const result = await fetchRoadWidth({ lat: 12.97, lng: 77.59 });
    expect(result.status).toBe('no_road_nearby');
    expect(result.candidate_count).toBe(0);
    expect(result.inferred_width_m).toBeNull();
    expect(result.confidence).toBe(0);
  });

  test('returns matched with explicit width when best way has width tag', async () => {
    axios.post.mockResolvedValueOnce(
      buildOverpassResponse([
        wayWith({ highway: 'residential' }),
        wayWith({ highway: 'primary', width: '14', name: 'Outer Ring Road' }),
      ])
    );
    const result = await fetchRoadWidth({ lat: 12.97, lng: 77.59 });
    expect(result.status).toBe('matched');
    expect(result.inferred_width_m).toBe(14);
    expect(result.inferred_highway).toBe('primary');
    expect(result.inferred_road_name).toBe('Outer Ring Road');
    expect(result.derivation_method).toBe('explicit_width_tag');
    expect(result.confidence).toBe(0.55);
    expect(result.candidate_count).toBe(2);
  });

  test('returns matched with lanes-derived width when no width tag', async () => {
    axios.post.mockResolvedValueOnce(
      buildOverpassResponse([wayWith({ highway: 'tertiary', lanes: '3' })])
    );
    const result = await fetchRoadWidth({ lat: 12.97, lng: 77.59 });
    expect(result.status).toBe('matched');
    expect(result.inferred_width_m).toBe(9); // 3 lanes × 3m
    expect(result.inferred_lanes).toBe(3);
    expect(result.derivation_method).toBe('lanes_times_3m');
    expect(result.confidence).toBe(0.45);
  });

  test('returns matched with highway-default when no width or lanes', async () => {
    axios.post.mockResolvedValueOnce(
      buildOverpassResponse([wayWith({ highway: 'residential' })])
    );
    const result = await fetchRoadWidth({ lat: 12.97, lng: 77.59 });
    expect(result.status).toBe('matched');
    expect(result.inferred_width_m).toBe(HIGHWAY_DEFAULTS.residential.width);
    expect(result.inferred_lanes).toBeNull();
    expect(result.derivation_method).toBe('highway_class_default');
    expect(result.confidence).toBe(HIGHWAY_DEFAULTS.residential.confidence);
  });

  test('returns ambiguous when ways exist but no width / lanes / known class', async () => {
    axios.post.mockResolvedValueOnce(
      buildOverpassResponse([wayWith({ highway: 'cycleway' })])
    );
    const result = await fetchRoadWidth({ lat: 12.97, lng: 77.59 });
    expect(result.status).toBe('ambiguous');
    expect(result.inferred_width_m).toBeNull();
    expect(result.inferred_highway).toBe('cycleway');
    expect(result.confidence).toBe(0);
  });

  test('confidence is never above 0.55 (CLAUDE.md hard cap)', async () => {
    axios.post.mockResolvedValueOnce(
      buildOverpassResponse([
        wayWith({ highway: 'motorway', width: '100', lanes: '20', name: 'huge' }),
      ])
    );
    const result = await fetchRoadWidth({ lat: 12.97, lng: 77.59 });
    expect(result.confidence).toBeLessThanOrEqual(0.55);
  });

  test('Overpass POST is called with form-encoded query body', async () => {
    axios.post.mockResolvedValueOnce(buildOverpassResponse([]));
    await fetchRoadWidth({ lat: 12.97, lng: 77.59 });
    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toMatch(/overpass-api\.de|interpreter|process\.env\.OSM_OVERPASS_URL/);
    // Body is `data=` followed by URL-encoded Overpass QL
    expect(body).toMatch(/^data=/);
    expect(decodeURIComponent(body.slice(5))).toMatch(/highway/);
    expect(decodeURIComponent(body.slice(5))).toMatch(/12\.97/);
    expect(opts.timeout).toBeGreaterThan(0);
    expect(opts.headers['Content-Type']).toMatch(/x-www-form-urlencoded/);
  });

  test('handles real Bengaluru-style coordinates (Whitefield)', async () => {
    axios.post.mockResolvedValueOnce(
      buildOverpassResponse([
        wayWith({ highway: 'secondary', lanes: '2', name: 'ITPL Main Road' }),
      ])
    );
    const result = await fetchRoadWidth({ lat: 12.9853, lng: 77.7494 });
    expect(result.status).toBe('matched');
    expect(result.inferred_road_name).toBe('ITPL Main Road');
    expect(result.inferred_highway).toBe('secondary');
  });
});
