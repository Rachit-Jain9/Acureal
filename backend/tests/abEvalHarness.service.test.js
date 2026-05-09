'use strict';

// Tier-2 #14 — orchestrator tests with mocked candidate runners. We
// deliberately don't call any real LLM here — the harness just routes
// fixtures through whatever runner you give it. The runner mock lets
// us simulate "Claude returns this", "GPT returns that", and assert
// the aggregated metrics.

// Mock the lazy-loaded service prompts so the harness can resolve a
// default systemPrompt without dragging in the real services.
jest.mock('../src/services/parcelNarrative.service', () => ({
  SYSTEM_PROMPT: 'TEST_PARCEL_PROMPT',
  buildPayload: (x) => x,
}));
jest.mock('../src/services/export.insights.service', () => ({
  SYSTEM_PROMPT: 'TEST_EXPORT_PROMPT',
  buildPayload: (x) => x,
}));

const { runEval, summarize } = require('../src/services/ai/abEvalHarness.service');

const fixtures = [
  { id: 'fx-01', parcel_payload: { area: 13068, far: 2.5 } },
  { id: 'fx-02', parcel_payload: { area: 21780, far: 3.0 } },
  { id: 'fx-03', parcel_payload: { area: 4356,  far: 1.75 } },
];

const cleanText = (p) =>
  `The parcel of ${p.area} sqft has a permissible FAR of ${p.far}. Verification of road width and survey alignment is the next step before underwriting.`;

const dirtyText = () =>
  'This is a groundbreaking opportunity to leverage 99999 sqft of best-in-class land at INR 50000/sqft.';

describe('runEval', () => {
  test('runs every candidate against every fixture and aggregates scores', async () => {
    const claudeRunner = jest.fn(({ payload }) => Promise.resolve(cleanText(payload)));
    const gptRunner = jest.fn(({ payload }) => Promise.resolve(dirtyText()));

    const result = await runEval({
      task: 'parcel_narrative',
      fixtures,
      candidates: [
        { id: 'claude:test', runner: claudeRunner },
        { id: 'openai:test', runner: gptRunner },
      ],
    });

    // Each candidate hit by 3 fixtures.
    expect(claudeRunner).toHaveBeenCalledTimes(3);
    expect(gptRunner).toHaveBeenCalledTimes(3);

    // Both candidates have summaries.
    expect(result.results['claude:test']).toBeDefined();
    expect(result.results['openai:test']).toBeDefined();

    // Claude's clean text outperforms GPT's hallucinated/marketing-toned text.
    expect(result.results['claude:test'].summary.avg_overall)
      .toBeGreaterThan(result.results['openai:test'].summary.avg_overall);

    // Head-to-head delta is positive for claude − openai.
    const delta = result.deltas.find((d) => d.a === 'claude:test' && d.b === 'openai:test');
    expect(delta.avg_overall_diff).toBeGreaterThan(0);
  });

  test('forwards the resolved system prompt from the task default', async () => {
    const runner = jest.fn(({ systemPrompt }) => Promise.resolve('clean text'));
    await runEval({
      task: 'parcel_narrative',
      fixtures: [fixtures[0]],
      candidates: [
        { id: 'a', runner },
        { id: 'b', runner: jest.fn(() => Promise.resolve('clean text')) },
      ],
    });
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: 'TEST_PARCEL_PROMPT',
    }));
  });

  test('caller-provided systemPrompt overrides the task default', async () => {
    const runner = jest.fn(() => Promise.resolve('clean text'));
    await runEval({
      task: 'parcel_narrative',
      systemPrompt: 'CUSTOM_PROMPT',
      fixtures: [fixtures[0]],
      candidates: [
        { id: 'a', runner },
        { id: 'b', runner: jest.fn(() => Promise.resolve('clean text')) },
      ],
    });
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: 'CUSTOM_PROMPT',
    }));
  });

  test('captures runner errors per-fixture without aborting the run', async () => {
    let callIdx = 0;
    const runner = jest.fn(() => {
      callIdx += 1;
      if (callIdx === 2) return Promise.reject(new Error('timeout'));
      return Promise.resolve('text ' + callIdx);
    });

    const result = await runEval({
      task: 'parcel_narrative',
      fixtures,
      candidates: [
        { id: 'a', runner },
        { id: 'b', runner: jest.fn(() => Promise.resolve('clean text')) },
      ],
    });

    const aRows = result.results.a.per_fixture;
    expect(aRows).toHaveLength(3);
    const errored = aRows.find((r) => r.error);
    expect(errored).toBeDefined();
    expect(errored.error).toMatch(/timeout/i);
    expect(result.results.a.summary.failed).toBe(1);
  });

  test('uses parseText extractor for export_insights JSON envelope', async () => {
    const jsonRunner = jest.fn(() => Promise.resolve(JSON.stringify({
      ic_opinion: 'Pursue with conditions. The plot has 3.0 FAR and 21,780 sqft of buildable area. Land cost is well-supported by comparable transactions.',
      top_risks: [],
      next_steps: [],
      confidence: 'medium',
    })));

    const result = await runEval({
      task: 'export_insights',
      fixtures: [{ id: 'fx-A', deal_payload: { area: 21780, far: 3.0 } }],
      candidates: [
        { id: 'a', runner: jsonRunner },
        { id: 'b', runner: jsonRunner },
      ],
    });

    const row = result.results.a.per_fixture[0];
    // Scored text should be the unwrapped ic_opinion, not the raw JSON.
    expect(row.text).toContain('Pursue');
    expect(row.text).not.toContain('{');
  });

  test('throws when a required argument is missing', async () => {
    await expect(runEval({})).rejects.toThrow();
    await expect(runEval({ task: 'parcel_narrative', fixtures: [] })).rejects.toThrow();
    await expect(runEval({
      task: 'parcel_narrative',
      fixtures: [fixtures[0]],
      candidates: [{ id: 'a', runner: jest.fn() }],
    })).rejects.toThrow(/at least 2/i);
  });

  test('throws on unknown task', async () => {
    await expect(runEval({
      task: 'unknown_task',
      fixtures: [fixtures[0]],
      candidates: [
        { id: 'a', runner: jest.fn() },
        { id: 'b', runner: jest.fn() },
      ],
    })).rejects.toThrow(/Unknown task/);
  });

  test('produces pairwise deltas for >2 candidates', async () => {
    const runner = (output) => jest.fn(() => Promise.resolve(output));
    const result = await runEval({
      task: 'parcel_narrative',
      fixtures: [fixtures[0]],
      candidates: [
        { id: 'a', runner: runner('Excellent verified narrative with FAR 2.5 and 13068 sqft area discussed at length.') },
        { id: 'b', runner: runner('Mid quality groundbreaking opportunity with FAR 2.5 and 13068 sqft.') },
        { id: 'c', runner: runner('Bad output with INR 99999/sqft fabricated guidance value and groundbreaking leverage.') },
      ],
    });
    // 3 choose 2 = 3 pairs
    expect(result.deltas).toHaveLength(3);
    expect(result.deltas.map((d) => `${d.a}-${d.b}`).sort()).toEqual(['a-b', 'a-c', 'b-c']);
  });
});

describe('summarize', () => {
  test('handles empty input', () => {
    const s = summarize([]);
    expect(s.fixtures).toBe(0);
    expect(s.avg_overall).toBe(0);
  });

  test('aggregates scores correctly', () => {
    const rows = [
      { fixture_id: 'a', score: { overall: 80, hallucination: { score: 90, fabricated_numbers: [], fabricated_strings: [] }, tone: { score: 70, violations: [] } } },
      { fixture_id: 'b', score: { overall: 60, hallucination: { score: 60, fabricated_numbers: [{}], fabricated_strings: [] }, tone: { score: 50, violations: [{}] } } },
      { fixture_id: 'c', score: { overall: 100, hallucination: { score: 100, fabricated_numbers: [], fabricated_strings: [] }, tone: { score: 100, violations: [] } } },
    ];
    const s = summarize(rows);
    expect(s.fixtures).toBe(3);
    expect(s.successful).toBe(3);
    expect(s.avg_overall).toBe(80);
    expect(s.best_overall.fixture_id).toBe('c');
    expect(s.worst_overall.fixture_id).toBe('b');
    expect(s.total_fabricated_numbers).toBe(1);
    expect(s.total_tone_violations).toBe(1);
  });

  test('separates failed from successful', () => {
    const rows = [
      { fixture_id: 'a', error: 'timeout' },
      { fixture_id: 'b', score: { overall: 90, hallucination: { score: 90, fabricated_numbers: [], fabricated_strings: [] }, tone: { score: 90, violations: [] } } },
    ];
    const s = summarize(rows);
    expect(s.successful).toBe(1);
    expect(s.failed).toBe(1);
  });
});
