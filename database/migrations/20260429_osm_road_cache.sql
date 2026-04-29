-- ──────────────────────────────────────────────────────────────────────────
-- T6 — OSM Overpass road-width cache.
-- Mirrors regulatory_data.kgis_cache: per-tenant cache of OSM Overpass API
-- responses for road-width inference around a parcel centroid. Confidence is
-- always tagged so downstream callers know this is an inference, not authority.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS regulatory_data.osm_road_cache (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID,                                          -- tenant scope; current_organization_id() at insert
  property_id         UUID REFERENCES properties(id) ON DELETE SET NULL,
  cache_key           TEXT NOT NULL,                                 -- "property:<uuid>:lat:<6dp>:lng:<6dp>:radius:<m>"
  provider_status     TEXT NOT NULL CHECK (provider_status IN ('matched','no_road_nearby','ambiguous','error','unknown')),
  request_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload    JSONB,                                         -- raw Overpass response
  inferred_width_m    NUMERIC(6,2),                                  -- best-guess width in metres
  inferred_lanes      INTEGER,                                       -- raw highway=*/lanes tag
  inferred_highway    TEXT,                                          -- e.g. 'tertiary', 'residential', 'unclassified'
  candidate_count     INTEGER NOT NULL DEFAULT 0,                    -- how many OSM ways were within radius
  confidence_score    NUMERIC(4,3) NOT NULL DEFAULT 0,
  expires_at          TIMESTAMPTZ,                                   -- 30d default; refresh sweeps purge expired rows
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cache_key, org_id)
);

CREATE INDEX IF NOT EXISTS osm_road_cache_property_idx
  ON regulatory_data.osm_road_cache (property_id);

CREATE INDEX IF NOT EXISTS osm_road_cache_expires_idx
  ON regulatory_data.osm_road_cache (expires_at)
  WHERE expires_at IS NOT NULL;

-- RLS: per-tenant read/write. Strictly tenant-scoped — no global rows.
ALTER TABLE regulatory_data.osm_road_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS osm_road_cache_tenant_select ON regulatory_data.osm_road_cache;
CREATE POLICY osm_road_cache_tenant_select
  ON regulatory_data.osm_road_cache
  FOR SELECT
  USING (org_id = current_organization_id());

DROP POLICY IF EXISTS osm_road_cache_tenant_modify ON regulatory_data.osm_road_cache;
CREATE POLICY osm_road_cache_tenant_modify
  ON regulatory_data.osm_road_cache
  FOR ALL
  USING (org_id = current_organization_id())
  WITH CHECK (org_id = current_organization_id());
