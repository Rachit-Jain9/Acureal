import { Decimal } from '../../src/decimal';
import { tornado, spider } from '../../src/intelligence/sensitivityEngine';

const cr = (n: number) => Decimal.fromNumber(n);

describe('sensitivityEngine — tornado', () => {
  test('sorts rows by descending |swing|', () => {
    const out = tornado({
      targetKPI: 'irr_levered',
      baseKPI: cr(0.15),
      variables: [
        { name: 'rent_growth', base: cr(3.0), lowPct: -10, highPct: 10 },
        { name: 'cap_rate', base: cr(8.0), lowPct: -10, highPct: 10 },
        { name: 'construction_cost', base: cr(100), lowPct: -5, highPct: 5 },
      ],
      recompute: (over) => {
        // Cap-rate has biggest effect, then rent_growth, then construction_cost.
        const r = over['rent_growth'].toNumber();
        const c = over['cap_rate'].toNumber();
        const cc = over['construction_cost'].toNumber();
        return cr(0.15 + (r - 3) * 0.02 + (c - 8) * 0.05 + (cc - 100) * 0.0001);
      },
    });
    expect(out.rows.length).toBe(3);
    expect(out.rows[0].variable).toBe('cap_rate');
    for (let i = 1; i < out.rows.length; i++) {
      expect(out.rows[i - 1].swing).toBeGreaterThanOrEqual(out.rows[i].swing);
    }
  });

  test('skips variables whose recompute returns null', () => {
    const out = tornado({
      targetKPI: 'irr_levered',
      baseKPI: cr(0.15),
      variables: [
        { name: 'v1', base: cr(1), lowPct: -10, highPct: 10 },
        { name: 'v2', base: cr(2), lowPct: -10, highPct: 10 },
      ],
      recompute: (over) => (over['v1'].toNumber() === 0.9 ? null : cr(0.15)),
    });
    expect(out.rows.find((r) => r.variable === 'v1')).toBeUndefined();
    expect(out.rows.find((r) => r.variable === 'v2')).toBeDefined();
  });
});

describe('sensitivityEngine — spider', () => {
  test('produces a curve per variable across steps', () => {
    const out = spider({
      variables: [
        { name: 'rent', base: cr(10) },
        { name: 'cap', base: cr(8) },
      ],
      recompute: (over) => cr(over['rent'].toNumber() / over['cap'].toNumber()),
      steps: [-20, -10, 0, 10, 20],
    });
    expect(out.rent.length).toBe(5);
    expect(out.cap.length).toBe(5);
    // stepPct ascending
    for (let i = 1; i < out.rent.length; i++) {
      expect(out.rent[i].stepPct).toBeGreaterThan(out.rent[i - 1].stepPct);
    }
  });
});
