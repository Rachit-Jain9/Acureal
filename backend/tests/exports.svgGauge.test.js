'use strict';

const svgGauge = require('../src/services/exports/shared/svgGauge.service');

describe('services/exports/shared/svgGauge', () => {
  describe('renderScoreGaugeSvg', () => {
    test('returns a valid SVG string for a typical score', () => {
      const svg = svgGauge.renderScoreGaugeSvg({ score: 72 });
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).toMatch(/>72</);
    });

    test('clamps score to [0, 100]', () => {
      expect(svgGauge.renderScoreGaugeSvg({ score: -50 })).toMatch(/>0</);
      expect(svgGauge.renderScoreGaugeSvg({ score: 250 })).toMatch(/>100</);
    });

    test('handles non-numeric score by defaulting to 0', () => {
      const svg = svgGauge.renderScoreGaugeSvg({ score: 'high' });
      expect(svg).toMatch(/>0</);
    });

    test('uses custom subline if provided', () => {
      const svg = svgGauge.renderScoreGaugeSvg({ score: 60, subline: 'Composite vs benchmark' });
      expect(svg).toMatch(/Composite vs benchmark/);
    });

    test('escapes XML metacharacters in label/subline', () => {
      const svg = svgGauge.renderScoreGaugeSvg({
        score: 50,
        label: 'Mid <range>',
        subline: 'A & B',
      });
      expect(svg).toMatch(/Mid &lt;range&gt;/);
      expect(svg).toMatch(/A &amp; B/);
    });

    test('omits subline element when no subline provided', () => {
      const svg = svgGauge.renderScoreGaugeSvg({ score: 80 });
      // No empty <text> element with no content
      const textTags = svg.match(/<text[^>]*>(.*?)<\/text>/g) || [];
      textTags.forEach((tag) => {
        // empty text content is allowed only for the "/100" decorator
        // but no spurious empty subline should appear with whitespace only.
        expect(tag).not.toMatch(/<text[^>]*>\s*<\/text>/);
      });
    });
  });

  describe('renderScoreGaugeDataUri', () => {
    test('returns a base64-encoded data URI', () => {
      const uri = svgGauge.renderScoreGaugeDataUri({ score: 42 });
      expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
      const base64 = uri.replace('data:image/svg+xml;base64,', '');
      const decoded = Buffer.from(base64, 'base64').toString('utf8');
      expect(decoded.startsWith('<svg')).toBe(true);
      expect(decoded).toMatch(/>42</);
    });
  });

  describe('colour bands', () => {
    test('color tier shifts at thresholds', () => {
      const { __internal } = svgGauge;
      const palette = require('../src/services/exports/shared/palette');
      expect(__internal.colorForScore(85)).toBe(`#${palette.RAW.dataPositive}`);
      expect(__internal.colorForScore(60)).toBe(`#${palette.RAW.accent}`);
      expect(__internal.colorForScore(40)).toBe(`#${palette.RAW.dataWarning}`);
      expect(__internal.colorForScore(10)).toBe(`#${palette.RAW.dataNegative}`);
    });

    test('label tier shifts at thresholds', () => {
      const { __internal } = svgGauge;
      expect(__internal.labelForScore(85)).toBe('Strong');
      expect(__internal.labelForScore(70)).toBe('Above benchmark');
      expect(__internal.labelForScore(55)).toBe('In line');
      expect(__internal.labelForScore(40)).toBe('Below benchmark');
      expect(__internal.labelForScore(10)).toBe('Weak');
    });
  });
});
