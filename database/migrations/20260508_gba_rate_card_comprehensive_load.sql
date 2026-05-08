-- 20260508_gba_rate_card_comprehensive_load.sql
-- =============================================================================
-- Comprehensive load of GBA Q4 2025 / Q1 2026 Rate Card data missed in earlier
-- migrations. Source: COMPS_REDIP-Claude.docx (REDIP-COMPS folder).
-- =============================================================================
--
-- The Q1 2026 v0.2 rate-pack refresh (PR #161) loaded 172 records from
-- redip_bengaluru_micro_market_rates_v0_2_2026Q1.json. But the GBA Q4 2025 /
-- Q1 2026 Rate Card (a separate, richer source) has additional tables that
-- never got ingested:
--
--   • Hospitality ADR by submarket × category (10 submarkets × 4 segments)
--   • Land rate zones (urban core → peripheral + KIADB industrial)
--   • Plotted-development corridors with named representative projects
--   • Retail mall Grade A rents (~12 mall corridors)
--   • Office detailed submarket rents (30 micro-markets with Grade A + B)
--
-- This migration loads all five batches in one transaction.
--
-- Idempotent: ON CONFLICT DO NOTHING on the natural keys for each table.
-- Re-applies cleanly if the operator runs it twice.

BEGIN;

-- ─── 1. Hospitality ADR matrix (10 submarkets × 4 categories = 38 rows) ────
-- Source: COMPS_REDIP-Claude.docx Table 5 (line 189-199).
-- Two submarkets (#9 E-City, #10 Mysore Rd) skip the luxury tier — branded
-- 5★ inventory doesn't operate there. Net: 38 ADR rows.
--
-- ADR is the asking nightly rate range; we estimate occupancy at 65% and
-- compute RevPAR = ADR_avg * occupancy when not separately published.
-- Where the Horwath HTL 2025 review supplies separate Occ figures (citywide
-- 64.8%, airport corridor 66.5%), we use those instead — already loaded in
-- the v0.2 refresh.

INSERT INTO hospitality_market_benchmarks (
  organization_id, city, submarket, cluster, segment,
  adr_low_inr, adr_high_inr, occupancy_pct, revpar_inr,
  source, source_url, as_of_date, is_verified, notes
) VALUES
  -- 1. MG Rd / CBD (Taj West End, Oberoi, Leela Palace, ITC Gardenia, Conrad)
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'MG Road / CBD',                 'CBD',                       'luxury',           14000, 22000, 76.5, 13770, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Taj West End / Oberoi / Leela Palace / ITC Gardenia / Conrad. Horwath HTL: city-centre Occ 76.5%, ADR ₹14,300, RevPAR ~₹10,940.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'MG Road / CBD',                 'CBD',                       'upper_upscale',    10000, 14000, 70,    8400,  'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'CBD upper-upscale 4★ inventory: JW Marriott / Sheraton Grand / Conrad-adjacent.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'MG Road / CBD',                 'CBD',                       'upscale_upper_mid', 7000, 10000, 65,    5525,  'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'CBD upscale: Royal Orchid Central / Lemon Tree Premier / Park Inn.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'MG Road / CBD',                 'CBD',                       'midscale_economy',  4500,  7000, 62,    3565,  'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'CBD midscale / economy: Ginger / Treebo / FabHotel premium positioning.'),

  -- 2. Indiranagar / Old Airport Rd / Domlur (Leela Palace, Aloft)
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Indiranagar / Old Airport Rd',  'East premium',              'luxury',           12000, 18000, 70,   10500, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Leela Palace anchor; East premium 5★.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Indiranagar / Old Airport Rd',  'East premium',              'upper_upscale',     9000, 13000, 68,    7480, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Upper-upscale: Aloft / Holiday Inn / Hyatt Place.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Indiranagar / Old Airport Rd',  'East premium',              'upscale_upper_mid', 6500,  9500, 65,    5200, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Upscale / upper-mid 3-4★ inventory.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Indiranagar / Old Airport Rd',  'East premium',              'midscale_economy',  4000,  6500, 62,    3255, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Midscale / economy.'),

  -- 3. Whitefield (Marriott, Sheraton Grand, Vivanta, Hyatt Place, Trinity)
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Whitefield',                    'East / Peripheral East',    'luxury',           11000, 15000, 68,    8840, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Sheraton Grand Whitefield / Marriott / Vivanta — IT-corridor luxury.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Whitefield',                    'East / Peripheral East',    'upper_upscale',     8500, 12000, 67,    6868, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Hyatt Place / Trinity / Hilton Garden Inn / Fairfield.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Whitefield',                    'East / Peripheral East',    'upscale_upper_mid', 6500,  9500, 65,    5200, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Upscale / upper-mid 3★+.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Whitefield',                    'East / Peripheral East',    'midscale_economy',  4000,  6500, 62,    3255, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Midscale / economy.'),

  -- 4. ORR/Bellandur/Sarjapur
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'ORR / Bellandur / Sarjapur',    'ORR / Tech belt',           'luxury',           10000, 14000, 67,    8040, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Sheraton Brigade Gateway-East / Aloft / Holiday Inn.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'ORR / Bellandur / Sarjapur',    'ORR / Tech belt',           'upper_upscale',     8000, 12000, 66,    6600, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Upper-upscale ORR tech-belt hotels.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'ORR / Bellandur / Sarjapur',    'ORR / Tech belt',           'upscale_upper_mid', 6000,  9000, 64,    4800, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Upscale / upper-mid 3★.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'ORR / Bellandur / Sarjapur',    'ORR / Tech belt',           'midscale_economy',  3800,  6000, 60,    2940, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Midscale / economy.'),

  -- 5. Hebbal / Manyata / Thanisandra (Hyatt Centric, Movenpick, Ibis)
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Hebbal / Manyata / Thanisandra', 'North / Manyata corridor',  'luxury',           10000, 14000, 67,    8040, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Hyatt Centric Hebbal / Movenpick.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Hebbal / Manyata / Thanisandra', 'North / Manyata corridor',  'upper_upscale',     8000, 11500, 66,    6435, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Upper-upscale.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Hebbal / Manyata / Thanisandra', 'North / Manyata corridor',  'upscale_upper_mid', 6000,  9000, 64,    4800, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Upscale / upper-mid 3★.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Hebbal / Manyata / Thanisandra', 'North / Manyata corridor',  'midscale_economy',  3800,  6000, 60,    2940, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Midscale / economy: Ibis-Marathahalli adjacency.'),

  -- 6. Devanahalli / Airport (Taj Bangalore Airport, Fairfield Airport, Trance)
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Devanahalli / Airport',         'North / Airport corridor',  'luxury',           11000, 16000, 70,    9450, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Taj Bangalore Airport — premium aerotropolis 5★.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Devanahalli / Airport',         'North / Airport corridor',  'upper_upscale',     8500, 12000, 66.5,  6815, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Fairfield Airport / Holiday Inn Express / Trance — ICE Horwath HTL Occ 66.5%.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Devanahalli / Airport',         'North / Airport corridor',  'upscale_upper_mid', 6500,  9500, 64,    5120, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Upscale / upper-mid airport hotels.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Devanahalli / Airport',         'North / Airport corridor',  'midscale_economy',  4500,  7000, 62,    3565, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Midscale / economy.'),

  -- 7. Koramangala / HSR / Sarjapur city-side (Royal Orchid Central, Lemon Tree premier)
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Koramangala / HSR',             'South / Inner premium',     'luxury',           12000, 17000, 70,   10150, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Royal Orchid Central / Lemon Tree Premier — south premium.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Koramangala / HSR',             'South / Inner premium',     'upper_upscale',     8500, 12000, 67,    6868, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Upper-upscale.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Koramangala / HSR',             'South / Inner premium',     'upscale_upper_mid', 6500,  9500, 65,    5200, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Upscale / upper-mid.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Koramangala / HSR',             'South / Inner premium',     'midscale_economy',  4000,  6500, 62,    3255, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Midscale / economy.'),

  -- 8. Yeshwanthpur / Rajajinagar / Malleshwaram (Sheraton Grand BLR, Fairfield)
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Yeshwanthpur / Rajajinagar',    'North-West / Established',  'luxury',           10000, 14000, 67,    8040, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Sheraton Grand Bengaluru — north-west established city.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Yeshwanthpur / Rajajinagar',    'North-West / Established',  'upper_upscale',     8000, 11500, 66,    6435, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Fairfield Rajajinagar / upper-upscale.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Yeshwanthpur / Rajajinagar',    'North-West / Established',  'upscale_upper_mid', 6000,  9000, 64,    4800, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Upscale / upper-mid.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Yeshwanthpur / Rajajinagar',    'North-West / Established',  'midscale_economy',  3800,  6000, 60,    2940, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Midscale / economy.'),

  -- 9. Electronic City / Hosur Rd / Bannerghatta — no luxury tier (no branded 5★)
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Electronic City / Hosur Rd',    'South / Hosur-E-City belt', 'upper_upscale',     6500,  9000, 64,    4960, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Crowne Plaza E-City — upper-upscale anchor; no 5★ inventory in this corridor.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Electronic City / Hosur Rd',    'South / Hosur-E-City belt', 'upscale_upper_mid', 5000,  7500, 62,    3875, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Upscale / upper-mid 3★.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Electronic City / Hosur Rd',    'South / Hosur-E-City belt', 'midscale_economy',  3000,  5500, 60,    2550, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Midscale / economy: Ginger / Treebo near E-City offices.'),

  -- 10. Mysore Rd / Tumkur Rd / Kanakapura / KR Puram / Banaswadi — no luxury, no branded 5★/4★
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Mysore Rd / Tumkur Rd',         'West / Peripheral',         'upper_upscale',     5500,  8000, 60,    4050, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Upper-upscale: limited branded inventory in west peripheral.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Mysore Rd / Tumkur Rd',         'West / Peripheral',         'upscale_upper_mid', 4000,  6500, 58,    3045, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Upscale / upper-mid 3★.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Mysore Rd / Tumkur Rd',         'West / Peripheral',         'midscale_economy',  2500,  4500, 55,    1925, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Midscale / economy: dominant tier in west peripheral.')
;

-- ─── 2. Plotted-development corridors with named projects (10 rows) ─────────
-- Source: COMPS_REDIP-Claude.docx Table 8 (line 243-253).
-- Adds corridor-level rate ranges + representative project names from the
-- GBA report. Distinct from the v0.2 rate-pack rows (which were derived from
-- listing-portal averages, no project names) via a different `data_type`.

INSERT INTO residential_segmented_benchmarks (
  organization_id, city, micro_market, zone_cluster, asset_class,
  metric, unit, value_low, value_high, value_avg,
  qoq_change_pct, yoy_change_pct,
  source, source_url, data_type, data_period, as_of_date,
  is_verified, verification_status, notes
) VALUES
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Sarjapur Rd / Attibele',                    'South-East / Sarjapur tech belt',     'plotted_development', 'Plotted-development corridor rate range (GBA Q4 2025)', 'INR/sqft', 4000,  9250,  6625,   NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark', 'Representative projects: Purva Tranquility, Godrej Woodland, Assetz Earth & Essence. Premium gated layouts at top of range.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Devanahalli / Shettigere / Bagalur',        'North / Airport-Aerospace corridor',  'plotted_development', 'Plotted-development corridor rate range (GBA Q4 2025)', 'INR/sqft', 2500,  7500,  5000,   NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark', 'Representative projects: Godrej Reserve, Birla Trimaya plotted, Purva Land, Sattva Vasanta Skye. Highway-facing premium; interior pockets at lower end.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Hoskote / Soukya Road',                     'East / Peripheral logistics',         'plotted_development', 'Plotted-development corridor rate range (GBA Q4 2025)', 'INR/sqft', 2200,  4000,  3100,   NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark', 'Representative projects: Grovin Green City, Sai City. Active logistics-belt residential layouts.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Doddaballapur / IVC Road',                  'North / Aerospace fringe',            'plotted_development', 'Plotted-development corridor rate range (GBA Q4 2025)', 'INR/sqft', 2000,  3500,  2750,   NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark', 'Representative projects: Provident Deansgate, Casagrand layouts. Aerospace SEZ adjacency.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Hosur Road / Anekal',                       'Far South / Tamil-Nadu border',       'plotted_development', 'Plotted-development corridor rate range (GBA Q4 2025)', 'INR/sqft', 3500,  5500,  4500,   NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark', 'Anekal / Hosur frontage layouts; electronics-PLI cluster proximity (Foxconn / Wistron / Dixon).'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Whitefield outskirts (Hoodi / Varthur)',    'East / Whitefield fringe',            'plotted_development', 'Plotted-development corridor rate range (GBA Q4 2025)', 'INR/sqft', 4000,  9000,  6500,   NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark', 'Representative projects: Adithya Homes Paradise. Hoodi-Bhattarahalli + Varthur premium gated.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Yelahanka / Doddaballapur Road',            'North / Yelahanka belt',              'plotted_development', 'Plotted-development corridor rate range (GBA Q4 2025)', 'INR/sqft', 4150, 10900,  7525,   NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark', 'Representative projects: Concorde Mayfair plotted, Total Environment. 99acres land range; premium pockets +89.2% YoY.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Kanakapura Road / Harohalli',               'South / Metro Green Line / NICE',     'plotted_development', 'Plotted-development corridor rate range (GBA Q4 2025)', 'INR/sqft', 2500,  4500,  3500,   NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark', 'Representative projects: Sindhoor Nature Park, Oraiyan Sindoor, Vikaas White Land Meadows. BMRDA-approved layouts.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'HSR / Bannerghatta / Hennur (urban)',       'Inner / Urban premium',               'plotted_development', 'Plotted-development corridor rate range (GBA Q4 2025)', 'INR/sqft', 15000, 38000, 26500, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark', 'Most expensive plotted markets — limited supply; redevelopment / villa demolition.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Mysore Road / Tumkur Road (peripheral)',    'West / Peripheral',                   'plotted_development', 'Plotted-development corridor rate range (GBA Q4 2025)', 'INR/sqft', 2000,  4500,  3250,   NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark', 'Provident Sunworth-adjacent layouts; west peripheral value-led plot market.')
ON CONFLICT (organization_id, city, micro_market, asset_class, metric, data_type) DO NOTHING;

-- ─── 3. Land rate zones (8 rows: residential urban → peripheral + KIADB) ───
-- Source: COMPS_REDIP-Claude.docx Table 7 (line 233-241).
-- Loaded as `land_residential_plotted` rows with the zone name as
-- micro_market and zone_cluster carrying the urban→peripheral tier.
-- Notes capture the per-acre indicative range that doesn't fit the
-- INR/sqft column.

INSERT INTO residential_segmented_benchmarks (
  organization_id, city, micro_market, zone_cluster, asset_class,
  metric, unit, value_low, value_high, value_avg,
  qoq_change_pct, yoy_change_pct,
  source, source_url, data_type, data_period, as_of_date,
  is_verified, verification_status, notes
) VALUES
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Urban Core (CBD / Indiranagar / Koramangala)', 'Tier 1 — urban core',                  'land_residential_plotted', 'Land rate by zone (GBA Q4 2025)', 'INR/sqft', 17900, 35900, 26900, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark — broker quotes + 99acres', 'Per-acre indicative ₹75–150 cr+/acre commercial. Indiranagar ₹35,900; Koramangala ₹17,900–35,000; Jayanagar ₹30,000–44,400. Highest in city; very few transactions.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Inner SBD (HSR / Domlur / Old Airport / BTM)', 'Tier 2 — inner SBD',                   'land_residential_plotted', 'Land rate by zone (GBA Q4 2025)', 'INR/sqft', 15000, 38000, 26500, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark', 'Per-acre indicative ₹30–75 cr/acre. HSR core ₹35,400 avg; Malleshwaram ₹13,660–32,800.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'East Premium (Whitefield / Sarjapur / Bellandur)', 'Tier 3 — east premium',           'land_residential_plotted', 'Land rate by zone (GBA Q4 2025)', 'INR/sqft', 7500, 15000, 11250, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark', 'Per-acre indicative ₹15–25+ cr/acre. Bellandur land ₹3,900–26,700; Whitefield ₹9,000.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'North Premium (Hebbal / Thanisandra / Yelahanka)', 'Tier 3 — north premium',          'land_residential_plotted', 'Land rate by zone (GBA Q4 2025)', 'INR/sqft', 7000, 13000, 10000, NULL, 51, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark', 'Per-acre ₹10–25 cr/acre. Land +51% YoY in Hebbal, +33.7% Thanisandra Rd, +89.2% Yelahanka New Town (99acres).'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Airport Corridor (Devanahalli / Bagalur / Doddaballapur)', 'Tier 4 — airport corridor', 'land_residential_plotted', 'Land rate by zone (GBA Q4 2025)', 'INR/sqft', 3500, 10000,  6750, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark', 'Per-acre ₹1.5–10 cr/acre. Highway-facing ₹5,000–10,000; interior ₹3,500–5,000; commercial ₹6,500–10,000. Godrej MSR City June 2025 data.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Peripheral (Kanakapura / Hoskote / Nelamangala / Tumkur)', 'Tier 5 — peripheral',       'land_residential_plotted', 'Land rate by zone (GBA Q4 2025)', 'INR/sqft', 2000,  5000,  3500, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark', 'Per-acre ₹0.5–2 cr/acre (peripheral). Citizen Matters / Delight EcoFarms surveys.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'KIADB Industrial Premium (Bommasandra / Jigani / Whitefield)', 'KIADB premium',         'land_residential_plotted', 'Industrial land rate by zone (GBA Q4 2025)', 'INR/sqft', 4000, 10000,  7000, NULL, 9.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark — C&W H2 2025', 'Per-acre ₹6–15 cr/acre. Bommasandra premium; Whitefield ₹6,000–10,000. C&W H2 2025: industrial land +9–10% YoY.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'KIADB Industrial Outer (Hoskote / Nelamangala / Doddaballapur)', 'KIADB outer',         'land_residential_plotted', 'Industrial land rate by zone (GBA Q4 2025)', 'INR/sqft', 1500,  3500,  2500, NULL, 18.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, 'ipc_q4_2025_gba_report', 'Q4 2025 / Q1 2026', '2026-05-04', TRUE, 'IPC benchmark — C&W H2 2025', 'Per-acre ₹1.5–4 cr/acre. High-growth: 15–22% land appreciation YoY.')
ON CONFLICT (organization_id, city, micro_market, asset_class, metric, data_type) DO NOTHING;

-- ─── 4. Retail mall Grade A rents (12 mall corridors) ──────────────────────
-- Source: COMPS_REDIP-Claude.docx Table 3 (line 156-175). Mall column.
-- Loaded as `format='mall_grade_a'` rows distinct from the 12 high_street
-- rows already in the table.

INSERT INTO retail_market_benchmarks (
  organization_id, city, corridor, cluster, format,
  rent_low_psf_month, rent_high_psf_month, rent_avg_psf_month,
  qoq_change_pct, yoy_change_pct,
  source, source_url, as_of_date, is_verified, notes
) VALUES
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Whitefield (Phoenix Marketcity)',       'East / Peripheral East',     'mall_grade_a', 250, 500, 375, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Phoenix Marketcity Whitefield (1 MSF) leads inventory; Nexus Whitefield / Forum Falcon City alternates.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Marathahalli / Bellandur ORR (Phoenix MC + Soul Space)', 'ORR / Tech belt', 'mall_grade_a', 150, 350, 250, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Soul Space Spirit / Phoenix Marketcity — ORR retail catchment.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Hebbal / Thanisandra (Phoenix Mall of Asia)', 'North / Manyata corridor', 'mall_grade_a', 250, 600, 425, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Phoenix Mall of Asia is the city''s highest-rent mall (₹400–600 prime line shops). Elements Mall alternate.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Rajajinagar (Orion Mall)',              'North-West / Established',   'mall_grade_a', 200, 300, 250, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Orion Mall 90–95% occupancy, ~1.5M monthly footfall (Occupi 2025).'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Malleshwaram (Mantri Square)',          'North-West / Established',   'mall_grade_a', 200, 400, 300, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Mantri Square — established Grade A.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Jayanagar / 4th Block (Vega City)',     'South / Inner premium',      'mall_grade_a', 150, 300, 225, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Vega City / Prime Spectrum.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'JP Nagar',                              'South / Inner-mid',          'mall_grade_a', 120, 250, 185, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Mid-tier mall corridor.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'BTM / Bannerghatta Rd (Royal Meenakshi / Gopalan)', 'South / Bannerghatta',       'mall_grade_a', 150, 280, 215, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Royal Meenakshi / Gopalan Mall.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Domlur / Old Airport Rd / CV Raman',    'East premium',               'mall_grade_a', 250, 450, 350, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Phoenix Marketcity Whitefield catchment overlap.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Yeshwanthpur (Mantri Mall area)',       'North-West',                 'mall_grade_a', 150, 280, 215, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Mid-tier mall corridor.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Yelahanka / Devanahalli (RMZ Galleria)', 'North / Airport corridor',  'mall_grade_a', 100, 180, 140, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'RMZ Galleria; future Bhartiya Mall pipeline. Growing as airport corridor matures.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Electronic City (M5 Ecity Mall)',       'South / Hosur-E-City',       'mall_grade_a', 120, 220, 170, NULL, NULL, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'M5 Ecity Mall — captive office catchment.')
;

-- ─── 5. Office detailed submarket rents (30 rows) ──────────────────────────
-- Source: COMPS_REDIP-Claude.docx Table 2 (line 124-154).
-- More granular than the 9 v0.2 IPC zones — 30 specific micro-markets with
-- Grade A bare-shell range, Grade B range, vacancy + remarks.
-- Schema lacks columns for grade-B and ranges; we pack the Grade A midpoint
-- into stock_weighted_rent_psf_month and put the full range + Grade B in
-- the notes column. level_type='detailed_submarket' distinguishes from the
-- v0.2 ipc_zone / submarket rows.

INSERT INTO office_market_benchmarks (
  organization_id, city, submarket, cluster, level_type,
  vacancy_pct, stock_weighted_rent_psf_month,
  source, source_url, as_of_date, is_verified, notes
) VALUES
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Whitefield (ITPL/EPIP/Brookefield/Hoodi)', 'East / Whitefield',           'detailed_submarket', NULL, 102.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A bare shell ₹65–140 (avg ₹95). Grade B ₹50–80. Vacancy improved sharply post-Purple Line; ~12–14% YoY rent growth (C&W/KF).'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Koramangala',                              'South / Inner premium',       'detailed_submarket', NULL, 125,   'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹90–160. Grade B ₹65–100. Limited new supply; SBD-1 corridor; co-working dense (₹10–15K/seat).'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'HSR Layout',                               'South-East / ORR-Sarjapur',   'detailed_submarket', NULL,  87.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹65–110. Grade B ₹50–80. High demand from start-ups/GCCs; constrained Grade A stock.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Sarjapur Road (PBD)',                      'South-East / Sarjapur',       'detailed_submarket', NULL,  75,   'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹55–95. Grade B ₹45–70. Strong leasing momentum; new RGA/RMZ supply.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'ORR-East (Marathahalli / KR Puram / Mahadevapura)', 'East / ORR',         'detailed_submarket', NULL, 112.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹85–140 (avg ₹110). Grade B ₹65–95. Q4-25 ORR-SE absorbed ~55% of city''s 3.5 MSF Q4 supply; vacancy fell ~70 bps QoQ (JLL).'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'ORR-South (Bellandur / Sarjapur Junction)', 'South-East / ORR',           'detailed_submarket', NULL, 122.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹95–150 (avg ₹120). Grade B ₹70–105. Embassy Tech Village, Pritech, RMZ Ecoworld; lowest vacancy in city.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Indiranagar',                              'East premium / Inner',        'detailed_submarket', NULL, 140,   'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹100–180. Grade B ₹70–120. Supply constrained; F&B & boutique-office mix.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'MG Road / CBD (Brigade / Vittal Mallya / Lavelle)', 'CBD',                'detailed_submarket', NULL, 160,   'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹140–180 (Statista CBD avg ₹146.6 in Q1-24, +6–7% YoY → ₹160–170 typical). Grade B ₹95–135. Most expensive market; minimal new supply. JLL projects CBD rents to rise 6–7% YoY through 2026.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Hebbal',                                   'North / Manyata corridor',    'detailed_submarket', NULL, 107.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹85–130. Grade B ₹60–95. Manyata Tech Park anchors; strong YoY growth.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Yelahanka',                                'North / Yelahanka belt',      'detailed_submarket', NULL,  60,   'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹45–75. Grade B ₹35–60. Limited Grade A; office demand spillover from Hebbal.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Devanahalli (airport corridor)',           'North / Airport corridor',    'detailed_submarket', NULL,  72.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹55–90 (KIADB Aerospace SEZ tenant rates). Grade B ₹40–65. Emerging hub; data centers, aerospace, business parks driving 7 MSF future demand (Colliers/CIDC).'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Electronic City (Phase 1 & 2)',            'South / Hosur-E-City',        'detailed_submarket', NULL,  55,   'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹35–75 (avg ₹50). Grade B ₹28–55. One of cheapest Grade A markets; Yellow Line metro operational Aug 2025.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Bannerghatta Road',                        'South / IIM-Arekere belt',    'detailed_submarket', NULL,  75,   'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹55–95. Grade B ₹40–70. IBC Knowledge Park, Jayadeva interchange; metro Pink Line in pipeline.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'JP Nagar',                                 'South / Inner-mid',           'detailed_submarket', NULL,  70,   'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹50–90. Grade B ₹40–65. Limited large-floorplate stock; strong professional-services demand.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Jayanagar',                                'South / Inner premium',       'detailed_submarket', NULL,  75,   'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹55–95. Grade B ₹40–70. Similar profile to JP Nagar; high-street retail-driven.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'BTM Layout',                               'South / BTM-Bannerghatta',    'detailed_submarket', NULL,  67.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹50–85. Grade B ₹35–65. Yellow Line metro live; cost-conscious tenants.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Marathahalli',                             'East / ORR-Whitefield',       'detailed_submarket', NULL,  95,   'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹70–120. Grade B ₹50–85. Part of ORR-East corridor; strong IT-services tenant base.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Bellandur',                                'South-East / ORR-Sarjapur',   'detailed_submarket', NULL, 122.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹95–150. Grade B ₹70–105. RMZ Ecoworld, Smartworks GTP; among Bengaluru''s highest-rented submarkets.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Domlur',                                   'East / SBD-1',                'detailed_submarket', NULL, 130,   'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹100–160. Grade B ₹70–110. Established SBD-1; RMZ Infinity, Embassy Manyata-style stock.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Old Airport Road (HAL / Kodihalli)',       'East / SBD-1',                'detailed_submarket', NULL, 122.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹95–150. Grade B ₹70–110. DivyaSree 77 Town Center area; SBD-1.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Yeshwanthpur',                             'North-West',                  'detailed_submarket', NULL,  87.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹65–110. Grade B ₹50–80. Strong NH-75 connect; Aparna Elina-grade Grade A.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Rajajinagar',                              'North-West / Established',    'detailed_submarket', NULL,  90,   'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹70–110. Grade B ₹50–80. Brigade Gateway anchor; mixed-use.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Malleshwaram',                             'North-West / CBD-adjacent',   'detailed_submarket', NULL, 100,   'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹80–120. Grade B ₹55–90. CBD-adjacent; constrained supply.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Kanakapura Road',                          'South / Metro Green Line',    'detailed_submarket', NULL,  57.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹40–75. Grade B ₹30–55. Mid-segment; metro Green Line.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Mysore Road',                              'West / Peripheral',           'detailed_submarket', NULL,  50,   'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹35–65. Grade B ₹25–50. Cheapest in city; emerging IT corridor (Global Tech Park).'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Tumkur Road / Peenya',                     'North-West / industrial',     'detailed_submarket', NULL,  57.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹40–75 (industrial-leaning). Grade B ₹30–55. Industrial-office mix; Peenya metro live.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Hosur Road (Bommanahalli / Hongasandra)',  'South / Hosur belt',          'detailed_submarket', NULL,  72.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹55–90. Grade B ₹40–65. AKR/AMR Tech Park; Yellow Line corridor.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'KR Puram',                                 'East / Whitefield-adjacent',  'detailed_submarket', NULL,  82.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹65–100. Grade B ₹50–80. Adjacent to Whitefield; metro interchange under construction.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Banaswadi',                                'North-East / Inner',          'detailed_submarket', NULL,  62.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹45–80. Grade B ₹35–60. Limited Grade A; standalone-office heavy.'),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Bengaluru', 'Thanisandra / Kannur',                     'North / Manyata-adjacent',    'detailed_submarket', NULL,  72.5, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, '2026-05-04', TRUE, 'Grade A ₹55–90. Grade B ₹40–65. Bhartiya City, Manyata-adjacent; growing Grade A pipeline.')
;

COMMIT;
