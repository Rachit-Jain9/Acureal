-- ============================================================================
-- 0030 — public.users RLS + deal_summary security_invoker
-- ============================================================================
-- Closes 2 of the 3 ERROR-severity Supabase advisor lints surfaced in the
-- 2026-04-29 audit:
--
--   1. `rls_disabled_in_public` on `public.users`
--      → Without RLS, any session reaching PostgREST as `anon`/`authenticated`
--        could `GET /rest/v1/users` and dump every email, password_hash, role,
--        and last-login timestamp in the workspace. Backend never hits that
--        endpoint (it connects as the `postgres` role via DATABASE_URL,
--        bypassing RLS), but defense-in-depth requires the rule.
--
--   2. `security_definer_view` on `public.deal_summary`
--      → Views default to SECURITY DEFINER (caller's RLS is ignored, view
--        creator's privileges are used). For a multi-tenant view this means
--        a tenant-A session reading `deal_summary` could see tenant-B rows.
--        Backend isn't exposed to this (postgres role bypasses RLS anyway),
--        but again — defense in depth. Recreate WITH (security_invoker=true)
--        so the view honors the calling session's RLS.
--
-- The third ERROR (`spatial_ref_sys` RLS) is PostGIS-shipped and not REDIP
-- code; left as-is.
--
-- Idempotent: every operation is guarded by IF EXISTS / OR REPLACE.
-- Safe to re-run.
--
-- Dependencies: relies on `public.current_user_id()` from
-- `20260416_multitenancy_foundation.sql` and `public.current_organization_id()`
-- from same. Run after those.
-- ============================================================================

BEGIN;

-- ── 1. public.users RLS ─────────────────────────────────────────────────────
-- Enable RLS. The backend (postgres role) bypasses RLS, so existing queries
-- (login, profile fetch, deal joins) keep working unchanged. The policies
-- below only matter if a session ever connects as `authenticated` or `anon`
-- via PostgREST — REDIP's frontend doesn't, but a future BI tool or
-- accidentally-exposed Supabase client would.

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Self-read: a user can SELECT their own row (full columns).
DROP POLICY IF EXISTS users_self_read ON public.users;
CREATE POLICY users_self_read ON public.users
  FOR SELECT
  USING (id = (SELECT public.current_user_id()));

-- Org-mate read: a user can SELECT other users in any org they share.
-- This preserves the existing collaboration UX (deal "assigned to" names,
-- comment authorship, audit trail actor labels) for any client that does
-- end up going through RLS-bound roles.
DROP POLICY IF EXISTS users_org_mates_read ON public.users;
CREATE POLICY users_org_mates_read ON public.users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members me
      JOIN public.organization_members them
        ON them.organization_id = me.organization_id
      WHERE me.user_id = (SELECT public.current_user_id())
        AND them.user_id = public.users.id
    )
  );

-- Self-update: a user can UPDATE their own row only.
DROP POLICY IF EXISTS users_self_update ON public.users;
CREATE POLICY users_self_update ON public.users
  FOR UPDATE
  USING (id = (SELECT public.current_user_id()))
  WITH CHECK (id = (SELECT public.current_user_id()));

-- INSERT and DELETE intentionally have no policy. Registration and
-- offboarding go through the backend (`postgres` role) which bypasses RLS.

-- ── 2. public.deal_summary as SECURITY INVOKER ──────────────────────────────
-- Recreate with `security_invoker=true` so RLS on underlying tables is
-- evaluated against the calling session, not the view creator. View shape
-- preserved byte-for-byte with the existing definition.

DROP VIEW IF EXISTS public.deal_summary;

CREATE VIEW public.deal_summary
WITH (security_invoker = true) AS
SELECT
  d.id,
  d.name AS deal_name,
  d.deal_type,
  d.stage,
  d.priority,
  p.name AS property_name,
  p.city,
  p.state,
  p.land_area_sqft,
  p.zoning,
  u.name AS assigned_to_name,
  f.total_revenue_cr,
  f.total_cost_cr,
  f.gross_profit_cr,
  f.gross_margin_pct,
  f.irr_pct,
  f.npv_cr,
  f.saleable_area_sqft,
  d.target_launch_date,
  d.created_at,
  d.updated_at
FROM deals d
LEFT JOIN properties p ON d.property_id = p.id
LEFT JOIN users u ON d.assigned_to = u.id
LEFT JOIN financials f ON d.id = f.deal_id
WHERE d.is_archived = false;

COMMIT;

-- ── Verification (run as a separate query if curious) ───────────────────────
--   SELECT relrowsecurity FROM pg_class
--    WHERE relname = 'users' AND relnamespace = 'public'::regnamespace;
--   -- expect: t
--
--   SELECT reloptions FROM pg_class
--    WHERE relname = 'deal_summary' AND relnamespace = 'public'::regnamespace;
--   -- expect: {security_invoker=true}
