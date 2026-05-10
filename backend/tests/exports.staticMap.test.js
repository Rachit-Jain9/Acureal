'use strict';

const staticMap = require('../src/services/exports/shared/staticMap.service');

describe('services/exports/shared/staticMap', () => {
  describe('isMapsEnabled', () => {
    afterEach(() => {
      delete process.env.MAPBOX_TOKEN;
    });

    test('false when MAPBOX_TOKEN unset', () => {
      delete process.env.MAPBOX_TOKEN;
      expect(staticMap.isMapsEnabled()).toBe(false);
    });

    test('false when MAPBOX_TOKEN is a placeholder', () => {
      process.env.MAPBOX_TOKEN = 'YOUR_MAPBOX_TOKEN';
      expect(staticMap.isMapsEnabled()).toBe(false);
    });

    test('true when MAPBOX_TOKEN is a real value', () => {
      process.env.MAPBOX_TOKEN = 'pk.test.real-token';
      expect(staticMap.isMapsEnabled()).toBe(true);
    });
  });

  describe('buildMapboxUrl', () => {
    test('throws on non-finite coordinates', () => {
      expect(() => staticMap.buildMapboxUrl({ lat: NaN, lng: 77 })).toThrow();
      expect(() => staticMap.buildMapboxUrl({ lat: 12.97, lng: 'east' })).toThrow();
    });

    test('clamps lat to [-85, 85] and normalizes lng to [-180, 180]', () => {
      const url1 = staticMap.buildMapboxUrl({ lat: 95, lng: 0, zoom: 14 });
      expect(url1).toMatch(/0,85,14/);
      const url2 = staticMap.buildMapboxUrl({ lat: 0, lng: 360, zoom: 14 });
      // 360 normalises to 0
      expect(url2).toMatch(/0,0,14/);
      const url3 = staticMap.buildMapboxUrl({ lat: 0, lng: 540, zoom: 14 });
      // 540 normalises to 180 mod 360 → -180 (or +180 — both valid centroids)
      expect(url3).toMatch(/(-?180),0,14/);
    });

    test('clamps zoom to [0, 22]', () => {
      const url = staticMap.buildMapboxUrl({ lat: 12.97, lng: 77.59, zoom: 99 });
      expect(url).toMatch(/77\.59,12\.97,22/);
    });

    test('returns a URL with default style and retina suffix', () => {
      const url = staticMap.buildMapboxUrl({ lat: 12.97, lng: 77.59, zoom: 13 });
      expect(url).toMatch(/styles\/v1\/mapbox\/light-v11\/static/);
      expect(url).toMatch(/@2x$/);
    });

    test('embeds a marker correctly', () => {
      const url = staticMap.buildMapboxUrl({
        lat: 12.97,
        lng: 77.59,
        zoom: 14,
        markers: [{ lat: 12.97, lng: 77.59, color: 'B5793C', label: 'Site', size: 'l' }],
      });
      expect(url).toMatch(/pin-l-Site\+b5793c\(77\.59,12\.97\)/);
    });

    test('skips markers with non-finite coords', () => {
      const url = staticMap.buildMapboxUrl({
        lat: 12.97,
        lng: 77.59,
        zoom: 14,
        markers: [
          { lat: NaN, lng: 77.59, color: 'B5793C' },
          { lat: 12.95, lng: 77.61, color: '0F7B5A' },
        ],
      });
      expect(url).not.toMatch(/NaN/);
      expect(url).toMatch(/pin-l\+0f7b5a\(77\.61,12\.95\)/);
    });
  });

  describe('renderSiteMap', () => {
    afterEach(() => {
      delete process.env.MAPBOX_TOKEN;
      staticMap.__resetCache();
    });

    test('returns null when MAPBOX_TOKEN not set', async () => {
      delete process.env.MAPBOX_TOKEN;
      const result = await staticMap.renderSiteMap({ lat: 12.97, lng: 77.59 });
      expect(result).toBeNull();
    });

    test('returns null on invalid coordinates even if token is set', async () => {
      process.env.MAPBOX_TOKEN = 'pk.test.real';
      const result = await staticMap.renderSiteMap({ lat: 'south', lng: null });
      expect(result).toBeNull();
    });
  });

  describe('renderCompsMap', () => {
    afterEach(() => {
      delete process.env.MAPBOX_TOKEN;
      staticMap.__resetCache();
    });

    test('returns null without MAPBOX_TOKEN', async () => {
      const result = await staticMap.renderCompsMap({ siteLat: 12.97, siteLng: 77.59, comps: [] });
      expect(result).toBeNull();
    });

    test('returns null with non-finite site coords', async () => {
      process.env.MAPBOX_TOKEN = 'pk.test.real';
      const result = await staticMap.renderCompsMap({ siteLat: NaN, siteLng: 77.59, comps: [] });
      expect(result).toBeNull();
    });
  });
});
