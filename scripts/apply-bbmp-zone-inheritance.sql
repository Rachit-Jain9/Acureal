-- scripts/apply-bbmp-zone-inheritance.sql
-- Reproducible inheritance heuristic that takes BBMP street-zone coverage
-- from ~46% (after LLM pass) → 100% by inheriting each unenriched street's
-- zone from its neighbouring page within the same ARO section, then
-- iterating across chains where multiple consecutive pages were empty.
--
-- Designed to run AFTER:
--   1. scripts/build-bbmp-street-index.py    (extracts 9,913 street rows)
--   2. scripts/seed-bbmp-street-index.js     (bulk-inserts into DB)
--   3. scripts/heuristic-enrich-bbmp-zones.py + apply-bbmp-zone-heuristic.js
--                                            (single-zone page heuristic, +2,943 rows)
--   4. scripts/enrich-bbmp-street-zones.js   (Gemini multimodal pass; needs paid API key)
--
-- All four passes above leave ~46% coverage. This script closes the
-- remaining 54% by exploiting the fact that the BBMP gazette is laid out
-- as section-bounded zone blocks — a page with no zone header typically
-- continues the previous page's zone within the same ARO. The four passes
-- are layered by confidence:
--
--   Pass A (conf 0.55): inherit from prior page, same ARO section
--   Pass B (conf 0.45): inherit from next page, same ARO section
--   Pass C (conf 0.40): inherit from neighbour, NULL ARO ok (pypdf header miss)
--   Pass D (conf 0.35): iterate Passes C across chained unenriched neighbours
--
-- Idempotent: every UPDATE clause filters `zone_code IS NULL`. Re-runs only
-- touch rows that haven't already been classified. Safe to run again after
-- a future LLM pass increases coverage further.
--
-- Apply via Supabase SQL editor or:
--   psql "$DATABASE_URL" -f scripts/apply-bbmp-zone-inheritance.sql

BEGIN;

-- ─── PASS A — prior page, same ARO section ─────────────────────────────
WITH inheritance_candidates AS (
  SELECT
    target.id AS target_id,
    (SELECT zone_code FROM regulatory_data.bbmp_street_index
     WHERE page_number = target.page_number - 1
       AND zone_code IS NOT NULL
       AND aro_section = target.aro_section
     GROUP BY zone_code ORDER BY COUNT(*) DESC LIMIT 1) AS inherited_zone,
    (SELECT guidance_value_band_min_inr FROM regulatory_data.bbmp_street_index
     WHERE page_number = target.page_number - 1
       AND zone_code IS NOT NULL
       AND aro_section = target.aro_section
     LIMIT 1) AS inherited_min,
    (SELECT guidance_value_band_max_inr FROM regulatory_data.bbmp_street_index
     WHERE page_number = target.page_number - 1
       AND zone_code IS NOT NULL
       AND aro_section = target.aro_section
     LIMIT 1) AS inherited_max
  FROM regulatory_data.bbmp_street_index target
  WHERE target.zone_code IS NULL
)
UPDATE regulatory_data.bbmp_street_index t
SET zone_code = c.inherited_zone,
    guidance_value_band_min_inr = c.inherited_min,
    guidance_value_band_max_inr = c.inherited_max,
    confidence_score = 0.55
FROM inheritance_candidates c
WHERE t.id = c.target_id AND c.inherited_zone IS NOT NULL;

-- ─── PASS B — next page, same ARO section ──────────────────────────────
WITH inheritance_candidates AS (
  SELECT
    target.id AS target_id,
    (SELECT zone_code FROM regulatory_data.bbmp_street_index
     WHERE page_number = target.page_number + 1
       AND zone_code IS NOT NULL
       AND aro_section = target.aro_section
     GROUP BY zone_code ORDER BY COUNT(*) DESC LIMIT 1) AS inherited_zone,
    (SELECT guidance_value_band_min_inr FROM regulatory_data.bbmp_street_index
     WHERE page_number = target.page_number + 1
       AND zone_code IS NOT NULL
       AND aro_section = target.aro_section
     LIMIT 1) AS inherited_min,
    (SELECT guidance_value_band_max_inr FROM regulatory_data.bbmp_street_index
     WHERE page_number = target.page_number + 1
       AND zone_code IS NOT NULL
       AND aro_section = target.aro_section
     LIMIT 1) AS inherited_max
  FROM regulatory_data.bbmp_street_index target
  WHERE target.zone_code IS NULL
)
UPDATE regulatory_data.bbmp_street_index t
SET zone_code = c.inherited_zone,
    guidance_value_band_min_inr = c.inherited_min,
    guidance_value_band_max_inr = c.inherited_max,
    confidence_score = 0.45
FROM inheritance_candidates c
WHERE t.id = c.target_id AND c.inherited_zone IS NOT NULL;

-- ─── PASS C — cross-ARO inheritance for pages where pypdf missed the ARO
--           header. Restricted to rows with NULL aro_section so we don't
--           override the better passes' classifications.
WITH inheritance_candidates AS (
  SELECT
    target.id AS target_id,
    COALESCE(
      (SELECT zone_code FROM regulatory_data.bbmp_street_index
       WHERE page_number = target.page_number - 1 AND zone_code IS NOT NULL
       GROUP BY zone_code ORDER BY COUNT(*) DESC LIMIT 1),
      (SELECT zone_code FROM regulatory_data.bbmp_street_index
       WHERE page_number = target.page_number + 1 AND zone_code IS NOT NULL
       GROUP BY zone_code ORDER BY COUNT(*) DESC LIMIT 1)
    ) AS inherited_zone,
    COALESCE(
      (SELECT guidance_value_band_min_inr FROM regulatory_data.bbmp_street_index
       WHERE page_number = target.page_number - 1 AND zone_code IS NOT NULL LIMIT 1),
      (SELECT guidance_value_band_min_inr FROM regulatory_data.bbmp_street_index
       WHERE page_number = target.page_number + 1 AND zone_code IS NOT NULL LIMIT 1)
    ) AS inherited_min,
    COALESCE(
      (SELECT guidance_value_band_max_inr FROM regulatory_data.bbmp_street_index
       WHERE page_number = target.page_number - 1 AND zone_code IS NOT NULL LIMIT 1),
      (SELECT guidance_value_band_max_inr FROM regulatory_data.bbmp_street_index
       WHERE page_number = target.page_number + 1 AND zone_code IS NOT NULL LIMIT 1)
    ) AS inherited_max
  FROM regulatory_data.bbmp_street_index target
  WHERE target.zone_code IS NULL
    AND target.aro_section IS NULL
)
UPDATE regulatory_data.bbmp_street_index t
SET zone_code = c.inherited_zone,
    guidance_value_band_min_inr = c.inherited_min,
    guidance_value_band_max_inr = c.inherited_max,
    confidence_score = 0.40
FROM inheritance_candidates c
WHERE t.id = c.target_id AND c.inherited_zone IS NOT NULL;

-- ─── PASS D — iterate cross-ARO inheritance up to 6 times to close
--           chained unenriched neighbourhoods (e.g. pages 138-139-140
--           all started empty; pass C fills the outer ones, pass D
--           recursively backfills the inner ones once outer is set).
DO $$
DECLARE
  remaining_before INT;
  remaining_after INT := -1;
  iteration INT := 0;
BEGIN
  LOOP
    SELECT COUNT(*) FILTER (WHERE zone_code IS NULL) INTO remaining_before FROM regulatory_data.bbmp_street_index;
    EXIT WHEN remaining_before = 0 OR remaining_before = remaining_after OR iteration > 6;
    remaining_after := remaining_before;

    WITH inheritance_candidates AS (
      SELECT
        target.id AS target_id,
        COALESCE(
          (SELECT zone_code FROM regulatory_data.bbmp_street_index
           WHERE page_number = target.page_number - 1 AND zone_code IS NOT NULL
           GROUP BY zone_code ORDER BY COUNT(*) DESC LIMIT 1),
          (SELECT zone_code FROM regulatory_data.bbmp_street_index
           WHERE page_number = target.page_number + 1 AND zone_code IS NOT NULL
           GROUP BY zone_code ORDER BY COUNT(*) DESC LIMIT 1)
        ) AS inherited_zone,
        COALESCE(
          (SELECT guidance_value_band_min_inr FROM regulatory_data.bbmp_street_index
           WHERE page_number = target.page_number - 1 AND zone_code IS NOT NULL LIMIT 1),
          (SELECT guidance_value_band_min_inr FROM regulatory_data.bbmp_street_index
           WHERE page_number = target.page_number + 1 AND zone_code IS NOT NULL LIMIT 1)
        ) AS inherited_min,
        COALESCE(
          (SELECT guidance_value_band_max_inr FROM regulatory_data.bbmp_street_index
           WHERE page_number = target.page_number - 1 AND zone_code IS NOT NULL LIMIT 1),
          (SELECT guidance_value_band_max_inr FROM regulatory_data.bbmp_street_index
           WHERE page_number = target.page_number + 1 AND zone_code IS NOT NULL LIMIT 1)
        ) AS inherited_max
      FROM regulatory_data.bbmp_street_index target
      WHERE target.zone_code IS NULL
    )
    UPDATE regulatory_data.bbmp_street_index t
    SET zone_code = c.inherited_zone,
        guidance_value_band_min_inr = c.inherited_min,
        guidance_value_band_max_inr = c.inherited_max,
        confidence_score = 0.35
    FROM inheritance_candidates c
    WHERE t.id = c.target_id AND c.inherited_zone IS NOT NULL;

    iteration := iteration + 1;
  END LOOP;
END $$;

-- ─── Final coverage report ─────────────────────────────────────────────
SELECT
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE zone_code IS NOT NULL)::int AS enriched,
  ROUND(100.0 * COUNT(*) FILTER (WHERE zone_code IS NOT NULL) / COUNT(*), 1) AS coverage_pct
FROM regulatory_data.bbmp_street_index;

COMMIT;
