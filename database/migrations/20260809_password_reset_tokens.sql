-- ============================================================================
-- 20260809 — Password reset tokens
-- ============================================================================
-- Until now the product had NO password recovery of any kind: no reset flow,
-- no forgot-password route, nothing (confirmed repo-wide 2026-08-05 during the
-- operator-identity rename — it was the single genuine blocker in that plan).
-- A user who forgets their password and cannot use Google sign-in has no
-- product path back into their account; only direct database surgery.
--
-- This table backs the new forgot-password / reset-password flow. It is a
-- deliberate clone of email_verification_tokens (20260505) — the same
-- security-reviewed token model:
--
--   • Random 32-byte token; we store ONLY the SHA-256 hash, never the raw
--     token. The raw token is delivered once via the reset email.
--   • One active token per user; new requests supersede prior unconsumed
--     tokens (consumed_at = NOW(), consumed_by = 'superseded').
--   • Short expiry (60 minutes — a service constant; credential-bearing links
--     get a tighter window than the 24h verification links).
--   • One-shot: consumed_at is set on successful reset (consumed_by='reset').
--
-- Post-flip additions the 20260505 sibling lacked (it predates the M1 RLS
-- flip; its own policy arrived later in 20260731):
--   • ENABLE + FORCE ROW LEVEL SECURITY with a permissive service_access
--     policy. The table is not org-scoped and is touched pre-authentication;
--     the narrow application query (per-hash WHERE) stays the boundary —
--     the exact posture of the five system tables in 20260731.
--   • Explicit grants to redip_app, role-guarded like the definer grants in
--     20260801/20260802. New tables do NOT inherit grants (the Phase-3 grant
--     block was a point-in-time snapshot); without these, every token INSERT
--     is silently denied in production while owner-role tests pass — the
--     geocode_cache lesson (20260807). DELETE is included for the retention
--     sweep. No grants to anon/authenticated (PostgREST exposure stays closed
--     per 20260805).
--
-- Idempotent; safe to re-run. Operator-applied (migration applier or SQL
-- editor paste) — the application code ships fail-open ahead of it.

BEGIN;

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
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

CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_token_hash_idx
  ON public.password_reset_tokens (token_hash);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_active_idx
  ON public.password_reset_tokens (user_id)
  WHERE consumed_at IS NULL;

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS password_reset_tokens_service_access ON public.password_reset_tokens;
CREATE POLICY password_reset_tokens_service_access
  ON public.password_reset_tokens FOR ALL USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'redip_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.password_reset_tokens TO redip_app;
    GRANT USAGE, SELECT ON SEQUENCE public.password_reset_tokens_id_seq TO redip_app;
  END IF;
END $$;

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT to_regclass('public.password_reset_tokens');
--     -- expect: password_reset_tokens
--   SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--    WHERE oid = 'public.password_reset_tokens'::regclass;
--     -- expect: t | t
--   SELECT polname FROM pg_policy
--    WHERE polrelid = 'public.password_reset_tokens'::regclass;
--     -- expect: password_reset_tokens_service_access
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'password_reset_tokens' AND grantee = 'redip_app';
--     -- expect: SELECT, INSERT, UPDATE, DELETE (when the role exists)
