'use strict';

// Unit tests for the two-stage geocode upgrade logic. Tier 1 #10 finish.
// All Google API calls are mocked via the injected fetchImpl so these
// tests run offline and don't burn API credits.

const {
  haversineKm,
  isUpgrade,
  mapLocationType,
  extractLocalityFromFormatted,
  decideOutcome,
  upgradeOneComp,
  geocodeOnce,
} = require('../src/utils/geocodeUpgrade');

// ── Pure helpers ──────────────────────────────────────────────────────────

describe('haversineKm', () => {
  test('Bengaluru centre to Whitefield is ~16km', () => {
    const cubbon = { lat: 12.9762, lng: 77.5929 };
    const whitefield = { lat: 12.9698, lng: 77.7500 };
    const d = haversineKm(cubbon, whitefield);
    expect(d).toBeGreaterThan(15);
    expect(d).toBeLessThan(18);
  });

  test('null input returns null', () => {
    expect(haversineKm(null, { lat: 12, lng: 77 })).toBeNull();
    expect(haversineKm({ lat: 12, lng: 77 }, null)).toBeNull();
    expect(haversineKm({ lat: NaN, lng: 77 }, { lat: 12, lng: 77 })).toBeNull();
  });
});

describe('isUpgrade', () => {
  test('rooftop beats locality_centroid', () => {
    expect(isUpgrade('locality_centroid', 'rooftop')).toBe(true);
  });
  test('approximate does not beat geometric_center', () => {
    expect(isUpgrade('geometric_center', 'approximate')).toBe(false);
  });
  test('manual is the highest rank — nothing beats it', () => {
    expect(isUpgrade('manual', 'rooftop')).toBe(false);
  });
  test('unknown keys land at 0', () => {
    expect(isUpgrade('unknown', 'rooftop')).toBe(true);
    expect(isUpgrade('rooftop', 'unknown')).toBe(false);
  });
});

describe('mapLocationType', () => {
  test('handles all four canonical Google strings', () => {
    expect(mapLocationType('ROOFTOP')).toBe('rooftop');
    expect(mapLocationType('RANGE_INTERPOLATED')).toBe('range_interpolated');
    expect(mapLocationType('GEOMETRIC_CENTER')).toBe('geometric_center');
    expect(mapLocationType('APPROXIMATE')).toBe('approximate');
  });
  test('unknown defaults to approximate (the safest fallback)', () => {
    expect(mapLocationType('FROBNICATED')).toBe('approximate');
    expect(mapLocationType(undefined)).toBe('approximate');
  });
});

describe('extractLocalityFromFormatted', () => {
  test('pulls the segment immediately before the city as the locality', () => {
    const formatted = 'Building 12, ITPL Main Road, Whitefield, Bengaluru, Karnataka 560066, India';
    expect(extractLocalityFromFormatted(formatted, 'Bengaluru')).toBe('Whitefield');
  });

  test('handles short addresses where city is the second segment', () => {
    const formatted = 'Hebbal, Bengaluru, Karnataka 560024, India';
    expect(extractLocalityFromFormatted(formatted, 'Bengaluru')).toBe('Hebbal');
  });

  test('returns null when the city is not in the address', () => {
    expect(extractLocalityFromFormatted('Some Road, India', 'Bengaluru')).toBeNull();
  });

  test('returns null on empty / non-string', () => {
    expect(extractLocalityFromFormatted(null, 'Bengaluru')).toBeNull();
    expect(extractLocalityFromFormatted('', 'Bengaluru')).toBeNull();
    expect(extractLocalityFromFormatted('Whitefield, Bengaluru', null)).toBeNull();
  });
});

// ── decideOutcome — the heart of the two-stage logic ──────────────────────

describe('decideOutcome', () => {
  const oldCoord = { lat: 12.9698, lng: 77.7500 }; // Whitefield centroid
  const oldQuality = 'locality_centroid';

  test('stage 1 ROOFTOP within 5km of centroid → accept', () => {
    const result = {
      lat: 12.9700, lng: 77.7510,
      locationType: 'ROOFTOP',
      formattedAddress: 'X, Whitefield, Bengaluru, India',
    };
    const out = decideOutcome({ stage: 1, oldCoord, oldQuality, result, city: 'Bengaluru' });
    expect(out.action).toBe('accept');
    expect(out.stage).toBe(1);
    expect(out.quality).toBe('rooftop');
  });

  test('stage 1 ROOFTOP > 5km from centroid → skip with reason=drift', () => {
    const result = {
      lat: 13.05, lng: 77.59, // Hebbal — far from Whitefield
      locationType: 'ROOFTOP',
      formattedAddress: 'X, Hebbal, Bengaluru, India',
    };
    const out = decideOutcome({ stage: 1, oldCoord, oldQuality, result, city: 'Bengaluru' });
    expect(out.action).toBe('skip');
    expect(out.reason).toBe('drift');
    expect(out.drift_km).toBeGreaterThan(5);
  });

  test('stage 1 result that does not upgrade is skipped', () => {
    const result = {
      lat: 12.97, lng: 77.75,
      locationType: 'APPROXIMATE',
      formattedAddress: 'Whitefield, Bengaluru, India',
    };
    // oldQuality = 'approximate' → APPROXIMATE is not an upgrade.
    const out = decideOutcome({
      stage: 1, oldCoord, oldQuality: 'approximate', result, city: 'Bengaluru',
    });
    expect(out.action).toBe('skip');
    expect(out.reason).toBe('no_upgrade');
  });

  test('null result → skip with reason=no_match', () => {
    const out = decideOutcome({ stage: 1, oldCoord, oldQuality, result: null });
    expect(out.action).toBe('skip');
    expect(out.reason).toBe('no_match');
  });

  test('stage 2 with high-precision (rooftop) far from centroid → accept', () => {
    // The whole point of stage 2: locality was wrong, project is
    // actually 16km away, but Google found it precisely.
    const result = {
      lat: 13.05, lng: 77.59,
      locationType: 'ROOFTOP',
      formattedAddress: 'X Project, Hebbal, Bengaluru, Karnataka 560024, India',
    };
    const out = decideOutcome({ stage: 2, oldCoord, oldQuality, result, city: 'Bengaluru' });
    expect(out.action).toBe('accept');
    expect(out.stage).toBe(2);
    expect(out.quality).toBe('rooftop');
    expect(out.locality).toBe('Hebbal');
  });

  test('stage 2 with low precision (geometric_center) → skip', () => {
    // We refuse to commit a "Bengaluru somewhere" pin even though
    // technically it would be an upgrade from locality_centroid —
    // it's strictly worse than admitting "we don't know."
    const result = {
      lat: 13.0, lng: 77.6,
      locationType: 'GEOMETRIC_CENTER',
      formattedAddress: 'Bengaluru, Karnataka, India',
    };
    const out = decideOutcome({ stage: 2, oldCoord, oldQuality, result, city: 'Bengaluru' });
    expect(out.action).toBe('skip');
    expect(out.reason).toBe('stage2_low_precision');
  });
});

// ── upgradeOneComp — the orchestrator ─────────────────────────────────────

describe('upgradeOneComp', () => {
  const apiKey = 'AIzatestkey';
  const baseComp = {
    project_name: 'Prestige Lakeside Habitat',
    locality: 'Whitefield',
    city: 'Bengaluru',
    lat: 12.9698,
    lng: 77.7500,
    geocode_quality: 'locality_centroid',
  };

  // Helper to build a fake fetch that returns staged Google responses.
  const buildFetch = (responses) => {
    const calls = [];
    let i = 0;
    const fetchImpl = (url) => {
      calls.push(url);
      const r = responses[i] ?? { status: 'ZERO_RESULTS' };
      i += 1;
      return Promise.resolve({
        json: () => Promise.resolve(r),
      });
    };
    fetchImpl.calls = calls;
    return fetchImpl;
  };

  test('stage 1 succeeds — no stage 2 call', async () => {
    const fetchImpl = buildFetch([
      {
        status: 'OK',
        results: [{
          geometry: { location: { lat: 12.97, lng: 77.751 }, location_type: 'ROOFTOP' },
          formatted_address: 'X, Whitefield, Bengaluru',
        }],
      },
    ]);
    const out = await upgradeOneComp({ comp: baseComp, apiKey, fetchImpl });
    expect(out.action).toBe('accept');
    expect(out.stage).toBe(1);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  test('stage 1 drifts but allowCrossLocality=false → skip without firing stage 2', async () => {
    const fetchImpl = buildFetch([
      {
        status: 'OK',
        results: [{
          geometry: { location: { lat: 13.05, lng: 77.59 }, location_type: 'ROOFTOP' },
          formatted_address: 'X, Hebbal, Bengaluru',
        }],
      },
    ]);
    const out = await upgradeOneComp({
      comp: baseComp,
      apiKey,
      fetchImpl,
      allowCrossLocality: false,
    });
    expect(out.action).toBe('skip');
    expect(out.reason).toBe('drift');
    expect(fetchImpl.calls).toHaveLength(1); // no stage 2 fired
  });

  test('stage 1 drifts + allowCrossLocality=true + stage 2 returns rooftop → accept stage 2', async () => {
    const fetchImpl = buildFetch([
      // Stage 1 — drifts to Hebbal
      {
        status: 'OK',
        results: [{
          geometry: { location: { lat: 13.05, lng: 77.59 }, location_type: 'ROOFTOP' },
          formatted_address: 'X, Hebbal, Bengaluru',
        }],
      },
      // Stage 2 — same Hebbal coords, still rooftop
      {
        status: 'OK',
        results: [{
          geometry: { location: { lat: 13.05, lng: 77.59 }, location_type: 'ROOFTOP' },
          formatted_address: 'X Project, Hebbal, Bengaluru, Karnataka 560024, India',
        }],
      },
    ]);
    const out = await upgradeOneComp({
      comp: baseComp,
      apiKey,
      fetchImpl,
      allowCrossLocality: true,
    });
    expect(out.action).toBe('accept');
    expect(out.stage).toBe(2);
    expect(out.quality).toBe('rooftop');
    expect(out.locality).toBe('Hebbal');
    expect(fetchImpl.calls).toHaveLength(2);
  });

  test('stage 1 drifts + stage 2 returns approximate → skip (no fabrication)', async () => {
    const fetchImpl = buildFetch([
      {
        status: 'OK',
        results: [{
          geometry: { location: { lat: 13.05, lng: 77.59 }, location_type: 'ROOFTOP' },
          formatted_address: 'X, Hebbal, Bengaluru',
        }],
      },
      {
        status: 'OK',
        results: [{
          geometry: { location: { lat: 12.97, lng: 77.59 }, location_type: 'APPROXIMATE' },
          formatted_address: 'Bengaluru, Karnataka, India',
        }],
      },
    ]);
    const out = await upgradeOneComp({
      comp: baseComp,
      apiKey,
      fetchImpl,
      allowCrossLocality: true,
    });
    expect(out.action).toBe('skip');
    expect(out.reason).toBe('stage2_low_precision');
  });

  test('stage 1 ZERO_RESULTS → skip without firing stage 2 (no_match is not drift)', async () => {
    const fetchImpl = buildFetch([{ status: 'ZERO_RESULTS', results: [] }]);
    const out = await upgradeOneComp({
      comp: baseComp,
      apiKey,
      fetchImpl,
      allowCrossLocality: true,
    });
    expect(out.action).toBe('skip');
    expect(out.reason).toBe('no_match');
    expect(fetchImpl.calls).toHaveLength(1);
  });

  test('missing project_name or city → skip with missing_fields', async () => {
    const fetchImpl = buildFetch([]);
    const out = await upgradeOneComp({
      comp: { project_name: '', city: 'Bengaluru' },
      apiKey,
      fetchImpl,
    });
    expect(out.action).toBe('skip');
    expect(out.reason).toBe('missing_fields');
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

// ── geocodeOnce — error surfaces ─────────────────────────────────────────

describe('geocodeOnce', () => {
  test('throws on REQUEST_DENIED', async () => {
    const fetchImpl = () => Promise.resolve({
      json: () => Promise.resolve({
        status: 'REQUEST_DENIED',
        error_message: 'API key invalid',
      }),
    });
    await expect(
      geocodeOnce('test', { apiKey: 'k', fetchImpl }),
    ).rejects.toThrow(/REQUEST_DENIED/);
  });

  test('returns null on ZERO_RESULTS', async () => {
    const fetchImpl = () => Promise.resolve({
      json: () => Promise.resolve({ status: 'ZERO_RESULTS', results: [] }),
    });
    const out = await geocodeOnce('test', { apiKey: 'k', fetchImpl });
    expect(out).toBeNull();
  });

  test('throws when api key is missing', async () => {
    const fetchImpl = () => Promise.resolve({ json: () => Promise.resolve({}) });
    await expect(
      geocodeOnce('test', { apiKey: undefined, fetchImpl }),
    ).rejects.toThrow(/Google API key/);
  });
});
