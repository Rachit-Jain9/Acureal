-- 2026-06-13 — RLS coverage gap fix for market data + master-plan documents
--
-- The static RLS audit (scripts/audit_rls.py) flagged six org-scoped tables
-- that were created with an `organization_id` / `org_id` column but never
-- had ROW LEVEL SECURITY enabled. The application-side WHERE clause was
-- the only barrier preventing cross-org row leakage; any bug in that
-- filter would have leaked another workspace's curated data.
--
-- Tables affected:
--   1. public.market_macro_kpis             (Bengaluru macro indicators)
--   2. public.office_market_benchmarks      (Q1 2026 office benchmarks)
--   3. public.retail_market_benchmarks      (Q1 2026 retail benchmarks)
--   4. public.industrial_market_benchmarks  (Q1 2026 industrial benchmarks)
--   5. public.hospitality_market_benchmarks (Q1 2026 hospitality benchmarks)
--   6. regulatory_data.master_plan_documents (master-plan source docs)
--
-- Policy shape — matches the sister tables (`micro_market_benchmarks`,
-- `market_transactions`) which adopted the universal-read pattern in
-- PR #530:
--
--   • FOR SELECT USING (true)                  — every workspace can READ
--                                                any row (the application
--                                                does the per-org filter,
--                                                including the platform
--                                                admin's curated rows).
--   • FOR INSERT WITH CHECK (own org)          — workspaces can only
--                                                insert into their own
--                                                organization_id.
--   • FOR UPDATE USING (own org)               — and only update / delete
--   • FOR DELETE USING (own org)                 rows they wrote.
--
-- master_plan_documents uses `org_id` (not `organization_id`) so its
-- policies reference the correct column name.
--
-- Idempotent — safe to re-run. DROP POLICY IF EXISTS cleans any stale
-- policy before re-creation; ENABLE ROW LEVEL SECURITY is no-op when
-- already enabled.

-- ─── public.market_macro_kpis ─────────────────────────────────────────
ALTER TABLE IF EXISTS market_macro_kpis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS market_macro_kpis_select_all ON market_macro_kpis;
CREATE POLICY market_macro_kpis_select_all ON market_macro_kpis
  FOR SELECT USING (true);
DROP POLICY IF EXISTS market_macro_kpis_insert_own_org ON market_macro_kpis;
CREATE POLICY market_macro_kpis_insert_own_org ON market_macro_kpis
  FOR INSERT WITH CHECK (organization_id = current_organization_id());
DROP POLICY IF EXISTS market_macro_kpis_update_own_org ON market_macro_kpis;
CREATE POLICY market_macro_kpis_update_own_org ON market_macro_kpis
  FOR UPDATE USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
DROP POLICY IF EXISTS market_macro_kpis_delete_own_org ON market_macro_kpis;
CREATE POLICY market_macro_kpis_delete_own_org ON market_macro_kpis
  FOR DELETE USING (organization_id = current_organization_id());

-- ─── public.office_market_benchmarks ──────────────────────────────────
ALTER TABLE IF EXISTS office_market_benchmarks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS office_market_benchmarks_select_all ON office_market_benchmarks;
CREATE POLICY office_market_benchmarks_select_all ON office_market_benchmarks
  FOR SELECT USING (true);
DROP POLICY IF EXISTS office_market_benchmarks_insert_own_org ON office_market_benchmarks;
CREATE POLICY office_market_benchmarks_insert_own_org ON office_market_benchmarks
  FOR INSERT WITH CHECK (organization_id = current_organization_id());
DROP POLICY IF EXISTS office_market_benchmarks_update_own_org ON office_market_benchmarks;
CREATE POLICY office_market_benchmarks_update_own_org ON office_market_benchmarks
  FOR UPDATE USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
DROP POLICY IF EXISTS office_market_benchmarks_delete_own_org ON office_market_benchmarks;
CREATE POLICY office_market_benchmarks_delete_own_org ON office_market_benchmarks
  FOR DELETE USING (organization_id = current_organization_id());

-- ─── public.retail_market_benchmarks ──────────────────────────────────
ALTER TABLE IF EXISTS retail_market_benchmarks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS retail_market_benchmarks_select_all ON retail_market_benchmarks;
CREATE POLICY retail_market_benchmarks_select_all ON retail_market_benchmarks
  FOR SELECT USING (true);
DROP POLICY IF EXISTS retail_market_benchmarks_insert_own_org ON retail_market_benchmarks;
CREATE POLICY retail_market_benchmarks_insert_own_org ON retail_market_benchmarks
  FOR INSERT WITH CHECK (organization_id = current_organization_id());
DROP POLICY IF EXISTS retail_market_benchmarks_update_own_org ON retail_market_benchmarks;
CREATE POLICY retail_market_benchmarks_update_own_org ON retail_market_benchmarks
  FOR UPDATE USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
DROP POLICY IF EXISTS retail_market_benchmarks_delete_own_org ON retail_market_benchmarks;
CREATE POLICY retail_market_benchmarks_delete_own_org ON retail_market_benchmarks
  FOR DELETE USING (organization_id = current_organization_id());

-- ─── public.industrial_market_benchmarks ──────────────────────────────
ALTER TABLE IF EXISTS industrial_market_benchmarks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS industrial_market_benchmarks_select_all ON industrial_market_benchmarks;
CREATE POLICY industrial_market_benchmarks_select_all ON industrial_market_benchmarks
  FOR SELECT USING (true);
DROP POLICY IF EXISTS industrial_market_benchmarks_insert_own_org ON industrial_market_benchmarks;
CREATE POLICY industrial_market_benchmarks_insert_own_org ON industrial_market_benchmarks
  FOR INSERT WITH CHECK (organization_id = current_organization_id());
DROP POLICY IF EXISTS industrial_market_benchmarks_update_own_org ON industrial_market_benchmarks;
CREATE POLICY industrial_market_benchmarks_update_own_org ON industrial_market_benchmarks
  FOR UPDATE USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
DROP POLICY IF EXISTS industrial_market_benchmarks_delete_own_org ON industrial_market_benchmarks;
CREATE POLICY industrial_market_benchmarks_delete_own_org ON industrial_market_benchmarks
  FOR DELETE USING (organization_id = current_organization_id());

-- ─── public.hospitality_market_benchmarks ─────────────────────────────
ALTER TABLE IF EXISTS hospitality_market_benchmarks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hospitality_market_benchmarks_select_all ON hospitality_market_benchmarks;
CREATE POLICY hospitality_market_benchmarks_select_all ON hospitality_market_benchmarks
  FOR SELECT USING (true);
DROP POLICY IF EXISTS hospitality_market_benchmarks_insert_own_org ON hospitality_market_benchmarks;
CREATE POLICY hospitality_market_benchmarks_insert_own_org ON hospitality_market_benchmarks
  FOR INSERT WITH CHECK (organization_id = current_organization_id());
DROP POLICY IF EXISTS hospitality_market_benchmarks_update_own_org ON hospitality_market_benchmarks;
CREATE POLICY hospitality_market_benchmarks_update_own_org ON hospitality_market_benchmarks
  FOR UPDATE USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
DROP POLICY IF EXISTS hospitality_market_benchmarks_delete_own_org ON hospitality_market_benchmarks;
CREATE POLICY hospitality_market_benchmarks_delete_own_org ON hospitality_market_benchmarks
  FOR DELETE USING (organization_id = current_organization_id());

-- ─── regulatory_data.master_plan_documents ────────────────────────────
-- Uses `org_id` (not `organization_id`) per the regulatory_data convention.
ALTER TABLE IF EXISTS regulatory_data.master_plan_documents
  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS master_plan_documents_select_all
  ON regulatory_data.master_plan_documents;
CREATE POLICY master_plan_documents_select_all
  ON regulatory_data.master_plan_documents
  FOR SELECT USING (true);
DROP POLICY IF EXISTS master_plan_documents_insert_own_org
  ON regulatory_data.master_plan_documents;
CREATE POLICY master_plan_documents_insert_own_org
  ON regulatory_data.master_plan_documents
  FOR INSERT WITH CHECK (org_id = current_organization_id());
DROP POLICY IF EXISTS master_plan_documents_update_own_org
  ON regulatory_data.master_plan_documents;
CREATE POLICY master_plan_documents_update_own_org
  ON regulatory_data.master_plan_documents
  FOR UPDATE USING (org_id = current_organization_id())
  WITH CHECK (org_id = current_organization_id());
DROP POLICY IF EXISTS master_plan_documents_delete_own_org
  ON regulatory_data.master_plan_documents;
CREATE POLICY master_plan_documents_delete_own_org
  ON regulatory_data.master_plan_documents
  FOR DELETE USING (org_id = current_organization_id());
