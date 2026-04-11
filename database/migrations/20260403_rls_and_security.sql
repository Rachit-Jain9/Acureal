-- RLS and Security Hardening for REDIP
-- Run with a superuser / service role account.
-- The app uses a direct pg Pool connection (not Supabase Auth JWT), so RLS
-- is a defence-in-depth layer on top of the Express auth middleware.
-- All writes go through the authenticated Express API; raw DB access is not
-- exposed to the browser.

-- ─── Enable RLS on all core tables ───────────────────────────────────────────

ALTER TABLE properties        ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals             ENABLE ROW LEVEL SECURITY;
ALTER TABLE financials        ENABLE ROW LEVEL SECURITY;
ALTER TABLE comps             ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities        ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_notes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_stage_history ENABLE ROW LEVEL SECURITY;

-- ─── Service role bypasses RLS (used by the Express backend) ─────────────────
-- Supabase service role has BYPASSRLS by default; nothing to add.

-- ─── Allow full access to the authenticated Postgres role (pg Pool user) ─────
-- The pool connects as postgres.lsbhrbvuynzqhdtzczco (superuser) so it bypasses
-- RLS automatically. These policies are supplementary for additional roles.

-- Properties: read-all, write by service role only (Express enforces auth)
DROP POLICY IF EXISTS "properties_select_all" ON properties;
CREATE POLICY "properties_select_all"
  ON properties FOR SELECT USING (true);

DROP POLICY IF EXISTS "deals_select_all" ON deals;
CREATE POLICY "deals_select_all"
  ON deals FOR SELECT USING (true);

DROP POLICY IF EXISTS "financials_select_all" ON financials;
CREATE POLICY "financials_select_all"
  ON financials FOR SELECT USING (true);

DROP POLICY IF EXISTS "comps_select_all" ON comps;
CREATE POLICY "comps_select_all"
  ON comps FOR SELECT USING (true);

DROP POLICY IF EXISTS "documents_select_all" ON documents;
CREATE POLICY "documents_select_all"
  ON documents FOR SELECT USING (true);

DROP POLICY IF EXISTS "activities_select_all" ON activities;
CREATE POLICY "activities_select_all"
  ON activities FOR SELECT USING (true);

DROP POLICY IF EXISTS "intelligence_briefs_select_all" ON intelligence_briefs;
CREATE POLICY "intelligence_briefs_select_all"
  ON intelligence_briefs FOR SELECT USING (true);

DROP POLICY IF EXISTS "market_notes_select_all" ON market_notes;
CREATE POLICY "market_notes_select_all"
  ON market_notes FOR SELECT USING (true);

DROP POLICY IF EXISTS "deal_stage_history_select_all" ON deal_stage_history;
CREATE POLICY "deal_stage_history_select_all"
  ON deal_stage_history FOR SELECT USING (true);

-- ─── Supabase Storage bucket: redip-documents ─────────────────────────────────
-- Run these via the Supabase Dashboard → Storage → Policies, OR via REST API.
-- The bucket should be PRIVATE (not public).
-- Files are accessed via signed URLs generated server-side.
--
-- Storage policies cannot be created via SQL directly in all Supabase setups.
-- Use the Dashboard: Storage → redip-documents → Policies:
--   • INSERT: authenticated (service role)
--   • SELECT: authenticated (service role) — read via signed URL
--   • DELETE: authenticated (service role)

-- ─── Admin role: ensure at least one admin user exists ───────────────────────
-- Set your own user as admin after first login:
-- UPDATE users SET role = 'admin' WHERE email = 'your@email.com';

-- ─── Indexes for performance (idempotent) ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_comps_project_name ON comps(project_name);
CREATE INDEX IF NOT EXISTS idx_comps_is_verified ON comps(is_verified);
CREATE INDEX IF NOT EXISTS idx_market_notes_section ON market_notes(section);
