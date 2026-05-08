-- ============================================================================
-- 0062 — comps.geocode_quality: track per-comp geocoding precision
-- ============================================================================
-- Up to now, every comp's lat/lng on the Comps map sat at a locality
-- centroid (e.g., all Whitefield comps stacked at one (lat, lng) pair
-- per migration 20260508_geocode_unmapped_comps.sql + 20260508_geocode_basket_localities.sql).
-- The cluster-pin UI from PR #169 was a workaround for that artificial
-- stacking. To upgrade the map to project-precise pins (Tier-1 #10 in
-- the 2026-05-08 handoff), we need to know which rows are still at the
-- coarse centroid and which have been upgraded.
--
-- This migration adds a single text column with a clear taxonomy:
--   • rooftop            — Google API ROOFTOP (street-address-precise)
--   • range_interpolated — Google API RANGE_INTERPOLATED
--   • geometric_center   — Google API GEOMETRIC_CENTER (sub-locality polygon)
--   • approximate        — Google API APPROXIMATE (broader area)
--   • locality_centroid  — historical bulk geocode: lat/lng = locality center
--   • manual             — reviewer set lat/lng directly via the comps queue
--   • NULL               — ungeocoded (lat/lng IS NULL)
--
-- The standalone script `scripts/upgrade-comps-geocoding.mjs` walks rows
-- in (locality_centroid, NULL, approximate) and upgrades them via the
-- Google API. Rows in (rooftop, range_interpolated, manual) are
-- already as good as we can make them and the script skips them.
--
-- Backfill: existing comps with non-null lat/lng are tagged
-- 'locality_centroid' since that's the only path that wrote to lat/lng
-- before now (the queue's commit path lands on master in the same
-- release as this column, so we can't have manual rows pre-dating it).
-- Idempotent — every operation guarded by IF NOT EXISTS.
-- ============================================================================

BEGIN;

ALTER TABLE public.comps
  ADD COLUMN IF NOT EXISTS geocode_quality TEXT
    CHECK (geocode_quality IS NULL OR geocode_quality IN (
      'rooftop',
      'range_interpolated',
      'geometric_center',
      'approximate',
      'locality_centroid',
      'manual'
    ));

-- Backfill: existing rows with coordinates are at locality centroids,
-- which is the only thing the historical bulk-geocode migrations did.
-- Run once; re-runs are no-ops because we filter on IS NULL.
UPDATE public.comps
   SET geocode_quality = 'locality_centroid'
 WHERE geocode_quality IS NULL
   AND lat IS NOT NULL
   AND lng IS NOT NULL;

-- Index on (geocode_quality) so the upgrade script's "find rows to
-- improve" scan is cheap even at scale. Partial: only rows that
-- could BENEFIT from re-geocoding live in the index. rooftop /
-- range_interpolated / manual rows aren't worth touching, so they
-- don't need to be in the index.
CREATE INDEX IF NOT EXISTS comps_geocode_quality_upgradable_idx
  ON public.comps (geocode_quality)
  WHERE geocode_quality IS NULL
     OR geocode_quality IN ('locality_centroid', 'approximate');

COMMENT ON COLUMN public.comps.geocode_quality IS
  'Precision of (lat, lng): rooftop | range_interpolated | geometric_center | approximate | locality_centroid | manual | NULL. Used by scripts/upgrade-comps-geocoding.mjs to find upgradable rows.';

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT geocode_quality, COUNT(*)
--     FROM public.comps
--    GROUP BY geocode_quality
--    ORDER BY 1;
--   -- Expect: locality_centroid for ~80 existing rows, NULL for any rows
--   -- without coords, no other values until the upgrade script runs.
