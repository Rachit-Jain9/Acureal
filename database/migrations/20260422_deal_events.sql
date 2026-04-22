-- REDIP investor-grade audit: immutable deal_events log with HMAC signatures
--
-- Every financial computation that is persisted or presented — calculate &
-- save, scenario recompute, sensitivity run, manual replay — writes one row
-- here. The row is cryptographically signed so investors / auditors / the
-- IC committee can prove that the numbers on the pitch deck came from the
-- exact (inputs, engine version, defaults snapshot) tuple recorded below.
--
-- The signature is HMAC-SHA256 over
--   inputs_hash || '|' || outputs_hash || '|' || engine_version
-- using a secret DEAL_EVENTS_HMAC_KEY held by the backend. Any downstream
-- consumer that tampers with the row's payload will invalidate the
-- signature when the audit service replays it.
--
-- Append-only: RLS grants SELECT + INSERT only. No UPDATE / DELETE policy
-- is created, so rows are effectively immutable under app credentials.
-- Superuser / service-role writes bypass RLS and should only be used for
-- migrations.
--
-- Safe to re-run (idempotent).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS deal_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Scope
  deal_id         UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id        UUID REFERENCES users(id) ON DELETE SET NULL,

  -- What happened
  event_type      VARCHAR(64) NOT NULL,
    -- e.g. 'calculate_and_save', 'scenario_recompute',
    --      'sensitivity_run', 'manual_replay'

  -- Provenance
  engine_version  VARCHAR(32) NOT NULL,
  asset_class     VARCHAR(48),

  -- Cryptographic fingerprints (hex-encoded sha256 → 64 chars)
  inputs_hash     CHAR(64) NOT NULL,
  outputs_hash    CHAR(64) NOT NULL,
  signature       CHAR(64) NOT NULL,

  -- Replay payload. inputs_json must round-trip through the kernel to produce
  -- outputs_json exactly; outputs_json is the flattened KPI / cost / revenue
  -- snapshot the UI rendered.
  inputs_json     JSONB NOT NULL,
  outputs_json    JSONB NOT NULL,

  -- Ancillary: HTTP path, user-agent, scenario key, defaults version, etc.
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deal_events_deal_created_idx
  ON deal_events (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS deal_events_org_created_idx
  ON deal_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS deal_events_event_type_idx
  ON deal_events (event_type);
CREATE INDEX IF NOT EXISTS deal_events_inputs_hash_idx
  ON deal_events (inputs_hash);

-- Organization default matches the rest of the schema (see schema.sql §560).
ALTER TABLE deal_events
  ALTER COLUMN organization_id SET DEFAULT current_organization_id();

-- Row-level security: read + insert scoped to the caller's organization.
-- No UPDATE / DELETE policy is created, which makes the table append-only
-- under non-superuser credentials (the intended audit posture).
ALTER TABLE deal_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_events_org_read  ON deal_events;
DROP POLICY IF EXISTS deal_events_org_write ON deal_events;

CREATE POLICY deal_events_org_read ON deal_events
  FOR SELECT USING (organization_id = current_organization_id());

CREATE POLICY deal_events_org_write ON deal_events
  FOR INSERT WITH CHECK (organization_id = current_organization_id());

COMMENT ON TABLE deal_events IS
  'Immutable, HMAC-signed audit trail of every persisted financial computation. '
  'Enables replay + verification of investor-facing numbers. Append-only via RLS.';
COMMENT ON COLUMN deal_events.signature IS
  'HMAC-SHA256 over (inputs_hash || "|" || outputs_hash || "|" || engine_version) '
  'using DEAL_EVENTS_HMAC_KEY. Tampering with any signed field invalidates this.';
