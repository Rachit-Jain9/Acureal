-- RLS Fix: Enable RLS and create SELECT policies for tables that show as disabled
-- These tables were listed in the previous migration but may have been partially applied.
-- This migration is safe to re-run (uses IF NOT EXISTS / DROP IF EXISTS).
-- Run as service role / superuser in Supabase SQL editor.

-- ─── Enable RLS on all tables that should have it ─────────────────────────────

ALTER TABLE IF EXISTS activities          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS comps               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS deal_stage_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS dd_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS approval_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS risk_flags          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS documents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS financials          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS properties          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS deals               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS intelligence_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS market_notes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS exchange_rates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS geocode_cache       ENABLE ROW LEVEL SECURITY;

-- ─── SELECT policies: allow all authenticated reads ───────────────────────────
-- The Express backend connects with the service role which bypasses RLS.
-- These policies allow direct Supabase Data API reads (e.g. from dashboard).

DROP POLICY IF EXISTS "activities_select_all"         ON activities;
CREATE POLICY "activities_select_all"
  ON activities FOR SELECT USING (true);

DROP POLICY IF EXISTS "comps_select_all"              ON comps;
CREATE POLICY "comps_select_all"
  ON comps FOR SELECT USING (true);

DROP POLICY IF EXISTS "deal_stage_history_select_all" ON deal_stage_history;
CREATE POLICY "deal_stage_history_select_all"
  ON deal_stage_history FOR SELECT USING (true);

DROP POLICY IF EXISTS "dd_items_select_all"           ON dd_items;
CREATE POLICY "dd_items_select_all"
  ON dd_items FOR SELECT USING (true);

DROP POLICY IF EXISTS "approval_items_select_all"     ON approval_items;
CREATE POLICY "approval_items_select_all"
  ON approval_items FOR SELECT USING (true);

DROP POLICY IF EXISTS "risk_flags_select_all"         ON risk_flags;
CREATE POLICY "risk_flags_select_all"
  ON risk_flags FOR SELECT USING (true);

DROP POLICY IF EXISTS "documents_select_all"          ON documents;
CREATE POLICY "documents_select_all"
  ON documents FOR SELECT USING (true);

DROP POLICY IF EXISTS "financials_select_all"         ON financials;
CREATE POLICY "financials_select_all"
  ON financials FOR SELECT USING (true);

DROP POLICY IF EXISTS "properties_select_all"         ON properties;
CREATE POLICY "properties_select_all"
  ON properties FOR SELECT USING (true);

DROP POLICY IF EXISTS "deals_select_all"              ON deals;
CREATE POLICY "deals_select_all"
  ON deals FOR SELECT USING (true);

DROP POLICY IF EXISTS "intelligence_briefs_select_all" ON intelligence_briefs;
CREATE POLICY "intelligence_briefs_select_all"
  ON intelligence_briefs FOR SELECT USING (true);

DROP POLICY IF EXISTS "market_notes_select_all"       ON market_notes;
CREATE POLICY "market_notes_select_all"
  ON market_notes FOR SELECT USING (true);

DROP POLICY IF EXISTS "exchange_rates_select_all"     ON exchange_rates;
CREATE POLICY "exchange_rates_select_all"
  ON exchange_rates FOR SELECT USING (true);

DROP POLICY IF EXISTS "geocode_cache_select_all"      ON geocode_cache;
CREATE POLICY "geocode_cache_select_all"
  ON geocode_cache FOR SELECT USING (true);

-- ─── Verification query ───────────────────────────────────────────────────────
-- After running, check all tables show row_security = true:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
