-- 20260507_named_premium_comps_q1_2026.sql
-- =============================================================================
-- Named premium-project comps from the Bengaluru/GBA Q1 2026 comps report
-- (Bengaluru_GBA_Micro_Market_Asset_Class_Comps_06May2026.docx, Table 5).
-- =============================================================================
--
-- The existing `comps` seed (April 2026) holds 21 hand-curated residential
-- comps. Table 5 of the Q1 2026 report adds ~30 NAMED premium projects
-- (Prestige Shantiniketan, Sobha Opal, Adarsh Palm Retreat, etc.) that were
-- referenced in the locality "Premium / new-launch range" column but never
-- loaded as comp rows.
--
-- These rows complement (do NOT replace) the April 2026 seed:
--   - Existing seed:  data_type='internal_benchmark_apr_2026'
--   - This addition:  data_type='ipc_q1_2026_v0_2_premium_project'
--
-- ON CONFLICT clauses on (project_name, city) skip rows that already exist
-- (idempotent re-run, e.g. if the same project is also in the April seed).
--
-- lat/lng are NULL — the source report doesn't include precise coordinates.
-- The map view skips rows without coords (empty-state pill in the legend
-- reports the count); the table view shows them in full.

BEGIN;

-- Add a unique index on (project_name, city) so the ON CONFLICT clause below
-- has a constraint to match. The schema previously had only a primary-key
-- index on `id` plus regular B-tree indexes on `project_name` and `city`
-- separately — neither of which enforces uniqueness, so PostgreSQL rejects
-- ON CONFLICT (project_name, city) with `42P10: there is no unique or
-- exclusion constraint matching the ON CONFLICT specification`.
--
-- IF NOT EXISTS makes this safe to re-run after the index already exists
-- (the user partially applied an earlier version of this migration).
-- Verified zero existing duplicates: SELECT project_name, city, COUNT(*)
-- FROM comps GROUP BY 1,2 HAVING COUNT(*)>1  →  empty result on 2026-05-07.
CREATE UNIQUE INDEX IF NOT EXISTS comps_project_name_city_unique
  ON public.comps (project_name, city);

INSERT INTO comps (
  organization_id, project_name, developer, city, locality,
  project_type, rate_per_sqft, rate_per_sqft_min, rate_per_sqft_max,
  yoy_change_pct, sro_rate_per_sqft, source, source_url, data_type,
  as_of_date, is_verified, amenities
) VALUES
  -- Whitefield
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Prestige Park View', 'Prestige', 'Bengaluru', 'Whitefield',
   'residential', 15400, 13000, 17800, 29.1, 11551,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', 'https://www.99acres.com/property-rates-and-price-trends-prffid',
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Prestige Shantiniketan', 'Prestige', 'Bengaluru', 'Whitefield',
   'residential', 17800, 16000, 19500, 29.1, 11551,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),

  -- ORR-East / Marathahalli / Mahadevapura
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Sobha Palladian', 'Sobha', 'Bengaluru', 'Marathahalli',
   'residential', 17650, 16000, 19300, 69.5, 7867,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'DivyaSree 77 Town Center', 'DivyaSree', 'Bengaluru', 'Marathahalli',
   'residential', 17650, 16000, 19300, 69.5, 7867,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),

  -- ORR-South / Bellandur
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Adarsh Palm Retreat', 'Adarsh', 'Bengaluru', 'Bellandur',
   'residential', 16875, 14600, 19150, 36.4, 7410,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),

  -- Hebbal
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Hiranandani Glen Gate', 'Hiranandani', 'Bengaluru', 'Hebbal',
   'residential', 15400, 14650, 16150, 36.9, 12950,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Karle Zenith', 'Karle Group', 'Bengaluru', 'Hebbal',
   'residential', 15400, 14650, 16150, 36.9, 12950,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),

  -- Yelahanka
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Brigade Insignia', 'Brigade', 'Bengaluru', 'Yelahanka',
   'residential', 14300, 12500, 16100, 20.1, 8480,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),

  -- Devanahalli (airport corridor)
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Embassy Verde', 'Embassy', 'Bengaluru', 'Devanahalli',
   'residential', 14500, 12000, 17000, 25, 8200,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Birla Trimaya', 'Birla Estates', 'Bengaluru', 'Devanahalli',
   'residential', 14500, 12000, 17000, 25, 8200,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Godrej MSR City', 'Godrej Properties', 'Bengaluru', 'Devanahalli',
   'residential', 14500, 12000, 17000, 25, 8200,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Sattva Aeropolis', 'Sattva', 'Bengaluru', 'Devanahalli',
   'residential', 13000, 11500, 15000, 29.7, 8200,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),

  -- Bannerghatta Road
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Prestige Elysian', 'Prestige', 'Bengaluru', 'Bannerghatta Road',
   'residential', 18100, 17000, 19200, 47.3, 6348,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Sattva Aqua Vista', 'Sattva', 'Bengaluru', 'Bannerghatta Road',
   'residential', 15050, 12000, 18100, 47.3, 6348,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Keya Spring', 'Keya Homes', 'Bengaluru', 'Bannerghatta Road',
   'residential', 15050, 12000, 18100, 47.3, 6348,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),

  -- Jayanagar
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Sobha Opal', 'Sobha', 'Bengaluru', 'Jayanagar',
   'residential', 18800, 17000, 20000, 13.7, 11961,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),

  -- BTM Layout
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Raj Bay Vista', 'Raj', 'Bengaluru', 'BTM Layout',
   'residential', 12900, 12000, 13800, -11.3, NULL,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),

  -- Yeshwanthpur
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Aparna Elina', 'Aparna', 'Bengaluru', 'Yeshwanthpur',
   'residential', 15975, 15350, 16600, -10.4, NULL,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Presidential Tower', NULL, 'Bengaluru', 'Yeshwanthpur',
   'residential', 15975, 15350, 16600, -10.4, NULL,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),

  -- Rajajinagar
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'DNR Highline', 'DNR', 'Bengaluru', 'Rajajinagar',
   'residential', 23000, 18000, 28000, 11.8, NULL,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Purva Bluebelle', 'Puravankara Limited', 'Bengaluru', 'Rajajinagar',
   'residential', 23000, 18000, 28000, 11.8, NULL,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Brigade Gateway', 'Brigade', 'Bengaluru', 'Rajajinagar',
   'residential', 23000, 18000, 28000, 11.8, NULL,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Phoenix Kessaku', 'Phoenix Mills', 'Bengaluru', 'Rajajinagar',
   'residential', 28000, 25000, 32000, 11.8, NULL,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),

  -- Kanakapura Road
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Mantri Serenity', 'Mantri', 'Bengaluru', 'Kanakapura Road',
   'residential', 11500, 10000, 13000, 32.0, 7178,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Prestige Falcon City', 'Prestige', 'Bengaluru', 'Kanakapura Road',
   'residential', 11500, 10000, 13000, 32.0, 7178,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),

  -- Mysore Road
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Brigade Horizon', 'Brigade', 'Bengaluru', 'Mysore Road',
   'residential', 9750, 8500, 11000, 17.0, NULL,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Provident Sunworth', 'Provident (Puravankara)', 'Bengaluru', 'Mysore Road',
   'residential', 9750, 8500, 11000, 17.0, NULL,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),

  -- KR Puram
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Sobha Lake Gardens', 'Sobha', 'Bengaluru', 'KR Puram',
   'residential', 12300, 11600, 13000, 30.8, 7666,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),

  -- Thanisandra
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'Sobha City', 'Sobha', 'Bengaluru', 'Thanisandra',
   'residential', 12600, 11850, 13350, 9.3, 8424,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL),
  ('d1218877-4d3a-4fe4-8d63-914fa8ffa94b', 'G Corp The Icon', 'G Corp', 'Bengaluru', 'Thanisandra',
   'residential', 12600, 11850, 13350, 9.3, 8424,
   'Bengaluru/GBA Q1 2026 Comps Report - Table 5', NULL,
   'ipc_q1_2026_v0_2_premium_project', '2026-05-04', TRUE, NULL)
ON CONFLICT (project_name, city) DO NOTHING;

COMMIT;
