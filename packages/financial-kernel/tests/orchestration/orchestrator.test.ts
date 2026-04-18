import { Decimal } from '../../src/decimal';
import { FinancialOrchestrator } from '../../src/orchestration/orchestrator';
import type { OrchestrationInput } from '../../src/orchestration/types';
import type { FacilitySpec } from '../../src/debt-engine';
import { plottedSample } from '../fixtures';

const cr = (n: number) => Decimal.fromNumber(n);

function makeInput(overrides: Partial<OrchestrationInput> = {}): OrchestrationInput {
  const horizon = 36;
  const facility: FacilitySpec = {
    id: 'term',
    kind: 'amortizing_emi',
    currency: 'INR',
    commitment: cr(60),
    startMonth: 0,
    maturityMonth: 36,
    rate: { kind: 'fixed', annualPct: 10 },
    compounding: 'monthly',
    drawRule: { kind: 'bullet_at_origination' },
    amortizationTermMonths: 36,
  };
  return {
    dealId: 'deal-test-1',
    dealInputs: plottedSample,
    totalMonths: horizon,
    facilities: [facility],
    cfadsInputs: {
      revenue: Array.from({ length: horizon }, () => cr(4)),
      opex: Array.from({ length: horizon }, () => cr(1)),
      taxes: Array.from({ length: horizon }, () => cr(0.3)),
      maintenanceCapex: Array.from({ length: horizon }, () => cr(0.1)),
    },
    covenantInputs: {
      projectCostCr: cr(150),
    },
    ...overrides,
  };
}

describe('FinancialOrchestrator — engine selection', () => {
  const prior = { ...process.env };
  afterEach(() => {
    process.env = { ...prior };
  });

  test('returns v1-legacy shape when DEBT_ENGINE_V2 off', async () => {
    process.env = { ...prior, DEBT_ENGINE_V2: '0', DEBT_ENGINE_V2_SILENT: '1' };
    const orch = new FinancialOrchestrator();
    const out = await orch.compute(makeInput());
    expect(out.engineVersion).toBe('v1-legacy');
    expect(out.rolloutDecision.usedV2).toBe(false);
    // Debt overlays are zero-series.
    expect(out.kpis.cumulativeDebtServiceCr).toBe(0);
    expect(out.kpis.peakDebtCr).toBe(0);
  });

  test('runs v2-ts pipeline at 100% rollout', async () => {
    process.env = {
      ...prior,
      DEBT_ENGINE_V2: 'true',
      DEBT_ENGINE_V2_ROLLOUT_PCT: '100',
      DEBT_ENGINE_V2_SILENT: '1',
    };
    const orch = new FinancialOrchestrator();
    const out = await orch.compute(makeInput());
    expect(out.engineVersion).toBe('v2-ts');
    expect(out.rolloutDecision.usedV2).toBe(true);
    expect(out.kpis.cumulativeDebtServiceCr).toBeGreaterThan(0);
    // With a 60 Cr 10% 36-month amort, total debt service ~ 69.7 Cr.
    expect(out.kpis.cumulativeDebtServiceCr).toBeCloseTo(69.7, 0);
  });

  test('respects forceEngine=v2-ts even with flag off', async () => {
    process.env = { ...prior, DEBT_ENGINE_V2: '0', DEBT_ENGINE_V2_SILENT: '1' };
    const orch = new FinancialOrchestrator();
    const out = await orch.compute({ ...makeInput(), forceEngine: 'v2-ts' });
    expect(out.engineVersion).toBe('v2-ts');
  });

  test('forceEngine=v1-legacy overrides enabled flag', async () => {
    process.env = {
      ...prior,
      DEBT_ENGINE_V2: 'true',
      DEBT_ENGINE_V2_ROLLOUT_PCT: '100',
      DEBT_ENGINE_V2_SILENT: '1',
    };
    const orch = new FinancialOrchestrator();
    const out = await orch.compute({ ...makeInput(), forceEngine: 'v1-legacy' });
    expect(out.engineVersion).toBe('v1-legacy');
  });
});

describe('FinancialOrchestrator — covenants and KPIs', () => {
  beforeEach(() => {
    process.env.DEBT_ENGINE_V2 = 'true';
    process.env.DEBT_ENGINE_V2_ROLLOUT_PCT = '100';
    process.env.DEBT_ENGINE_V2_SILENT = '1';
  });

  test('computes monthly DSCR and mins', async () => {
    const orch = new FinancialOrchestrator();
    const out = await orch.compute(makeInput());
    expect(out.covenants.monthly.length).toBe(36);
    expect(out.kpis.minDSCR).not.toBeNull();
    expect(out.kpis.minDSCR!).toBeGreaterThan(0);
    expect(Number.isFinite(out.kpis.minDSCR!)).toBe(true);
  });

  test('rejects totalMonths <= 0', async () => {
    const orch = new FinancialOrchestrator();
    await expect(
      orch.compute({ ...makeInput(), totalMonths: 0 }),
    ).rejects.toThrow(/totalMonths/);
  });

  test('empty facilities produces zero debt service', async () => {
    const orch = new FinancialOrchestrator();
    const out = await orch.compute({
      ...makeInput(),
      facilities: [],
    });
    expect(out.kpis.cumulativeDebtServiceCr).toBe(0);
    expect(out.kpis.peakDebtCr).toBe(0);
    expect(out.aggregate.totalMonths).toBe(36);
  });
});
