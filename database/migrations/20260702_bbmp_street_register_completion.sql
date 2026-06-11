-- 20260702_bbmp_street_register_completion.sql
-- ----------------------------------------------------------------------------
-- The BBMP Guidance Value gazette (Notification No. 384, 09-Mar-2016; 686
-- pages) contains TWO street->UAV-zone registers: RESIDENTIAL (pages 17-362)
-- and NON-RESIDENTIAL (pages 363-686). The same street can sit in different
-- UAV zones for residential vs non-residential use.
--
-- The original extraction (20260528) didn't model that dimension and — due to
-- two parser blind spots (a +0x1D-shifted subset font read as "garbage", and
-- pypdf detaching ZONE headers from their rows) — covered only pages 17-367 +
-- 410-414. This migration adds the register dimension; the completed
-- deterministic re-extraction is loaded by scripts/parse-bbmp-uav-register.py
-- + the service-role loader (same pattern as the original seed).
--
-- Backfill: register is implied by the source page (the two registers are
-- contiguous page ranges), so legacy rows are tagged by page_number.

BEGIN;

ALTER TABLE regulatory_data.bbmp_street_index
  ADD COLUMN IF NOT EXISTS register text
  CHECK (register IN ('residential', 'non_residential'));

UPDATE regulatory_data.bbmp_street_index
   SET register = CASE WHEN page_number <= 362 THEN 'residential'
                       ELSE 'non_residential' END
 WHERE register IS NULL;

-- The unique triple (street, ward, page) stays valid: register is a function
-- of page_number. Add a search-path index for register+zone filtering.
CREATE INDEX IF NOT EXISTS bbmp_street_index_register_zone
  ON regulatory_data.bbmp_street_index (register, zone_code);

COMMENT ON COLUMN regulatory_data.bbmp_street_index.register IS
  'Which gazette register the row comes from: residential (pages 17-362) or non_residential (pages 363-686). The same street can carry different UAV zones per register.';

COMMIT;
