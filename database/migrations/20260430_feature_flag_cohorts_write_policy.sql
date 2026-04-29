-- ============================================================================
-- 0032 — Tighten the feature_flag_cohorts write policy
-- ============================================================================
-- Closes the `rls_policy_always_true` WARN-severity advisor lint surfaced
-- in the 2026-04-29 audit.
--
-- Existing policy on `public.feature_flag_cohorts`:
--   policyname: feature_flag_cohorts_write
--   cmd:        ALL  (i.e. INSERT/UPDATE/DELETE)
--   roles:      {public}
--   USING:      true
--   WITH CHECK: true
--
-- This effectively grants every PostgREST-bound role unlimited write access
-- to the feature-flag table. REDIP's frontend doesn't go through PostgREST
-- (the Express backend connects via DATABASE_URL as the `postgres` role,
-- which bypasses RLS), so this policy adds no useful access — it only
-- removes a fence.
--
-- Drop the write policy entirely. Backend writes continue to work because
-- `postgres` bypasses RLS. Any future PostgREST-bound write attempt is
-- denied by the absence of a matching policy.
--
-- The companion read policy (`feature_flag_cohorts_read` / `USING (true)`)
-- is intentionally preserved: feature flags by design need to be readable
-- without authentication so the public landing page can ask the cohort
-- service whether to show a beta banner. The advisor only flags `USING(true)`
-- on write paths, not on SELECT.
--
-- Idempotent: DROP POLICY IF EXISTS.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS feature_flag_cohorts_write ON public.feature_flag_cohorts;

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT policyname, cmd, qual, with_check
--     FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'feature_flag_cohorts'
--    ORDER BY policyname;
--   -- expect exactly one row: feature_flag_cohorts_read / SELECT / true / null
