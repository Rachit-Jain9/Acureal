/**
 * Tests for the enhanced buildInvestorPackage: severity sort, grouping
 * by kind, recommendation dedupe, full KPI surface.
 */
import { Decimal } from '../../src/decimal';
import { FinancialOrchestrator } from '../../src/orchestration/orchestrator';
import { buildPrefCatchPromoteTiers } from '../../src/waterfall-engine';
import { buildInvestorPackage } from '../../src/exports/intelligentReport';
import type { OrchestrationInput } from '../../src/orchestration/types';
import type { FacilitySpec } from '../../src/debt-engine';
import { commercialSample } from '../fixtures';

const cr = (n: number) => Decimal.fromNumber(n);

function input(): OrchestrationInput {
  const horizon = 48;
  const facility: FacilitySpec = {
    id: 'perm',
    kind: 'amortizing_emi',
    currency: 'INR',
    commitment: cr(70),
    startMonth: 0,
    maturityMonth: horizon,
    rate: { kind: 'fixed', annualPct: 9 },
    compounding: 'monthly',
    drawRule: { kind: 'bullet_at_origination' },
    amortizationTermMonths: horizon,
  };
  const tiers = buildPrefCatchPromoteTiers({
    lpId: 'lp',
    sponsorId: 'sp',
    lpCapitalCr: cr(40),
    sponsorCapitalCr: cr(10),
    prefRatePct: cr(8),
    catchUpPct: cr(100),
    promotePct: cr(20),
    horizonMonths: horizon,
  });
  const equityCF = Array.from({ length: horizon }, (_, i) =>
    i === 0 ? cr(-50) : cr(i < 6 ? 0 : 1.3),
  );
  return {
    dealId: 'deal-exp-1',
    dealInputs: commercialSample,
    totalMonths: horizon,
    facilities: [facility],
    cfadsInputs: {
      revenue: Array.from({ length: horizon }, (_, i) => cr(i < 6 ? 0 : 3.5)),
      opex: Array.from({ length: horizon }, (_, i) => cr(i < 6 ? 0 : 0.7)),
      taxes: Array.from({ length: horizon }, (_, i) => cr(i < 6 ? 0 : 0.3)),
      maintenanceCapex: Array.from({ length: horizon }, (_, i) => cr(i < 6 ? 0 : 0.1)),
    },
    covenantInputs: { projectCostCr: cr(130), propertyValueCr: cr(160) },
    waterfall: { tiers, availableByMonth: [], structure: 'jv' },
    intelligence: {
      enabled: true,
      equityCashFlows: equityCF,
      annualDiscountRate: cr(0.1),
      targetDSCR: cr(1.25),
      annualRate: cr(0.09),
      sensitivity: false,
    },
  };
}

describe('buildInvestorPackage — enhanced surface', () => {
  const prior = { ...process.env };
  beforeEach(() => {
    process.env = {
      ...prior,
      DEBT_ENGINE_SILENT: '1',
    };
    delete process.env.DEBT_ENGINE_KILL;
    delete process.env.DEBT_ENGINE_V2_KILL;
    delete process.env.DEBT_ENGINE_PY_URL;
  });
  afterEach(() => { process.env = { ...prior }; });

  test('insights are sorted by severity descending', async () => {
    const out = await new FinancialOrchestrator().compute(input());
    const pkg = buildInvestorPackage(out, out.intelligence!, 'deal-exp-1');
    const rank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    for (let i = 1; i < pkg.summary.insights.length; i++) {
      expect(rank[pkg.summary.insights[i - 1].severity])
        .toBeGreaterThanOrEqual(rank[pkg.summary.insights[i].severity]);
    }
  });

  test('insightsByKind partitions all insights, no loss', async () => {
    const out = await new FinancialOrchestrator().compute(input());
    const pkg = buildInvestorPackage(out, out.intelligence!, 'deal-exp-1');
    const sum = pkg.summary.insightsByKind.risk.length
      + pkg.summary.insightsByKind.opportunity.length
      + pkg.summary.insightsByKind.observation.length;
    expect(sum).toBe(pkg.summary.insights.length);
  });

  test('recommendations are deduped and only populated from insights with recommendation', async () => {
    const out = await new FinancialOrchestrator().compute(input());
    const pkg = buildInvestorPackage(out, out.intelligence!, 'deal-exp-1');
    const set = new Set(pkg.summary.recommendations);
    expect(set.size).toBe(pkg.summary.recommendations.length);
    for (const r of pkg.summary.recommendations) {
      expect(pkg.summary.insights.some((i) => i.recommendation === r)).toBe(true);
    }
  });

  test('KPI surface includes DSCR percentiles + scalar coverage ratios', async () => {
    const out = await new FinancialOrchestrator().compute(input());
    const pkg = buildInvestorPackage(out, out.intelligence!, 'deal-exp-1');
    const k = pkg.summary.kpi;
    expect(k.p5DSCR).not.toBeNull();
    expect(k.p50DSCR).not.toBeNull();
    expect(k.p75DSCR).not.toBeNull();
    expect(k.maxDSCR).not.toBeNull();
    expect(typeof k.peakDebtCr).toBe('number');
    expect(typeof k.residualTotalCr).toBe('number');
  });

  test('headline starts with IRR and contains Min DSCR when available', async () => {
    const out = await new FinancialOrchestrator().compute(input());
    const pkg = buildInvestorPackage(out, out.intelligence!, 'deal-exp-1');
    expect(pkg.summary.headline).toMatch(/^IRR/);
    if (pkg.summary.kpi.minDSCR != null) {
      expect(pkg.summary.headline).toMatch(/Min DSCR/);
    }
  });

  test('monthly array equals totalMonths', async () => {
    const out = await new FinancialOrchestrator().compute(input());
    const pkg = buildInvestorPackage(out, out.intelligence!, 'deal-exp-1');
    expect(pkg.monthly.length).toBe(48);
    expect(pkg.monthly[0].month).toBe(0);
    expect(pkg.monthly[47].month).toBe(47);
  });
});
