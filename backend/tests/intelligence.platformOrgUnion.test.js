'use strict';

/**
 * Pins the platform-org union semantics for every Intelligence-page
 * reader. After PR-NX (this PR), every workspace — including brand-new
 * ones — sees the platform admin's curated benchmark / transaction /
 * macro rows alongside any rows captured by the workspace itself.
 *
 * Concretely: every read of one of these tables MUST be filtered by
 * `(organization_id = current_organization_id() OR organization_id = $platformOrgId)`
 * when platformOrgId is non-null. When the lookup returns null (e.g.
 * platform admin not yet onboarded) the union collapses to the plain
 * `organization_id = current_organization_id()` branch.
 *
 * The test wires platformOrg.getPlatformOrgId() to a stable UUID so the
 * SQL fragment is fully deterministic, then asserts the WHERE clause on
 * every benchmark function.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const PLATFORM_ORG_ID = '11111111-2222-3333-4444-555555555555';
jest.mock('../src/utils/platformOrg', () => ({
  getPlatformOrgId: jest.fn(() => Promise.resolve(PLATFORM_ORG_ID)),
}));

const { query } = require('../src/config/database');
const svc = require('../src/services/intelligence.service');

beforeEach(() => {
  jest.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
});

const lastCall = () => query.mock.calls[query.mock.calls.length - 1];

const expectsPlatformUnion = ([sql, params]) => {
  // The WHERE clause includes both the current-org check and the
  // platform-org id as a positional param.
  expect(sql).toMatch(/organization_id\s*=\s*current_organization_id\(\)/);
  expect(sql).toMatch(/OR organization_id = \$/);
  expect(params).toContain(PLATFORM_ORG_ID);
};

describe('Intelligence reads union the platform admin\'s curated data', () => {
  test('getMicroMarketBenchmarks → micro_market_benchmarks', async () => {
    await svc.getMicroMarketBenchmarks({ city: 'Bengaluru' });
    expectsPlatformUnion(lastCall());
    expect(lastCall()[0]).toMatch(/FROM micro_market_benchmarks/);
  });

  test('getOfficeBenchmarks → office_market_benchmarks', async () => {
    await svc.getOfficeBenchmarks({ city: 'Bengaluru' });
    expectsPlatformUnion(lastCall());
    expect(lastCall()[0]).toMatch(/FROM office_market_benchmarks/);
  });

  test('getRetailBenchmarks → retail_market_benchmarks', async () => {
    await svc.getRetailBenchmarks({ city: 'Bengaluru' });
    expectsPlatformUnion(lastCall());
    expect(lastCall()[0]).toMatch(/FROM retail_market_benchmarks/);
  });

  test('getIndustrialBenchmarks → industrial_market_benchmarks', async () => {
    await svc.getIndustrialBenchmarks({ city: 'Bengaluru' });
    expectsPlatformUnion(lastCall());
    expect(lastCall()[0]).toMatch(/FROM industrial_market_benchmarks/);
  });

  test('getHospitalityBenchmarks → hospitality_market_benchmarks', async () => {
    await svc.getHospitalityBenchmarks({ city: 'Bengaluru' });
    expectsPlatformUnion(lastCall());
    expect(lastCall()[0]).toMatch(/FROM hospitality_market_benchmarks/);
  });

  test('getResidentialSegmentedBenchmarks → residential_segmented_benchmarks', async () => {
    await svc.getResidentialSegmentedBenchmarks({ city: 'Bengaluru' });
    expectsPlatformUnion(lastCall());
    expect(lastCall()[0]).toMatch(/FROM residential_segmented_benchmarks/);
  });

  test('getNicheAssetClassBenchmarks → niche_asset_class_benchmarks', async () => {
    await svc.getNicheAssetClassBenchmarks({ city: 'Bengaluru' });
    expectsPlatformUnion(lastCall());
    expect(lastCall()[0]).toMatch(/FROM niche_asset_class_benchmarks/);
  });

  test('getMacroKpis → market_macro_kpis', async () => {
    await svc.getMacroKpis({ city: 'Bengaluru' });
    expectsPlatformUnion(lastCall());
    expect(lastCall()[0]).toMatch(/FROM market_macro_kpis/);
  });

  test('getMarketTransactions → market_transactions', async () => {
    await svc.getMarketTransactions({ city: 'Bengaluru' });
    expectsPlatformUnion(lastCall());
    expect(lastCall()[0]).toMatch(/FROM market_transactions/);
  });
});

describe('When the platform admin is not configured, queries fall back cleanly', () => {
  // Re-mock the helper to return null, simulating a workspace that hasn't
  // onboarded the platform admin yet.
  beforeEach(() => {
    const platformOrg = require('../src/utils/platformOrg');
    platformOrg.getPlatformOrgId.mockResolvedValueOnce(null);
  });

  test('getOfficeBenchmarks SQL omits the OR clause when no platform org', async () => {
    await svc.getOfficeBenchmarks({ city: 'Bengaluru' });
    const [sql, params] = lastCall();
    expect(sql).toMatch(/organization_id\s*=\s*current_organization_id\(\)/);
    expect(sql).not.toMatch(/OR organization_id =/);
    expect(params).not.toContain(PLATFORM_ORG_ID);
  });
});

describe('Retired note types', () => {
  test('saveMarketNotes rejects "slowdown" and "strategic" sections', async () => {
    await expect(svc.saveMarketNotes('slowdown', ['anything'])).rejects.toThrow(/Invalid section/);
    await expect(svc.saveMarketNotes('strategic', ['anything'])).rejects.toThrow(/Invalid section/);
  });

  test('saveMarketNotes still accepts "micro_market"', async () => {
    await expect(svc.saveMarketNotes('micro_market', ['ok'])).resolves.toEqual(['ok']);
  });

  test('getMarketNotes ignores legacy slowdown/strategic rows', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { section: 'micro_market', items: ['live'] },
        { section: 'slowdown', items: ['stale rows that should be ignored'] },
        { section: 'strategic', items: ['stale rows that should be ignored'] },
      ],
    });
    const notes = await svc.getMarketNotes();
    expect(notes.micro_market).toEqual(['live']);
    expect(notes.slowdown).toEqual([]);
    expect(notes.strategic).toEqual([]);
  });
});
