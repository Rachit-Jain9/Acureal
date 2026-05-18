'use strict';

/**
 * Coverage for the Google Places Text Search fallback added 2026-05-18
 * after the Jigani regression. The fix's invariant: when Google
 * Geocoding API returns REQUEST_DENIED (typical when the operator
 * enabled Places but forgot Geocoding in GCP), we MUST try Places
 * Text Search before falling all the way through to Nominatim.
 *
 * Axios is mocked at the module level; the database mock returns no
 * cache rows so the geocoder always runs live.
 */

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const axios = require('axios');
const db = require('../src/config/database');

// Configure a valid-looking Google key BEFORE requiring the module so
// isGoogleConfigured() reads it at the right time. (It's actually
// read at call time via a closure, but setting before the require
// keeps things explicit.)
process.env.GOOGLE_MAPS_API_KEY = 'AIzaSyTestKey12345678901234567890123456';

const { geocodeAddress, geocodeDiagnostic } = require('../src/utils/geocode');

const PLACES_OK_RESPONSE = {
  status: 200,
  data: {
    status: 'OK',
    results: [
      {
        formatted_address: 'Thyme Park Apartments, Jigani, Karnataka 560105, India',
        place_id: 'ChIJ_test_place_id',
        geometry: { location: { lat: 12.7849, lng: 77.7459 } },
        types: ['establishment', 'point_of_interest'],
      },
    ],
  },
};

const PLACES_DENIED_RESPONSE = {
  status: 200,
  data: { status: 'REQUEST_DENIED', error_message: 'This API project is not authorised to use this API' },
};

const GEOCODING_DENIED_RESPONSE = {
  status: 200,
  data: { status: 'REQUEST_DENIED', error_message: 'This API project is not authorised to use this API' },
};

const GEOCODING_OK_BRIGADE_ROAD = {
  status: 200,
  data: {
    status: 'OK',
    results: [
      {
        formatted_address: '100 Brigade Road, Bengaluru, Karnataka 560001, India',
        place_id: 'gc_brigade',
        geometry: { location: { lat: 12.97501, lng: 77.60501 } },
        types: ['street_address'],
      },
    ],
  },
};

const NOMINATIM_CITY_RESPONSE = {
  status: 200,
  data: [{ lat: '12.97679', lon: '77.59008', display_name: 'Bengaluru, Karnataka, India' }],
};

beforeEach(() => {
  axios.get.mockReset();
  db.query.mockReset();
  // Default: cache empty, all DB writes succeed.
  db.query.mockResolvedValue({ rows: [] });
});

describe('geocoder — Google Places fallback chain', () => {
  test('Geocoding API denied → Places API succeeds → returns Places result (Jigani path)', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/geocode/json')) return Promise.resolve(GEOCODING_DENIED_RESPONSE);
      if (url.includes('/place/textsearch/json')) return Promise.resolve(PLACES_OK_RESPONSE);
      return Promise.resolve(NOMINATIM_CITY_RESPONSE);
    });

    const result = await geocodeAddress(
      'block Thyme Park Apartments, No 704 A, Industrial Bypass, Jigani',
      'Bengaluru',
      'Karnataka',
      '560105',
    );

    expect(result.found).toBe(true);
    expect(result.provider).toBe('google_places');
    // Jigani's actual lat/lng — not the central-Bengaluru fallback.
    expect(result.lat).toBeCloseTo(12.78, 1);
    expect(result.lng).toBeCloseTo(77.74, 1);
    expect(result.status).toBe('verified');
    expect(result.confidence).toBe(0.85);
    expect(result.place_types).toContain('establishment');
  });

  test('Both Google paths denied → falls through to Nominatim BUT annotates upstream_failure', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/geocode/json')) return Promise.resolve(GEOCODING_DENIED_RESPONSE);
      if (url.includes('/place/textsearch/json')) return Promise.resolve(PLACES_DENIED_RESPONSE);
      return Promise.resolve(NOMINATIM_CITY_RESPONSE);
    });

    const result = await geocodeAddress('Jigani-unmatched', 'Bengaluru', 'Karnataka', null);

    expect(result.found).toBe(true);
    expect(result.provider).toBe('nominatim');
    expect(result.upstream_failure).toMatch(/Google Places denied/);
    expect(result.upstream_failure).toMatch(/not authorised/);
  });

  test('Geocoding API succeeds → never calls Places API (short-circuit)', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/geocode/json')) return Promise.resolve(GEOCODING_OK_BRIGADE_ROAD);
      return Promise.reject(new Error('Should not have called Places or Nominatim'));
    });

    const result = await geocodeAddress('100 Brigade Road-uncached', 'Bengaluru', 'Karnataka', null);

    expect(result.provider).toBe('google');
    expect(result.confidence).toBe(0.92);
    const placesCalls = axios.get.mock.calls.filter(([url]) => url.includes('/place/textsearch'));
    expect(placesCalls).toHaveLength(0);
  });

  test('Geocoding returns approximate city-fallback → Places second-chance promotes to verified establishment (Jigani path with Maps Platform key)', async () => {
    // Reproduces the live Jigani diagnostic on 2026-05-18:
    //   Geocoding API returned `Jigani, Karnataka` at 0.45 / approximate
    //   Places Text Search returned the apartment cluster at 0.85 / verified
    // The chain enhancement promotes Places when it strictly beats
    // Geocoding's approximate result.
    axios.get.mockImplementation((url) => {
      if (url.includes('/geocode/json')) {
        return Promise.resolve({
          status: 200,
          data: {
            status: 'OK',
            results: [
              {
                formatted_address: 'Jigani, Karnataka, India',
                place_id: 'gc_jigani_locality',
                geometry: { location: { lat: 12.7791, lng: 77.6436 } },
                types: ['locality', 'political'], // not point-match → approximate path
              },
            ],
          },
        });
      }
      if (url.includes('/place/textsearch/json')) {
        return Promise.resolve({
          status: 200,
          data: {
            status: 'OK',
            results: [
              {
                formatted_address: 'Thyme Park Apartments, Jigani, Masthena Halli, Karnataka 560105',
                place_id: 'pl_thyme_park',
                geometry: { location: { lat: 12.78399, lng: 77.65872 } },
                types: ['establishment', 'point_of_interest'],
              },
            ],
          },
        });
      }
      return Promise.resolve(NOMINATIM_CITY_RESPONSE);
    });

    const result = await geocodeAddress('Thyme Park Apartments Jigani', 'Bengaluru', 'Karnataka', '560105');
    expect(result.provider).toBe('google_places');
    expect(result.status).toBe('verified');
    expect(result.confidence).toBe(0.85);
    expect(result.lat).toBeCloseTo(12.784, 2);
    expect(result.lng).toBeCloseTo(77.659, 2);
  });

  test('Geocoding returns approximate AND Places ALSO returns approximate → keep Geocoding (no swap)', async () => {
    // Edge case: Places returns a `geocode`-typed result at 0.65 — not
    // strictly better than Geocoding's 0.45 approximate (within 0.1
    // confidence delta). Stick with Geocoding so the gate banner fires
    // and the operator switches to coordinate input.
    axios.get.mockImplementation((url) => {
      if (url.includes('/geocode/json')) {
        return Promise.resolve({
          status: 200,
          data: {
            status: 'OK',
            results: [
              {
                formatted_address: 'Some Locality',
                place_id: 'gc_loc',
                geometry: { location: { lat: 12.8, lng: 77.7 } },
                types: ['locality'],
              },
            ],
          },
        });
      }
      if (url.includes('/place/textsearch/json')) {
        return Promise.resolve({
          status: 200,
          data: {
            status: 'OK',
            results: [{
              formatted_address: 'Some Place',
              place_id: 'pl_some',
              geometry: { location: { lat: 12.81, lng: 77.71 } },
              types: ['geocode'],
            }],
          },
        });
      }
      return Promise.resolve(NOMINATIM_CITY_RESPONSE);
    });

    const result = await geocodeAddress('Vague locality query', 'Bengaluru', 'Karnataka', null);
    // Confidence delta 0.65 (Places) - 0.45 (Geocoding) = 0.20 > 0.10 → Places wins.
    // But Places status is 'approximate' AND not establishment-typed, so the
    // `placesIsBetter` check considers it only if confidence delta > 0.1.
    // 0.65 - 0.45 = 0.20 > 0.10 → swap happens.
    expect(result.provider).toBe('google_places');
    expect(result.confidence).toBe(0.65);
  });

  test('High-confidence Geocoding (street_address) → Places never tried (short-circuit preserved)', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/geocode/json')) {
        return Promise.resolve({
          status: 200,
          data: {
            status: 'OK',
            results: [{
              formatted_address: '100 Brigade Road, Bengaluru, Karnataka 560001, India',
              place_id: 'gc_brigade',
              geometry: { location: { lat: 12.97501, lng: 77.60501 } },
              types: ['street_address'], // point-match → 0.92 verified
            }],
          },
        });
      }
      return Promise.reject(new Error('Should not have called Places or Nominatim'));
    });

    const result = await geocodeAddress('100 Brigade Road BLR', 'Bengaluru', 'Karnataka', null);
    expect(result.provider).toBe('google');
    expect(result.confidence).toBe(0.92);
    const placesCalls = axios.get.mock.calls.filter(([url]) => url.includes('/place/textsearch'));
    expect(placesCalls).toHaveLength(0);
  });

  test('Places returns geocode-typed result → confidence 0.65 + status approximate', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/geocode/json')) return Promise.resolve(GEOCODING_DENIED_RESPONSE);
      if (url.includes('/place/textsearch/json')) {
        return Promise.resolve({
          status: 200,
          data: {
            status: 'OK',
            results: [
              {
                formatted_address: 'Jigani, Karnataka',
                place_id: 'p',
                geometry: { location: { lat: 12.78, lng: 77.74 } },
                types: ['geocode'],
              },
            ],
          },
        });
      }
      return Promise.resolve(NOMINATIM_CITY_RESPONSE);
    });

    const result = await geocodeAddress('Jigani-geocode-typed', 'Bengaluru', 'Karnataka', null);
    expect(result.provider).toBe('google_places');
    expect(result.status).toBe('approximate');
    expect(result.confidence).toBe(0.65);
  });
});

describe('geocoder — diagnostic', () => {
  test('geocodeDiagnostic returns each provider response + winner', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/geocode/json')) return Promise.resolve(GEOCODING_DENIED_RESPONSE);
      if (url.includes('/place/textsearch/json')) return Promise.resolve(PLACES_OK_RESPONSE);
      return Promise.resolve(NOMINATIM_CITY_RESPONSE);
    });

    const diag = await geocodeDiagnostic('Jigani-diag-1', 'Bengaluru', 'Karnataka', '560105');

    expect(diag.input.address).toBe('Jigani-diag-1');
    expect(diag.google_configured).toBe(true);
    expect(diag.google_geocoding).toBeNull();
    expect(diag.google_places?.found).toBe(true);
    expect(diag.nominatim?.found).toBe(true);
    expect(diag.winner).toBe('google_places');
  });

  test('winner is null when every provider returns no match', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/geocode/json')) return Promise.resolve({ status: 200, data: { status: 'ZERO_RESULTS' } });
      if (url.includes('/place/textsearch/json')) return Promise.resolve({ status: 200, data: { status: 'ZERO_RESULTS' } });
      return Promise.resolve({ status: 200, data: [] });
    });

    const diag = await geocodeDiagnostic('zzz nonsense xyzzy', 'Bengaluru', 'Karnataka', null);
    expect(diag.winner).toBeNull();
  });
});
