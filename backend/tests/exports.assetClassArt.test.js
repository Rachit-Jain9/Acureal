'use strict';

const { renderAssetClassArt, RENDERERS } = require('../src/services/exports/shared/assetClassArt.service');

describe('services/exports/shared/assetClassArt', () => {
  test('exposes a renderer for every supported asset class', () => {
    const expected = [
      'residential_apartments', 'villas', 'plotted_development',
      'commercial_office', 'retail', 'industrial_warehousing',
      'hospitality', 'mixed_use', 'raw_land', 'redevelopment',
    ];
    expected.forEach((c) => {
      expect(typeof RENDERERS[c]).toBe('function');
    });
  });

  test('returns a valid SVG string and base64 data URI for residential', () => {
    const art = renderAssetClassArt('residential_apartments');
    expect(art.svg.startsWith('<svg')).toBe(true);
    expect(art.svg.endsWith('</svg>')).toBe(true);
    expect(art.dataUri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    // Atmospheric residential SVG includes a sky linearGradient and lit windows
    expect(art.svg).toMatch(/<linearGradient id="sky-residential"/);
    expect(art.svg).toMatch(/#FFD089/); // warm window-glow colour
  });

  test('industrial warehousing SVG references warehouse imagery', () => {
    const art = renderAssetClassArt('industrial_warehousing');
    // Saw-tooth roof is built from polygons
    expect(art.svg).toMatch(/<polygon/);
    // Truck-dock door pattern
    expect(art.svg).toMatch(/<rect/);
  });

  test('falls back to residential for unknown asset class', () => {
    const known = renderAssetClassArt('residential_apartments');
    const fallback = renderAssetClassArt('unknown_class_xyz');
    // Fallback should produce identical SVG content (same renderer)
    expect(fallback.svg.length).toBe(known.svg.length);
  });

  test('every renderer produces a parseable SVG string with the standard viewBox', () => {
    Object.entries(RENDERERS).forEach(([key, renderer]) => {
      const svg = renderer();
      expect(svg.startsWith('<svg')).toBe(true);
      // Atmospheric portrait orientation matching the cover panel ratio
      expect(svg).toMatch(/viewBox="0 0 1000 1200"/);
      expect(svg).toMatch(/role="img"/);
      // Decode-and-check round-trip
      const base64 = Buffer.from(svg, 'utf8').toString('base64');
      expect(Buffer.from(base64, 'base64').toString('utf8')).toBe(svg);
    });
  });

  test('label is normalised from the asset class key', () => {
    expect(renderAssetClassArt('residential_apartments').label).toBe('residential apartments');
    expect(renderAssetClassArt('raw_land').label).toBe('raw land');
  });
});
