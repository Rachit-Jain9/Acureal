-- ============================================================================
-- 20260720_yield_studio_persistence.sql
-- ----------------------------------------------------------------------------
-- Yield Studio — server-side persistence for (1) a parcel BOUNDARY uploaded or
-- drawn by an analyst, and (2) a saved Yield Studio STUDY (envelope +
-- assumptions) per deal.
--
-- WHY THIS EXISTS:
--   Yield Studio today reads a read-only K-GIS boundary and keeps the analyst's
--   study in browser localStorage. To let users UPLOAD their own boundary
--   (.geojson/.kml), share a study across devices/teammates, and embed the
--   programme in IC/Excel/PPT exports (rendered server-side), the boundary +
--   study must live in the database. These two tenant-scoped tables add exactly
--   that — nothing more.
--
-- DESIGN:
--   - parcel_boundaries : one active boundary per (org, property). Stores the
--                         GeoJSON + its deterministic geodesic area + provenance
--                         (source/confidence/review). GeoJSON-as-JSONB (not a
--                         PostGIS geom column) is deliberate for v1 — display +
--                         area + export need no spatial query; a geom(MultiPolygon,
--                         4326) + GiST can be layered on later for comp-distance
--                         work without reshaping this table.
--   - yield_studies     : one active study per (org, deal). Envelope +
--                         assumptions as JSONB, plus the selected scenario. The
--                         committed financial prefill still flows via
--                         "Apply to Financials"; this persists the working study.
--
-- RLS posture: pure tenant data (no global reference rows) → ENABLE + FORCE ROW
--   LEVEL SECURITY with a single org-scoped policy (USING + WITH CHECK on
--   organization_id = current_organization_id()). current_organization_id()
--   lives in the public schema — call it bare. FORCE matches REDIP's
--   strict multi-tenant posture (the table owner does not bypass).
--
-- Soft delete: deleted_at / deleted_by, matching 20260719_entity_soft_delete.
--   The UNIQUE "one active row" indexes are partial on deleted_at IS NULL so a
--   replaced boundary/study can be soft-deleted and a new one inserted.
--
-- Idempotent: CREATE ... IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, DROP POLICY
--   IF EXISTS before CREATE POLICY. Safe to re-run. No CONCURRENTLY (safe to
--   paste into the Supabase SQL editor, which wraps each run in a transaction).
--
-- Rollback: DROP TABLE public.yield_studies; DROP TABLE public.parcel_boundaries;
--   No existing data is touched.
-- ============================================================================

BEGIN;

-- ── 1. parcel_boundaries — uploaded / drawn parcel geometry ─────────────────
CREATE TABLE IF NOT EXISTS public.parcel_boundaries (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL DEFAULT current_organization_id()
                       REFERENCES organizations(id) ON DELETE CASCADE,
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  deal_id           UUID REFERENCES deals(id) ON DELETE SET NULL,
  source            TEXT NOT NULL DEFAULT 'manual'
                       CHECK (source IN ('geojson','kml','kmz','shapefile','dxf','drawn','kgis','manual')),
  geometry_geojson  JSONB NOT NULL,
  area_sqft         NUMERIC,
  crs               TEXT DEFAULT 'EPSG:4326',
  confidence_score  NUMERIC(4,3) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  review_status     TEXT NOT NULL DEFAULT 'pending'
                       CHECK (review_status IN ('pending','approved','rejected','needs_review')),
  notes             TEXT,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  deleted_by        UUID REFERENCES users(id) ON DELETE SET NULL
);

-- One active boundary per property per org (replacements soft-delete the prior).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_parcel_boundaries_active
  ON public.parcel_boundaries (organization_id, property_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_parcel_boundaries_property
  ON public.parcel_boundaries (property_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_parcel_boundaries_deal
  ON public.parcel_boundaries (deal_id) WHERE deleted_at IS NULL;

-- ── 2. yield_studies — saved Yield Studio study per deal ────────────────────
CREATE TABLE IF NOT EXISTS public.yield_studies (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL DEFAULT current_organization_id()
                       REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id           UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  property_id       UUID REFERENCES properties(id) ON DELETE SET NULL,
  asset_class       TEXT,
  envelope          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { landAreaSqft, effectiveFsi, groundCoveragePct, allowedHeightM }
  assumptions       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- editable screening assumptions
  selected_scenario TEXT,                                 -- 'base' | 'cons' | 'opt'
  engine_version    TEXT,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  deleted_by        UUID REFERENCES users(id) ON DELETE SET NULL
);

-- One active study per deal per org (v1). Drop this + add a `name` column later
-- to support multiple named studies per deal.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_yield_studies_active
  ON public.yield_studies (organization_id, deal_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_yield_studies_deal
  ON public.yield_studies (deal_id) WHERE deleted_at IS NULL;

-- ── 3. RLS — strict tenant isolation (ENABLE + FORCE) ───────────────────────
ALTER TABLE public.parcel_boundaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcel_boundaries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.yield_studies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yield_studies     FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parcel_boundaries_org ON public.parcel_boundaries;
CREATE POLICY parcel_boundaries_org ON public.parcel_boundaries
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS yield_studies_org ON public.yield_studies;
CREATE POLICY yield_studies_org ON public.yield_studies
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

COMMIT;

-- ── Verification (run after apply; both should return the new tables) ───────
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name IN ('parcel_boundaries','yield_studies');
-- SELECT tablename, rowsecurity, forcerowsecurity FROM pg_tables
--   WHERE schemaname = 'public' AND tablename IN ('parcel_boundaries','yield_studies');
