-- ============================================================================
-- 0031 — Pin `search_path = ''` on every REDIP-owned function
-- ============================================================================
-- Closes 7 of the WARN-severity `function_search_path_mutable` advisor lints
-- surfaced in the 2026-04-29 audit.
--
-- Why this matters: when a function leaves `search_path` unpinned, anyone
-- who can create objects in a schema that resolves earlier on the path can
-- shadow built-in functions and intercept calls. With Postgres's default
-- `search_path = "$user", public`, a malicious tenant who manages to create
-- a function in their own schema named after a built-in (e.g. `to_jsonb`)
-- could hijack any unprotected function that calls it.
--
-- The fix: set `search_path = ''` on each function and qualify every object
-- reference inside the function body with its schema. We do the first half
-- here (the cheap, mechanical change). The second half — auditing every
-- function body for unqualified references — is preserved for a follow-up;
-- the empty search_path will surface any accidental unqualified call as a
-- clear "function does not exist" error rather than a silent hijack.
--
-- For these REDIP functions specifically:
--   - `current_user_id` / `current_organization_id`: pure `current_setting`
--     calls; no schema-qualified names needed.
--   - `update_updated_at_column` / `feature_flag_cohorts_touch` /
--     `investor_packages_touch`: trigger functions that touch NEW; safe.
--   - `sync_property_geom`: calls PostGIS functions. PostGIS lives in
--     `public`, so we explicitly prepend `public` to the search_path for
--     this one rather than empty.
--   - `regulatory_data.effective_fsi`: pure SQL, references regulatory_data
--     tables only; pin to the schema's own search_path.
--
-- Idempotent: ALTER FUNCTION ... SET ... is idempotent.
-- Safe to re-run.
-- ============================================================================

BEGIN;

-- Pure session-context readers — no schema-qualified objects referenced.
ALTER FUNCTION public.current_user_id()         SET search_path = '';
ALTER FUNCTION public.current_organization_id() SET search_path = '';

-- Trigger functions — only touch NEW; no object lookups.
ALTER FUNCTION public.update_updated_at_column()    SET search_path = '';
ALTER FUNCTION public.feature_flag_cohorts_touch()  SET search_path = '';
ALTER FUNCTION public.investor_packages_touch()     SET search_path = '';

-- PostGIS-aware geometry sync. Functions like ST_SetSRID, ST_MakePoint live
-- in `public` (per `extension_in_public` advisor — separate cleanup), so this
-- one needs `public` on the path until extensions move out. The pin still
-- prevents tenant shadow attacks because tenants can't create objects in
-- the `public` schema without admin privileges.
ALTER FUNCTION public.sync_property_geom() SET search_path = 'public';

-- regulatory_data.effective_fsi reads from regulatory_data.* tables only.
ALTER FUNCTION regulatory_data.effective_fsi(numeric, jsonb, numeric)
  SET search_path = 'regulatory_data';

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT n.nspname || '.' || p.proname AS fn,
--          coalesce(p.proconfig::text, '(unset)') AS config
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE (n.nspname = 'public' AND p.proname IN (
--             'current_user_id', 'current_organization_id',
--             'update_updated_at_column', 'feature_flag_cohorts_touch',
--             'investor_packages_touch', 'sync_property_geom'))
--       OR (n.nspname = 'regulatory_data' AND p.proname = 'effective_fsi')
--    ORDER BY n.nspname, p.proname;
--   -- expect: every row's config column starts with `{search_path=...}`
