'use strict';

/**
 * Tests for confidenceRange.service — Workstream A slice 2.
 *
 * `financial.service` is mocked so `getFinancials` returns a controlled
 * fixture; the financial kernel + kernel.service run for real, so the KPI
 * ranges are produced by genuine deterministic kernel re-runs.
 */

jest.mock('../src/services/financial.service', () => ({
  getFinancials: jest.fn(),
}));

const financialService = require('../src/services/financial.service');
const { getConfidenceRange, _internal } = require('../src/services/confidenceRange.service');
const kernel = require('../../packages/financial-kernel/dist');

// Residential deal facts — generous spread so the kernel returns real KPIs.
const FACTS = {
  assetClass: 'residential_apartments',
  plotAreaSqft: 50000,
  fsi: 2.5,
  constructionCostPerSqft: 4500,
  sellingRatePerSqft: 12000,
  landCostCr: 20,
};

// The five residential benchmark assumptions confidenceRange sweeps.
const ASSUMPTION_KEYS = [
  'loadingFactor',
  'contingencyPct',
  'marketingCostPct',
  'developerMarginPct',
  'discountRatePct',
];

const benchValue = (key) => kernel.getDefaultMeta('residential_apartments', key).value;

const assumptionsAtBenchmark = () =>
  Object.fromEntries(ASSUMPTION_KEYS.map((k) => [k, benchValue(k)]));

// Each value sits inside its band but clearly off the cited benchmark, so all
// five count as analyst-set (verified) and contribute no range.
const ASSUMPTIONS_OFF = {
  loadingFactor: 0.2,
  contingencyPct: 7,
  marketingCostPct: 6,
  developerMarginPct: 25,
  discountRatePct: 16,
};

const financialsRow = (inputs, modelClass = 'residential_apartments') => ({
  asset_class: 'residential_apartments',
  model_params: { financialModelClass: modelClass, inputs },
});

beforeEach(() => {
  financialService.getFinancials.mockReset();
});

describe('getConfidenceRange — unverified assumptions widen the range', () => {
  it('produces KPI bands that contain the base and a non-zero swing', async () => {
    financialService.getFinancials.mockResolvedValue(
      financialsRow({ ...FACTS, ...assumptionsAtBenchmark() }),
    );

    const result = await getConfidenceRange('deal-1');

    expect(result.available).toBe(true);
    expect(result.unverifiedCount).toBe(5);
    expect(result.kpis.length).toBeGreaterThan(0);
    for (const k of result.kpis) {
      expect(k.low).toBeLessThanOrEqual(k.base);
      expect(k.high).toBeGreaterThanOrEqual(k.base);
      expect(k.swing).toBeGreaterThanOrEqual(0);
    }
    // At least one headline KPI must actually move across the benchmark bands.
    expect(result.kpis.some((k) => k.swing > 0)).toBe(true);
    expect(['irr', 'npv']).toContain(result.primaryKpi);
  });

  it('ranks drivers by impact and cites each benchmark source', async () => {
    financialService.getFinancials.mockResolvedValue(
      financialsRow({ ...FACTS, ...assumptionsAtBenchmark() }),
    );

    const result = await getConfidenceRange('deal-2');

    expect(result.drivers.length).toBeGreaterThan(0);
    for (let i = 1; i < result.drivers.length; i += 1) {
      expect(result.drivers[i - 1].swing).toBeGreaterThanOrEqual(result.drivers[i].swing);
    }
    for (const d of result.drivers) {
      expect(d.low).toBeLessThanOrEqual(d.high);
      expect(typeof d.benchmarkSource).toBe('string');
      expect(d.benchmarkSource.length).toBeGreaterThan(0);
    }
  });
});

describe('getConfidenceRange — verified inputs collapse the range', () => {
  it('returns a zero-swing range when every assumption is set off-benchmark', async () => {
    financialService.getFinancials.mockResolvedValue(
      financialsRow({ ...FACTS, ...ASSUMPTIONS_OFF }),
    );

    const result = await getConfidenceRange('deal-3');

    expect(result.available).toBe(true);
    expect(result.unverifiedCount).toBe(0);
    expect(result.drivers).toHaveLength(0);
    for (const k of result.kpis) {
      expect(k.swing).toBe(0);
      expect(k.low).toBe(k.base);
      expect(k.high).toBe(k.base);
    }
  });
});

describe('getConfidenceRange — soft-fail paths', () => {
  it('returns unavailable when the deal has no financial model', async () => {
    const notFound = new Error('Financials not found for this deal.');
    notFound.statusCode = 404;
    financialService.getFinancials.mockRejectedValue(notFound);

    const result = await getConfidenceRange('deal-no-model');

    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/no financial model/i);
  });

  it('returns unavailable for a model class that is not catalogued', async () => {
    financialService.getFinancials.mockResolvedValue(
      financialsRow({ ...FACTS }, 'land_parcel'),
    );

    const result = await getConfidenceRange('deal-land');

    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/land_parcel/);
  });

  it('rethrows a non-404 error from the financials lookup', async () => {
    financialService.getFinancials.mockRejectedValue(new Error('database is down'));

    await expect(getConfidenceRange('deal-boom')).rejects.toThrow('database is down');
  });
});

describe('_internal.round', () => {
  it('rounds to the requested precision and rejects non-finite values', () => {
    expect(_internal.round(3.14159, 2)).toBe(3.14);
    expect(_internal.round(18.449, 1)).toBe(18.4);
    expect(_internal.round(null, 2)).toBeNull();
    expect(_internal.round(Infinity, 1)).toBeNull();
    expect(_internal.round(NaN, 1)).toBeNull();
  });
});
