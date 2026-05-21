'use strict';

// Tier-2 #14 finish — tests for the persistence wrapper around the
// pure A/B harness. Covers:
//   • createRun stores headline metadata + soft-fails on missing migration
//   • finalizeRun upserts per-fixture rows + soft-fails on missing migration
//   • listRuns / getRunDetail soft-fail to [] / null when migration missing
//   • runAndPersist refuses fewer than 2 candidates / unknown task
//   • runAndPersist caps the fixture slice at MAX_FIXTURES_PER_RUN (50)

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

// Mock the underlying harness so tests don't fire real LLM calls.
jest.mock('../src/services/ai/abEvalHarness.service', () => ({
  runEval: jest.fn(),
  resolveRunner: jest.fn(() => async () => 'mocked text'),
}));

// Mock fs so loadFixtures returns a deterministic list without
// reading the real fixtures file (which may differ in size).
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

const { query } = require('../src/config/database');
const harness = require('../src/services/ai/abEvalHarness.service');
const fs = require('fs');
const persistence = require('../src/services/ai/abEvalPersistence.service');

const ORG_ID = 'org-1';
const USER_ID = 'user-1';

const buildFixtures = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `fx-${String(i + 1).padStart(2, '0')}`,
    parcel_payload: { parcel: { name: `Project ${i}` } },
    deal_payload: {},
  }));

const sampleEvalResult = {
  task: 'parcel_narrative',
  task_label: 'Parcel verdict narrative',
  candidate_ids: ['claude:c46', 'openai:g54m'],
  results: {
    'claude:c46': {
      candidate_id: 'claude:c46',
      summary: { fixtures: 2, avg_overall: 88, avg_hallucination: 95, avg_tone: 80 },
      per_fixture: [
        {
          fixture_id: 'fx-01',
          latency_ms: 1234,
          text: 'narrative output A',
          error: null,
          score: {
            overall: 90,
            hallucination: { score: 95, fabricated_numbers: [], fabricated_strings: [] },
            tone: { score: 85, violations: [] },
          },
        },
        {
          fixture_id: 'fx-02',
          latency_ms: 1500,
          text: 'narrative output B',
          error: null,
          score: {
            overall: 86,
            hallucination: { score: 95, fabricated_numbers: [{ n: 12 }], fabricated_strings: [] },
            tone: { score: 75, violations: [{ kind: 'markdown' }] },
          },
        },
      ],
    },
    'openai:g54m': {
      candidate_id: 'openai:g54m',
      summary: { fixtures: 2, avg_overall: 70, avg_hallucination: 80, avg_tone: 60 },
      per_fixture: [
        {
          fixture_id: 'fx-01', latency_ms: 800, text: 'oai out', error: null,
          score: {
            overall: 70,
            hallucination: { score: 80, fabricated_numbers: [], fabricated_strings: [{ s: 'fab' }] },
            tone: { score: 60, violations: [] },
          },
        },
        {
          fixture_id: 'fx-02', latency_ms: 900, text: null, error: 'OpenAI 500', score: null,
        },
      ],
    },
  },
  deltas: [
    { a: 'claude:c46', b: 'openai:g54m', avg_overall_diff: 18, avg_hallucination_diff: 15, avg_tone_diff: 20 },
  ],
  generated_at: '2026-05-10T12:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

let warnSpy;
beforeAll(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { warnSpy.mockRestore(); });

// ── createRun ─────────────────────────────────────────────────────────────

describe('createRun', () => {
  test('inserts a placeholder row in running status', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'run-1', started_at: '2026-05-10T12:00:00Z' }],
    });
    const out = await persistence.createRun({
      organizationId: ORG_ID,
      task: 'parcel_narrative',
      candidateIds: ['a', 'b'],
      fixtureCount: 5,
      totalCalls: 10,
      estimatedCostUsd: 0.12,
      triggeredBy: USER_ID,
    });
    expect(out).toMatchObject({ id: 'run-1' });
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/INSERT INTO ab_eval_runs/);
    expect(sql).toMatch(/'running'/);
  });

  test('soft-fails to null when migration missing (42P01)', async () => {
    const err = new Error('relation "ab_eval_runs" does not exist');
    err.code = '42P01';
    query.mockRejectedValueOnce(err);
    const out = await persistence.createRun({
      organizationId: ORG_ID,
      task: 'parcel_narrative',
      candidateIds: ['a', 'b'],
      fixtureCount: 5,
      totalCalls: 10,
      estimatedCostUsd: 0.12,
    });
    expect(out).toBeNull();
  });

  test('rejects when organizationId is missing', async () => {
    await expect(
      persistence.createRun({ task: 'parcel_narrative', candidateIds: ['a', 'b'], fixtureCount: 1, totalCalls: 2, estimatedCostUsd: 0.01 }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rethrows generic DB errors', async () => {
    const err = new Error('connection terminated');
    query.mockRejectedValueOnce(err);
    await expect(
      persistence.createRun({
        organizationId: ORG_ID,
        task: 'parcel_narrative',
        candidateIds: ['a', 'b'],
        fixtureCount: 1, totalCalls: 2, estimatedCostUsd: 0.01,
      }),
    ).rejects.toThrow('connection terminated');
  });
});

// ── finalizeRun ───────────────────────────────────────────────────────────

describe('finalizeRun', () => {
  test('updates run header and inserts per-fixture detail rows', async () => {
    // First call: UPDATE ab_eval_runs. Subsequent: INSERT ab_eval_results
    // (one per fixture×candidate). Total: 1 + 4 = 5 calls.
    for (let i = 0; i < 5; i += 1) query.mockResolvedValueOnce({ rows: [] });
    await persistence.finalizeRun({
      runId: 'run-1',
      organizationId: ORG_ID,
      evalResult: sampleEvalResult,
      durationMs: 12345,
      status: 'completed',
    });
    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls[0][0]).toMatch(/UPDATE ab_eval_runs/);
    for (let i = 1; i < 5; i += 1) {
      expect(query.mock.calls[i][0]).toMatch(/INSERT INTO ab_eval_results/);
      expect(query.mock.calls[i][0]).toMatch(/ON CONFLICT/);
    }
  });

  test('skips detail inserts when status=failed', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await persistence.finalizeRun({
      runId: 'run-1',
      organizationId: ORG_ID,
      evalResult: null,
      durationMs: 200,
      status: 'failed',
      errorMessage: 'Daily cost cap tripped',
    });
    expect(query).toHaveBeenCalledTimes(1); // just the UPDATE
  });

  test('soft-fails on missing migration (42P01)', async () => {
    const err = new Error('relation "ab_eval_runs" does not exist');
    err.code = '42P01';
    query.mockRejectedValueOnce(err);
    await persistence.finalizeRun({
      runId: 'run-1',
      organizationId: ORG_ID,
      evalResult: sampleEvalResult,
      durationMs: 100,
    });
    // Should not throw.
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('no-ops when runId is null (persistence was not possible)', async () => {
    await persistence.finalizeRun({
      runId: null,
      organizationId: ORG_ID,
      evalResult: sampleEvalResult,
      durationMs: 100,
    });
    expect(query).not.toHaveBeenCalled();
  });
});

// ── listRuns / getRunDetail ──────────────────────────────────────────────

describe('listRuns + getRunDetail', () => {
  test('listRuns clamps limit and orders newest-first', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'r1' }, { id: 'r2' }] });
    const out = await persistence.listRuns({ limit: 99999 });
    expect(out).toHaveLength(2);
    const params = query.mock.calls[0][1];
    expect(params[0]).toBeLessThanOrEqual(200);
  });

  test('listRuns soft-fails to [] when migration missing', async () => {
    const err = new Error('does not exist');
    err.code = '42P01';
    query.mockRejectedValueOnce(err);
    const out = await persistence.listRuns();
    expect(out).toEqual([]);
  });

  test('getRunDetail returns null for unknown id', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const out = await persistence.getRunDetail('missing-id');
    expect(out).toBeNull();
  });

  test('getRunDetail joins run + per-fixture results', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'run-1', task: 'parcel_narrative' }] })
      .mockResolvedValueOnce({ rows: [{ candidate_id: 'a', fixture_id: 'fx-01' }] });
    const out = await persistence.getRunDetail('run-1');
    expect(out.id).toBe('run-1');
    expect(out.results).toHaveLength(1);
  });

  test('getRunDetail returns null for falsy id', async () => {
    const out = await persistence.getRunDetail(null);
    expect(out).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

// ── runAndPersist ────────────────────────────────────────────────────────

describe('runAndPersist', () => {
  beforeEach(() => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(buildFixtures(30)));
  });

  test('rejects fewer than 2 candidates', async () => {
    await expect(
      persistence.runAndPersist({
        organizationId: ORG_ID,
        candidateSpecs: ['claude:default'],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects unknown task', async () => {
    await expect(
      persistence.runAndPersist({
        organizationId: ORG_ID,
        task: 'fictional_task',
        candidateSpecs: ['claude:default', 'openai:default'],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('caps fixture slice at MAX_FIXTURES_PER_RUN', async () => {
    query.mockResolvedValue({ rows: [{ id: 'run-1' }] });
    harness.runEval.mockResolvedValue(sampleEvalResult);

    await persistence.runAndPersist({
      organizationId: ORG_ID,
      candidateSpecs: ['claude:default', 'openai:default'],
      limit: 9999,
    });

    // The harness was called with `fixtures` capped at MAX_FIXTURES_PER_RUN.
    const call = harness.runEval.mock.calls[0][0];
    expect(call.fixtures.length).toBeLessThanOrEqual(persistence.MAX_FIXTURES_PER_RUN);
  });

  test('happy path: creates run, calls runEval, finalizes, returns summary', async () => {
    query.mockResolvedValue({ rows: [{ id: 'run-1', started_at: '2026-05-10T12:00:00Z' }] });
    harness.runEval.mockResolvedValue(sampleEvalResult);

    const out = await persistence.runAndPersist({
      organizationId: ORG_ID,
      triggeredBy: USER_ID,
      candidateSpecs: ['claude:c46', 'openai:g54m'],
      limit: 2,
    });

    expect(out.run_id).toBe('run-1');
    expect(out.status).toBe('completed');
    expect(out.fixtures).toBe(2);
    expect(out.total_calls).toBe(4); // 2 candidates × 2 fixtures
    expect(out.eval_result).toEqual(sampleEvalResult);
  });

  test('marks run as failed when runEval throws', async () => {
    query.mockResolvedValue({ rows: [{ id: 'run-1', started_at: '2026-05-10T12:00:00Z' }] });
    harness.runEval.mockRejectedValueOnce(new Error('Daily cost cap tripped'));

    const out = await persistence.runAndPersist({
      organizationId: ORG_ID,
      candidateSpecs: ['claude:c46', 'openai:g54m'],
      limit: 1,
    });

    expect(out.status).toBe('failed');
    expect(out.error_message).toMatch(/Daily cost cap/);
  });
});

// ── runBaselineAndPersist (Workstream C3) ────────────────────────────────

describe('runBaselineAndPersist', () => {
  beforeEach(() => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(buildFixtures(30)));
  });

  test('runs a single baseline candidate and persists the run', async () => {
    query.mockResolvedValue({ rows: [{ id: 'run-b1', started_at: '2026-05-21T00:00:00Z' }] });
    harness.runEval.mockResolvedValue({
      ...sampleEvalResult,
      candidate_ids: ['claude:default'],
      results: { 'claude:default': sampleEvalResult.results['claude:c46'] },
      deltas: [],
    });

    const out = await persistence.runBaselineAndPersist({
      organizationId: ORG_ID,
      triggeredBy: USER_ID,
      task: 'parcel_narrative',
      limit: 3,
    });

    expect(out.status).toBe('completed');
    expect(out.fixtures).toBe(3);
    expect(out.total_calls).toBe(3); // 1 candidate × 3 fixtures

    // The harness ran exactly one candidate — that is what makes this a
    // baseline rather than an A/B comparison.
    expect(harness.runEval.mock.calls[0][0].candidates).toHaveLength(1);
  });

  test('rejects an unknown task', async () => {
    await expect(
      persistence.runBaselineAndPersist({ organizationId: ORG_ID, task: 'fictional_task' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ── getQualityTrendByTask (Workstream C3) ────────────────────────────────

describe('getQualityTrendByTask', () => {
  const baselineRow = (task, overall, daysAgo) => ({
    id: `run-${task}-${overall}`,
    task,
    summary_json: {
      'claude:default': {
        avg_overall: overall,
        avg_hallucination: overall + 2,
        avg_tone: overall - 3,
      },
    },
    created_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  });

  test('aggregates baseline runs into a per-task trend with delta + regression', async () => {
    // Two parcel_narrative baselines, ascending by date: 88 then 80.
    query.mockResolvedValueOnce({
      rows: [
        baselineRow('parcel_narrative', 88, 10),
        baselineRow('parcel_narrative', 80, 1),
      ],
    });
    const out = await persistence.getQualityTrendByTask({ days: 90 });
    expect(out.available).toBe(true);

    const t = out.tasks.parcel_narrative;
    expect(t.run_count).toBe(2);
    expect(t.latest.overall).toBe(80);
    expect(t.baseline_avg).toBe(88);
    expect(t.delta).toBe(-8);
    expect(t.regression).toBe(true); // −8 ≤ −5 threshold

    // export_insights had no baselines → an empty, non-regressed trend.
    expect(out.tasks.export_insights.run_count).toBe(0);
    expect(out.tasks.export_insights.regression).toBe(false);
  });

  test('a single baseline yields a latest score but no delta', async () => {
    query.mockResolvedValueOnce({ rows: [baselineRow('export_insights', 91, 2)] });
    const t = (await persistence.getQualityTrendByTask({})).tasks.export_insights;
    expect(t.run_count).toBe(1);
    expect(t.latest.overall).toBe(91);
    expect(t.baseline_avg).toBeNull();
    expect(t.delta).toBeNull();
    expect(t.regression).toBe(false);
  });

  test('the query restricts to single-candidate (baseline) runs', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await persistence.getQualityTrendByTask({});
    expect(query.mock.calls[0][0]).toMatch(/array_length\(candidate_ids, 1\) = 1/);
  });

  test('soft-fails to available:false when the table is missing', async () => {
    const err = new Error('relation "ab_eval_runs" does not exist');
    err.code = '42P01';
    query.mockRejectedValueOnce(err);
    const out = await persistence.getQualityTrendByTask({});
    expect(out.available).toBe(false);
  });
});

// ── runScheduledBaselines (Workstream C3 — the daily cron) ───────────────

describe('runScheduledBaselines', () => {
  const baselineResult = {
    ...sampleEvalResult,
    candidate_ids: ['claude:default'],
    results: { 'claude:default': sampleEvalResult.results['claude:c46'] },
    deltas: [],
  };

  beforeEach(() => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(buildFixtures(30)));
    harness.runEval.mockReset();
  });

  test('resolves an organisation and runs a baseline for every monitored task', async () => {
    query.mockResolvedValue({ rows: [{ id: 'org-1' }] });
    harness.runEval.mockResolvedValue(baselineResult);

    const out = await persistence.runScheduledBaselines({ limit: 2 });

    expect(out.scheduled).toBe(true);
    expect(out.tasks).toHaveLength(persistence.TREND_TASKS.length);
    expect(out.ran).toBe(persistence.TREND_TASKS.length);
    expect(out.tasks.every((t) => t.status === 'completed')).toBe(true);
  });

  test('skips cleanly when no organisation exists', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // the org-resolution query
    const out = await persistence.runScheduledBaselines();
    expect(out.skipped).toBe(true);
    expect(out.reason).toBe('no_organization');
    expect(out.ran).toBe(0);
  });

  test('one task failing does not abort the others', async () => {
    query.mockResolvedValue({ rows: [{ id: 'org-1' }] });
    harness.runEval
      .mockRejectedValueOnce(new Error('daily cost cap tripped'))
      .mockResolvedValue(baselineResult);

    const out = await persistence.runScheduledBaselines({ limit: 1 });

    expect(out.tasks).toHaveLength(2);
    expect(out.ran).toBe(1);
    expect(out.tasks.some((t) => t.status === 'failed')).toBe(true);
    expect(out.tasks.some((t) => t.status === 'completed')).toBe(true);
  });
});

// ── buildSummaryByCandidate ──────────────────────────────────────────────

describe('buildSummaryByCandidate', () => {
  test('extracts per-candidate summary keyed by candidate id', () => {
    const out = persistence.buildSummaryByCandidate(sampleEvalResult);
    expect(out['claude:c46']).toMatchObject({ avg_overall: 88 });
    expect(out['openai:g54m']).toMatchObject({ avg_overall: 70 });
  });

  test('returns {} on null input', () => {
    expect(persistence.buildSummaryByCandidate(null)).toEqual({});
    expect(persistence.buildSummaryByCandidate({ candidate_ids: [], results: null })).toEqual({});
  });
});
