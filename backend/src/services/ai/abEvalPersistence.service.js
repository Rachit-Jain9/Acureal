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

// ── End-to-end run ───────────────────────────────────────────────────────

const COST_PER_CALL_HEURISTIC_USD = 0.012;
const MAX_FIXTURES_PER_RUN = 50; // hard cap to keep web requests bounded

/**
 * Execute an A/B eval and persist the results. Sync-blocking — the
 * route awaits this and returns the run row when done. For 30 fixtures
 * × 2 candidates × ~3s/call ≈ 180s total which exceeds Vercel's 60s
 * function timeout. The route is therefore admin-only and runs against
 * a `--limit`-capped fixture slice (default 10) to fit inside the
 * timeout. Larger runs go through the CLI.
 */
const runAndPersist = async ({
  organizationId,
  triggeredBy = null,
  task = 'parcel_narrative',
  candidateSpecs,            // ['claude:claude-sonnet-4-6', 'openai:gpt-5.4-mini']
  fixturesPath = DEFAULT_FIXTURES_PATH,
  limit = 10,                // small default so the web run fits in 60s
}) => {
  if (!Array.isArray(candidateSpecs) || candidateSpecs.length < 2) {
    throw Object.assign(
      new Error('At least two candidate specs required (e.g. ["claude:default","openai:default"])'),
      { statusCode: 400 },
    );
  }
  if (!['parcel_narrative', 'export_insights'].includes(task)) {
    throw Object.assign(
      new Error(`Unknown task '${task}'. Choose: parcel_narrative | export_insights`),
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

module.exports = {
  runAndPersist,
  createRun,
  finalizeRun,
  listRuns,
  getRunDetail,
  loadFixtures,
  buildSummaryByCandidate,
  MAX_FIXTURES_PER_RUN,
  DEFAULT_FIXTURES_PATH,
};
