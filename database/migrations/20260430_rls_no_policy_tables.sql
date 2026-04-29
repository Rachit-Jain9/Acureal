-- ============================================================================
-- 0034 — Add policies for the 5 RLS-enabled-no-policy tables
-- ============================================================================
-- Closes the 5 `rls_enabled_no_policy` INFO advisor lints. Each table had
-- RLS turned on but no policies defined, which means PostgREST-bound
-- sessions (anon, authenticated) were silently denied access via the
-- absence of a matching policy. Backend keeps working because the
-- `postgres` role bypasses RLS, but the *intent* of each table's access
-- model wasn't expressed in code — the advisor flag is right to ask.
--
-- Per-table reasoning:
--
--   public.exchange_rate_fetch_log
--     Internal cron log with no `org_id` column. Written by
--     `fx.service.js` via the daily refresh. There is no legitimate
--     PostgREST consumer; the table only exists for operator forensics.
--     → Add an explicit deny-all policy so the intent is in the schema,
--       not implied by the absence of one.
--
--   regulatory_data.master_plan_documents
--     Tenant-scoped uploads of zoning PDFs. Has `org_id uuid` (nullable
--     for global-curator rows). Same pattern as `evidence_sources` and
--     `far_rules`.
--     → Global-or-tenant `SELECT/INSERT/UPDATE/DELETE` keyed on
--       `org_id IS NULL OR org_id = current_organization_id()`.
--
--   regulatory_data.master_plan_zones
--     The Bengaluru master-plan zone catalog (no `org_id`). Public
--     reference data — every tenant should read the same Bengaluru
--     zoning facts. Writes happen via the postgres-role bypass during
--     extraction; no PostgREST mutator should touch this.
--     → SELECT-only `USING (true)`.
--
--   regulatory_data.planning_districts
--     Reference table mapping district codes (RR, EC, NW, …). Public
--     reference data, no `org_id`.
--     → SELECT-only `USING (true)`.
--
--   regulatory_data.zone_versions
--     Append-only audit log of zone amendments. No `org_id`. Visibility
--     is fine for any tenant; writes happen via postgres-role bypass.
--     → SELECT-only `USING (true)`.
--
-- Three tables (`master_plan_zones`, `planning_districts`, `zone_versions`)
-- live under `regulatory_data` which Supabase doesn't expose to PostgREST
-- by default — so the policies are belt-and-suspenders, but they make
-- intent explicit and pre-empt a future schema-exposure flip.
--
-- Idempotent: DROP POLICY IF EXISTS / CREATE POLICY pairs.
-- Safe to re-run.
-- ============================================================================

BEGIN;

-- ── public.exchange_rate_fetch_log — explicit deny-all ──────────────────────
DROP POLICY IF EXISTS exchange_rate_fetch_log_no_postgrest_access
  ON public.exchange_rate_fetch_log;
CREATE POLICY exchange_rate_fetch_log_no_postgrest_access
  ON public.exchange_rate_fetch_log
  FOR ALL
  TO authenticated, anon
  USING (false);

-- ── regulatory_data.master_plan_documents — global-or-tenant ───────────────
DROP POLICY IF EXISTS master_plan_documents_org_scope
  ON regulatory_data.master_plan_documents;
CREATE POLICY master_plan_documents_org_scope
  ON regulatory_data.master_plan_documents
  FOR ALL
  USING (org_id IS NULL OR org_id = (SELECT public.current_organization_id()))
  WITH CHECK (org_id IS NULL OR org_id = (SELECT public.current_organization_id()));

-- ── regulatory_data.master_plan_zones — SELECT-only public reference ───────
DROP POLICY IF EXISTS master_plan_zones_read
  ON regulatory_data.master_plan_zones;
CREATE POLICY master_plan_zones_read
  ON regulatory_data.master_plan_zones
  FOR SELECT
  USING (true);

-- ── regulatory_data.planning_districts — SELECT-only public reference ──────
DROP POLICY IF EXISTS planning_districts_read
  ON regulatory_data.planning_districts;
CREATE POLICY planning_districts_read
  ON regulatory_data.planning_districts
  FOR SELECT
  USING (true);

-- ── regulatory_data.zone_versions — SELECT-only audit history ──────────────
DROP POLICY IF EXISTS zone_versions_read
  ON regulatory_data.zone_versions;
CREATE POLICY zone_versions_read
  ON regulatory_data.zone_versions
  FOR SELECT
  USING (true);

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT n.nspname || '.' || c.relname AS rel,
--          c.relrowsecurity,
--          (SELECT count(*) FROM pg_policies p
--             WHERE p.schemaname = n.nspname AND p.tablename = c.relname) AS policies
--     FROM pg_class c
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE (n.nspname = 'public' AND c.relname = 'exchange_rate_fetch_log')
--       OR (n.nspname = 'regulatory_data' AND c.relname IN
--           ('master_plan_documents', 'master_plan_zones',
--            'planning_districts', 'zone_versions'));
--   -- expect: every row has policies >= 1
--
--   Or via Supabase MCP:
--     get_advisors(type: "security") → rls_enabled_no_policy count: 5 → 0
