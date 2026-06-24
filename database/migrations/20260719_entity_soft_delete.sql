-- ============================================================================
-- 20260719 — Soft-delete substrate for deal child entities
-- ============================================================================
-- Adds deleted_at + deleted_by to the four entities that hard-delete today
-- (risk_flags, approval_items, dd_items, documents). User deletes become
-- soft-deletes (deleted_at = NOW()); a daily purge cron hard-deletes rows
-- older than 15 days. Documents keep their stored bytes until purge.
--
-- This is the immutable-audit-trail prerequisite (CLAUDE.md): a delete must
-- leave a record. Soft-delete keeps the row (hidden from every read path) so
-- the deal_audit_log "*_deleted" event can point at real before-state, and so
-- an accidental delete is recoverable for 15 days.
--
-- Partial indexes (WHERE deleted_at IS NULL) keep the hot read path — the
-- "live rows for a deal" lookups — as fast as before the column existed.
-- A second partial index (WHERE deleted_at IS NOT NULL) keeps the daily
-- purge sweep cheap (it only scans tombstones).
--
-- Idempotent + paste-safe in the Supabase SQL editor. Additive only: existing
-- rows get deleted_at = NULL (i.e. live), so no read path changes behaviour
-- until the application code starts filtering.
--
-- Note: deals already use is_archived for a DIFFERENT concept (live archive,
-- not delete) — left untouched. deal_audit_log / deal_events are append-only
-- and are NEVER soft-deleted. document_extractions cascades on document purge
-- (FK ON DELETE CASCADE), so it needs no column of its own.
-- ============================================================================

BEGIN;

-- ── risk_flags ──────────────────────────────────────────────────────────────
ALTER TABLE risk_flags ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE risk_flags ADD COLUMN IF NOT EXISTS deleted_by UUID
  REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS risk_flags_deal_live_idx
  ON risk_flags (deal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS risk_flags_tombstone_idx
  ON risk_flags (deleted_at) WHERE deleted_at IS NOT NULL;

-- ── approval_items ──────────────────────────────────────────────────────────
ALTER TABLE approval_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE approval_items ADD COLUMN IF NOT EXISTS deleted_by UUID
  REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS approval_items_deal_live_idx
  ON approval_items (deal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS approval_items_tombstone_idx
  ON approval_items (deleted_at) WHERE deleted_at IS NOT NULL;

-- ── dd_items ────────────────────────────────────────────────────────────────
ALTER TABLE dd_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE dd_items ADD COLUMN IF NOT EXISTS deleted_by UUID
  REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS dd_items_deal_live_idx
  ON dd_items (deal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS dd_items_tombstone_idx
  ON dd_items (deleted_at) WHERE deleted_at IS NOT NULL;

-- ── documents ───────────────────────────────────────────────────────────────
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_by UUID
  REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS documents_deal_live_idx
  ON documents (deal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_tombstone_idx
  ON documents (deleted_at) WHERE deleted_at IS NOT NULL;

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE column_name IN ('deleted_at','deleted_by')
--      AND table_name IN ('risk_flags','approval_items','dd_items','documents')
--    ORDER BY table_name, column_name;
--   -- expect 8 rows (deleted_at + deleted_by x 4 tables)
-- ============================================================================
