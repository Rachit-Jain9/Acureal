-- ============================================================================
-- 20260627 — Clear the open Supabase advisor lints: spatial_ref_sys RLS ERROR
--            + three mutable-search_path functions (WARN)
-- ============================================================================
-- Two unrelated advisor classes, one paste:
--
-- (a) ERROR  rls_disabled_in_public — public.spatial_ref_sys is exposed via the
--     Data API with RLS off. It is the PostGIS EPSG reference (standard public
--     reference data), so a read-all SELECT policy is the correct resolution —
--     this clears the linter ERROR and documents intent. The table is owned by
--     `supabase_admin` (NOT the migration role), so ALTER TABLE ... ENABLE RLS
--     will raise "must be owner of table spatial_ref_sys". The whole block is
--     wrapped in DO $$ ... EXCEPTION WHEN OTHERS THEN RAISE NOTICE ... END $$ so
--     it no-ops with a notice on a role that doesn't own the PostGIS table
--     (same guard as 20260623). If it can't be applied here, run the three
--     statements once from the Supabase SQL editor as the dashboard owner.
--
-- (b) WARN  function_search_path_mutable — three REDIP-owned functions still
--     have an unpinned search_path (confirmed live: proconfig is unset on all
--     three). Same lockdown house style as 20260430_function_search_path_
--     lockdown: ALTER FUNCTION <exact-sig> SET search_path = public, pg_temp.
--       • regulatory_data.bbmp_street_index_touch_updated_at() — trigger, only
--         touches NEW.updated_at; no object lookups.
--       • public.touch_user_preferences_updated_at()           — trigger, only
--         touches NEW.updated_at; no object lookups.
--       • public._mig_load(text, text, jsonb, text[])           — migration
--         helper; reads information_schema.columns (already schema-qualified in
--         the body) and EXECUTEs a fully-qualified INSERT INTO %I.%I against
--         public AND regulatory_data targets. `public, pg_temp` covers it; the
--         dynamic SQL is %I.%I-qualified so the search_path never has to resolve
--         the target schema. (Not SECURITY DEFINER, so this is pure advisor
--         hygiene — no privilege boundary depends on it.)
--
-- NOTE — extensions-in-public (postgis / pg_trgm / vector) are LEFT ALONE. The
-- `extension_in_public` advisor suggests relocating them to a dedicated schema,
-- but moving an in-use extension is risky (rewrites every qualified reference,
-- can break PostGIS-aware functions like public.sync_property_geom and any
-- vector/<->/% operator usage). Out of scope here; track separately if ever
-- pursued, with a full dependency sweep first.
--
-- Idempotent: ENABLE RLS is a no-op when already on; DROP POLICY IF EXISTS
-- before CREATE; ALTER FUNCTION ... SET ... is idempotent. Paste-safe in the
-- Supabase SQL editor (no CONCURRENTLY).
-- ============================================================================

BEGIN;

-- ── (a) spatial_ref_sys: ENABLE RLS + read-all SELECT (guarded for non-owner) ─
DO $$
BEGIN
  ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS spatial_ref_sys_read ON public.spatial_ref_sys;
  CREATE POLICY spatial_ref_sys_read ON public.spatial_ref_sys FOR SELECT USING (true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'spatial_ref_sys RLS not applied (likely not owner): %', SQLERRM;
END $$;

-- ── (b) Pin search_path on the three mutable-search_path functions ──────────
ALTER FUNCTION regulatory_data.bbmp_street_index_touch_updated_at()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.touch_user_preferences_updated_at()
  SET search_path = public, pg_temp;

ALTER FUNCTION public._mig_load(text, text, jsonb, text[])
  SET search_path = public, pg_temp;

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   -- spatial_ref_sys now RLS-enabled with one read policy (if owner allowed it):
--   SELECT c.relrowsecurity AS rls_enabled,
--          (SELECT count(*) FROM pg_policies p
--            WHERE p.schemaname='public' AND p.tablename='spatial_ref_sys') AS policies
--     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE n.nspname='public' AND c.relname='spatial_ref_sys';
--
--   -- All three functions now carry a pinned search_path (expect 3 rows, each
--   -- config starting with {search_path=...}):
--   SELECT n.nspname||'.'||p.proname AS fn,
--          coalesce(array_to_string(p.proconfig, ', '), '(unset)') AS config
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE (n.nspname='regulatory_data' AND p.proname='bbmp_street_index_touch_updated_at')
--       OR (n.nspname='public' AND p.proname='touch_user_preferences_updated_at')
--       OR (n.nspname='public' AND p.proname='_mig_load')
--    ORDER BY fn;
-- ============================================================================
