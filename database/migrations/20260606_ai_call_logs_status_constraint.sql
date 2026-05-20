-- ============================================================================
-- 20260606 — Widen ai_call_logs.status CHECK to allow cache_hit + cost_capped
-- ============================================================================
-- The original ai_call_logs table (20260426) constrained `status` to
-- ('success','error','timeout','skipped'). The AI router later started
-- writing two more status values that the constraint never grew to match:
--
--   • 'cache_hit'   — response served from ai_response_cache (20260509); the
--                     provider was never called. Written by aiRouter.js.
--   • 'cost_capped' — the per-org daily cost cap blocked the call before it
--                     reached the provider. Written by aiRouter.js.
--
-- Because the CHECK never matched, every cache_hit and cost_capped INSERT was
-- silently rejected (persistCallLog swallows the write error so a logging
-- failure can't break an AI call). Visible symptoms:
--   • the AI Usage "Cache Hit Rate" card reads 0.0% even on cached workloads;
--   • the AI Provider Health success rate cannot credit cache hits.
--
-- This migration widens the constraint to the full set the code actually
-- writes. Existing rows are unaffected — the new set is a strict superset of
-- the old one, so the ADD CONSTRAINT validates cleanly against all history.
--
-- Idempotent: the DO block drops whatever CHECK constraint currently governs
-- `status` (regardless of its auto-generated name), then re-adds the canonical
-- one. Safe to re-run.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.ai_call_logs'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.ai_call_logs DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.ai_call_logs
  ADD CONSTRAINT ai_call_logs_status_check
  CHECK (status IN ('success','error','timeout','skipped','cache_hit','cost_capped'));

COMMIT;

-- ── Verification (run as a separate query) ──────────────────────────────────
--   SELECT pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'public.ai_call_logs'::regclass
--      AND conname = 'ai_call_logs_status_check';
--   -- expect the array to include 'cache_hit' and 'cost_capped'
