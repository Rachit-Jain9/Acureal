'use strict';

/**
 * Coverage for the geocoder cascade.
 *
 * PR-NX78 (2026-05-19) — cascade reordered to PLACES-FIRST after the
 * Jigani live-diagnostic confirmed Places returns 0.85 verified for
 * the exact parcel while Geocoding returns 0.3 approximate to a wrong
 * locality. Places is now the primary; Geocoding is a backup; Nominatim
 * is last resort.
 *
 * Earlier coverage (Places-as-fallback, Geocoding-first) is preserved
 * conceptually but the assertions are updated to match the new order.
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

  test('PR-NX78: Both Google paths denied → falls through to Nominatim BUT annotates upstream failures', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/geocode/json')) return Promise.resolve(GEOCODING_DENIED_RESPONSE);
      if (url.includes('/place/textsearch/json')) return Promise.resolve(PLACES_DENIED_RESPONSE);
      return Promise.resolve(NOMINATIM_CITY_RESPONSE);
    });

    const result = await geocodeAddress('Jigani-unmatched', 'Bengaluru', 'Karnataka', null);

    expect(result.found).toBe(true);
    expect(result.provider).toBe('nominatim');
    // New cascade annotates both upstream failures separately so the
    // AutoFillCard can surface "places denied + geocoding denied" not just one.
    expect(result.upstream_places_failure).toMatch(/Google Places denied/);
    expect(result.upstream_places_failure).toMatch(/not authorised/);
  });

  test('PR-NX78: high-confidence Places verified → Geocoding never tried (short-circuit on primary)', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/place/textsearch/json')) return Promise.resolve(PLACES_OK_RESPONSE);
      return Promise.reject(new Error('Should not have called Geocoding or Nominatim'));
    });

    const result = await geocodeAddress('Thyme Park Apartments Jigani', 'Bengaluru', 'Karnataka', '560105');

    expect(result.provider).toBe('google_places');
    expect(result.confidence).toBe(0.85);
    const geocodingCalls = axios.get.mock.calls.filter(([url]) => url.includes('/geocode/json'));
    expect(geocodingCalls).toHaveLength(0);
  });

  test('PR-NX78: Places returns low-confidence → falls through to high-confidence Geocoding', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/place/textsearch/json')) {
        return Promise.resolve({
          status: 200,
          data: {
            status: 'OK',
            results: [{
              formatted_address: 'Brigade Road area',
              place_id: 'pl_brigade_area',
              geometry: { location: { lat: 12.97, lng: 77.60 } },
              types: ['geocode'], // not establishment → confidence 0.65
            }],
          },
        });
      }
      if (url.includes('/geocode/json')) return Promise.resolve(GEOCODING_OK_BRIGADE_ROAD);
      return Promise.reject(new Error('Should not have called Nominatim'));
    });

    const result = await geocodeAddress('100 Brigade Road BLR', 'Bengaluru', 'Karnataka', null);

    // Geocoding's 0.92 verified > Places 0.65 geocode-typed → Geocoding wins.
    expect(result.provider).toBe('google');
    expect(result.confidence).toBe(0.92);
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

  test('PR-NX78: Places low-confidence (0.65) and Geocoding low-confidence (0.45) → highest wins (Places)', async () => {
    // Both Google providers return below-threshold (< 0.7) results. The
    // new cascade picks the higher-confidence one. Places at 0.65 beats
    // Geocoding's 0.45 city-fallback. This is the desirable behavior for
    // Indian apartment/landmark addresses where Places usually has the
    // better partial match.
    axios.get.mockImplementation((url) => {
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
      if (url.includes('/geocode/json')) {
        return Promise.resolve({
          status: 200,
          data: {
            status: 'OK',
            results: [{
              formatted_address: 'Some Locality',
              place_id: 'gc_loc',
              geometry: { location: { lat: 12.8, lng: 77.7 } },
              types: ['locality'],
            }],
          },
        });
      }
      return Promise.resolve(NOMINATIM_CITY_RESPONSE);
    });

    const result = await geocodeAddress('Vague locality query', 'Bengaluru', 'Karnataka', null);
    expect(result.provider).toBe('google_places');
    expect(result.confidence).toBe(0.65);
  });

  test('PR-NX78: Places returns geocode-typed result → confidence 0.65 + status approximate', async () => {
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
