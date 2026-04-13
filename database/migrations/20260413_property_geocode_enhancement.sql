-- Migration: Enhance property table with full geocoding metadata
-- Date: 2026-04-13
-- Purpose: Stage 1 — first-class property model with Place ID, provider tracking,
--          manual pin override, formatted address, locality, and boundary support.

-- Add missing geocoding and address fields to properties
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS raw_input_address TEXT,
  ADD COLUMN IF NOT EXISTS formatted_address TEXT,
  ADD COLUMN IF NOT EXISTS locality VARCHAR(255),
  ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'India',
  ADD COLUMN IF NOT EXISTS place_id VARCHAR(500),
  ADD COLUMN IF NOT EXISTS geocode_provider VARCHAR(50),
  ADD COLUMN IF NOT EXISTS geocode_fetched_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS manual_pin_override BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS boundary_geojson JSONB,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Rename pincode to postal_code for clarity (add alias column, keep old for compat)
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS postal_code VARCHAR(10);

-- Backfill postal_code from pincode
UPDATE properties SET postal_code = pincode WHERE postal_code IS NULL AND pincode IS NOT NULL;

-- Backfill country for existing rows
UPDATE properties SET country = 'India' WHERE country IS NULL;

-- Backfill formatted_address from address + city + state where possible
UPDATE properties
SET formatted_address = TRIM(
  CONCAT_WS(', ',
    NULLIF(TRIM(address), ''),
    NULLIF(TRIM(city), ''),
    NULLIF(TRIM(state), ''),
    NULLIF(TRIM(pincode), ''),
    'India'
  )
)
WHERE formatted_address IS NULL
  AND (address IS NOT NULL OR city IS NOT NULL OR state IS NOT NULL);

-- Backfill raw_input_address = address for existing rows
UPDATE properties
SET raw_input_address = address
WHERE raw_input_address IS NULL AND address IS NOT NULL;

-- Backfill geocode_provider from geocode_status context
-- Existing rows don't have provider metadata; mark as unknown
UPDATE properties
SET geocode_provider = 'unknown'
WHERE geocode_provider IS NULL
  AND geocode_status IN ('verified', 'approximate', 'manual');

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_properties_place_id ON properties(place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_properties_locality ON properties(locality) WHERE locality IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_properties_geocode_provider ON properties(geocode_provider);
CREATE INDEX IF NOT EXISTS idx_properties_manual_pin ON properties(manual_pin_override) WHERE manual_pin_override = TRUE;

-- Add geocode cache table to avoid duplicate external calls
CREATE TABLE IF NOT EXISTS geocode_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cache_key VARCHAR(1000) NOT NULL UNIQUE, -- normalized address string
  place_id VARCHAR(500),
  lat DECIMAL(10, 7),
  lng DECIMAL(10, 7),
  formatted_address TEXT,
  locality VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(100),
  country VARCHAR(100),
  postal_code VARCHAR(20),
  provider VARCHAR(50) NOT NULL,
  confidence DECIMAL(5, 2),
  status VARCHAR(20) NOT NULL,
  raw_response JSONB,
  fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 days'),
  hit_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_geocode_cache_key ON geocode_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_geocode_cache_place_id ON geocode_cache(place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_geocode_cache_expires ON geocode_cache(expires_at);

COMMENT ON TABLE geocode_cache IS 'Server-side cache for geocoding results to avoid duplicate external API calls';
COMMENT ON COLUMN geocode_cache.cache_key IS 'Normalized, lowercased address string used as lookup key';
COMMENT ON COLUMN geocode_cache.expires_at IS 'Cache entry expires after 30 days; re-geocode if stale';
