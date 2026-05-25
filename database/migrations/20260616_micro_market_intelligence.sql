-- 20260616_micro_market_intelligence.sql
--
-- Phase 1 / Pillar 1 — Micro-Market Intelligence Layer foundation.
--
-- Establishes the Bengaluru micro-market reference set + the per-(locality,
-- asset_class, metric) benchmark store + the per-(locality, asset_class,
-- signal) demand-driver store. This is the data layer every downstream pillar
-- consumes:
--   • Best Use Simulator (Pillar 2) — fit scores per asset class per locality
--   • Deal-Structure Recommender (Pillar 3) — capital-stack defaults
--   • RERA Readiness Pack (Pillar 4) — locality-specific approval matrix
--   • Live K-RERA Tracker (Pillar 6) — locality classification of new projects
--
-- The reference is BENGALURU-FIRST. 20 micro-markets are seeded — the
-- consensus mapping from the IPC research scan + REDIP's existing comps
-- coverage. Each carries a centroid lat/lng + radius (km) so parcel
-- classification is a simple Haversine ≤ radius_km check. Full polygons
-- can be backfilled later via PostGIS without breaking the API contract.
--
-- Three tables — all RLS-on, all reference (no organization_id). Read for
-- every authenticated user; write restricted to owners/admins through the
-- existing role-aware service layer (RLS posture mirrors
-- regulatory_data.bbmp_uav_entries and regulatory_data.bbmp_street_index).
--
-- Idempotent via DELETE-then-INSERT (no UNIQUE keys we can upsert on with
-- the rich metadata shape we want).
--
-- Operator action required: apply this migration via Supabase SQL editor.
--   🌐 https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new
--   📋 paste this file → Run → expect "Success. No rows returned."

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
--  Table 1 — bengaluru_micro_markets
--    20 Bengaluru micro-markets, each with a centroid + classification
--    radius + parent zone (Revised Master Plan 2031 zoning) + tier
--    (1 = ultra-premium, 2 = premium, 3 = mid, 4 = affordable, 5 = emerging).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS regulatory_data.bengaluru_micro_markets (
  locality_code     TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  tier              SMALLINT NOT NULL CHECK (tier BETWEEN 1 AND 5),
  parent_zone       TEXT,                     -- RMP 2031 zone (A, B, C, ...) when known
  centroid_lat      NUMERIC(9, 6) NOT NULL,
  centroid_lng      NUMERIC(9, 6) NOT NULL,
  radius_km         NUMERIC(4, 2) NOT NULL DEFAULT 2.5,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bengaluru_micro_markets_centroid
  ON regulatory_data.bengaluru_micro_markets (centroid_lat, centroid_lng);

ALTER TABLE regulatory_data.bengaluru_micro_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.bengaluru_micro_markets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bengaluru_micro_markets_read ON regulatory_data.bengaluru_micro_markets;
CREATE POLICY bengaluru_micro_markets_read
  ON regulatory_data.bengaluru_micro_markets
  FOR SELECT
  USING (TRUE);  -- reference data — every authenticated user reads

DROP POLICY IF EXISTS bengaluru_micro_markets_no_write ON regulatory_data.bengaluru_micro_markets;
CREATE POLICY bengaluru_micro_markets_no_write
  ON regulatory_data.bengaluru_micro_markets
  FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);
  -- Writes go through the service layer using the service role; the API
  -- gates writes by user role (owner/admin). No direct user-token mutations.

-- ─────────────────────────────────────────────────────────────────────────
--  Table 2 — micro_market_benchmarks
--    Per (locality_code, asset_class, metric_kind) — the percentile bands
--    + the source + the last-verified timestamp. Confidence is explicit;
--    callers MUST surface "low" as such, never silently dressed up.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS regulatory_data.micro_market_benchmarks (
  id                       BIGSERIAL PRIMARY KEY,
  locality_code            TEXT NOT NULL
                              REFERENCES regulatory_data.bengaluru_micro_markets(locality_code)
                              ON DELETE CASCADE,
  asset_class              TEXT NOT NULL,
  metric_kind              TEXT NOT NULL CHECK (metric_kind IN (
                              'sale_rate_per_sqft_inr',
                              'rent_per_sqft_month_inr',
                              'cap_rate_pct',
                              'absorption_units_per_quarter',
                              'vacancy_pct',
                              'gross_rental_yield_pct',
                              'guidance_value_per_sqft_inr',
                              'plot_rate_per_sqft_inr',
                              'office_rent_per_sqft_month_inr',
                              'retail_rent_per_sqft_month_inr'
                            )),
  p25                      NUMERIC(14, 4),
  p50                      NUMERIC(14, 4),
  p75                      NUMERIC(14, 4),
  p95                      NUMERIC(14, 4),
  n_observations           INTEGER,
  confidence               TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  source_ref               TEXT,                  -- e.g. "Knight Frank India Q1 2026", or URL
  source_publication_date  DATE,
  last_verified_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (locality_code, asset_class, metric_kind)
);

CREATE INDEX IF NOT EXISTS micro_market_benchmarks_lookup
  ON regulatory_data.micro_market_benchmarks (locality_code, asset_class);

ALTER TABLE regulatory_data.micro_market_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.micro_market_benchmarks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS micro_market_benchmarks_read ON regulatory_data.micro_market_benchmarks;
CREATE POLICY micro_market_benchmarks_read
  ON regulatory_data.micro_market_benchmarks
  FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS micro_market_benchmarks_no_write ON regulatory_data.micro_market_benchmarks;
CREATE POLICY micro_market_benchmarks_no_write
  ON regulatory_data.micro_market_benchmarks
  FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

-- ─────────────────────────────────────────────────────────────────────────
--  Table 3 — micro_market_demand_signals
--    Per (locality_code, asset_class, signal_kind) — qualitative + quantitative
--    demand drivers (transit proximity, employment growth, supply pressure,
--    new-launch density, infra triggers).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS regulatory_data.micro_market_demand_signals (
  id                       BIGSERIAL PRIMARY KEY,
  locality_code            TEXT NOT NULL
                              REFERENCES regulatory_data.bengaluru_micro_markets(locality_code)
                              ON DELETE CASCADE,
  asset_class              TEXT,                  -- nullable: some signals (transit) apply to the locality regardless of asset class
  signal_kind              TEXT NOT NULL CHECK (signal_kind IN (
                              'transit_proximity',        -- metro/suburban-rail nearest-station distance
                              'employment_growth_index',  -- IT/BT hub adjacency strength
                              'new_launch_count_qtr',     -- RERA-registered new projects last quarter
                              'delivered_count_yr',       -- completed projects last 12 months
                              'avg_delivery_delay_months',-- promoter execution risk in locality
                              'infra_trigger',            -- PRR/STRR/Metro phase events ETA
                              'absorption_pressure',      -- supply / absorption ratio
                              'price_yoy_pct',            -- 12m price change
                              'demand_buyer_segment'      -- IT, NRI, end-user, investor mix
                            )),
  value_numeric            NUMERIC(14, 4),
  value_text               TEXT,
  unit                     TEXT,                  -- 'km', '%', 'count', 'months', etc.
  period_start             DATE,
  period_end               DATE,
  confidence               TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
  source_ref               TEXT,
  last_verified_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS micro_market_demand_signals_lookup
  ON regulatory_data.micro_market_demand_signals (locality_code, asset_class, signal_kind);

ALTER TABLE regulatory_data.micro_market_demand_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.micro_market_demand_signals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS micro_market_demand_signals_read ON regulatory_data.micro_market_demand_signals;
CREATE POLICY micro_market_demand_signals_read
  ON regulatory_data.micro_market_demand_signals
  FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS micro_market_demand_signals_no_write ON regulatory_data.micro_market_demand_signals;
CREATE POLICY micro_market_demand_signals_no_write
  ON regulatory_data.micro_market_demand_signals
  FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

-- ─────────────────────────────────────────────────────────────────────────
--  SEED 1 — the 20 Bengaluru micro-markets
--  Centroid lat/lng are approximate (sourced from BBMP ward maps + Google
--  Maps centroid heuristic). Radius is the operator-tuned classification
--  bubble; tighten/loosen as parcel-classification accuracy is observed.
-- ─────────────────────────────────────────────────────────────────────────

DELETE FROM regulatory_data.bengaluru_micro_markets WHERE locality_code IN (
  'whitefield-east-orr', 'sarjapur-orr', 'electronic-city-p1', 'electronic-city-p2',
  'hebbal', 'devanahalli', 'yelahanka', 'jakkur', 'bannerghatta-rd', 'kanakapura-rd',
  'mysore-rd', 'mahadevapura', 'kr-puram', 'old-madras-rd', 'tumkur-rd', 'hosur-rd',
  'hsr-layout', 'koramangala', 'indiranagar', 'mg-road-cbd'
);

INSERT INTO regulatory_data.bengaluru_micro_markets
  (locality_code, name, tier, parent_zone, centroid_lat, centroid_lng, radius_km, notes)
VALUES
  ('whitefield-east-orr',   'Whitefield (East ORR)',           2, 'B',  12.969800, 77.750000, 3.5, 'Mature IT corridor; GCC-anchored office demand; mid-premium residential ₹7.5K-11K/sqft; rental yields 4.4-5.0%'),
  ('sarjapur-orr',          'Sarjapur — Outer Ring Road',      2, 'B',  12.899300, 77.686800, 3.0, 'Office + mid-premium residential; ₹7.2K-10.5K/sqft; rental yields 4-4.8%'),
  ('electronic-city-p1',    'Electronic City Phase 1',         3, 'C',  12.845600, 77.660300, 2.5, 'Office + affordable residential; highest residential rental yields in Bengaluru at 6-8.5%'),
  ('electronic-city-p2',    'Electronic City Phase 2',         3, 'C',  12.840000, 77.670000, 2.5, 'Office + affordable residential; spillover from Phase 1'),
  ('hebbal',                'Hebbal (North ORR)',              2, 'A',  13.035800, 77.597000, 3.0, 'Premium residential + office; ₹9K-13K/sqft; Airport Metro live'),
  ('devanahalli',           'Devanahalli (Airport corridor)',  5, 'D',  13.246100, 77.712800, 5.0, 'Plotted + airport hospitality + emerging residential; ₹9.5K/sqft avg, +20% YoY'),
  ('yelahanka',             'Yelahanka',                       3, 'A',  13.100700, 77.596300, 3.0, 'Mid-premium residential; ₹7K-11.9K/sqft; +25% in 2025'),
  ('jakkur',                'Jakkur',                          3, 'A',  13.074200, 77.607900, 2.0, 'Mid-premium residential; spillover from Yelahanka + Hebbal'),
  ('bannerghatta-rd',       'Bannerghatta Road',               3, 'C',  12.893900, 77.597000, 3.0, 'Mid residential + retail; steady, less speculative'),
  ('kanakapura-rd',         'Kanakapura Road',                 4, 'C',  12.845600, 77.547400, 3.5, 'Affordable-to-mid residential; Pink Line metro catalyst'),
  ('mysore-rd',             'Mysore Road',                     4, 'C',  12.949900, 77.497000, 3.5, 'Affordable residential + industrial spillover; Purple Line live'),
  ('mahadevapura',          'Mahadevapura',                    2, 'B',  12.989700, 77.683700, 2.5, 'Office + mid residential; ORR cluster, GCC anchored'),
  ('kr-puram',              'KR Puram',                        3, 'B',  13.006700, 77.698100, 2.5, 'Mid residential, Metro interchange catalyst'),
  ('old-madras-rd',         'Old Madras Road',                 3, 'B',  13.014600, 77.684000, 2.5, 'Mid residential; KR Puram spillover'),
  ('tumkur-rd',             'Tumkur Road',                     4, 'A',  13.029400, 77.515200, 4.0, 'Warehousing + affordable residential; NICE corridor, Peenya'),
  ('hosur-rd',              'Hosur Road',                      3, 'C',  12.880000, 77.644600, 3.5, 'Industrial-warehouse + Electronic City spillover'),
  ('hsr-layout',            'HSR Layout',                      1, 'B',  12.911600, 77.647300, 2.0, 'Premium residential, low yield 3-3.5%; ₹17.6K/sqft'),
  ('koramangala',           'Koramangala',                     1, 'B',  12.935200, 77.624500, 1.5, 'Ultra-premium residential; ₹17.9K-35K/sqft; yields 2.5-3%'),
  ('indiranagar',           'Indiranagar',                     1, 'B',  12.978400, 77.640800, 2.0, 'Ultra-premium residential + retail; ₹18K-30K/sqft'),
  ('mg-road-cbd',           'MG Road CBD',                     1, 'A',  12.975000, 77.604300, 1.5, 'Ultra-premium retail + office CBD');

-- ─────────────────────────────────────────────────────────────────────────
--  SEED 2 — initial benchmarks (medium confidence; IPC Q1 2026 + REDIP comps)
--  Per micro-market, the dominant asset class(es) get the sale_rate band.
--  Office + retail micro-markets carry office rent + cap rate. Yield where
--  reported. n_observations is 0 because these are IPC-aggregated, not
--  REDIP-comp-derived — to be replaced once REDIP comps reach n>=10 per cell.
-- ─────────────────────────────────────────────────────────────────────────

DELETE FROM regulatory_data.micro_market_benchmarks
WHERE locality_code IN (SELECT locality_code FROM regulatory_data.bengaluru_micro_markets);

INSERT INTO regulatory_data.micro_market_benchmarks
  (locality_code, asset_class, metric_kind, p25, p50, p75, p95, n_observations, confidence, source_ref, source_publication_date, notes)
VALUES
  -- Whitefield
  ('whitefield-east-orr', 'residential_apartments', 'sale_rate_per_sqft_inr',     7500, 9200,  10500, 11000, 0, 'medium', 'Knight Frank India Q1 2026 + ANAROCK Q1 2026', '2026-04-01', 'GCC-anchored demand band'),
  ('whitefield-east-orr', 'residential_apartments', 'gross_rental_yield_pct',     4.4,  4.7,   5.0,   5.2,   0, 'medium', 'Knight Frank India Q1 2026',                    '2026-04-01', NULL),
  ('whitefield-east-orr', 'commercial_office',      'office_rent_per_sqft_month_inr', 85, 95,    105,   115,   0, 'medium', 'Cushman & Wakefield Q1 2026 Bengaluru',         '2026-04-01', NULL),
  ('whitefield-east-orr', 'commercial_office',      'vacancy_pct',                3.5,  5.0,   7.0,   9.0,   0, 'medium', 'JLL Bengaluru Office Dynamics Q1 2026',         '2026-04-01', 'Sub-8% vacancy band'),
  -- Sarjapur-ORR
  ('sarjapur-orr', 'residential_apartments', 'sale_rate_per_sqft_inr', 7200, 8800, 10000, 10500, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', NULL),
  ('sarjapur-orr', 'residential_apartments', 'gross_rental_yield_pct', 4.0, 4.4, 4.8, 5.0, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', NULL),
  ('sarjapur-orr', 'commercial_office', 'office_rent_per_sqft_month_inr', 80, 92, 100, 110, 0, 'medium', 'Cushman & Wakefield Q1 2026 Bengaluru', '2026-04-01', NULL),
  -- Electronic City Phase 1
  ('electronic-city-p1', 'residential_apartments', 'sale_rate_per_sqft_inr', 5000, 5800, 6500, 7200, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', 'Affordable residential band'),
  ('electronic-city-p1', 'residential_apartments', 'gross_rental_yield_pct', 6.0, 7.2, 8.0, 8.5, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', 'Highest residential yields in Bengaluru'),
  ('electronic-city-p1', 'commercial_office', 'office_rent_per_sqft_month_inr', 55, 65, 72, 80, 0, 'medium', 'Cushman & Wakefield Q1 2026 Bengaluru', '2026-04-01', NULL),
  -- Electronic City Phase 2
  ('electronic-city-p2', 'residential_apartments', 'sale_rate_per_sqft_inr', 4800, 5500, 6200, 6800, 0, 'low', 'inferred from EC P1 spillover', '2026-04-01', 'Lower confidence; needs separate IPC tracking'),
  -- Hebbal
  ('hebbal', 'residential_apartments', 'sale_rate_per_sqft_inr', 9000, 10500, 12000, 13000, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', 'Premium band; Airport Metro live'),
  ('hebbal', 'residential_apartments', 'gross_rental_yield_pct', 3.8, 4.2, 4.6, 4.9, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', NULL),
  ('hebbal', 'commercial_office', 'office_rent_per_sqft_month_inr', 90, 100, 115, 130, 0, 'medium', 'JLL Bengaluru Office Dynamics Q1 2026', '2026-04-01', NULL),
  -- Devanahalli
  ('devanahalli', 'plotted_development', 'plot_rate_per_sqft_inr', 4500, 6000, 8000, 9500, 0, 'medium', 'ANAROCK Q1 2026 + REDIP comps', '2026-04-01', 'Airport corridor +20% YoY'),
  ('devanahalli', 'residential_apartments', 'sale_rate_per_sqft_inr', 6500, 8000, 9500, 11000, 0, 'low', 'limited IPC tracking', '2026-04-01', 'Emerging — confidence low'),
  ('devanahalli', 'hospitality', 'cap_rate_pct', 7.5, 8.2, 9.0, 9.5, 0, 'low', 'JLL Hotel Momentum India 2025', '2026-01-01', 'Airport-driven hotel market'),
  -- Yelahanka
  ('yelahanka', 'residential_apartments', 'sale_rate_per_sqft_inr', 7000, 9000, 11000, 11900, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', '+25% YoY 2025'),
  ('yelahanka', 'residential_apartments', 'gross_rental_yield_pct', 3.8, 4.3, 4.7, 5.0, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', NULL),
  -- Jakkur
  ('jakkur', 'residential_apartments', 'sale_rate_per_sqft_inr', 7500, 9500, 11000, 12000, 0, 'low', 'inferred from Yelahanka + Hebbal spillover', '2026-04-01', NULL),
  -- Bannerghatta Rd
  ('bannerghatta-rd', 'residential_apartments', 'sale_rate_per_sqft_inr', 6500, 8200, 9500, 10800, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', NULL),
  ('bannerghatta-rd', 'retail', 'retail_rent_per_sqft_month_inr', 80, 110, 140, 180, 0, 'low', 'Cushman Retail H2 2025', '2025-12-01', NULL),
  -- Kanakapura Rd
  ('kanakapura-rd', 'residential_apartments', 'sale_rate_per_sqft_inr', 5500, 6800, 8000, 9200, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', 'Pink Line metro catalyst'),
  -- Mysore Rd
  ('mysore-rd', 'residential_apartments', 'sale_rate_per_sqft_inr', 5200, 6500, 7800, 8800, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', 'Purple Line live'),
  ('mysore-rd', 'industrial_warehousing', 'rent_per_sqft_month_inr', 22, 26, 32, 38, 0, 'low', 'Knight Frank Warehousing H2 2025', '2025-12-01', 'Industrial spillover'),
  -- Mahadevapura
  ('mahadevapura', 'commercial_office', 'office_rent_per_sqft_month_inr', 85, 95, 110, 125, 0, 'medium', 'JLL Bengaluru Office Dynamics Q1 2026', '2026-04-01', 'ORR cluster, GCC-anchored'),
  ('mahadevapura', 'residential_apartments', 'sale_rate_per_sqft_inr', 7500, 9000, 10500, 11500, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', NULL),
  -- KR Puram
  ('kr-puram', 'residential_apartments', 'sale_rate_per_sqft_inr', 6500, 7800, 9000, 10000, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', 'Metro interchange catalyst'),
  -- Old Madras Rd
  ('old-madras-rd', 'residential_apartments', 'sale_rate_per_sqft_inr', 6000, 7200, 8500, 9500, 0, 'low', 'inferred from KR Puram spillover', '2026-04-01', NULL),
  -- Tumkur Rd
  ('tumkur-rd', 'industrial_warehousing', 'rent_per_sqft_month_inr', 25, 32, 38, 45, 0, 'medium', 'Knight Frank Warehousing H2 2025', '2025-12-01', 'NICE corridor, Peenya'),
  ('tumkur-rd', 'residential_apartments', 'sale_rate_per_sqft_inr', 4800, 6000, 7200, 8000, 0, 'low', 'limited IPC coverage', '2026-04-01', NULL),
  -- Hosur Rd
  ('hosur-rd', 'industrial_warehousing', 'rent_per_sqft_month_inr', 28, 34, 40, 48, 0, 'medium', 'Knight Frank Warehousing H2 2025', '2025-12-01', 'EC + industrial spillover'),
  -- HSR Layout
  ('hsr-layout', 'residential_apartments', 'sale_rate_per_sqft_inr', 14000, 17600, 21000, 24000, 0, 'medium', '99acres Q1 2026 + Knight Frank', '2026-04-01', 'Premium; low yield'),
  ('hsr-layout', 'residential_apartments', 'gross_rental_yield_pct', 3.0, 3.3, 3.5, 3.8, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', NULL),
  -- Koramangala
  ('koramangala', 'residential_apartments', 'sale_rate_per_sqft_inr', 17900, 23000, 30000, 35000, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', 'Ultra-premium; yields 2.5-3%'),
  ('koramangala', 'residential_apartments', 'gross_rental_yield_pct', 2.5, 2.8, 3.0, 3.2, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', NULL),
  ('koramangala', 'retail', 'retail_rent_per_sqft_month_inr', 250, 400, 600, 850, 0, 'low', 'Cushman Retail H2 2025', '2025-12-01', 'High-street retail premium'),
  -- Indiranagar
  ('indiranagar', 'residential_apartments', 'sale_rate_per_sqft_inr', 18000, 23000, 27000, 30000, 0, 'medium', 'Knight Frank India Q1 2026', '2026-04-01', 'Ultra-premium'),
  ('indiranagar', 'retail', 'retail_rent_per_sqft_month_inr', 280, 420, 650, 900, 0, 'low', 'Cushman Retail H2 2025', '2025-12-01', '100ft Road / 12th Main premium'),
  -- MG Road CBD
  ('mg-road-cbd', 'commercial_office', 'office_rent_per_sqft_month_inr', 110, 135, 160, 195, 0, 'medium', 'JLL Bengaluru Office Dynamics Q1 2026', '2026-04-01', 'CBD pricing'),
  ('mg-road-cbd', 'commercial_office', 'cap_rate_pct', 7.0, 7.5, 8.0, 8.5, 0, 'medium', 'CBRE Cap Rate Survey APAC H2 2025', '2025-12-01', NULL),
  ('mg-road-cbd', 'retail', 'retail_rent_per_sqft_month_inr', 350, 550, 850, 1200, 0, 'low', 'Cushman Retail H2 2025', '2025-12-01', 'High-street CBD');

-- ─────────────────────────────────────────────────────────────────────────
--  SEED 3 — demand signals (transit + infra + supply pressure)
--  Selective — focus on the catalysts the IPC research surfaced.
-- ─────────────────────────────────────────────────────────────────────────

DELETE FROM regulatory_data.micro_market_demand_signals
WHERE locality_code IN (SELECT locality_code FROM regulatory_data.bengaluru_micro_markets);

INSERT INTO regulatory_data.micro_market_demand_signals
  (locality_code, asset_class, signal_kind, value_numeric, value_text, unit, source_ref, last_verified_at, notes)
VALUES
  -- Transit catalysts (BMRCL Phase 3 + Suburban Rail + Phase 2B Blue Line)
  ('hebbal',           NULL, 'transit_proximity',  0.5, 'Airport Metro Blue Line live',     'km',     'BMRCL',         NOW(), 'Phase 2B Blue Line operational'),
  ('kr-puram',         NULL, 'transit_proximity',  0.8, 'Metro interchange — Purple + Blue','km',     'BMRCL',         NOW(), 'Major catalyst'),
  ('yelahanka',        NULL, 'transit_proximity',  2.5, 'Suburban Rail Heelalige-Rajanukunte','km',  'K-RIDE',        NOW(), 'Target Dec 2026'),
  ('jakkur',           NULL, 'transit_proximity',  3.0, 'Suburban Rail',                    'km',     'K-RIDE',        NOW(), NULL),
  ('mahadevapura',     NULL, 'transit_proximity',  1.2, 'Purple Line operational',          'km',     'BMRCL',         NOW(), NULL),
  ('whitefield-east-orr', NULL, 'transit_proximity', 1.0, 'Purple Line extension — Whitefield Metro live', 'km', 'BMRCL', NOW(), NULL),
  ('kanakapura-rd',    NULL, 'transit_proximity',  1.5, 'Pink Line under construction',     'km',     'BMRCL',         NOW(), 'Phase 3 ETA June 2026'),
  ('mysore-rd',        NULL, 'transit_proximity',  0.3, 'Purple Line operational',          'km',     'BMRCL',         NOW(), NULL),
  ('sarjapur-orr',     NULL, 'transit_proximity',  3.5, 'Sarjapur Metro line proposed (Phase 3A)','km','BMRCL Phase 3A',NOW(),'Hebbal-Sarjapura 37km line approved'),

  -- Employment / IT-BT hub strength
  ('whitefield-east-orr', 'commercial_office', 'employment_growth_index', 0.92, 'Tier-1 IT corridor',     NULL, 'NASSCOM 2025 city report', NOW(), 'GCC density'),
  ('sarjapur-orr',     'commercial_office', 'employment_growth_index', 0.88, 'Tier-1 IT corridor',     NULL, 'NASSCOM 2025 city report', NOW(), NULL),
  ('mahadevapura',     'commercial_office', 'employment_growth_index', 0.85, 'ORR GCC cluster',        NULL, 'NASSCOM 2025 city report', NOW(), NULL),
  ('electronic-city-p1', 'commercial_office', 'employment_growth_index', 0.78, 'Mature IT/BT hub',     NULL, 'NASSCOM 2025 city report', NOW(), NULL),
  ('hebbal',           'commercial_office', 'employment_growth_index', 0.70, 'Emerging premium hub',   NULL, 'NASSCOM 2025 city report', NOW(), NULL),

  -- Infra triggers (PRR / STRR / Phase 3 / suburban rail)
  ('devanahalli',      NULL, 'infra_trigger', NULL, 'Airport Metro Phase 2B operational + PRR section', NULL, 'BMRCL/PRR/STRR projects', NOW(), 'Multiple catalysts'),
  ('sarjapur-orr',     NULL, 'infra_trigger', NULL, 'BMRCL Phase 3A approved (Hebbal-Sarjapura 37km)',   NULL, 'BMRCL Phase 3A',         NOW(), NULL),
  ('whitefield-east-orr', NULL, 'infra_trigger', NULL, 'Whitefield Metro live + ORR widening',          NULL, 'BMRCL',                   NOW(), NULL),
  ('hebbal',           NULL, 'infra_trigger', NULL, 'Airport Metro + KR Puram-Hebbal extension',        NULL, 'BMRCL',                   NOW(), NULL),

  -- Supply pressure (office vacancy + residential supply pipeline)
  ('whitefield-east-orr', 'commercial_office', 'absorption_pressure', 1.20, 'Demand outpacing supply', NULL, 'JLL Bengaluru Q1 2026',  NOW(), '4.77 msf net absorption Q1'),
  ('sarjapur-orr',     'commercial_office', 'absorption_pressure', 1.10, 'Tight market',                NULL, 'JLL Bengaluru Q1 2026',  NOW(), NULL),
  ('hebbal',           'commercial_office', 'absorption_pressure', 0.95, 'Supply pipeline accelerating',NULL, 'Cushman Q1 2026',        NOW(), NULL),
  ('mahadevapura',     'commercial_office', 'absorption_pressure', 1.05, 'GCC absorption stable',       NULL, 'JLL Bengaluru Q1 2026',  NOW(), NULL),

  -- 12-month price change (residential)
  ('devanahalli', 'residential_apartments', 'price_yoy_pct', 20.0, NULL, '%', 'ANAROCK Q1 2026',         NOW(), 'Airport corridor heat'),
  ('yelahanka',   'residential_apartments', 'price_yoy_pct', 25.0, NULL, '%', 'Knight Frank Q1 2026',   NOW(), '25% in 2025'),
  ('hebbal',      'residential_apartments', 'price_yoy_pct', 12.0, NULL, '%', 'Knight Frank Q1 2026',   NOW(), NULL),
  ('whitefield-east-orr', 'residential_apartments', 'price_yoy_pct', 8.0, NULL, '%', 'Knight Frank Q1 2026', NOW(), 'Pan-India weighted +8% YoY'),

  -- Buyer-segment mix (qualitative)
  ('whitefield-east-orr', 'residential_apartments', 'demand_buyer_segment', NULL, 'IT professionals 60%, NRI 20%, investor 20%', NULL, 'ANAROCK Q1 2026 buyer survey', NOW(), NULL),
  ('hebbal',              'residential_apartments', 'demand_buyer_segment', NULL, 'NRI 35%, end-user 40%, investor 25%',          NULL, 'ANAROCK Q1 2026 buyer survey', NOW(), NULL),
  ('koramangala',         'residential_apartments', 'demand_buyer_segment', NULL, 'Established end-user 70%, investor 30%',       NULL, 'Knight Frank Wealth Report 2026 India',NOW(), 'Ultra-premium hold pattern'),
  ('electronic-city-p1',  'residential_apartments', 'demand_buyer_segment', NULL, 'IT professionals 75%, investor 25%',           NULL, 'ANAROCK Q1 2026 buyer survey', NOW(), 'High-yield investor draw'),
  ('devanahalli',         'plotted_development',    'demand_buyer_segment', NULL, 'Investor 55%, end-user 30%, NRI 15%',           NULL, 'ANAROCK Q1 2026 buyer survey', NOW(), 'Land-banking driven');

COMMIT;
