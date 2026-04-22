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

  // Regression: without `toJSON`, `JSON.stringify(decimal)` walks the
  // instance's own properties and hits `q: bigint`, throwing
  // `TypeError: Do not know how to serialize a BigInt`. That surfaces
  // in production as "quick-compute failed" / "calculate failed" any
  // time a raw Decimal leaks into `res.json()` or a JSONB write (e.g.
  // `costs.extras`, `revenue.extras`, `financing.debtDrawn`). The fix
  // is `Decimal.prototype.toJSON` returning `toNumber()`, which JSON
  // automatically invokes at every serialization boundary.
  describe('JSON serialization', () => {
    test('a bare Decimal stringifies to its number form', () => {
      const d = Decimal.fromNumber(123.45);
      expect(() => JSON.stringify(d)).not.toThrow();
      expect(JSON.stringify(d)).toBe('123.45');
    });

    test('Decimal inside an object becomes a number in the JSON output', () => {
      const obj = {
        landCr: Decimal.fromNumber(30),
        stampDutyCr: Decimal.fromNumber(1.65),
        extras: { tenantImprovementsCr: Decimal.fromNumber(2.5) },
      };
      const parsed = JSON.parse(JSON.stringify(obj));
      expect(parsed.landCr).toBeCloseTo(30, 6);
      expect(parsed.stampDutyCr).toBeCloseTo(1.65, 6);
      expect(parsed.extras.tenantImprovementsCr).toBeCloseTo(2.5, 6);
    });

    test('nested arrays of Decimals stringify without BigInt errors', () => {
      const values = [1.1, 2.2, 3.3].map((n) => Decimal.fromNumber(n));
      const payload = { monthly: { values } };
      expect(() => JSON.stringify(payload)).not.toThrow();
      const parsed = JSON.parse(JSON.stringify(payload));
      expect(parsed.monthly.values).toEqual([
        expect.closeTo(1.1, 6),
        expect.closeTo(2.2, 6),
        expect.closeTo(3.3, 6),
      ]);
    });

    test('zero and negative Decimals round-trip through JSON', () => {
      expect(JSON.stringify(Decimal.zero())).toBe('0');
      expect(JSON.stringify(Decimal.fromNumber(-0.05))).toBe('-0.05');
    });
  });
});
