-- Phase 4 + 5: Investor intelligence tables
-- investor_packages         — latest projection per deal (frontend read)
-- investor_package_snapshots — append-only history (reconciliation)
-- monitoring_logs            — anomaly / variance / reconciliation events
-- feature_flag_cohorts       — durable rollout decision log
-- All idempotent; safe to re-run. RLS scoped to current_organization_id().

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'monitoring_severity') THEN
    CREATE TYPE monitoring_severity AS ENUM ('info', 'low', 'medium', 'high', 'critical');
  END IF;
END $$;

-- Append-only event log.
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

-- Feature flag cohort log.
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

-- Append-only history (reconciliation).
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

-- Latest-per-deal projection (frontend read path).
CREATE TABLE IF NOT EXISTS investor_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  engine_version VARCHAR(32) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'python',
  headline TEXT,
  narrative TEXT,
  irr_levered_pct NUMERIC(10, 6),
  min_dscr NUMERIC(10, 6),
  moic NUMERIC(10, 6),
  llcr NUMERIC(10, 6),
  peak_equity_cr NUMERIC(18, 6),
  peak_debt_cr NUMERIC(18, 6),
  residual_total_cr NUMERIC(18, 6),
  breach_count INTEGER DEFAULT 0,
  insights_count INTEGER DEFAULT 0,
  body JSONB NOT NULL,
  input_hash CHAR(64),
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (deal_id)
);

CREATE INDEX IF NOT EXISTS investor_packages_org_idx    ON investor_packages (organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS investor_packages_engine_idx ON investor_packages (engine_version);
CREATE INDEX IF NOT EXISTS investor_packages_hash_idx   ON investor_packages (input_hash);

CREATE OR REPLACE FUNCTION investor_packages_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS investor_packages_touch_trg ON investor_packages;
CREATE TRIGGER investor_packages_touch_trg
  BEFORE UPDATE ON investor_packages
  FOR EACH ROW EXECUTE FUNCTION investor_packages_touch();

ALTER TABLE monitoring_logs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag_cohorts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_package_snapshots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_packages            ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS investor_packages_org_read  ON investor_packages;
DROP POLICY IF EXISTS investor_packages_org_write ON investor_packages;
CREATE POLICY investor_packages_org_read ON investor_packages
  FOR SELECT USING (organization_id IS NULL OR organization_id = current_organization_id());
CREATE POLICY investor_packages_org_write ON investor_packages
  FOR ALL USING (organization_id IS NULL OR organization_id = current_organization_id())
  WITH CHECK (organization_id IS NULL OR organization_id = current_organization_id());

COMMENT ON TABLE monitoring_logs              IS 'Anomaly / variance / reconciliation events from the financial-kernel and Python intelligence service.';
COMMENT ON TABLE feature_flag_cohorts         IS 'DEBT_ENGINE_V2 cohort assignment per (flag, subject). Drives rollout + audit.';
COMMENT ON TABLE investor_package_snapshots   IS 'Full investor-package JSON snapshots for reconciliation and history.';
COMMENT ON TABLE investor_packages            IS 'Latest investor-package projection per deal. Rendered directly by frontend dashboards.';
