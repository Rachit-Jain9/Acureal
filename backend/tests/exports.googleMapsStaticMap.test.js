'use strict';

const googleMaps = require('../src/services/exports/shared/googleMapsStaticMap.service');

describe('services/exports/shared/googleMapsStaticMap', () => {
  describe('isGoogleMapsEnabled', () => {
    afterEach(() => {
      delete process.env.GOOGLE_MAPS_API_KEY;
    });

    test('false when GOOGLE_MAPS_API_KEY unset', () => {
      delete process.env.GOOGLE_MAPS_API_KEY;
      expect(googleMaps.isGoogleMapsEnabled()).toBe(false);
    });

    test('false when key is a placeholder', () => {
      process.env.GOOGLE_MAPS_API_KEY = 'YOUR_GOOGLE_MAPS_API_KEY';
      expect(googleMaps.isGoogleMapsEnabled()).toBe(false);
    });

    test('true when key is a real value', () => {
      process.env.GOOGLE_MAPS_API_KEY = 'AIzaSyTEST-real-key';
      expect(googleMaps.isGoogleMapsEnabled()).toBe(true);
    });
  });

  describe('buildGoogleMapsUrl', () => {
    test('throws on non-finite coordinates', () => {
      expect(() => googleMaps.buildGoogleMapsUrl({ lat: NaN, lng: 77 })).toThrow();
      expect(() => googleMaps.buildGoogleMapsUrl({ lat: 12.97, lng: 'east' })).toThrow();
    });

    test('clamps lat to [-85, 85] and normalises out-of-range lng', () => {
      const u1 = googleMaps.buildGoogleMapsUrl({ lat: 95, lng: 0, zoom: 14 });
      expect(u1).toMatch(/center=85/);
      const u2 = googleMaps.buildGoogleMapsUrl({ lat: 0, lng: 360, zoom: 14 });
      expect(u2).toMatch(/center=0%2C0/);
    });

    test('clamps zoom to [0, 20]', () => {
      const url = googleMaps.buildGoogleMapsUrl({ lat: 12.97, lng: 77.59, zoom: 99 });
      expect(url).toMatch(/zoom=20/);
    });

    test('produces a roadmap URL with size, scale, and editorial style applied', () => {
      const url = googleMaps.buildGoogleMapsUrl({ lat: 12.97, lng: 77.59, zoom: 13 });
      expect(url).toMatch(/^https:\/\/maps\.googleapis\.com\/maps\/api\/staticmap\?/);
      expect(url).toMatch(/maptype=roadmap/);
      expect(url).toMatch(/scale=2/);
      expect(url).toMatch(/size=640x480/);
      // Editorial style — at least one rule must be present
      expect(url).toMatch(/style=feature%3Awater/);
      expect(url).toMatch(/style=feature%3Apoi%7Cvisibility%3Aoff/);
    });

    test('embeds a marker correctly with single-char label', () => {
      const url = googleMaps.buildGoogleMapsUrl({
        lat: 12.97,
        lng: 77.59,
        zoom: 14,
        markers: [{ lat: 12.97, lng: 77.59, color: 'B5793C', label: 'S', size: 'mid' }],
      });
      // Google Maps Static API uses lat,lng order (Mapbox uses lng,lat)
      expect(url).toMatch(/markers=color%3A0xB5793C%7Clabel%3AS%7Csize%3Amid%7C12\.97%2C77\.59/);
    });

    test('drops a long label rather than passing an invalid value', () => {
      // Google supports only single alphanumeric labels. A long string
      // should resolve to its first matching char (not be sent as-is).
      const url = googleMaps.buildGoogleMapsUrl({
        lat: 12.97,
        lng: 77.59,
        zoom: 14,
        markers: [{
          lat: 12.97,
          lng: 77.59,
          color: 'B5793C',
          label: 'block Thyme Park Apartments, No 704',
          size: 'mid',
        }],
      });
      // First [A-Za-z0-9] is "b" → uppercased to "B"
      expect(url).toMatch(/label%3AB/);
      expect(url).not.toMatch(/Thyme/);
    });

    test('drops an entirely non-alphanumeric label', () => {
      const url = googleMaps.buildGoogleMapsUrl({
        lat: 12.97,
        lng: 77.59,
        zoom: 14,
        markers: [{ lat: 12.97, lng: 77.59, color: 'B5793C', label: '   ', size: 'mid' }],
      });
      expect(url).not.toMatch(/label%3A/);
      // Marker should still be present, just without a label
      expect(url).toMatch(/markers=color%3A0xB5793C%7Csize%3Amid/);
    });

    test('skips markers with non-finite coordinates', () => {
      const url = googleMaps.buildGoogleMapsUrl({
        lat: 12.97,
        lng: 77.59,
        zoom: 14,
        markers: [
          { lat: NaN, lng: 77.59, color: 'B5793C' },
          { lat: 12.95, lng: 77.61, color: '0F7B5A' },
        ],
      });
      expect(url).not.toMatch(/NaN/);
      expect(url).toMatch(/markers=color%3A0x0F7B5A/);
    });
  });

  describe('renderSiteMapDetailed', () => {
    afterEach(() => {
      delete process.env.GOOGLE_MAPS_API_KEY;
      googleMaps.__resetCache();
    });

    test('returns no_token when key unset (does not throw)', async () => {
      delete process.env.GOOGLE_MAPS_API_KEY;
      const result = await googleMaps.renderSiteMapDetailed({ lat: 12.97, lng: 77.59 });
      expect(result.buffer).toBeNull();
      expect(result.status).toBe('no_token');
      expect(result.error).toMatch(/GOOGLE_MAPS_API_KEY/);
    });

    test('returns no_coords when coords are invalid', async () => {
      process.env.GOOGLE_MAPS_API_KEY = 'AIzaSy-test';
      const result = await googleMaps.renderSiteMapDetailed({ lat: 'south', lng: null });
      expect(result.buffer).toBeNull();
      expect(result.status).toBe('no_coords');
      expect(result.error).toMatch(/finite/);
    });
  });

  describe('renderSiteMap (back-compat)', () => {
    afterEach(() => {
      delete process.env.GOOGLE_MAPS_API_KEY;
      googleMaps.__resetCache();
    });

    test('returns null without the API key', async () => {
      delete process.env.GOOGLE_MAPS_API_KEY;
      const result = await googleMaps.renderSiteMap({ lat: 12.97, lng: 77.59 });
      expect(result).toBeNull();
    });
  });

  describe('EDITORIAL_STYLE', () => {
    test('exposes the editorial palette rules and is non-empty', () => {
      expect(Array.isArray(googleMaps.EDITORIAL_STYLE)).toBe(true);
      expect(googleMaps.EDITORIAL_STYLE.length).toBeGreaterThan(5);
      // Sanity check — must contain a water rule and a poi-off rule
      expect(googleMaps.EDITORIAL_STYLE.join(';')).toMatch(/water/);
      expect(googleMaps.EDITORIAL_STYLE.join(';')).toMatch(/poi.*visibility:off/);
    });
  });
});
