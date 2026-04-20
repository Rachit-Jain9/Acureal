-- =====================================================================
-- Bengaluru RMP 2031 (Draft) — Master Plan Zone Seed Data
-- Source: Revised Master Plan for Bengaluru 2031 (Draft), Volume 6
-- Zoning Regulations. Published by BDA on OpenCity.in.
-- Date of extraction: 2026-04-20
--
-- IMPORTANT: RMP 2031 is in DRAFT status. RMP 2041 is at Declaration
-- of Intention stage only (BDA tendered for consultants ~Apr 1, 2026).
-- Always verify with BBMP / BDA before using in underwriting.
--
-- FAR (Floor Area Ratio) in RMP 2031 is a function of (planning zone,
-- plot size, road width). We seed per planning zone and use the
-- fsi_road_width_rules JSONB field to encode the road-width tier.
-- Ground coverage and setbacks vary by plot size too; seed values
-- represent the typical mid-tier plot (around 360–2000 sqm).
-- =====================================================================

-- 1) Source document record
INSERT INTO regulatory_data.master_plan_documents
  (id, city, plan_name, plan_version, file_url, storage_path, extraction_status)
VALUES
  ('11111111-0000-0000-0000-000000000001',
   'Bengaluru',
   'Revised Master Plan for Bengaluru 2031 (Draft) — Volume 6 Zoning Regulations',
   'RMP 2031 Draft',
   'https://opencity.in/',
   NULL,
   'completed')
ON CONFLICT (id) DO NOTHING;

-- Helper: all zones below reference the same document and are
-- pre-approved (they are verbatim from the source PDF, curated manually).
-- review_status = 'approved', effective_from = RMP 2031 Draft publication window.

-- =====================================================================
-- RESIDENTIAL
-- =====================================================================

INSERT INTO regulatory_data.master_plan_zones (
  document_id, city, plan_version, zone_code, zone_name,
  permissible_fsi_base, permissible_fsi_max,
  fsi_road_width_rules,
  ground_coverage_pct, building_height_max_m, road_width_min_m,
  setback_rules, permissible_uses, prohibited_uses,
  notes, source_page, source_section,
  review_status, effective_from
) VALUES
-- Residential — Planning Zone A (inside Outer Ring Road)
(
  '11111111-0000-0000-0000-000000000001',
  'Bengaluru', 'RMP 2031 Draft',
  'R-PZ-A', 'Residential (Planning Zone A — inside ORR)',
  1.50, 2.70,
  '[
    {"road_width_m": 15.5, "fsi": 2.25},
    {"road_width_m": 18.5, "fsi": 2.40},
    {"road_width_m": 24.5, "fsi": 2.50},
    {"road_width_m": 30.5, "fsi": 2.70}
  ]'::jsonb,
  65, 45, 9.0,
  '{"front_m": 4.5, "rear_m": 3.0, "side_m": 3.0}'::jsonb,
  ARRAY['Plotted residential','Villas, row houses, semi-detached','Apartments, studio apartments, service apartments','Group housing','Hostels, PG accommodation, dharmashalas','Orphanages, old age homes','EWS/LIG/MIG/HIG housing','Metro stations, bus shelters','Solar generation units'],
  ARRAY['Commercial activity below 12.5 m road width','Industrial use (except I-1 under special circumstances ≥9.5 m)'],
  'RMP 2031 Draft, Chapter 5 "Residential Use Zone Regulations" (p.43–54). Table 6: FAR and Ground Coverage for Plots up to 20000 sqm, Planning Zone A. FAR ranges from 1.50 (road <6 m) to 2.70 (road ≥30.5 m). If road width is lower than that prescribed for the site size, the FAR of the lower road width applies. If road <9.5 m height is capped at Stilt+2 / GF+1. Commercial/ancillary use prohibited if road <12.5 m.',
  45, 'Chapter 5 — Residential Use Zone Regulations',
  'approved', '2017-11-25'
),
-- Residential — Planning Zone B (outside ORR, within conurbation limit)
(
  '11111111-0000-0000-0000-000000000001',
  'Bengaluru', 'RMP 2031 Draft',
  'R-PZ-B', 'Residential (Planning Zone B — outside ORR)',
  1.50, 3.20,
  '[
    {"road_width_m": 9.5,  "fsi": 1.80},
    {"road_width_m": 15.5, "fsi": 2.40},
    {"road_width_m": 18.5, "fsi": 2.70},
    {"road_width_m": 24.5, "fsi": 3.00},
    {"road_width_m": 30.5, "fsi": 3.20}
  ]'::jsonb,
  65, 45, 9.0,
  '{"front_m": 4.5, "rear_m": 3.0, "side_m": 3.0}'::jsonb,
  ARRAY['Plotted residential','Villas, row houses, semi-detached','Apartments, studio apartments, service apartments','Group housing','Hostels, PG accommodation, dharmashalas','Orphanages, old age homes','EWS/LIG/MIG/HIG housing','Metro stations, bus shelters','Solar generation units'],
  ARRAY['Commercial activity below 12.5 m road width','Industrial use (except I-1 under special circumstances ≥9.5 m)'],
  'RMP 2031 Draft, Chapter 5 "Residential Use Zone Regulations" (p.43–54). Table 7: FAR and Ground Coverage for Plots up to 20000 sqm, Planning Zone B. FAR ranges from 1.50 (road <9.5 m) to 3.20 (road ≥30.5 m). Planning Zone B permits ancillary use as main use if site >1000 sqm, frontage ≥20 m, road ≥18 m.',
  46, 'Chapter 5 — Residential Use Zone Regulations',
  'approved', '2017-11-25'
);

-- =====================================================================
-- COMMERCIAL (general commercial — C-3 is the middle of the five tiers)
-- =====================================================================

INSERT INTO regulatory_data.master_plan_zones (
  document_id, city, plan_version, zone_code, zone_name,
  permissible_fsi_base, permissible_fsi_max,
  fsi_road_width_rules,
  ground_coverage_pct, building_height_max_m, road_width_min_m,
  setback_rules, permissible_uses, prohibited_uses,
  notes, source_page, source_section,
  review_status, effective_from
) VALUES
-- C-3 — General commercial, Planning Zone A
(
  '11111111-0000-0000-0000-000000000001',
  'Bengaluru', 'RMP 2031 Draft',
  'C-3-PZ-A', 'Commercial C-3 (Planning Zone A)',
  1.20, 2.40,
  '[
    {"road_width_m": 12.5, "fsi": 2.00},
    {"road_width_m": 18.5, "fsi": 2.10},
    {"road_width_m": 24.5, "fsi": 2.25},
    {"road_width_m": 30.5, "fsi": 2.40}
  ]'::jsonb,
  50, 45, 12.5,
  '{"front_m": 4.5, "rear_m": 3.0, "side_m": 3.0}'::jsonb,
  ARRAY['Commercial and corporate offices','Retail shopping complexes, departmental stores, show rooms','Restaurants and hotels','Convention centres, banquet halls, kalyana mantaps','Financial institutions, banks, ATMs','Cinema, multiplexes, entertainment centres','Hospitals, specialty hospitals, pathology labs, scanning centres','Automobile repair/garage, spare parts','Education coaching centres','All uses of C-1, C-2 (petty shops, eateries, clinics, gyms, etc.)'],
  ARRAY['Wholesale warehouses (C-4 only)','Agro mandis, heavy goods markets (C-5 only)'],
  'RMP 2031 Draft, Chapter 6.1 "Commercial Land Use Zone Regulations" (p.55–59). Table 12: FAR and Ground Coverage for Commercial in Planning Zone A (up to 12000 sqm). FAR ranges from 1.20 (road <9.5 m) to 2.40 (road ≥30.5 m). C-3 is the general commercial category covering most retail/office/hospitality uses.',
  59, 'Chapter 6.1 — Commercial Land Use Zone Regulations',
  'approved', '2017-11-25'
),
-- C-3 — General commercial, Planning Zone B
(
  '11111111-0000-0000-0000-000000000001',
  'Bengaluru', 'RMP 2031 Draft',
  'C-3-PZ-B', 'Commercial C-3 (Planning Zone B)',
  1.50, 3.20,
  '[
    {"road_width_m": 12.5, "fsi": 2.60},
    {"road_width_m": 18.5, "fsi": 2.80},
    {"road_width_m": 24.5, "fsi": 3.00},
    {"road_width_m": 30.5, "fsi": 3.20}
  ]'::jsonb,
  50, 45, 12.5,
  '{"front_m": 4.5, "rear_m": 3.0, "side_m": 3.0}'::jsonb,
  ARRAY['Commercial and corporate offices','Retail shopping complexes, departmental stores, show rooms','Restaurants and hotels','Convention centres, banquet halls, kalyana mantaps','Financial institutions, banks, ATMs','Cinema, multiplexes, entertainment centres','Hospitals, specialty hospitals, pathology labs, scanning centres','Automobile repair/garage, spare parts','Education coaching centres','All uses of C-1, C-2 (petty shops, eateries, clinics, gyms, etc.)'],
  ARRAY['Wholesale warehouses (C-4 only)','Agro mandis, heavy goods markets (C-5 only)'],
  'RMP 2031 Draft, Chapter 6.1 "Commercial Land Use Zone Regulations" (p.55–59). Table 13: FAR and Ground Coverage for Commercial in Planning Zone B (up to 12000 sqm). FAR ranges from 1.50 (road <9.5 m) to 3.20 (road ≥30.5 m). Higher FAR than Planning Zone A throughout.',
  59, 'Chapter 6.1 — Commercial Land Use Zone Regulations',
  'approved', '2017-11-25'
);

-- =====================================================================
-- INDUSTRIAL (I-2 — service / light industries with R&D, IT/BT, BPO)
-- =====================================================================

INSERT INTO regulatory_data.master_plan_zones (
  document_id, city, plan_version, zone_code, zone_name,
  permissible_fsi_base, permissible_fsi_max,
  fsi_road_width_rules,
  ground_coverage_pct, building_height_max_m, road_width_min_m,
  setback_rules, permissible_uses, prohibited_uses,
  notes, source_page, source_section,
  review_status, effective_from
) VALUES
-- I-2 — Service / light industries (IT/BT/BPO, R&D labs, film studios)
(
  '11111111-0000-0000-0000-000000000001',
  'Bengaluru', 'RMP 2031 Draft',
  'I-2', 'Industrial I-2 (Service / Light Industries — IT/BT/BPO, R&D)',
  1.50, 2.25,
  '[
    {"road_width_m": 15.0, "fsi": 1.75},
    {"road_width_m": 18.0, "fsi": 2.00},
    {"road_width_m": 24.0, "fsi": 2.25}
  ]'::jsonb,
  55, 30, 9.0,
  '{"front_m": 8.0, "rear_m": 6.0, "side_m": 6.0}'::jsonb,
  ARRAY['R&D labs, test centres','IT / BT / BPO activities','Film city, studios','All uses of I-1 household industries (food products, textile, wood, paper, leather, electronics repair, etc.)'],
  ARRAY['Heavy manufacturing (I-5 only)','Hazardous / pharmaceutical industries (I-5 only)','Gas godowns, warehousing (I-4 only)'],
  'RMP 2031 Draft, Chapter 6.2 "Industrial Land Use Zone Regulations" (p.60–64). Table 17: Setbacks and Coverage for Industrial Buildings. FAR ranges 1.50 (plot ≤500 sqm) to 2.25 (plot >8000 sqm, road ≥24 m). IT/BT/ITES and R&D are classified as I-2 — this is the Bangalore IT corridor baseline. Subject to environmental clearances for I-3 and above.',
  64, 'Chapter 6.2 — Industrial Land Use Zone Regulations',
  'approved', '2017-11-25'
);

-- =====================================================================
-- PUBLIC & SEMI-PUBLIC (PSP-3 — hospitals, education, large institutions)
-- =====================================================================

INSERT INTO regulatory_data.master_plan_zones (
  document_id, city, plan_version, zone_code, zone_name,
  permissible_fsi_base, permissible_fsi_max,
  fsi_road_width_rules,
  ground_coverage_pct, building_height_max_m, road_width_min_m,
  setback_rules, permissible_uses, prohibited_uses,
  notes, source_page, source_section,
  review_status, effective_from
) VALUES
(
  '11111111-0000-0000-0000-000000000001',
  'Bengaluru', 'RMP 2031 Draft',
  'PSP-3', 'Public & Semi-Public PSP-3 (Hospitals, Education, Institutions)',
  1.50, 2.25,
  '[
    {"road_width_m": 12.0, "fsi": 1.75},
    {"road_width_m": 18.0, "fsi": 2.00},
    {"road_width_m": 24.0, "fsi": 2.25}
  ]'::jsonb,
  50, 45, 9.0,
  '{"front_m": 4.5, "rear_m": 3.0, "side_m": 3.0}'::jsonb,
  ARRAY['Government offices, law courts, police stations','Hospitals, health tourism facilities','Educational institutions, universities','Cultural and religious institutions','Community halls, working hostels','Convention centres (non-commercial)','District and sub-district offices','Public utilities and infrastructure'],
  ARRAY['Pure commercial activity (use C zone)','Heavy industry'],
  'RMP 2031 Draft, Chapter 6.3 "Public and Semi-Public Land Use Zone Regulations" (p.65–67). Table 20: FAR and Ground Coverage in PSP Zone. FAR 1.50 (plot ≤500 sqm) to 2.25 (plot >2000 sqm). Ancillary uses limited to 20% of site area. Government-owned complexes, civic amenities, and large institutional infrastructure.',
  67, 'Chapter 6.3 — Public and Semi-Public Land Use Zone Regulations',
  'approved', '2017-11-25'
);

-- =====================================================================
-- TRANSPORTATION & COMMUNICATION (T-2 — general transport infrastructure)
-- =====================================================================

INSERT INTO regulatory_data.master_plan_zones (
  document_id, city, plan_version, zone_code, zone_name,
  permissible_fsi_base, permissible_fsi_max,
  fsi_road_width_rules,
  ground_coverage_pct, building_height_max_m, road_width_min_m,
  setback_rules, permissible_uses, prohibited_uses,
  notes, source_page, source_section,
  review_status, effective_from
) VALUES
(
  '11111111-0000-0000-0000-000000000001',
  'Bengaluru', 'RMP 2031 Draft',
  'T-2', 'Transportation & Communication T-2',
  1.00, 1.50,
  '[
    {"road_width_m": 18.0, "fsi": 1.25},
    {"road_width_m": 24.0, "fsi": 1.50}
  ]'::jsonb,
  55, 30, 12.0,
  '{"front_m": 4.5, "rear_m": 3.0, "side_m": 3.0}'::jsonb,
  ARRAY['Bus stations, bus depots','Truck terminals, logistics hubs','Railway stations','Metro stations, transit interchanges','Telecommunication facilities','Postal services, courier hubs'],
  ARRAY['Residential development','Commercial retail (except ancillary)'],
  'RMP 2031 Draft, Chapter 6.6 "Transportation and Communication Land Use Zone Regulations" (p.69–71). Table 22: FAR and Ground Coverage in Transportation and Communication Zone. FAR 1.00 (plot ≤500 sqm) to 1.50 (plot >1000 sqm).',
  71, 'Chapter 6.6 — Transportation and Communication Land Use Zone Regulations',
  'approved', '2017-11-25'
);

-- =====================================================================
-- PUBLIC UTILITIES (PU — non-buildable; buffers per competent authority)
-- =====================================================================

INSERT INTO regulatory_data.master_plan_zones (
  document_id, city, plan_version, zone_code, zone_name,
  permissible_fsi_base, permissible_fsi_max,
  fsi_road_width_rules,
  ground_coverage_pct, building_height_max_m, road_width_min_m,
  setback_rules, permissible_uses, prohibited_uses,
  notes, source_page, source_section,
  review_status, effective_from
) VALUES
(
  '11111111-0000-0000-0000-000000000001',
  'Bengaluru', 'RMP 2031 Draft',
  'PU', 'Public Utilities',
  NULL, NULL,
  '[]'::jsonb,
  NULL, NULL, NULL,
  '{"front_m": null, "rear_m": null, "side_m": null}'::jsonb,
  ARRAY['Water supply, sewerage, treatment plants','Power infrastructure (including HT lines)','Telecommunication installations','Oil and gas pipelines','Solid waste management (DWCC, landfills)'],
  ARRAY['Residential development','Commercial development','All built-up development'],
  'RMP 2031 Draft, Chapter 6.4 "Public Utilities Land Use Zone Regulations" (p.67). PU areas are generally NON-BUILDABLE and function as reservations for utilities. Buffers for HT lines, water/gas pipelines etc. are governed by technical standards of the concerned competent authority (KPTCL for electrical, etc.). Included in open-space calculations for adjacent developments. Permitted uses allowed by the Authority only.',
  67, 'Chapter 6.4 — Public Utilities Land Use Zone Regulations',
  'approved', '2017-11-25'
);

-- =====================================================================
-- OPEN SPACES (OS — parks, water bodies, burial grounds)
-- =====================================================================

INSERT INTO regulatory_data.master_plan_zones (
  document_id, city, plan_version, zone_code, zone_name,
  permissible_fsi_base, permissible_fsi_max,
  fsi_road_width_rules,
  ground_coverage_pct, building_height_max_m, road_width_min_m,
  setback_rules, permissible_uses, prohibited_uses,
  notes, source_page, source_section,
  review_status, effective_from
) VALUES
(
  '11111111-0000-0000-0000-000000000001',
  'Bengaluru', 'RMP 2031 Draft',
  'OS', 'Open Spaces (Parks, Water Bodies, Green Belt)',
  NULL, 0.05,
  '[]'::jsonb,
  5, 10, NULL,
  '{"front_m": null, "rear_m": null, "side_m": null}'::jsonb,
  ARRAY['Parks and gardens','Playgrounds, sports facilities, stadiums','Swimming pools','Burial grounds, cemeteries, crematoria','Water bodies and natural conservation areas'],
  ARRAY['Any commercial development','Residential development','Industrial use','Permanent built-up structures (except pavilions and ancillary)'],
  'RMP 2031 Draft, Chapter 6.5 "Open Spaces Land Use Zone Regulations" (p.68). Natural and man-made features for environmental conservation — water bodies, forests, drains, parks, playgrounds, burial grounds, crematoria. Lake buffer of 75 m and rajakaluve (storm drain) buffers apply. Eco-sensitive buffers per NGT notifications.',
  68, 'Chapter 6.5 — Open Spaces Land Use Zone Regulations',
  'approved', '2017-11-25'
);

-- =====================================================================
-- AGRICULTURE (A — outside conurbation limit, Planning Zone C)
-- =====================================================================

INSERT INTO regulatory_data.master_plan_zones (
  document_id, city, plan_version, zone_code, zone_name,
  permissible_fsi_base, permissible_fsi_max,
  fsi_road_width_rules,
  ground_coverage_pct, building_height_max_m, road_width_min_m,
  setback_rules, permissible_uses, prohibited_uses,
  notes, source_page, source_section,
  review_status, effective_from
) VALUES
(
  '11111111-0000-0000-0000-000000000001',
  'Bengaluru', 'RMP 2031 Draft',
  'A', 'Agriculture (Planning Zone C — outside conurbation limit)',
  NULL, 0.25,
  '[]'::jsonb,
  10, 10, NULL,
  '{"front_m": 9.0, "rear_m": 6.0, "side_m": 6.0}'::jsonb,
  ARRAY['Agriculture, horticulture, dairy, poultry, livestock','Agro-processing using locally produced raw material','Farm houses','Religious, education, health facilities','EWS housing schemes (by government) and old age homes','Service and repair of farm machinery','Solar farms, wind mills, water/power/waste treatment','Sports complexes, stadiums, playgrounds','Storage and sale of farm products'],
  ARRAY['Residential layouts (require land-use conversion under KTCP Act §14A)','Commercial retail','Industrial manufacturing (except agro-processing)'],
  'RMP 2031 Draft, Chapter 6.7 "Agricultural Land Use Zone Regulations" (p.72–73). Agriculture zone is the area OUTSIDE the conurbation limit of RMP 2031 — i.e., Planning Zone C. Land conversion under KTCP Act §14A required before any non-agricultural development. Buildable use limited to farm houses, education, health, EWS, and public utilities. Ancillary uses (brick kilns, slaughter houses, cold storage, fuel stations, LPG godowns) permissible under special circumstances only.',
  72, 'Chapter 6.7 — Agricultural Land Use Zone Regulations',
  'approved', '2017-11-25'
);

-- =====================================================================
-- Verification
-- =====================================================================
-- After running, confirm:
--   SELECT zone_code, zone_name, permissible_fsi_base, permissible_fsi_max,
--          jsonb_array_length(fsi_road_width_rules) AS tier_count,
--          review_status
--   FROM regulatory_data.master_plan_zones
--   WHERE plan_version = 'RMP 2031 Draft'
--   ORDER BY zone_code;
--
-- Expected: 9 rows — R-PZ-A, R-PZ-B, C-3-PZ-A, C-3-PZ-B, I-2, PSP-3,
--          T-2, PU, OS, A (some zones have no tiers — PU/OS/A).
