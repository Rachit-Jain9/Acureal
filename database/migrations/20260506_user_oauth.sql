-- ============================================================================
-- 0043 — Federated identity binding on users (oauth_provider + oauth_subject)
-- ============================================================================
-- Phase 2 next-up: one-click Google sign-in via raw OIDC (no Supabase Auth
-- dependency). This migration adds the columns that bind a REDIP user row to
-- a stable federated identity claim — the (provider, subject) tuple is the
-- identity, not the email (emails change; subjects do not).
--
-- Why these columns and no separate `user_oauth_identities` table:
--   - REDIP supports one identity per user today. A separate table buys
--     "multiple linked identities per user" — speculative and unused. If a
--     real need emerges (e.g., user wants Google + Microsoft on same account)
--     we promote to a child table then.
--   - Inline columns keep login lookup a single-row fetch.
--
-- Account-linking policy (enforced in auth.service.js):
--   - (provider, subject) match → that user, no email check needed.
--   - email match AND existing user has NULL oauth_provider → bind on first
--     sign-in. Safe because Google's `email_verified=true` claim guarantees
--     the OAuth user controls the email, AND the existing account proved
--     control of the email at signup (or via /verify-email).
--   - email match AND existing user has a different oauth_provider → reject
--     ("Email already registered with a different sign-in method").
--   - No match → cold-signup gate applies (ALLOW_COLD_SIGNUP or invitation).
-- ============================================================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS oauth_provider TEXT,
  ADD COLUMN IF NOT EXISTS oauth_subject  TEXT;

-- Partial unique index: allows many users with NULL provider/subject (the
-- password-only majority today), but enforces one-row-per-(provider, subject)
-- federated identity.
CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_provider_subject_uidx
  ON public.users (oauth_provider, oauth_subject)
  WHERE oauth_provider IS NOT NULL AND oauth_subject IS NOT NULL;

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'users'
--      AND column_name IN ('oauth_provider', 'oauth_subject');
--     -- expect: 2 rows
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'users'
--      AND indexname = 'users_oauth_provider_subject_uidx';
--     -- expect: 1 row
