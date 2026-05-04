-- ============================================================================
-- 0047 — Account closure + scheduled erasure
-- ============================================================================
-- DPDP Act 2023 §8(7) requires personal data to be erased once the purpose
-- is fulfilled or consent is withdrawn. Privacy Policy §7 commits to:
--   • Closed accounts: 90 days for billing reconciliation, then deleted
--   • Active accounts: lifetime
-- Until this migration, the platform had no mechanism to mark an account
-- as closed and no cron to erase past-window closures. This change closes
-- that prose-vs-policy gap.
--
-- Two columns on users:
--   • account_closed_at  — when the user requested closure. Login blocked
--     immediately when set. Invalidates all refresh tokens (cascaded by
--     existing FK).
--   • erased_at          — when the retention sweep anonymized the user's
--     PII. Once set, the row stays as a tombstone (so historical FKs from
--     deals / events / ai_call_logs still resolve), but email / name /
--     phone are wiped.
--
-- Erasure mechanic (see services/accountClosure.service.js):
--   Pseudonymization rather than DELETE. UPDATE the row to scrub PII while
--   keeping its primary key. Preserves referential integrity in deals,
--   events, audit logs without ON DELETE CASCADE bombs across the schema.
--   This is the standard GDPR / DPDP-aligned approach for a multi-tenant
--   SaaS that owns evidentiary records.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
-- ============================================================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS account_closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS erased_at         TIMESTAMPTZ;

-- Sweep predicate: rows past their 90-day grace window, not yet erased.
-- Partial index keeps the cron scan O(closed-accounts) regardless of total
-- user count.
CREATE INDEX IF NOT EXISTS users_account_closed_at_pending_erasure_idx
  ON public.users (account_closed_at)
  WHERE account_closed_at IS NOT NULL AND erased_at IS NULL;

COMMENT ON COLUMN public.users.account_closed_at IS 'Set when the user requests account closure. Login is blocked immediately. Retention sweep erases PII 90 days later.';
COMMENT ON COLUMN public.users.erased_at IS 'Set by the retention sweep when PII has been anonymized (email, name, phone scrubbed). Row stays for FK integrity.';

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'users'
--      AND column_name IN ('account_closed_at', 'erased_at');
--     -- expect: 2 rows
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND indexname = 'users_account_closed_at_pending_erasure_idx';
--     -- expect: 1 row
