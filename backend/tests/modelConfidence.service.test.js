'use strict';

/**
 * Tests for modelConfidence.service — Workstream A read-side classifier.
 *
 * `financial.service` is mocked so `getFinancials` returns a controlled
 * fixture; the financial kernel loads for real, so benchmark comparisons run
 * against the live `getDefaultMeta` registry. Benchmark values are read FROM
 * the kernel inside the test, so the suite stays green if a default is
 * retuned upstream.
 */

jest.mock('../src/services/financial.service', () => ({
  getFinancials: jest.fn(),
}));

const financialService = require('../src/services/financial.service');
const { getModelConfidence, _internal } = require('../src/services/modelConfidence.service');
const kernel = require('../../packages/financial-kernel/dist');

// Residential deal-specific facts — every fact key has a value, so all five
// classify as 'deal-set'.
const FACTS = {
  plotAreaSqft: 50000,
  fsi: 2.5,
  landCostCr: 25,
  constructionCostPerSqft: 4500,
  sellingRatePerSqft: 9000,
};

// The five residential assumption keys + their kernel benchmark defaults.
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

const assumptionsTuned = () =>
  Object.fromEntries(ASSUMPTION_KEYS.map((k) => [k, benchValue(k) + (k === 'loadingFactor' ? 0.03 : 3)]));

const financialsRow = (inputs, modelClass = 'residential_apartments') => ({
  asset_class: 'residential_apartments',
  model_params: { financialModelClass: modelClass, inputs },
});

beforeEach(() => {
  financialService.getFinancials.mockReset();
});

describe('getModelConfidence — classification', () => {
  it('counts all facts deal-set and benchmark-matched assumptions as default', async () => {
    financialService.getFinancials.mockResolvedValue(
      financialsRow({ ...FACTS, ...assumptionsAtBenchmark() }),
    );

    const result = await getModelConfidence('deal-1');

    expect(result.available).toBe(true);
    expect(result.total).toBe(10);
    expect(result.dealSetCount).toBe(5); // the five facts
    expect(result.defaultCount).toBe(5); // the five untouched assumptions
    expect(result.confidencePct).toBe(50);
    expect(result.band).toBe('mixed');
  });

  it('counts assumptions tuned off the benchmark as deal-set', async () => {
    financialService.getFinancials.mockResolvedValue(
      financialsRow({ ...FACTS, ...assumptionsTuned() }),
    );

    const result = await getModelConfidence('deal-2');

    expect(result.dealSetCount).toBe(10);
    expect(result.defaultCount).toBe(0);
    expect(result.confidencePct).toBe(100);
    expect(result.band).toBe('grounded');
  });

  it('treats missing facts as default and reports an assumption-led band', async () => {
    financialService.getFinancials.mockResolvedValue(
      financialsRow({ ...assumptionsAtBenchmark() }), // no facts at all
    );

    const result = await getModelConfidence('deal-3');

    expect(result.dealSetCount).toBe(0);
    expect(result.confidencePct).toBe(0);
    expect(result.band).toBe('assumption-led');
  });

  it('surfaces the kernel benchmark source on a defaulted assumption', async () => {
    financialService.getFinancials.mockResolvedValue(
      financialsRow({ ...FACTS, ...assumptionsAtBenchmark() }),
    );

    const result = await getModelConfidence('deal-4');
    const discount = result.inputs.find((i) => i.key === 'discountRatePct');

    expect(discount.status).toBe('default');
    expect(discount.kind).toBe('assumption');
    expect(typeof discount.benchmarkSource).toBe('string');
    expect(discount.benchmarkSource.length).toBeGreaterThan(0);
    expect(discount.benchmarkValue).toBe(benchValue('discountRatePct'));
  });

  it('marks a present fact as deal-set with an entered-for-this-deal basis', async () => {
    financialService.getFinancials.mockResolvedValue(
      financialsRow({ ...FACTS, ...assumptionsAtBenchmark() }),
    );

    const result = await getModelConfidence('deal-5');
    const land = result.inputs.find((i) => i.key === 'landCostCr');

    expect(land.kind).toBe('fact');
    expect(land.status).toBe('deal-set');
    expect(land.value).toBe(25);
  });
});

describe('getModelConfidence — soft-fail paths', () => {
  it('returns unavailable when the deal has no financial model', async () => {
    const notFound = new Error('Financials not found for this deal.');
    notFound.statusCode = 404;
    financialService.getFinancials.mockRejectedValue(notFound);

    const result = await getModelConfidence('deal-no-model');

    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/no financial model/i);
  });

  it('returns unavailable for a model class that is not catalogued', async () => {
    financialService.getFinancials.mockResolvedValue(
      financialsRow({ ...FACTS }, 'land_parcel'),
    );

    const result = await getModelConfidence('deal-land');

    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/land_parcel/);
  });

  it('rethrows a non-404 error from the financials lookup', async () => {
    financialService.getFinancials.mockRejectedValue(new Error('database is down'));

    await expect(getModelConfidence('deal-boom')).rejects.toThrow('database is down');
  });
});

describe('_internal helpers', () => {
  it('bandFor maps percentages to honest bands', () => {
    expect(_internal.bandFor(85)).toBe('grounded');
    expect(_internal.bandFor(70)).toBe('grounded');
    expect(_internal.bandFor(55)).toBe('mixed');
    expect(_internal.bandFor(40)).toBe('mixed');
    expect(_internal.bandFor(39)).toBe('assumption-led');
    expect(_internal.bandFor(0)).toBe('assumption-led');
    expect(_internal.bandFor(null)).toBeNull();
  });

  it('numericOrNull coerces blanks to null and keeps real numbers (including 0)', () => {
    expect(_internal.numericOrNull('')).toBeNull();
    expect(_internal.numericOrNull(null)).toBeNull();
    expect(_internal.numericOrNull(undefined)).toBeNull();
    expect(_internal.numericOrNull('not-a-number')).toBeNull();
    expect(_internal.numericOrNull('4500')).toBe(4500);
    expect(_internal.numericOrNull(0)).toBe(0);
  });
});
