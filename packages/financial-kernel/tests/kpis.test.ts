import { Decimal } from '../src/decimal';
import { equityMultiple, grossMarginPct, irrAnnualPct, npv, residualLandValue } from '../src/kpis';

const D = (n: number) => Decimal.fromNumber(n);

describe('NPV', () => {
  test('empty series returns 0', () => {
    expect(npv([], 0.14).toNumber()).toBe(0);
  });

  test('zero discount rate equals undiscounted sum', () => {
    const cfs = [-100, 50, 50, 50].map(D);
    expect(npv(cfs, 0).toNumber()).toBeCloseTo(50, 6);
  });

  test('positive NPV for profitable monthly series', () => {
    const cfs = [-100, 0, 0, 0, 200].map(D);
    expect(npv(cfs, 0.14).toNumber()).toBeGreaterThan(0);
  });

  test('negative NPV for a loss-making series', () => {
    const cfs = [-1000, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10].map(D);
    expect(npv(cfs, 0.14).toNumber()).toBeLessThan(0);
  });
});

describe('IRR', () => {
  test('returns null if no sign change', () => {
    expect(irrAnnualPct([100, 200, 300].map(D))).toBeNull();
    expect(irrAnnualPct([-100, -200].map(D))).toBeNull();
  });

  test('positive IRR on a profitable monthly series', () => {
    const cfs = [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 200].map(D);
    const irr = irrAnnualPct(cfs);
    expect(irr).not.toBeNull();
    expect(irr!).toBeGreaterThan(30);
  });

  test('real-estate-shaped series gives a sensible IRR', () => {
    const cfs = [-50, -20, -10, -10, -10, 20, 30, 30, 40, 30, 20, 10, 60].map(D);
    const irr = irrAnnualPct(cfs);
    expect(irr).not.toBeNull();
    expect(irr!).toBeGreaterThan(0);
    expect(irr!).toBeLessThan(500);
  });
});

describe('residualLandValue', () => {
  test('computes the closed-form RLV correctly', () => {
    const rlv = residualLandValue({
      revenue: D(200),
      totalCostExLand: D(81),
      developerMarginPct: 20,
    });
    expect(rlv.toNumber()).toBeCloseTo((200 - 81) / 1.2, 4);
  });
});

describe('grossMargin + equityMultiple', () => {
  test('grossMarginPct computes 0 for zero revenue', () => {
    expect(grossMarginPct(D(0), D(10))).toBe(0);
  });
  test('equityMultiple returns null when equity=0', () => {
    expect(equityMultiple({ equityInvested: D(0), totalEquityReturns: D(100) })).toBeNull();
  });
  test('equityMultiple returns returns/equity otherwise', () => {
    expect(
      equityMultiple({ equityInvested: D(100), totalEquityReturns: D(250) }),
    ).toBeCloseTo(2.5, 6);
  });
});
