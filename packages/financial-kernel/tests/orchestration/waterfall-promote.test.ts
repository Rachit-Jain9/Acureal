import { Decimal } from '../../src/decimal';
import {
  runWaterfall,
  buildPrefCatchPromoteTiers,
  sumStakeholder,
} from '../../src/waterfall-engine';

const cr = (n: number) => Decimal.fromNumber(n);

describe('pref / catch-up / promote waterfall', () => {
  test('LP receives return of capital before any promote flow', () => {
    const tiers = buildPrefCatchPromoteTiers({
      lpId: 'lp',
      sponsorId: 'sp',
      lpCapitalCr: cr(80),
      sponsorCapitalCr: cr(20),
      prefRatePct: cr(8),
      catchUpPct: cr(100),
      promotePct: cr(20),
      horizonMonths: 12,
    });
    // $50Cr in month 0 — not yet enough to complete ROC.
    const result = runWaterfall({
      context: { structure: 'jv', totalMonths: 12 },
      tiers,
      availableByMonth: [cr(50), ...Array.from({ length: 11 }, () => Decimal.zero())],
    });
    const lpShareOfRoc = result.rows
      .filter((r) => r.month === 0 && r.tierId === 'roc' && r.stakeholderId === 'lp')
      .reduce((a, r) => a.add(r.amount), Decimal.zero());
    const spShareOfRoc = result.rows
      .filter((r) => r.month === 0 && r.tierId === 'roc' && r.stakeholderId === 'sp')
      .reduce((a, r) => a.add(r.amount), Decimal.zero());
    // LP should receive ~80% of ROC (matches contribution share).
    expect(lpShareOfRoc.toNumber()).toBeCloseTo(40, 3);
    expect(spShareOfRoc.toNumber()).toBeCloseTo(10, 3);
    // No promote or catch-up payments until ROC and pref are satisfied.
    const promoteAny = result.rows.some(
      (r) => (r.tierId === 'catchup' || r.tierId === 'promote') && r.amount.toNumber() > 0,
    );
    expect(promoteAny).toBe(false);
  });

  test('promote splits residual 80/20 after ROC and pref are paid', () => {
    const tiers = buildPrefCatchPromoteTiers({
      lpId: 'lp',
      sponsorId: 'sp',
      lpCapitalCr: cr(80),
      sponsorCapitalCr: cr(20),
      prefRatePct: cr(0),
      catchUpPct: cr(0),
      promotePct: cr(20),
      horizonMonths: 3,
    });
    // Supply enough to fully return capital plus a $100Cr surplus.
    const result = runWaterfall({
      context: { structure: 'jv', totalMonths: 3 },
      tiers,
      availableByMonth: [cr(200), Decimal.zero(), Decimal.zero()],
    });
    const lpTotal = sumStakeholder(result.rows, 'lp');
    const spTotal = sumStakeholder(result.rows, 'sp');
    // ROC returns 80/20. Residual 100 splits 80/20.
    // LP = 80 (ROC) + 80 (residual) = 160
    // SP = 20 (ROC) + 20 (residual) = 40
    expect(lpTotal.toNumber()).toBeCloseTo(160, 3);
    expect(spTotal.toNumber()).toBeCloseTo(40, 3);
    expect(result.residualByMonth.reduce((a, d) => a.add(d), Decimal.zero()).toNumber()).toBeCloseTo(0, 3);
  });

  test('catch-up redirects distributions to sponsor when pref paid', () => {
    const tiers = buildPrefCatchPromoteTiers({
      lpId: 'lp',
      sponsorId: 'sp',
      lpCapitalCr: cr(80),
      sponsorCapitalCr: cr(20),
      prefRatePct: cr(12),
      catchUpPct: cr(100),
      promotePct: cr(20),
      horizonMonths: 12,
    });
    // Month 0: half of ROC. Month 1: rest of ROC + pref accrues + trigger catchup.
    const supply = Array.from({ length: 12 }, (_, i) => {
      if (i === 0) return cr(50);
      if (i === 1) return cr(100);
      return Decimal.zero();
    });
    const result = runWaterfall({
      context: { structure: 'jv', totalMonths: 12 },
      tiers,
      availableByMonth: supply,
    });
    const catchupRows = result.rows.filter((r) => r.tierId === 'catchup');
    const anyCatchup = catchupRows.some((r) => r.amount.toNumber() > 0);
    // Pref accrues over the two months of unreturned capital → catch-up
    // triggers once pref has been paid.
    expect(anyCatchup).toBe(true);
  });

  test('demandFn state-aware gates tiers correctly', () => {
    const tiers = buildPrefCatchPromoteTiers({
      lpId: 'lp',
      sponsorId: 'sp',
      lpCapitalCr: cr(50),
      sponsorCapitalCr: cr(50),
      prefRatePct: cr(6),
      catchUpPct: cr(100),
      promotePct: cr(20),
      horizonMonths: 6,
    });
    // Feed just enough to finish ROC exactly.
    const result = runWaterfall({
      context: { structure: 'jv', totalMonths: 6 },
      tiers,
      availableByMonth: [cr(100), Decimal.zero(), Decimal.zero(), Decimal.zero(), Decimal.zero(), Decimal.zero()],
    });
    // All 100 should go to ROC; nothing to pref/promote yet (month 0).
    const rocSum = result.rows
      .filter((r) => r.tierId === 'roc')
      .reduce((a, r) => a.add(r.amount), Decimal.zero());
    expect(rocSum.toNumber()).toBeCloseTo(100, 3);
  });
});
