-- 20260602_properties_auto_derived_context_columns.sql
--
-- Adds dedicated columns to public.properties to persist the full payload
-- the AutoFillParcelContextCard (PR #376) returns from
-- GET /api/properties/auto-derive-context (PR #375).
--
-- Before this migration: the AutoFillCard's Apply handler only persisted
-- lat/lng via the generic propertyService.updateProperty. The other 4
-- picks (BBMP ward, BBMP zone + guidance band, planning district, K-GIS
-- taluk/village) were toast-acknowledged but not stored — so reopening
-- the deal showed the same empty downstream surfaces.
--
-- After this migration + PR-1's service code: every Apply persists all 6
-- picks. Downstream surfaces (DealStreetLookupCard / DealPlanningContextCard
-- / MasterPlanZonePanel) read from these columns when the editable
-- user-controlled equivalents are null, so the auto-derive payload makes
-- it through to the deal page on first paint.
--
-- Also unblocks PR-C6 (reverse search "all deals in Zone D / PD-11 /
-- Ward 84") by giving the dropdowns indexed columns to pivot on.
--
-- Idempotent — `ADD COLUMN IF NOT EXISTS` for every column.
-- Re-runnable. No data is destroyed.

BEGIN;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS auto_derived_lat                NUMERIC,
  ADD COLUMN IF NOT EXISTS auto_derived_lng                NUMERIC,
  ADD COLUMN IF NOT EXISTS auto_derived_ward_no            INT,
  ADD COLUMN IF NOT EXISTS auto_derived_zone_code          TEXT,
  ADD COLUMN IF NOT EXISTS auto_derived_guidance_min_inr   NUMERIC,
  ADD COLUMN IF NOT EXISTS auto_derived_guidance_max_inr   NUMERIC,
  ADD COLUMN IF NOT EXISTS auto_derived_pd_code            TEXT,
  ADD COLUMN IF NOT EXISTS auto_derived_pd_name            TEXT,
  ADD COLUMN IF NOT EXISTS auto_derived_taluk              TEXT,
  ADD COLUMN IF NOT EXISTS auto_derived_village            TEXT,
  ADD COLUMN IF NOT EXISTS auto_derived_at                 TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_derived_by                 UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_derived_source             JSONB;

-- Partial indexes for PR-C6 reverse search. WHERE clauses keep the index
-- small (only deals where auto-derive has fired) and let the planner use
-- index-only scans for the filter dropdowns.
CREATE INDEX IF NOT EXISTS idx_properties_auto_derived_zone
  ON public.properties(auto_derived_zone_code)
  WHERE auto_derived_zone_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_properties_auto_derived_pd
  ON public.properties(auto_derived_pd_code)
  WHERE auto_derived_pd_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_properties_auto_derived_ward
  ON public.properties(auto_derived_ward_no)
  WHERE auto_derived_ward_no IS NOT NULL;

-- Verification: should print the 13 new columns + 3 new indexes.
SELECT
  COUNT(*) FILTER (WHERE column_name LIKE 'auto_derived_%')::int AS new_columns
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'properties';

COMMIT;
