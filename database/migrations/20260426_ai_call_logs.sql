-- ──────────────────────────────────────────────────────────────────────────
-- AI call observability — every Gemini / Claude / OpenAI call is logged here.
--
-- Why a dedicated table (separate from monitoring_logs):
--   * monitoring_logs is for engine anomalies / variance alerts — operational.
--   * ai_call_logs is the cost & quality ledger — financial + product.
--   * Different access patterns: cost dashboards, latency P95 alerts, regenerate
--     diffs, "which extraction generated this evidence_fact" lineage. Splitting
--     keeps both queryable without wide JSONB scans.
--
-- All AI calls are logged regardless of org so platform-level cost tracking
-- works (anonymous extraction backfills, system-driven jobs). Tenant queries
-- filter by organization_id via RLS.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_call_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID REFERENCES organizations(id) ON DELETE SET NULL,
  request_id          TEXT,                                 -- correlates to logger request_id
  task                TEXT NOT NULL,                        -- e.g. 'document_extraction'
  provider            TEXT NOT NULL,                        -- 'gemini' | 'claude' | 'openai'
  model               TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('success','error','timeout','skipped')),
  latency_ms          INTEGER,
  prompt_tokens       INTEGER,
  completion_tokens   INTEGER,
  total_tokens        INTEGER,
  cost_usd            NUMERIC(12,6),
  error_code          TEXT,
  error_message       TEXT,
  evidence_source_id  UUID,                                 -- FK validated at app layer (cross-schema)
  evidence_fact_id    UUID,
  document_id         UUID REFERENCES documents(id) ON DELETE SET NULL,
  deal_id             UUID REFERENCES deals(id) ON DELETE SET NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_call_logs_org_created_idx
  ON ai_call_logs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_call_logs_task_provider_idx
  ON ai_call_logs (task, provider, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_call_logs_status_idx
  ON ai_call_logs (status, created_at DESC)
  WHERE status <> 'success';

CREATE INDEX IF NOT EXISTS ai_call_logs_request_idx
  ON ai_call_logs (request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_call_logs_evidence_idx
  ON ai_call_logs (evidence_source_id)
  WHERE evidence_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_call_logs_document_idx
  ON ai_call_logs (document_id)
  WHERE document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_call_logs_deal_idx
  ON ai_call_logs (deal_id)
  WHERE deal_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- RLS — tenants only see their own AI call logs. Platform admins can read
-- across orgs via service-role key (bypasses RLS).
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE ai_call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_call_logs_select ON ai_call_logs;
CREATE POLICY ai_call_logs_select ON ai_call_logs
  FOR SELECT
  USING (organization_id IS NULL OR organization_id = current_organization_id());

DROP POLICY IF EXISTS ai_call_logs_insert ON ai_call_logs;
CREATE POLICY ai_call_logs_insert ON ai_call_logs
  FOR INSERT
  WITH CHECK (
    organization_id IS NULL
    OR organization_id = current_organization_id()
  );

COMMENT ON TABLE  ai_call_logs IS 'Append-only ledger of every AI provider call: cost, latency, status, lineage to evidence.';
COMMENT ON COLUMN ai_call_logs.evidence_source_id IS 'If the call produced or refreshed an evidence_source row, store its id here for full lineage.';
COMMENT ON COLUMN ai_call_logs.metadata IS 'Free-form JSON: prompt hash, max_tokens, temperature, regenerate_of (prior call id), etc.';
