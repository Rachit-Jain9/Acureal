-- PR-NX69 (2026-05-19) — AI augment per-user usage quota for BETA stage.
--
-- BETA rule from operator: every user gets ONE free AI-augmented underwriting
-- report. Admins (role='admin' OR role='owner') get unlimited.
--
-- This migration adds two columns to the existing `users` table:
--   - ai_augment_reports_used  INTEGER NOT NULL DEFAULT 0
--       Monotonically-increasing counter. Incremented inside
--       getDealExportContext() each time the augment layer actually produces
--       at least one available:true narrative envelope. If Claude is down and
--       no envelopes succeeded, NOT incremented (no quota burned on outages).
--   - ai_augment_last_used_at  TIMESTAMP WITH TIME ZONE
--       Last successful augment timestamp. Used by the admin "ai-augment usage"
--       view to surface the per-user usage list.
--
-- Why columns on `users` (vs. a new ai_augment_usage table):
--   - The BETA-stage rule is one counter + one timestamp — fits on the row.
--   - Reads happen on EVERY export request (entitlement check is hot path).
--     A column on `users` is a primary-key fetch we already do; a separate
--     table would be a second round-trip.
--   - When pricing graduates beyond simple counter (e.g. monthly resets,
--     per-org pools, credits) we'll graduate to a dedicated table. For BETA
--     this is enough.
--
-- Safe to re-run (idempotent).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ai_augment_reports_used INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ai_augment_last_used_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN users.ai_augment_reports_used IS
  'PR-NX69: count of AI-augmented underwriting reports this user has consumed during BETA. BETA limit = 1; admins exempt. Incremented in getDealExportContext() only when the augment layer produces at least one available:true narrative.';

COMMENT ON COLUMN users.ai_augment_last_used_at IS
  'PR-NX69: timestamp of last successful AI augment call for this user. Null for users who have not used the feature yet.';

-- Backfill: any existing row already has 0 by DEFAULT, but be explicit so
-- a NULL-handling bug downstream surfaces immediately instead of silently
-- treating NULL as 'never used'.
UPDATE users
SET ai_augment_reports_used = 0
WHERE ai_augment_reports_used IS NULL;
