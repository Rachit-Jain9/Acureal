-- REDIP investor-grade audit: generic mutation log for deal lifecycle events
--
-- Complements `deal_events` (HMAC-signed financial computations) with the
-- non-financial audit trail every IC review needs: stage transitions,
-- archive / restore, reassignments, deletions, bulk operations, and any
-- material updateDeal() write. The two tables together produce one
-- chronological "what changed on this deal, when, by whom" timeline that
-- the AuditTab merges and renders.
--
-- Why a separate table (vs. extending deal_events):
--   - deal_events has NOT NULL inputs_hash / outputs_hash / signature /
--     inputs_json / outputs_json columns that only make sense for kernel
--     computations. Stuffing fake values for "stage_changed" would defeat
--     the cryptographic guarantees of that table.
--   - This table is unsigned (no HMAC). Stage transitions don't need
--     replay-from-inputs verification — they need a clear before / after
--     diff and an actor stamp.
--   - Append-only via RLS, same as deal_events. No UPDATE / DELETE policy.
--
-- Safe to re-run (idempotent).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS deal_audit_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Scope. organization_id mirrors deal_events for org-scoped RLS.
  deal_id         UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id        UUID REFERENCES users(id) ON DELETE SET NULL,

  -- What happened. Free-form string at the DB layer; the service
  -- enforces a known set (see dealAuditLog.service.js SUPPORTED_EVENT_TYPES).
  event_type      VARCHAR(64) NOT NULL,
    -- e.g. 'stage_changed', 'archived', 'restored', 'deleted',
    --      'reassigned', 'updated', 'bulk_archived',
    --      'bulk_reassigned', 'bulk_stage_changed', 'bulk_deleted'

  -- Before / after diffs. JSON so the shape can vary by event_type.
  -- For stage_changed:   before = { stage }, after = { stage, notes }
  -- For archived:        before = { is_archived: false }, after = { is_archived: true, archived_reason }
  -- For reassigned:      before = { assigned_to }, after = { assigned_to }
  -- For updated:         before / after of any changed top-level fields
  before_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_json      JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Free-form supplemental context. For bulk events this carries the
  -- batch id + total count so analyst can pivot on "all deals moved
  -- in this single bulk action". For single-row events it can carry
  -- HTTP path, request id, etc.
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deal_audit_log_deal_created_idx
  ON deal_audit_log (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS deal_audit_log_org_created_idx
  ON deal_audit_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS deal_audit_log_event_type_idx
  ON deal_audit_log (event_type);
CREATE INDEX IF NOT EXISTS deal_audit_log_actor_idx
  ON deal_audit_log (actor_id);

-- Default the org via the same helper schema.sql §560 uses everywhere
-- else. INSERTs that omit organization_id (the audit service path) get
-- the caller's current org; the RLS WITH CHECK then validates the row.
ALTER TABLE deal_audit_log
  ALTER COLUMN organization_id SET DEFAULT current_organization_id();

-- Row-level security: read + insert scoped to the caller's organization.
-- No UPDATE / DELETE policy is created, which makes the table append-only
-- under non-superuser credentials (the intended audit posture).
ALTER TABLE deal_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_audit_log_org_read  ON deal_audit_log;
DROP POLICY IF EXISTS deal_audit_log_org_write ON deal_audit_log;

CREATE POLICY deal_audit_log_org_read ON deal_audit_log
  FOR SELECT USING (organization_id = current_organization_id());

CREATE POLICY deal_audit_log_org_write ON deal_audit_log
  FOR INSERT WITH CHECK (organization_id = current_organization_id());

COMMENT ON TABLE deal_audit_log IS
  'Append-only mutation audit log for deal lifecycle events: stage transitions, '
  'archive/restore, reassignments, deletions, bulk ops. Complements deal_events '
  '(financial computations). Together they produce the deal AuditTab timeline.';
COMMENT ON COLUMN deal_audit_log.event_type IS
  'One of: stage_changed | archived | restored | deleted | reassigned | updated | '
  'bulk_archived | bulk_reassigned | bulk_stage_changed | bulk_deleted. Service '
  'layer enforces. Strings (not enum) so future event types do not require a '
  'second migration.';
COMMENT ON COLUMN deal_audit_log.before_json IS
  'Snapshot of relevant deal fields BEFORE the mutation. Shape varies by event_type.';
COMMENT ON COLUMN deal_audit_log.after_json IS
  'Snapshot of relevant deal fields AFTER the mutation. Shape varies by event_type.';
