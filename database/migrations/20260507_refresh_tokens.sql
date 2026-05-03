-- ============================================================================
-- 0044 — Refresh-token grants with rotation + family revocation
-- ============================================================================
-- Phase 2 hardening: pair short-lived (15 min) access JWTs with long-lived
-- (30 day) refresh tokens that ROTATE on every use. The rotation pattern
-- shrinks the "stolen token" window from 7 days (current behaviour) to
-- effectively 0 — when a stolen refresh token is used, the original holder's
-- next refresh fails, the entire family is revoked, and the legitimate user
-- is forced to re-authenticate. This is the OAuth 2.0 "refresh token reuse
-- detection" pattern (Auth0 / Okta).
--
-- Token model:
--   • Random 32-byte token; only SHA-256 hash is stored. Raw token is
--     delivered exactly once via httpOnly cookie.
--   • Each grant belongs to a `family_id`. A login issues a fresh family;
--     a refresh issues a new grant inside the same family and revokes
--     (`replaced_by`) the old grant.
--   • If a presented refresh token is already revoked: that's the
--     "reuse detected" signal — revoke EVERY grant in the family. The
--     legitimate user is logged out and must sign in again.
--   • Expired grants are kept for forensic purposes (90-day TTL is a
--     separate cleanup cron); they cannot be redeemed.
--
-- Why family instead of per-token revocation:
--   - Stolen-then-rotated detection. If attacker rotates first, the
--     legitimate user's next rotate uses an already-revoked token —
--     family kill catches it.
--   - Logout = revoke whole family in one UPDATE.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.refresh_token_grants (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  family_id    UUID NOT NULL,
  token_hash   TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  -- 'rotated': consumed by a successful rotate; 'reuse': caught replaying a
  -- prior token, family killed; 'logout': explicit logout; 'security': admin
  -- forced revoke (deactivation, password change, etc.)
  revoked_reason TEXT,
  -- For rotation: the grant id that replaced this one. NULL on the live
  -- grant. Used for forensics — walk the chain back to the original login.
  replaced_by  BIGINT REFERENCES public.refresh_token_grants(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address   INET,
  user_agent   TEXT
);

-- Lookup keyed on the token hash (refresh endpoint reads exactly one row).
CREATE UNIQUE INDEX IF NOT EXISTS refresh_token_grants_token_hash_idx
  ON public.refresh_token_grants (token_hash);

-- Family revocation: SELECT all grants in a family in one shot.
CREATE INDEX IF NOT EXISTS refresh_token_grants_family_idx
  ON public.refresh_token_grants (family_id);

-- Per-user logout / security events: revoke everything for a user.
CREATE INDEX IF NOT EXISTS refresh_token_grants_user_active_idx
  ON public.refresh_token_grants (user_id)
  WHERE revoked_at IS NULL;

-- Expiry sweep — a future cron deletes rows past expires_at + 90 days.
CREATE INDEX IF NOT EXISTS refresh_token_grants_expires_idx
  ON public.refresh_token_grants (expires_at);

-- No RLS: this table is server-only. The service role / postgres role is
-- the only writer. Refresh tokens never touch the SPA.

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT to_regclass('public.refresh_token_grants');
--     -- expect: refresh_token_grants
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'refresh_token_grants'
--    ORDER BY indexname;
--     -- expect: 4 indexes (pkey + 3 declared above + unique idx)
