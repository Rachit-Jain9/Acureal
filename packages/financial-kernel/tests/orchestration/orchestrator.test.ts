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

  test('runs inline pipeline by default (no env configured)', async () => {
    process.env = { ...prior, DEBT_ENGINE_SILENT: '1' };
    delete process.env.DEBT_ENGINE_KILL;
    delete process.env.DEBT_ENGINE_V2_KILL;
    const orch = new FinancialOrchestrator();
    const out = await orch.compute(makeInput());
    expect(out.engineVersion).toBe('inline');
    expect(out.engineDecision.killed).toBe(false);
    expect(out.engineDecision.reason).toBe('inline_default');
    expect(out.kpis.cumulativeDebtServiceCr).toBeGreaterThan(0);
    // 60 Cr 10% 36-month EMI → total debt service ~ 69.7 Cr.
    expect(out.kpis.cumulativeDebtServiceCr).toBeCloseTo(69.7, 0);
  });

  test('kill-switch returns safe-mode shape with zero overlays', async () => {
    process.env = { ...prior, DEBT_ENGINE_KILL: '1', DEBT_ENGINE_SILENT: '1' };
    const orch = new FinancialOrchestrator();
    const out = await orch.compute(makeInput());
    expect(out.engineVersion).toBe('safe-mode');
    expect(out.engineDecision.killed).toBe(true);
    expect(out.engineDecision.reason).toBe('kill_switch_on');
    expect(out.kpis.cumulativeDebtServiceCr).toBe(0);
    expect(out.kpis.peakDebtCr).toBe(0);
  });

  test('legacy DEBT_ENGINE_V2_KILL still engages safe-mode', async () => {
    process.env = { ...prior, DEBT_ENGINE_V2_KILL: '1', DEBT_ENGINE_SILENT: '1' };
    delete process.env.DEBT_ENGINE_KILL;
    const orch = new FinancialOrchestrator();
    const out = await orch.compute(makeInput());
    expect(out.engineVersion).toBe('safe-mode');
    expect(out.engineDecision.killed).toBe(true);
  });

  test('forceEngine=safe-mode overrides default inline', async () => {
    process.env = { ...prior, DEBT_ENGINE_SILENT: '1' };
    delete process.env.DEBT_ENGINE_KILL;
    delete process.env.DEBT_ENGINE_V2_KILL;
    const orch = new FinancialOrchestrator();
    const out = await orch.compute({ ...makeInput(), forceEngine: 'safe-mode' });
    expect(out.engineVersion).toBe('safe-mode');
  });
});

describe('FinancialOrchestrator — covenants and KPIs', () => {
  beforeEach(() => {
    process.env.DEBT_ENGINE_SILENT = '1';
    delete process.env.DEBT_ENGINE_KILL;
    delete process.env.DEBT_ENGINE_V2_KILL;
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

  test('empty facilities produces zero debt service without crashing', async () => {
    const orch = new FinancialOrchestrator();
    const out = await orch.compute({
      ...makeInput(),
      facilities: [],
    });
    expect(out.engineVersion).toBe('inline');
    expect(out.kpis.cumulativeDebtServiceCr).toBe(0);
    expect(out.kpis.peakDebtCr).toBe(0);
    expect(out.aggregate.totalMonths).toBe(36);
  });
});
