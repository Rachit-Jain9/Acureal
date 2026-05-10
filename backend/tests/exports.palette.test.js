'use strict';

const palette = require('../src/services/exports/shared/palette');

describe('services/exports/shared/palette', () => {
  test('exposes hex tokens without leading "#" via pptx()', () => {
    expect(palette.pptx('inkDeep')).toBe('0E1B2C');
    expect(palette.pptx('accent')).toBe('B5793C');
    expect(palette.pptx('paper')).toBe('FBF9F6');
    // No tokens should accidentally include a "#" prefix.
    Object.keys(palette.RAW).forEach((token) => {
      expect(palette.pptx(token)).not.toMatch(/^#/);
      expect(palette.pptx(token)).toMatch(/^[0-9A-F]{6}$/i);
    });
  });

  test('xlsx() returns ARGB with FF prefix', () => {
    expect(palette.xlsx('inkDeep')).toBe('FF0E1B2C');
    expect(palette.xlsx('dataPositive')).toBe('FF0F7B5A');
    expect(palette.xlsx('hairline')).toBe('FFD7DDE5');
  });

  test('css() returns hex with leading "#"', () => {
    expect(palette.css('paper')).toBe('#FBF9F6');
    expect(palette.css('dataNegative')).toBe('#B23A48');
  });

  test('docx() matches pptx() format (hex without "#")', () => {
    Object.keys(palette.RAW).forEach((token) => {
      expect(palette.docx(token)).toBe(palette.pptx(token));
    });
  });

  test('severityColor maps known severities correctly', () => {
    expect(palette.severityColor('critical')).toBe(palette.pptx('dataNegative'));
    expect(palette.severityColor('high'))    .toBe(palette.pptx('dataNegative'));
    expect(palette.severityColor('medium'))  .toBe(palette.pptx('dataWarning'));
    expect(palette.severityColor('low'))     .toBe(palette.pptx('mutedHigh'));
    expect(palette.severityColor('info'))    .toBe(palette.pptx('mutedHigh'));
  });

  test('severityColor falls back to mutedHigh for unknown severity', () => {
    expect(palette.severityColor('rainbow')).toBe(palette.pptx('mutedHigh'));
    expect(palette.severityColor(null))     .toBe(palette.pptx('mutedHigh'));
    expect(palette.severityColor(undefined)).toBe(palette.pptx('mutedHigh'));
  });

  test('severityColor format switch returns correct prefix per consumer', () => {
    expect(palette.severityColor('critical', 'css')).toBe(palette.css('dataNegative'));
    expect(palette.severityColor('critical', 'xlsx')).toBe(palette.xlsx('dataNegative'));
    expect(palette.severityColor('critical', 'docx')).toBe(palette.docx('dataNegative'));
    expect(palette.severityColor('critical', 'pptx')).toBe(palette.pptx('dataNegative'));
  });

  test('deltaColor signs positive/negative/zero correctly', () => {
    expect(palette.deltaColor(2.5)).toBe(palette.pptx('dataPositive'));
    expect(palette.deltaColor(-0.1)).toBe(palette.pptx('dataNegative'));
    expect(palette.deltaColor(0)).toBe(palette.pptx('mutedHigh'));
    expect(palette.deltaColor(null)).toBe(palette.pptx('mutedHigh'));
    expect(palette.deltaColor(NaN)).toBe(palette.pptx('mutedHigh'));
  });

  test('FONTS / TYPE_SCALE expose the expected shape', () => {
    expect(palette.FONTS.display).toBe('Calibri');
    expect(palette.FONTS.body).toBe('Calibri');
    expect(typeof palette.TYPE_SCALE.h1).toBe('number');
    expect(typeof palette.TYPE_SCALE.body).toBe('number');
    expect(palette.TYPE_SCALE.hero).toBeGreaterThan(palette.TYPE_SCALE.h1);
  });

  test('RAW tokens are immutable (frozen)', () => {
    expect(Object.isFrozen(palette.RAW)).toBe(true);
  });
});
