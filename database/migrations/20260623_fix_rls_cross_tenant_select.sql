-- ============================================================================
-- 20260623 — CRITICAL: close the cross-tenant SELECT hole on tenant tables
-- ============================================================================
-- Every core tenant table carried a permissive `<table>_select_all` policy:
--     FOR SELECT TO public USING (true)
-- Postgres OR-combines permissive policies, so this `USING(true)` policy
-- OVERRODE the correct `<table>_org_scope` (USING organization_id =
-- current_organization_id()) and `<table>_shared_read` policies for SELECT.
-- Net effect: the anon / authenticated Supabase Data API (PostgREST) could
-- read EVERY org's rows — deals, properties (landowner PII), documents,
-- financials, comps, risks, DD, approvals, activities — across tenants.
--
-- Why the app is unaffected: the Node backend connects with a BYPASSRLS role
-- (postgres) and scopes every read with an explicit
-- `WHERE organization_id = current_organization_id()` filter, so RLS never
-- gated the app. These policies only ever governed the Data API path — which
-- is precisely where the leak was.
--
-- Fix: drop the 9 permissive policies. The `*_org_scope` (ALL, org-isolated)
-- and `*_shared_read` (deal-shares) policies remain and now correctly govern
-- SELECT for the Data API. Supabase's RLS linter does NOT flag `USING(true)`
-- SELECT policies (it only checks RLS-enabled / no-policy), which is why this
-- never surfaced in CI; a new static guard (scripts/check-permissive-rls.js)
-- closes that blind spot.
--
-- Idempotent (DROP POLICY IF EXISTS). Paste-safe in the Supabase SQL editor.
-- No app downtime: the app bypasses RLS, so reads are unchanged at commit.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS deals_select_all          ON public.deals;
DROP POLICY IF EXISTS properties_select_all     ON public.properties;
DROP POLICY IF EXISTS documents_select_all      ON public.documents;
DROP POLICY IF EXISTS financials_select_all     ON public.financials;
DROP POLICY IF EXISTS comps_select_all          ON public.comps;
DROP POLICY IF EXISTS risk_flags_select_all     ON public.risk_flags;
DROP POLICY IF EXISTS dd_items_select_all       ON public.dd_items;
DROP POLICY IF EXISTS approval_items_select_all ON public.approval_items;
DROP POLICY IF EXISTS activities_select_all      ON public.activities;
-- Same strict-org-scope private pattern, surfaced by the regression guard:
DROP POLICY IF EXISTS deal_stage_history_select_all   ON public.deal_stage_history;
DROP POLICY IF EXISTS document_extractions_select_all ON public.document_extractions;
DROP POLICY IF EXISTS intelligence_briefs_select_all  ON public.intelligence_briefs;
DROP POLICY IF EXISTS market_notes_select_all         ON public.market_notes;

-- master_plan_documents already carries the correct org-or-global policy
-- (master_plan_documents_org_scope: org_id IS NULL OR org_id = current_org).
-- Its redundant *_select_all USING(true) read additionally exposed OTHER orgs'
-- uploaded master-plan documents, so drop it. Shared (org_id NULL) reference
-- docs + the org's own docs stay readable; cross-org private docs do not.
DROP POLICY IF EXISTS master_plan_documents_select_all ON regulatory_data.master_plan_documents;

-- NOTE: the platform-shared market reference tables (office/retail/industrial/
-- hospitality_market_benchmarks, market_macro_kpis, micro_market_benchmarks,
-- market_transactions, market_notes, intelligence_briefs) intentionally keep a
-- read-all SELECT policy paired with own-org-only writes — the documented
-- "platform-shared verified-market reads" design (intelligence.service.js).
-- Those are curated reference meant to be visible to every org, so they are
-- deliberately NOT changed here.

-- Advisor 0013 (ERROR): public.spatial_ref_sys (the PostGIS EPSG reference) is
-- exposed via the Data API with RLS off. It is standard public reference data,
-- so a read-all policy is correct — this just clears the linter ERROR and
-- documents intent. Guarded: skipped (with a notice) if this DB role does not
-- own the PostGIS-owned table, so the critical drops above never fail on it.
DO $$
BEGIN
  ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS spatial_ref_sys_read ON public.spatial_ref_sys;
  CREATE POLICY spatial_ref_sys_read ON public.spatial_ref_sys FOR SELECT USING (true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'spatial_ref_sys RLS not applied (likely not owner): %', SQLERRM;
END $$;

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   -- Expect 0 rows (no permissive USING(true) SELECT policy left on a tenant table):
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname='public' AND cmd='SELECT' AND qual='true'
--      AND tablename IN ('deals','properties','documents','financials','comps',
--                        'risk_flags','dd_items','approval_items','activities',
--                        'deal_stage_history','document_extractions',
--                        'intelligence_briefs','market_notes');
--
--   -- Confirm org isolation still in force (expect the 9 *_org_scope rows):
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname='public' AND policyname LIKE '%\_org\_scope' ESCAPE '\'
--    ORDER BY tablename;
-- ============================================================================
