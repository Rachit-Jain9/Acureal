/**
 * Tests the workbook row builder — it must produce one Summary row per
 * KPI field, a Monthly row per month, and a sensible tornado sheet even
 * when sensitivity is absent.
 */
import { Decimal } from '../../src/decimal';
import { FinancialOrchestrator } from '../../src/orchestration/orchestrator';
import { buildPrefCatchPromoteTiers } from '../../src/waterfall-engine';
import { buildInvestorPackage } from '../../src/exports/intelligentReport';
import { buildInvestorWorkbook } from '../../src/exports/excelReport';
import type { OrchestrationInput } from '../../src/orchestration/types';
import type { FacilitySpec } from '../../src/debt-engine';
import { commercialSample } from '../fixtures';

const cr = (n: number) => Decimal.fromNumber(n);

function makeInput(withSensitivity: boolean): OrchestrationInput {
  const horizon = 36;
  const facility: FacilitySpec = {
    id: 'perm',
    kind: 'amortizing_emi',
    currency: 'INR',
    commitment: cr(60),
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
  const eq = Array.from({ length: horizon }, (_, i) => (i === 0 ? cr(-40) : cr(i < 4 ? 0 : 1.4)));
  return {
    dealId: 'deal-xl-1',
    dealInputs: commercialSample,
    totalMonths: horizon,
    facilities: [facility],
    cfadsInputs: {
      revenue: Array.from({ length: horizon }, (_, i) => cr(i < 4 ? 0 : 3.2)),
      opex: Array.from({ length: horizon }, (_, i) => cr(i < 4 ? 0 : 0.6)),
      taxes: Array.from({ length: horizon }, (_, i) => cr(i < 4 ? 0 : 0.25)),
      maintenanceCapex: Array.from({ length: horizon }, (_, i) => cr(i < 4 ? 0 : 0.08)),
    },
    covenantInputs: { projectCostCr: cr(120), propertyValueCr: cr(150) },
    waterfall: { tiers, availableByMonth: [], structure: 'jv' },
    intelligence: {
      enabled: true,
      equityCashFlows: eq,
      annualDiscountRate: cr(0.1),
      targetDSCR: cr(1.25),
      annualRate: cr(0.09),
      sensitivity: withSensitivity,
      sensitivityVariables: withSensitivity
        ? [
            { name: 'rent_growth', base: cr(3.0), lowPct: -15, highPct: 15 },
            { name: 'cap_rate', base: cr(8.0), lowPct: -10, highPct: 10 },
          ]
        : undefined,
    },
  };
}

describe('buildInvestorWorkbook', () => {
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

  test('produces all six sheets with expected names', async () => {
    const out = await new FinancialOrchestrator().compute(makeInput(true));
    const pkg = buildInvestorPackage(out, out.intelligence!, 'deal-xl-1');
    const wb = buildInvestorWorkbook(pkg);
    const names = wb.sheets.map((s) => s.name);
    expect(names).toEqual(['Summary', 'Monthly', 'Insights', 'DSCR Profile', 'Waterfall', 'Tornado']);
  });

  test('Monthly sheet has one row per month', async () => {
    const out = await new FinancialOrchestrator().compute(makeInput(false));
    const pkg = buildInvestorPackage(out, out.intelligence!, 'deal-xl-1');
    const wb = buildInvestorWorkbook(pkg);
    const monthly = wb.sheets.find((s) => s.name === 'Monthly')!;
    expect(monthly.rows.length).toBe(36);
    expect(monthly.rows[0].month).toBe(0);
  });

  test('Summary sheet has Deal ID and headline populated', async () => {
    const out = await new FinancialOrchestrator().compute(makeInput(false));
    const pkg = buildInvestorPackage(out, out.intelligence!, 'deal-xl-1');
    const wb = buildInvestorWorkbook(pkg);
    const summary = wb.sheets.find((s) => s.name === 'Summary')!;
    const kv = Object.fromEntries(summary.rows.map((r) => [r.metric, r.value]));
    expect(kv['Deal ID']).toBe('deal-xl-1');
    expect(String(kv['Headline'])).toMatch(/IRR/);
  });

  test('Insights sheet rows come out sorted by severity', async () => {
    const out = await new FinancialOrchestrator().compute(makeInput(false));
    const pkg = buildInvestorPackage(out, out.intelligence!, 'deal-xl-1');
    const wb = buildInvestorWorkbook(pkg);
    const ins = wb.sheets.find((s) => s.name === 'Insights')!;
    const rank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    for (let i = 1; i < ins.rows.length; i++) {
      expect(rank[String(ins.rows[i - 1].severity)])
        .toBeGreaterThanOrEqual(rank[String(ins.rows[i].severity)]);
    }
  });

  test('Tornado sheet is empty when sensitivity is disabled', async () => {
    const out = await new FinancialOrchestrator().compute(makeInput(false));
    const pkg = buildInvestorPackage(out, out.intelligence!, 'deal-xl-1');
    const wb = buildInvestorWorkbook(pkg);
    const tornado = wb.sheets.find((s) => s.name === 'Tornado')!;
    expect(tornado.rows.length).toBe(0);
  });

  test('Tornado sheet populates when sensitivity enabled', async () => {
    const out = await new FinancialOrchestrator().compute(makeInput(true));
    const pkg = buildInvestorPackage(out, out.intelligence!, 'deal-xl-1');
    const wb = buildInvestorWorkbook(pkg);
    const tornado = wb.sheets.find((s) => s.name === 'Tornado')!;
    expect(tornado.rows.length).toBeGreaterThan(0);
    for (const r of tornado.rows) {
      expect(typeof r.variable).toBe('string');
      expect(typeof r.swing).toBe('number');
    }
  });
});
