-- ============================================================
-- Migration: 20260404_market_data.sql
-- Adds market_transactions, micro_market_benchmarks tables;
-- adds range columns to comps; seeds all verified data from
-- provided benchmark and transaction screenshots.
-- ============================================================

-- ── 1. MARKET TRANSACTIONS TABLE ─────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS market_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year     VARCHAR(10)  NOT NULL,          -- 'FY2025', 'FY2026', 'FY2027'
  quarter         VARCHAR(5)   NOT NULL,           -- 'Q1' … 'Q4'
  deal_type       VARCHAR(50)  NOT NULL,           -- 'Land deal', 'Equity investment', 'Debt'
  buyer           TEXT,
  seller          TEXT,
  investor_lender TEXT,
  quantum_inr_mn  NUMERIC,                        -- ₹ in INR millions
  land_size_acres NUMERIC,                        -- land size in acres (null for equity/debt)
  project_size_note TEXT,                         -- free-text project size context
  locality        TEXT,                           -- specific sub-market
  notes           TEXT,                           -- notes/caveats
  source_reference TEXT,
  city            VARCHAR(100) DEFAULT 'Bengaluru',
  is_verified     BOOLEAN      DEFAULT TRUE,
  created_at      TIMESTAMPTZ  DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS market_transactions_dedup
  ON market_transactions (fiscal_year, quarter, quantum_inr_mn, LOWER(COALESCE(buyer, '')));

CREATE INDEX IF NOT EXISTS idx_mktxn_fy     ON market_transactions (fiscal_year);
CREATE INDEX IF NOT EXISTS idx_mktxn_type   ON market_transactions (deal_type);
CREATE INDEX IF NOT EXISTS idx_mktxn_city   ON market_transactions (city);

-- ── 2. MICRO-MARKET BENCHMARKS TABLE ─────────────────────────

CREATE TABLE IF NOT EXISTS micro_market_benchmarks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city                  VARCHAR(100) DEFAULT 'Bengaluru',
  micro_market          VARCHAR(200) NOT NULL,
  avg_price_min_per_sqft NUMERIC,
  avg_price_max_per_sqft NUMERIC,
  yoy_growth_min_pct    NUMERIC,
  yoy_growth_max_pct    NUMERIC,
  anchor_hub            TEXT,
  data_period           VARCHAR(50) DEFAULT '2025-2026',
  is_verified           BOOLEAN DEFAULT TRUE,
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (city, micro_market)
);

CREATE INDEX IF NOT EXISTS idx_mmb_city ON micro_market_benchmarks (city);

-- ── 3. ADD RANGE COLUMNS TO COMPS ────────────────────────────

ALTER TABLE comps ADD COLUMN IF NOT EXISTS rate_per_sqft_min NUMERIC;
ALTER TABLE comps ADD COLUMN IF NOT EXISTS rate_per_sqft_max NUMERIC;
-- carpet_area_sqft = unit size min; super_builtup_area_sqft = unit size max

-- ── 4. SEED: MARKET TRANSACTIONS (FY2025–FY2027) ─────────────

INSERT INTO market_transactions
  (fiscal_year, quarter, deal_type, buyer, seller, investor_lender, quantum_inr_mn,
   land_size_acres, project_size_note, locality, notes, source_reference, city)
VALUES
-- FY2025
('FY2025','Q1','Land deal',
 'Sumadhura Group','Not disclosed',NULL,5000,5,NULL,
 'North Bengaluru',
 'Quantum = topline / revenue potential (~₹500 Cr)',
 'Economic Times (Jun 2024)','Bengaluru'),

('FY2025','Q4','Land deal',
 'Mahindra Lifespace Developers (via Anthurium Developers)','Not disclosed',NULL,10000,8.2,'0.9 mn sf development potential',
 'Bengaluru',
 'Quantum = GDV (~₹1,000 Cr)',
 'Mahindra Lifespaces press release (Jan 23, 2025)','Bengaluru'),

('FY2025','Q4','Land deal',
 'TVS Emerald','Not disclosed',NULL,16000,10,'1.4 mn sf development potential',
 'Bengaluru',
 'Quantum = project revenue potential (~₹1,600 Cr)',
 'Economic Times (Feb 25, 2025)','Bengaluru'),

('FY2025','Q4','Land deal',
 'Lam Research (India) Pvt Ltd',
 'Embassy East Business Park Pvt Ltd (Embassy Developments subsidiary)',
 NULL,11250,25,NULL,
 'ITPL Whitefield',
 'Quantum = consideration (~₹1,125 Cr) | Land = ITPL Whitefield (25 acres)',
 'Economic Times (Mar 20, 2025)','Bengaluru'),

-- FY2026 Q1
('FY2026','Q1','Debt',
 'Century Real Estate (borrower)',NULL,'Ares Asia + SC Lowy',18500,NULL,NULL,
 'Bengaluru',
 'Quantum = structured debt (~₹1,850 Cr)',
 'Economic Times (May 2025)','Bengaluru'),

('FY2026','Q1','Land deal',
 'Mahindra Lifespace Developers (via SPA for Shreyas Stones Pvt Ltd)',
 'Shreyas Stones Pvt Ltd shareholders (SPA)',NULL,1990,9,NULL,
 'Bengaluru',
 'Quantum = consideration (~₹199 Cr) | Project rev potential ~₹1,100 Cr',
 'Business Standard / Economic Times (Jun 30, 2025)','Bengaluru'),

('FY2026','Q1','Land deal',
 'Puravankara Group + KVN Property Holdings (JV)',
 'Not disclosed (land parcel owner)',NULL,33000,24.59,'3.48 mn sf saleable area',
 'North Bengaluru',
 'Quantum = GDV (~₹3,300 Cr) | Land parcel 24.59 acres (North Bengaluru)',
 'Economic Times (May 10, 2025)','Bengaluru'),

('FY2026','Q1','Land deal',
 'TVS Emerald','Not disclosed',NULL,7000,7.18,NULL,
 'SE Bengaluru (near Ravasandra Lake)',
 'Quantum = project revenue potential (>₹700 Cr) | Land 7.18 acres near Ravasandra Lake',
 'Business Standard (Jun 24, 2025)','Bengaluru'),

('FY2026','Q1','Equity investment',
 'Embassy Office Parks REIT (proposed acquirer)',
 'Embassy Developments Ltd (proposed divestment)',
 NULL,37000,NULL,'3.3 mn sf',
 'Bengaluru',
 'Proposed | Quantum = GDV range ₹3,200–3,700 Cr (shown as ₹3,700 Cr)',
 'Economic Times (May 30, 2025)','Bengaluru'),

-- FY2026 Q2
('FY2026','Q2','Land deal',
 'Brigade Enterprises','Not disclosed',NULL,5883,20.19,'4.2 mn sf',
 'Bengaluru',
 'Quantum = land consideration (₹588.33 Cr) | Mixed-use dev potential ~₹5,200 Cr',
 'Business Standard (Jul 21, 2025)','Bengaluru'),

('FY2026','Q2','Land deal',
 'Brigade Enterprises (JDA)',
 'United Oxygen Company Pvt Ltd (landowner; per media reports)',
 NULL,12000,7.5,NULL,
 'South Bengaluru (JDA)',
 'Quantum = GDV (~₹1,200 Cr) | JDA South Bengaluru',
 'Moneycontrol (Sep 23, 2025)','Bengaluru'),

-- FY2026 Q3
('FY2026','Q3','Land deal',
 'Godrej Properties','Not disclosed',NULL,11000,26,NULL,
 'Sarjapur Road',
 'Quantum = revenue potential (~₹1,100 Cr) | Land 26 acres near Sarjapur Road',
 'Hindustan Times (Oct 15, 2025)','Bengaluru'),

('FY2026','Q3','Equity investment',
 'Embassy Developments promoters (fund infusion)',
 'Embassy Developments Ltd (issuer)',
 'Promoter group',11600,NULL,NULL,
 'Bengaluru',
 'Quantum = promoter equity infusion (₹1,160 Cr)',
 'Economic Times (Oct 14, 2025)','Bengaluru'),

('FY2026','Q3','Debt',
 'Embassy Developments Ltd (borrower)',NULL,'Kotak Real Estate Fund',13700,NULL,NULL,
 'Bengaluru',
 'Quantum = debt raised (₹1,370 Cr)',
 'Economic Times (Nov 26, 2025) + EDL Investor Update PDF (Nov 2025)','Bengaluru'),

('FY2026','Q3','Land deal',
 'Puravankara Limited','Not disclosed',NULL,48000,53.5,NULL,
 'Anekal / Attibele Hobli',
 'Quantum = GDV (~₹4,800 Cr) | Land 53.5 acres (Anekal/Attibele Hobli)',
 'Puravankara regulatory press release (Dec 23, 2025)','Bengaluru'),

('FY2026','Q3','Equity investment',
 'Brookfield India Real Estate Trust (BIRET)',
 'Brookfield Group (vendor)',
 NULL,131250,NULL,'7.7 mn sf',
 'Outer Ring Road (ORR)',
 'Quantum = acquisition cost (~₹13,125 Cr) | Asset: Ecoworld (7.7 msf, ORR)',
 'Economic Times (Nov 5, 2025) + ICRA rationale (Dec 11, 2025)','Bengaluru'),

('FY2026','Q3','Equity investment',
 'Embassy Office Parks REIT',
 'Not disclosed (third-party seller)',
 NULL,8520,NULL,'0.3 mn sf',
 'Embassy GolfLinks',
 'Quantum = acquisition cost (~₹852 Cr) | Asset: 0.3 msf at Embassy GolfLinks',
 'Embassy REIT press release + Business Standard (Dec 3, 2025)','Bengaluru'),

('FY2026','Q3','Land deal',
 'EAAA Alternatives (Real Assets Business / Rental Yield Plus)',
 'Embassy Office Parks REIT',
 NULL,5300,NULL,'0.376 mn sf',
 'Embassy Manyata',
 'Quantum = consideration (~₹530 Cr) | Two strata blocks at Embassy Manyata (~376k sf)',
 'Embassy REIT press release (Dec 24, 2025)','Bengaluru'),

('FY2026','Q3','Debt',
 'Address Maker Developers (borrower)',NULL,
 'AI Growth (Jiraaf holding company) via affiliates',
 2000,NULL,NULL,
 'Bengaluru',
 'Quantum = rolling capital framework (~₹200 Cr)',
 'Economic Times (Dec 3, 2025)','Bengaluru'),

-- FY2026 Q4
('FY2026','Q4','Debt',
 'TVS Emerald (borrower)',NULL,'IFC (World Bank Group)',1030,10,'1.4 mn sf development potential',
 'Bengaluru',
 'Quantum = Bengaluru allocation (~₹103 Cr) within ₹425 Cr IFC facility (multi-city)',
 'Hindustan Times (Jan 2026)','Bengaluru'),

('FY2026','Q4','Debt',
 'NCD','Puravankara','NCD',1500,NULL,NULL,
 'Bengaluru',
 NULL,'Puravankara','Bengaluru'),

('FY2026','Q4','Debt',
 'Prestige',NULL,'Bajaj Housing Finance',4500,NULL,NULL,
 'Bengaluru',
 NULL,'NSE','Bengaluru'),

('FY2026','Q4','Land deal',
 'Govt. of Karnataka','Landowners',NULL,1560,28,NULL,
 'Arkavathi Riverfront',
 'Arkavathi Riverfront | 28+ acres',
 'Times of India','Bengaluru'),

('FY2026','Q4','Land deal',
 'Shriram Properties','Shrivision Upscale Spaces',NULL,6000,4,NULL,
 'Sarjapur Main Road',
 NULL,'ET Realty','Bengaluru'),

('FY2026','Q4','Land deal',
 'Puravankara Limited','Not disclosed',NULL,13000,4,NULL,
 'Hennur Main Road',
 'Residential',
 'Economic Times','Bengaluru'),

('FY2026','Q4','Land deal',
 'Arvind SmartSpaces Ltd','Not disclosed',NULL,3300,2.08,NULL,
 'Whitefield',
 'Residential',
 'Hindustan Times','Bengaluru'),

('FY2026','Q4','Land deal',
 'Godrej Properties','Not disclosed',NULL,13500,20,NULL,
 'Whitefield',
 'Residential',
 'Hindustan Times','Bengaluru'),

-- FY2027
('FY2027','Q1','Land deal',
 'Tata Realty and Infrastructure Ltd',
 'Gulf Oil Corp + Hinduja Realty Ventures',
 NULL,23000,38,NULL,
 'North Bengaluru',
 'Premium Commercial Office | 38+ acres',
 'Source pending','Bengaluru')

ON CONFLICT (fiscal_year, quarter, quantum_inr_mn, LOWER(COALESCE(buyer, ''))) DO NOTHING;

-- ── 5. SEED: MICRO-MARKET BENCHMARKS ─────────────────────────

INSERT INTO micro_market_benchmarks
  (city, micro_market, avg_price_min_per_sqft, avg_price_max_per_sqft,
   yoy_growth_min_pct, yoy_growth_max_pct, anchor_hub, data_period)
VALUES
  ('Bengaluru','Whitefield',                13900,17000,  5, 9, 'ITPL, RMZ Ecoworld',                '2025-2026'),
  ('Bengaluru','Sarjapur Road',              6500,12000,  7, 9, 'Wipro SEZ, Embassy TechVillage',     '2025-2026'),
  ('Bengaluru','Hebbal / North Bengaluru',   8500,12000,  6, 8, 'Manyata Tech Park, Airport',         '2025-2026'),
  ('Bengaluru','Devanahalli / Bagalur',      8000,11500,  8,12, 'Aerospace Park, KIA',                '2025-2026'),
  ('Bengaluru','Thanisandra / Hennur',      10000,17000,  7,10, 'Manyata Tech Park',                  '2025-2026'),
  ('Bengaluru','Bannerghatta Road',          8000,12640,  6, 8, 'NICE Road, E-City access',            '2025-2026'),
  ('Bengaluru','Kanakapura Road',            7500,11000,  5, 7, 'Metro Green Line, NICE',              '2025-2026'),
  ('Bengaluru','Electronic City',            5000,12340,  5, 7, 'Infosys, Wipro, TCS campuses',        '2025-2026')
ON CONFLICT (city, micro_market) DO UPDATE SET
  avg_price_min_per_sqft = EXCLUDED.avg_price_min_per_sqft,
  avg_price_max_per_sqft = EXCLUDED.avg_price_max_per_sqft,
  yoy_growth_min_pct     = EXCLUDED.yoy_growth_min_pct,
  yoy_growth_max_pct     = EXCLUDED.yoy_growth_max_pct,
  anchor_hub             = EXCLUDED.anchor_hub,
  data_period            = EXCLUDED.data_period,
  updated_at             = NOW();

-- ── 6. UPDATE COMPS WITH UNIT COUNTS, SIZE RANGES, RATE RANGES ──

-- East Bengaluru
UPDATE comps SET total_units=733,  bhk_config='3/3.5/4 BHK',            carpet_area_sqft=1136, super_builtup_area_sqft=1515, rate_per_sqft=15500, rate_per_sqft_min=15500, rate_per_sqft_max=15500 WHERE project_name='Mahindra Blossom'            AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=2000, bhk_config='1/2/3/4 BHK',            carpet_area_sqft=659,  super_builtup_area_sqft=2513, rate_per_sqft=15400, rate_per_sqft_min=13900, rate_per_sqft_max=16900 WHERE project_name='Prestige Evergreen'           AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=329,  bhk_config='3/4 BHK',                 carpet_area_sqft=1060, super_builtup_area_sqft=2810, rate_per_sqft=14600, rate_per_sqft_min=14600, rate_per_sqft_max=14600 WHERE project_name='Sumadhura Solace Phase II'    AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=1875, bhk_config='1/3/3.5/4 BHK',          carpet_area_sqft=660,  super_builtup_area_sqft=2481, rate_per_sqft=14850, rate_per_sqft_min=14100, rate_per_sqft_max=15600 WHERE project_name='Sobha Neopolis Phase 4'       AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=150,  bhk_config='2/3/4 BHK',               carpet_area_sqft=826,  super_builtup_area_sqft=1464, rate_per_sqft=15000, rate_per_sqft_min=15000, rate_per_sqft_max=15000 WHERE project_name='Sumadhura Edition Phase II'   AND city ILIKE '%bengaluru%';

-- North Bengaluru
UPDATE comps SET total_units=429,  bhk_config='3/4 BHK',                 carpet_area_sqft=1770, super_builtup_area_sqft=2773, rate_per_sqft=8220,  rate_per_sqft_min=8220,  rate_per_sqft_max=8220  WHERE project_name='Casagrand Estancia'         AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=940,  bhk_config='3BHK/4BHK/Townhouse/Row House', carpet_area_sqft=1650, super_builtup_area_sqft=3553, rate_per_sqft=11900, rate_per_sqft_min=10000, rate_per_sqft_max=13800 WHERE project_name='TATA Varnam'           AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=1904, bhk_config='Studio/1/2/2.5/3/3.5/4 BHK + Row Houses', carpet_area_sqft=650, super_builtup_area_sqft=2600, rate_per_sqft=11670, rate_per_sqft_min=11670, rate_per_sqft_max=11670 WHERE project_name='Bhartiya Nikoo Garden Estate' AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=1077, bhk_config='Studio/1/2/3/4 BHK',      carpet_area_sqft=447,  super_builtup_area_sqft=2324, rate_per_sqft=10970, rate_per_sqft_min=10970, rate_per_sqft_max=10970 WHERE project_name='Sattva Vasanta Skye'        AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=600,  bhk_config='3/4 BHK Villas & Apartments', carpet_area_sqft=2400, super_builtup_area_sqft=3200, rate_per_sqft=9500, rate_per_sqft_min=9500, rate_per_sqft_max=9500 WHERE project_name='Prestige Autumn Leaves'  AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=2522, bhk_config='2/2.5/3 BHK',             carpet_area_sqft=1041, super_builtup_area_sqft=1927, rate_per_sqft=8160,  rate_per_sqft_min=8160,  rate_per_sqft_max=8160  WHERE project_name='Kalyani Living Tree'        AND city ILIKE '%bengaluru%';

-- South Bengaluru
UPDATE comps SET total_units=359,  bhk_config='3/4 BHK',                 carpet_area_sqft=2050, super_builtup_area_sqft=2566, rate_per_sqft=16660, rate_per_sqft_min=16660, rate_per_sqft_max=16660 WHERE project_name ILIKE '%Vaishnavi%Krishna%'   AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=2130, bhk_config='1/2/3/3.5/4 BHK',         carpet_area_sqft=695,  super_builtup_area_sqft=2774, rate_per_sqft=12150, rate_per_sqft_min=11500, rate_per_sqft_max=12800 WHERE project_name='Prestige Southern Star'      AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=2000, bhk_config='2/3/4 BHK',               carpet_area_sqft=1100, super_builtup_area_sqft=2500, rate_per_sqft=12000, rate_per_sqft_min=10000, rate_per_sqft_max=13000 WHERE project_name ILIKE '%Godrej%Bannerghatta%' AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=340,  bhk_config='2/2.5/3/4 BHK',           carpet_area_sqft=1134, super_builtup_area_sqft=2100, rate_per_sqft=13000, rate_per_sqft_min=12000, rate_per_sqft_max=14000 WHERE project_name ILIKE '%Arvind%Bannerghatta%' AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=407,  bhk_config='1/2/3/4 BHK',             carpet_area_sqft=700,  super_builtup_area_sqft=1868, rate_per_sqft=12000, rate_per_sqft_min=12000, rate_per_sqft_max=12000 WHERE project_name='Sattva Forest Ridge'         AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=150,  bhk_config='3/3.5/4 BHK',             carpet_area_sqft=1950, super_builtup_area_sqft=3060, rate_per_sqft=14000, rate_per_sqft_min=14000, rate_per_sqft_max=14000 WHERE project_name='Lodha Azur'                  AND city ILIKE '%bengaluru%';

-- Sarjapur / Electronic City
UPDATE comps SET total_units=356,  bhk_config='3/4/5 BHK',               carpet_area_sqft=1370, super_builtup_area_sqft=3700, rate_per_sqft=13070, rate_per_sqft_min=12340, rate_per_sqft_max=13800 WHERE project_name='Purva Silversky'             AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=440,  bhk_config='2.5/3 BHK',               carpet_area_sqft=1127, super_builtup_area_sqft=1563, rate_per_sqft=10930, rate_per_sqft_min=10930, rate_per_sqft_max=10930 WHERE project_name='Mana Vista'                  AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=437,  bhk_config='1/2/3 BHK',               carpet_area_sqft=661,  super_builtup_area_sqft=2005, rate_per_sqft=10500, rate_per_sqft_min=10500, rate_per_sqft_max=10500 WHERE project_name='Prestige Suncrest'            AND city ILIKE '%bengaluru%';
UPDATE comps SET total_units=218,  bhk_config='3 BHK',                   carpet_area_sqft=1796, super_builtup_area_sqft=1821, rate_per_sqft=11200, rate_per_sqft_min=10400, rate_per_sqft_max=12500 WHERE project_name='Ren and Rei'                  AND city ILIKE '%bengaluru%';
