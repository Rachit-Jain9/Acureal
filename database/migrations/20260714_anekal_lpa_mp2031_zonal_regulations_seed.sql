-- ============================================================================
-- 20260714_anekal_lpa_mp2031_zonal_regulations_seed.sql
-- ----------------------------------------------------------------------------
-- Workstream 3 — seed the OPERATIVE Anekal rulebook so the jurisdiction resolver
-- (Workstream 0) routes Anekal/Jigani parcels to REAL FAR numbers instead of the
-- honest "rulebook not loaded yet" placeholder.
--
-- SOURCE (operator-supplied primary PDF, verbatim transcription):
--   "Master Plan for Anekal Local Planning Area 2031 — ZONING REGULATIONS",
--   approved by Govt. of Karnataka vide G.O. No. UDD 151 BMR 2013 dated
--   03.09.2014 as part of the Master Plan 2031. Bangalore Metropolitan Region
--   Development Authority (BMRDA) / Anekal Planning Authority. Chapter 11/12.
--
-- WHAT IT SEEDS (tagged statutory_plan_id = the existing ANEKAL_LPA_MP_2031 plan
-- from migration 20260712; looked up by plan_code, never hardcoded):
--   - 1 evidence_source + 1 master_plan_document; links the Anekal plan row to
--     the evidence source.
--   - 10 master_plan_zones (the 9 use-zones + the IT/BT industrial sub-zone).
--   - 41 far_rules transcribed VERBATIM from:
--       Table 4  (Max FAR & Road Widths, p.172) — Residential / Commercial /
--                Public&Semi-public·Traffic&Transport·Public-Utility columns;
--       Table 6  (Group Housing, p.173) — plot >= 1 ha;
--       Table 10 (Industrial buildings, p.176) — by plot area;
--       Table 10A (IT/BT in Industrial Zone, p.176) — by plot area;
--       Agriculture (11.2.8, p.167) — FAR 1.0 / 15% coverage / min 1.2 ha / G+1.
--   - evidence_facts: setback Table 2 (<=10 m) + Table 3 (>10 m), Additional FAR
--     (TOD +0.5), Agriculture & Gramathana norms, SWM buffer (deal-killer overlay).
--
-- ENCODING CONVENTIONS (identical to the RMP-2015 seed 20260701):
--   - road_width_min inclusive, road_width_max exclusive; the regulation's
--     "up to X" / "over X" inclusive bands are encoded with max = the next band's
--     lower bound (a width exactly on the boundary resolves to the higher band;
--     practical impact nil, re-verify on site).
--   - Residential/Commercial/PSP/PU/T&T FAR is ROAD-WIDTH-driven (Table 4) — plot
--     band spans the whole range. Industrial & IT/BT FAR is PLOT-AREA-driven
--     (Tables 10/10A) — road is a min-frontage requirement captured in rule_notes,
--     NOT a FAR band (so selectFarRule resolves exactly one row per plot size).
--   - Per-rule setback columns left NULL (consistent with the RMP-2015 seed;
--     buildability handles setbacks separately) — the full Anekal setback Tables
--     2 & 3 are recorded as evidence_facts for reference + later wiring.
--   - Premium / Additional FAR (TOD +0.5) is a SEPARATE lever stored as a fact,
--     never summed into base FAR.
--
-- Every row carries source page + section + confidence + the Anekal evidence
-- link, review_status='approved' (verbatim transcription, adversarially verified).
-- Idempotent: guarded on the evidence_sources.source_title. Safe to re-run.
-- Rollback: delete the Anekal evidence_source (far_rules/zones cascade via the
-- evidence/zone links) — no other data touched.
-- ============================================================================

DO $$
DECLARE
  v_src   UUID;
  v_doc   UUID;
  p_anekal UUID;
  z_r   UUID; z_c   UUID; z_i   UUID; z_it  UUID; z_psp UUID;
  z_pu  UUID; z_os  UUID; z_tc  UUID; z_ag  UUID; z_sc  UUID;
  v_far INT := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM regulatory_data.evidence_sources
    WHERE source_title = 'Anekal LPA Master Plan 2031 — Chapter 11/12: Zoning Regulations'
      AND org_id IS NULL
  ) THEN
    RAISE NOTICE 'Anekal Zoning Regulations already seeded — skipping.';
    RETURN;
  END IF;

  -- The operative Anekal plan must exist (seeded by migration 20260712).
  SELECT id INTO p_anekal
    FROM regulatory_data.statutory_plans
   WHERE plan_code = 'ANEKAL_LPA_MP_2031' AND org_id IS NULL
   LIMIT 1;
  IF p_anekal IS NULL THEN
    RAISE EXCEPTION 'ANEKAL_LPA_MP_2031 statutory plan not found — apply 20260712 first.';
  END IF;

  -- ── 1. Evidence source + document ──────────────────────────────────────
  INSERT INTO regulatory_data.evidence_sources
    (org_id, source_kind, authority_name, source_title, source_url, city,
     plan_version, effective_from, extraction_status, review_status, confidence_score, notes)
  VALUES
    (NULL, 'official_pdf', 'Bangalore Metropolitan Region Development Authority (Anekal Planning Authority)',
     'Anekal LPA Master Plan 2031 — Chapter 11/12: Zoning Regulations',
     NULL, 'Anekal', 'Anekal LPA MP 2031', DATE '2014-09-03',
     'completed', 'approved', 1.000,
     'Operative zoning rulebook for the Anekal Local Planning Area under BMRDA. Approved by Govt. of Karnataka vide G.O. No. UDD 151 BMR 2013 dated 03-09-2014 as part of the Master Plan 2031. Operator-supplied primary PDF; FAR/coverage transcribed verbatim from Tables 4, 6, 10, 10A and §11.2.8.')
  RETURNING id INTO v_src;

  INSERT INTO regulatory_data.master_plan_documents
    (org_id, city, plan_name, plan_version, doc_type, extraction_status, evidence_source_id, extracted_at)
  VALUES
    (NULL, 'Anekal', 'Anekal LPA Master Plan 2031 — Zoning Regulations', 'Anekal LPA MP 2031',
     'rmp_table', 'completed', v_src, now())
  RETURNING id INTO v_doc;

  -- Link the plan row to its now-uploaded evidence source.
  UPDATE regulatory_data.statutory_plans
     SET evidence_source_id = v_src,
         notes = 'Operative master plan for the Anekal LPA under BMRDA. Zonal regulations / FAR tables ingested (migration 20260714).',
         updated_at = now()
   WHERE id = p_anekal;

  -- ── 2. Use-zones (11.2 — nine use-zones + IT/BT sub-zone) ───────────────
  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_anekal, 'Anekal', 'Anekal LPA MP 2031', 'AN-R', 'Residential (Anekal)',
     1.50, 2.75,
     '[{"road_width_m":0,"fsi":1.50},{"road_width_m":9,"fsi":1.75},{"road_width_m":12,"fsi":2.00},{"road_width_m":18,"fsi":2.25},{"road_width_m":24,"fsi":2.50}]'::jsonb,
     NULL, ARRAY['Dwelling units/plotted residential','Apartments/group housing','Hostels/old age homes/Dharmashala','Schools/creche','Public utilities (special)'],
     172, 'Anekal MP 2031 Zoning Regs §11.2.1 + Table 4', 1.00, 'approved', DATE '2014-09-03',
     'FAR road-width-driven (Table 4). Plots >= 1 ha (10000 sqm) are treated as group housing — higher FAR/coverage per Table 6.')
  RETURNING id INTO z_r;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_anekal, 'Anekal', 'Anekal LPA MP 2031', 'AN-C', 'Commercial (Anekal)',
     1.50, 2.50,
     '[{"road_width_m":0,"fsi":1.50},{"road_width_m":9,"fsi":1.75},{"road_width_m":12,"fsi":2.00},{"road_width_m":18,"fsi":2.25},{"road_width_m":24,"fsi":2.50}]'::jsonb,
     NULL, ARRAY['Retail/shops/commercial complexes','Offices/business','Hotels/restaurants','Cinemas/multiplexes/kalyana mantapa','Service industries (Schedule-I, <=10HP)'],
     172, 'Anekal MP 2031 Zoning Regs §11.2.2 + Table 4', 1.00, 'approved', DATE '2014-09-03',
     'FAR road-width-driven (Table 4, Commercial column).')
  RETURNING id INTO z_c;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_anekal, 'Anekal', 'Anekal LPA MP 2031', 'AN-I', 'Industrial (Anekal)',
     1.00, 1.25,
     '[{"road_width_m":9,"fsi":1.00,"max_ground_coverage_pct":80},{"road_width_m":12,"fsi":1.25,"max_ground_coverage_pct":50}]'::jsonb,
     NULL, ARRAY['Light/medium/heavy industries (Schedule-I)','IT/BT industries','Warehouses/storage','Truck terminals','Manager/staff dwellings (<=1000 sqm or 10%)'],
     176, 'Anekal MP 2031 Zoning Regs §11.2.3 + Table 10', 1.00, 'approved', DATE '2014-09-03',
     'FAR plot-area-driven (Table 10). Obnoxious/hazardous industries excluded (special clearance). IT/BT uses the AN-IT sub-zone (Table 10A).')
  RETURNING id INTO z_i;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_anekal, 'Anekal', 'Anekal LPA MP 2031', 'AN-IT', 'Industrial — IT/BT (Anekal)',
     1.50, 2.50,
     '[{"road_width_m":9,"fsi":1.50,"max_ground_coverage_pct":55},{"road_width_m":12,"fsi":1.75,"max_ground_coverage_pct":50},{"road_width_m":18,"fsi":2.00,"max_ground_coverage_pct":50},{"road_width_m":24,"fsi":2.25,"max_ground_coverage_pct":45},{"road_width_m":30,"fsi":2.50,"max_ground_coverage_pct":45}]'::jsonb,
     NULL, ARRAY['IT/ITES parks','BT/R&D/BPO','Software/hardware offices'],
     176, 'Anekal MP 2031 Zoning Regs Table 10A', 1.00, 'approved', DATE '2014-09-03',
     'IT/BT activities within the Industrial zone — FAR plot-area-driven (Table 10A). Higher FAR than general industry.')
  RETURNING id INTO z_it;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_anekal, 'Anekal', 'Anekal LPA MP 2031', 'AN-PSP', 'Public & Semi-Public (Anekal)',
     1.25, 2.00,
     '[{"road_width_m":0,"fsi":1.25},{"road_width_m":9,"fsi":1.50},{"road_width_m":12,"fsi":1.75},{"road_width_m":18,"fsi":1.75},{"road_width_m":24,"fsi":2.00}]'::jsonb,
     NULL, ARRAY['Government/institutional buildings','Hospitals/educational','Community/civic amenities'],
     172, 'Anekal MP 2031 Zoning Regs §11.2.4 + Table 4', 1.00, 'approved', DATE '2014-09-03',
     'FAR road-width-driven (Table 4, Public&Semi-public·Traffic&Transport·Public-Utility column).')
  RETURNING id INTO z_psp;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_anekal, 'Anekal', 'Anekal LPA MP 2031', 'AN-PU', 'Public Utilities (Anekal)',
     1.25, 2.00,
     '[{"road_width_m":0,"fsi":1.25},{"road_width_m":9,"fsi":1.50},{"road_width_m":12,"fsi":1.75},{"road_width_m":18,"fsi":1.75},{"road_width_m":24,"fsi":2.00}]'::jsonb,
     NULL, ARRAY['Water/sewage/power utilities','Telecom/electrical infrastructure','Solid-waste/treatment facilities'],
     172, 'Anekal MP 2031 Zoning Regs §11.2.5 + Table 4', 1.00, 'approved', DATE '2014-09-03',
     'FAR road-width-driven (Table 4, shared Public&Semi-public·Traffic&Transport·Public-Utility column).')
  RETURNING id INTO z_pu;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_anekal, 'Anekal', 'Anekal LPA MP 2031', 'AN-TC', 'Transport & Communication (Anekal)',
     1.25, 2.00,
     '[{"road_width_m":0,"fsi":1.25},{"road_width_m":9,"fsi":1.50},{"road_width_m":12,"fsi":1.75},{"road_width_m":18,"fsi":1.75},{"road_width_m":24,"fsi":2.00}]'::jsonb,
     NULL, ARRAY['Railway/bus/truck terminals','TTMC/metro/MRTS stations','Logistics/cargo/depots','Filling/service stations'],
     172, 'Anekal MP 2031 Zoning Regs §11.2.7 + Table 4', 1.00, 'approved', DATE '2014-09-03',
     'FAR road-width-driven (Table 4 shared column). Ancillary commercial/office in transit hubs capped at 25% of developable area (50% for transit interchange terminals).')
  RETURNING id INTO z_tc;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_anekal, 'Anekal', 'Anekal LPA MP 2031', 'AN-AG', 'Agricultural Use (Anekal)',
     1.00, 1.00, 15.00,
     ARRAY['Agriculture/horticulture','Farm houses (<=250 sqm plinth, G+1)','Dairy/poultry/pisciculture','Eco-tourism (special)'],
     167, 'Anekal MP 2031 Zoning Regs §11.2.8', 1.00, 'approved', DATE '2014-09-03',
     'DEAL-KILLER for urban development: agricultural land. Built use restricted to farm houses <=250 sqm plinth, G+1, min plot 1.2 ha, ground coverage <= 15%. Conversion (DC/alienation) required before any urban development.')
  RETURNING id INTO z_ag;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_anekal, 'Anekal', 'Anekal LPA MP 2031', 'AN-OS', 'Open Spaces, Parks & Playgrounds (Anekal)',
     ARRAY['Parks/playgrounds/stadiums','Cemeteries/crematoria','Recreational (non-commercial)'],
     165, 'Anekal MP 2031 Zoning Regs §11.2.6', 1.00, 'approved', DATE '2014-09-03',
     'Recreational / essentially non-developable. Ancillary built-up to park/open-space use only (strictly limited). No FAR matrix — a parcel zoned here is not developable for buildings.')
  RETURNING id INTO z_os;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_anekal, 'Anekal', 'Anekal LPA MP 2031', 'AN-SC', 'Areas of Special Control (Anekal)',
     ARRAY['Solid-waste management buffer','Other special-control areas'],
     168, 'Anekal MP 2031 Zoning Regs §11.2.9', 1.00, 'approved', DATE '2014-09-03',
     'Overlay/restriction, not a development zone. SWM site: 50 m buffer = NO development; 50-200 m = sensitive (restricted). Verify proximity before reliance.')
  RETURNING id INTO z_sc;

  -- ── 3. FAR rules ───────────────────────────────────────────────────────
  -- AN-R Residential — Table 4 (plotted/apartment, plot < 1 ha)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, p_anekal, z_r, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-R', 'residential',     0, 10000,  0,  9, 1.50, 1.50, NULL, false, 172, 'Anekal Table 4 (Residential)', 'Road up to 9m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_r, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-R', 'residential',     0, 10000,  9, 12, 1.75, 1.75, NULL, false, 172, 'Anekal Table 4 (Residential)', 'Road over 9 to 12m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_r, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-R', 'residential',     0, 10000, 12, 18, 2.00, 2.00, NULL, false, 172, 'Anekal Table 4 (Residential)', 'Road over 12 to 18m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_r, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-R', 'residential',     0, 10000, 18, 24, 2.25, 2.25, NULL, false, 172, 'Anekal Table 4 (Residential)', 'Road over 18 to 24m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_r, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-R', 'residential',     0, 10000, 24, NULL, 2.50, 2.50, NULL, false, 172, 'Anekal Table 4 (Residential)', 'Road over 24m', 1.000, 'approved', DATE '2014-09-03');

  -- AN-R Residential — Table 6 (group housing, plot >= 1 ha)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, p_anekal, z_r, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-R', 'residential_group_housing', 10000, NULL,  0, 12, 2.00, 2.00, 60.00, false, 173, 'Anekal Table 6 (Group Housing)', 'Plot >= 1 ha; road up to 12m (min 12m approach road required)', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_r, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-R', 'residential_group_housing', 10000, NULL, 12, 18, 2.25, 2.25, 55.00, false, 173, 'Anekal Table 6 (Group Housing)', 'Plot >= 1 ha; road over 12 to 18m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_r, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-R', 'residential_group_housing', 10000, NULL, 18, 24, 2.50, 2.50, 55.00, false, 173, 'Anekal Table 6 (Group Housing)', 'Plot >= 1 ha; road over 18 to 24m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_r, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-R', 'residential_group_housing', 10000, NULL, 24, NULL, 2.75, 2.75, 50.00, false, 173, 'Anekal Table 6 (Group Housing)', 'Plot >= 1 ha; road over 24m', 1.000, 'approved', DATE '2014-09-03');

  -- AN-C Commercial — Table 4 (Commercial column)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, p_anekal, z_c, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-C', 'commercial', 0, NULL,  0,  9, 1.50, 1.50, NULL, false, 172, 'Anekal Table 4 (Commercial)', 'Road up to 9m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_c, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-C', 'commercial', 0, NULL,  9, 12, 1.75, 1.75, NULL, false, 172, 'Anekal Table 4 (Commercial)', 'Road over 9 to 12m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_c, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-C', 'commercial', 0, NULL, 12, 18, 2.00, 2.00, NULL, false, 172, 'Anekal Table 4 (Commercial)', 'Road over 12 to 18m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_c, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-C', 'commercial', 0, NULL, 18, 24, 2.25, 2.25, NULL, false, 172, 'Anekal Table 4 (Commercial)', 'Road over 18 to 24m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_c, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-C', 'commercial', 0, NULL, 24, NULL, 2.50, 2.50, NULL, false, 172, 'Anekal Table 4 (Commercial)', 'Road over 24m', 1.000, 'approved', DATE '2014-09-03');

  -- AN-PSP / AN-PU / AN-TC — Table 4 (shared Public&Semi-public·Traffic&Transport·Public-Utility column)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, p_anekal, z_psp, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-PSP', 'public_semi_public', 0, NULL,  0,  9, 1.25, 1.25, NULL, false, 172, 'Anekal Table 4 (Public & Semi-public)', 'Road up to 9m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_psp, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-PSP', 'public_semi_public', 0, NULL,  9, 12, 1.50, 1.50, NULL, false, 172, 'Anekal Table 4 (Public & Semi-public)', 'Road over 9 to 12m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_psp, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-PSP', 'public_semi_public', 0, NULL, 12, 18, 1.75, 1.75, NULL, false, 172, 'Anekal Table 4 (Public & Semi-public)', 'Road over 12 to 18m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_psp, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-PSP', 'public_semi_public', 0, NULL, 18, 24, 1.75, 1.75, NULL, false, 172, 'Anekal Table 4 (Public & Semi-public)', 'Road over 18 to 24m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_psp, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-PSP', 'public_semi_public', 0, NULL, 24, NULL, 2.00, 2.00, NULL, false, 172, 'Anekal Table 4 (Public & Semi-public)', 'Road over 24m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_pu, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-PU', 'public_utility', 0, NULL,  0,  9, 1.25, 1.25, NULL, false, 172, 'Anekal Table 4 (Public Utility)', 'Road up to 9m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_pu, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-PU', 'public_utility', 0, NULL,  9, 12, 1.50, 1.50, NULL, false, 172, 'Anekal Table 4 (Public Utility)', 'Road over 9 to 12m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_pu, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-PU', 'public_utility', 0, NULL, 12, 18, 1.75, 1.75, NULL, false, 172, 'Anekal Table 4 (Public Utility)', 'Road over 12 to 18m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_pu, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-PU', 'public_utility', 0, NULL, 18, 24, 1.75, 1.75, NULL, false, 172, 'Anekal Table 4 (Public Utility)', 'Road over 18 to 24m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_pu, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-PU', 'public_utility', 0, NULL, 24, NULL, 2.00, 2.00, NULL, false, 172, 'Anekal Table 4 (Public Utility)', 'Road over 24m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_tc, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-TC', 'transport_communication', 0, NULL,  0,  9, 1.25, 1.25, NULL, false, 172, 'Anekal Table 4 (Traffic & Transportation)', 'Road up to 9m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_tc, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-TC', 'transport_communication', 0, NULL,  9, 12, 1.50, 1.50, NULL, false, 172, 'Anekal Table 4 (Traffic & Transportation)', 'Road over 9 to 12m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_tc, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-TC', 'transport_communication', 0, NULL, 12, 18, 1.75, 1.75, NULL, false, 172, 'Anekal Table 4 (Traffic & Transportation)', 'Road over 12 to 18m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_tc, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-TC', 'transport_communication', 0, NULL, 18, 24, 1.75, 1.75, NULL, false, 172, 'Anekal Table 4 (Traffic & Transportation)', 'Road over 18 to 24m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_tc, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-TC', 'transport_communication', 0, NULL, 24, NULL, 2.00, 2.00, NULL, false, 172, 'Anekal Table 4 (Traffic & Transportation)', 'Road over 24m', 1.000, 'approved', DATE '2014-09-03');

  -- AN-I Industrial — Table 10 (FAR plot-area-driven; road = min frontage requirement in notes)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, p_anekal, z_i, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-I', 'industrial',    0,   230, 0, NULL, 1.00, 1.00, 80.00, false, 176, 'Anekal Table 10 (Industrial)', 'Plot up to 230 sqm; min road 9m, frontage 9m, front setback 1.0m, other sides 1.0m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_i, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-I', 'industrial',  230,  1000, 0, NULL, 1.25, 1.25, 60.00, false, 176, 'Anekal Table 10 (Industrial)', 'Plot 231-1000 sqm; min road 9m, frontage 12m, front 4.5m, other 3.0m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_i, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-I', 'industrial', 1000,  2000, 0, NULL, 1.25, 1.25, 50.00, false, 176, 'Anekal Table 10 (Industrial)', 'Plot 1000-2000 sqm; min road over 12m, frontage 24m, front 6.0m, other 5.0m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_i, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-I', 'industrial', 2000,  4000, 0, NULL, 1.25, 1.25, 40.00, false, 176, 'Anekal Table 10 (Industrial)', 'Plot 2001-4000 sqm; min road over 12m, frontage 28m, front 8.0m, other 5.0m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_i, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-I', 'industrial', 4000,  8000, 0, NULL, 1.00, 1.00, 35.00, false, 176, 'Anekal Table 10 (Industrial)', 'Plot 4001-8000 sqm; min road over 15m, frontage 32m, front 8.0m, other 6.0m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_i, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-I', 'industrial', 8000,  NULL, 0, NULL, 1.00, 1.00, 30.00, false, 176, 'Anekal Table 10 (Industrial)', 'Plot above 8000 sqm; min road over 15m, frontage 42m, front 15.0m, other 12.0m', 1.000, 'approved', DATE '2014-09-03');

  -- AN-IT Industrial IT/BT — Table 10A (FAR plot-area-driven; road requirement in notes)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, p_anekal, z_it, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-IT', 'industrial_it_bt',    0, 1000, 0, NULL, 1.50, 1.50, 55.00, false, 176, 'Anekal Table 10A (IT/BT)', 'Plot up to 1000 sqm; road above 9 to 12m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_it, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-IT', 'industrial_it_bt', 1000, 2000, 0, NULL, 1.75, 1.75, 50.00, false, 176, 'Anekal Table 10A (IT/BT)', 'Plot 1000-2000 sqm; road above 12 to 18m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_it, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-IT', 'industrial_it_bt', 2000, 4000, 0, NULL, 2.00, 2.00, 50.00, false, 176, 'Anekal Table 10A (IT/BT)', 'Plot 2000-4000 sqm; road above 18 to 24m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_it, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-IT', 'industrial_it_bt', 4000, 6000, 0, NULL, 2.25, 2.25, 45.00, false, 176, 'Anekal Table 10A (IT/BT)', 'Plot 4000-6000 sqm; road above 24 to 30m', 1.000, 'approved', DATE '2014-09-03'),
    (NULL, v_src, p_anekal, z_it, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-IT', 'industrial_it_bt', 6000, NULL, 0, NULL, 2.50, 2.50, 45.00, false, 176, 'Anekal Table 10A (IT/BT)', 'Plot above 6000 sqm; road above 30m', 1.000, 'approved', DATE '2014-09-03');

  -- AN-AG Agriculture — FAR 1.0 / 15% coverage (deal-killer for urban development)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, p_anekal, z_ag, 'Anekal', 'Anekal LPA MP 2031', 'operative', 'AN-AG', 'agriculture', 12000, NULL, 0, NULL, 1.00, 1.00, 15.00, false, 167, 'Anekal §11.2.8 (Agriculture)', 'Min plot 1.2 ha. Built use restricted to farm houses <= 250 sqm plinth, G+1 only, ground coverage <= 15%. DC conversion required before urban development.', 1.000, 'approved', DATE '2014-09-03');

  GET DIAGNOSTICS v_far = ROW_COUNT;

  -- ── 4. Cross-cutting facts (setbacks, additional FAR, agriculture, SWM) ──
  INSERT INTO regulatory_data.evidence_facts
    (org_id, source_id, fact_type, fact_key, fact_value, source_section, page_number, confidence_score, review_status)
  VALUES
    (NULL, v_src, 'setback', 'anekal_setbacks_low_rise',
     '{"applies":"buildings up to 10.0m height","basis":"site depth (front/rear) and width (left/right), per use","note":"Dimension-based percentages/metres per Anekal Table 2. Plots 4000 sqm and above: minimum 5.0m setback on all sides. When a car garage is on the right-rear corner, min front setback 3.0m.","bands_m":{"depth_up_to_6":{"residential":{"front":1.00,"rear":0},"commercial":{"front":1.00,"rear":0},"psp_tt_pu":{"front":1.50,"rear":0}},"depth_6_9":{"residential":{"front":1.00,"rear":1.00},"commercial":{"front":1.50,"rear":0},"psp_tt_pu":{"front":1.50,"rear":1.50}},"depth_9_12":{"residential":{"front":1.00,"rear":1.00},"commercial":{"front":1.50,"rear":1.00},"psp_tt_pu":{"front":2.00,"rear":1.50}},"depth_12_18":{"residential":{"front":1.50,"rear":1.50},"commercial":{"front":2.50,"rear":1.50},"psp_tt_pu":{"front":2.50,"rear":1.50}},"depth_18_24":{"residential":{"front":2.50,"rear":2.00},"commercial":{"front":3.00,"rear":2.00},"psp_tt_pu":{"front":3.00,"rear":2.00}},"depth_over_24":{"residential":{"front":3.50,"rear":3.00},"commercial":{"front":3.50,"rear":2.50},"psp_tt_pu":{"front":4.00,"rear":3.00}}}}'::jsonb,
     'Anekal MP 2031 Table 2', 171, 1.000, 'approved'),
    (NULL, v_src, 'setback', 'anekal_setbacks_high_rise',
     '{"applies":"buildings exceeding 10.0m height","basis":"uniform all-sides by height (Anekal Table 3)","ladder_m":[{"height_up_to_m":12,"setback_m":4.5},{"height_up_to_m":15,"setback_m":5.0},{"height_up_to_m":18,"setback_m":6.0},{"height_up_to_m":21,"setback_m":7.0},{"height_up_to_m":24,"setback_m":8.0},{"height_up_to_m":27,"setback_m":9.0},{"height_up_to_m":30,"setback_m":10.0},{"height_up_to_m":35,"setback_m":11.0},{"height_up_to_m":40,"setback_m":12.0},{"height_up_to_m":45,"setback_m":13.0},{"height_up_to_m":50,"setback_m":14.0},{"height_above_m":50,"setback_m":16.0}]}'::jsonb,
     'Anekal MP 2031 Table 3', 172, 1.000, 'approved'),
    (NULL, v_src, 'far', 'anekal_additional_far_tod',
     '{"lever":"Transit-Oriented Development additional FAR","separate_from_base":true,"rules":[{"trigger":"use abutting a road with ROW >= 60m AND within 150m radius of a transit hub / major interchange (railway, BRT, metro)","additional_far":0.5},{"trigger":"within 150m radius of a Railway/Metro/MRTS station boundary","additional_far":0.5}],"conditions":"On payment of betterment levy at twice the prescribed rate; subject to statutory clearances (fire, airport, pollution). NEVER summed into base FAR — separate entitlement requiring verification."}'::jsonb,
     'Anekal MP 2031 §11.2.7 Note (TOD)', 166, 1.000, 'approved'),
    (NULL, v_src, 'far', 'anekal_gramathana_rural',
     '{"context":"Rural development within 250m of an existing gramathana (revenue village settlement); +50m per additional 1000 population over 1000 (2011 census)","far":1.0,"max_floors":"G+1","setbacks_coverage":"per respective use (Anekal Table no. 8)"}'::jsonb,
     'Anekal MP 2031 §11.2.8A', 168, 1.000, 'approved'),
    (NULL, v_src, 'environmental', 'anekal_swm_buffer',
     '{"overlay":"Solid Waste Management (SWM) site buffer","instrument":"G.O. No. Na A E 325 MNU 2007 dated 06-10-2007","buffer_no_build_m":50,"buffer_no_build_note":"Within 50m of an SWM site: NO development or construction (Buffer Zone). Setback + tree plantation only.","sensitive_zone_m":200,"sensitive_zone_note":"50-200m: Sensitive Zone — development may be permitted without affecting the SWM site.","deal_killer":true}'::jsonb,
     'Anekal MP 2031 §11.2.9A', 168, 1.000, 'approved');

  RAISE NOTICE 'Anekal LPA MP 2031 seeded: 1 source, 10 zones, % far_rules, 5 facts. Plan linked to evidence source.', v_far;
END $$;
