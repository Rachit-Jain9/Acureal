-- ============================================================================
-- 0044 — users.password_set boolean — distinguish "real password" from
--        "OAuth-only random unusable bcrypt"
-- ============================================================================
-- PR #139 introduced Google sign-in. Cold-signup via Google generates a
-- 64-byte random bcrypt that the user cannot possibly know — by design,
-- to keep one auth factor per account simple to reason about. The side
-- effect is that an OAuth-only user is locked out if Google ever revokes
-- their account or they delete the linked Google identity.
--
-- This column lets the app detect that state and surface a "Set a password"
-- card in the user's profile, gated by the existing authenticated session
-- (which itself was issued via Google sign-in, so re-verification is
-- redundant — the JWT is already proof-of-possession).
--
-- Default TRUE so every existing user (all of whom signed up with a real
-- password) is unaffected. Going forward, the OAuth cold-signup INSERT
-- in auth.service.js sets this to FALSE explicitly.
--
-- Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS password_set BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'users'
--      AND column_name = 'password_set';
--   -- expect: 1 row, boolean, true
