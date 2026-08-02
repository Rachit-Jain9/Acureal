-- 20260805_revoke_postgrest_exposure.sql
--
-- Closes the PostgREST parallel door.
--
-- THE DEFECT. Every prior security review reasoned about the boundary around
-- the Express API. Nobody inventoried the SECOND door into the same database:
-- Supabase's PostgREST Data API, which is live, internet-facing, and serves the
-- `public` schema. Supabase's default privileges grant the `anon` and
-- `authenticated` roles full CRUD on every table in `public` and EXECUTE on
-- every function in it — including the six auth SECURITY DEFINER helpers that
-- the M1 RLS rollout itself introduced in 20260801/20260802, and the two
-- platform-admin readers added in 20260804. The M1 flip made RLS the real
-- boundary for the app while leaving this parallel path wide open beside it.
--
-- MEASURED ON PRODUCTION 2026-08-02 (before this migration):
--   • GET https://<ref>.supabase.co/rest/v1/  -> 401 (needs a key), not 404.
--     The Data API is live.
--   • anon holds SELECT/INSERT/UPDATE/DELETE/TRUNCATE on 83 tables in `public`
--     and 14 in `regulatory_data` — including users, deals, documents,
--     financials, refresh_token_grants, mfa_challenges,
--     email_verification_tokens and login_attempts.
--   • anon can EXECUTE 11 SECURITY DEFINER functions (8 ours + 3 PostGIS).
--   • pg_default_acl shows `public:r => anon=arwdDxtm` and `public:f => anon=X`
--     — so EVERY FUTURE table and function re-acquires the grant automatically.
--     Revoking today without fixing the defaults would reopen on the next
--     CREATE TABLE.
--
-- WHAT THAT YIELDS to anyone holding the project's publishable (anon) key,
-- which Supabase's own model treats as safe to publish in a browser:
--   1. rpc/auth_find_user_for_login  -> any account's bcrypt password_hash.
--   2. rpc/auth_find_mfa_challenge   -> mfa_secret (the TOTP seed).
--   3. rpc/admin_list_signups        -> the full cross-workspace roster
--      (name/email/phone/company/city) — a DPDP-relevant disclosure.
--   4. rpc/auth_provision_signup     -> create users, workspaces, memberships
--      at will, bypassing rate limits, breached-password checks and email
--      verification.
--   5. SESSION FORGERY WITHOUT A PASSWORD. refresh_token_grants carries a
--      token_hash, anon holds INSERT, and its policy is
--      FOR ALL USING(true) WITH CHECK(true) TO public — so RLS does not filter
--      anon there. Insert a row with a victim's user_id and a token_hash you
--      chose, then POST /auth/refresh. (Established structurally from grants,
--      policies and column layout; deliberately never executed against prod.)
--   6. DELETE FROM login_attempts    -> no lockout -> unlimited brute force.
--
-- The key is not published by Acureal today (absent from frontend source, from
-- the built bundle, and from the repo), so this is latent rather than active.
-- It is one disclosure away from total compromise, and the fix is small.
--
-- WHAT THIS MIGRATION DOES NOT DO, deliberately:
--   • It does not revoke USAGE ON SCHEMA public FROM PUBLIC. The `public`
--     schema ACL carries a bare `=U/pg_database_owner` entry, so USAGE reaches
--     anon through PUBLIC and only a revoke from PUBLIC would remove it — a
--     much wider blast radius (every role without an explicit grant loses the
--     schema) for no marginal security here: without table, sequence or
--     function privileges, schema USAGE yields nothing and PostgREST returns
--     permission-denied on every object. `regulatory_data` has no PUBLIC entry,
--     so USAGE there IS revoked below and is fully effective.
--   • It does not touch the 3 PostGIS metadata relations (spatial_ref_sys,
--     geometry_columns, geography_columns) or the 3 st_estimatedextent
--     overloads. Those were granted by supabase_admin, not postgres, so this
--     session cannot revoke them; they are extension-owned, carry no tenant
--     data, and are the long-standing accepted advisor entries. The runtime
--     canary allowlists them explicitly so they never cause a recurring alert.
--   • It does not tighten the five permissive USING(true) policies on
--     ai_response_cache / email_verification_tokens / login_attempts /
--     mfa_challenges / refresh_token_grants. Once anon and authenticated hold
--     no privileges on those tables, the policies govern only redip_app, which
--     is the intended service path. User-scoping them stays queued separately.
--
-- SAFE FOR THE APPLICATION. redip_app holds its OWN grants (80 tables at
-- `arwd`, sequences at `rU`, explicit EXECUTE on the 8 definers plus the broad
-- public-schema EXECUTE snapshot from the Phase-3 grant block) and is never
-- named below. service_role and postgres are likewise untouched, so Supabase
-- Storage, the Studio, and every backend path keep working. Of the 97 granted
-- tables, 94 were granted by `postgres` and revoke cleanly in this session.
--
-- Idempotent and safe to re-paste. Wrapped in BEGIN/COMMIT (Supabase's SQL
-- editor auto-wraps anyway); no CONCURRENTLY.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EMERGENCY BREAK-GLASS ROLLBACK — RESTORES THE KNOWN VULNERABILITY.
-- Do NOT execute this to "undo a bad deploy". Rolling a security repair back by
-- restoring the hole is not a recovery strategy. If something breaks, the
-- recovery order is: (1) identify the specific consumer that lost access,
-- (2) grant it the one narrow privilege it needs, (3) redeploy that consumer,
-- (4) re-run the api_exposure canary. Execute the block below only when
-- production is unavailable AND the security trade-off has been explicitly
-- accepted by the operator.
--
--   GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated;
--   GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
--   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
--   GRANT USAGE ON SCHEMA regulatory_data TO anon, authenticated;
--   GRANT ALL ON ALL TABLES    IN SCHEMA regulatory_data TO anon, authenticated;
--   GRANT ALL ON ALL SEQUENCES IN SCHEMA regulatory_data TO anon, authenticated;
--   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA regulatory_data TO anon, authenticated;
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- (1) Existing object privileges — public
-- ────────────────────────────────────────────────────────────────────────────

REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- (2) Existing object privileges — regulatory_data (incl. schema USAGE, which
--     is effective here because this schema has no PUBLIC grant)
-- ────────────────────────────────────────────────────────────────────────────

REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA regulatory_data FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA regulatory_data FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA regulatory_data FROM anon, authenticated;
REVOKE USAGE ON SCHEMA regulatory_data FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- (3) The auth + platform-admin SECURITY DEFINER surface, named explicitly.
--     (1) already covers these; naming them is deliberate belt-and-braces so a
--     future reader sees the intent, and so a later GRANT to PUBLIC on one of
--     them does not silently survive a re-paste of this file. These functions
--     return password_hash, mfa_secret, and the cross-org signup roster, and
--     one of them provisions accounts — they must never be callable by an
--     unauthenticated PostgREST caller.
-- ────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.auth_find_user_for_login(text)          FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.auth_find_user_by_oauth(text, text)     FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.auth_find_mfa_challenge(text)           FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.auth_lookup_verified_domain(text[])     FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.auth_find_invitation(text)              FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.admin_signup_summary()                  FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_signups(text, integer)       FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.auth_provision_signup(
  text, text, text, text, text, text, text, boolean, boolean, text, text, text,
  text, text[], text, text, bigint[], inet, text
) FROM anon, authenticated, PUBLIC;

-- Re-assert the app role's access to the same eight. Step (1) revoked only from
-- anon/authenticated so redip_app was never affected — this is idempotent
-- insurance so a future edit of this file cannot lock the application out of
-- its own auth bootstrap. Guarded because the role does not exist in a fresh
-- local database built from schema.sql.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'redip_app') THEN
    GRANT EXECUTE ON FUNCTION public.auth_find_user_for_login(text)      TO redip_app;
    GRANT EXECUTE ON FUNCTION public.auth_find_user_by_oauth(text, text) TO redip_app;
    GRANT EXECUTE ON FUNCTION public.auth_find_mfa_challenge(text)       TO redip_app;
    GRANT EXECUTE ON FUNCTION public.auth_lookup_verified_domain(text[]) TO redip_app;
    GRANT EXECUTE ON FUNCTION public.auth_find_invitation(text)          TO redip_app;
    GRANT EXECUTE ON FUNCTION public.admin_signup_summary()              TO redip_app;
    GRANT EXECUTE ON FUNCTION public.admin_list_signups(text, integer)   TO redip_app;
    GRANT EXECUTE ON FUNCTION public.auth_provision_signup(
      text, text, text, text, text, text, text, boolean, boolean, text, text,
      text, text, text[], text, text, bigint[], inet, text
    ) TO redip_app;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- (4) Default privileges — the part that stops the door reopening.
--     Without this, the next CREATE TABLE in `public` hands anon full CRUD
--     again, because pg_default_acl still says so. Two grantors appear in
--     pg_default_acl for these schemas: `postgres` (ours) and `supabase_admin`
--     (Supabase's). We can only alter our own; the supabase_admin defaults are
--     attempted below and tolerated if this session lacks the membership.
-- ────────────────────────────────────────────────────────────────────────────

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA regulatory_data
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA regulatory_data
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA regulatory_data
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- Supabase-owned defaults. `postgres` is not guaranteed to be a member of
-- supabase_admin, and ALTER DEFAULT PRIVILEGES FOR ROLE <x> requires it. A
-- failure here is expected and non-fatal: the objects those defaults produce
-- are Supabase's own (PostGIS metadata et al), never Acureal tables, and the
-- hourly api_exposure canary reports any table that does acquire an anon grant.
DO $$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public '
       || 'REVOKE ALL ON TABLES FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public '
       || 'REVOKE ALL ON SEQUENCES FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public '
       || 'REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated';
EXCEPTION
  WHEN insufficient_privilege OR undefined_object THEN
    RAISE NOTICE 'supabase_admin default privileges left unchanged (no membership) — expected; the api_exposure canary covers any regression.';
END $$;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICATION — run after COMMIT.
--
-- Expected: 0, 0, 0, false, 80, 3 — and `unrevokable_default_grantors` listing
-- only `supabase_admin`.
--
-- AMENDED 2026-08-02 after the live apply (the DDL above is unchanged and is
-- what actually ran). Two columns were originally too broad and reported
-- alarming numbers for benign state:
--   • `app_functions_still_exposed` counted EVERY non-extension function, not
--     just SECURITY DEFINER ones. It read 10 — all ordinary SECURITY INVOKER
--     helpers (update_updated_at_column, current_user_id, sync_property_geom …)
--     reachable only through Postgres's DEFAULT `EXECUTE TO PUBLIC` grant on
--     new functions. Executing one as `anon` runs with anon's privileges, which
--     are now none. Only a DEFINER runs as its owner, so only a DEFINER is a
--     hole — the column now filters `p.prosecdef`.
--   • The default-privilege check ignored WHO owns each entry. `postgres`
--     cannot ALTER another role's defaults, so supabase_admin's survive by
--     design. Ours came out clean; the column now names grantors instead of
--     counting rows, so an entry we CAN fix is distinguishable from one we
--     cannot.
-- ────────────────────────────────────────────────────────────────────────────

SELECT
  (SELECT count(DISTINCT table_name) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
      AND table_name NOT IN ('spatial_ref_sys', 'geometry_columns', 'geography_columns')
  ) AS public_tables_still_exposed,
  (SELECT count(DISTINCT table_name) FROM information_schema.role_table_grants
    WHERE table_schema = 'regulatory_data' AND grantee IN ('anon', 'authenticated')
  ) AS regdata_tables_still_exposed,
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'regulatory_data')
      AND p.prosecdef
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) AS definers_still_exposed,
  has_function_privilege('anon', 'public.auth_find_user_for_login(text)', 'EXECUTE')
    AS anon_can_read_password_hashes,
  (SELECT count(DISTINCT table_name) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee = 'redip_app'
  ) AS app_tables_intact,
  (SELECT count(DISTINCT table_name) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
  ) AS postgis_metadata_tables_left,
  (SELECT COALESCE(string_agg(DISTINCT pg_get_userbyid(da.defaclrole), ', '), '(none)')
     FROM pg_default_acl da
     JOIN pg_namespace dn ON dn.oid = da.defaclnamespace
     CROSS JOIN LATERAL aclexplode(da.defaclacl) a
     JOIN pg_roles r ON r.oid = a.grantee
    WHERE dn.nspname IN ('public', 'regulatory_data')
      AND r.rolname IN ('anon', 'authenticated')
  ) AS unrevokable_default_grantors;
