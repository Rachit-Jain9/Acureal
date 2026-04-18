import {
  toSqft,
  fromSqft,
  toCrore,
  toMonths,
  toPercent,
  toFraction,
  DEFAULT_USD_INR,
} from '../src/units';

describe('toSqft', () => {
  test('passes sqft through', () => expect(toSqft(1000, 'sqft')).toBe(1000));
  test('acres → sqft', () => expect(toSqft(1, 'acre')).toBeCloseTo(43_560, 3));
  test('sqyd → sqft', () => expect(toSqft(1, 'sqyd')).toBeCloseTo(9, 3));
  test('sqm → sqft', () => expect(toSqft(1, 'sqm')).toBeCloseTo(10.7639, 3));
  test('hectare → sqft', () => expect(toSqft(1, 'hectare')).toBeCloseTo(107_639, 0));
  test('non-finite → 0', () => expect(toSqft(NaN, 'acre')).toBe(0));
});

describe('fromSqft', () => {
  test('round-trip acre', () => expect(fromSqft(toSqft(2.5, 'acre'), 'acre')).toBeCloseTo(2.5, 6));
});

describe('toCrore', () => {
  test('crore pass-through', () => expect(toCrore({ value: 15.5, unit: 'crore' })).toBe(15.5));
  test('lakh → crore', () => expect(toCrore({ value: 100, unit: 'lakh' })).toBe(1));
  test('INR → crore', () => expect(toCrore({ value: 1e8, unit: 'INR' })).toBe(10));
  test('USD default fx', () =>
    expect(toCrore({ value: 100_000, unit: 'USD' })).toBeCloseTo((100_000 * DEFAULT_USD_INR) / 1e7, 4));
  test('USD with explicit fx', () =>
    expect(toCrore({ value: 1_000_000, unit: 'USD', fxINR: 80 })).toBe(8));
});

describe('toMonths', () => {
  test('months pass-through', () => expect(toMonths(42)).toBe(42));
  test('years → months', () => expect(toMonths(3, 'years')).toBe(36));
  test('quarters → months', () => expect(toMonths(4, 'quarters')).toBe(12));
});

describe('toPercent', () => {
  test('percent form preserved', () => expect(toPercent(12.5)).toBe(12.5));
  test('fraction becomes percent', () => expect(toPercent(0.125)).toBe(12.5));
  test('0 stays 0', () => expect(toPercent(0)).toBe(0));
  test('NaN → 0', () => expect(toPercent('oops')).toBe(0));
});

describe('toFraction', () => {
  test('percent → fraction', () => expect(toFraction(15)).toBe(0.15));
});
