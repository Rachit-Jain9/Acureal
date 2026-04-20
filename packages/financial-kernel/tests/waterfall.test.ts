import { Decimal } from '../src/decimal';
import { runWaterfall } from '../src/waterfall-engine';
import type { WaterfallTier } from '../src/waterfall-engine';

const cr = (n: number) => Decimal.fromNumber(n);

describe('waterfall — debt before equity', () => {
  test('senior debt fully paid before equity receives anything', () => {
    const seniorDebt: WaterfallTier = {
      id: 'sen',
      kind: 'senior_debt',
      priority: 1,
      stakeholders: [{ id: 'lender', role: 'senior_lender' }],
      demandPerMonth: [cr(10), cr(10), cr(10), cr(10)],
    };
    const equity: WaterfallTier = {
      id: 'eq',
      kind: 'common_equity',
      priority: 100,
      stakeholders: [{ id: 'sponsor', role: 'sponsor' }],
      demandPerMonth: [cr(5), cr(5), cr(5), cr(5)],
    };
    const out = runWaterfall({
      context: { structure: 'outright', totalMonths: 4 },
      tiers: [seniorDebt, equity],
      availableByMonth: [cr(6), cr(15), cr(20), cr(8)],
    });

    // Month 0: 6 < 10, all to senior debt, nothing to equity.
    const m0 = out.rows.filter((r) => r.month === 0);
    expect(m0.length).toBe(1);
    expect(m0[0].tierId).toBe('sen');
    expect(m0[0].amount.toNumber()).toBeCloseTo(6, 4);

    // Month 1: 15 covers 10 senior + 5 equity.
    const m1 = out.rows.filter((r) => r.month === 1);
    expect(m1.find((r) => r.tierId === 'sen')!.amount.toNumber()).toBeCloseTo(10, 4);
    expect(m1.find((r) => r.tierId === 'eq')!.amount.toNumber()).toBeCloseTo(5, 4);
  });

  test('pari-passu scaling when available < sum of same-priority demands', () => {
    const a: WaterfallTier = {
      id: 'a', kind: 'senior_debt', priority: 1,
      stakeholders: [{ id: 'x', role: 'senior_lender' }],
      demandPerMonth: [cr(10)],
    };
    const b: WaterfallTier = {
      id: 'b', kind: 'senior_debt', priority: 1,
      stakeholders: [{ id: 'y', role: 'senior_lender' }],
      demandPerMonth: [cr(10)],
    };
    const out = runWaterfall({
      context: { structure: 'outright', totalMonths: 1 },
      tiers: [a, b],
      availableByMonth: [cr(10)],
    });
    const rows = out.rows;
    expect(rows.length).toBe(2);
    expect(rows[0].amount.toNumber()).toBeCloseTo(5, 4);
    expect(rows[1].amount.toNumber()).toBeCloseTo(5, 4);
  });

  test('residual captures over-supply after all tiers satisfied', () => {
    const t: WaterfallTier = {
      id: 't', kind: 'senior_debt', priority: 1,
      stakeholders: [{ id: 'x', role: 'senior_lender' }],
      demandPerMonth: [cr(5)],
    };
    const out = runWaterfall({
      context: { structure: 'outright', totalMonths: 1 },
      tiers: [t],
      availableByMonth: [cr(12)],
    });
    expect(out.residualByMonth[0].toNumber()).toBeCloseTo(7, 4);
  });
});

describe('waterfall — JDA / JV hooks', () => {
  test('JDA landowner share uses allocation hook', () => {
    const landowner: WaterfallTier = {
      id: 'jda',
      kind: 'landowner_share',
      priority: 10,
      stakeholders: [{ id: 'owner', role: 'landowner' }],
      demandPerMonth: [cr(100)],
      // Custom split: owner takes 30% of the allocated amount, 70% goes to residual via leftover.
      allocate: ({ amount }) => ({
        perStakeholder: [{ stakeholderId: 'owner', amount: amount.mulNumber(0.3) }],
        leftover: amount.mulNumber(0.7),
      }),
    };
    const out = runWaterfall({
      context: { structure: 'jda', totalMonths: 1 },
      tiers: [landowner],
      availableByMonth: [cr(100)],
    });
    const allocated = out.rows.reduce<number>((a, r) => a + r.amount.toNumber(), 0);
    expect(allocated).toBeCloseTo(30, 4);
    // The other 70 flows as leftover inside the allocation, which the
    // engine does not recirculate by default — it is held in the tier
    // aggregation; the rest stays as residual since no other tier claimed it.
    expect(out.residualByMonth[0].toNumber()).toBeCloseTo(70, 4);
  });
});
