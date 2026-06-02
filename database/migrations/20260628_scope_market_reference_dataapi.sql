-- ============================================================================
-- 20260628 — Scope the curated market-reference Data-API reads to own-org
--            (SUPERSEDES the reverted 20260626_globalize_market_reference)
-- ============================================================================
-- Seven platform-curated market-reference tables carry a permissive
-- `<table>_select_all` SELECT policy `USING (true)`:
--   public.market_transactions            public.office_market_benchmarks
--   public.micro_market_benchmarks        public.retail_market_benchmarks
--   public.market_macro_kpis              public.industrial_market_benchmarks
--                                         public.hospitality_market_benchmarks
--
-- THE LATENT LEAK: `USING (true)` lets the Supabase Data API (PostgREST,
-- anon/authenticated key) read EVERY org's rows. There is no ACTIVE leak today
-- (every row is single-org operator-curated; verified live: distinct_orgs = 1,
-- zero NULL-org rows), but the moment any org writes a private benchmark/
-- transaction row (the own-org INSERT policy permits it), that row would be
-- readable by every org via the Data API.
--
-- WHY NOT "globalize to NULL" (the reverted 20260626 approach): that draft ran
-- `UPDATE ... SET organization_id = NULL` to mark the curated rows global. It
-- FAILS with 23502 — organization_id is NOT NULL on all seven tables. And even
-- if the column were nullable, the app reads these tables through the backend's
-- intelligence.service buildOrgScope() — `organization_id =
-- current_organization_id() OR organization_id = <platformOrgId>` — on the
-- BYPASSRLS role; NULL rows would not match, hiding the market data from the
-- Intelligence page for everyone. So globalizing is both broken and a
-- regression.
--
-- THE FIX (no data change, no code change): tighten each `_select_all` SELECT
-- policy from `USING (true)` to `USING (organization_id =
-- current_organization_id())` — the same own-org scope every other tenant table
-- already uses on the Data API. The app is UNAFFECTED: it connects with a
-- BYPASSRLS role and filters with buildOrgScope() explicitly, so RLS never
-- governs the app's reads; the Intelligence page still surfaces the curated
-- reference to every org via the backend. This change governs ONLY the Data API
-- path — exactly where the latent leak lives.
--
-- Idempotent: DROP POLICY IF EXISTS before each CREATE. Paste-safe in the
-- Supabase SQL editor (BEGIN/COMMIT, no CONCURRENTLY). No rows are touched.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS market_transactions_select_all ON public.market_transactions;
CREATE POLICY market_transactions_select_all ON public.market_transactions
  FOR SELECT USING (organization_id = current_organization_id());

DROP POLICY IF EXISTS micro_market_benchmarks_select_all ON public.micro_market_benchmarks;
CREATE POLICY micro_market_benchmarks_select_all ON public.micro_market_benchmarks
  FOR SELECT USING (organization_id = current_organization_id());

DROP POLICY IF EXISTS market_macro_kpis_select_all ON public.market_macro_kpis;
CREATE POLICY market_macro_kpis_select_all ON public.market_macro_kpis
  FOR SELECT USING (organization_id = current_organization_id());

DROP POLICY IF EXISTS office_market_benchmarks_select_all ON public.office_market_benchmarks;
CREATE POLICY office_market_benchmarks_select_all ON public.office_market_benchmarks
  FOR SELECT USING (organization_id = current_organization_id());

DROP POLICY IF EXISTS retail_market_benchmarks_select_all ON public.retail_market_benchmarks;
CREATE POLICY retail_market_benchmarks_select_all ON public.retail_market_benchmarks
  FOR SELECT USING (organization_id = current_organization_id());

DROP POLICY IF EXISTS industrial_market_benchmarks_select_all ON public.industrial_market_benchmarks;
CREATE POLICY industrial_market_benchmarks_select_all ON public.industrial_market_benchmarks
  FOR SELECT USING (organization_id = current_organization_id());

DROP POLICY IF EXISTS hospitality_market_benchmarks_select_all ON public.hospitality_market_benchmarks;
CREATE POLICY hospitality_market_benchmarks_select_all ON public.hospitality_market_benchmarks
  FOR SELECT USING (organization_id = current_organization_id());

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   -- No bare USING(true) SELECT policy left on these 7 tables (expect 0 rows):
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname='public' AND cmd='SELECT' AND qual='true'
--      AND tablename IN ('market_transactions','micro_market_benchmarks','market_macro_kpis',
--                        'office_market_benchmarks','retail_market_benchmarks',
--                        'industrial_market_benchmarks','hospitality_market_benchmarks');
--
--   -- The 7 SELECT policies are now own-org scoped (expect 7 rows; qual reads
--   -- "(organization_id = current_organization_id())"):
--   SELECT tablename, qual FROM pg_policies
--    WHERE schemaname='public' AND policyname LIKE '%\_select\_all' ESCAPE '\'
--      AND tablename IN ('market_transactions','micro_market_benchmarks','market_macro_kpis',
--                        'office_market_benchmarks','retail_market_benchmarks',
--                        'industrial_market_benchmarks','hospitality_market_benchmarks')
--    ORDER BY tablename;
-- ============================================================================
