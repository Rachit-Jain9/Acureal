-- 20260526_ab_eval_runs.sql
-- =============================================================================
-- Tier-2 #14 finish — persist A/B eval runs.
--
-- The CLI runner (backend/scripts/run-ab-eval.js) already writes a
-- Markdown report to disk per run. To make the harness operatable from
-- the web (admin UI) we need a DB table so:
--   1. An admin can view past runs without SSHing into the box.
--   2. We can plot "model X vs model Y over time" later when there are
--      enough runs to chart.
--   3. Each run is org-scoped via RLS, the same as every other AI
--      artifact in the system.
--
-- Schema choice — two tables vs one:
--   • `ab_eval_runs`   — one row per run (task, candidates, summary,
--                        triggered_by, generated_at)
--   • `ab_eval_results`— one row per (run × candidate × fixture) for
--                        the per-fixture detail view
--
-- We DO NOT denormalize the per-fixture rows into the run JSON because
-- a 30-fixture run × 2 candidates = 60 detail rows; analysts want to
-- sort + filter them in the UI. Putting them in their own indexed
-- table makes that cheap.
--
-- Per CLAUDE.md hard rules:
--   • RLS on every table, scoped by organization_id.
--   • Idempotent migration — CREATE TABLE IF NOT EXISTS, DROP POLICY
--     IF EXISTS, partial unique index for the natural key.
--   • Composite unique key on the detail table prevents duplicates
--     when the same run is replayed accidentally.

BEGIN;

-- ── ab_eval_runs ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ab_eval_runs (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID            NOT NULL,

  task              TEXT            NOT NULL
                                      CHECK (task IN ('parcel_narrative', 'export_insights')),
  candidate_ids     TEXT[]          NOT NULL,            -- e.g. ['claude:claude-sonnet-4-6','openai:gpt-5.4-mini']
  fixture_count     INTEGER         NOT NULL,
  total_calls       INTEGER         NOT NULL,
  estimated_cost_usd NUMERIC(8, 4),

  -- Per-candidate aggregate JSON keyed by candidate_id, shape:
  --   { 'claude:...': { fixtures, avg_overall, avg_hallucination, ... },
  --     'openai:...': { ... } }
  summary_json      JSONB           NOT NULL DEFAULT '{}'::jsonb,

  -- Pairwise head-to-head deltas. Same shape as harness's `deltas[]`.
  deltas_json       JSONB           NOT NULL DEFAULT '[]'::jsonb,

  -- Bookkeeping
  triggered_by      UUID            REFERENCES users(id) ON DELETE SET NULL,
  status            TEXT            NOT NULL DEFAULT 'completed'
                                      CHECK (status IN ('running', 'completed', 'failed')),
  error_message     TEXT,
  started_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  duration_ms       INTEGER,

  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ab_eval_runs_org_created_idx
  ON public.ab_eval_runs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ab_eval_runs_task_idx
  ON public.ab_eval_runs (task);

CREATE INDEX IF NOT EXISTS ab_eval_runs_status_idx
  ON public.ab_eval_runs (status)
  WHERE status <> 'completed';

ALTER TABLE public.ab_eval_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ab_eval_runs_select_org" ON public.ab_eval_runs;
CREATE POLICY "ab_eval_runs_select_org" ON public.ab_eval_runs
  FOR SELECT
  USING (organization_id = current_setting('redip.organization_id', true)::uuid);

DROP POLICY IF EXISTS "ab_eval_runs_modify_org" ON public.ab_eval_runs;
CREATE POLICY "ab_eval_runs_modify_org" ON public.ab_eval_runs
  FOR ALL
  USING (organization_id = current_setting('redip.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('redip.organization_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ab_eval_runs TO authenticated;

-- ── ab_eval_results — per (run × candidate × fixture) detail rows ─────────

CREATE TABLE IF NOT EXISTS public.ab_eval_results (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID            NOT NULL REFERENCES ab_eval_runs(id) ON DELETE CASCADE,
  organization_id   UUID            NOT NULL,

  candidate_id      TEXT            NOT NULL,
  fixture_id        TEXT            NOT NULL,

  latency_ms        INTEGER,
  -- Score breakdown — null when the call errored.
  overall_score     NUMERIC(5, 2),
  hallucination_score NUMERIC(5, 2),
  tone_score        NUMERIC(5, 2),
  fabricated_numbers_count INTEGER  NOT NULL DEFAULT 0,
  fabricated_strings_count INTEGER  NOT NULL DEFAULT 0,
  tone_violations_count    INTEGER  NOT NULL DEFAULT 0,

  -- Raw text the LLM produced. NULL when errored. Capped by client
  -- to ~10KB on insert; the table itself doesn't enforce a limit.
  output_text       TEXT,

  -- Full hallucination + tone detail JSON for drilldown. Mirrors
  -- abEvalScoring.scoreOutput()'s shape.
  score_detail      JSONB,

  error_message     TEXT,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Idempotency: same (run, candidate, fixture) shouldn't appear twice.
-- Service-layer logic INSERTs once per cell so this is a backstop
-- against partial-replay scenarios.
CREATE UNIQUE INDEX IF NOT EXISTS ab_eval_results_unique_idx
  ON public.ab_eval_results (run_id, candidate_id, fixture_id);

CREATE INDEX IF NOT EXISTS ab_eval_results_run_idx
  ON public.ab_eval_results (run_id);

CREATE INDEX IF NOT EXISTS ab_eval_results_org_created_idx
  ON public.ab_eval_results (organization_id, created_at DESC);

ALTER TABLE public.ab_eval_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ab_eval_results_select_org" ON public.ab_eval_results;
CREATE POLICY "ab_eval_results_select_org" ON public.ab_eval_results
  FOR SELECT
  USING (organization_id = current_setting('redip.organization_id', true)::uuid);

DROP POLICY IF EXISTS "ab_eval_results_modify_org" ON public.ab_eval_results;
CREATE POLICY "ab_eval_results_modify_org" ON public.ab_eval_results
  FOR ALL
  USING (organization_id = current_setting('redip.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('redip.organization_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ab_eval_results TO authenticated;

COMMENT ON TABLE public.ab_eval_runs IS
  'Persisted A/B eval runs (Tier 2 #14). Each row is one comparison of '
  'two or more (provider, model) candidates against a fixture set. '
  'Surfaced on AdminAbEvalPage. Org-scoped via RLS.';

COMMENT ON TABLE public.ab_eval_results IS
  'Per (run × candidate × fixture) detail rows. Lets the admin UI sort '
  'and filter the comparison without JSON-extracting from the run row.';

COMMIT;
