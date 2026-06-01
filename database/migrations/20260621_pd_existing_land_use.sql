-- ============================================================================
-- 20260621 — Per-district Existing Land Use (7 central Bengaluru PDs)
-- ============================================================================
-- Loads the Existing Land-Use Analysis tables from the 7 per-district reports
-- in the operator's RMP 2031 document set (CBD, Jayanagar, Malleswaram,
-- Rajajinagar, RT Nagar, Indiranagar, Austin Town) — the one part of that
-- set not previously extracted. Each district becomes one evidence_source +
-- one pd_existing_land_use evidence_fact (category x % x hectares for 14
-- land-use categories), org-scoped to the same org as the other RMP volumes.
--
-- Provenance / honesty:
--   * baseline_year = 2015 (the existing-use survey behind RMP 2031).
--   * RMP 2031 itself was never notified — these rows are review_status
--     'pending' (NOT 'approved') so the workspace treats them as reference
--     pending human sign-off, never as authoritative statutory zoning.
--   * Per-category hectares are derived (pct x district total); every
--     district's shares were validated to sum to ~100% before emit.
--
-- Idempotent: each block is guarded by NOT EXISTS on the source_title, so
-- re-running inserts nothing. Paste-safe in the Supabase SQL editor.
-- ============================================================================

BEGIN;

-- CBD / Central Core  (total 2774.28 ha, shares sum 100.01%)
WITH s AS (
  INSERT INTO regulatory_data.evidence_sources
    (id, org_id, source_kind, source_title, authority_name, city, plan_version,
     extraction_status, review_status, confidence_score, notes, created_at, updated_at)
  SELECT gen_random_uuid(), 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'official_pdf',
    $t$Bengaluru — CBD / Central Core Planning-District Existing Land Use (RMP 2031 set, 2015 baseline)$t$, 'BDA / RMP 2031', 'Bengaluru', 'RMP 2031 (Draft)',
    'completed', 'pending', 0.95, $n$Existing land-use analysis (2015 baseline) digitised from the CBD / Central Core planning-district report in the RMP 2031 draft document set. RMP 2031 was never notified — reference/context only. Per-category hectares derived as pct × district total; shares validated to sum to 100.01%.$n$, NOW(), NOW()
  WHERE NOT EXISTS (
    SELECT 1 FROM regulatory_data.evidence_sources WHERE source_title = $t$Bengaluru — CBD / Central Core Planning-District Existing Land Use (RMP 2031 set, 2015 baseline)$t$
  )
  RETURNING id
)
INSERT INTO regulatory_data.evidence_facts
  (id, source_id, org_id, fact_type, fact_key, fact_value, source_section,
   confidence_score, review_status, created_at)
SELECT gen_random_uuid(), s.id, 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'pd_existing_land_use',
  'pd_cbd_central_core_existing_land_use', $j${"pd_name": "CBD / Central Core", "pd_code": "PD-01", "baseline_year": 2015, "plan_set": "RMP 2031 (Draft) document set", "total_area_ha": 2774.28, "shares_sum_pct": 100.01, "hectares_method": "derived = pct/100 * district_total_ha", "categories": [{"category": "Residential", "pct": 25.33, "area_ha": 702.73}, {"category": "Commercial", "pct": 21.14, "area_ha": 586.48}, {"category": "Industrial", "pct": 1.96, "area_ha": 54.38}, {"category": "Quarry/Mining Sites", "pct": 0.0, "area_ha": 0.0}, {"category": "Public Semi Public", "pct": 16.53, "area_ha": 458.59}, {"category": "Public & Semi Public - Defence", "pct": 5.35, "area_ha": 148.42}, {"category": "Public Utility", "pct": 0.28, "area_ha": 7.77}, {"category": "Parks & Open Spaces", "pct": 8.31, "area_ha": 230.54}, {"category": "Transport & Communication", "pct": 15.54, "area_ha": 431.12}, {"category": "Vacant", "pct": 3.68, "area_ha": 102.09}, {"category": "Agriculture", "pct": 0.0, "area_ha": 0.0}, {"category": "Forest", "pct": 0.0, "area_ha": 0.0}, {"category": "Streams", "pct": 0.34, "area_ha": 9.43}, {"category": "Water Bodies", "pct": 1.55, "area_ha": 43.0}]}$j$::jsonb, 'Existing Landuse Analysis', 0.95, 'pending', NOW()
FROM s;

-- Jayanagar  (total 1481.88 ha, shares sum 100.0%)
WITH s AS (
  INSERT INTO regulatory_data.evidence_sources
    (id, org_id, source_kind, source_title, authority_name, city, plan_version,
     extraction_status, review_status, confidence_score, notes, created_at, updated_at)
  SELECT gen_random_uuid(), 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'official_pdf',
    $t$Bengaluru — Jayanagar Planning-District Existing Land Use (RMP 2031 set, 2015 baseline)$t$, 'BDA / RMP 2031', 'Bengaluru', 'RMP 2031 (Draft)',
    'completed', 'pending', 0.95, $n$Existing land-use analysis (2015 baseline) digitised from the Jayanagar planning-district report in the RMP 2031 draft document set. RMP 2031 was never notified — reference/context only. Per-category hectares derived as pct × district total; shares validated to sum to 100.0%.$n$, NOW(), NOW()
  WHERE NOT EXISTS (
    SELECT 1 FROM regulatory_data.evidence_sources WHERE source_title = $t$Bengaluru — Jayanagar Planning-District Existing Land Use (RMP 2031 set, 2015 baseline)$t$
  )
  RETURNING id
)
INSERT INTO regulatory_data.evidence_facts
  (id, source_id, org_id, fact_type, fact_key, fact_value, source_section,
   confidence_score, review_status, created_at)
SELECT gen_random_uuid(), s.id, 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'pd_existing_land_use',
  'pd_jayanagar_existing_land_use', $j${"pd_name": "Jayanagar", "pd_code": null, "baseline_year": 2015, "plan_set": "RMP 2031 (Draft) document set", "total_area_ha": 1481.88, "shares_sum_pct": 100.0, "hectares_method": "derived = pct/100 * district_total_ha", "categories": [{"category": "Residential", "pct": 37.71, "area_ha": 558.82}, {"category": "Commercial", "pct": 11.95, "area_ha": 177.08}, {"category": "Industrial", "pct": 4.73, "area_ha": 70.09}, {"category": "Quarry/Mining Sites", "pct": 0.0, "area_ha": 0.0}, {"category": "Public Semi Public", "pct": 17.34, "area_ha": 256.96}, {"category": "Public & Semi Public - Defence", "pct": 0.0, "area_ha": 0.0}, {"category": "Public Utility", "pct": 0.45, "area_ha": 6.67}, {"category": "Parks & Open Spaces", "pct": 8.07, "area_ha": 119.59}, {"category": "Transport & Communication", "pct": 13.31, "area_ha": 197.24}, {"category": "Vacant", "pct": 4.45, "area_ha": 65.94}, {"category": "Agriculture", "pct": 0.0, "area_ha": 0.0}, {"category": "Forest", "pct": 0.0, "area_ha": 0.0}, {"category": "Streams", "pct": 0.22, "area_ha": 3.26}, {"category": "Water Bodies", "pct": 1.77, "area_ha": 26.23}]}$j$::jsonb, 'Existing Landuse Analysis', 0.95, 'pending', NOW()
FROM s;

-- Malleswaram  (total 3483.08 ha, shares sum 99.99%)
WITH s AS (
  INSERT INTO regulatory_data.evidence_sources
    (id, org_id, source_kind, source_title, authority_name, city, plan_version,
     extraction_status, review_status, confidence_score, notes, created_at, updated_at)
  SELECT gen_random_uuid(), 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'official_pdf',
    $t$Bengaluru — Malleswaram Planning-District Existing Land Use (RMP 2031 set, 2015 baseline)$t$, 'BDA / RMP 2031', 'Bengaluru', 'RMP 2031 (Draft)',
    'completed', 'pending', 0.95, $n$Existing land-use analysis (2015 baseline) digitised from the Malleswaram planning-district report in the RMP 2031 draft document set. RMP 2031 was never notified — reference/context only. Per-category hectares derived as pct × district total; shares validated to sum to 99.99%.$n$, NOW(), NOW()
  WHERE NOT EXISTS (
    SELECT 1 FROM regulatory_data.evidence_sources WHERE source_title = $t$Bengaluru — Malleswaram Planning-District Existing Land Use (RMP 2031 set, 2015 baseline)$t$
  )
  RETURNING id
)
INSERT INTO regulatory_data.evidence_facts
  (id, source_id, org_id, fact_type, fact_key, fact_value, source_section,
   confidence_score, review_status, created_at)
SELECT gen_random_uuid(), s.id, 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'pd_existing_land_use',
  'pd_malleswaram_existing_land_use', $j${"pd_name": "Malleswaram", "pd_code": null, "baseline_year": 2015, "plan_set": "RMP 2031 (Draft) document set", "total_area_ha": 3483.08, "shares_sum_pct": 99.99, "hectares_method": "derived = pct/100 * district_total_ha", "categories": [{"category": "Residential", "pct": 29.97, "area_ha": 1043.88}, {"category": "Commercial", "pct": 7.5, "area_ha": 261.23}, {"category": "Industrial", "pct": 12.12, "area_ha": 422.15}, {"category": "Quarry/Mining Sites", "pct": 0.0, "area_ha": 0.0}, {"category": "Public Semi Public", "pct": 14.03, "area_ha": 488.68}, {"category": "Public & Semi Public - Defence", "pct": 3.84, "area_ha": 133.75}, {"category": "Public Utility", "pct": 1.01, "area_ha": 35.18}, {"category": "Parks & Open Spaces", "pct": 8.53, "area_ha": 297.11}, {"category": "Transport & Communication", "pct": 14.3, "area_ha": 498.08}, {"category": "Vacant", "pct": 7.8, "area_ha": 271.68}, {"category": "Agriculture", "pct": 0.0, "area_ha": 0.0}, {"category": "Forest", "pct": 0.0, "area_ha": 0.0}, {"category": "Streams", "pct": 0.2, "area_ha": 6.97}, {"category": "Water Bodies", "pct": 0.69, "area_ha": 24.03}]}$j$::jsonb, 'Existing Landuse Analysis', 0.95, 'pending', NOW()
FROM s;

-- Rajajinagar  (total 1806.63 ha, shares sum 100.0%)
WITH s AS (
  INSERT INTO regulatory_data.evidence_sources
    (id, org_id, source_kind, source_title, authority_name, city, plan_version,
     extraction_status, review_status, confidence_score, notes, created_at, updated_at)
  SELECT gen_random_uuid(), 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'official_pdf',
    $t$Bengaluru — Rajajinagar Planning-District Existing Land Use (RMP 2031 set, 2015 baseline)$t$, 'BDA / RMP 2031', 'Bengaluru', 'RMP 2031 (Draft)',
    'completed', 'pending', 0.95, $n$Existing land-use analysis (2015 baseline) digitised from the Rajajinagar planning-district report in the RMP 2031 draft document set. RMP 2031 was never notified — reference/context only. Per-category hectares derived as pct × district total; shares validated to sum to 100.0%.$n$, NOW(), NOW()
  WHERE NOT EXISTS (
    SELECT 1 FROM regulatory_data.evidence_sources WHERE source_title = $t$Bengaluru — Rajajinagar Planning-District Existing Land Use (RMP 2031 set, 2015 baseline)$t$
  )
  RETURNING id
)
INSERT INTO regulatory_data.evidence_facts
  (id, source_id, org_id, fact_type, fact_key, fact_value, source_section,
   confidence_score, review_status, created_at)
SELECT gen_random_uuid(), s.id, 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'pd_existing_land_use',
  'pd_rajajinagar_existing_land_use', $j${"pd_name": "Rajajinagar", "pd_code": null, "baseline_year": 2015, "plan_set": "RMP 2031 (Draft) document set", "total_area_ha": 1806.63, "shares_sum_pct": 100.0, "hectares_method": "derived = pct/100 * district_total_ha", "categories": [{"category": "Residential", "pct": 45.82, "area_ha": 827.8}, {"category": "Commercial", "pct": 12.46, "area_ha": 225.11}, {"category": "Industrial", "pct": 6.04, "area_ha": 109.12}, {"category": "Quarry/Mining Sites", "pct": 0.0, "area_ha": 0.0}, {"category": "Public Semi Public", "pct": 5.51, "area_ha": 99.55}, {"category": "Public & Semi Public - Defence", "pct": 0.0, "area_ha": 0.0}, {"category": "Public Utility", "pct": 0.61, "area_ha": 11.02}, {"category": "Parks & Open Spaces", "pct": 4.1, "area_ha": 74.07}, {"category": "Transport & Communication", "pct": 18.08, "area_ha": 326.64}, {"category": "Vacant", "pct": 6.68, "area_ha": 120.68}, {"category": "Agriculture", "pct": 0.0, "area_ha": 0.0}, {"category": "Forest", "pct": 0.0, "area_ha": 0.0}, {"category": "Streams", "pct": 0.7, "area_ha": 12.65}, {"category": "Water Bodies", "pct": 0.0, "area_ha": 0.0}]}$j$::jsonb, 'Existing Landuse Analysis', 0.95, 'pending', NOW()
FROM s;

-- RT Nagar  (total 3923.01 ha, shares sum 100.0%)
WITH s AS (
  INSERT INTO regulatory_data.evidence_sources
    (id, org_id, source_kind, source_title, authority_name, city, plan_version,
     extraction_status, review_status, confidence_score, notes, created_at, updated_at)
  SELECT gen_random_uuid(), 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'official_pdf',
    $t$Bengaluru — RT Nagar Planning-District Existing Land Use (RMP 2031 set, 2015 baseline)$t$, 'BDA / RMP 2031', 'Bengaluru', 'RMP 2031 (Draft)',
    'completed', 'pending', 0.95, $n$Existing land-use analysis (2015 baseline) digitised from the RT Nagar planning-district report in the RMP 2031 draft document set. RMP 2031 was never notified — reference/context only. Per-category hectares derived as pct × district total; shares validated to sum to 100.0%.$n$, NOW(), NOW()
  WHERE NOT EXISTS (
    SELECT 1 FROM regulatory_data.evidence_sources WHERE source_title = $t$Bengaluru — RT Nagar Planning-District Existing Land Use (RMP 2031 set, 2015 baseline)$t$
  )
  RETURNING id
)
INSERT INTO regulatory_data.evidence_facts
  (id, source_id, org_id, fact_type, fact_key, fact_value, source_section,
   confidence_score, review_status, created_at)
SELECT gen_random_uuid(), s.id, 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'pd_existing_land_use',
  'pd_rt_nagar_existing_land_use', $j${"pd_name": "RT Nagar", "pd_code": null, "baseline_year": 2015, "plan_set": "RMP 2031 (Draft) document set", "total_area_ha": 3923.01, "shares_sum_pct": 100.0, "hectares_method": "derived = pct/100 * district_total_ha", "categories": [{"category": "Residential", "pct": 32.55, "area_ha": 1276.94}, {"category": "Commercial", "pct": 3.85, "area_ha": 151.04}, {"category": "Industrial", "pct": 5.12, "area_ha": 200.86}, {"category": "Quarry/Mining Sites", "pct": 0.0, "area_ha": 0.0}, {"category": "Public Semi Public", "pct": 21.57, "area_ha": 846.19}, {"category": "Public & Semi Public - Defence", "pct": 3.2, "area_ha": 125.54}, {"category": "Public Utility", "pct": 0.58, "area_ha": 22.75}, {"category": "Parks & Open Spaces", "pct": 2.58, "area_ha": 101.21}, {"category": "Transport & Communication", "pct": 9.62, "area_ha": 377.39}, {"category": "Vacant", "pct": 16.94, "area_ha": 664.56}, {"category": "Agriculture", "pct": 0.0, "area_ha": 0.0}, {"category": "Forest", "pct": 0.0, "area_ha": 0.0}, {"category": "Streams", "pct": 0.41, "area_ha": 16.08}, {"category": "Water Bodies", "pct": 3.58, "area_ha": 140.44}]}$j$::jsonb, 'Existing Landuse Analysis', 0.95, 'pending', NOW()
FROM s;

-- Indiranagar  (total 3022.62 ha, shares sum 99.98%)
WITH s AS (
  INSERT INTO regulatory_data.evidence_sources
    (id, org_id, source_kind, source_title, authority_name, city, plan_version,
     extraction_status, review_status, confidence_score, notes, created_at, updated_at)
  SELECT gen_random_uuid(), 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'official_pdf',
    $t$Bengaluru — Indiranagar Planning-District Existing Land Use (RMP 2031 set, 2015 baseline)$t$, 'BDA / RMP 2031', 'Bengaluru', 'RMP 2031 (Draft)',
    'completed', 'pending', 0.95, $n$Existing land-use analysis (2015 baseline) digitised from the Indiranagar planning-district report in the RMP 2031 draft document set. RMP 2031 was never notified — reference/context only. Per-category hectares derived as pct × district total; shares validated to sum to 99.98%.$n$, NOW(), NOW()
  WHERE NOT EXISTS (
    SELECT 1 FROM regulatory_data.evidence_sources WHERE source_title = $t$Bengaluru — Indiranagar Planning-District Existing Land Use (RMP 2031 set, 2015 baseline)$t$
  )
  RETURNING id
)
INSERT INTO regulatory_data.evidence_facts
  (id, source_id, org_id, fact_type, fact_key, fact_value, source_section,
   confidence_score, review_status, created_at)
SELECT gen_random_uuid(), s.id, 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'pd_existing_land_use',
  'pd_indiranagar_existing_land_use', $j${"pd_name": "Indiranagar", "pd_code": null, "baseline_year": 2015, "plan_set": "RMP 2031 (Draft) document set", "total_area_ha": 3022.62, "shares_sum_pct": 99.98, "hectares_method": "derived = pct/100 * district_total_ha", "categories": [{"category": "Residential", "pct": 33.1, "area_ha": 1000.49}, {"category": "Commercial", "pct": 4.56, "area_ha": 137.83}, {"category": "Industrial", "pct": 3.52, "area_ha": 106.4}, {"category": "Quarry/Mining Sites", "pct": 0.0, "area_ha": 0.0}, {"category": "Public Semi Public", "pct": 3.76, "area_ha": 113.65}, {"category": "Public & Semi Public - Defence", "pct": 26.12, "area_ha": 789.51}, {"category": "Public Utility", "pct": 0.34, "area_ha": 10.28}, {"category": "Parks & Open Spaces", "pct": 2.62, "area_ha": 79.19}, {"category": "Transport & Communication", "pct": 13.99, "area_ha": 422.86}, {"category": "Vacant", "pct": 9.27, "area_ha": 280.2}, {"category": "Agriculture", "pct": 0.0, "area_ha": 0.0}, {"category": "Forest", "pct": 0.0, "area_ha": 0.0}, {"category": "Streams", "pct": 0.3, "area_ha": 9.07}, {"category": "Water Bodies", "pct": 2.4, "area_ha": 72.54}]}$j$::jsonb, 'Existing Landuse Analysis', 0.95, 'pending', NOW()
FROM s;

-- Austin Town  (total 3083.0 ha, shares sum 100.01%)
WITH s AS (
  INSERT INTO regulatory_data.evidence_sources
    (id, org_id, source_kind, source_title, authority_name, city, plan_version,
     extraction_status, review_status, confidence_score, notes, created_at, updated_at)
  SELECT gen_random_uuid(), 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'official_pdf',
    $t$Bengaluru — Austin Town Planning-District Existing Land Use (RMP 2031 set, 2015 baseline)$t$, 'BDA / RMP 2031', 'Bengaluru', 'RMP 2031 (Draft)',
    'completed', 'pending', 0.95, $n$Existing land-use analysis (2015 baseline) digitised from the Austin Town planning-district report in the RMP 2031 draft document set. RMP 2031 was never notified — reference/context only. Per-category hectares derived as pct × district total; shares validated to sum to 100.01%.$n$, NOW(), NOW()
  WHERE NOT EXISTS (
    SELECT 1 FROM regulatory_data.evidence_sources WHERE source_title = $t$Bengaluru — Austin Town Planning-District Existing Land Use (RMP 2031 set, 2015 baseline)$t$
  )
  RETURNING id
)
INSERT INTO regulatory_data.evidence_facts
  (id, source_id, org_id, fact_type, fact_key, fact_value, source_section,
   confidence_score, review_status, created_at)
SELECT gen_random_uuid(), s.id, 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'pd_existing_land_use',
  'pd_austin_town_existing_land_use', $j${"pd_name": "Austin Town", "pd_code": null, "baseline_year": 2015, "plan_set": "RMP 2031 (Draft) document set", "total_area_ha": 3083.0, "shares_sum_pct": 100.01, "hectares_method": "derived = pct/100 * district_total_ha", "categories": [{"category": "Residential", "pct": 23.36, "area_ha": 720.19}, {"category": "Commercial", "pct": 5.03, "area_ha": 155.07}, {"category": "Industrial", "pct": 1.12, "area_ha": 34.53}, {"category": "Quarry/Mining Sites", "pct": 0.0, "area_ha": 0.0}, {"category": "Public Semi Public", "pct": 8.68, "area_ha": 267.6}, {"category": "Public & Semi Public - Defence", "pct": 32.6, "area_ha": 1005.06}, {"category": "Public Utility", "pct": 0.49, "area_ha": 15.11}, {"category": "Parks & Open Spaces", "pct": 3.33, "area_ha": 102.66}, {"category": "Transport & Communication", "pct": 9.57, "area_ha": 295.04}, {"category": "Vacant", "pct": 9.55, "area_ha": 294.43}, {"category": "Agriculture", "pct": 0.0, "area_ha": 0.0}, {"category": "Forest", "pct": 0.0, "area_ha": 0.0}, {"category": "Streams", "pct": 0.6, "area_ha": 18.5}, {"category": "Water Bodies", "pct": 5.68, "area_ha": 175.11}]}$j$::jsonb, 'Existing Landuse Analysis', 0.95, 'pending', NOW()
FROM s;

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT fact_value->>'pd_name' AS pd, fact_value->>'total_area_ha' AS ha,
--          fact_value->>'shares_sum_pct' AS pct
--   FROM regulatory_data.evidence_facts
--   WHERE fact_type = 'pd_existing_land_use'
--   ORDER BY pd;
--   -- expect: 7 rows
-- ============================================================================
