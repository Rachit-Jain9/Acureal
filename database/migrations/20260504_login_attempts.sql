-- ============================================================================
-- 0041 — Per-account login throttle (sliding window + temporary lockout)
-- ============================================================================
-- The existing express-rate-limit middleware caps /api/auth requests at 20
-- per 15 minutes per IP, but that does not stop a distributed brute-force
-- where the attacker rotates source IPs against a single account.
--
-- This table tracks failed login attempts per email (lowercased) and
-- temporarily locks the account after the threshold is crossed. The lookup
-- is keyed on email — not user_id — so unknown emails are also throttled,
-- which prevents leaking account existence by lockout state.
--
-- Application-layer policy (enforced in auth.service.js):
--   • 5 failures in a 15-minute sliding window → lock for 15 minutes
--   • Window resets when the last failure is older than 15 minutes
--   • Successful login clears the row
--
-- The table is a thin operational record; it is safe to truncate at any
-- time (worst case: a transient attacker gets 5 free attempts again).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.login_attempts (
  email           TEXT PRIMARY KEY,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  last_failed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS login_attempts_locked_until_idx
  ON public.login_attempts (locked_until)
  WHERE locked_until IS NOT NULL;

-- No RLS: this table is server-only (postgres role / service role).
-- It is never read or written directly from the client.

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT to_regclass('public.login_attempts');     -- expect: login_attempts
--   SELECT COUNT(*) FROM public.login_attempts;       -- expect: 0
