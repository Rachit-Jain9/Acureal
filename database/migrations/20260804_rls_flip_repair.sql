-- 20260804_rls_flip_repair.sql
--
-- Repairs everything the 2026-07-28 redip_app flip broke that the production
-- error log surfaced in the 2026-08-01 sweep. Four independent fixes, all
-- idempotent, all safe to re-paste. Requires 20260803 (is_platform_admin)
-- which is verified LIVE in production as of 2026-08-01.
--
-- (1) THE PHANTOM GUC FAMILY. Three May-era migrations (20260508, 20260525,
--     20260526) wrote policies against current_setting('redip.organization_id')
--     — a settings namespace NOTHING in the application has ever written. The
--     app's canonical tenant context is app.current_organization_id, read via
--     public.current_organization_id(). Under the pre-flip BYPASSRLS role the
--     mismatch was invisible; since the flip those tables deny every read AND
--     every write:
--       • residential_segmented_benchmarks / niche_asset_class_benchmarks —
--         the Intelligence page's benchmark panels silently render empty
--         (reads filter to the platform org's shared rows, which the broken
--         policy hides).
--       • ab_eval_runs / ab_eval_results — the A/B eval admin tool 500s
--         (42501, hit live by the operator 2026-07-31) and the quality-trend
--         panel reads empty.
--     Benchmarks are platform-shared REFERENCE data read from every org's
--     context, so they get the same policy shape as market_transactions /
--     micro_market_benchmarks (20260411): open SELECT, org-scoped writes.
--     The ab_eval tables are org-owned run logs: org-scoped on both verbs.
--
-- (2) improvement_signals HAS NO WRITE POLICY. Its migration (20260608) said
--     "Writes have no policy — they go through learningSignals.service.js
--     only", which was only ever true because the old role bypassed RLS.
--     Since the flip every signal INSERT dies 42501 (12 occurrences, 9 users
--     in the last error window) — the learning loop has been recording
--     nothing. Writes are fail-soft so nothing user-visible broke; the data
--     is simply gone.
--
-- (3) PLATFORM-ADMIN SIGNUPS ROSTER. /api/admin/signups reads users
--     cross-org; users' SELECT policies are self + org-mates, so since the
--     flip the "who has joined" roster silently shows only the operator's
--     own workspace. Two SECURITY DEFINER functions (pattern of 20260802:
--     pinned search_path, REVOKE PUBLIC, guarded grant) restore the
--     cross-org read, gated INSIDE the function on users.is_platform_admin.
--
-- (4) FLAG BACKFILL. The definer gate reads the persisted flag; 20260803
--     backfilled only rachitj579@gmail.com. The founder's other account
--     carries platform-admin via the env allowlist (break-glass), which SQL
--     cannot see — persist the flag for both operator accounts so the
--     definer gate and the middleware agree.
BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- (1a) Benchmarks: reference-data pattern — open read, org-scoped writes
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "residential_segmented_benchmarks_select_org" ON public.residential_segmented_benchmarks;
DROP POLICY IF EXISTS "residential_segmented_benchmarks_modify_org" ON public.residential_segmented_benchmarks;
DROP POLICY IF EXISTS "residential_segmented_benchmarks_select_all" ON public.residential_segmented_benchmarks;

CREATE POLICY "residential_segmented_benchmarks_select_all"
  ON public.residential_segmented_benchmarks
  FOR SELECT USING (true);

CREATE POLICY "residential_segmented_benchmarks_modify_org"
  ON public.residential_segmented_benchmarks
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS "niche_asset_class_benchmarks_select_org" ON public.niche_asset_class_benchmarks;
DROP POLICY IF EXISTS "niche_asset_class_benchmarks_modify_org" ON public.niche_asset_class_benchmarks;
DROP POLICY IF EXISTS "niche_asset_class_benchmarks_select_all" ON public.niche_asset_class_benchmarks;

CREATE POLICY "niche_asset_class_benchmarks_select_all"
  ON public.niche_asset_class_benchmarks
  FOR SELECT USING (true);

CREATE POLICY "niche_asset_class_benchmarks_modify_org"
  ON public.niche_asset_class_benchmarks
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- ────────────────────────────────────────────────────────────────────────────
-- (1b) A/B eval: org-owned run logs — org-scoped read and write
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "ab_eval_runs_select_org" ON public.ab_eval_runs;
DROP POLICY IF EXISTS "ab_eval_runs_modify_org" ON public.ab_eval_runs;

CREATE POLICY "ab_eval_runs_select_org"
  ON public.ab_eval_runs
  FOR SELECT USING (organization_id = current_organization_id());

CREATE POLICY "ab_eval_runs_modify_org"
  ON public.ab_eval_runs
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS "ab_eval_results_select_org" ON public.ab_eval_results;
DROP POLICY IF EXISTS "ab_eval_results_modify_org" ON public.ab_eval_results;

CREATE POLICY "ab_eval_results_select_org"
  ON public.ab_eval_results
  FOR SELECT USING (organization_id = current_organization_id());

CREATE POLICY "ab_eval_results_modify_org"
  ON public.ab_eval_results
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- ────────────────────────────────────────────────────────────────────────────
-- (2) improvement_signals: the write policy it never had
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS improvement_signals_org_write ON public.improvement_signals;
CREATE POLICY improvement_signals_org_write
  ON public.improvement_signals
  FOR INSERT
  WITH CHECK (organization_id = current_organization_id());

-- ────────────────────────────────────────────────────────────────────────────
-- (3) Platform-admin signups roster — SECURITY DEFINER, flag-gated inside
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_signups(p_search text, p_limit integer)
  RETURNS TABLE (
    id uuid, name text, email text, phone text, company text, job_title text,
    city text, created_at timestamptz, last_login_at timestamptz,
    email_verified_at timestamptz, oauth_provider text, is_active boolean,
    account_closed_at timestamptz, workspace_name text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT u.id, u.name::text, u.email::text, u.phone::text, u.company::text,
           u.job_title::text, u.city::text, u.created_at, u.last_login_at,
           u.email_verified_at, u.oauth_provider::text, u.is_active,
           u.account_closed_at, o.name::text AS workspace_name
      FROM public.users u
      LEFT JOIN public.organizations o ON o.id = u.default_organization_id
     WHERE EXISTS (
             SELECT 1 FROM public.users me
              WHERE me.id = public.current_user_id()
                AND me.is_platform_admin)
       AND (p_search IS NULL OR p_search = ''
            OR u.name    ILIKE '%' || p_search || '%'
            OR u.email   ILIKE '%' || p_search || '%'
            OR u.company ILIKE '%' || p_search || '%'
            OR u.city    ILIKE '%' || p_search || '%')
     ORDER BY u.created_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
$$;
REVOKE ALL ON FUNCTION public.admin_list_signups(text, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.admin_signup_summary()
  RETURNS TABLE (
    total integer, last_7_days integer, last_30_days integer,
    verified integer, via_google integer)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE u.created_at >= NOW() - INTERVAL '7 days')::int  AS last_7_days,
           COUNT(*) FILTER (WHERE u.created_at >= NOW() - INTERVAL '30 days')::int AS last_30_days,
           COUNT(*) FILTER (WHERE u.email_verified_at IS NOT NULL)::int            AS verified,
           COUNT(*) FILTER (WHERE u.oauth_provider IS NOT NULL)::int               AS via_google
      FROM public.users u
     WHERE EXISTS (
             SELECT 1 FROM public.users me
              WHERE me.id = public.current_user_id()
                AND me.is_platform_admin);
$$;
REVOKE ALL ON FUNCTION public.admin_signup_summary() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'redip_app') THEN
    GRANT EXECUTE ON FUNCTION public.admin_list_signups(text, integer) TO redip_app;
    GRANT EXECUTE ON FUNCTION public.admin_signup_summary() TO redip_app;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- (4) Persist the platform-admin flag for both operator accounts
-- ────────────────────────────────────────────────────────────────────────────

UPDATE users
   SET is_platform_admin = TRUE,
       platform_admin_granted_at = COALESCE(platform_admin_granted_at, NOW())
 WHERE LOWER(email) IN ('rachitjain348@gmail.com', 'rachitj579@gmail.com')
   AND is_platform_admin IS DISTINCT FROM TRUE;

COMMIT;

-- Verification (run after):
--   SELECT tablename, policyname FROM pg_policies
--    WHERE tablename IN ('residential_segmented_benchmarks',
--                        'niche_asset_class_benchmarks',
--                        'ab_eval_runs', 'ab_eval_results',
--                        'improvement_signals')
--    ORDER BY tablename, policyname;
--   -- expect NO policy text containing 'redip.organization_id' anywhere:
--   SELECT count(*) FROM pg_policies
--    WHERE qual::text LIKE '%redip.organization_id%'
--       OR with_check::text LIKE '%redip.organization_id%';   -- 0
--   SELECT email FROM users WHERE is_platform_admin;          -- both operator accounts
-- Rollback: re-run the CREATE POLICY blocks from 20260508/20260525/20260526,
-- DROP POLICY improvement_signals_org_write, DROP FUNCTION admin_list_signups,
-- admin_signup_summary, and clear the is_platform_admin flags.
