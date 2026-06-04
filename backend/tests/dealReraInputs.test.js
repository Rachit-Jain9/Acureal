'use strict';

/**
 * Unit tests for deal.service.sanitizeReraInputs — the bounded coercion of the
 * operator-supplied K-RERA applicability inputs before they hit the JSONB
 * column. Pure; no DB.
 */

const { sanitizeReraInputs } = require('../src/services/deal.service');

describe('sanitizeReraInputs', () => {
  test('accepts snake_case fields within bounds', () => {
    expect(
      sanitizeReraInputs({ unit_or_plot_count: 40, sale_intent: true, completion_date: '2027-12-31' }),
    ).toEqual({ unit_or_plot_count: 40, sale_intent: true, completion_date: '2027-12-31' });
  });

  test('accepts camelCase aliases', () => {
    expect(sanitizeReraInputs({ unitOrPlotCount: 12, saleIntent: false })).toEqual({
      unit_or_plot_count: 12,
      sale_intent: false,
    });
  });

  test('drops junk, invalid dates and out-of-range values', () => {
    expect(
      sanitizeReraInputs({ unit_or_plot_count: -5, completion_date: 'soon', random: 'x' }),
    ).toBeNull();
  });

  test('sanitises fee_overrides and strips unknown keys', () => {
    expect(
      sanitizeReraInputs({ fee_overrides: { category: 'mixed', amount_inr: 700000, note: 'as quoted', junk: 1 } }),
    ).toEqual({ fee_overrides: { category: 'mixed', amount_inr: 700000, note: 'as quoted' } });
  });

  test('null / non-object / array → null', () => {
    expect(sanitizeReraInputs(null)).toBeNull();
    expect(sanitizeReraInputs('x')).toBeNull();
    expect(sanitizeReraInputs([])).toBeNull();
    expect(sanitizeReraInputs({})).toBeNull();
  });

  test('coerces a float count to a whole number', () => {
    expect(sanitizeReraInputs({ unit_or_plot_count: 8.9 }).unit_or_plot_count).toBe(9);
  });
});
