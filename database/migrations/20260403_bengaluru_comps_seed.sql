-- Bengaluru Residential Comp Benchmarks
-- Source: Verified micro-market pricing benchmark table (internal research)
-- as_of: April 2026
-- All prices in INR per sqft (current). Areas in sqft.
-- Idempotent: skips rows where project_name + city already exist.

-- Add unique constraint if not already present (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comps_project_name_city_key'
  ) THEN
    ALTER TABLE comps ADD CONSTRAINT comps_project_name_city_key UNIQUE (project_name, city);
  END IF;
END$$;

INSERT INTO comps (
  project_name, developer, city, locality, lat, lng,
  project_type, bhk_config, rate_per_sqft, total_units,
  is_verified, source, created_at, updated_at
) VALUES

-- ─── East Bengaluru: Whitefield / Brookefield / KR Puram ───────────────────
('Mahindra Blossom', 'Mahindra Lifespace Developers Limited',
  'Bengaluru', 'Whitefield', 12.9698, 77.7499,
  'residential', '3/3.5/4 BHK', 15500, 733, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('Prestige Evergreen', 'Prestige',
  'Bengaluru', 'Brookefield', 12.9716, 77.7337,
  'residential', '1/2/3/4 BHK', 15400, 2000, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('Sumadhura Solace Phase II', 'Sumadhura Infracon Pvt Ltd',
  'Bengaluru', 'Brookefield', 12.9712, 77.7280,
  'residential', '3/4 BHK', 14600, 329, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('Sobha Neopolis Phase 4', 'Sobha Developers',
  'Bengaluru', 'Panathur', 12.9534, 77.7046,
  'residential', '1/3/3.5/4 BHK', 14850, 1875, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('Sumadhura Edition Phase II', 'Sumadhura Infracon Pvt Ltd',
  'Bengaluru', 'Whitefield', 12.9784, 77.7499,
  'residential', '2/3/4 BHK', 15000, 150, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

-- ─── North Bengaluru: Yelahanka / Hebbal-Yelahanka belt ────────────────────
('Casagrand Estancia', 'Casagrand',
  'Bengaluru', 'Yelahanka', 13.1007, 77.5963,
  'residential', '3/4 BHK', 8220, 429, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('TATA Varnam', 'Tata Housing',
  'Bengaluru', 'Yelahanka', 13.1127, 77.5840,
  'residential', '3 BHK / 4 BHK / Townhouses / Row Houses', 11900, 940, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('Bhartiya Nikoo Garden Estate', 'Bhartiya Urban',
  'Bengaluru', 'Bhartiya City', 13.0668, 77.6101,
  'residential', 'Studio / 1 / 2 / 2.5 / 3 / 3.5 / 4 BHK', 11670, 1904, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('Sattva Vasanta Skye', 'Sattva Group',
  'Bengaluru', 'Yelahanka', 13.1132, 77.5846,
  'residential', 'Studio / 1 / 2 / 3 / 4 BHK', 10970, 1077, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('Prestige Autumn Leaves', 'Prestige Group',
  'Bengaluru', 'Hebbal', 13.0450, 77.5948,
  'residential', '3/4 BHK Villas & Apartments', 9500, 600, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('Kalyani Living Tree', 'Kalyani Developers',
  'Bengaluru', 'Yelahanka', 13.1074, 77.5946,
  'residential', '2/2.5/3 BHK', 8160, 2522, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

-- ─── South Bengaluru: Jayanagar / JP Nagar / Bannerghatta belt ─────────────
('Vaishnavi at One Krishna Brindavan', 'Vaishnavi Group',
  'Bengaluru', 'JP Nagar', 12.9073, 77.5801,
  'residential', '3/4 BHK', 16660, 359, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('Prestige Southern Star', 'Prestige',
  'Bengaluru', 'Bannerghatta Road', 12.8857, 77.5970,
  'residential', '1/2/3/3.5/4 BHK', 12150, 2130, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('Godrej Bannerghatta Road', 'Godrej Properties',
  'Bengaluru', 'Bannerghatta Road', 12.8790, 77.5980,
  'residential', '2/3/4 BHK', 12000, 2000, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('Arvind Bannerghatta Road', 'Arvind SmartSpaces',
  'Bengaluru', 'Bannerghatta Road', 12.8820, 77.5960,
  'residential', '2/2.5/3/4 BHK', 13000, 340, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('Sattva Forest Ridge', 'Sattva Group',
  'Bengaluru', 'Bannerghatta Road', 12.8780, 77.5975,
  'residential', '1/2/3/4 BHK', 12000, 407, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('Lodha Azur', 'Lodha Group',
  'Bengaluru', 'Bannerghatta Road', 12.8756, 77.5988,
  'residential', '3/3.5/4 BHK', 14000, 150, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

-- ─── Sarjapur Road / Electronic City Phase 2 ────────────────────────────────
('Purva Silversky', 'Puravankara Limited',
  'Bengaluru', 'Sarjapur Road', 12.8806, 77.6890,
  'residential', '3/4/5 BHK', 13070, 356, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('Mana Vista', 'Mana Projects Pvt Ltd',
  'Bengaluru', 'Electronic City', 12.8395, 77.6770,
  'residential', '2.5/3 BHK', 10930, 440, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('Prestige Suncrest', 'Prestige Group',
  'Bengaluru', 'Sarjapur Road', 12.8840, 77.6930,
  'residential', '1/2/3 BHK', 10500, 437, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW()),

('Ren and Rei', 'Assetz',
  'Bengaluru', 'Electronic City Phase 2', 12.8310, 77.6700,
  'residential', '3 BHK', 11200, 218, TRUE,
  'Internal benchmark table – April 2026', NOW(), NOW())

ON CONFLICT (project_name, city) DO NOTHING;
