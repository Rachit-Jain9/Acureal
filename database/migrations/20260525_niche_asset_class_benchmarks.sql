-- 20260525_niche_asset_class_benchmarks.sql
-- =============================================================================
-- Schema scaffold for the four niche asset classes the v0.2 rate-pack and
-- existing _benchmarks tables don't cover:
--   • Co-working / managed office (per-seat / per-desk pricing)
--   • Student housing / co-living (per-bed monthly rates)
--   • Senior living (entry capital + monthly fees)
--   • Data centers (MW capacity, operator footprint)
--
-- These four share the (micro-market × metric × value × source × data_type)
-- shape that residential_segmented_benchmarks pioneered, so they live in one
-- table. The UI's Section 5g card filters by asset_class chip, the same way
-- Section 5e splits residential_segmented.
--
-- This migration is INTENTIONALLY DATA-FREE. CLAUDE.md hard rule: never
-- fabricate market facts. The table is created empty; the operator drops an
-- IPC report PDF or broker quote into the comps review queue and the
-- extraction pipeline (see backend/src/services/ai/extractionPrompts.js)
-- writes verified rows here.
--
-- Methodology rule (TODO_DATA.md):
--   "Listing portals / IPC benchmarks / Internal verified / Guidance value
--    must be visually distinct."
-- The data_type column carries the source-layer prefix
-- (`listing_*` / `ipc_*` / `internal_*` / `verified_*`) so the UI can render
-- the right per-row badge.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS public.niche_asset_class_benchmarks (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID            NOT NULL,

  city              TEXT            NOT NULL,
  micro_market      TEXT            NOT NULL,
  zone_cluster      TEXT,
  asset_class       TEXT            NOT NULL
                                      CHECK (asset_class IN (
                                        'coworking',
                                        'student_housing',
                                        'senior_living',
                                        'data_center'
                                      )),
  -- Per-class metrics (free-form so the same table can hold per-seat,
  -- per-bed, entry-capital, MW-capacity etc. without a second migration
  -- when a new class adds a metric):
  --   coworking:        'per_seat_open_inr_month' | 'per_seat_dedicated_inr_month'
  --                     | 'per_office_inr_month' | 'occupancy_pct'
  --   student_housing:  'per_bed_single_inr_month' | 'per_bed_double_inr_month'
  --                     | 'per_bed_triple_inr_month' | 'occupancy_pct'
  --   senior_living:    'entry_capital_inr_lakh' | 'monthly_fee_inr_month'
  --                     | 'unit_size_sqft' | 'occupancy_pct'
  --   data_center:      'capacity_mw' | 'colo_per_kw_inr_month'
  --                     | 'powered_shell_per_sqft_inr' | 'land_acres'
  metric            TEXT            NOT NULL,
  unit              TEXT            NOT NULL,

  value_low         NUMERIC,
  value_high        NUMERIC,
  value_avg         NUMERIC,
  qoq_change_pct    NUMERIC,
  yoy_change_pct    NUMERIC,

  -- Asset-class-specific context. Sparse on purpose — most rows fill
  -- only what's relevant to their class (e.g. operator_name on data
  -- centers, brand_name on co-working / student housing).
  operator_name     TEXT,
  brand_name        TEXT,
  property_name     TEXT,
  unit_count        INTEGER,
  total_seats       INTEGER,
  total_beds        INTEGER,
  total_units       INTEGER,

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

CREATE INDEX IF NOT EXISTS niche_asset_class_benchmarks_org_city_idx
  ON public.niche_asset_class_benchmarks (organization_id, city);

CREATE INDEX IF NOT EXISTS niche_asset_class_benchmarks_asset_class_idx
  ON public.niche_asset_class_benchmarks (asset_class);

CREATE INDEX IF NOT EXISTS niche_asset_class_benchmarks_data_type_idx
  ON public.niche_asset_class_benchmarks (data_type);

CREATE INDEX IF NOT EXISTS niche_asset_class_benchmarks_operator_idx
  ON public.niche_asset_class_benchmarks (operator_name)
  WHERE operator_name IS NOT NULL;

-- Composite uniqueness so re-uploading the same source PDF doesn't
-- create dupes: same org × city × micro-market × class × metric ×
-- source-layer × asof-date is the natural key.
CREATE UNIQUE INDEX IF NOT EXISTS niche_asset_class_benchmarks_unique_idx
  ON public.niche_asset_class_benchmarks (
    organization_id, city, micro_market, asset_class, metric, data_type, as_of_date
  );

ALTER TABLE public.niche_asset_class_benchmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "niche_asset_class_benchmarks_select_org" ON public.niche_asset_class_benchmarks;
CREATE POLICY "niche_asset_class_benchmarks_select_org" ON public.niche_asset_class_benchmarks
  FOR SELECT
  USING (organization_id = current_setting('redip.organization_id', true)::uuid);

DROP POLICY IF EXISTS "niche_asset_class_benchmarks_modify_org" ON public.niche_asset_class_benchmarks;
CREATE POLICY "niche_asset_class_benchmarks_modify_org" ON public.niche_asset_class_benchmarks
  FOR ALL
  USING (organization_id = current_setting('redip.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('redip.organization_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.niche_asset_class_benchmarks TO authenticated;

COMMENT ON TABLE public.niche_asset_class_benchmarks IS
  'Source-of-truth benchmarks for the four niche asset classes (co-working, '
  'student housing, senior living, data centers) the existing _benchmarks tables '
  'do not cover. Populated via IPC-report / broker-quote uploads through the '
  'comps review queue. RLS-scoped per organization, idempotent on the natural '
  'key (org × city × micro_market × asset_class × metric × data_type × as_of_date).';

COMMIT;
