import { Decimal, sum } from '../src/decimal';

describe('Decimal', () => {
  test('round-trips common money values', () => {
    expect(Decimal.fromNumber(0).toNumber()).toBe(0);
    expect(Decimal.fromNumber(-0).toNumber()).toBe(0);
    expect(Decimal.fromNumber(155).toNumber()).toBe(155);
    expect(Decimal.fromNumber(155.25).toNumber()).toBeCloseTo(155.25, 6);
  });

  test('exact addition where floats would drift', () => {
    const a = Decimal.fromNumber(0.1);
    const b = Decimal.fromNumber(0.2);
    expect(a.add(b).toString()).toBe('0.3');
  });

  test('preserves scale through multiplication', () => {
    const rev = Decimal.fromNumber(200);
    const pct = Decimal.fromNumber(0.18);
    expect(rev.mul(pct).toNumber()).toBeCloseTo(36, 6);
  });

  test('division by zero throws', () => {
    expect(() => Decimal.fromNumber(1).div(Decimal.zero())).toThrow();
    expect(() => Decimal.fromNumber(1).divInt(0)).toThrow();
  });

  test('sum over an array returns a Decimal at default scale', () => {
    const vals = [1, 2, 3, 4.5].map((v) => Decimal.fromNumber(v));
    expect(sum(vals).toNumber()).toBeCloseTo(10.5, 6);
  });

  test('fromString handles negative and fractional exactly', () => {
    expect(Decimal.fromString('-0.05').toString()).toBe('-0.05');
    expect(Decimal.fromString('123456789.1234567891').toString()).toBe('123456789.1234567891');
  });

  test('compare orders values correctly', () => {
    expect(Decimal.fromNumber(1).compare(Decimal.fromNumber(2))).toBe(-1);
    expect(Decimal.fromNumber(2).compare(Decimal.fromNumber(2))).toBe(0);
    expect(Decimal.fromNumber(3).compare(Decimal.fromNumber(2))).toBe(1);
  });
});
