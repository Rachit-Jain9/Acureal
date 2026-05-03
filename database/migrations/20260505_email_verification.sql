-- ============================================================================
-- 0042 — Email verification tokens + users.email_verified_at
-- ============================================================================
-- Phase 2 hardening: prove the email on file is real before we trust it for
-- grievance contact (DPDP §8(9) / IT Rules 3(11)), password reset, or any
-- multi-tenant invitation flow. Without this, anyone can register with an
-- email they don't control.
--
-- This migration is non-blocking: existing users get NULL in
-- email_verified_at, and the application layer treats NULL as "unverified
-- but grandfathered" until we explicitly require verification for sensitive
-- actions (separate enforcement PR).
--
-- Token model:
--   • Random 32-byte token; we store ONLY the SHA-256 hash, never the raw
--     token. The raw token is delivered once via the verification email.
--   • One active token per user; new requests revoke prior unconsumed tokens
--     by setting consumed_at = NOW() with consumed_by = 'superseded'.
--   • 24-hour expiry (configurable via app constant).
--   • One-shot: consumed_at is set on successful verification.
-- ============================================================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.email_verification_tokens (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  consumed_by  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address   INET,
  user_agent   TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS email_verification_tokens_token_hash_idx
  ON public.email_verification_tokens (token_hash);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_active_idx
  ON public.email_verification_tokens (user_id)
  WHERE consumed_at IS NULL;

-- No RLS: this table is server-only (postgres role / service role).
-- It is never read or written directly from the client.

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT to_regclass('public.email_verification_tokens');
--     -- expect: email_verification_tokens
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'users'
--      AND column_name = 'email_verified_at';
--     -- expect: 1 row
