-- database/migrations/20260808_auth_oauth_definer_closure_columns.sql
-- Adds account_closed_at + erased_at to auth_find_user_by_oauth's projection.
--
-- WHY: closure/erasure must terminate access on EVERY sign-in path, not just
-- password login. auth_find_user_for_login has returned both columns since
-- 20260801 (login reads them), but auth_find_user_by_oauth — the Google
-- returning-user lookup, Path A — never did. Under the post-M1 definer routing
-- that left the Google branch structurally unable to see closure state: the
-- columns were not merely unchecked in JS, they were not fetched at all.
--
-- The application-level gate (utils/accountState.js, enforced in
-- hydrateUserAuthContext) already refuses these accounts with or without this
-- migration — hydrate reads `users` directly. This migration exists so the
-- EARLY check in loginOrRegisterWithGoogle Path A is a real check on the
-- definer route rather than a no-op against undefined columns, i.e. so the
-- refusal happens before the last_login_at write rather than after it.
--
-- Return type changes, so CREATE OR REPLACE is not an option — Postgres
-- requires a DROP to alter a RETURNS TABLE signature. DROP resets the
-- function's ACL, so this file MUST restore the full privilege state
-- established by 20260801 / 20260802 / 20260805:
--   • REVOKE ALL FROM anon, authenticated, PUBLIC  (PostgREST exposure fix)
--   • GRANT EXECUTE TO redip_app                   (the non-BYPASSRLS app role)
--   • SET search_path = pg_catalog, public, pg_temp (20260802 hardening)
-- Dropping without restoring these would silently re-expose the function to
-- anyone holding the project's publishable (anon) key. That is the single
-- highest-risk line in this file; it is why the verification query at the
-- bottom asserts the ACL, not just the signature.
--
-- Idempotent + paste-safe. Apply as postgres (Supabase SQL editor) so the
-- function owner keeps BYPASSRLS — a SECURITY DEFINER owned by a non-bypass
-- role would defeat the whole bootstrap.

BEGIN;

DROP FUNCTION IF EXISTS public.auth_find_user_by_oauth(text, text);

-- Column list = findUserByOAuthIdentity's fallback SELECT, plus the two
-- closure columns. Still NEVER returns mfa_secret / mfa_recovery_codes —
-- the narrow-column red-team rule from 20260801 holds.
CREATE FUNCTION public.auth_find_user_by_oauth(p_provider text, p_subject text)
  RETURNS TABLE (
    id uuid, email text, name text, phone text, is_active boolean,
    default_organization_id uuid,
    account_closed_at timestamptz, erased_at timestamptz,
    oauth_provider text, oauth_subject text,
    email_verified_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT u.id, u.email::text, u.name::text, u.phone::text, u.is_active,
           u.default_organization_id,
           u.account_closed_at, u.erased_at,
           u.oauth_provider::text, u.oauth_subject::text,
           u.email_verified_at
      FROM public.users u
     WHERE u.oauth_provider = p_provider AND u.oauth_subject = p_subject
     LIMIT 1;
$$;

-- Restore the privilege state the DROP just cleared. Unconditional, and
-- ordered revoke-then-grant so there is no window where the new function is
-- reachable by anon.
REVOKE ALL ON FUNCTION public.auth_find_user_by_oauth(text, text) FROM anon, authenticated, PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'redip_app') THEN
    GRANT EXECUTE ON FUNCTION public.auth_find_user_by_oauth(text, text) TO redip_app;
  END IF;
END $$;

COMMIT;

-- Rollback: re-run the 20260802 definition of auth_find_user_by_oauth (the
-- nine-column form), then re-apply the REVOKE + conditional GRANT above.
--
-- Verification — signature carries the closure columns AND anon cannot execute:
--   SELECT pg_get_function_result(p.oid) AS returns,
--          has_function_privilege('anon', p.oid, 'EXECUTE')      AS anon_can_execute,
--          has_function_privilege('redip_app', p.oid, 'EXECUTE') AS app_can_execute
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'auth_find_user_by_oauth';
-- Expect: returns contains account_closed_at + erased_at,
--         anon_can_execute = false, app_can_execute = true.
