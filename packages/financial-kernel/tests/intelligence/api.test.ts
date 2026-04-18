/**
 * Tests the pure HTTP handler that wraps computeInvestorPackage.
 * The handler must not throw on bad input, must return a JSON envelope,
 * and must honor the DEBT_ENGINE_V2 flag + kill switch.
 *
 * Flag manipulation goes through process.env because the orchestrator
 * reads it at runtime; the handler's env param only affects the
 * flagState field echoed to the caller.
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

  test('returns 200 with package when v2 enabled at 100%', async () => {
    process.env = {
      ...prior,
      DEBT_ENGINE_V2: 'true',
      DEBT_ENGINE_V2_ROLLOUT_PCT: '100',
      DEBT_ENGINE_V2_SILENT: '1',
    };
    const res = await handleInvestorPackage(validInput());
    expect(res.status).toBe(200);
    const body = res.body as { package: unknown; engineVersion: string; flagState: { v2Enabled: boolean } };
    expect(body.package).not.toBeNull();
    expect(body.engineVersion).toBe('v2-ts');
    expect(body.flagState.v2Enabled).toBe(true);
  });

  test('returns 200 with null package + reason when v2 disabled', async () => {
    process.env = {
      ...prior,
      DEBT_ENGINE_V2: 'false',
      DEBT_ENGINE_V2_SILENT: '1',
    };
    delete process.env.DEBT_ENGINE_V2_KILL;
    const res = await handleInvestorPackage(validInput());
    expect(res.status).toBe(200);
    const body = res.body as { package: unknown; reason: string; flagState: { v2Enabled: boolean } };
    expect(body.package).toBeNull();
    expect(body.reason).toBe('intelligence_disabled_or_v1_cohort');
    expect(body.flagState.v2Enabled).toBe(false);
  });

  test('kill switch forces v1 and nulls the package', async () => {
    process.env = {
      ...prior,
      DEBT_ENGINE_V2: 'true',
      DEBT_ENGINE_V2_ROLLOUT_PCT: '100',
      DEBT_ENGINE_V2_KILL: '1',
      DEBT_ENGINE_V2_SILENT: '1',
    };
    const res = await handleInvestorPackage(validInput());
    expect(res.status).toBe(200);
    const body = res.body as { package: unknown; flagState: { killSwitch: boolean } };
    expect(body.package).toBeNull();
    expect(body.flagState.killSwitch).toBe(true);
  });
});
