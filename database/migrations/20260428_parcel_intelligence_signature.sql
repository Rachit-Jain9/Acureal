-- ──────────────────────────────────────────────────────────────────────────
-- Add HMAC signature column to parcel_intelligence_snapshots.
-- Signature is computed as HMAC-SHA256 over:
--   inputs_hash | output_hash | engine_version
-- where engine_version tracks the compose logic revision.
-- A NULL signature means the snapshot predates signing or the secret
-- was not set at write time — both are valid states.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE regulatory_data.parcel_intelligence_snapshots
  ADD COLUMN IF NOT EXISTS signature    TEXT,
  ADD COLUMN IF NOT EXISTS engine_version TEXT;
