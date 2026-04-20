/**
 * Tests the pure HTTP handler that wraps computeInvestorPackage.
 *
 * The debt engine is always on. The handler must:
 *   - return 400 on invalid input
 *   - return 200 with a real package on the default (inline) path
 *   - return 200 with a safe-mode package + killSwitch flagState when
 *     DEBT_ENGINE_KILL is engaged
 *   - honor the legacy DEBT_ENGINE_V2_KILL alias
 *
 * The handler's `env` param only affects the echoed `flagState`. The
 * orchestrator itself reads `process.env` at runtime, so the tests set
 * both to keep behaviour consistent.
 */
import { Decimal } from '../../src/decimal';
import { handleInvestorPackage } from '../../src/api/investorPackage';
import { buildPrefCatchPromoteTiers } from '../../src/waterfall-engine';
import type { OrchestrationInput } from '../../src/orchestration/types';
import type { FacilitySpec } from '../../src/debt-engine';
import { commercialSample } from '../fixtures';

const cr = (n: number) => Decimal.fromNumber(n);

function validInput(): OrchestrationInput {
  const horizon = 24;
  const facility: FacilitySpec = {
    id: 'perm',
    kind: 'amortizing_emi',
    currency: 'INR',
    commitment: cr(50),
    startMonth: 0,
    maturityMonth: horizon,
    rate: { kind: 'fixed', annualPct: 9 },
    compounding: 'monthly',
    drawRule: { kind: 'bullet_at_origination' },
    amortizationTermMonths: horizon,
  };
  const tiers = buildPrefCatchPromoteTiers({
    lpId: 'lp', sponsorId: 'sp',
    lpCapitalCr: cr(30), sponsorCapitalCr: cr(10),
    prefRatePct: cr(8), catchUpPct: cr(100), promotePct: cr(20),
    horizonMonths: horizon,
  });
  const eq = Array.from({ length: horizon }, (_, i) => (i === 0 ? cr(-40) : cr(i < 3 ? 0 : 2.5)));
  return {
    dealId: 'api-deal-1',
    dealInputs: commercialSample,
    totalMonths: horizon,
    facilities: [facility],
    cfadsInputs: {
      revenue: Array.from({ length: horizon }, (_, i) => cr(i < 3 ? 0 : 4)),
      opex: Array.from({ length: horizon }, (_, i) => cr(i < 3 ? 0 : 0.8)),
      taxes: Array.from({ length: horizon }, (_, i) => cr(i < 3 ? 0 : 0.4)),
      maintenanceCapex: Array.from({ length: horizon }, (_, i) => cr(i < 3 ? 0 : 0.1)),
    },
    covenantInputs: { projectCostCr: cr(120), propertyValueCr: cr(150) },
    waterfall: { tiers, availableByMonth: [], structure: 'jv' },
    intelligence: {
      enabled: true,
      equityCashFlows: eq,
      annualDiscountRate: cr(0.1),
      targetDSCR: cr(1.25),
      annualRate: cr(0.09),
      sensitivity: false,
    },
  };
}

describe('handleInvestorPackage — pure HTTP handler', () => {
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

  test('returns 400 on invalid input (no dealId)', async () => {
    const res = await handleInvestorPackage({ totalMonths: 12, facilities: [] });
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect('error' in res.body).toBe(true);
  });

  test('returns 400 on non-object input', async () => {
    const res = await handleInvestorPackage(null);
    expect(res.status).toBe(400);
  });

  test('returns 200 with inline package by default (no env configured)', async () => {
    const res = await handleInvestorPackage(validInput());
    expect(res.status).toBe(200);
    const body = res.body as {
      package: { summary: { engineVersion: string; kpi: { cumulativeDebtServiceCr: number } } };
      engineVersion: string;
      flagState: { pythonUrl: string | null; killSwitch: boolean };
    };
    expect(body.package).toBeDefined();
    expect(body.engineVersion).toBe('inline');
    expect(body.package.summary.engineVersion).toBe('inline');
    expect(body.flagState.killSwitch).toBe(false);
    expect(body.flagState.pythonUrl).toBeNull();
    // Real compute ran: cumulative debt service is positive for a 50Cr 9% 24-month facility.
    expect(body.package.summary.kpi.cumulativeDebtServiceCr).toBeGreaterThan(0);
  });

  test('kill-switch returns safe-mode package with zero debt overlays', async () => {
    process.env = {
      ...prior,
      DEBT_ENGINE_KILL: '1',
      DEBT_ENGINE_SILENT: '1',
    };
    delete process.env.DEBT_ENGINE_V2_KILL;
    delete process.env.DEBT_ENGINE_PY_URL;
    const res = await handleInvestorPackage(validInput(), process.env);
    expect(res.status).toBe(200);
    const body = res.body as {
      package: { summary: { engineVersion: string; kpi: { cumulativeDebtServiceCr: number; peakDebtCr: number } } };
      engineVersion: string;
      flagState: { killSwitch: boolean };
    };
    expect(body.package).toBeDefined();
    expect(body.engineVersion).toBe('safe-mode');
    expect(body.package.summary.engineVersion).toBe('safe-mode');
    expect(body.flagState.killSwitch).toBe(true);
    expect(body.package.summary.kpi.cumulativeDebtServiceCr).toBe(0);
    expect(body.package.summary.kpi.peakDebtCr).toBe(0);
  });

  test('legacy DEBT_ENGINE_V2_KILL alias still engages safe-mode', async () => {
    process.env = {
      ...prior,
      DEBT_ENGINE_V2_KILL: '1',
      DEBT_ENGINE_SILENT: '1',
    };
    delete process.env.DEBT_ENGINE_KILL;
    delete process.env.DEBT_ENGINE_PY_URL;
    const res = await handleInvestorPackage(validInput(), process.env);
    expect(res.status).toBe(200);
    const body = res.body as {
      engineVersion: string;
      flagState: { killSwitch: boolean };
    };
    expect(body.engineVersion).toBe('safe-mode');
    expect(body.flagState.killSwitch).toBe(true);
  });

  test('flagState echoes pythonUrl when configured', async () => {
    process.env = {
      ...prior,
      DEBT_ENGINE_PY_URL: 'http://kernel.local',
      DEBT_ENGINE_SILENT: '1',
    };
    delete process.env.DEBT_ENGINE_KILL;
    delete process.env.DEBT_ENGINE_V2_KILL;
    const res = await handleInvestorPackage(validInput(), process.env);
    expect(res.status).toBe(200);
    const body = res.body as { flagState: { pythonUrl: string | null } };
    expect(body.flagState.pythonUrl).toBe('http://kernel.local');
  });
});
