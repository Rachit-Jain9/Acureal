-- 20260531_land_use_insight_and_city_callouts.sql
--
-- Restores the BMA-wide land-use insight (2015 baseline → 2031 proposed)
-- plus city-level callouts (landmarks, adjacent planning authorities)
-- as evidence_facts that back:
--   - Land Use Insight panel at /admin/planning-intelligence
--   - DealPlanningContextCard on every Bengaluru deal's Zoning tab
--   - District Intelligence panel's callouts strip
--
-- Lost when the legacy Tokyo Supabase project was deleted (13 facts of
-- this kind existed on Tokyo before; current Mumbai count is 0 for
-- land_use_share / land_use_total and 0 for landmark/boundary).
--
-- Source: hand-extracted from the RMP 2031 Existing Land Use Map (2015
-- baseline, single-page summary table) and the Proposed Land Use Map
-- (2031, single-page summary table). Both already registered in
-- regulatory_data.evidence_sources. The map cards print clean numeric
-- breakdowns — no LLM needed.
--
-- NOT included in this PR (deferred):
--   - SDZ corridor inventory          → needs Volume-6 deeper extraction
--   - Heritage zone inventory          → needs Volume-6 / heritage list
--   - NGT drainage classification      → needs Volume-3/Volume-6 detail
--   - Regional parks list              → needs Volume-3/Vol-1 detail
--   - Peripheral Ring Road alignment   → needs Vol-3 detail
--   These are best done via a separate Gemini multimodal extraction pass.
--
-- Idempotent — re-runs DELETE any prior fact with these exact
-- (fact_type, fact_key) tuples before re-INSERTing the canonical set.

BEGIN;

-- Idempotency: clean-slate the land-use + callout facts we're seeding.
DELETE FROM regulatory_data.evidence_facts
WHERE (fact_type = 'land_use_share' AND fact_key LIKE 'existing_%')
   OR (fact_type = 'land_use_share' AND fact_key LIKE 'proposed_%')
   OR (fact_type = 'land_use_total' AND fact_key IN ('bma_total_area', 'bma_developable_area', 'lpa_bda_total', 'proposed_agriculture_outside_dev'))
   OR (fact_type = 'landmark'       AND fact_key = 'major_landmarks_in_bma')
   OR (fact_type = 'boundary'       AND fact_key = 'adjacent_planning_authorities');

-- ========================================================================
-- 2015 Existing Land Use — LPA of BDA (Local Planning Area, 1206.97 ha)
-- Source: RMP 2031 Existing Land Use Map (2015 baseline)
-- ========================================================================

INSERT INTO regulatory_data.evidence_facts
  (source_id, fact_type, fact_key, fact_value, page_number, source_section, confidence_score, review_status)
VALUES
('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'land_use_share', 'existing_residential_pct',         '{"value": 17.63, "absolute_ha": 212.84, "year": 2015}'::jsonb, 1, 'Existing Landuse Analysis — Residential',           0.95, 'approved'),
('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'land_use_share', 'existing_commercial_pct',          '{"value":  3.17, "absolute_ha":  38.28, "year": 2015}'::jsonb, 1, 'Existing Landuse Analysis — Commercial',            0.95, 'approved'),
('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'land_use_share', 'existing_industrial_pct',          '{"value":  3.78, "absolute_ha":  45.61, "year": 2015}'::jsonb, 1, 'Existing Landuse Analysis — Industrial',            0.95, 'approved'),
('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'land_use_share', 'existing_psp_pct',                 '{"value":  5.37, "absolute_ha":  64.78, "year": 2015}'::jsonb, 1, 'Existing Landuse Analysis — Public Semi Public',    0.95, 'approved'),
('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'land_use_share', 'existing_unclassified_pct',        '{"value":  3.51, "absolute_ha":  42.32, "year": 2015}'::jsonb, 1, 'Existing Landuse Analysis — Unclassified',          0.95, 'approved'),
('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'land_use_share', 'existing_public_utility_pct',      '{"value":  0.40, "absolute_ha":   4.86, "year": 2015}'::jsonb, 1, 'Existing Landuse Analysis — Public Utility',        0.95, 'approved'),
('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'land_use_share', 'existing_parks_open_pct',          '{"value":  1.70, "absolute_ha":  20.46, "year": 2015}'::jsonb, 1, 'Existing Landuse Analysis — Parks & Open Spaces',   0.95, 'approved'),
('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'land_use_share', 'existing_transport_pct',           '{"value":  7.29, "absolute_ha":  88.02, "year": 2015}'::jsonb, 1, 'Existing Landuse Analysis — Transport Communication', 0.95, 'approved'),
('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'land_use_share', 'existing_vacant_pct',              '{"value": 25.29, "absolute_ha": 305.25, "year": 2015}'::jsonb, 1, 'Existing Landuse Analysis — Vacant',                0.95, 'approved'),
('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'land_use_share', 'existing_agriculture_pct',         '{"value": 24.90, "absolute_ha": 300.52, "year": 2015}'::jsonb, 1, 'Existing Landuse Analysis — Agriculture',           0.95, 'approved'),
('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'land_use_share', 'existing_quarry_mining_pct',       '{"value":  0.61, "absolute_ha":   7.40, "year": 2015}'::jsonb, 1, 'Existing Landuse Analysis — Quarry/Mining Sites',   0.95, 'approved'),
('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'land_use_share', 'existing_forest_pct',              '{"value":  2.28, "absolute_ha":  27.53, "year": 2015}'::jsonb, 1, 'Existing Landuse Analysis — Forest',                0.95, 'approved'),
('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'land_use_share', 'existing_streams_pct',             '{"value":  0.35, "absolute_ha":   4.28, "year": 2015}'::jsonb, 1, 'Existing Landuse Analysis — Streams',               0.95, 'approved'),
('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'land_use_share', 'existing_water_bodies_pct',        '{"value":  3.71, "absolute_ha":  44.82, "year": 2015}'::jsonb, 1, 'Existing Landuse Analysis — Water Bodies',          0.95, 'approved'),

-- ========================================================================
-- 2031 Proposed Land Use — BMA Developable Area (88,431.56 ha)
-- Source: RMP 2031 Proposed Land Use Map (Provisional approved 22-11-2017)
-- ========================================================================

('addd6daa-b1e4-4f9f-b14f-21033ba72ea2', 'land_use_share', 'proposed_residential_pct',                  '{"value": 48.04, "absolute_ha": 42486.39, "year": 2031}'::jsonb, 1, 'Proposed Landuse Analysis — Residential',                       0.95, 'approved'),
('addd6daa-b1e4-4f9f-b14f-21033ba72ea2', 'land_use_share', 'proposed_commercial_pct',                   '{"value":  2.80, "absolute_ha":  2477.07, "year": 2031}'::jsonb, 1, 'Proposed Landuse Analysis — Commercial',                        0.95, 'approved'),
('addd6daa-b1e4-4f9f-b14f-21033ba72ea2', 'land_use_share', 'proposed_industrial_pct',                   '{"value":  4.81, "absolute_ha":  4256.37, "year": 2031}'::jsonb, 1, 'Proposed Landuse Analysis — Industrial',                        0.95, 'approved'),
('addd6daa-b1e4-4f9f-b14f-21033ba72ea2', 'land_use_share', 'proposed_psp_pct',                          '{"value":  6.80, "absolute_ha":  6009.60, "year": 2031}'::jsonb, 1, 'Proposed Landuse Analysis — Public & Semi Public',              0.95, 'approved'),
('addd6daa-b1e4-4f9f-b14f-21033ba72ea2', 'land_use_share', 'proposed_psp_defence_pct',                  '{"value":  4.93, "absolute_ha":  4356.29, "year": 2031}'::jsonb, 1, 'Proposed Landuse Analysis — Public & Semi Public (Defence)',    0.95, 'approved'),
('addd6daa-b1e4-4f9f-b14f-21033ba72ea2', 'land_use_share', 'proposed_public_utility_pct',               '{"value":  0.55, "absolute_ha":   486.36, "year": 2031}'::jsonb, 1, 'Proposed Landuse Analysis — Public Utility',                    0.95, 'approved'),
('addd6daa-b1e4-4f9f-b14f-21033ba72ea2', 'land_use_share', 'proposed_parks_open_pct',                   '{"value":  4.23, "absolute_ha":  3736.49, "year": 2031}'::jsonb, 1, 'Proposed Landuse Analysis — Parks / Open Spaces',               0.95, 'approved'),
('addd6daa-b1e4-4f9f-b14f-21033ba72ea2', 'land_use_share', 'proposed_transport_pct',                    '{"value": 13.29, "absolute_ha": 11753.04, "year": 2031}'::jsonb, 1, 'Proposed Landuse Analysis — Transport & Communication',         0.95, 'approved'),
('addd6daa-b1e4-4f9f-b14f-21033ba72ea2', 'land_use_share', 'proposed_forest_pct',                       '{"value":  0.65, "absolute_ha":   577.15, "year": 2031}'::jsonb, 1, 'Proposed Landuse Analysis — Forest',                            0.95, 'approved'),
('addd6daa-b1e4-4f9f-b14f-21033ba72ea2', 'land_use_share', 'proposed_streams_pct',                      '{"value":  0.33, "absolute_ha":   287.97, "year": 2031}'::jsonb, 1, 'Proposed Landuse Analysis — Streams',                           0.95, 'approved'),
('addd6daa-b1e4-4f9f-b14f-21033ba72ea2', 'land_use_share', 'proposed_water_bodies_pct',                 '{"value":  3.51, "absolute_ha":  3104.46, "year": 2031}'::jsonb, 1, 'Proposed Landuse Analysis — Water Bodies',                      0.95, 'approved'),
('addd6daa-b1e4-4f9f-b14f-21033ba72ea2', 'land_use_share', 'proposed_ngt_buffer_pct',                   '{"value": 10.06, "absolute_ha":  8900.37, "year": 2031}'::jsonb, 1, 'Proposed Landuse Analysis — NGT Buffer',                        0.95, 'approved'),

-- ========================================================================
-- Land-use totals
-- ========================================================================

('addd6daa-b1e4-4f9f-b14f-21033ba72ea2', 'land_use_total', 'bma_total_area',                    '{"area_ha": 120697.00, "label": "Total BMA Area (Bangalore Metropolitan Area)", "year": 2031}'::jsonb,    1, 'Proposed Landuse Analysis — Total BMA Area',          0.95, 'approved'),
('addd6daa-b1e4-4f9f-b14f-21033ba72ea2', 'land_use_total', 'bma_developable_area',              '{"area_ha":  88431.56, "label": "Total Developable Area (excl. agriculture & non-buildable)", "year": 2031}'::jsonb, 1, 'Proposed Landuse Analysis — Total Developable Area',  0.95, 'approved'),
('addd6daa-b1e4-4f9f-b14f-21033ba72ea2', 'land_use_total', 'proposed_agriculture_outside_dev',  '{"area_ha":  32265.44, "label": "Agriculture (outside developable boundary)", "year": 2031}'::jsonb, 1, 'Proposed Landuse — BMA minus Developable',           0.95, 'approved'),
('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'land_use_total', 'lpa_bda_total',                      '{"area_ha":   1206.97, "label": "Total LPA of BDA (Local Planning Area, 2015 baseline)", "year": 2015}'::jsonb, 1, 'Existing Landuse — Total LPA of BDA',                0.95, 'approved'),

-- ========================================================================
-- Major landmarks within BMA — directly labeled on the Existing Land Use map
-- ========================================================================

('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'landmark', 'major_landmarks_in_bma',
 '[
   {"name": "HAL", "category": "industrial", "notes": "Hindustan Aeronautics Limited"},
   {"name": "GKVK", "category": "education", "notes": "Gandhi Krishi Vigyana Kendra (UAS Bangalore campus)"},
   {"name": "KSCA", "category": "sports", "notes": "Karnataka State Cricket Association Stadium / Chinnaswamy"},
   {"name": "IISc", "category": "education", "notes": "Indian Institute of Science"},
   {"name": "BMICAPA", "category": "infrastructure", "notes": "BMIC Area Planning Authority jurisdiction"},
   {"name": "Sankey Tank", "category": "water_body"},
   {"name": "Jakkur Lake", "category": "water_body"},
   {"name": "Cubbon Park", "category": "parks_open"},
   {"name": "Kalkere Lake", "category": "water_body"},
   {"name": "Varthur Kere", "category": "water_body"},
   {"name": "Vidhana Soudha", "category": "civic", "notes": "Karnataka State Legislature & Secretariat"},
   {"name": "Madivala Lake", "category": "water_body"},
   {"name": "Bellandur Lake", "category": "water_body", "notes": "Largest lake in Bengaluru; NGT under continuous review"},
   {"name": "Bengaluru Palace", "category": "heritage"},
   {"name": "Jakkur Flying School", "category": "infrastructure"},
   {"name": "Bangalore University", "category": "education"},
   {"name": "Majestic Bus Station", "category": "transport", "notes": "Kempegowda Bus Station — central BMTC/KSRTC hub"},
   {"name": "Peenya Industrial Area", "category": "industrial", "notes": "One of Asia''s largest SME industrial clusters"},
   {"name": "Sri Kanteerava Stadium", "category": "sports"},
   {"name": "Lalbagh Botanical Garden", "category": "parks_open", "notes": "240-acre heritage garden"},
   {"name": "Yesvantpur Railway Station", "category": "transport"},
   {"name": "Yelahanka Air Force Station", "category": "defence"}
 ]'::jsonb,
 1, 'Existing Land Use Map — labeled landmarks',
 0.95, 'approved'),

-- ========================================================================
-- Adjacent planning authorities to BMA (boundary callouts)
-- ========================================================================

('9a8df7c8-c63e-49c6-808d-7707b6c1235f', 'boundary', 'adjacent_planning_authorities',
 '[
   {"code": "BIAAPA",        "name": "Bangalore International Airport Area Planning Authority", "direction": "north"},
   {"code": "Hosakote PA",   "name": "Hosakote Planning Authority",                              "direction": "east"},
   {"code": "Anekal PA",     "name": "Anekal Planning Authority",                                "direction": "south-east"},
   {"code": "Magadi PA",     "name": "Magadi Planning Authority",                                "direction": "west"},
   {"code": "Kanakapura PA", "name": "Kanakapura Planning Authority",                            "direction": "south-west"},
   {"code": "Nelamangala PA","name": "Nelamangala Planning Authority",                           "direction": "north-west"},
   {"code": "GBBSC PA",      "name": "Greater Bangalore Border Settlements Conservation Planning Authority", "direction": "across boundary"}
 ]'::jsonb,
 1, 'Existing/Proposed Land Use Maps — labeled adjacent PAs',
 0.95, 'approved');

-- Verification: post-apply summary by fact-type/key prefix
SELECT
  fact_type,
  COUNT(*) FILTER (WHERE fact_key LIKE 'existing_%')::int AS existing_shares,
  COUNT(*) FILTER (WHERE fact_key LIKE 'proposed_%')::int AS proposed_shares,
  COUNT(*) FILTER (WHERE fact_type = 'land_use_total')::int AS totals,
  COUNT(*) FILTER (WHERE fact_type IN ('landmark','boundary'))::int AS callouts
FROM regulatory_data.evidence_facts
WHERE fact_type IN ('land_use_share', 'land_use_total', 'landmark', 'boundary')
GROUP BY fact_type
ORDER BY fact_type;

COMMIT;
