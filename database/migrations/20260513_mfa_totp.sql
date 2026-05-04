-- ============================================================================
-- 0049 — MFA / TOTP (Phase 2 hardening)
-- ============================================================================
-- Required before paying customers per `~/.claude/plans/...` Phase 2.
-- TOTP via RFC 6238 (otplib). Authenticator-app workflow:
--
--   1. User opens Settings → Security → Enable two-factor.
--   2. Backend generates a base32 secret + otpauth:// URL → returns QR.
--   3. User scans with Google Authenticator / Authy / 1Password.
--   4. User submits a 6-digit code. Backend verifies against the secret
--      and only THEN sets mfa_enrolled_at — until that moment the secret
--      is stored but inert.
--   5. Backend returns 8 single-use recovery codes (hashed at rest).
--
-- On every subsequent login:
--   1. Password / OAuth succeeds → if user.mfa_enrolled_at IS NOT NULL,
--      the auth.service issues an mfa_challenge (5-min TTL) instead of
--      issuing tokens.
--   2. Frontend prompts for the 6-digit code.
--   3. POST /auth/mfa/verify { challenge, code } → if valid, the normal
--      access + refresh cookies are minted.
--
-- mfa_recovery_codes are sha256-hashed when stored (treat like passwords).
-- A redeemed code is removed from the array — single-use.
-- ============================================================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS mfa_secret           TEXT,
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mfa_recovery_codes   TEXT[],
  ADD COLUMN IF NOT EXISTS mfa_last_used_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_mfa_enrolled_idx
  ON public.users (id)
  WHERE mfa_enrolled_at IS NOT NULL;

COMMENT ON COLUMN public.users.mfa_secret IS 'Base32 TOTP shared secret. NULL when MFA not enrolled.';
COMMENT ON COLUMN public.users.mfa_enrolled_at IS 'When the user successfully verified their authenticator app and MFA became enforced. NULL = enrollment incomplete or never attempted.';
COMMENT ON COLUMN public.users.mfa_recovery_codes IS 'Hashed (sha256) one-time recovery codes for lost-device fallback. 8 codes per enrollment, single-use.';

CREATE TABLE IF NOT EXISTS public.mfa_challenges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  challenge    TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mfa_challenges_user_active_idx
  ON public.mfa_challenges (user_id)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS mfa_challenges_expires_at_idx
  ON public.mfa_challenges (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE public.mfa_challenges ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.mfa_challenges IS 'Short-lived (5-min) ticket issued after password success, redeemed when the user supplies a valid TOTP code.';

COMMIT;
