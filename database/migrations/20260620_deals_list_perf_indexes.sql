-- ============================================================================
-- 20260620 — Composite indexes for the deals-list per-deal rollups
-- ============================================================================
-- The deals list (`getDeals`) returns one row per deal, each carrying ~8
-- correlated-subquery rollups (pending required DD, deal-breakers, overdue
-- DD, open high-severity risks, new risk flags, last activity). Today each of
-- those subqueries can only use a single-column `deal_id` index, then filters
-- is_required / status / severity / activity_date in memory. On an org with
-- many DD items, risks and activities per deal, that is wasted work on every
-- list load.
--
-- These three composite indexes let each hot subquery satisfy its full
-- predicate (or a useful prefix) straight from the index:
--   * dd_items   (deal_id, is_required, status)  — pending_required_dd_count,
--       pending_deal_breakers (prefix), overdue_dd_count (prefix)
--   * risk_flags (deal_id, status, severity)      — open_high_risk_count;
--       the (deal_id, status) prefix also helps new_risk_flag_count
--   * activities (deal_id, activity_date DESC)     — last_activity_date
--       (ORDER BY activity_date DESC LIMIT 1 per deal -> single index seek)
--
-- Naming convention: idx_<table>_<columns>.
--
-- Plain `CREATE INDEX` (NOT CONCURRENTLY), wrapped in a single BEGIN/COMMIT so
-- this file is paste-safe in the Supabase SQL editor (which auto-wraps every
-- statement in a transaction — incompatible with CONCURRENTLY). Brief
-- table-level write locks during creation are acceptable at REDIP's current
-- volumes; if a table grows past ~100k rows where a multi-second lock matters,
-- drop and recreate that one index later via psql with CONCURRENTLY.
--
-- IF NOT EXISTS guards every CREATE, so re-running after partial application
-- is a no-op.
-- ============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_dd_items_deal_required_status
  ON public.dd_items (deal_id, is_required, status);

CREATE INDEX IF NOT EXISTS idx_risk_flags_deal_status_severity
  ON public.risk_flags (deal_id, status, severity);

CREATE INDEX IF NOT EXISTS idx_activities_deal_id_date
  ON public.activities (deal_id, activity_date DESC);

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT indexname FROM pg_indexes
--    WHERE tablename IN ('dd_items','risk_flags','activities')
--      AND indexname IN (
--        'idx_dd_items_deal_required_status',
--        'idx_risk_flags_deal_status_severity',
--        'idx_activities_deal_id_date'
--      );
--   -- expect: 3 rows
--
--   Then confirm a rollup uses the new index:
--     EXPLAIN ANALYZE SELECT count(*) FROM dd_items
--      WHERE deal_id = '<id>' AND is_required = TRUE
--        AND status NOT IN ('completed','not_applicable');
--   -- expect: Index Scan using idx_dd_items_deal_required_status
-- ============================================================================
