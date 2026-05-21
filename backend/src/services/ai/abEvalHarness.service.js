'use strict';

/**
 * Tier-2 #14 — A/B eval harness.
 *
 * Runs an arbitrary list of (provider, model) candidates against a
 * fixture set of synthetic deal snapshots, scores each output with the
 * deterministic scorer in abEvalScoring.js, and returns a comparison
 * report.
 *
 * Usage (CLI):
 *   node backend/scripts/run-ab-eval.js \
 *       --task=parcel_narrative \
 *       --candidates=claude:claude-sonnet-4-6,openai:gpt-5.4 \
 *       --fixtures=backend/tests/fixtures/ab-eval-deals.json
 *
 * Cost guard: each fixture × candidate is one Claude / GPT call. 30
 * fixtures × 2 candidates × ~600 tokens out ≈ $0.30 per run on Claude
 * Sonnet 4.6 + ~$0.15 on GPT-5.4-mini. The runner prints estimated
 * cost upfront and requires `--confirm` to proceed past 50 calls.
 *
 * Per CLAUDE.md hard rules: scoring is deterministic, never the LLM.
 * The LLMs under test produce text; the JS scorer judges it.
 */

const { scoreOutput } = require('./abEvalScoring');
const { runClaudeReasoning, runOpenAIReasoning } = require('./aiRouter');

// Two task definitions — both use the same scorer but different prompts /
// payload shapes. Each maps a fixture row to (systemPrompt, payload, snap).
//
// `snap` is the value the scorer uses as ground-truth for hallucination
// detection; it should contain every number / code / RERA ref the model is
// allowed to mention. Today this is identical to `payload` for these two
// tasks since the prompts forbid the model from inventing anything beyond
// the supplied facts.

// Lazy require so jest.mock() in tests can intercept these without
// circular-import pain.
const lazyParcelNarrativePrompt = () =>
  require('../parcelNarrative.service').SYSTEM_PROMPT;
const lazyExportInsightsPrompt = () =>
  require('../export.insights.service').SYSTEM_PROMPT;

// Each task has a payload picker that reads the right slice off a
// fixture row. Fixture shape:
//   { id, parcel_payload?, deal_payload? }
// The harness skips fixtures where the task's slice is missing.
const TASKS = {
  parcel_narrative: {
    label: 'Parcel verdict narrative',
    defaultSystemPrompt: lazyParcelNarrativePrompt,
    buildPayload: (fixture) => fixture.parcel_payload || fixture.payload,
    buildSnapshot: (fixture) => fixture.parcel_payload || fixture.payload,
    scoringOpts: {
      minWords: 60,
      maxWords: 200,
      disallowMarkdown: true, // prompt explicitly says "plain prose only"
      tolerancePct: 1,
    },
  },
  export_insights: {
    label: 'Export deck IC opinion',
    defaultSystemPrompt: lazyExportInsightsPrompt,
    buildPayload: (fixture) => fixture.deal_payload || fixture.payload,
    buildSnapshot: (fixture) => fixture.deal_payload || fixture.payload,
    scoringOpts: {
      minWords: 30,
      maxWords: 200,
      disallowMarkdown: true,
      tolerancePct: 1,
    },
  },
};

// Resolve a candidate spec ("claude:claude-sonnet-4-6") into a runner.
// Returns an async function (systemPrompt, payload, maxTokens) → text.
const resolveRunner = (spec) => {
  const [provider, model] = String(spec || '').split(':');
  if (provider === 'claude') {
    return async ({ systemPrompt, payload, maxTokens }) =>
      runClaudeReasoning({
        task: 'reasoning',
        systemPrompt,
        cachePrompt: true,
        payload,
        model,
        maxTokens,
        metadata: { stage: 'ab_eval' },
      });
  }
  if (provider === 'openai') {
    return async ({ systemPrompt, payload, maxTokens }) =>
      runOpenAIReasoning({
        task: 'reasoning',
        systemPrompt,
        payload,
        model,
        maxTokens,
        metadata: { stage: 'ab_eval' },
      });
  }
  throw new Error(`Unknown candidate provider: ${spec}`);
};

// Aggregate per-fixture results into a single per-candidate summary.
const summarize = (perFixture) => {
  if (!perFixture.length) {
    return {
      fixtures: 0,
      avg_overall: 0,
      avg_hallucination: 0,
      avg_tone: 0,
      worst_overall: null,
      best_overall: null,
      total_fabricated_numbers: 0,
      total_fabricated_strings: 0,
      total_tone_violations: 0,
      successful: 0,
      failed: 0,
    };
  }
  const successful = perFixture.filter((r) => r.score && !r.error);
  const overall = successful.map((r) => r.score.overall);
  const halluc  = successful.map((r) => r.score.hallucination.score);
  const tone    = successful.map((r) => r.score.tone.score);

  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
  const fabricatedNumTotal = successful.reduce(
    (sum, r) => sum + (r.score.hallucination.fabricated_numbers?.length || 0), 0,
  );
  const fabricatedStrTotal = successful.reduce(
    (sum, r) => sum + (r.score.hallucination.fabricated_strings?.length || 0), 0,
  );
  const violationTotal = successful.reduce(
    (sum, r) => sum + (r.score.tone.violations?.length || 0), 0,
  );

  const sorted = [...successful].sort((a, b) => a.score.overall - b.score.overall);

  return {
    fixtures: perFixture.length,
    successful: successful.length,
    failed: perFixture.length - successful.length,
    avg_overall: avg(overall),
    avg_hallucination: avg(halluc),
    avg_tone: avg(tone),
    worst_overall: sorted[0] ? { fixture_id: sorted[0].fixture_id, overall: sorted[0].score.overall } : null,
    best_overall:  sorted[sorted.length - 1] ? { fixture_id: sorted[sorted.length - 1].fixture_id, overall: sorted[sorted.length - 1].score.overall } : null,
    total_fabricated_numbers: fabricatedNumTotal,
    total_fabricated_strings: fabricatedStrTotal,
    total_tone_violations: violationTotal,
  };
};

/**
 * Core runner. Provided primarily so unit tests can exercise the
 * orchestration with a mocked `runOne` (no network). The CLI wraps this
 * with its own resolveRunner.
 */
const runEval = async ({
  task,
  fixtures,
  candidates,             // [{ id, runner: ({systemPrompt,payload,maxTokens}) => Promise<text> }]
  systemPrompt = null,    // optional — falls back to the task's default service prompt
  scoringOpts: scoringOptsOverride = null,
  maxTokens = 700,
  onProgress = null,
  parseText = null,       // optional fn(rawText) → string (e.g. extract ic_opinion from JSON)
}) => {
  if (!task || !TASKS[task]) {
    throw new Error(`Unknown task '${task}'. Choose: ${Object.keys(TASKS).join(', ')}`);
  }
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw new Error('At least one fixture is required.');
  }
  // One candidate = a single-config "baseline" run (quality monitoring);
  // two or more = an A/B comparison. The pairwise-delta loop below simply
  // yields nothing for a single candidate.
  if (!Array.isArray(candidates) || candidates.length < 1) {
    throw new Error('At least one candidate is required.');
  }

  const cfg = TASKS[task];
  const scoringOpts = scoringOptsOverride || cfg.scoringOpts;
  const resolvedSystemPrompt = systemPrompt || cfg.defaultSystemPrompt();
  if (!resolvedSystemPrompt || typeof resolvedSystemPrompt !== 'string') {
    throw new Error(`No system prompt available for task '${task}'.`);
  }
  // Default JSON extractor for export_insights — pulls ic_opinion out
  // of the JSON envelope before scoring. Caller can override for
  // bespoke schemas.
  const extractText = parseText || ((raw) => {
    if (task !== 'export_insights') return raw;
    if (!raw || typeof raw !== 'string') return raw;
    try {
      const cleaned = raw
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '');
      const parsed = JSON.parse(cleaned);
      return typeof parsed?.ic_opinion === 'string' ? parsed.ic_opinion : raw;
    } catch {
      return raw;
    }
  });

  const results = {};

  for (const candidate of candidates) {
    const perFixture = [];
    for (const fixture of fixtures) {
      const payload = cfg.buildPayload(fixture);
      const snapshot = cfg.buildSnapshot(fixture);

      let rawText = null;
      let error = null;
      const t0 = Date.now();
      try {
        rawText = await candidate.runner({ systemPrompt: resolvedSystemPrompt, payload, maxTokens });
      } catch (err) {
        error = err.message || String(err);
      }
      const latencyMs = Date.now() - t0;
      const text = rawText ? extractText(rawText) : null;

      let score = null;
      if (text && !error) {
        try {
          score = scoreOutput(text, snapshot, scoringOpts);
        } catch (err) {
          error = `Scoring failed: ${err.message}`;
        }
      }

      const row = {
        fixture_id: fixture.id || `fx-${perFixture.length + 1}`,
        latency_ms: latencyMs,
        text,
        error,
        score,
      };
      perFixture.push(row);
      if (onProgress) onProgress({ candidate: candidate.id, fixture: row });
    }
    results[candidate.id] = {
      candidate_id: candidate.id,
      summary: summarize(perFixture),
      per_fixture: perFixture,
    };
  }

  // Compute the head-to-head delta — candidate[0] vs candidate[1] (and
  // any further pairwise comparisons if more than 2 candidates).
  const deltas = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i].id;
      const b = candidates[j].id;
      deltas.push({
        a,
        b,
        avg_overall_diff: results[a].summary.avg_overall - results[b].summary.avg_overall,
        avg_hallucination_diff: results[a].summary.avg_hallucination - results[b].summary.avg_hallucination,
        avg_tone_diff: results[a].summary.avg_tone - results[b].summary.avg_tone,
      });
    }
  }

  return {
    task,
    task_label: cfg.label,
    candidate_ids: candidates.map((c) => c.id),
    results,
    deltas,
    generated_at: new Date().toISOString(),
  };
};

module.exports = {
  runEval,
  resolveRunner,
  summarize,
  TASKS,
};
