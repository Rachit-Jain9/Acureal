-- ============================================================================
-- 20260624 — Make the deal-DELETE audit trail durable (CASCADE -> SET NULL)
-- ============================================================================
-- deal_audit_log.deal_id was `REFERENCES deals(id) ON DELETE CASCADE`, so the
-- 'deleted' audit row written when a deal is hard-deleted was itself annihilated
-- at commit — leaving ZERO durable record of the single most destructive action
-- in the product, violating the non-negotiable immutable-audit rule (CLAUDE.md).
--
-- Fix: deal_id becomes nullable and the FK switches to ON DELETE SET NULL. The
-- 'deleted' audit row now SURVIVES the deletion (deal_id -> NULL). It stays
-- fully meaningful: before_json holds the deal's name/stage, metadata holds the
-- original deleted_deal_id, organization_id stays set — so org-wide audit reads
-- show "deal '<name>' deleted by <user> at <ts>".
--
-- Idempotent, paste-safe in the Supabase SQL editor. No change to existing rows.
-- ============================================================================

BEGIN;

ALTER TABLE deal_audit_log ALTER COLUMN deal_id DROP NOT NULL;
ALTER TABLE deal_audit_log DROP CONSTRAINT IF EXISTS deal_audit_log_deal_id_fkey;
ALTER TABLE deal_audit_log
  ADD CONSTRAINT deal_audit_log_deal_id_fkey
  FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL;

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='public.deal_audit_log'::regclass
--      AND conname='deal_audit_log_deal_id_fkey';
--   -- expect: FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL
-- ============================================================================
