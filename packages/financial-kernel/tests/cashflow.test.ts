import { Decimal } from '../src/decimal';
import {
  aggregateNet,
  bulletInflow,
  bulletOutflow,
  distributeOutflow,
  milestoneSales,
  monthlyToQuarterly,
  sCurveConstruction,
} from '../src/cashflow';
import { buildPeriodIndex, sCurveWeights } from '../src/periods';

const period = buildPeriodIndex({
  effectiveDate: '2026-01-01',
  projectDurationMonths: 12,
  constructionStartMonth: 0,
  constructionEndMonth: 12,
});

const D = (n: number) => Decimal.fromNumber(n);

describe('cashflow primitives', () => {
  test('s-curve weights sum to 1', () => {
    const w = sCurveWeights(12);
    const total = w.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  test('sCurveConstruction totals to the input amount across the window', () => {
    const item = sCurveConstruction({ period, amount: D(120) });
    const total = item.values.reduce<Decimal>((acc, v) => acc.add(v), Decimal.zero());
    expect(total.toNumber()).toBeCloseTo(120, 4);
  });

  test('milestoneSales totals to the input revenue', () => {
    const item = milestoneSales({
      period,
      amount: D(500),
      startMonth: 3,
      endMonth: 12,
    });
    const total = item.values.reduce<Decimal>((acc, v) => acc.add(v), Decimal.zero());
    expect(total.toNumber()).toBeCloseTo(500, 4);
  });

  test('aggregateNet subtracts outflows from inflows', () => {
    const items = [
      bulletInflow({ period, month: 1, amount: D(100), category: 'revenue' }),
      bulletOutflow({ period, month: 1, amount: D(40), category: 'cost' }),
    ];
    const net = aggregateNet(items, period);
    expect(net[1].toNumber()).toBeCloseTo(60, 6);
  });

  test('monthlyToQuarterly rolls 12 months into 4 quarters', () => {
    const monthly = Array.from({ length: 12 }, () => D(1));
    const q = monthlyToQuarterly(monthly);
    expect(q.length).toBe(4);
    expect(q[0].toNumber()).toBeCloseTo(3, 6);
  });

  test('distributeOutflow respects weights', () => {
    const item = distributeOutflow({
      period,
      startMonth: 2,
      amount: D(100),
      weights: [0.25, 0.25, 0.5],
      category: 'x',
    });
    expect(item.values[2].toNumber()).toBeCloseTo(25, 6);
    expect(item.values[3].toNumber()).toBeCloseTo(25, 6);
    expect(item.values[4].toNumber()).toBeCloseTo(50, 6);
    expect(item.values[5].toNumber()).toBe(0);
  });
});
