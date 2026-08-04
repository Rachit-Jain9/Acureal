-- 20260807_geocode_cache_write_policy.sql
--
-- Restore the geocode cache's ability to write to itself.
--
-- THE DEFECT. public.geocode_cache has RLS ENABLED but carries exactly ONE
-- policy: geocode_cache_select_all (SELECT USING true). Under the pre-flip
-- postgres role that was invisible — BYPASSRLS made every INSERT/UPDATE
-- succeed anyway. Since the M1 flip (2026-07-28) the app connects as
-- redip_app, RLS applies, and every cache write has been silently denied.
-- geocode.js wraps the write in a non-fatal catch ("[Geocode] Cache write
-- error (non-fatal)"), so nothing crashed: the cache simply stopped
-- refreshing, and every geocode after an entry's 30-day expiry pays a live
-- Google call. Found 2026-08-04 while auditing the RLS posture of every table
-- the public /parcel resolver touches.
--
-- THE FIX. The cache is deliberately GLOBAL reference data — keyed on
-- cache_key only, no org column, readable by design (its SELECT policy is
-- already USING true). Writes get the same posture: any request may insert or
-- refresh an entry. There is nothing tenant-scoped to protect; the value being
-- cached is a public geocoder's answer to an address string.
--
-- Idempotent; safe to re-run.

BEGIN;

DROP POLICY IF EXISTS geocode_cache_write_app ON public.geocode_cache;
CREATE POLICY geocode_cache_write_app
  ON public.geocode_cache
  FOR INSERT
  TO public
  WITH CHECK (true);

DROP POLICY IF EXISTS geocode_cache_update_app ON public.geocode_cache;
CREATE POLICY geocode_cache_update_app
  ON public.geocode_cache
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

-- The cron sweep (parcelCron) prunes expired rows.
DROP POLICY IF EXISTS geocode_cache_delete_app ON public.geocode_cache;
CREATE POLICY geocode_cache_delete_app
  ON public.geocode_cache
  FOR DELETE
  TO public
  USING (true);

COMMIT;
