'use strict';

// Mock external collaborators so the service can be exercised in isolation.
jest.mock('axios');
jest.mock('../src/utils/geocode', () => ({
  geocodeAddress: jest.fn(),
}));
jest.mock('../src/services/parcelContext.service', () => ({
  deriveParcelContextFromAddress: jest.fn(),
}));
jest.mock('../src/services/ai/aiRouter', () => ({
  runAI: jest.fn(),
}));

const axios = require('axios');
const { geocodeAddress } = require('../src/utils/geocode');
const parcelContextService = require('../src/services/parcelContext.service');
const aiRouter = require('../src/services/ai/aiRouter');

const { captureProperty, _internal } = require('../src/services/propertyCapture.service');

const stubContext = (overrides = {}) => ({
  bbmp: { within_bbmp: true, ward: { name: 'Whitefield', no: 84 }, zone_code: 'D' },
  kgis: { taluk: 'Bangalore East', village: 'Pattandur Agrahara', survey_number: '45/2' },
  planning_district: null,
  guidance_value: null,
  verify_links: [],
  ...overrides,
});

beforeEach(() => {
  // resetAllMocks clears the mockResolvedValueOnce queue between tests, not just call history.
  jest.resetAllMocks();
  process.env.GOOGLE_MAPS_API_KEY = 'AIzaTEST';
});

afterAll(() => {
  delete process.env.GOOGLE_MAPS_API_KEY;
});

describe('propertyCapture.service', () => {
  describe('input validation', () => {
    test('returns warning for empty input', async () => {
      const r = await captureProperty('');
      expect(r.classification.type).toBe('empty');
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toMatch(/empty/i);
    });

    test('returns warning for input > 4000 chars', async () => {
      const r = await captureProperty('a'.repeat(4100));
      expect(r.warnings[0]).toMatch(/too long/i);
    });
  });

  describe('Plus Code input', () => {
    test('resolves a short Plus Code with default Bengaluru area context', async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          status: 'OK',
          results: [
            {
              formatted_address: '3JV8+P4W, Whitefield, Bengaluru, Karnataka 560066, India',
              place_id: 'ChIJ-test-place',
              geometry: { location: { lat: 12.9716, lng: 77.7401 } },
            },
          ],
        },
      });
      parcelContextService.deriveParcelContextFromAddress.mockResolvedValueOnce(stubContext());

      const r = await captureProperty('3JV8+P4W');

      expect(r.classification.type).toBe('plusCode');
      expect(r.resolved.lat).toBe(12.9716);
      expect(r.resolved.lng).toBe(77.7401);
      expect(r.resolved.formatted_address).toContain('Whitefield');
      // Should have called Google with the Bengaluru area default appended.
      const callArgs = axios.get.mock.calls[0];
      expect(callArgs[0]).toContain('geocode/json');
      expect(callArgs[1].params.address).toMatch(/3JV8\+P4W/);
      expect(callArgs[1].params.address).toMatch(/Bengaluru/);
      // Suggested fields populated for POST /properties.
      expect(r.suggestedFields.lat).toBe(12.9716);
      expect(r.suggestedFields.lng).toBe(77.7401);
      expect(r.suggestedFields.name).toMatch(/3JV8\+P4W/);
      expect(r.suggestedFields.state).toBe('Karnataka');
      expect(r.suggestedFields.city).toBe('Bengaluru');
      expect(r.suggestedFields.pincode).toBe('560066');
    });

    test('uses user-supplied area context when present', async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          status: 'OK',
          results: [
            {
              formatted_address: 'X, Mysore, Karnataka',
              place_id: 'pid',
              geometry: { location: { lat: 12.30, lng: 76.65 } },
            },
          ],
        },
      });
      parcelContextService.deriveParcelContextFromAddress.mockResolvedValueOnce(stubContext({ bbmp: { within_bbmp: false } }));

      await captureProperty('JCRJ+P4W Mysore');

      expect(axios.get.mock.calls[0][1].params.address).toMatch(/Mysore/);
    });
  });

  describe('Lat/lng input', () => {
    test('reverse-geocodes lat/lng to address', async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          status: 'OK',
          results: [
            {
              formatted_address: '100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038',
              place_id: 'pid-2',
              geometry: { location: { lat: 12.9716, lng: 77.5946 } },
            },
          ],
        },
      });
      parcelContextService.deriveParcelContextFromAddress.mockResolvedValueOnce(stubContext());

      const r = await captureProperty('12.9716, 77.5946');

      expect(r.classification.type).toBe('latLng');
      expect(r.resolved.lat).toBe(12.9716);
      expect(r.resolved.formatted_address).toContain('Indiranagar');
      expect(r.suggestedFields.pincode).toBe('560038');
      expect(r.warnings).toEqual([]); // high-confidence caller-supplied coords
    });

    test('still returns coords when reverse-geocode fails', async () => {
      axios.get.mockResolvedValueOnce({ data: { status: 'ZERO_RESULTS', results: [] } });
      parcelContextService.deriveParcelContextFromAddress.mockResolvedValueOnce(stubContext());

      const r = await captureProperty('12.9716, 77.5946');

      expect(r.resolved.lat).toBe(12.9716);
      expect(r.resolved.formatted_address).toBeUndefined();
    });
  });

  describe('Address input', () => {
    test('routes through geocodeAddress cascade', async () => {
      geocodeAddress.mockResolvedValueOnce({
        found: true,
        lat: 12.97,
        lng: 77.59,
        displayName: 'Whitefield Main Road, Bengaluru, Karnataka',
        placeId: 'pid-3',
        provider: 'google_places',
        confidence: 0.85,
        status: 'verified',
      });
      parcelContextService.deriveParcelContextFromAddress.mockResolvedValueOnce(stubContext());

      const r = await captureProperty('Whitefield Main Road, Bengaluru');

      expect(r.classification.type).toBe('address');
      expect(geocodeAddress).toHaveBeenCalledWith('Whitefield Main Road, Bengaluru', 'Bengaluru', 'Karnataka', null);
      expect(r.resolved.provider).toBe('google_places');
      expect(r.suggestedFields.address).toContain('Whitefield');
    });

    test('surfaces low-confidence warning', async () => {
      geocodeAddress.mockResolvedValueOnce({
        found: true,
        lat: 12.97,
        lng: 77.59,
        displayName: 'Karnataka',
        provider: 'google_places',
        confidence: 0.45,
        status: 'approximate',
      });
      parcelContextService.deriveParcelContextFromAddress.mockResolvedValueOnce(stubContext());

      const r = await captureProperty('Some Vague Place');

      expect(r.warnings.some((w) => /low-confidence/i.test(w))).toBe(true);
    });
  });

  describe('Survey number input', () => {
    test('geocodes the location context and keeps surveyNumber as a field', async () => {
      geocodeAddress.mockResolvedValueOnce({
        found: true,
        lat: 13.25,
        lng: 77.71,
        displayName: 'Devanahalli, Bangalore Rural, Karnataka',
        provider: 'google_places',
        confidence: 0.85,
        status: 'verified',
      });
      parcelContextService.deriveParcelContextFromAddress.mockResolvedValueOnce(
        stubContext({ bbmp: { within_bbmp: false }, kgis: { taluk: 'Devanahalli' } }),
      );

      const r = await captureProperty('Survey No. 45/2, Devanahalli');

      expect(r.classification.type).toBe('surveyNumber');
      expect(r.resolved.surveyNumber).toBe('45/2');
      expect(r.suggestedFields.surveyNumber).toBe('45/2');
      expect(r.suggestedFields.city).toBe('Devanahalli');
    });
  });

  describe('Google Maps URL input', () => {
    test('extracts coords from canonical /@lat,lng URL without making any HTTP call', async () => {
      // Reverse-geocode is called once; no shortlink HTTP call.
      axios.get.mockResolvedValueOnce({
        data: {
          status: 'OK',
          results: [
            {
              formatted_address: 'KIAL Road, Devanahalli, Karnataka',
              place_id: 'pid-4',
              geometry: { location: { lat: 13.20, lng: 77.71 } },
            },
          ],
        },
      });
      parcelContextService.deriveParcelContextFromAddress.mockResolvedValueOnce(stubContext({ bbmp: { within_bbmp: false } }));

      const r = await captureProperty('https://www.google.com/maps/place/X/@13.2,77.71,17z');

      expect(r.classification.type).toBe('googleMapsUrl');
      expect(r.resolved.lat).toBe(13.2);
      expect(r.resolved.lng).toBe(77.71);
    });

    test('follows shortlink redirect to canonical URL', async () => {
      // Shortlink GET — axios returns the resolved URL on response.request.res.responseUrl.
      axios.get.mockResolvedValueOnce({
        request: { res: { responseUrl: 'https://www.google.com/maps/place/X/@12.5,77.6,17z' } },
        data: '',
      });
      parcelContextService.deriveParcelContextFromAddress.mockResolvedValueOnce(stubContext());

      const r = await captureProperty('https://maps.app.goo.gl/abc');

      expect(r.classification.type).toBe('googleMapsUrl');
      expect(r.resolved.lat).toBe(12.5);
    });

    test('warns when shortlink resolution yields no coords', async () => {
      axios.get.mockResolvedValueOnce({
        request: { res: { responseUrl: 'https://www.google.com/maps/search/?api=1' } },
        data: '',
      });

      const r = await captureProperty('https://maps.app.goo.gl/xyz');

      expect(r.warnings.some((w) => /could not resolve/i.test(w))).toBe(true);
    });
  });

  describe('Free text input', () => {
    test('extracts area / price via Gemini and geocodes the extracted location', async () => {
      aiRouter.runAI.mockResolvedValueOnce({
        result: JSON.stringify({
          location: 'KIAL Road, Devanahalli',
          city: null,
          land_area_sqft: null,
          land_area_acres: 5,
          asking_price_cr: 18,
          asking_price_per_sqft_inr: null,
          asking_price_per_acre_cr: null,
          asset_class_hint: 'land',
          deal_structure_hint: 'outright_purchase',
          notes: 'RERA registered, broker contact attached',
        }),
      });
      geocodeAddress.mockResolvedValueOnce({
        found: true,
        lat: 13.20,
        lng: 77.71,
        displayName: 'KIAL Road, Devanahalli, Karnataka',
        provider: 'google_places',
        confidence: 0.85,
        status: 'verified',
      });
      parcelContextService.deriveParcelContextFromAddress.mockResolvedValueOnce(
        stubContext({ bbmp: { within_bbmp: false }, kgis: { taluk: 'Devanahalli' } }),
      );

      const text = '5 acres of land available near KIAL airport road, Devanahalli, asking 18 Cr negotiable. RERA registered, broker contact attached.';
      const r = await captureProperty(text);

      expect(r.classification.type).toBe('freeText');
      expect(r.aiExtraction.land_area_acres).toBe(5);
      expect(r.aiExtraction.asking_price_cr).toBe(18);
      expect(r.suggestedFields.landAreaAcres).toBe(5);
      expect(r.suggestedFields.landAskPriceCr).toBe(18);
      expect(r.suggestedFields.landPricingBasis).toBe('total_cr');
      expect(aiRouter.runAI).toHaveBeenCalledTimes(1);
    });

    test('skips Gemini when aiAssisted=false', async () => {
      geocodeAddress.mockResolvedValueOnce({
        found: true,
        lat: 12.97,
        lng: 77.59,
        displayName: 'Bengaluru',
        provider: 'google_places',
        confidence: 0.55,
        status: 'approximate',
      });
      parcelContextService.deriveParcelContextFromAddress.mockResolvedValueOnce(stubContext());

      const text = '5 acres of land available near KIAL airport road, Devanahalli, asking 18 Cr negotiable. RERA registered.';
      const r = await captureProperty(text, { aiAssisted: false });

      expect(aiRouter.runAI).not.toHaveBeenCalled();
      expect(r.aiExtraction).toBeNull();
      expect(r.warnings.some((w) => /AI assistance/i.test(w))).toBe(true);
    });

    test('falls back gracefully when Gemini returns malformed JSON', async () => {
      aiRouter.runAI.mockResolvedValueOnce({ result: 'not json at all' });
      geocodeAddress.mockResolvedValueOnce({
        found: true,
        lat: 12.97,
        lng: 77.59,
        displayName: 'Bengaluru',
        provider: 'google_places',
        confidence: 0.85,
        status: 'verified',
      });
      parcelContextService.deriveParcelContextFromAddress.mockResolvedValueOnce(stubContext());

      const text = '5 acres available near KIAL road, asking 18 Cr negotiable, RERA registered builder';
      const r = await captureProperty(text);

      // AI extraction failed → ai is null but capture still produces a candidate.
      expect(r.aiExtraction).toBeNull();
      expect(r.resolved).toBeTruthy();
    });
  });

  describe('helpers', () => {
    test('parsePincodeFromAddress', () => {
      expect(_internal.parsePincodeFromAddress('100 Feet Road, Bengaluru 560038')).toBe('560038');
      expect(_internal.parsePincodeFromAddress('No pincode here')).toBeNull();
      expect(_internal.parsePincodeFromAddress(null)).toBeNull();
    });

    test('parseCityFromContext prefers BBMP=Bengaluru, then K-GIS taluk, then fallback', () => {
      expect(_internal.parseCityFromContext({ bbmp: { within_bbmp: true } })).toBe('Bengaluru');
      expect(_internal.parseCityFromContext({ bbmp: { within_bbmp: false }, kgis: { taluk: 'Anekal' } })).toBe('Anekal');
      expect(_internal.parseCityFromContext({ bbmp: { within_bbmp: false } }, 'Mysore')).toBe('Mysore');
      expect(_internal.parseCityFromContext(null)).toBe('Bengaluru');
    });

    test('generateName picks AI location when available', () => {
      const name = _internal.generateName({
        classification: { type: 'freeText', parsed: {} },
        resolved: {},
        ai: { location: 'KIAL Road, Devanahalli' },
      });
      expect(name).toMatch(/KIAL Road/);
    });

    test('generateName uses Plus Code area for plusCode inputs', () => {
      const name = _internal.generateName({
        classification: { type: 'plusCode', parsed: { code: '3JV8+P4W', areaContext: 'Whitefield' } },
        resolved: {},
        ai: null,
      });
      expect(name).toMatch(/3JV8\+P4W/);
      expect(name).toMatch(/Whitefield/);
    });
  });
});
