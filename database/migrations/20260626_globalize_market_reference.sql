-- ============================================================================
-- 20260626 — Globalize the curated market-reference tables + make the read-all
--            SELECT policy "global-or-own-org" so future org writes stay private
-- ============================================================================
-- Seven platform-curated reference tables carry an `organization_id` column AND
-- a permissive `<table>_select_all` SELECT policy (FOR SELECT USING (true)):
--
--   public.market_transactions            public.office_market_benchmarks
--   public.micro_market_benchmarks        public.retail_market_benchmarks
--   public.market_macro_kpis              public.industrial_market_benchmarks
--                                         public.hospitality_market_benchmarks
--
-- These are operator/seed-curated verified-market reference (Bengaluru deal
-- prints, micro-market rate bands, macro KPIs). They are READ by every org via
-- intelligence.service.js ("Platform-shared verified-market reads") and are
-- never written by a normal org — the only writers are seed migrations
-- (20260404_market_data, 20260505_market_data_q1_2026_refresh, the v0.2 rate-
-- pack loads). intelligence.service.js only ever INSERTs into `intelligence_
-- briefs` and `market_notes` (both keyed by current_organization_id()), never
-- into these seven tables. Live data confirms the curated state: every table
-- has rows from exactly ONE org and zero NULL-org rows.
--
-- THE LATENT LEAK this closes: the `USING (true)` SELECT policy means that the
-- moment ANY org ever writes a private benchmark/transaction row into one of
-- these tables (the own-org INSERT policy permits it), that row becomes visible
-- to EVERY org via the Supabase Data API (PostgREST). The intent was always
-- "curated reference is shared; private writes are not" — but `USING (true)`
-- cannot express that. (The app backend is unaffected either way: it connects
-- with a BYPASSRLS role and filters with buildOrgScope() — these policies only
-- govern the Data API path, exactly where the latent leak lives.)
--
-- THE FIX (same pattern as 20260622_globalize_masterplan_reference + the
-- regulatory_data `org_id IS NULL OR org_id = current_organization_id()`
-- convention):
--   1. UPDATE ... SET organization_id = NULL  — tag the curated rows as global.
--      Guarded (organization_id IS NOT NULL) so re-running is a no-op.
--   2. Rewrite each `<table>_select_all` policy from USING (true) to
--      USING (organization_id IS NULL OR organization_id = current_organization_id())
--      so curated (NULL) rows stay visible to all, but any future org-private
--      write is visible only to its owning org.
--
-- The own-org INSERT/UPDATE/DELETE policies are LEFT UNTOUCHED. They already
-- read `organization_id = current_organization_id()`, so an org can still only
-- write its own rows; it simply can no longer read another org's private rows
-- through the shared SELECT policy.
--
-- Idempotent: UPDATEs are guarded; DROP POLICY IF EXISTS + CREATE rewrites the
-- SELECT policy deterministically. Paste-safe in the Supabase SQL editor
-- (BEGIN/COMMIT, no CONCURRENTLY). The app bypasses RLS, so reads are unchanged
-- at commit; no downtime.
-- ============================================================================

BEGIN;

-- ── 1. Globalize the curated rows (organization_id → NULL) ──────────────────
UPDATE public.market_transactions           SET organization_id = NULL WHERE organization_id IS NOT NULL;
UPDATE public.micro_market_benchmarks       SET organization_id = NULL WHERE organization_id IS NOT NULL;
UPDATE public.market_macro_kpis             SET organization_id = NULL WHERE organization_id IS NOT NULL;
UPDATE public.office_market_benchmarks      SET organization_id = NULL WHERE organization_id IS NOT NULL;
UPDATE public.retail_market_benchmarks      SET organization_id = NULL WHERE organization_id IS NOT NULL;
UPDATE public.industrial_market_benchmarks  SET organization_id = NULL WHERE organization_id IS NOT NULL;
UPDATE public.hospitality_market_benchmarks SET organization_id = NULL WHERE organization_id IS NOT NULL;

-- ── 2. Rewrite each read-all SELECT policy: global-or-own-org ───────────────
--      (was: FOR SELECT USING (true) — the latent cross-tenant hole)

DROP POLICY IF EXISTS market_transactions_select_all ON public.market_transactions;
CREATE POLICY market_transactions_select_all ON public.market_transactions
  FOR SELECT USING (organization_id IS NULL OR organization_id = current_organization_id());

DROP POLICY IF EXISTS micro_market_benchmarks_select_all ON public.micro_market_benchmarks;
CREATE POLICY micro_market_benchmarks_select_all ON public.micro_market_benchmarks
  FOR SELECT USING (organization_id IS NULL OR organization_id = current_organization_id());

DROP POLICY IF EXISTS market_macro_kpis_select_all ON public.market_macro_kpis;
CREATE POLICY market_macro_kpis_select_all ON public.market_macro_kpis
  FOR SELECT USING (organization_id IS NULL OR organization_id = current_organization_id());

DROP POLICY IF EXISTS office_market_benchmarks_select_all ON public.office_market_benchmarks;
CREATE POLICY office_market_benchmarks_select_all ON public.office_market_benchmarks
  FOR SELECT USING (organization_id IS NULL OR organization_id = current_organization_id());

DROP POLICY IF EXISTS retail_market_benchmarks_select_all ON public.retail_market_benchmarks;
CREATE POLICY retail_market_benchmarks_select_all ON public.retail_market_benchmarks
  FOR SELECT USING (organization_id IS NULL OR organization_id = current_organization_id());

DROP POLICY IF EXISTS industrial_market_benchmarks_select_all ON public.industrial_market_benchmarks;
CREATE POLICY industrial_market_benchmarks_select_all ON public.industrial_market_benchmarks
  FOR SELECT USING (organization_id IS NULL OR organization_id = current_organization_id());

DROP POLICY IF EXISTS hospitality_market_benchmarks_select_all ON public.hospitality_market_benchmarks;
CREATE POLICY hospitality_market_benchmarks_select_all ON public.hospitality_market_benchmarks
  FOR SELECT USING (organization_id IS NULL OR organization_id = current_organization_id());

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   -- All curated rows now global (expect 0 org-scoped rows on every table):
--   SELECT 'market_transactions' t, count(*) FILTER (WHERE organization_id IS NOT NULL) org_scoped FROM public.market_transactions
--   UNION ALL SELECT 'micro_market_benchmarks',       count(*) FILTER (WHERE organization_id IS NOT NULL) FROM public.micro_market_benchmarks
--   UNION ALL SELECT 'market_macro_kpis',             count(*) FILTER (WHERE organization_id IS NOT NULL) FROM public.market_macro_kpis
--   UNION ALL SELECT 'office_market_benchmarks',      count(*) FILTER (WHERE organization_id IS NOT NULL) FROM public.office_market_benchmarks
--   UNION ALL SELECT 'retail_market_benchmarks',      count(*) FILTER (WHERE organization_id IS NOT NULL) FROM public.retail_market_benchmarks
--   UNION ALL SELECT 'industrial_market_benchmarks',  count(*) FILTER (WHERE organization_id IS NOT NULL) FROM public.industrial_market_benchmarks
--   UNION ALL SELECT 'hospitality_market_benchmarks', count(*) FILTER (WHERE organization_id IS NOT NULL) FROM public.hospitality_market_benchmarks;
--
--   -- No bare USING(true) SELECT policy left on these tables (expect 0 rows):
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname='public' AND cmd='SELECT' AND qual='true'
--      AND tablename IN ('market_transactions','micro_market_benchmarks','market_macro_kpis',
--                        'office_market_benchmarks','retail_market_benchmarks',
--                        'industrial_market_benchmarks','hospitality_market_benchmarks');
--
--   -- The 7 rewritten SELECT policies now read global-or-own-org (expect 7 rows):
--   SELECT tablename, qual FROM pg_policies
--    WHERE schemaname='public' AND cmd='SELECT' AND policyname LIKE '%\_select\_all' ESCAPE '\'
--      AND tablename IN ('market_transactions','micro_market_benchmarks','market_macro_kpis',
--                        'office_market_benchmarks','retail_market_benchmarks',
--                        'industrial_market_benchmarks','hospitality_market_benchmarks')
--    ORDER BY tablename;
-- ============================================================================
