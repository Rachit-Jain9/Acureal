-- 20260508_residential_segmented_benchmarks_schema.sql
-- =============================================================================
-- Schema for residential asset classes that the existing benchmark tables can't
-- hold. The v0.2 rate-pack ships 5 such classes (builder floor, plotted dev,
-- land residential plotted, villa/house, guidance value) — they share shape
-- (micro-market × metric × value × source) so we put them in one table.
-- =============================================================================
--
-- Methodology rule (TODO_DATA.md):
--   "Create separate tabs/layers in the REDIP UI: Listing Benchmarks, IPC
--    Benchmarks, Guidance Value, Internal Deals. Blending them silently will
--    destroy credibility."
--
-- The 'data_type' column carries the layer ('listing_q1_2026_v0_2',
-- 'listing_q1_2026_v0_2_derived', 'guidance_q1_2026_v0_2_pending') so the UI
-- can split-by-layer rather than rolling everything into one number.

BEGIN;

CREATE TABLE IF NOT EXISTS public.residential_segmented_benchmarks (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID            NOT NULL,

  city              TEXT            NOT NULL,
  micro_market      TEXT            NOT NULL,
  zone_cluster      TEXT,
  asset_class       TEXT            NOT NULL
                                      CHECK (asset_class IN (
                                        'builder_floor',
                                        'plotted_development',
                                        'land_residential_plotted',
                                        'villa_house',
                                        'guidance_value'
                                      )),
  metric            TEXT            NOT NULL,
  unit              TEXT            NOT NULL,

  value_low         NUMERIC,
  value_high        NUMERIC,
  value_avg         NUMERIC,
  qoq_change_pct    NUMERIC,
  yoy_change_pct    NUMERIC,

  source            TEXT            NOT NULL,
  source_url        TEXT,
  data_type         TEXT            NOT NULL,
  data_period       TEXT,
  as_of_date        DATE            NOT NULL,
  is_verified       BOOLEAN         NOT NULL DEFAULT FALSE,
  verification_status TEXT,
  notes             TEXT,

  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS residential_segmented_benchmarks_org_city_idx
  ON public.residential_segmented_benchmarks (organization_id, city);

CREATE INDEX IF NOT EXISTS residential_segmented_benchmarks_asset_class_idx
  ON public.residential_segmented_benchmarks (asset_class);

CREATE INDEX IF NOT EXISTS residential_segmented_benchmarks_data_type_idx
  ON public.residential_segmented_benchmarks (data_type);

CREATE UNIQUE INDEX IF NOT EXISTS residential_segmented_benchmarks_unique_idx
  ON public.residential_segmented_benchmarks (organization_id, city, micro_market, asset_class, metric, data_type);

ALTER TABLE public.residential_segmented_benchmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "residential_segmented_benchmarks_select_org" ON public.residential_segmented_benchmarks;
CREATE POLICY "residential_segmented_benchmarks_select_org" ON public.residential_segmented_benchmarks
  FOR SELECT
  USING (organization_id = current_setting('redip.organization_id', true)::uuid);

DROP POLICY IF EXISTS "residential_segmented_benchmarks_modify_org" ON public.residential_segmented_benchmarks;
CREATE POLICY "residential_segmented_benchmarks_modify_org" ON public.residential_segmented_benchmarks
  FOR ALL
  USING (organization_id = current_setting('redip.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('redip.organization_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.residential_segmented_benchmarks TO authenticated;

COMMIT;
