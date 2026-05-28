'use strict';

/**
 * Tier-2 #14 finish — persistence layer for A/B eval runs.
 *
 * Wraps the pure `runEval()` function from abEvalHarness.service.js with
 * DB writes against `ab_eval_runs` + `ab_eval_results` (migration
 * 20260526). The web admin UI calls into this layer; the CLI runner
 * (backend/scripts/run-ab-eval.js) stays pure (Markdown report on
 * disk, no DB write) since it's used for offline dev.
 *
 * Soft-fails on missing migration:
 *   • If `ab_eval_runs` doesn't exist (Postgres 42P01), the persistence
 *     layer logs a one-time warning and returns the in-memory result
 *     anyway. The harness still ran; only the persistence is gone.
 *
 * Per CLAUDE.md hard rules:
 *   • No LLM-judge scoring — `abEvalScoring.js` is deterministic JS.
 *   • Daily cost cap (`aiRouter`) still applies — this service does
 *     not bypass it.
 *   • Org-scoped via RLS on the persistence tables.
 */

const fs = require('fs');
const path = require('path');
const { query } = require('../../config/database');
const { runEval, resolveRunner } = require('./abEvalHarness.service');

const DEFAULT_FIXTURES_PATH = path.join(
  __dirname, '..', '..', '..', 'tests', 'fixtures', 'ab-eval-deals.json',
);

const SOFT_ERROR_CODES = new Set(['42P01', '42703']);
let warnedAboutMissingTable = false;
const warnSoft = (err, context) => {
  if (err?.code === '42P01' && warnedAboutMissingTable) return;
  if (err?.code === '42P01') warnedAboutMissingTable = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[abEvalPersistence] ${context}: ${err.message || err} ` +
    `(code=${err.code || 'unknown'}). Run not persisted.`,
  );
};

// ── Fixture loading ──────────────────────────────────────────────────────

const loadFixtures = (fixturesPath = DEFAULT_FIXTURES_PATH) => {
  if (!fs.existsSync(fixturesPath)) {
    throw Object.assign(
      new Error(
        `Fixtures file not found: ${fixturesPath}. ` +
        `Generate with: node backend/scripts/generate-ab-eval-fixtures.js`,
      ),
      { statusCode: 500 },
    );
  }
  const raw = fs.readFileSync(fixturesPath, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Fixtures JSON must be an array');
    return parsed;
  } catch (err) {
    throw Object.assign(
      new Error(`Could not parse fixtures: ${err.message}`),
      { statusCode: 500 },
    );
  }
};

// ── Run persistence ──────────────────────────────────────────────────────

/**
 * Insert a placeholder `ab_eval_runs` row in `running` status before the
 * actual eval kicks off. Returns the row id so the caller can update it
 * once the run completes (or fails). Best-effort — soft-fails to null on
 * missing migration; the caller proceeds without persistence in that case.
 */
const createRun = async ({
  organizationId,
  task,
  candidateIds,
  fixtureCount,
  totalCalls,
  estimatedCostUsd,
  triggeredBy = null,
}) => {
  if (!organizationId) {
    throw Object.assign(
      new Error('createRun: organizationId is required'),
      { statusCode: 400 },
    );
  }
  try {
    const result = await query(
      `INSERT INTO ab_eval_runs (
         organization_id, task, candidate_ids, fixture_count,
         total_calls, estimated_cost_usd, triggered_by, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'running')
       RETURNING id, started_at`,
      [
        organizationId,
        task,
        candidateIds,
        fixtureCount,
        totalCalls,
        estimatedCostUsd,
        triggeredBy,
      ],
    );
    return result.rows[0] || null;
  } catch (err) {
    if (SOFT_ERROR_CODES.has(err?.code)) {
      warnSoft(err, 'createRun');
      return null;
    }
    throw err;
  }
};

/**
 * Mark a run as completed (or failed) and write the per-fixture detail
 * rows. Soft-fails on missing migration.
 */
const finalizeRun = async ({
  runId,
  organizationId,
  evalResult,        // shape returned by runEval()
  durationMs,
  status = 'completed',
  errorMessage = null,
}) => {
  if (!runId) return; // no-op when persistence wasn't possible

  try {
    // Update the run header.
    await query(
      `UPDATE ab_eval_runs
          SET status = $1,
              completed_at = NOW(),
              duration_ms = $2,
              error_message = $3,
              summary_json = $4,
              deltas_json = $5
        WHERE id = $6`,
      [
        status,
        durationMs,
        errorMessage,
        JSON.stringify(buildSummaryByCandidate(evalResult)),
        JSON.stringify(evalResult?.deltas || []),
        runId,
      ],
    );

    if (status !== 'completed' || !evalResult) return;

    // Bulk-insert per-fixture detail rows. We do this one-by-one
    // rather than as a single multi-row INSERT to keep the SQL
    // simple and let RLS evaluate per row. 60 rows is cheap.
    for (const candidateId of evalResult.candidate_ids) {
      const candidate = evalResult.results[candidateId];
      if (!candidate) continue;
      for (const row of candidate.per_fixture) {
        const score = row.score;
        await query(
          `INSERT INTO ab_eval_results (
             run_id, organization_id, candidate_id, fixture_id,
             latency_ms,
             overall_score, hallucination_score, tone_score,
             fabricated_numbers_count, fabricated_strings_count, tone_violations_count,
             output_text, score_detail, error_message
           ) VALUES (
             $1, $2, $3, $4,
             $5,
             $6, $7, $8,
             $9, $10, $11,
             $12, $13, $14
           )
           ON CONFLICT (run_id, candidate_id, fixture_id) DO UPDATE SET
             latency_ms = EXCLUDED.latency_ms,
             overall_score = EXCLUDED.overall_score,
             hallucination_score = EXCLUDED.hallucination_score,
             tone_score = EXCLUDED.tone_score,
             fabricated_numbers_count = EXCLUDED.fabricated_numbers_count,
             fabricated_strings_count = EXCLUDED.fabricated_strings_count,
             tone_violations_count = EXCLUDED.tone_violations_count,
             output_text = EXCLUDED.output_text,
             score_detail = EXCLUDED.score_detail,
             error_message = EXCLUDED.error_message`,
          [
            runId,
            organizationId,
            candidateId,
            row.fixture_id,
            row.latency_ms || null,
            score?.overall ?? null,
            score?.hallucination?.score ?? null,
            score?.tone?.score ?? null,
            score?.hallucination?.fabricated_numbers?.length || 0,
            score?.hallucination?.fabricated_strings?.length || 0,
            score?.tone?.violations?.length || 0,
            // Cap output_text at 10 KB to keep the table compact —
            // most LLM outputs are ~600 tokens / ~2.5 KB anyway.
            row.text ? row.text.slice(0, 10_000) : null,
            score ? JSON.stringify(score) : null,
            row.error || null,
          ],
        );
      }
    }
  } catch (err) {
    if (SOFT_ERROR_CODES.has(err?.code)) {
      warnSoft(err, 'finalizeRun');
      return;
    }
    throw err;
  }
};

const buildSummaryByCandidate = (evalResult) => {
  if (!evalResult || !evalResult.results) return {};
  const out = {};
  for (const cid of evalResult.candidate_ids || Object.keys(evalResult.results)) {
    out[cid] = evalResult.results[cid]?.summary || null;
  }
  return out;
};

// ── List + read ─────────────────────────────────────────────────────────

const listRuns = async ({ limit = 50 } = {}) => {
  const clamped = Math.max(1, Math.min(Number(limit) || 50, 200));
  try {
    const result = await query(
      `SELECT r.id, r.task, r.candidate_ids, r.fixture_count, r.total_calls,
              r.estimated_cost_usd, r.summary_json, r.deltas_json,
              r.triggered_by, r.status, r.error_message,
              r.started_at, r.completed_at, r.duration_ms, r.created_at,
              u.name AS triggered_by_name, u.email AS triggered_by_email
         FROM ab_eval_runs r
         LEFT JOIN users u ON u.id = r.triggered_by
        WHERE r.organization_id = current_organization_id()
        ORDER BY r.created_at DESC
        LIMIT $1`,
      [clamped],
    );
    return result.rows;
  } catch (err) {
    if (SOFT_ERROR_CODES.has(err?.code)) {
      warnSoft(err, 'listRuns');
      return [];
    }
    throw err;
  }
};

const getRunDetail = async (runId) => {
  if (!runId) return null;
  try {
    const runResult = await query(
      `SELECT r.*, u.name AS triggered_by_name, u.email AS triggered_by_email
         FROM ab_eval_runs r
         LEFT JOIN users u ON u.id = r.triggered_by
        WHERE r.id = $1
          AND r.organization_id = current_organization_id()`,
      [runId],
    );
    if (!runResult.rows.length) return null;
    const run = runResult.rows[0];
    const detailResult = await query(
      `SELECT id, candidate_id, fixture_id, latency_ms,
              overall_score, hallucination_score, tone_score,
              fabricated_numbers_count, fabricated_strings_count, tone_violations_count,
              output_text, score_detail, error_message, created_at
         FROM ab_eval_results
        WHERE run_id = $1
          AND organization_id = current_organization_id()
        ORDER BY fixture_id ASC, candidate_id ASC`,
      [runId],
    );
    return { ...run, results: detailResult.rows };
  } catch (err) {
    if (SOFT_ERROR_CODES.has(err?.code)) {
      warnSoft(err, 'getRunDetail');
      return null;
    }
    throw err;
  }
};

// ── Quality trend — the standing quality monitor ─────────────────────────

// Tasks the standing quality trend covers — the prose tasks the
// deterministic scorer in abEvalScoring.js is calibrated for.
const TREND_TASKS = Object.freeze(['export_insights']);

// A baseline overall score this many points below the trailing average of
// prior baselines flags as a quality regression.
const REGRESSION_THRESHOLD_PTS = 5;

const emptyTrend = () => ({
  available: true,
  run_count: 0,
  series: [],
  latest: null,
  baseline_avg: null,
  delta: null,
  regression: false,
});

/**
 * Standing-quality read model. Aggregates the *baseline* eval runs (single
 * candidate — the current production config) per task over a trailing
 * window into a quality trend: the score series, the latest score, the
 * trailing-average baseline, the delta, and a regression flag.
 *
 * A/B comparison runs (2+ candidates) are deliberately excluded — only
 * like-for-like baseline runs are comparable over time. Baselines are
 * identified by a single-element `candidate_ids`, so no schema change is
 * needed to tell the two run kinds apart.
 *
 * Soft-fails to `available: false` if the persistence table is not present.
 */
const getQualityTrendByTask = async ({ days = 90 } = {}) => {
  const windowDays = Math.max(1, Math.min(Number(days) || 90, 365));
  const result = {
    available: true,
    window_days: windowDays,
    tasks: {},
    generated_at: new Date().toISOString(),
  };
  for (const t of TREND_TASKS) result.tasks[t] = emptyTrend();

  try {
    const { rows } = await query(
      `SELECT id, task, summary_json, created_at
         FROM ab_eval_runs
        WHERE organization_id = current_organization_id()
          AND status = 'completed'
          AND task = ANY($1)
          AND array_length(candidate_ids, 1) = 1
          AND created_at > NOW() - ($2 || ' days')::interval
        ORDER BY created_at ASC`,
      [[...TREND_TASKS], windowDays],
    );

    const byTask = {};
    for (const t of TREND_TASKS) byTask[t] = [];
    for (const row of rows) {
      if (!byTask[row.task]) continue;
      // A baseline run's summary_json carries exactly one candidate entry.
      const summary =
        row.summary_json && typeof row.summary_json === 'object'
          ? Object.values(row.summary_json)[0]
          : null;
      if (!summary || typeof summary.avg_overall !== 'number') continue;
      byTask[row.task].push({
        run_id: row.id,
        date: row.created_at,
        overall: summary.avg_overall,
        hallucination:
          typeof summary.avg_hallucination === 'number' ? summary.avg_hallucination : null,
        tone: typeof summary.avg_tone === 'number' ? summary.avg_tone : null,
      });
    }

    for (const t of TREND_TASKS) {
      const series = byTask[t];
      if (series.length === 0) continue; // result.tasks[t] stays emptyTrend()
      const latest = series[series.length - 1];
      const prior = series.slice(0, -1);
      const baselineAvg = prior.length
        ? Math.round(prior.reduce((sum, p) => sum + p.overall, 0) / prior.length)
        : null;
      const delta = baselineAvg === null ? null : latest.overall - baselineAvg;
      result.tasks[t] = {
        available: true,
        run_count: series.length,
        series,
        latest,
        baseline_avg: baselineAvg,
        delta,
        regression: delta !== null && delta <= -REGRESSION_THRESHOLD_PTS,
      };
    }
    return result;
  } catch (err) {
    if (SOFT_ERROR_CODES.has(err?.code)) {
      warnSoft(err, 'getQualityTrendByTask');
      return {
        available: false,
        window_days: windowDays,
        tasks: {},
        generated_at: new Date().toISOString(),
      };
    }
    throw err;
  }
};

// ── End-to-end run ───────────────────────────────────────────────────────

const COST_PER_CALL_HEURISTIC_USD = 0.012;
const MAX_FIXTURES_PER_RUN = 50; // hard cap to keep web requests bounded

// A baseline run scores the current production reasoning config. Claude is
// REDIP's reasoning provider (CLAUDE.md AI routing); the bare 'claude' spec
// resolves through resolveRunner to the env-configured model, so a baseline
// always tracks whatever production is actually running.
const BASELINE_CANDIDATE_SPEC = 'claude';

/**
 * Shared run-and-persist core. `candidateSpecs` is one entry (a baseline /
 * quality-monitoring run) or two-plus (an A/B comparison). Sync-blocking —
 * the route awaits this and returns the run row when done; the fixture
 * slice is `--limit`-capped (default 10) to fit inside the function
 * timeout. Larger runs go through the CLI.
 */
const runAndPersistCore = async ({
  organizationId,
  triggeredBy = null,
  task = 'export_insights',
  candidateSpecs,
  fixturesPath = DEFAULT_FIXTURES_PATH,
  limit = 10,
}) => {
  if (!['export_insights'].includes(task)) {
    throw Object.assign(
      new Error(`Unknown task '${task}'. Choose: export_insights`),
      { statusCode: 400 },
    );
  }
  const allFixtures = loadFixtures(fixturesPath);
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 10, MAX_FIXTURES_PER_RUN));
  const fixtures = allFixtures.slice(0, cappedLimit);

  const totalCalls = candidateSpecs.length * fixtures.length;
  const estimatedCost = totalCalls * COST_PER_CALL_HEURISTIC_USD;

  const candidateIds = candidateSpecs.map((spec) => (spec.includes(':') ? spec : `${spec}:default`));

  const runRow = await createRun({
    organizationId,
    task,
    candidateIds,
    fixtureCount: fixtures.length,
    totalCalls,
    estimatedCostUsd: estimatedCost,
    triggeredBy,
  });
  const runId = runRow?.id || null;

  const candidates = candidateSpecs.map((spec) => ({
    id: spec.includes(':') ? spec : `${spec}:default`,
    runner: resolveRunner(spec),
  }));

  const t0 = Date.now();
  let evalResult = null;
  let errorMessage = null;
  let status = 'completed';
  try {
    evalResult = await runEval({ task, fixtures, candidates });
  } catch (err) {
    status = 'failed';
    errorMessage = err.message || String(err);
  }
  const durationMs = Date.now() - t0;

  await finalizeRun({
    runId,
    organizationId,
    evalResult,
    durationMs,
    status,
    errorMessage,
  });

  return {
    run_id: runId,
    status,
    duration_ms: durationMs,
    error_message: errorMessage,
    fixtures: fixtures.length,
    total_calls: totalCalls,
    estimated_cost_usd: estimatedCost,
    eval_result: evalResult,
  };
};

/**
 * A/B comparison — execute and persist an eval of two or more candidates.
 * Surfaced on the Run-A/B card of the admin page.
 */
const runAndPersist = async (args = {}) => {
  if (!Array.isArray(args.candidateSpecs) || args.candidateSpecs.length < 2) {
    throw Object.assign(
      new Error('At least two candidate specs required (e.g. ["claude:default","openai:default"]).'),
      { statusCode: 400 },
    );
  }
  return runAndPersistCore(args);
};

/**
 * Baseline — execute and persist a single run of the current production
 * reasoning config against the fixtures, for standing quality monitoring.
 * The resulting run carries a single-element `candidate_ids`, which is how
 * getQualityTrendByTask tells baselines apart from A/B runs.
 */
const runBaselineAndPersist = async ({
  organizationId,
  triggeredBy = null,
  task = 'export_insights',
  fixturesPath = DEFAULT_FIXTURES_PATH,
  limit = 10,
} = {}) =>
  runAndPersistCore({
    organizationId,
    triggeredBy,
    task,
    candidateSpecs: [BASELINE_CANDIDATE_SPEC],
    fixturesPath,
    limit,
  });

// ── Scheduled baseline (the daily cron) ──────────────────────────────────

/**
 * Resolve the organisation a scheduled (cron) baseline is attributed to.
 * The quality baseline measures REDIP's own production AI, which is
 * identical for every tenant — it is not per-tenant data. It is recorded
 * once, against the oldest organisation (the operator's primary workspace).
 * Soft-fails to null if the table is unavailable.
 */
const resolveBaselineOrganizationId = async () => {
  try {
    const { rows } = await query(
      'SELECT id FROM public.organizations ORDER BY created_at ASC, id ASC LIMIT 1',
    );
    return rows[0]?.id || null;
  } catch (err) {
    if (SOFT_ERROR_CODES.has(err?.code)) {
      warnSoft(err, 'resolveBaselineOrganizationId');
      return null;
    }
    throw err;
  }
};

/**
 * Run a scheduled baseline for every monitored task — the engine behind the
 * daily quality-baseline cron. Each task runs independently: one task
 * failing (a provider outage, the daily cost cap) never aborts the others.
 * Never throws — always returns a summary the cron route can serialise.
 */
const runScheduledBaselines = async ({ limit = 10 } = {}) => {
  const organizationId = await resolveBaselineOrganizationId();
  if (!organizationId) {
    return { scheduled: true, ran: 0, skipped: true, reason: 'no_organization', tasks: [] };
  }

  const tasks = [];
  for (const task of TREND_TASKS) {
    try {
      const result = await runBaselineAndPersist({ organizationId, task, limit });
      tasks.push({
        task,
        status: result.status,
        run_id: result.run_id,
        error: result.error_message || null,
      });
    } catch (err) {
      tasks.push({ task, status: 'failed', run_id: null, error: err.message || String(err) });
    }
  }

  return {
    scheduled: true,
    ran: tasks.filter((t) => t.status === 'completed').length,
    organization_id: organizationId,
    tasks,
  };
};

module.exports = {
  runAndPersist,
  runBaselineAndPersist,
  runScheduledBaselines,
  getQualityTrendByTask,
  createRun,
  finalizeRun,
  listRuns,
  getRunDetail,
  loadFixtures,
  buildSummaryByCandidate,
  MAX_FIXTURES_PER_RUN,
  TREND_TASKS,
  REGRESSION_THRESHOLD_PTS,
  DEFAULT_FIXTURES_PATH,
};
