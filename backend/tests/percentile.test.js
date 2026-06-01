const { percentile, median } = require('../src/utils/percentile');

describe('percentile (type-7 linear interpolation)', () => {
  test('returns null for empty / non-array input', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile(null, 0.5)).toBeNull();
    expect(median([])).toBeNull();
  });

  test('single element returns that element', () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.25)).toBe(42);
  });

  test('median of an even-length set averages the two central values', () => {
    expect(median([12000, 18000])).toBe(15000); // not 18000 (the old upper-middle bug)
    expect(median([8200, 9100, 10000, 11000])).toBe(9550);
  });

  test('median of an odd-length set is the middle value', () => {
    expect(median([10, 20, 30])).toBe(20);
  });

  test('p25 / p75 interpolate between ranks', () => {
    const xs = [10, 20, 30, 40, 50];
    expect(percentile(xs, 0.25)).toBe(20);
    expect(percentile(xs, 0.75)).toBe(40);
    expect(percentile([12000, 18000], 0.75)).toBe(16500);
    expect(percentile([12000, 18000], 0.25)).toBe(13500);
  });

  test('sorts unsorted input and drops non-finite values', () => {
    expect(median([30, 10, 20])).toBe(20);
    expect(median([10, NaN, 20, undefined, 30])).toBe(20);
  });

  test('clamps p outside [0, 1]', () => {
    const xs = [10, 20, 30];
    expect(percentile(xs, -1)).toBe(10);
    expect(percentile(xs, 2)).toBe(30);
  });
});
