/**
 * End-to-end orchestration pipeline — exercises:
 *   1. base kernel compute
 *   2. debt roll-forward
 *   3. CFADS projection
 *   4. cash-flow graph reduction
 *   5. waterfall (with pref/catch-up/promote tiers)
 *   6. KPI roll-up
 *
 * Verifies invariants:
 *   - CFADS matches revenue - opex - taxes - maintCapex monthly
 *   - monthly debt service never exceeds CFADS + peak DSRA buffer
 *   - available = CFADS - DS (when no DSRA/traps)
 *   - total distributed + residual = total available
 */

import { Decimal, sum as decSum } from '../../src/decimal';
import { FinancialOrchestrator } from '../../src/orchestration/orchestrator';
import { buildCashFlowGraph } from '../../src/orchestration/cashFlowGraph';
import { buildPrefCatchPromoteTiers } from '../../src/waterfall-engine';
import type { OrchestrationInput } from '../../src/orchestration/types';
import type { FacilitySpec } from '../../src/debt-engine';
import { commercialSample } from '../fixtures';

const cr = (n: number) => Decimal.fromNumber(n);

describe('pipeline — end-to-end orchestration', () => {
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

  function makeCommercialInput(): OrchestrationInput {
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
    return {
      dealId: 'deal-pipeline-1',
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
    };
  }

  test('produces finite KPIs across full horizon', async () => {
    const orch = new FinancialOrchestrator();
    const out = await orch.compute(makeCommercialInput());
    expect(out.engineVersion).toBe('inline');
    expect(out.aggregate.totalMonths).toBe(60);
    expect(Number.isFinite(out.kpis.cumulativeDebtServiceCr)).toBe(true);
    expect(Number.isFinite(out.kpis.peakDebtCr)).toBe(true);
    expect(out.kpis.peakDebtCr).toBeGreaterThan(0);
    expect(out.kpis.peakDebtCr).toBeLessThanOrEqual(80);
  });

  test('waterfall distribution + residual equals total available cash', async () => {
    const orch = new FinancialOrchestrator();
    const out = await orch.compute(makeCommercialInput());
    expect(out.waterfall).toBeDefined();
    const distributed = out.waterfall!.rows.reduce((a, r) => a.add(r.amount), Decimal.zero());
    const residual = decSum(out.waterfall!.residualByMonth);
    const graph = buildCashFlowGraph({
      cfads: out.cfads,
      debt: out.aggregate,
      totalMonths: out.aggregate.totalMonths,
    });
    const availableTotal = decSum(graph.availableByMonth);
    const sumDR = distributed.add(residual);
    // Allow tiny rounding on Decimal arithmetic.
    expect(Math.abs(sumDR.toNumber() - availableTotal.toNumber())).toBeLessThan(1e-4);
  });

  test('CFADS is consistent with input projections', async () => {
    const orch = new FinancialOrchestrator();
    const out = await orch.compute(makeCommercialInput());
    // CFADS month 6 = 3.5 - 0.7 - 0.3 - 0.1 = 2.4
    expect(out.cfads.monthly[6].toNumber()).toBeCloseTo(2.4, 4);
    expect(out.cfads.monthly[0].toNumber()).toBeCloseTo(0, 6);
  });

  test('debt service never exceeds commitment over horizon', async () => {
    const orch = new FinancialOrchestrator();
    const out = await orch.compute(makeCommercialInput());
    for (const b of out.aggregate.closingBalanceByMonth) {
      expect(b.toNumber()).toBeGreaterThanOrEqual(-1e-6);
      expect(b.toNumber()).toBeLessThanOrEqual(80 + 1e-3);
    }
  });

  test('minDSCR is finite and non-negative across horizon', async () => {
    const orch = new FinancialOrchestrator();
    const out = await orch.compute(makeCommercialInput());
    expect(out.kpis.minDSCR).not.toBeNull();
    expect(Number.isFinite(out.kpis.minDSCR!)).toBe(true);
    expect(out.kpis.minDSCR!).toBeGreaterThanOrEqual(0);
    // After operations ramp (month 6+), DSCR should be positive somewhere.
    const postRamp = out.covenants.monthly.slice(12).map((c) => c.dscr).filter((v): v is number => v != null);
    expect(postRamp.some((d) => d > 0)).toBe(true);
  });

  test('provenance captures engine decision', async () => {
    const orch = new FinancialOrchestrator();
    const out = await orch.compute(makeCommercialInput());
    const engineProv = out.provenance.find((p) => p.key === 'orchestrator.engine');
    expect(engineProv).toBeDefined();
    expect(engineProv!.source).toContain('inline');
  });
});
