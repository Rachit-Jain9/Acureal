-- 20260508_db_cleanup_and_restore_gba_load.sql
-- =============================================================================
-- Production database hygiene + restore lost data from PR #175.
-- =============================================================================
--
-- Two concerns in one transaction:
--
-- 1. CLEANUP — 5 obsolete non-Bengaluru comps from before the Bengaluru-lock.
--    These rows have NULL data_type, NULL as_of_date, and source values like
--    '99acres' / 'Housing.com' / 'PropTiger' / 'Economic Times' (no specific
--    report identifier). They date from the multi-city demo era and now
--    inappropriately mix Mumbai and Hyderabad rows into Bengaluru-only views:
--      Kalpataru Paramount  (Mumbai / Thane West)
--      Oberoi Commerz III   (Mumbai / Goregaon East)
--      My Home Avatar       (Hyderabad / HITEC City)
--      Aparna Constructions Sarovar (Hyderabad / Kondapur)
--      Phoenix Palassio     (Hyderabad / Kondapur)
--
-- 2. RESTORE — re-load 80 GBA Q4 2025 rate-card rows that were lost.
--    Root cause: when the operator re-applied the 20260505 baseline (after
--    PR #176 fixed its ON CONFLICT bug), that migration's
--    `DELETE FROM <table> WHERE organization_id = v_org AND city = 'Bengaluru'`
--    clauses on hospitality / office / retail tables blew away rows that PR
--    #175 had loaded. Sections 2 and 3 of PR #175 (segmented_benchmarks)
--    were unaffected because that table was never DELETEd by 20260505.
--
--    Re-loading 38 hospitality + 30 office + 12 retail rows. Rows live
--    alongside the 20260505 baseline rows because:
--      - Hospitality: unique key (submarket, segment, as_of_date) differs by
--        as_of_date ('2026-05-04' vs '2026-01-01' / '2025-12-01').
--      - Office: unique key (submarket, level_type, as_of_date) differs by
--        level_type ('detailed_submarket' for these vs 'submarket'/'ipc_zone'
--        for baseline) AND as_of_date.
--      - Retail: unique key (corridor, format, as_of_date) differs by
--        as_of_date (baseline malls also have different corridor names).
--
-- Idempotent: NOT EXISTS guards on every INSERT.

BEGIN;

-- ── 1. CLEANUP — delete 5 obsolete non-Bengaluru demo comps ──────────────
DELETE FROM public.comps
 WHERE data_type IS NULL
   AND as_of_date IS NULL
   AND city IN ('Mumbai', 'Hyderabad')
   AND project_name IN (
     'Kalpataru Paramount',
     'Oberoi Commerz III',
     'My Home Avatar',
     'Aparna Constructions Sarovar',
     'Phoenix Palassio'
   );

-- ── 2. RESTORE — re-load 38 hospitality + 30 office + 12 retail rows ─────

DO $$
DECLARE
  v_org   UUID := 'd1218877-4d3a-4fe4-8d63-914fa8ffa94b';
  v_as_of DATE := '2026-05-04';
BEGIN

  -- 2a. Hospitality ADR matrix (10 submarkets × 4 categories = 38 rows)
  INSERT INTO hospitality_market_benchmarks (organization_id, city, submarket, cluster, segment, adr_low_inr, adr_high_inr, occupancy_pct, revpar_inr, source, source_url, as_of_date, is_verified, notes)
  SELECT v_org, 'Bengaluru', s.submarket, s.cluster, s.segment, s.adr_low, s.adr_high, s.occ, s.revpar, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, v_as_of, TRUE, s.notes
  FROM (VALUES
    ('MG Road / CBD',                              'CBD',                       'luxury',           14000, 22000, 76.5::NUMERIC, 13770, 'Taj West End / Oberoi / Leela Palace / ITC Gardenia / Conrad. Horwath HTL: city-centre Occ 76.5%, ADR ₹14,300, RevPAR ~₹10,940.'),
    ('MG Road / CBD',                              'CBD',                       'upper_upscale',    10000, 14000, 70::NUMERIC,    8400, 'CBD upper-upscale 4★ inventory: JW Marriott / Sheraton Grand / Conrad-adjacent.'),
    ('MG Road / CBD',                              'CBD',                       'upscale_upper_mid', 7000, 10000, 65::NUMERIC,    5525, 'CBD upscale: Royal Orchid Central / Lemon Tree Premier / Park Inn.'),
    ('MG Road / CBD',                              'CBD',                       'midscale_economy',  4500,  7000, 62::NUMERIC,    3565, 'CBD midscale / economy: Ginger / Treebo / FabHotel premium positioning.'),
    ('Indiranagar / Old Airport Rd',               'East premium',              'luxury',           12000, 18000, 70::NUMERIC,   10500, 'Leela Palace anchor; East premium 5★.'),
    ('Indiranagar / Old Airport Rd',               'East premium',              'upper_upscale',     9000, 13000, 68::NUMERIC,    7480, 'Upper-upscale: Aloft / Holiday Inn / Hyatt Place.'),
    ('Indiranagar / Old Airport Rd',               'East premium',              'upscale_upper_mid', 6500,  9500, 65::NUMERIC,    5200, 'Upscale / upper-mid 3-4★ inventory.'),
    ('Indiranagar / Old Airport Rd',               'East premium',              'midscale_economy',  4000,  6500, 62::NUMERIC,    3255, 'Midscale / economy.'),
    ('Whitefield',                                 'East / Peripheral East',    'luxury',           11000, 15000, 68::NUMERIC,    8840, 'Sheraton Grand Whitefield / Marriott / Vivanta — IT-corridor luxury.'),
    ('Whitefield',                                 'East / Peripheral East',    'upper_upscale',     8500, 12000, 67::NUMERIC,    6868, 'Hyatt Place / Trinity / Hilton Garden Inn / Fairfield.'),
    ('Whitefield',                                 'East / Peripheral East',    'upscale_upper_mid', 6500,  9500, 65::NUMERIC,    5200, 'Upscale / upper-mid 3★+.'),
    ('Whitefield',                                 'East / Peripheral East',    'midscale_economy',  4000,  6500, 62::NUMERIC,    3255, 'Midscale / economy.'),
    ('ORR / Bellandur / Sarjapur',                 'ORR / Tech belt',           'luxury',           10000, 14000, 67::NUMERIC,    8040, 'Sheraton Brigade Gateway-East / Aloft / Holiday Inn.'),
    ('ORR / Bellandur / Sarjapur',                 'ORR / Tech belt',           'upper_upscale',     8000, 12000, 66::NUMERIC,    6600, 'Upper-upscale ORR tech-belt hotels.'),
    ('ORR / Bellandur / Sarjapur',                 'ORR / Tech belt',           'upscale_upper_mid', 6000,  9000, 64::NUMERIC,    4800, 'Upscale / upper-mid 3★.'),
    ('ORR / Bellandur / Sarjapur',                 'ORR / Tech belt',           'midscale_economy',  3800,  6000, 60::NUMERIC,    2940, 'Midscale / economy.'),
    ('Hebbal / Manyata / Thanisandra',             'North / Manyata corridor',  'luxury',           10000, 14000, 67::NUMERIC,    8040, 'Hyatt Centric Hebbal / Movenpick.'),
    ('Hebbal / Manyata / Thanisandra',             'North / Manyata corridor',  'upper_upscale',     8000, 11500, 66::NUMERIC,    6435, 'Upper-upscale.'),
    ('Hebbal / Manyata / Thanisandra',             'North / Manyata corridor',  'upscale_upper_mid', 6000,  9000, 64::NUMERIC,    4800, 'Upscale / upper-mid 3★.'),
    ('Hebbal / Manyata / Thanisandra',             'North / Manyata corridor',  'midscale_economy',  3800,  6000, 60::NUMERIC,    2940, 'Midscale / economy: Ibis-Marathahalli adjacency.'),
    ('Devanahalli / Airport',                      'North / Airport corridor',  'luxury',           11000, 16000, 70::NUMERIC,    9450, 'Taj Bangalore Airport — premium aerotropolis 5★.'),
    ('Devanahalli / Airport',                      'North / Airport corridor',  'upper_upscale',     8500, 12000, 66.5::NUMERIC,  6815, 'Fairfield Airport / Holiday Inn Express / Trance — Horwath HTL Occ 66.5%.'),
    ('Devanahalli / Airport',                      'North / Airport corridor',  'upscale_upper_mid', 6500,  9500, 64::NUMERIC,    5120, 'Upscale / upper-mid airport hotels.'),
    ('Devanahalli / Airport',                      'North / Airport corridor',  'midscale_economy',  4500,  7000, 62::NUMERIC,    3565, 'Midscale / economy.'),
    ('Koramangala / HSR',                          'South / Inner premium',     'luxury',           12000, 17000, 70::NUMERIC,   10150, 'Royal Orchid Central / Lemon Tree Premier — south premium.'),
    ('Koramangala / HSR',                          'South / Inner premium',     'upper_upscale',     8500, 12000, 67::NUMERIC,    6868, 'Upper-upscale.'),
    ('Koramangala / HSR',                          'South / Inner premium',     'upscale_upper_mid', 6500,  9500, 65::NUMERIC,    5200, 'Upscale / upper-mid.'),
    ('Koramangala / HSR',                          'South / Inner premium',     'midscale_economy',  4000,  6500, 62::NUMERIC,    3255, 'Midscale / economy.'),
    ('Yeshwanthpur / Rajajinagar',                 'North-West / Established',  'luxury',           10000, 14000, 67::NUMERIC,    8040, 'Sheraton Grand Bengaluru — north-west established city.'),
    ('Yeshwanthpur / Rajajinagar',                 'North-West / Established',  'upper_upscale',     8000, 11500, 66::NUMERIC,    6435, 'Fairfield Rajajinagar / upper-upscale.'),
    ('Yeshwanthpur / Rajajinagar',                 'North-West / Established',  'upscale_upper_mid', 6000,  9000, 64::NUMERIC,    4800, 'Upscale / upper-mid.'),
    ('Yeshwanthpur / Rajajinagar',                 'North-West / Established',  'midscale_economy',  3800,  6000, 60::NUMERIC,    2940, 'Midscale / economy.'),
    ('Electronic City / Hosur Rd',                 'South / Hosur-E-City belt', 'upper_upscale',     6500,  9000, 64::NUMERIC,    4960, 'Crowne Plaza E-City — upper-upscale anchor; no 5★ inventory in this corridor.'),
    ('Electronic City / Hosur Rd',                 'South / Hosur-E-City belt', 'upscale_upper_mid', 5000,  7500, 62::NUMERIC,    3875, 'Upscale / upper-mid 3★.'),
    ('Electronic City / Hosur Rd',                 'South / Hosur-E-City belt', 'midscale_economy',  3000,  5500, 60::NUMERIC,    2550, 'Midscale / economy: Ginger / Treebo near E-City offices.'),
    ('Mysore Rd / Tumkur Rd',                      'West / Peripheral',         'upper_upscale',     5500,  8000, 60::NUMERIC,    4050, 'Upper-upscale: limited branded inventory in west peripheral.'),
    ('Mysore Rd / Tumkur Rd',                      'West / Peripheral',         'upscale_upper_mid', 4000,  6500, 58::NUMERIC,    3045, 'Upscale / upper-mid 3★.'),
    ('Mysore Rd / Tumkur Rd',                      'West / Peripheral',         'midscale_economy',  2500,  4500, 55::NUMERIC,    1925, 'Midscale / economy: dominant tier in west peripheral.')
  ) AS s(submarket, cluster, segment, adr_low, adr_high, occ, revpar, notes)
  WHERE NOT EXISTS (
    SELECT 1 FROM hospitality_market_benchmarks h
    WHERE h.organization_id = v_org AND h.city = 'Bengaluru'
      AND h.submarket = s.submarket AND h.segment = s.segment
      AND h.as_of_date = v_as_of
  );

  -- 2b. Retail mall Grade A rents (12 rows)
  INSERT INTO retail_market_benchmarks (organization_id, city, corridor, cluster, format, rent_low_psf_month, rent_high_psf_month, rent_avg_psf_month, source, source_url, as_of_date, is_verified, notes)
  SELECT v_org, 'Bengaluru', r.corridor, r.cluster, 'mall_grade_a', r.rent_low, r.rent_high, r.rent_avg, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, v_as_of, TRUE, r.notes
  FROM (VALUES
    ('Whitefield (Phoenix Marketcity)',                    'East / Peripheral East',     250::NUMERIC, 500::NUMERIC, 375::NUMERIC, 'Phoenix Marketcity Whitefield (1 MSF) leads inventory; Nexus Whitefield / Forum Falcon City alternates.'),
    ('Marathahalli / Bellandur ORR (Phoenix MC + Soul Space)','ORR / Tech belt',          150::NUMERIC, 350::NUMERIC, 250::NUMERIC, 'Soul Space Spirit / Phoenix Marketcity — ORR retail catchment.'),
    ('Hebbal / Thanisandra (Phoenix Mall of Asia)',        'North / Manyata corridor',   250::NUMERIC, 600::NUMERIC, 425::NUMERIC, 'Phoenix Mall of Asia is the city''s highest-rent mall (₹400–600 prime line shops). Elements Mall alternate.'),
    ('Rajajinagar (Orion Mall)',                           'North-West / Established',   200::NUMERIC, 300::NUMERIC, 250::NUMERIC, 'Orion Mall 90–95% occupancy, ~1.5M monthly footfall (Occupi 2025).'),
    ('Malleshwaram (Mantri Square)',                       'North-West / Established',   200::NUMERIC, 400::NUMERIC, 300::NUMERIC, 'Mantri Square — established Grade A.'),
    ('Jayanagar / 4th Block (Vega City)',                  'South / Inner premium',      150::NUMERIC, 300::NUMERIC, 225::NUMERIC, 'Vega City / Prime Spectrum.'),
    ('JP Nagar Mall corridor',                             'South / Inner-mid',          120::NUMERIC, 250::NUMERIC, 185::NUMERIC, 'Mid-tier mall corridor.'),
    ('BTM / Bannerghatta Rd (Royal Meenakshi / Gopalan)',  'South / Bannerghatta',       150::NUMERIC, 280::NUMERIC, 215::NUMERIC, 'Royal Meenakshi / Gopalan Mall.'),
    ('Domlur / Old Airport Rd / CV Raman',                 'East premium',               250::NUMERIC, 450::NUMERIC, 350::NUMERIC, 'Phoenix Marketcity Whitefield catchment overlap.'),
    ('Yeshwanthpur Mall corridor',                         'North-West',                 150::NUMERIC, 280::NUMERIC, 215::NUMERIC, 'Mid-tier mall corridor.'),
    ('Yelahanka / Devanahalli (RMZ Galleria)',             'North / Airport corridor',   100::NUMERIC, 180::NUMERIC, 140::NUMERIC, 'RMZ Galleria; future Bhartiya Mall pipeline. Growing as airport corridor matures.'),
    ('Electronic City (M5 Ecity Mall)',                    'South / Hosur-E-City',       120::NUMERIC, 220::NUMERIC, 170::NUMERIC, 'M5 Ecity Mall — captive office catchment.')
  ) AS r(corridor, cluster, rent_low, rent_high, rent_avg, notes)
  WHERE NOT EXISTS (
    SELECT 1 FROM retail_market_benchmarks rb
    WHERE rb.organization_id = v_org AND rb.city = 'Bengaluru'
      AND rb.corridor = r.corridor AND rb.format = 'mall_grade_a'
      AND rb.as_of_date = v_as_of
  );

  -- 2c. Office detailed submarkets (30 rows; level_type='detailed_submarket'
  --     keeps these distinct from baseline 'submarket'/'ipc_zone' rows)
  INSERT INTO office_market_benchmarks (organization_id, city, submarket, cluster, level_type, vacancy_pct, stock_weighted_rent_psf_month, source, source_url, as_of_date, is_verified, notes)
  SELECT v_org, 'Bengaluru', o.submarket, o.cluster, 'detailed_submarket', NULL, o.rent, 'GBA Rate Card Q4 2025 / Q1 2026', NULL, v_as_of, TRUE, o.notes
  FROM (VALUES
    ('Whitefield (ITPL/EPIP/Brookefield/Hoodi)', 'East / Whitefield',           102.5::NUMERIC, 'Grade A bare shell ₹65–140 (avg ₹95). Grade B ₹50–80. Vacancy improved sharply post-Purple Line; ~12–14% YoY rent growth (C&W/KF).'),
    ('Koramangala',                              'South / Inner premium',       125::NUMERIC,   'Grade A ₹90–160. Grade B ₹65–100. Limited new supply; SBD-1 corridor; co-working dense (₹10–15K/seat).'),
    ('HSR Layout',                               'South-East / ORR-Sarjapur',    87.5::NUMERIC, 'Grade A ₹65–110. Grade B ₹50–80. High demand from start-ups/GCCs; constrained Grade A stock.'),
    ('Sarjapur Road (PBD)',                      'South-East / Sarjapur',        75::NUMERIC,   'Grade A ₹55–95. Grade B ₹45–70. Strong leasing momentum; new RGA/RMZ supply.'),
    ('ORR-East (Marathahalli / KR Puram / Mahadevapura)', 'East / ORR',         112.5::NUMERIC, 'Grade A ₹85–140 (avg ₹110). Grade B ₹65–95. Q4-25 ORR-SE absorbed ~55% of city''s 3.5 MSF Q4 supply; vacancy fell ~70 bps QoQ (JLL).'),
    ('ORR-South (Bellandur / Sarjapur Junction)','South-East / ORR',            122.5::NUMERIC, 'Grade A ₹95–150 (avg ₹120). Grade B ₹70–105. Embassy Tech Village, Pritech, RMZ Ecoworld; lowest vacancy in city.'),
    ('Indiranagar',                              'East premium / Inner',        140::NUMERIC,   'Grade A ₹100–180. Grade B ₹70–120. Supply constrained; F&B & boutique-office mix.'),
    ('MG Road / CBD (Brigade / Vittal Mallya / Lavelle)', 'CBD',                160::NUMERIC,   'Grade A ₹140–180 (Statista CBD avg ₹146.6 in Q1-24, +6–7% YoY → ₹160–170 typical). Grade B ₹95–135. Most expensive market; minimal new supply.'),
    ('Hebbal',                                   'North / Manyata corridor',    107.5::NUMERIC, 'Grade A ₹85–130. Grade B ₹60–95. Manyata Tech Park anchors; strong YoY growth.'),
    ('Yelahanka',                                'North / Yelahanka belt',       60::NUMERIC,   'Grade A ₹45–75. Grade B ₹35–60. Limited Grade A; office demand spillover from Hebbal.'),
    ('Devanahalli (airport corridor)',           'North / Airport corridor',     72.5::NUMERIC, 'Grade A ₹55–90 (KIADB Aerospace SEZ tenant rates). Grade B ₹40–65. Emerging hub; data centers, aerospace, business parks driving 7 MSF future demand.'),
    ('Electronic City (Phase 1 & 2)',            'South / Hosur-E-City',         55::NUMERIC,   'Grade A ₹35–75 (avg ₹50). Grade B ₹28–55. One of cheapest Grade A markets; Yellow Line metro operational Aug 2025.'),
    ('Bannerghatta Road',                        'South / IIM-Arekere belt',     75::NUMERIC,   'Grade A ₹55–95. Grade B ₹40–70. IBC Knowledge Park, Jayadeva interchange; metro Pink Line in pipeline.'),
    ('JP Nagar',                                 'South / Inner-mid',            70::NUMERIC,   'Grade A ₹50–90. Grade B ₹40–65. Limited large-floorplate stock; strong professional-services demand.'),
    ('Jayanagar',                                'South / Inner premium',        75::NUMERIC,   'Grade A ₹55–95. Grade B ₹40–70. Similar profile to JP Nagar; high-street retail-driven.'),
    ('BTM Layout',                               'South / BTM-Bannerghatta',     67.5::NUMERIC, 'Grade A ₹50–85. Grade B ₹35–65. Yellow Line metro live; cost-conscious tenants.'),
    ('Marathahalli',                             'East / ORR-Whitefield',        95::NUMERIC,   'Grade A ₹70–120. Grade B ₹50–85. Part of ORR-East corridor; strong IT-services tenant base.'),
    ('Bellandur',                                'South-East / ORR-Sarjapur',   122.5::NUMERIC, 'Grade A ₹95–150. Grade B ₹70–105. RMZ Ecoworld, Smartworks GTP; among Bengaluru''s highest-rented submarkets.'),
    ('Domlur',                                   'East / SBD-1',                130::NUMERIC,   'Grade A ₹100–160. Grade B ₹70–110. Established SBD-1; RMZ Infinity, Embassy Manyata-style stock.'),
    ('Old Airport Road (HAL / Kodihalli)',       'East / SBD-1',                122.5::NUMERIC, 'Grade A ₹95–150. Grade B ₹70–110. DivyaSree 77 Town Center area; SBD-1.'),
    ('Yeshwanthpur',                             'North-West',                   87.5::NUMERIC, 'Grade A ₹65–110. Grade B ₹50–80. Strong NH-75 connect; Aparna Elina-grade Grade A.'),
    ('Rajajinagar',                              'North-West / Established',     90::NUMERIC,   'Grade A ₹70–110. Grade B ₹50–80. Brigade Gateway anchor; mixed-use.'),
    ('Malleshwaram',                             'North-West / CBD-adjacent',   100::NUMERIC,   'Grade A ₹80–120. Grade B ₹55–90. CBD-adjacent; constrained supply.'),
    ('Kanakapura Road',                          'South / Metro Green Line',     57.5::NUMERIC, 'Grade A ₹40–75. Grade B ₹30–55. Mid-segment; metro Green Line.'),
    ('Mysore Road',                              'West / Peripheral',            50::NUMERIC,   'Grade A ₹35–65. Grade B ₹25–50. Cheapest in city; emerging IT corridor (Global Tech Park).'),
    ('Tumkur Road / Peenya',                     'North-West / industrial',      57.5::NUMERIC, 'Grade A ₹40–75 (industrial-leaning). Grade B ₹30–55. Industrial-office mix; Peenya metro live.'),
    ('Hosur Road (Bommanahalli / Hongasandra)',  'South / Hosur belt',           72.5::NUMERIC, 'Grade A ₹55–90. Grade B ₹40–65. AKR/AMR Tech Park; Yellow Line corridor.'),
    ('KR Puram',                                 'East / Whitefield-adjacent',   82.5::NUMERIC, 'Grade A ₹65–100. Grade B ₹50–80. Adjacent to Whitefield; metro interchange under construction.'),
    ('Banaswadi',                                'North-East / Inner',           62.5::NUMERIC, 'Grade A ₹45–80. Grade B ₹35–60. Limited Grade A; standalone-office heavy.'),
    ('Thanisandra / Kannur',                     'North / Manyata-adjacent',     72.5::NUMERIC, 'Grade A ₹55–90. Grade B ₹40–65. Bhartiya City, Manyata-adjacent; growing Grade A pipeline.')
  ) AS o(submarket, cluster, rent, notes)
  WHERE NOT EXISTS (
    SELECT 1 FROM office_market_benchmarks ob
    WHERE ob.organization_id = v_org AND ob.city = 'Bengaluru'
      AND ob.submarket = o.submarket AND ob.level_type = 'detailed_submarket'
      AND ob.as_of_date = v_as_of
  );

END $$;

COMMIT;

-- =============================================================================
-- Sanity-check queries (run after applying):
--
--   SELECT COUNT(*) FROM comps WHERE city != 'Bengaluru';
--     → expect 0 (was 5 before this migration)
--
--   SELECT COUNT(*) FROM hospitality_market_benchmarks WHERE as_of_date = '2026-05-04';
--     → expect 38
--
--   SELECT COUNT(*) FROM office_market_benchmarks WHERE level_type = 'detailed_submarket';
--     → expect 30
--
--   SELECT COUNT(*) FROM retail_market_benchmarks WHERE format = 'mall_grade_a' AND as_of_date = '2026-05-04';
--     → expect 12
-- =============================================================================
