-- ============================================================================
-- 20260724_hoskote_lpa_mp2031_zonal_regulations_seed.sql
-- ----------------------------------------------------------------------------
-- Seed the operative Hoskote rulebook so the jurisdiction resolver routes Hoskote
-- (east Bengaluru) parcels to REAL FAR numbers. Companion to the registry
-- migration 20260723. Same pattern as Anekal (20260714) + BIAAPA (20260722).
--
-- SOURCE (primary PDF, verbatim transcription — every number cross-checked
-- against the rendered source page):
--   "Master Plan (Provisional) for Hoskote Local Planning Area 2031 — Chapter 10:
--    Zonal Regulations", Hoskote Planning Authority under BMRDA.
--   File: hoskote.tpa.gov.in/.../Zonal Regulations-2031.pdf (75 pp).
--
-- WHAT IT SEEDS (tagged statutory_plan_id = HOSKOTE_LPA_MP_2031 from 20260723,
-- looked up by plan_code, never hardcoded):
--   - 1 evidence_source + 1 master_plan_document; links the plan to the source.
--   - 9 master_plan_zones (the 8 §10 use-zones + the IT/BT industrial sub-zone).
--   - 40 far_rules transcribed VERBATIM from:
--       Table 4  (Max FAR & Road Widths, p.37) — Residential / Commercial /
--                Public&Semi-public·T&T·Public-Utility columns (road-width-driven);
--       Table 5  (Group Housing, p.38) — road-width-driven, plot >= 1 ha;
--       Table 10 (Industrial buildings, p.42) — by plot area (plot-area-driven);
--       Table 11 (IT/BT in Industrial Zone, p.43) — by plot area.
--   - evidence_facts: high-rise setback ladder (Table 3), low-rise + IT/BT setback
--     tables (reference, page-cited), Flatted Factories (Table 9), Group-Housing
--     norms, the Table-4 FAR-exclusion note, and the PROVISIONAL plan-status flag.
--
-- ENCODING CONVENTIONS (identical to the RMP-2015 / Anekal / BIAAPA seeds):
--   - road_width_min inclusive, road_width_max exclusive; "Up to X" / "Over X"
--     bands encoded with max = the next band's lower bound.
--   - Residential/Commercial/PSP/PU/T&T FAR is ROAD-WIDTH-driven (Table 4). Group
--     Housing FAR is road-width-driven (Table 5, plot >= 1 ha). Industrial + IT/BT
--     FAR is PLOT-AREA-driven (Tables 10/11); road = min frontage in rule_notes.
--   - Agriculture is a deal-killer zone with NO fabricated FAR band.
--
-- Every row carries source page + section + confidence + the Hoskote evidence
-- link, review_status='approved' (verbatim transcription, adversarially verified).
-- Idempotent: guarded on evidence_sources.source_title. Safe to re-run.
-- Rollback: delete the Hoskote evidence_source (far_rules/zones cascade).
-- ============================================================================

DO $$
DECLARE
  v_src UUID;
  v_doc UUID;
  p_hoskote UUID;
  z_r  UUID; z_c  UUID; z_i  UUID; z_it UUID; z_psp UUID;
  z_pu UUID; z_tc UUID; z_os UUID; z_ag UUID;
  v_far INT := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM regulatory_data.evidence_sources
    WHERE source_title = 'Hoskote LPA Master Plan 2031 (Provisional) — Chapter 10: Zonal Regulations'
      AND org_id IS NULL
  ) THEN
    RAISE NOTICE 'Hoskote Zonal Regulations already seeded — skipping.';
    RETURN;
  END IF;

  SELECT id INTO p_hoskote
    FROM regulatory_data.statutory_plans
   WHERE plan_code = 'HOSKOTE_LPA_MP_2031' AND org_id IS NULL
   LIMIT 1;
  IF p_hoskote IS NULL THEN
    RAISE EXCEPTION 'HOSKOTE_LPA_MP_2031 statutory plan not found — apply 20260723 first.';
  END IF;

  -- ── 1. Evidence source + document ──────────────────────────────────────
  INSERT INTO regulatory_data.evidence_sources
    (org_id, source_kind, authority_name, source_title, source_url, city,
     plan_version, effective_from, extraction_status, review_status, confidence_score, notes)
  VALUES
    (NULL, 'official_pdf', 'Hoskote Planning Authority (BMRDA)',
     'Hoskote LPA Master Plan 2031 (Provisional) — Chapter 10: Zonal Regulations',
     'http://hoskote.tpa.gov.in/sites/hoskote.tpa.gov.in/files/Zonal Regulations-2031.pdf',
     'Hoskote', 'Hoskote LPA MP 2031', NULL,
     'completed', 'approved', 0.900,
     'Operative (provisional) zoning rulebook for the Hoskote LPA under BMRDA. FAR/coverage transcribed '
     || 'verbatim from Chapter 10 Tables 4, 5, 10, 11, each cross-checked against the rendered source '
     || 'page. Source document is a PROVISIONAL master plan — verify final-approval status per deal.')
  RETURNING id INTO v_src;

  INSERT INTO regulatory_data.master_plan_documents
    (org_id, city, plan_name, plan_version, doc_type, extraction_status, evidence_source_id, extracted_at)
  VALUES
    (NULL, 'Hoskote', 'Hoskote LPA Master Plan 2031 — Zonal Regulations', 'Hoskote LPA MP 2031',
     'rmp_table', 'completed', v_src, now())
  RETURNING id INTO v_doc;

  UPDATE regulatory_data.statutory_plans
     SET evidence_source_id = v_src,
         notes = 'Operative (provisional) master plan for the Hoskote LPA under BMRDA. Zonal regulations / '
              || 'FAR tables ingested (migration 20260724). Verify final-approval status per deal.',
         updated_at = now()
   WHERE id = p_hoskote;

  -- ── 2. Use-zones (§10 — eight use-zones + IT/BT industrial sub-zone) ─────
  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_hoskote, 'Hoskote', 'Hoskote LPA MP 2031', 'HOS-R', 'Residential (Hoskote)',
     1.50, 2.75,
     '[{"road_width_m":0,"fsi":1.50},{"road_width_m":9,"fsi":1.75},{"road_width_m":12,"fsi":2.00},{"road_width_m":18,"fsi":2.25},{"road_width_m":24,"fsi":2.50}]'::jsonb,
     NULL, ARRAY['Dwelling units/plotted residential','Apartments/group housing (plot >= 1 ha)','Schools/creche/community','Public utilities (special)'],
     37, 'Hoskote MP 2031 Zoning Regs §10 + Table 4', 0.900, 'approved', NULL,
     'FAR road-width-driven (Table 4). Plots >= 1 ha (10000 sqm) are group housing — road-width-driven FAR/coverage per Table 5 (min 12 m approach road).')
  RETURNING id INTO z_r;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_hoskote, 'Hoskote', 'Hoskote LPA MP 2031', 'HOS-C', 'Commercial (Hoskote)',
     1.50, 2.50,
     '[{"road_width_m":0,"fsi":1.50},{"road_width_m":9,"fsi":1.75},{"road_width_m":12,"fsi":2.00},{"road_width_m":18,"fsi":2.25},{"road_width_m":24,"fsi":2.50}]'::jsonb,
     NULL, ARRAY['Retail/shops/commercial complexes','Offices/business','Hotels/restaurants','Service industries (special)'],
     37, 'Hoskote MP 2031 Zoning Regs §10 + Table 4', 0.900, 'approved', NULL,
     'FAR road-width-driven (Table 4, Commercial column).')
  RETURNING id INTO z_c;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_hoskote, 'Hoskote', 'Hoskote LPA MP 2031', 'HOS-I', 'Industrial (Hoskote)',
     1.00, 1.25,
     '[{"road_width_m":0,"fsi":1.00,"max_ground_coverage_pct":80},{"road_width_m":6,"fsi":1.25,"max_ground_coverage_pct":60}]'::jsonb,
     NULL, ARRAY['Light/medium/heavy industries','Warehouses/logistics/storage','Flatted factories','Manager/staff dwellings (ancillary)'],
     42, 'Hoskote MP 2031 Zoning Regs §10.12 + Table 10', 0.900, 'approved', NULL,
     'FAR plot-area-driven (Table 10). Coverage 80%->45%, FAR 1.00->1.25->1.00 by plot size; IT/BT uses the HOS-IT sub-zone (Table 11).')
  RETURNING id INTO z_i;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_hoskote, 'Hoskote', 'Hoskote LPA MP 2031', 'HOS-IT', 'Industrial — IT/BT (Hoskote)',
     1.50, 2.50,
     '[{"road_width_m":9,"fsi":1.50,"max_ground_coverage_pct":55},{"road_width_m":12,"fsi":1.75,"max_ground_coverage_pct":50},{"road_width_m":18,"fsi":2.00,"max_ground_coverage_pct":50},{"road_width_m":24,"fsi":2.25,"max_ground_coverage_pct":45},{"road_width_m":30,"fsi":2.50,"max_ground_coverage_pct":45}]'::jsonb,
     NULL, ARRAY['IT/ITES parks','BT/R&D/BPO','Software/hardware offices'],
     43, 'Hoskote MP 2031 Zoning Regs §10 + Table 11', 0.900, 'approved', NULL,
     'IT/BT activities within the Industrial zone — FAR plot-area-driven (Table 11). Higher FAR than general industry.')
  RETURNING id INTO z_it;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_hoskote, 'Hoskote', 'Hoskote LPA MP 2031', 'HOS-PSP', 'Public & Semi-Public (Hoskote)',
     1.25, 2.00,
     '[{"road_width_m":0,"fsi":1.25},{"road_width_m":9,"fsi":1.50},{"road_width_m":12,"fsi":1.75},{"road_width_m":18,"fsi":1.75},{"road_width_m":24,"fsi":2.00}]'::jsonb,
     NULL, ARRAY['Government/institutional buildings','Hospitals/educational','Community/civic amenities'],
     37, 'Hoskote MP 2031 Zoning Regs §10 + Table 4', 0.900, 'approved', NULL,
     'FAR road-width-driven (Table 4, shared Public&Semi-public·T&T·Public-Utility column).')
  RETURNING id INTO z_psp;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_hoskote, 'Hoskote', 'Hoskote LPA MP 2031', 'HOS-PU', 'Public Utilities (Hoskote)',
     1.25, 2.00,
     '[{"road_width_m":0,"fsi":1.25},{"road_width_m":9,"fsi":1.50},{"road_width_m":12,"fsi":1.75},{"road_width_m":18,"fsi":1.75},{"road_width_m":24,"fsi":2.00}]'::jsonb,
     NULL, ARRAY['Water/sewage/power utilities','Telecom/electrical infrastructure','Solid-waste/treatment facilities'],
     37, 'Hoskote MP 2031 Zoning Regs §10 + Table 4', 0.900, 'approved', NULL,
     'FAR road-width-driven (Table 4, shared Public&Semi-public·T&T·Public-Utility column).')
  RETURNING id INTO z_pu;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_hoskote, 'Hoskote', 'Hoskote LPA MP 2031', 'HOS-TC', 'Transportation & Communication (Hoskote)',
     1.25, 2.00,
     '[{"road_width_m":0,"fsi":1.25},{"road_width_m":9,"fsi":1.50},{"road_width_m":12,"fsi":1.75},{"road_width_m":18,"fsi":1.75},{"road_width_m":24,"fsi":2.00}]'::jsonb,
     NULL, ARRAY['Railway/bus/truck terminals','Logistics/cargo/depots','Filling/service stations'],
     37, 'Hoskote MP 2031 Zoning Regs §10 + Table 4', 0.900, 'approved', NULL,
     'FAR road-width-driven (Table 4, shared Public&Semi-public·T&T·Public-Utility column).')
  RETURNING id INTO z_tc;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_hoskote, 'Hoskote', 'Hoskote LPA MP 2031', 'HOS-OS', 'Parks & Open Spaces (Hoskote)',
     ARRAY['Parks/playgrounds','Cemeteries/crematoria','Recreational (non-commercial)'],
     27, 'Hoskote MP 2031 Zoning Regs §10 (6)', 0.900, 'approved', NULL,
     'Recreational / essentially non-developable. No FAR matrix — a parcel zoned here is not developable for buildings.')
  RETURNING id INTO z_os;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_hoskote, 'Hoskote', 'Hoskote LPA MP 2031', 'HOS-AG', 'Agricultural Use (Hoskote)',
     ARRAY['Agriculture/horticulture/farming','Farm houses (per rural norms)','Dairy/poultry/pisciculture'],
     30, 'Hoskote MP 2031 Zoning Regs §10 (8)', 0.900, 'approved', NULL,
     'DEAL-KILLER for urban development: agricultural land. No general agriculture FAR table — do NOT assume a developable FAR. DC conversion (alienation) required before any urban development.')
  RETURNING id INTO z_ag;

  -- ── 3. FAR rules ───────────────────────────────────────────────────────
  -- HOS-R Residential — Table 4 (road-width-driven, plot < 1 ha)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status)
  VALUES
    (NULL, v_src, p_hoskote, z_r, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-R', 'residential', 0, 10000,  0,  9, 1.50, 1.50, NULL, false, 37, 'Hoskote Table 4 (Residential)', 'Road up to 9m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_r, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-R', 'residential', 0, 10000,  9, 12, 1.75, 1.75, NULL, false, 37, 'Hoskote Table 4 (Residential)', 'Road over 9 to 12m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_r, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-R', 'residential', 0, 10000, 12, 18, 2.00, 2.00, NULL, false, 37, 'Hoskote Table 4 (Residential)', 'Road over 12 to 18m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_r, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-R', 'residential', 0, 10000, 18, 24, 2.25, 2.25, NULL, false, 37, 'Hoskote Table 4 (Residential)', 'Road over 18 to 24m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_r, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-R', 'residential', 0, 10000, 24, NULL, 2.50, 2.50, NULL, false, 37, 'Hoskote Table 4 (Residential)', 'Road over 24m', 0.900, 'approved');

  -- HOS-R Group Housing — Table 5 (road-width-driven, plot >= 1 ha)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status)
  VALUES
    (NULL, v_src, p_hoskote, z_r, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-R', 'residential_group_housing', 10000, NULL,  0, 12, 2.00, 2.00, 60.00, false, 38, 'Hoskote Table 5 (Group Housing)', 'Plot >= 1 ha; road 12m (min 12m approach road required)', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_r, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-R', 'residential_group_housing', 10000, NULL, 12, 18, 2.25, 2.25, 55.00, false, 38, 'Hoskote Table 5 (Group Housing)', 'Plot >= 1 ha; road over 12 to 18m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_r, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-R', 'residential_group_housing', 10000, NULL, 18, 24, 2.50, 2.50, 55.00, false, 38, 'Hoskote Table 5 (Group Housing)', 'Plot >= 1 ha; road over 18 to 24m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_r, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-R', 'residential_group_housing', 10000, NULL, 24, NULL, 2.75, 2.75, 50.00, false, 38, 'Hoskote Table 5 (Group Housing)', 'Plot >= 1 ha; road over 24m', 0.900, 'approved');

  -- HOS-C Commercial — Table 4 (Commercial column)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status)
  VALUES
    (NULL, v_src, p_hoskote, z_c, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-C', 'commercial', 0, NULL,  0,  9, 1.50, 1.50, NULL, false, 37, 'Hoskote Table 4 (Commercial)', 'Road up to 9m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_c, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-C', 'commercial', 0, NULL,  9, 12, 1.75, 1.75, NULL, false, 37, 'Hoskote Table 4 (Commercial)', 'Road over 9 to 12m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_c, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-C', 'commercial', 0, NULL, 12, 18, 2.00, 2.00, NULL, false, 37, 'Hoskote Table 4 (Commercial)', 'Road over 12 to 18m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_c, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-C', 'commercial', 0, NULL, 18, 24, 2.25, 2.25, NULL, false, 37, 'Hoskote Table 4 (Commercial)', 'Road over 18 to 24m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_c, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-C', 'commercial', 0, NULL, 24, NULL, 2.50, 2.50, NULL, false, 37, 'Hoskote Table 4 (Commercial)', 'Road over 24m', 0.900, 'approved');

  -- HOS-PSP / HOS-PU / HOS-TC — Table 4 (shared Public&Semi-public·T&T·Public-Utility column)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status)
  VALUES
    (NULL, v_src, p_hoskote, z_psp, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-PSP', 'public_semi_public', 0, NULL,  0,  9, 1.25, 1.25, NULL, false, 37, 'Hoskote Table 4 (Public & Semi-public)', 'Road up to 9m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_psp, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-PSP', 'public_semi_public', 0, NULL,  9, 12, 1.50, 1.50, NULL, false, 37, 'Hoskote Table 4 (Public & Semi-public)', 'Road over 9 to 12m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_psp, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-PSP', 'public_semi_public', 0, NULL, 12, 18, 1.75, 1.75, NULL, false, 37, 'Hoskote Table 4 (Public & Semi-public)', 'Road over 12 to 18m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_psp, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-PSP', 'public_semi_public', 0, NULL, 18, 24, 1.75, 1.75, NULL, false, 37, 'Hoskote Table 4 (Public & Semi-public)', 'Road over 18 to 24m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_psp, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-PSP', 'public_semi_public', 0, NULL, 24, NULL, 2.00, 2.00, NULL, false, 37, 'Hoskote Table 4 (Public & Semi-public)', 'Road over 24m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_pu, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-PU', 'public_utility', 0, NULL,  0,  9, 1.25, 1.25, NULL, false, 37, 'Hoskote Table 4 (Public Utility)', 'Road up to 9m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_pu, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-PU', 'public_utility', 0, NULL,  9, 12, 1.50, 1.50, NULL, false, 37, 'Hoskote Table 4 (Public Utility)', 'Road over 9 to 12m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_pu, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-PU', 'public_utility', 0, NULL, 12, 18, 1.75, 1.75, NULL, false, 37, 'Hoskote Table 4 (Public Utility)', 'Road over 12 to 18m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_pu, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-PU', 'public_utility', 0, NULL, 18, 24, 1.75, 1.75, NULL, false, 37, 'Hoskote Table 4 (Public Utility)', 'Road over 18 to 24m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_pu, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-PU', 'public_utility', 0, NULL, 24, NULL, 2.00, 2.00, NULL, false, 37, 'Hoskote Table 4 (Public Utility)', 'Road over 24m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_tc, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-TC', 'transport_communication', 0, NULL,  0,  9, 1.25, 1.25, NULL, false, 37, 'Hoskote Table 4 (Transportation & Communication)', 'Road up to 9m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_tc, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-TC', 'transport_communication', 0, NULL,  9, 12, 1.50, 1.50, NULL, false, 37, 'Hoskote Table 4 (Transportation & Communication)', 'Road over 9 to 12m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_tc, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-TC', 'transport_communication', 0, NULL, 12, 18, 1.75, 1.75, NULL, false, 37, 'Hoskote Table 4 (Transportation & Communication)', 'Road over 12 to 18m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_tc, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-TC', 'transport_communication', 0, NULL, 18, 24, 1.75, 1.75, NULL, false, 37, 'Hoskote Table 4 (Transportation & Communication)', 'Road over 18 to 24m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_tc, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-TC', 'transport_communication', 0, NULL, 24, NULL, 2.00, 2.00, NULL, false, 37, 'Hoskote Table 4 (Transportation & Communication)', 'Road over 24m', 0.900, 'approved');

  -- HOS-I Industrial — Table 10 (FAR plot-area-driven; road = min frontage in notes)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status)
  VALUES
    (NULL, v_src, p_hoskote, z_i, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-I', 'industrial',    0,   230, 0, NULL, 1.00, 1.00, 80.00, false, 42, 'Hoskote Table 10 (Industrial)', 'Plot up to 230 sqm; min road up to 6m, front setback 1.0m, other sides 1.0m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_i, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-I', 'industrial',  230,  1000, 0, NULL, 1.25, 1.25, 60.00, false, 42, 'Hoskote Table 10 (Industrial)', 'Plot 230-1000 sqm; min road over 6m, front 4.5m, other 3.0m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_i, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-I', 'industrial', 1000,  2000, 0, NULL, 1.25, 1.25, 50.00, false, 42, 'Hoskote Table 10 (Industrial)', 'Plot 1000-2000 sqm; min road over 9m, front 6.0m, other 5.0m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_i, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-I', 'industrial', 2000,  4000, 0, NULL, 1.25, 1.25, 45.00, false, 42, 'Hoskote Table 10 (Industrial)', 'Plot 2000-4000 sqm; min road over 12m, front 8.0m, other 5.0m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_i, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-I', 'industrial', 4000,  8000, 0, NULL, 1.00, 1.00, 45.00, false, 42, 'Hoskote Table 10 (Industrial)', 'Plot 4000-8000 sqm; min road over 15m, front 8.0m, other 6.0m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_i, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-I', 'industrial', 8000,  NULL, 0, NULL, 1.00, 1.00, 45.00, false, 42, 'Hoskote Table 10 (Industrial)', 'Plot above 8000 sqm; min road over 15m, front 15.0m, other 12.0m', 0.900, 'approved');

  -- HOS-IT Industrial IT/BT — Table 11 (FAR plot-area-driven; road requirement in notes)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status)
  VALUES
    (NULL, v_src, p_hoskote, z_it, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-IT', 'industrial_it_bt',    0, 1000, 0, NULL, 1.50, 1.50, 55.00, false, 43, 'Hoskote Table 11 (IT/BT)', 'Plot up to 1000 sqm; road above 9 to 12m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_it, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-IT', 'industrial_it_bt', 1000, 2000, 0, NULL, 1.75, 1.75, 50.00, false, 43, 'Hoskote Table 11 (IT/BT)', 'Plot 1000-2000 sqm; road above 12 to 18m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_it, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-IT', 'industrial_it_bt', 2000, 4000, 0, NULL, 2.00, 2.00, 50.00, false, 43, 'Hoskote Table 11 (IT/BT)', 'Plot 2000-4000 sqm; road above 18 to 24m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_it, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-IT', 'industrial_it_bt', 4000, 6000, 0, NULL, 2.25, 2.25, 45.00, false, 43, 'Hoskote Table 11 (IT/BT)', 'Plot 4000-6000 sqm; road above 24 to 30m', 0.900, 'approved'),
    (NULL, v_src, p_hoskote, z_it, 'Hoskote', 'Hoskote LPA MP 2031', 'operative', 'HOS-IT', 'industrial_it_bt', 6000, NULL, 0, NULL, 2.50, 2.50, 45.00, false, 43, 'Hoskote Table 11 (IT/BT)', 'Plot above 6000 sqm; road above 30m', 0.900, 'approved');

  GET DIAGNOSTICS v_far = ROW_COUNT;

  -- ── 4. Cross-cutting facts (setbacks, flatted factories, group housing) ──
  INSERT INTO regulatory_data.evidence_facts
    (org_id, source_id, fact_type, fact_key, fact_value, source_section, page_number, confidence_score, review_status)
  VALUES
    (NULL, v_src, 'setback', 'hoskote_setbacks_high_rise',
     '{"applies":"buildings exceeding 10.0m height","basis":"uniform all-sides by height (Table 3)","ladder_m":[{"height_up_to_m":12,"setback_m":4.5},{"height_up_to_m":15,"setback_m":5.0},{"height_up_to_m":18,"setback_m":6.0},{"height_up_to_m":21,"setback_m":7.0},{"height_up_to_m":24,"setback_m":8.0},{"height_up_to_m":27,"setback_m":9.0},{"height_up_to_m":30,"setback_m":10.0},{"height_up_to_m":35,"setback_m":11.0},{"height_up_to_m":40,"setback_m":12.0},{"height_up_to_m":45,"setback_m":13.0},{"height_up_to_m":50,"setback_m":14.0},{"height_above_m":50,"setback_m":16.0}]}'::jsonb,
     'Hoskote MP 2031 Table 3', 37, 0.900, 'approved'),
    (NULL, v_src, 'setback', 'hoskote_setbacks_reference',
     '{"applies":"low-rise (<=10m, Table 2) + IT/BT (Table 12)","note":"Low-rise setbacks (Table 2, p.36) and IT/BT setbacks (Table 12, p.43) are prescribed but NOT transcribed here — buildability handles setbacks separately; per-rule setback columns are NULL except the Industrial Table-10 setbacks captured in rule_notes. Transcribe Tables 2 & 12 before quoting exact low-rise/IT setbacks in IC."}'::jsonb,
     'Hoskote MP 2031 Tables 2 & 12', 36, 0.850, 'approved'),
    (NULL, v_src, 'far', 'hoskote_flatted_factories',
     '{"use":"Flatted factories (Table 9)","min_plot_sqm":1000,"max_coverage_pct":40,"far":{"road_up_to_12m":1.50,"road_above_12m":1.75},"setbacks_m":{"front":8.0,"rear":4.5,"sides":4.5}}'::jsonb,
     'Hoskote MP 2031 §10.11 Table 9', 42, 0.900, 'approved'),
    (NULL, v_src, 'far', 'hoskote_group_housing_norms',
     '{"min_approach_road_m":12,"min_area_ha":1.0,"civic_reservation_pct":15,"civic_breakup":"min 10% parks & open spaces + 5% civic amenity","far_basis":"width of the public road abutting the property, on net plot area after deducting civic-amenity reservation"}'::jsonb,
     'Hoskote MP 2031 §10.7', 38, 0.900, 'approved'),
    (NULL, v_src, 'far', 'hoskote_far_exclusions',
     '{"excluded_from_far":["effluent treatment plant","open-to-sky swimming pool","car parking"],"source":"Table 4 note"}'::jsonb,
     'Hoskote MP 2031 Table 4 (note)', 37, 0.900, 'approved'),
    (NULL, v_src, 'regulatory', 'hoskote_plan_status_provisional',
     '{"status":"provisional","note":"Source document is titled Master Plan (PROVISIONAL) for Hoskote LPA 2031. A Karnataka provisional master plan is the operative framework used to sanction development pending final approval. Verify the final-approval / notification status with the Hoskote Planning Authority / BMRDA before relying on it for IC.","deal_action":"Verify final-approval status per deal."}'::jsonb,
     'Hoskote MP 2031 (cover)', 1, 0.900, 'approved');

  RAISE NOTICE 'Hoskote LPA MP 2031 seeded: 1 source, 9 zones, % far_rules, 6 facts. Plan linked to evidence source.', v_far;
END $$;
