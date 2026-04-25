-- REDIP Parcel Intelligence Phase 1.1
-- Quick-verdict support, future spatial joins, and parcel identifier fields.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION
  WHEN insufficient_privilege OR undefined_file THEN
    RAISE NOTICE 'PostGIS extension unavailable in this database; spatial geometry columns will be skipped.';
END $$;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS pid VARCHAR(120),
  ADD COLUMN IF NOT EXISTS khata_no VARCHAR(120),
  ADD COLUMN IF NOT EXISTS bhoomi_id VARCHAR(120),
  ADD COLUMN IF NOT EXISTS rera_registration_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS frontage_mtrs NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS depth_mtrs NUMERIC(8,2);

ALTER TABLE regulatory_data.far_rules
  ADD COLUMN IF NOT EXISTS tdr_eligible BOOLEAN,
  ADD COLUMN IF NOT EXISTS premium_far_cap NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS tdr_road_threshold_m NUMERIC(8,2);

CREATE INDEX IF NOT EXISTS idx_properties_survey_city
  ON properties(organization_id, city, survey_number)
  WHERE survey_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_properties_pid
  ON properties(organization_id, pid)
  WHERE pid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_properties_khata_no
  ON properties(organization_id, khata_no)
  WHERE khata_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_properties_rera_registration
  ON properties(organization_id, rera_registration_number)
  WHERE rera_registration_number IS NOT NULL;

DO $$
DECLARE
  postgis_schema TEXT;
BEGIN
  SELECT n.nspname
    INTO postgis_schema
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE t.typname = 'geometry'
  LIMIT 1;

  IF postgis_schema IS NOT NULL THEN
    EXECUTE format('ALTER TABLE properties ADD COLUMN IF NOT EXISTS geom %I.geometry(Point, 4326)', postgis_schema);
    EXECUTE format('ALTER TABLE regulatory_data.master_plan_zones ADD COLUMN IF NOT EXISTS geom %I.geometry(MultiPolygon, 4326)', postgis_schema);

    EXECUTE format($sql$
      UPDATE properties
      SET geom = %I.ST_SetSRID(%I.ST_MakePoint(lng::double precision, lat::double precision), 4326)
      WHERE lat IS NOT NULL
        AND lng IS NOT NULL
        AND geom IS NULL
    $sql$, postgis_schema, postgis_schema);

    EXECUTE format($sql$
      CREATE OR REPLACE FUNCTION sync_property_geom()
      RETURNS TRIGGER AS $fn$
      BEGIN
        IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
          NEW.geom := %I.ST_SetSRID(%I.ST_MakePoint(NEW.lng::double precision, NEW.lat::double precision), 4326);
        ELSE
          NEW.geom := NULL;
        END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    $sql$, postgis_schema, postgis_schema);

    DROP TRIGGER IF EXISTS trg_properties_sync_geom ON properties;
    CREATE TRIGGER trg_properties_sync_geom
      BEFORE INSERT OR UPDATE OF lat, lng ON properties
      FOR EACH ROW EXECUTE FUNCTION sync_property_geom();

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_properties_geom ON properties USING gist(geom) WHERE geom IS NOT NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_master_plan_zones_geom ON regulatory_data.master_plan_zones USING gist(geom) WHERE geom IS NOT NULL';
  END IF;
END $$;
