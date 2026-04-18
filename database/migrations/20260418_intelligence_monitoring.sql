-- Phase 4: Investor-intelligence monitoring + feature-flag cohort telemetry
-- Safe to re-run (idempotent).
--
-- Scope:
--   monitoring_logs       — anomaly / variance / reconciliation events emitted
--                           by the financial-kernel orchestrator (TS) and the
--                           Python investor-package service. Durable evidence
--                           that we can answer "what happened on deal X at time T?"
--   feature_flag_cohorts  — durable cohort record for DEBT_ENGINE_V2 rollout.
--                           Decisions (FNV-1a hash bucketing, kill-switch,
--                           explicit org-level override) are recorded so
--                           rollout changes are auditable and reversible.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'monitoring_severity') THEN
    CREATE TYPE monitoring_severity AS ENUM ('info', 'low', 'medium', 'high', 'critical');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS monitoring_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  source VARCHAR(64) NOT NULL,
  event VARCHAR(120) NOT NULL,
  severity monitoring_severity NOT NULL DEFAULT 'info',
  engine_version VARCHAR(32),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS monitoring_logs_org_idx       ON monitoring_logs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS monitoring_logs_deal_idx      ON monitoring_logs (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS monitoring_logs_severity_idx  ON monitoring_logs (severity, created_at DESC);
CREATE INDEX IF NOT EXISTS monitoring_logs_event_idx     ON monitoring_logs (event);
CREATE INDEX IF NOT EXISTS monitoring_logs_payload_gin   ON monitoring_logs USING GIN (payload);

CREATE TABLE IF NOT EXISTS feature_flag_cohorts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flag_key VARCHAR(80) NOT NULL,
  subject_kind VARCHAR(32) NOT NULL,
  subject_id VARCHAR(120) NOT NULL,
  cohort VARCHAR(32) NOT NULL,
  rollout_pct INTEGER NOT NULL DEFAULT 0,
  bucket INTEGER,
  kill_switch BOOLEAN NOT NULL DEFAULT FALSE,
  engine_version VARCHAR(32),
  reason VARCHAR(120),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (flag_key, subject_kind, subject_id)
);

CREATE INDEX IF NOT EXISTS feature_flag_cohorts_flag_idx    ON feature_flag_cohorts (flag_key, cohort);
CREATE INDEX IF NOT EXISTS feature_flag_cohorts_subject_idx ON feature_flag_cohorts (subject_kind, subject_id);

CREATE OR REPLACE FUNCTION feature_flag_cohorts_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS feature_flag_cohorts_touch_trg ON feature_flag_cohorts;
CREATE TRIGGER feature_flag_cohorts_touch_trg
  BEFORE UPDATE ON feature_flag_cohorts
  FOR EACH ROW EXECUTE FUNCTION feature_flag_cohorts_touch();

-- Snapshots of investor packages for golden reconciliation and auditability.
-- One row per (deal_id, engine_version, generated_at). `body` is the full
-- investor-package JSON the service returned.
CREATE TABLE IF NOT EXISTS investor_package_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  engine_version VARCHAR(32) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'ts',
  input_hash CHAR(64),
  body JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS investor_package_snapshots_deal_idx ON investor_package_snapshots (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS investor_package_snapshots_hash_idx ON investor_package_snapshots (input_hash);

ALTER TABLE monitoring_logs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag_cohorts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_package_snapshots   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS monitoring_logs_org_read      ON monitoring_logs;
DROP POLICY IF EXISTS monitoring_logs_org_write     ON monitoring_logs;
CREATE POLICY monitoring_logs_org_read ON monitoring_logs
  FOR SELECT USING (organization_id IS NULL OR organization_id = current_organization_id());
CREATE POLICY monitoring_logs_org_write ON monitoring_logs
  FOR INSERT WITH CHECK (organization_id IS NULL OR organization_id = current_organization_id());

DROP POLICY IF EXISTS feature_flag_cohorts_read  ON feature_flag_cohorts;
DROP POLICY IF EXISTS feature_flag_cohorts_write ON feature_flag_cohorts;
CREATE POLICY feature_flag_cohorts_read  ON feature_flag_cohorts FOR SELECT USING (TRUE);
CREATE POLICY feature_flag_cohorts_write ON feature_flag_cohorts FOR ALL USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS investor_package_snapshots_org_read  ON investor_package_snapshots;
DROP POLICY IF EXISTS investor_package_snapshots_org_write ON investor_package_snapshots;
CREATE POLICY investor_package_snapshots_org_read ON investor_package_snapshots
  FOR SELECT USING (organization_id IS NULL OR organization_id = current_organization_id());
CREATE POLICY investor_package_snapshots_org_write ON investor_package_snapshots
  FOR INSERT WITH CHECK (organization_id IS NULL OR organization_id = current_organization_id());

COMMENT ON TABLE monitoring_logs              IS 'Anomaly / variance / reconciliation events from the financial-kernel and Python intelligence service.';
COMMENT ON TABLE feature_flag_cohorts         IS 'DEBT_ENGINE_V2 cohort assignment per (flag, subject). Drives rollout + audit.';
COMMENT ON TABLE investor_package_snapshots   IS 'Full investor-package JSON snapshots for reconciliation and history.';
