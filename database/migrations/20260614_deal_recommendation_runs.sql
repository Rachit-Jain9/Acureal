-- 20260614_deal_recommendation_runs.sql
--
-- Append-only audit log for Recommendation Engine runs (REDIP Pending review §5.7).
-- Every time the engine evaluates a deal — whether triggered by a workspace load,
-- an explicit refresh, or a follow-up after the operator edits inputs — one row
-- lands here recording the snapshot the recommendations were computed from + the
-- candidate set + any narrator metadata. The audit chain answers "why did we
-- recommend X on date Y?" forever.
--
-- Why append-only: the recommendation set is a function of the deal's snapshot,
-- so any "update" is actually a new run against a new snapshot. Storing every run
-- makes the recommendation history scrubbable end-to-end (the operator can see
-- exactly when a recommendation appeared, when it changed wording, when it
-- dropped out as evidence resolved).
--
-- Operator action required:
--   • Apply this migration via Supabase SQL editor:
--     https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new
--     Paste the entire contents of this file. Click 'Run'. Send 'done' when
--     you see 'Success. No rows returned'.
--   • No data backfill required — the engine starts populating this table the
--     moment the new code deploys.

BEGIN;

CREATE TABLE IF NOT EXISTS deal_recommendation_runs (
  id                BIGSERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL,
  deal_id           UUID NOT NULL,
  snapshot_hash     TEXT NOT NULL,
  signal_count      INTEGER NOT NULL,
  -- The full candidate set, as a JSON array. Stored once per snapshot — repeat
  -- runs against the same snapshot dedupe via the (deal_id, snapshot_hash)
  -- unique constraint.
  recommendations   JSONB NOT NULL,
  -- The full signal set the recommendations were derived from. Kept alongside
  -- the recommendations so the audit chain is self-contained — no need to
  -- re-derive signals to explain a historical recommendation.
  signals           JSONB NOT NULL,
  -- The AI narrator's status for this run: 'skipped' (deterministic only),
  -- 'success' (narrator ran cleanly), 'partial' (narrator failed on some
  -- cards), 'failed' (narrator threw at the top level), 'disabled' (env var
  -- turned narration off). Tracked separately from the recommendation
  -- payload so cost-dashboards can split paid vs. unpaid runs.
  narrator_status   TEXT NOT NULL DEFAULT 'skipped',
  narrator_meta     JSONB,
  -- Generation timing for cost dashboards.
  latency_ms        INTEGER,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedup: one row per (deal_id, snapshot_hash). Repeat calls with the same
-- snapshot are no-ops at the persistence layer.
CREATE UNIQUE INDEX IF NOT EXISTS deal_recommendation_runs_dedup
  ON deal_recommendation_runs (deal_id, snapshot_hash);

-- Most queries are "give me the latest run for this deal".
CREATE INDEX IF NOT EXISTS deal_recommendation_runs_by_deal_latest
  ON deal_recommendation_runs (deal_id, created_at DESC);

-- Cross-tenant safety — RLS enforces organization scoping.
ALTER TABLE deal_recommendation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_recommendation_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_recommendation_runs_org_isolation ON deal_recommendation_runs;
CREATE POLICY deal_recommendation_runs_org_isolation
  ON deal_recommendation_runs
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Append-only: explicit DENY on UPDATE / DELETE. The dedup index handles
-- "don't re-insert"; this block prevents accidental mutation of audit rows
-- via the API (RLS already enforces tenant; this enforces immutability).
DROP POLICY IF EXISTS deal_recommendation_runs_no_update ON deal_recommendation_runs;
CREATE POLICY deal_recommendation_runs_no_update
  ON deal_recommendation_runs
  FOR UPDATE
  USING (false);

DROP POLICY IF EXISTS deal_recommendation_runs_no_delete ON deal_recommendation_runs;
CREATE POLICY deal_recommendation_runs_no_delete
  ON deal_recommendation_runs
  FOR DELETE
  USING (false);

COMMIT;
