-- ============================================================================
-- 20260713_guidance_values_field_completion.sql
-- ----------------------------------------------------------------------------
-- Workstream 1 prep — complete the guidance_values field set so the IGR
-- guidance-value activation is turnkey when the operator uploads a sample SRO
-- PDF, and so a guidance value can be matched on the same administrative
-- hierarchy (district / taluk / hobli / village) the Workstream-0 jurisdiction
-- resolver already derives — not just locality/road trigram.
--
-- Adds (all nullable, additive — no behaviour change until data is ingested):
--   - district, taluk, hobli, village_or_ward : SRO admin hierarchy.
--   - reviewed_by, reviewed_at                : human-review audit (who approved
--                                               this guidance row, when).
--
-- Idempotent (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). Safe to
-- re-run. Rollback = drop the 6 columns + 2 indexes. No data destroyed.
-- ============================================================================

BEGIN;

ALTER TABLE regulatory_data.guidance_values
  ADD COLUMN IF NOT EXISTS district        VARCHAR(120),
  ADD COLUMN IF NOT EXISTS taluk           VARCHAR(120),
  ADD COLUMN IF NOT EXISTS hobli           VARCHAR(120),
  ADD COLUMN IF NOT EXISTS village_or_ward VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at     TIMESTAMPTZ;

-- Trigram on village/ward (mirrors the existing locality/road trigram indexes)
-- + a btree on (city, lower(taluk)) for hierarchy-scoped lookups.
CREATE INDEX IF NOT EXISTS idx_guidance_village_trgm
  ON regulatory_data.guidance_values USING gin(village_or_ward gin_trgm_ops)
  WHERE village_or_ward IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guidance_taluk
  ON regulatory_data.guidance_values(city, LOWER(taluk))
  WHERE taluk IS NOT NULL;

COMMIT;
