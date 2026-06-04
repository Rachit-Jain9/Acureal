-- 20260630_deal_rera_inputs.sql
--
-- Adds a single JSONB column `deals.rera_inputs` for the small bundle of
-- operator-supplied facts the Karnataka RERA applicability engine needs but
-- the deal does not otherwise store: unit/plot count, sale-intent, target
-- completion date, and an optional fee-category/amount override.
--
-- Why a JSONB column (not new typed columns or a side table):
--   • The inputs are a small, RERA-specific, still-evolving bundle. Typed
--     columns would mean a migration per future field; a side table would add
--     an RLS surface + a join for ~4 scalars.
--   • The deterministic workspace cache (20260629) recomputes its version_key
--     from `deals.updated_at` directly, so editing this column already
--     invalidates the cache with NO change to that table's allowlist.
--
-- Shape (every key optional; absence => the engine stays threshold-only and
-- conservatively reports applicability as "uncertain", never "exempt"):
--   {
--     "unit_or_plot_count": <int>,
--     "sale_intent": <bool>,
--     "completion_date": "YYYY-MM-DD",
--     "fee_overrides": { "category": <str>, "amount_inr": <num>, "note": <str> }
--   }
--
-- Idempotent — `ADD COLUMN IF NOT EXISTS`. Re-runnable. No data destroyed.
-- Migration-tolerant: the app reads `deal.rera_inputs || {}`, so it degrades to
-- threshold-only behaviour when the column is absent. A DROP COLUMN is a
-- complete rollback.
--
-- Operator action required: apply via the Supabase SQL editor.
--   🌐 https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new
--   📋 paste this whole file → Run → expect "Success. No rows returned."

BEGIN;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS rera_inputs JSONB;

COMMENT ON COLUMN public.deals.rera_inputs IS
  'K-RERA applicability inputs: { unit_or_plot_count, sale_intent, completion_date, fee_overrides }. All optional; absence => threshold-only / uncertain.';

-- Verification: should print 1 (the new column exists).
SELECT
  COUNT(*)::int AS rera_inputs_column
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'deals'
  AND column_name = 'rera_inputs';

COMMIT;
