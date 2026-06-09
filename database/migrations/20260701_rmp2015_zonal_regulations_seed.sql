-- ============================================================================
-- 20260701_rmp2015_zonal_regulations_seed.sql
-- ----------------------------------------------------------------------------
-- Seeds the OPERATIVE Bengaluru master plan — Revised Master Plan 2015,
-- Volume III: Zoning of Land Use and Regulations (Bangalore Development
-- Authority), approved by Govt. of Karnataka vide G.O. No. UDD 540 BEM AA SE
-- 2004 dated 22-06-2007 — as the authoritative source for FAR / ground
-- coverage / setbacks / buffers in regulatory_data.
--
-- WHY THIS EXISTS (the correction):
--   REDIP's seeded FAR/zone data and code defaults previously pointed at the
--   Revised Master Plan 2031 ("Volume 6") — a DRAFT that was never notified
--   (provisional approval withdrawn by the Karnataka govt in July 2020). RMP
--   2015 remains the only legally operative master plan for the BDA Local
--   Planning Area. This migration:
--     1. Registers RMP 2015 Vol III (+ the 2015 amendment) as an evidence
--        source and master_plan_document.
--     2. Seeds the 9 land-use zones and their FAR / ground-coverage tables
--        (Tables 10, 12, 13, 14, 15, 16, 17, 18, 19) plus the development-plan
--        / integrated-township tables (20, 21, 22) into far_rules — every row
--        carries source page + section + confidence + evidence link.
--     3. Records the cross-cutting facts (drain/lake buffers, Additional FAR,
--        metro-150m FAR-4, redevelopment cap, TDR multipliers, building lines)
--        as evidence_facts.
--     4. Re-tags legacy RMP-2031 far_rules / zones as 'withdrawn' (not deleted
--        — audit trail preserved) and flips the column defaults to RMP 2015.
--
-- All numbers are transcribed verbatim from the primary gazette PDF supplied
-- by the operator. No value is invented. Boundary semantics follow REDIP's
-- existing far_rules convention (road_width_min inclusive, road_width_max
-- exclusive); RMP's "up to X" inclusive bands are encoded with max = the next
-- band's lower bound — a width of exactly the boundary resolves to the higher
-- band (documented per row; practical impact nil and re-verified on site).
--
-- Idempotent: guarded on the evidence_sources.source_title; safe to re-run.
-- ============================================================================

DO $$
DECLARE
  v_src   UUID;
  v_amend UUID;
  v_doc   UUID;
  z_rmain UUID;
  z_rmix  UUID;
  z_ccen  UUID;
  z_cbus  UUID;
  z_mut   UUID;
  z_igen  UUID;
  z_iht   UUID;
  z_psp   UUID;
  z_tt    UUID;
  z_park  UUID;
  z_pu    UUID;
  z_ag    UUID;
  z_uc    UUID;
  v_far_count INT := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM regulatory_data.evidence_sources
    WHERE source_title = 'Revised Master Plan 2015 — Volume III: Zoning of Land Use and Regulations'
      AND org_id IS NULL
  ) THEN
    RAISE NOTICE 'RMP 2015 Vol III already seeded — skipping.';
    RETURN;
  END IF;

  -- ── 1. Evidence sources ────────────────────────────────────────────────
  INSERT INTO regulatory_data.evidence_sources
    (org_id, source_kind, authority_name, source_title, source_url, city,
     plan_version, effective_from, extraction_status, review_status,
     confidence_score, notes)
  VALUES
    (NULL, 'official_pdf', 'Bangalore Development Authority',
     'Revised Master Plan 2015 — Volume III: Zoning of Land Use and Regulations',
     'https://site.bbmp.gov.in/documents/Zoning_Regulations_RMP2015f.pdf',
     'Bengaluru', 'RMP 2015', DATE '2007-06-22', 'completed', 'approved',
     1.000,
     'Operative statutory zoning rulebook. Approved by Govt. of Karnataka vide G.O. No. UDD 540 BEM AA SE 2004 dated 22-06-2007 as part of the Revised Master Plan 2015. Operator-supplied primary gazette PDF.')
  RETURNING id INTO v_src;

  INSERT INTO regulatory_data.evidence_sources
    (org_id, source_kind, authority_name, source_title, city,
     plan_version, effective_from, extraction_status, review_status,
     confidence_score, notes)
  VALUES
    (NULL, 'official_pdf', 'Urban Development Department, Govt. of Karnataka',
     'RMP 2015 Zoning Regulations — Amendment (Karnataka Gazette, Part III)',
     'Bengaluru', 'RMP 2015', DATE '2015-03-23', 'completed', 'approved',
     1.000,
     'Amendment to RMP 2015 zonal regulations. Notification No. UDD 105 MNJ 2008 dated 20-03-2015 (Karnataka Gazette No. 230, 23-03-2015). Withdrew the earlier UDD 105 MNJ 2008 dated 11-12-2014 notification; amends commercial activity / ancillary-use rules in residential zones by ring & road width.')
  RETURNING id INTO v_amend;

  -- ── 2. Master plan document (for the corpus / zone linkage) ─────────────
  INSERT INTO regulatory_data.master_plan_documents
    (org_id, city, plan_name, plan_version, doc_type, extraction_status,
     evidence_source_id, extracted_at)
  VALUES
    (NULL, 'Bengaluru',
     'Revised Master Plan 2015 — Volume III (Zoning of Land Use and Regulations)',
     'RMP 2015', 'rmp_table', 'completed', v_src, now())
  RETURNING id INTO v_doc;

  -- ── 3. Land-use zones (Chapter 1.2 B; regulations Chapter 4) ────────────
  -- fsi_road_width_rules JSONB models the ROAD-WIDTH dimension for the
  -- Decision Strip (buildEnvelope.effectiveFARFromZone / effective_fsi()).
  -- The full plot-size x road-width matrix lives in far_rules below.

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules,
     ground_coverage_pct, permissible_uses, source_page, source_section,
     confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, 'Bengaluru', 'RMP 2015', 'R', 'Residential (Main)',
     1.75, 3.25,
     '[{"road_width_m":0,"fsi":1.75,"max_ground_coverage_pct":75},{"road_width_m":12,"fsi":2.25,"max_ground_coverage_pct":65},{"road_width_m":18,"fsi":2.50,"max_ground_coverage_pct":60},{"road_width_m":24,"fsi":3.00,"max_ground_coverage_pct":55},{"road_width_m":30,"fsi":3.25,"max_ground_coverage_pct":50}]'::jsonb,
     75.00, ARRAY['Plotted residential','Villas/semi-detached','Apartments/Hostels/Dharmashala','Multi-dwelling/Service apartments','Group housing'],
     27, 'RMP 2015 Vol III, §4.1 Table 10', 1.00, 'approved', DATE '2007-06-22',
     'Main use R & T1; ancillary C2,I-2,U3 up to 20% or 50sqm. Road <9m caps height to 11.5m / Stilt+GF+2 irrespective of FAR. Apartments only on plots >360sqm (I/II ring) or >750sqm (III ring), road >9m. FAR is jointly indexed by plot size AND road width — see far_rules.')
  RETURNING id INTO z_rmain;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules,
     ground_coverage_pct, permissible_uses, source_page, source_section,
     confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, 'Bengaluru', 'RMP 2015', 'R-Mixed', 'Residential (Mixed)',
     1.75, 3.25,
     '[{"road_width_m":0,"fsi":1.75,"max_ground_coverage_pct":70},{"road_width_m":12,"fsi":2.25,"max_ground_coverage_pct":65},{"road_width_m":18,"fsi":2.50,"max_ground_coverage_pct":60},{"road_width_m":24,"fsi":3.00,"max_ground_coverage_pct":55},{"road_width_m":30,"fsi":3.25,"max_ground_coverage_pct":50}]'::jsonb,
     70.00, ARRAY['Residential','Employment','Shopping (mixed compact form)'],
     28, 'RMP 2015 Vol III, §4.2 Table 12', 1.00, 'approved', DATE '2007-06-22',
     'Main use R; ancillary C3,I-2,T2,U4 up to 30% of built-up area. Table for plots up to 20,000 sqm.')
  RETURNING id INTO z_rmix;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules,
     ground_coverage_pct, permissible_uses, source_page, source_section,
     confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, 'Bengaluru', 'RMP 2015', 'C-Central', 'Commercial (Central)',
     2.50, 2.50, NULL, 75.00,
     ARRAY['C4 commercial core','R','I-3','T3','U4'],
     30, 'RMP 2015 Vol III, §4.3 Table 13', 1.00, 'approved', DATE '2007-06-22',
     'Historic Petta core (Chickpet/Cubbonpet/Cottonpet, parts of Shivajinagar). Flat FAR 2.50, ground coverage 75% — does NOT vary by road width. Front-only setback up to 150sqm; no rear/side setback 150-500sqm.')
  RETURNING id INTO z_ccen;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules,
     ground_coverage_pct, permissible_uses, source_page, source_section,
     confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, 'Bengaluru', 'RMP 2015', 'C-Business', 'Commercial (Business)',
     1.50, 3.25,
     '[{"road_width_m":0,"fsi":1.50,"max_ground_coverage_pct":55},{"road_width_m":9,"fsi":1.75,"max_ground_coverage_pct":50},{"road_width_m":12,"fsi":2.25,"max_ground_coverage_pct":50},{"road_width_m":18,"fsi":2.50,"max_ground_coverage_pct":45},{"road_width_m":24,"fsi":3.00,"max_ground_coverage_pct":40},{"road_width_m":30,"fsi":3.25,"max_ground_coverage_pct":40}]'::jsonb,
     55.00, ARRAY['C3 business','R','I-3','T3','U4'],
     31, 'RMP 2015 Vol III, §4.4 Table 14', 1.00, 'approved', DATE '2007-06-22',
     'MG Road / Brigade Road / Residency Road belt + secondary centres in III ring. Table for plots up to 12,000 sqm. If road <12m and plot <240sqm: only C2,I-2,R,U4 allowed.')
  RETURNING id INTO z_cbus;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules,
     ground_coverage_pct, permissible_uses, source_page, source_section,
     confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, 'Bengaluru', 'RMP 2015', 'MC', 'Mutation Corridors',
     2.75, 3.25,
     '[{"road_width_m":0,"fsi":2.75,"max_ground_coverage_pct":55},{"road_width_m":30,"fsi":3.25,"max_ground_coverage_pct":50}]'::jsonb,
     55.00, ARRAY['C4','R','I-3','T3','U4'],
     32, 'RMP 2015 Vol III, §4.5 Table 15', 1.00, 'approved', DATE '2007-06-22',
     'Radial/arterial corridors. Min frontage 12m. Table for all plot sizes up to 12,000 sqm. Depth limited to 1-2 property depths (amalgamation rules apply).')
  RETURNING id INTO z_mut;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules,
     ground_coverage_pct, permissible_uses, source_page, source_section,
     confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, 'Bengaluru', 'RMP 2015', 'I-General', 'Industrial (General)',
     1.00, 1.50, NULL, 75.00,
     ARRAY['I-5 all industries','R','C4','U2','T3'],
     34, 'RMP 2015 Vol III, §4.7 Table 16', 1.00, 'approved', DATE '2007-06-22',
     'FAR keyed to plot size (not road width): see far_rules. Ancillary up to 10% land area. KIADB/KSIIDC allotted land needs NOC for non-industrial use.')
  RETURNING id INTO z_igen;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules,
     ground_coverage_pct, permissible_uses, source_page, source_section,
     confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, 'Bengaluru', 'RMP 2015', 'I-HiTech', 'Industrial (Hi-Tech)',
     2.00, 3.25,
     '[{"road_width_m":0,"fsi":2.00,"max_ground_coverage_pct":55},{"road_width_m":12,"fsi":2.25,"max_ground_coverage_pct":50},{"road_width_m":18,"fsi":2.50,"max_ground_coverage_pct":50},{"road_width_m":24,"fsi":3.00,"max_ground_coverage_pct":45},{"road_width_m":30,"fsi":3.25,"max_ground_coverage_pct":45}]'::jsonb,
     55.00, ARRAY['I-3 IT/BT/electronics/telecom','R','C3','T2','U4'],
     35, 'RMP 2015 Vol III, §4.8 Table 17', 1.00, 'approved', DATE '2007-06-22',
     'IT/BT/ITeS priority zone. FAR jointly indexed by plot size AND road width — see far_rules. Ancillary up to 40% of built-up area. Road <12m: residential as main use permitted.')
  RETURNING id INTO z_iht;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules,
     ground_coverage_pct, permissible_uses, source_page, source_section,
     confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, 'Bengaluru', 'RMP 2015', 'P&SP', 'Public and Semi Public',
     1.50, 2.25, NULL, 60.00,
     ARRAY['U4 govt/institutional/health/education/cultural','R','C2','T2'],
     36, 'RMP 2015 Vol III, §4.9 Table 18', 1.00, 'approved', DATE '2007-06-22',
     'FAR keyed to plot size (not road width): see far_rules. Ancillary <=20% of sital area. Setbacks per Table 8/9.')
  RETURNING id INTO z_psp;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules,
     ground_coverage_pct, permissible_uses, source_page, source_section,
     confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, 'Bengaluru', 'RMP 2015', 'T&T', 'Traffic and Transportation',
     1.00, 1.50, NULL, 60.00,
     ARRAY['T4 transport/cargo/warehousing','R','U2','C2','I-3'],
     37, 'RMP 2015 Vol III, §4.10 Table 19', 1.00, 'approved', DATE '2007-06-22',
     'FAR keyed to plot size (not road width): see far_rules. Independent MLCP has no FAR/height limit (subject to fire & airport NOC). Ancillary built-up <=300sqm or 5%.')
  RETURNING id INTO z_tt;

  -- Non-FAR-table zones (recorded for completeness / honest "no standard FAR")
  INSERT INTO regulatory_data.master_plan_zones
    (document_id, city, plan_version, zone_code, zone_name, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score,
     review_status, effective_from, notes)
  VALUES
    (v_doc, 'Bengaluru', 'RMP 2015', 'P', 'Park and Open Space', NULL,
     ARRAY['Parks/playgrounds/stadia','Swimming pools','Cemeteries/crematoria'],
     39, 'RMP 2015 Vol III, §4.12', 1.00, 'approved', DATE '2007-06-22',
     'No standard FAR table. Special-permission uses <=5% area, max G+1. Lake 30m no-development buffer; drains 50/25/15m from centre.')
  RETURNING id INTO z_park;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, city, plan_version, zone_code, zone_name,
     permissible_uses, source_page, source_section, confidence_score,
     review_status, effective_from, notes)
  VALUES
    (v_doc, 'Bengaluru', 'RMP 2015', 'PU', 'Public Utilities',
     ARRAY['Energy/water/telecom/substations/SWM'],
     38, 'RMP 2015 Vol III, §4.11', 1.00, 'approved', DATE '2007-06-22',
     'Non-buildable reservations / utility buffers. Regulations decided by the Authority; KPTCL standards for electrical networks.')
  RETURNING id INTO z_pu;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, permissible_uses,
     source_page, source_section, confidence_score, review_status,
     effective_from, notes)
  VALUES
    (v_doc, 'Bengaluru', 'RMP 2015', 'AG', 'Agricultural Land', 1.00, 1.00,
     ARRAY['Agriculture/Horticulture/Dairy','Agro-processing','Farm houses (<=250sqm, plot <=1.2Ha, G+1)','Golf course (>40Ha)'],
     40, 'RMP 2015 Vol III, §4.13', 1.00, 'approved', DATE '2007-06-22',
     'Outside conurbation. Rural development within 250m of gramathana: FAR 1.0, max G+1. Education/health up to 20% of sital area (G+1).')
  RETURNING id INTO z_ag;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, city, plan_version, zone_code, zone_name,
     permissible_uses, source_page, source_section, confidence_score,
     review_status, effective_from, notes)
  VALUES
    (v_doc, 'Bengaluru', 'RMP 2015', 'UC', 'Unclassified',
     ARRAY['Defence lands','Notified lands'],
     41, 'RMP 2015 Vol III, §4.14', 1.00, 'approved', DATE '2007-06-22',
     'Defence & notified lands. Boundary/use disputes referred to Government; private holdings may take adjoining land use (Authority decision).')
  RETURNING id INTO z_uc;

  -- ── 4. FAR rules (the precise plot-size x road-width matrices) ───────────
  -- Columns: zone_id, zone_code, land_use_family, plot_area_min/max_sqm,
  -- road_width_min/max_m, base_far, max_far, ground_coverage_pct, source_page,
  -- source_section, rule_notes, confidence_score, review_status, plan_status.
  -- Convention: road_width_min inclusive, road_width_max exclusive (NULL = no
  -- upper bound). plot_area same. RMP "up to X" encoded as max = next bound.

  -- Table 10 — Residential (Main): plot size x road width
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm,
     road_width_min_m, road_width_max_m, base_far, max_far, ground_coverage_pct,
     tdr_eligible, source_page, source_section, rule_notes, confidence_score,
     review_status, effective_from)
  VALUES
    (NULL, v_src, z_rmain, 'Bengaluru', 'RMP 2015', 'operative', 'R', 'residential',     0,   360,   0,  12, 1.75, 1.75, 75, true, 27, 'RMP 2015 Vol III Table 10', 'Plot up to 360sqm; road up to 12m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_rmain, 'Bengaluru', 'RMP 2015', 'operative', 'R', 'residential',   360,  1000,  12,  18, 2.25, 2.25, 65, true, 27, 'RMP 2015 Vol III Table 10', 'Plot >360-1000sqm; road >12-18m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_rmain, 'Bengaluru', 'RMP 2015', 'operative', 'R', 'residential',  1000,  2000,  18,  24, 2.50, 2.50, 60, true, 27, 'RMP 2015 Vol III Table 10', 'Plot >1000-2000sqm; road >18-24m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_rmain, 'Bengaluru', 'RMP 2015', 'operative', 'R', 'residential',  2000,  4000,  24,  30, 3.00, 3.00, 55, true, 27, 'RMP 2015 Vol III Table 10', 'Plot >2000-4000sqm; road >24-30m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_rmain, 'Bengaluru', 'RMP 2015', 'operative', 'R', 'residential',  4000, 20000,  30, NULL, 3.25, 3.25, 50, true, 27, 'RMP 2015 Vol III Table 10', 'Plot >4000-20000sqm; road >30m', 1.000, 'approved', DATE '2007-06-22');
  GET DIAGNOSTICS v_far_count = ROW_COUNT;

  -- Table 12 — Residential (Mixed): road width (plots up to 20000sqm)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, zone_id, city, plan_version, plan_status, zone_code, land_use_family,
     plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m, base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes, confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, z_rmix, 'Bengaluru', 'RMP 2015', 'operative', 'R-Mixed', 'residential_mixed', 0, 20000,  0, 12, 1.75, 1.75, 70, true, 28, 'RMP 2015 Vol III Table 12', 'Road up to 12m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_rmix, 'Bengaluru', 'RMP 2015', 'operative', 'R-Mixed', 'residential_mixed', 0, 20000, 12, 18, 2.25, 2.25, 65, true, 28, 'RMP 2015 Vol III Table 12', 'Road >12-18m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_rmix, 'Bengaluru', 'RMP 2015', 'operative', 'R-Mixed', 'residential_mixed', 0, 20000, 18, 24, 2.50, 2.50, 60, true, 28, 'RMP 2015 Vol III Table 12', 'Road >18-24m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_rmix, 'Bengaluru', 'RMP 2015', 'operative', 'R-Mixed', 'residential_mixed', 0, 20000, 24, 30, 3.00, 3.00, 55, true, 28, 'RMP 2015 Vol III Table 12', 'Road >24-30m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_rmix, 'Bengaluru', 'RMP 2015', 'operative', 'R-Mixed', 'residential_mixed', 0, 20000, 30, NULL, 3.25, 3.25, 50, true, 28, 'RMP 2015 Vol III Table 12', 'Road >30m', 1.000, 'approved', DATE '2007-06-22');

  -- Table 13 — Commercial (Central): flat
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, zone_id, city, plan_version, plan_status, zone_code, land_use_family,
     plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m, base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes, confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, z_ccen, 'Bengaluru', 'RMP 2015', 'operative', 'C-Central', 'commercial_central', 0, NULL, 0, NULL, 2.50, 2.50, 75, false, 30, 'RMP 2015 Vol III Table 13', 'Flat FAR/coverage; independent of road width', 1.000, 'approved', DATE '2007-06-22');

  -- Table 14 — Commercial (Business): road width (plots up to 12000sqm)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, zone_id, city, plan_version, plan_status, zone_code, land_use_family,
     plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m, base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes, confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, z_cbus, 'Bengaluru', 'RMP 2015', 'operative', 'C-Business', 'commercial_business', 0, 12000,  0,  9, 1.50, 1.50, 55, true, 31, 'RMP 2015 Vol III Table 14', 'Road less than 9m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_cbus, 'Bengaluru', 'RMP 2015', 'operative', 'C-Business', 'commercial_business', 0, 12000,  9, 12, 1.75, 1.75, 50, true, 31, 'RMP 2015 Vol III Table 14', 'Road >9-12m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_cbus, 'Bengaluru', 'RMP 2015', 'operative', 'C-Business', 'commercial_business', 0, 12000, 12, 18, 2.25, 2.25, 50, true, 31, 'RMP 2015 Vol III Table 14', 'Road >12-18m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_cbus, 'Bengaluru', 'RMP 2015', 'operative', 'C-Business', 'commercial_business', 0, 12000, 18, 24, 2.50, 2.50, 45, true, 31, 'RMP 2015 Vol III Table 14', 'Road >18-24m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_cbus, 'Bengaluru', 'RMP 2015', 'operative', 'C-Business', 'commercial_business', 0, 12000, 24, 30, 3.00, 3.00, 40, true, 31, 'RMP 2015 Vol III Table 14', 'Road >24-30m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_cbus, 'Bengaluru', 'RMP 2015', 'operative', 'C-Business', 'commercial_business', 0, 12000, 30, NULL, 3.25, 3.25, 40, true, 31, 'RMP 2015 Vol III Table 14', 'Road >30m', 1.000, 'approved', DATE '2007-06-22');

  -- Table 15 — Mutation Corridors: road width (all plots up to 12000sqm)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, zone_id, city, plan_version, plan_status, zone_code, land_use_family,
     plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m, base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes, confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, z_mut, 'Bengaluru', 'RMP 2015', 'operative', 'MC', 'mutation_corridor', 0, 12000,  0, 30, 2.75, 2.75, 55, true, 32, 'RMP 2015 Vol III Table 15', 'Road up to 30m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_mut, 'Bengaluru', 'RMP 2015', 'operative', 'MC', 'mutation_corridor', 0, 12000, 30, NULL, 3.25, 3.25, 50, true, 32, 'RMP 2015 Vol III Table 15', 'Road >30m', 1.000, 'approved', DATE '2007-06-22');

  -- Table 16 — Industrial (General): plot size (front/rear-side setbacks fixed)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, zone_id, city, plan_version, plan_status, zone_code, land_use_family,
     plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m, base_far, max_far, ground_coverage_pct, front_setback_m, rear_setback_m, side_setback_m, tdr_eligible, source_page, source_section, rule_notes, confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, z_igen, 'Bengaluru', 'RMP 2015', 'operative', 'I-General', 'industrial_general',     0,   500, 0, NULL, 1.50, 1.50, 75, 4.50, 4.50, 4.50, true, 34, 'RMP 2015 Vol III Table 16', 'Plot up to 500sqm', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_igen, 'Bengaluru', 'RMP 2015', 'operative', 'I-General', 'industrial_general',   500,  1000, 0, NULL, 1.25, 1.25, 60, 4.50, 4.50, 4.50, true, 34, 'RMP 2015 Vol III Table 16', 'Plot >500-1000sqm', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_igen, 'Bengaluru', 'RMP 2015', 'operative', 'I-General', 'industrial_general',  1000,  3000, 0, NULL, 1.00, 1.00, 50, 6.00, 6.00, 6.00, true, 34, 'RMP 2015 Vol III Table 16', 'Plot >1000-3000sqm', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_igen, 'Bengaluru', 'RMP 2015', 'operative', 'I-General', 'industrial_general',  3000,  NULL, 0, NULL, 1.00, 1.00, 45, 10.00, 8.00, 8.00, true, 34, 'RMP 2015 Vol III Table 16', 'Plot >3000sqm', 1.000, 'approved', DATE '2007-06-22');

  -- Table 17 — Industrial (Hi-Tech): plot size x road width
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, zone_id, city, plan_version, plan_status, zone_code, land_use_family,
     plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m, base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes, confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, z_iht, 'Bengaluru', 'RMP 2015', 'operative', 'I-HiTech', 'industrial_hitech',     0,  1000,  0, 12, 2.00, 2.00, 55, true, 35, 'RMP 2015 Vol III Table 17', 'Plot up to 1000sqm; road up to 12m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_iht, 'Bengaluru', 'RMP 2015', 'operative', 'I-HiTech', 'industrial_hitech',  1000,  2000, 12, 18, 2.25, 2.25, 50, true, 35, 'RMP 2015 Vol III Table 17', 'Plot >1000-2000sqm; road >12-18m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_iht, 'Bengaluru', 'RMP 2015', 'operative', 'I-HiTech', 'industrial_hitech',  2000,  4000, 18, 24, 2.50, 2.50, 50, true, 35, 'RMP 2015 Vol III Table 17', 'Plot >2000-4000sqm; road >18-24m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_iht, 'Bengaluru', 'RMP 2015', 'operative', 'I-HiTech', 'industrial_hitech',  4000,  6000, 24, 30, 3.00, 3.00, 45, true, 35, 'RMP 2015 Vol III Table 17', 'Plot >4000-6000sqm; road >24-30m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_iht, 'Bengaluru', 'RMP 2015', 'operative', 'I-HiTech', 'industrial_hitech',  6000, 12000, 30, NULL, 3.25, 3.25, 45, true, 35, 'RMP 2015 Vol III Table 17', 'Plot >6000-12000sqm; road >30m', 1.000, 'approved', DATE '2007-06-22');

  -- Table 18 — Public and Semi Public: plot size
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, zone_id, city, plan_version, plan_status, zone_code, land_use_family,
     plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m, base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes, confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, z_psp, 'Bengaluru', 'RMP 2015', 'operative', 'P&SP', 'public_semi_public',    0,  500, 0, NULL, 1.50, 1.50, 60, true, 36, 'RMP 2015 Vol III Table 18', 'Plot up to 500sqm', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_psp, 'Bengaluru', 'RMP 2015', 'operative', 'P&SP', 'public_semi_public',  500, 1000, 0, NULL, 1.75, 1.75, 55, true, 36, 'RMP 2015 Vol III Table 18', 'Plot >500-1000sqm', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_psp, 'Bengaluru', 'RMP 2015', 'operative', 'P&SP', 'public_semi_public', 1000, 2000, 0, NULL, 2.00, 2.00, 50, true, 36, 'RMP 2015 Vol III Table 18', 'Plot >1000-2000sqm', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_psp, 'Bengaluru', 'RMP 2015', 'operative', 'P&SP', 'public_semi_public', 2000, NULL, 0, NULL, 2.25, 2.25, 45, true, 36, 'RMP 2015 Vol III Table 18', 'Plot >2000sqm', 1.000, 'approved', DATE '2007-06-22');

  -- Table 19 — Traffic and Transportation: plot size
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, zone_id, city, plan_version, plan_status, zone_code, land_use_family,
     plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m, base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes, confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, z_tt, 'Bengaluru', 'RMP 2015', 'operative', 'T&T', 'transportation',    0,  500, 0, NULL, 1.00, 1.00, 60, true, 37, 'RMP 2015 Vol III Table 19', 'Plot up to 500sqm', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_tt, 'Bengaluru', 'RMP 2015', 'operative', 'T&T', 'transportation',  500, 1000, 0, NULL, 1.25, 1.25, 55, true, 37, 'RMP 2015 Vol III Table 19', 'Plot >500-1000sqm', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_tt, 'Bengaluru', 'RMP 2015', 'operative', 'T&T', 'transportation', 1000, 2000, 0, NULL, 1.50, 1.50, 50, true, 37, 'RMP 2015 Vol III Table 19', 'Plot >1000-2000sqm', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_tt, 'Bengaluru', 'RMP 2015', 'operative', 'T&T', 'transportation', 2000, NULL, 0, NULL, 1.50, 1.50, 45, true, 37, 'RMP 2015 Vol III Table 19', 'Plot >2000sqm', 1.000, 'approved', DATE '2007-06-22');

  -- Table 20 — Residential Development Plan (>20000sqm): road width
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, zone_id, city, plan_version, plan_status, zone_code, land_use_family,
     plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m, base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes, confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, z_rmain, 'Bengaluru', 'RMP 2015', 'operative', 'R', 'residential_dev_plan', 20000, NULL,  0, 12, 2.00, 2.00, 60, true, 45, 'RMP 2015 Vol III Table 20', 'Sital area >20000sqm; road <12m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_rmain, 'Bengaluru', 'RMP 2015', 'operative', 'R', 'residential_dev_plan', 20000, NULL, 12, 18, 2.25, 2.25, 55, true, 45, 'RMP 2015 Vol III Table 20', 'Road >12-18m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_rmain, 'Bengaluru', 'RMP 2015', 'operative', 'R', 'residential_dev_plan', 20000, NULL, 18, 24, 2.50, 2.50, 55, true, 45, 'RMP 2015 Vol III Table 20', 'Road >18-24m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_rmain, 'Bengaluru', 'RMP 2015', 'operative', 'R', 'residential_dev_plan', 20000, NULL, 24, 30, 3.00, 3.00, 50, true, 45, 'RMP 2015 Vol III Table 20', 'Road >24-30m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_rmain, 'Bengaluru', 'RMP 2015', 'operative', 'R', 'residential_dev_plan', 20000, NULL, 30, NULL, 3.25, 3.25, 50, true, 45, 'RMP 2015 Vol III Table 20', 'Road >30m', 1.000, 'approved', DATE '2007-06-22');

  -- Table 21 — Non-Residential Development Plan & Flatted Factories (>12000sqm): road width
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, zone_id, city, plan_version, plan_status, zone_code, land_use_family,
     plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m, base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes, confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, z_cbus, 'Bengaluru', 'RMP 2015', 'operative', 'C-Business', 'non_residential_dev_plan', 12000, NULL,  0,  9, 1.50, 1.50, 60, true, 46, 'RMP 2015 Vol III Table 21', 'Sital area >12000sqm; road <9m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_cbus, 'Bengaluru', 'RMP 2015', 'operative', 'C-Business', 'non_residential_dev_plan', 12000, NULL,  9, 12, 1.75, 1.75, 55, true, 46, 'RMP 2015 Vol III Table 21', 'Road >9-12m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_cbus, 'Bengaluru', 'RMP 2015', 'operative', 'C-Business', 'non_residential_dev_plan', 12000, NULL, 12, 15, 2.00, 2.00, 55, true, 46, 'RMP 2015 Vol III Table 21', 'Road >12-15m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_cbus, 'Bengaluru', 'RMP 2015', 'operative', 'C-Business', 'non_residential_dev_plan', 12000, NULL, 15, 18, 2.25, 2.25, 50, true, 46, 'RMP 2015 Vol III Table 21', 'Road >15-18m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_cbus, 'Bengaluru', 'RMP 2015', 'operative', 'C-Business', 'non_residential_dev_plan', 12000, NULL, 18, 24, 2.50, 2.50, 50, true, 46, 'RMP 2015 Vol III Table 21', 'Road >18-24m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_cbus, 'Bengaluru', 'RMP 2015', 'operative', 'C-Business', 'non_residential_dev_plan', 12000, NULL, 24, 30, 3.00, 3.00, 45, true, 46, 'RMP 2015 Vol III Table 21', 'Road >24-30m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, z_cbus, 'Bengaluru', 'RMP 2015', 'operative', 'C-Business', 'non_residential_dev_plan', 12000, NULL, 30, NULL, 3.25, 3.25, 45, true, 46, 'RMP 2015 Vol III Table 21', 'Road >30m', 1.000, 'approved', DATE '2007-06-22');

  -- Table 22 — Integrated Township (>=40Ha; min 18m road)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, zone_id, city, plan_version, plan_status, zone_code, land_use_family,
     plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m, base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes, confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, NULL, 'Bengaluru', 'RMP 2015', 'operative', 'IT-Township', 'integrated_township', 400000, NULL, 18, 24, 2.50, 2.50, 55, false, 47, 'RMP 2015 Vol III Table 22', 'Min 40Ha; road >18-24m. 40% res / 55% hi-tech / 5% commercial.', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, NULL, 'Bengaluru', 'RMP 2015', 'operative', 'IT-Township', 'integrated_township', 400000, NULL, 24, 30, 3.00, 3.00, 50, false, 47, 'RMP 2015 Vol III Table 22', 'Road >24-30m', 1.000, 'approved', DATE '2007-06-22'),
    (NULL, v_src, NULL, 'Bengaluru', 'RMP 2015', 'operative', 'IT-Township', 'integrated_township', 400000, NULL, 30, NULL, 3.25, 3.25, 45, false, 47, 'RMP 2015 Vol III Table 22', 'Road >30m', 1.000, 'approved', DATE '2007-06-22');

  -- ── 5. Cross-cutting facts (buffers / Additional FAR / metro / TDR / lines)
  INSERT INTO regulatory_data.evidence_facts
    (source_id, org_id, fact_type, fact_key, fact_value, page_number, source_section, confidence_score, review_status)
  VALUES
    (v_src, NULL, 'environmental', 'drain_buffers',
     '{"measurement_ref":"from centre of drain","primary_m":50,"secondary_m":25,"tertiary_m":15,"note":"RMP 2015 newly-identified drains; if buffer unmarked due to cartographic error, insist per revenue records."}'::jsonb,
     39, 'RMP 2015 Vol III §4.12 / Technical Terms §18', 1.000, 'approved'),
    (v_src, NULL, 'environmental', 'lake_buffer',
     '{"measurement_ref":"from lake boundary per revenue records","no_development_zone_m":30,"note":"30m no-development buffer around water bodies; activities associated with the lake excepted."}'::jsonb,
     39, 'RMP 2015 Vol III §4.12(ii)', 1.000, 'approved'),
    (v_src, NULL, 'far_incentive', 'additional_far_amalgamation',
     '{"basis":"amalgamated/reconstituted after RMP 2015 approval; lands in I & II rings (100 & 200 series PDs)","ring1":{"upto_360":"as existing","360_to_4000":0.25,"above_4000":0.50},"ring2":{"above_4000":0.25},"ring3":"as existing FAR and norms"}'::jsonb,
     21, 'RMP 2015 Vol III §3.4(v) Additional FAR', 1.000, 'approved'),
    (v_src, NULL, 'far_incentive', 'metro_proximity_far',
     '{"radius_m":150,"max_far":4.0,"applies_to":"all permissible uses within 150m of metro terminals","conditions":"only AFTER metro station completion and confirmation by BMRCL; until then existing regulations apply; FAR shall not exceed 4 in any case"}'::jsonb,
     25, 'RMP 2015 Vol III §3.16(ix)-(x)', 1.000, 'approved'),
    (v_src, NULL, 'far_incentive', 'redevelopment_scheme',
     '{"max_ground_coverage_pct":60,"max_far":3.0,"by":"Karnataka Slum Clearance Board/BDA/BBMP/KHB","zones":["Residential (Main)","Residential (Mixed)","Commercial (Central)","Commercial (Business)","Industrial (General)","Industrial (Hi-tech)"]}'::jsonb,
     42, 'RMP 2015 Vol III §5.3', 1.000, 'approved'),
    (v_src, NULL, 'tdr', 'tdr_rules',
     '{"drc_multiplier_on_surrender":1.5,"receiving_plot_uplift_max_x_existing_far":{"road_ge_12m":0.60,"road_9_to_12m":0.40},"min_road_for_receiving_plot_m":9,"validity_years":5,"generation_utilisation_matrix_table25":{"A_to_A":1.00,"A_to_B":1.50,"A_to_C":2.00,"B_to_A":0.666,"B_to_B":1.00,"B_to_C":1.333,"C_to_A":0.50,"C_to_B":0.666,"C_to_C":1.00},"rings":"A=Ring I (core), B=Ring II, C=Ring III"}'::jsonb,
     53, 'RMP 2015 Vol III Chapter 10 / Table 25', 1.000, 'approved'),
    (v_src, NULL, 'noc_requirement', 'noc_thresholds',
     '{"fire_noc_height_m":24.0,"kspcb_noc":"all development plans/apartments/residential layouts per KSPCB category","aai_noc":"where applicable (airport height restrictions)","earthquake_design":"G+4 or height >=15m per NBC + IS 1893-2002"}'::jsonb,
     23, 'RMP 2015 Vol III §3.12 / §9.3', 1.000, 'approved'),
    (v_src, NULL, 'high_rise', 'high_rise_definition',
     '{"high_rise_height_m":24,"note":"Building of height 24m or more above average surrounding ground level is a high-rise / multi-storeyed building."}'::jsonb,
     4, 'RMP 2015 Vol III Technical Terms §25', 1.000, 'approved');

  -- ── 6. Re-tag legacy RMP 2031 reference rows as withdrawn (audit-safe) ───
  UPDATE regulatory_data.far_rules
     SET plan_status = 'withdrawn',
         rule_notes = COALESCE(rule_notes || ' | ', '') ||
           'RMP 2031 was never notified (provisional approval withdrawn Jul 2020). Superseded by RMP 2015 operative rows.'
   WHERE org_id IS NULL
     AND (plan_version ILIKE '%2031%' OR plan_status = 'draft_reference');

  UPDATE regulatory_data.master_plan_zones
     SET notes = COALESCE(notes || ' | ', '') ||
           'RMP 2031 withdrawn 2020 — not operative. Use RMP 2015 zones.'
   WHERE plan_version ILIKE '%2031%';

  RAISE NOTICE 'RMP 2015 Vol III seeded: 1 doc, 13 zones, % FAR-rule rows in the first batch + 8 zones'' rules + facts. Legacy RMP 2031 rows re-tagged withdrawn.', v_far_count;
END $$;

-- ── 7. Flip column defaults so future rows default to the operative plan ───
ALTER TABLE regulatory_data.far_rules ALTER COLUMN plan_version SET DEFAULT 'RMP 2015';
ALTER TABLE regulatory_data.far_rules ALTER COLUMN plan_status  SET DEFAULT 'operative';
