/**
 * End-to-end: orchestrator with intelligence enabled produces
 * KPIs + insights + narrative + graph + headline package.
 */
import { Decimal } from '../../src/decimal';
import { FinancialOrchestrator } from '../../src/orchestration/orchestrator';
import { buildPrefCatchPromoteTiers } from '../../src/waterfall-engine';
import { buildInvestorPackage } from '../../src/exports/intelligentReport';
import type { OrchestrationInput } from '../../src/orchestration/types';
import type { FacilitySpec } from '../../src/debt-engine';
import { commercialSample } from '../fixtures';

const cr = (n: number) => Decimal.fromNumber(n);

describe('pipeline — intelligence output', () => {
  const prior = { ...process.env };
  beforeEach(() => {
    process.env = {
      ...prior,
      DEBT_ENGINE_SILENT: '1',
    };
    delete process.env.DEBT_ENGINE_KILL;
    delete process.env.DEBT_ENGINE_V2_KILL;
  });
  afterEach(() => {
    process.env = { ...prior };
  });

  function makeInput(): OrchestrationInput {
    const horizon = 60;
    const facility: FacilitySpec = {
      id: 'perm',
      kind: 'amortizing_emi',
      currency: 'INR',
      commitment: cr(80),
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
    // Equity cash flows: -50 at month 0, positive distributions sampled across horizon.
    const equityCF: Decimal[] = Array.from({ length: horizon }, (_, i) =>
      i === 0 ? cr(-50) : cr(i < 6 ? 0 : 1.2),
    );
    return {
      dealId: 'deal-int-1',
      dealInputs: commercialSample,
      totalMonths: horizon,
      facilities: [facility],
      cfadsInputs: {
        revenue: Array.from({ length: horizon }, (_, i) => cr(i < 6 ? 0 : 3.5)),
        opex: Array.from({ length: horizon }, (_, i) => cr(i < 6 ? 0 : 0.7)),
        taxes: Array.from({ length: horizon }, (_, i) => cr(i < 6 ? 0 : 0.3)),
        maintenanceCapex: Array.from({ length: horizon }, (_, i) => cr(i < 6 ? 0 : 0.1)),
      },
      covenantInputs: {
        projectCostCr: cr(130),
        propertyValueCr: cr(160),
      },
      waterfall: {
        tiers,
        availableByMonth: [],
        structure: 'jv',
      },
      intelligence: {
        enabled: true,
        equityCashFlows: equityCF,
        annualDiscountRate: cr(0.1),
        targetDSCR: cr(1.25),
        annualRate: cr(0.09),
        sensitivity: true,
        sensitivityVariables: [
          { name: 'rent_growth', base: cr(3.0), lowPct: -20, highPct: 20 },
          { name: 'cap_rate', base: cr(8.0), lowPct: -10, highPct: 10 },
          { name: 'construction_cost', base: cr(100), lowPct: -5, highPct: 5 },
        ],
      },
    };
  }

  test('emits intelligence with IRR, DSCR profile, insights, narrative, graph', async () => {
    const out = await new FinancialOrchestrator().compute(makeInput());
    expect(out.intelligence).toBeDefined();
    const i = out.intelligence!;
    expect(i.kpis.irrLevered).not.toBeNull();
    expect(i.kpis.dscrProfile.min).not.toBeNull();
    expect(i.kpis.debtCapacity.maxDebtCr.toNumber()).toBeGreaterThan(0);
    expect(i.insights.length).toBeGreaterThan(0);
    expect(i.narrative.length).toBeGreaterThan(10);
    expect(i.graph).not.toBeNull();
    expect(i.graph!.nodes.length).toBeGreaterThan(0);
    expect(i.source).toBe('inline');
  });

  test('sensitivity tornado produces sorted rows when enabled', async () => {
    const out = await new FinancialOrchestrator().compute(makeInput());
    const s = out.intelligence!.sensitivity;
    expect(s).not.toBeNull();
    expect(s!.rows.length).toBeGreaterThan(0);
    for (let i = 1; i < s!.rows.length; i++) {
      expect(s!.rows[i - 1].swing).toBeGreaterThanOrEqual(s!.rows[i].swing);
    }
  });

  test('buildInvestorPackage assembles a flat serialization-ready payload', async () => {
    const out = await new FinancialOrchestrator().compute(makeInput());
    const pkg = buildInvestorPackage(out, out.intelligence!, 'deal-int-1');
    expect(pkg.summary.dealId).toBe('deal-int-1');
    expect(pkg.summary.kpi.irrLeveredPct).not.toBeNull();
    expect(pkg.summary.kpi.minDSCR).not.toBeNull();
    expect(pkg.summary.insights.length).toBeGreaterThan(0);
    expect(pkg.monthly.length).toBe(60);
    expect(pkg.waterfallRows.length).toBeGreaterThan(0);
    // Headline must mention IRR figure
    expect(pkg.summary.headline).toMatch(/IRR/i);
  });

  test('insights are stable across repeated runs of the same input (no RNG)', async () => {
    const a = await new FinancialOrchestrator().compute(makeInput());
    const b = await new FinancialOrchestrator().compute(makeInput());
    expect(a.intelligence!.insights.length).toBe(b.intelligence!.insights.length);
    expect(a.intelligence!.kpis.irrLevered!.toString()).toBe(
      b.intelligence!.kpis.irrLevered!.toString(),
    );
    expect(a.intelligence!.kpis.dscrProfile.min!.toString()).toBe(
      b.intelligence!.kpis.dscrProfile.min!.toString(),
    );
  });

  test('intelligence is absent when opts.enabled is false', async () => {
    const inp = { ...makeInput(), intelligence: { enabled: false } };
    const out = await new FinancialOrchestrator().compute(inp);
    expect(out.intelligence).toBeUndefined();
  });

  test('kill-switch collapses to safe-mode overlay', async () => {
    process.env.DEBT_ENGINE_KILL = '1';
    const out = await new FinancialOrchestrator().compute(makeInput());
    expect(out.engineVersion).toBe('safe-mode');
    expect(out.engineDecision.killed).toBe(true);
    expect(out.kpis.cumulativeDebtServiceCr).toBe(0);
    delete process.env.DEBT_ENGINE_KILL;
  });

  test('legacy DEBT_ENGINE_V2_KILL still engages safe-mode', async () => {
    process.env.DEBT_ENGINE_V2_KILL = '1';
    const out = await new FinancialOrchestrator().compute(makeInput());
    expect(out.engineVersion).toBe('safe-mode');
    expect(out.engineDecision.killed).toBe(true);
    delete process.env.DEBT_ENGINE_V2_KILL;
  });
});
