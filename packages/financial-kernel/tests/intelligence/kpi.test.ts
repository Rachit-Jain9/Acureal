import { Decimal } from '../../src/decimal';
import {
  xirr,
  moic,
  dscrProfile,
  llcr,
  plcr,
  debtCapacity,
  paybackMonth,
  peakEquityOutflow,
  computeKPIs,
} from '../../src/intelligence/kpiEngine';

const cr = (n: number) => Decimal.fromNumber(n);

describe('kpiEngine — XIRR', () => {
  test('recovers 10% annual rate on a one-year round trip', () => {
    const cf = [cr(-100), cr(110)];
    const months = [0, 12];
    const rate = xirr(cf, months);
    expect(rate).not.toBeNull();
    expect(rate!.toNumber()).toBeCloseTo(0.10, 3);
  });

  test('returns null when cash flows lack a sign change', () => {
    expect(xirr([cr(-100), cr(-10)], [0, 12])).toBeNull();
    expect(xirr([cr(100), cr(10)], [0, 12])).toBeNull();
  });

  test('solves XIRR on a multi-month investment', () => {
    // Invest 100 at month 0, collect 30 at m12, 30 at m24, 60 at m36.
    const cf = [cr(-100), cr(30), cr(30), cr(60)];
    const months = [0, 12, 24, 36];
    const rate = xirr(cf, months);
    expect(rate).not.toBeNull();
    expect(rate!.toNumber()).toBeGreaterThan(0);
    expect(rate!.toNumber()).toBeLessThan(0.5);
  });

  test('returns null on empty inputs', () => {
    expect(xirr([], [])).toBeNull();
    expect(xirr([cr(0), cr(0)], [0, 12])).toBeNull();
  });
});

describe('kpiEngine — MOIC', () => {
  test('computes simple MOIC', () => {
    const m = moic([cr(150)], [cr(100)]);
    expect(m.toNumber()).toBeCloseTo(1.5, 6);
  });

  test('returns 0 when outflows are zero', () => {
    const m = moic([cr(100)], []);
    expect(m.toNumber()).toBeCloseTo(0, 6);
  });
});

describe('kpiEngine — DSCR profile', () => {
  test('returns null fields on empty input', () => {
    const p = dscrProfile([], []);
    expect(p.min).toBeNull();
    expect(p.avg).toBeNull();
    expect(p.countBelow1_0).toBe(0);
    expect(p.countBelow1_25).toBe(0);
  });

  test('computes stats and below-threshold counts', () => {
    const cfads = [cr(1), cr(1.2), cr(1.5), cr(2.0)];
    const ds = [cr(1), cr(1), cr(1), cr(1)];
    const p = dscrProfile(cfads, ds);
    expect(p.min!.toNumber()).toBeCloseTo(1.0, 3);
    expect(p.max!.toNumber()).toBeCloseTo(2.0, 3);
    expect(p.avg!.toNumber()).toBeCloseTo(1.425, 3);
    expect(p.countBelow1_25).toBe(2);
    expect(p.countBelow1_0).toBe(0);
  });

  test('excludes zero-debt-service months from distribution', () => {
    const cfads = [cr(5), cr(2), cr(2)];
    const ds = [cr(0), cr(1), cr(1)];
    const p = dscrProfile(cfads, ds);
    expect(p.min!.toNumber()).toBeCloseTo(2.0, 3);
    expect(p.max!.toNumber()).toBeCloseTo(2.0, 3);
  });
});

describe('kpiEngine — LLCR / PLCR', () => {
  test('LLCR = PV(CFADS) / current debt', () => {
    const cfads = Array.from({ length: 12 }, () => cr(1));
    const debt = [cr(10)];
    const r = llcr(cfads, debt, cr(0.06));
    expect(r).not.toBeNull();
    expect(r!.toNumber()).toBeGreaterThan(1.1);
    expect(r!.toNumber()).toBeLessThan(1.2);
  });

  test('returns null when current debt is zero', () => {
    expect(llcr([cr(1)], [cr(0)], cr(0.1))).toBeNull();
    expect(plcr([cr(1)], cr(0), cr(0.1))).toBeNull();
  });
});

describe('kpiEngine — debt capacity', () => {
  test('finds max debt where EMI-based DSCR meets target', () => {
    const cfads = [cr(1), cr(2), cr(2), cr(2)];
    const out = debtCapacity(cfads, cr(1.25), cr(0.1), 4);
    expect(out.bindingMonth).toBe(0);
    expect(out.maxDebtCr.toNumber()).toBeGreaterThan(0);
    expect(out.achievedMinDSCR!.toNumber()).toBeCloseTo(1.25, 3);
  });

  test('returns zero when no positive CFADS', () => {
    const out = debtCapacity([cr(0), cr(0)], cr(1.25), cr(0.1), 2);
    expect(out.maxDebtCr.toNumber()).toBe(0);
    expect(out.bindingMonth).toBeNull();
  });
});

describe('kpiEngine — payback / peak equity', () => {
  test('payback month is the first month cum cash crosses zero', () => {
    expect(paybackMonth([cr(-100), cr(50), cr(30), cr(40)])).toBe(3);
    expect(paybackMonth([cr(-100), cr(50), cr(30)])).toBeNull();
  });

  test('peak equity outflow is the most negative cum contribution', () => {
    expect(peakEquityOutflow([cr(-100), cr(-50), cr(30)]).toNumber()).toBeCloseTo(150, 3);
  });
});

describe('kpiEngine — computeKPIs bundle', () => {
  test('produces a fully-populated KPI object', () => {
    const months = Array.from({ length: 24 }, (_, i) => i);
    const cfads = Array.from({ length: 24 }, (_, i) => cr(i < 6 ? 0 : 2));
    const ds = Array.from({ length: 24 }, (_, i) => cr(i < 6 ? 0 : 1));
    const outstanding = Array.from({ length: 24 }, (_, i) => cr(Math.max(0, 100 - i * 4)));
    const equityCF = [cr(-50), ...Array.from({ length: 23 }, (_, i) => cr(i < 5 ? 0 : 4))];
    const kpis = computeKPIs({
      equityCashFlows: equityCF,
      equityMonths: equityCF.map((_, i) => i),
      projectCashFlows: [cr(-100), ...cfads.slice(1)],
      projectMonths: months,
      cfads,
      debtService: ds,
      debtOutstanding: outstanding,
      annualDiscount: cr(0.1),
      equityInflows: equityCF.filter((d) => d.toNumber() > 0),
      equityOutflows: equityCF.filter((d) => d.toNumber() < 0).map((d) => d.mulNumber(-1)),
      targetDSCR: cr(1.25),
      annualRate: cr(0.09),
      termMonths: 24,
    });
    expect(kpis.irrLevered).not.toBeNull();
    expect(kpis.dscrProfile.min).not.toBeNull();
    expect(kpis.llcr).not.toBeNull();
    expect(kpis.plcr).not.toBeNull();
    expect(kpis.peakEquityCr.toNumber()).toBeGreaterThanOrEqual(50);
    expect(kpis.debtCapacity.maxDebtCr.toNumber()).toBeGreaterThan(0);
  });
});
