'use strict';

const PptxGenJS = require('pptxgenjs');
const { drawAssetClassCover, RENDERERS } = require('../src/services/exports/pptx/coverArtwork');

const buildSlide = () => {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  const slide = pptx.addSlide();
  return { pptx, slide };
};

describe('services/exports/pptx/coverArtwork', () => {
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

  test('drawAssetClassCover does not throw for any supported class', () => {
    Object.keys(RENDERERS).forEach((cls) => {
      const { pptx, slide } = buildSlide();
      expect(() => drawAssetClassCover(pptx, slide, cls, { x: 6.65, y: 0, w: 6.68, h: 7.5 })).not.toThrow();
    });
  });

  test('falls back to residential renderer for unknown class without throwing', () => {
    const { pptx, slide } = buildSlide();
    expect(() => drawAssetClassCover(pptx, slide, 'unknown_xyz', { x: 0, y: 0, w: 6.68, h: 7.5 })).not.toThrow();
  });

  test('handles a degenerate bbox (zero width) without throwing', () => {
    const { pptx, slide } = buildSlide();
    expect(() => drawAssetClassCover(pptx, slide, 'commercial_office', { x: 0, y: 0, w: 0, h: 0 })).not.toThrow();
  });
});
