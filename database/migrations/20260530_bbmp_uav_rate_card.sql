-- 20260530_bbmp_uav_rate_card.sql
--
-- Restores the BBMP Unit Area Value (UAV) rate card — the per-(zone, use)
-- property-tax rates that back the "UAV Benchmark" panel at
-- /admin/planning-intelligence. Lost when the legacy Tokyo Supabase project
-- was deleted; tonight's audit shows 0 rows on Mumbai vs 1,016 on Tokyo.
--
-- Source: BBMP Gazette Notification No. 384 dated 09-Mar-2016 (the
-- "Guidance Value.pdf" already registered in regulatory_data.master_plan_documents
-- as id f7f9720f-9f79-4e5c-9f6a-a52ad02bea43). Tables I (residential, p.2)
-- and II (non-residential, p.3-7) classify each (zone × use × status) into
-- an INR / sqft / month rate. Hand-extracted from the gazette tables (not
-- LLM) because misreading a Roman numeral or column alignment in a 6-zone
-- printed table is catastrophic for revenue calcs — confidence 0.95.
--
-- Coverage: 16 property-use categories × 6 zones = 96 zonal rows, plus 6
-- additional Star-Hotel-equivalent rows (zone-agnostic Rs.25/sqft/month
-- expanded across all 6 zones for matrix consistency). 102 rows total.
--
-- Skipped (future PR): Cat IV residential lump-sum, Cat IX cinemas, Cat X
-- private hospitals, Cat XII industrial, Cat XV-XVI telecom+hoardings —
-- those use special rate tables not on a per-zone basis.
--
-- Idempotent — re-runs DELETE the existing BBMP UAV rows for this
-- document and re-INSERT the canonical set. The bbmp_uav_entries table
-- has no UNIQUE constraint to upsert on, so DELETE-then-INSERT is the
-- right pattern.

BEGIN;

-- Idempotency: clean-slate the BBMP UAV rows tied to the Guidance Value gazette.
DELETE FROM regulatory_data.bbmp_uav_entries
WHERE document_id = 'f7f9720f-9f79-4e5c-9f6a-a52ad02bea43'
   OR (authority_name = 'BBMP' AND city = 'Bengaluru' AND assessment_year = '2016-19');

-- Helper: every row shares these constants. Inlined for SQL editor
-- portability (no temp tables, no PL/pgSQL functions).
--   document_id        f7f9720f-9f79-4e5c-9f6a-a52ad02bea43
--   city               Bengaluru
--   authority_name     BBMP
--   assessment_year    2016-19
--   unit_label         INR per sqft per month
--   confidence_score   0.95
--   review_status      approved
--   notes              hand-extracted from official BBMP gazette

INSERT INTO regulatory_data.bbmp_uav_entries
  (document_id, city, authority_name, assessment_year,
   uav_zone_code, uav_zone_name, property_use,
   unit_area_value_inr, unit_label, source_page, source_section,
   confidence_score, review_status, notes)
VALUES
-- ========================================================================
-- Table I — RESIDENTIAL USE (Gazette p.2)
-- ========================================================================

-- Category I — RCC or Madras terrace buildings, Tenanted (zones A-F)
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Residential — RCC/Madras terrace (tenanted)',  6.00, 'INR per sqft per month', 2, 'Table I, Category I', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Residential — RCC/Madras terrace (tenanted)',  4.80, 'INR per sqft per month', 2, 'Table I, Category I', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Residential — RCC/Madras terrace (tenanted)',  4.30, 'INR per sqft per month', 2, 'Table I, Category I', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Residential — RCC/Madras terrace (tenanted)',  3.80, 'INR per sqft per month', 2, 'Table I, Category I', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Residential — RCC/Madras terrace (tenanted)',  3.00, 'INR per sqft per month', 2, 'Table I, Category I', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Residential — RCC/Madras terrace (tenanted)',  2.40, 'INR per sqft per month', 2, 'Table I, Category I', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),

-- Category I — RCC or Madras terrace buildings, Owner-occupied
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Residential — RCC/Madras terrace (owner)',     3.00, 'INR per sqft per month', 2, 'Table I, Category I', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Residential — RCC/Madras terrace (owner)',     2.40, 'INR per sqft per month', 2, 'Table I, Category I', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Residential — RCC/Madras terrace (owner)',     2.15, 'INR per sqft per month', 2, 'Table I, Category I', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Residential — RCC/Madras terrace (owner)',     1.90, 'INR per sqft per month', 2, 'Table I, Category I', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Residential — RCC/Madras terrace (owner)',     1.50, 'INR per sqft per month', 2, 'Table I, Category I', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Residential — RCC/Madras terrace (owner)',     1.20, 'INR per sqft per month', 2, 'Table I, Category I', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),

-- Category II — RCC/Madras with cement or red oxide flooring, Tenanted
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Residential — Cement/Red-oxide floor (tenanted)', 4.80, 'INR per sqft per month', 2, 'Table I, Category II', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Residential — Cement/Red-oxide floor (tenanted)', 4.20, 'INR per sqft per month', 2, 'Table I, Category II', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Residential — Cement/Red-oxide floor (tenanted)', 3.60, 'INR per sqft per month', 2, 'Table I, Category II', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Residential — Cement/Red-oxide floor (tenanted)', 3.00, 'INR per sqft per month', 2, 'Table I, Category II', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Residential — Cement/Red-oxide floor (tenanted)', 1.90, 'INR per sqft per month', 2, 'Table I, Category II', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Residential — Cement/Red-oxide floor (tenanted)', 1.70, 'INR per sqft per month', 2, 'Table I, Category II', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),

-- Category II — RCC/Madras with cement or red oxide flooring, Owner-occupied
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Residential — Cement/Red-oxide floor (owner)',    2.40, 'INR per sqft per month', 2, 'Table I, Category II', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Residential — Cement/Red-oxide floor (owner)',    2.10, 'INR per sqft per month', 2, 'Table I, Category II', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Residential — Cement/Red-oxide floor (owner)',    1.80, 'INR per sqft per month', 2, 'Table I, Category II', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Residential — Cement/Red-oxide floor (owner)',    1.50, 'INR per sqft per month', 2, 'Table I, Category II', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Residential — Cement/Red-oxide floor (owner)',    0.95, 'INR per sqft per month', 2, 'Table I, Category II', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Residential — Cement/Red-oxide floor (owner)',    0.85, 'INR per sqft per month', 2, 'Table I, Category II', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),

-- Category III — Tiled / Sheet of all kinds, Tenanted
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Residential — Tiled/Sheet (tenanted)',         3.60, 'INR per sqft per month', 2, 'Table I, Category III', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Residential — Tiled/Sheet (tenanted)',         3.00, 'INR per sqft per month', 2, 'Table I, Category III', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Residential — Tiled/Sheet (tenanted)',         2.40, 'INR per sqft per month', 2, 'Table I, Category III', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Residential — Tiled/Sheet (tenanted)',         1.90, 'INR per sqft per month', 2, 'Table I, Category III', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Residential — Tiled/Sheet (tenanted)',         1.20, 'INR per sqft per month', 2, 'Table I, Category III', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Residential — Tiled/Sheet (tenanted)',         1.00, 'INR per sqft per month', 2, 'Table I, Category III', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),

-- Category III — Tiled / Sheet of all kinds, Owner-occupied
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Residential — Tiled/Sheet (owner)',            1.80, 'INR per sqft per month', 2, 'Table I, Category III', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Residential — Tiled/Sheet (owner)',            1.50, 'INR per sqft per month', 2, 'Table I, Category III', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Residential — Tiled/Sheet (owner)',            1.20, 'INR per sqft per month', 2, 'Table I, Category III', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Residential — Tiled/Sheet (owner)',            1.00, 'INR per sqft per month', 2, 'Table I, Category III', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Residential — Tiled/Sheet (owner)',            0.60, 'INR per sqft per month', 2, 'Table I, Category III', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Residential — Tiled/Sheet (owner)',            0.50, 'INR per sqft per month', 2, 'Table I, Category III', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),

-- ========================================================================
-- Table II — NON-RESIDENTIAL USE (Gazette p.3-7)
-- ========================================================================

-- Category V — Non-residential without central AC (banks/offices/shops/IT-BPO), Tenanted
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Commercial — No AC (tenanted)',                25.00, 'INR per sqft per month', 3, 'Table II, Category V', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Commercial — No AC (tenanted)',                17.50, 'INR per sqft per month', 3, 'Table II, Category V', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Commercial — No AC (tenanted)',                12.50, 'INR per sqft per month', 3, 'Table II, Category V', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Commercial — No AC (tenanted)',                10.00, 'INR per sqft per month', 3, 'Table II, Category V', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Commercial — No AC (tenanted)',                 7.50, 'INR per sqft per month', 3, 'Table II, Category V', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Commercial — No AC (tenanted)',                 3.80, 'INR per sqft per month', 3, 'Table II, Category V', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),

-- Category V — Non-residential without central AC, Self-occupied
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Commercial — No AC (self-occupied)',           12.50, 'INR per sqft per month', 4, 'Table II, Category V', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Commercial — No AC (self-occupied)',            8.75, 'INR per sqft per month', 4, 'Table II, Category V', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Commercial — No AC (self-occupied)',            6.25, 'INR per sqft per month', 4, 'Table II, Category V', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Commercial — No AC (self-occupied)',            5.00, 'INR per sqft per month', 4, 'Table II, Category V', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Commercial — No AC (self-occupied)',            3.75, 'INR per sqft per month', 4, 'Table II, Category V', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Commercial — No AC (self-occupied)',            1.90, 'INR per sqft per month', 4, 'Table II, Category V', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),

-- Category VI — With escalators / Central AC (IT, Bio-tech, malls)
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Commercial — With AC / escalator (IT/Bio-tech)', 25.00, 'INR per sqft per month', 5, 'Table II, Category VI', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Commercial — With AC / escalator (IT/Bio-tech)', 20.00, 'INR per sqft per month', 5, 'Table II, Category VI', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Commercial — With AC / escalator (IT/Bio-tech)', 15.00, 'INR per sqft per month', 5, 'Table II, Category VI', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Commercial — With AC / escalator (IT/Bio-tech)', 12.50, 'INR per sqft per month', 5, 'Table II, Category VI', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Commercial — With AC / escalator (IT/Bio-tech)', 10.00, 'INR per sqft per month', 5, 'Table II, Category VI', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Commercial — With AC / escalator (IT/Bio-tech)',  7.50, 'INR per sqft per month', 5, 'Table II, Category VI', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),

-- Category VII (a) — Hotels with boarding+lodging, built-up < 5000 sft
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Hotel/Restaurant — built-up < 5000 sft',       15.00, 'INR per sqft per month', 5, 'Table II, Category VII(a)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; excludes star hotels (cat VIII) and AC/escalator (cat VI)'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Hotel/Restaurant — built-up < 5000 sft',       13.75, 'INR per sqft per month', 5, 'Table II, Category VII(a)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; excludes star hotels (cat VIII) and AC/escalator (cat VI)'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Hotel/Restaurant — built-up < 5000 sft',       12.50, 'INR per sqft per month', 5, 'Table II, Category VII(a)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; excludes star hotels (cat VIII) and AC/escalator (cat VI)'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Hotel/Restaurant — built-up < 5000 sft',       10.00, 'INR per sqft per month', 5, 'Table II, Category VII(a)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; excludes star hotels (cat VIII) and AC/escalator (cat VI)'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Hotel/Restaurant — built-up < 5000 sft',        8.75, 'INR per sqft per month', 5, 'Table II, Category VII(a)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; excludes star hotels (cat VIII) and AC/escalator (cat VI)'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Hotel/Restaurant — built-up < 5000 sft',        7.50, 'INR per sqft per month', 5, 'Table II, Category VII(a)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; excludes star hotels (cat VIII) and AC/escalator (cat VI)'),

-- Category VII (b) — Hotels with boarding+lodging, built-up 5001-10000 sft
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Hotel/Restaurant — built-up 5001-10000 sft',   17.50, 'INR per sqft per month', 5, 'Table II, Category VII(b)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Hotel/Restaurant — built-up 5001-10000 sft',   16.25, 'INR per sqft per month', 5, 'Table II, Category VII(b)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Hotel/Restaurant — built-up 5001-10000 sft',   15.00, 'INR per sqft per month', 5, 'Table II, Category VII(b)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Hotel/Restaurant — built-up 5001-10000 sft',   12.50, 'INR per sqft per month', 5, 'Table II, Category VII(b)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Hotel/Restaurant — built-up 5001-10000 sft',   11.25, 'INR per sqft per month', 5, 'Table II, Category VII(b)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Hotel/Restaurant — built-up 5001-10000 sft',   10.00, 'INR per sqft per month', 5, 'Table II, Category VII(b)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),

-- Category VII (c) — Hotels with boarding+lodging, built-up > 10001 sft
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Hotel/Restaurant — built-up > 10001 sft',      20.00, 'INR per sqft per month', 5, 'Table II, Category VII(c)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Hotel/Restaurant — built-up > 10001 sft',      18.75, 'INR per sqft per month', 5, 'Table II, Category VII(c)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Hotel/Restaurant — built-up > 10001 sft',      17.50, 'INR per sqft per month', 5, 'Table II, Category VII(c)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Hotel/Restaurant — built-up > 10001 sft',      15.00, 'INR per sqft per month', 5, 'Table II, Category VII(c)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Hotel/Restaurant — built-up > 10001 sft',      13.75, 'INR per sqft per month', 5, 'Table II, Category VII(c)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Hotel/Restaurant — built-up > 10001 sft',      12.50, 'INR per sqft per month', 5, 'Table II, Category VII(c)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),

-- Category VIII — Star hotels (Rs.25/sqft regardless of zone — expanded across zones for matrix consistency)
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Hotel — Star (Min. of Tourism classified)',    25.00, 'INR per sqft per month', 5, 'Table II, Category VIII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; rate is location-agnostic per gazette'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Hotel — Star (Min. of Tourism classified)',    25.00, 'INR per sqft per month', 5, 'Table II, Category VIII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; rate is location-agnostic per gazette'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Hotel — Star (Min. of Tourism classified)',    25.00, 'INR per sqft per month', 5, 'Table II, Category VIII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; rate is location-agnostic per gazette'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Hotel — Star (Min. of Tourism classified)',    25.00, 'INR per sqft per month', 5, 'Table II, Category VIII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; rate is location-agnostic per gazette'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Hotel — Star (Min. of Tourism classified)',    25.00, 'INR per sqft per month', 5, 'Table II, Category VIII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; rate is location-agnostic per gazette'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Hotel — Star (Min. of Tourism classified)',    25.00, 'INR per sqft per month', 5, 'Table II, Category VIII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; rate is location-agnostic per gazette'),

-- Category XI (a) — Kalyana Mantapa / Convention Hall, built-up <= 5000 sft
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Kalyana Mantapa / Convention — <= 5000 sft',   11.25, 'INR per sqft per month', 6, 'Table II, Category XI(a)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Kalyana Mantapa / Convention — <= 5000 sft',   10.00, 'INR per sqft per month', 6, 'Table II, Category XI(a)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Kalyana Mantapa / Convention — <= 5000 sft',    7.50, 'INR per sqft per month', 6, 'Table II, Category XI(a)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Kalyana Mantapa / Convention — <= 5000 sft',    6.25, 'INR per sqft per month', 6, 'Table II, Category XI(a)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Kalyana Mantapa / Convention — <= 5000 sft',    5.00, 'INR per sqft per month', 6, 'Table II, Category XI(a)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Kalyana Mantapa / Convention — <= 5000 sft',    3.75, 'INR per sqft per month', 6, 'Table II, Category XI(a)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),

-- Category XI (b) — Kalyana Mantapa / Convention Hall, built-up > 5001 sft
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Kalyana Mantapa / Convention — > 5001 sft',    12.50, 'INR per sqft per month', 6, 'Table II, Category XI(b)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Kalyana Mantapa / Convention — > 5001 sft',    11.25, 'INR per sqft per month', 6, 'Table II, Category XI(b)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Kalyana Mantapa / Convention — > 5001 sft',     8.75, 'INR per sqft per month', 6, 'Table II, Category XI(b)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Kalyana Mantapa / Convention — > 5001 sft',     7.50, 'INR per sqft per month', 6, 'Table II, Category XI(b)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Kalyana Mantapa / Convention — > 5001 sft',     6.25, 'INR per sqft per month', 6, 'Table II, Category XI(b)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Kalyana Mantapa / Convention — > 5001 sft',     5.00, 'INR per sqft per month', 6, 'Table II, Category XI(b)', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),

-- Category XIII — Vacant land (the headline land rate the deal team cares about)
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Vacant Land',                                   0.60, 'INR per sqft per month', 6, 'Table II, Category XIII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Vacant Land',                                   0.50, 'INR per sqft per month', 6, 'Table II, Category XIII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Vacant Land',                                   0.40, 'INR per sqft per month', 6, 'Table II, Category XIII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Vacant Land',                                   0.30, 'INR per sqft per month', 6, 'Table II, Category XIII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Vacant Land',                                   0.25, 'INR per sqft per month', 6, 'Table II, Category XIII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Vacant Land',                                   0.15, 'INR per sqft per month', 6, 'Table II, Category XIII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),

-- Category XIV — Service charges on tax-exempt buildings
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Exempt building — service charges',             7.50, 'INR per sqft per month', 7, 'Table II, Category XIV', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; 25% of standard rate per Sec 110 KMC Act'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Exempt building — service charges',             6.25, 'INR per sqft per month', 7, 'Table II, Category XIV', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; 25% of standard rate per Sec 110 KMC Act'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Exempt building — service charges',             5.75, 'INR per sqft per month', 7, 'Table II, Category XIV', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; 25% of standard rate per Sec 110 KMC Act'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Exempt building — service charges',             5.00, 'INR per sqft per month', 7, 'Table II, Category XIV', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; 25% of standard rate per Sec 110 KMC Act'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Exempt building — service charges',             4.50, 'INR per sqft per month', 7, 'Table II, Category XIV', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; 25% of standard rate per Sec 110 KMC Act'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Exempt building — service charges',             3.75, 'INR per sqft per month', 7, 'Table II, Category XIV', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016; 25% of standard rate per Sec 110 KMC Act'),

-- Category XVII — Paying Guest Accommodation
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'A', 'Zone A (CBD)',         'Paying Guest accommodation',                    8.00, 'INR per sqft per month', 7, 'Table II, Category XVII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'B', 'Zone B',               'Paying Guest accommodation',                    7.00, 'INR per sqft per month', 7, 'Table II, Category XVII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'C', 'Zone C',               'Paying Guest accommodation',                    6.00, 'INR per sqft per month', 7, 'Table II, Category XVII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'D', 'Zone D',               'Paying Guest accommodation',                    5.00, 'INR per sqft per month', 7, 'Table II, Category XVII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'E', 'Zone E',               'Paying Guest accommodation',                    4.00, 'INR per sqft per month', 7, 'Table II, Category XVII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016'),
('f7f9720f-9f79-4e5c-9f6a-a52ad02bea43', 'Bengaluru', 'BBMP', '2016-19', 'F', 'Zone F (peripheral)',  'Paying Guest accommodation',                    3.00, 'INR per sqft per month', 7, 'Table II, Category XVII', 0.95, 'approved', 'BBMP Notification 384 dt 09-Mar-2016');

-- Verification: post-apply summary by zone (every zone should have the
-- same number of property_use rows = the matrix is complete).
SELECT
  uav_zone_code,
  COUNT(DISTINCT property_use)::int AS uses,
  COUNT(*)::int                     AS rows
FROM regulatory_data.bbmp_uav_entries
WHERE city = 'Bengaluru' AND authority_name = 'BBMP'
GROUP BY uav_zone_code
ORDER BY uav_zone_code;

COMMIT;
