-- ============================================================================
-- 20260722_biaapa_mp2021_zonal_regulations_seed.sql
-- ----------------------------------------------------------------------------
-- Seed the OPERATIVE BIAAPA rulebook so the jurisdiction resolver routes
-- airport-belt / Devanahalli parcels to REAL FAR numbers instead of the honest
-- "rulebook not loaded yet" placeholder. Companion to the registry migration
-- 20260721 (which registered the BIAAPA authority + BIAAPA_MP_2021 plan).
--
-- SOURCE (primary PDF, verbatim transcription — every number cross-checked
-- against the rendered source page):
--   "BIAAPA — Zoning of Land Use and Regulations" (Master Plan 2021),
--   Bengaluru International Airport Area Planning Authority under BMRDA.
--   Master plan finally approved / gazette-notified 29-01-2009.
--   File: biaapa.tpa.gov.in/.../ZR-BIAAPA-2021.pdf (59 pp).
--
-- WHAT IT SEEDS (tagged statutory_plan_id = BIAAPA_MP_2021 from 20260721,
-- looked up by plan_code, never hardcoded):
--   - 1 evidence_source + 1 master_plan_document; links the plan to the source.
--   - 10 master_plan_zones (the 9 §9.2 use-zones + the Integrated-Township
--     special-development sub-zone).
--   - 37 far_rules transcribed VERBATIM from:
--       Table 3  (Max FAR & Road Widths, p.26) — Residential / Commercial /
--                Public&Semi-public·T&T·Public-Utility columns (road-width-driven);
--       Table 4  (Group Housing, p.27) — plot >= 1 ha (plot-area-driven);
--       Table 9  (Industrial buildings, p.31) — by plot area (plot-area-driven);
--       Table 10 (Integrated Township, p.33) — road-width-driven.
--   - evidence_facts: setback Tables 1 & 2 (reference, page-cited — NOT
--     transcribed, to avoid fabricating dimensions), Rural Development / gramathana
--     provision (FAR 1.0, G+1), Integrated-Township eligibility, Airport-Zone
--     overlay (height/use restricted), and the Table-3 FAR-exclusion note.
--
-- ENCODING CONVENTIONS (identical to the RMP-2015 seed 20260701 + Anekal 20260714):
--   - road_width_min inclusive, road_width_max exclusive; "Up to X" / "Over X"
--     bands encoded with max = the next band's lower bound.
--   - Residential/Commercial/PSP/PU/T&T FAR is ROAD-WIDTH-driven (Table 3) — plot
--     band spans the whole range. Group-Housing, Industrial & Integrated-Township
--     FAR is PLOT-AREA-driven (GH/Ind) or road-band-driven with distinct coverage
--     (Township); road min-frontage requirements captured in rule_notes so
--     selectFarRule resolves exactly one row per plot size.
--   - Per-rule setback columns left NULL for road-driven zones (buildability
--     handles setbacks separately); Industrial rows carry the Table-9 setbacks in
--     rule_notes. The full setback Tables 1 & 2 are recorded as reference facts.
--   - Agriculture is a deal-killer zone (conversion required) with NO fabricated
--     FAR band — the only agri-adjacent entitlement (Rural Development, FAR 1.0,
--     G+1 within 150 m of a gramathana) is stored as a fact, never a base FAR.
--
-- Every row carries source page + section + confidence + the BIAAPA evidence
-- link, review_status='approved' (verbatim transcription, adversarially verified).
-- Idempotent: guarded on evidence_sources.source_title. Safe to re-run.
-- Rollback: delete the BIAAPA evidence_source (far_rules/zones cascade via the
-- evidence/zone links) — no other data touched.
-- ============================================================================

DO $$
DECLARE
  v_src UUID;
  v_doc UUID;
  p_biaapa UUID;
  z_r  UUID; z_c  UUID; z_i  UUID; z_psp UUID; z_pu UUID;
  z_tc UUID; z_os UUID; z_az UUID; z_ag  UUID; z_it UUID;
  v_far INT := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM regulatory_data.evidence_sources
    WHERE source_title = 'BIAAPA Master Plan 2021 — Zoning of Land Use and Regulations'
      AND org_id IS NULL
  ) THEN
    RAISE NOTICE 'BIAAPA Zoning Regulations already seeded — skipping.';
    RETURN;
  END IF;

  -- The operative BIAAPA plan must exist (seeded by migration 20260721).
  SELECT id INTO p_biaapa
    FROM regulatory_data.statutory_plans
   WHERE plan_code = 'BIAAPA_MP_2021' AND org_id IS NULL
   LIMIT 1;
  IF p_biaapa IS NULL THEN
    RAISE EXCEPTION 'BIAAPA_MP_2021 statutory plan not found — apply 20260721 first.';
  END IF;

  -- ── 1. Evidence source + document ──────────────────────────────────────
  INSERT INTO regulatory_data.evidence_sources
    (org_id, source_kind, authority_name, source_title, source_url, city,
     plan_version, effective_from, extraction_status, review_status, confidence_score, notes)
  VALUES
    (NULL, 'official_pdf', 'Bengaluru International Airport Area Planning Authority (BMRDA)',
     'BIAAPA Master Plan 2021 — Zoning of Land Use and Regulations',
     'http://biaapa.tpa.gov.in/sites/biaapa.tpa.gov.in/files/ZR-BIAAPA-2021.pdf',
     'BIAAPA', 'BIAAPA MP 2021', DATE '2009-01-29',
     'completed', 'approved', 0.950,
     'Operative zoning rulebook for the BIAAPA Local Planning Area (airport belt / Devanahalli) under BMRDA. '
     || 'Master plan finally approved / gazette-notified 29-01-2009. FAR/coverage transcribed verbatim from '
     || 'Tables 3, 4, 9, 10 and §9.2, each cross-checked against the rendered source page.')
  RETURNING id INTO v_src;

  INSERT INTO regulatory_data.master_plan_documents
    (org_id, city, plan_name, plan_version, doc_type, extraction_status, evidence_source_id, extracted_at)
  VALUES
    (NULL, 'BIAAPA', 'BIAAPA Master Plan 2021 — Zoning Regulations', 'BIAAPA MP 2021',
     'rmp_table', 'completed', v_src, now())
  RETURNING id INTO v_doc;

  UPDATE regulatory_data.statutory_plans
     SET evidence_source_id = v_src,
         notes = 'Operative master plan for the BIAAPA LPA (airport belt / Devanahalli) under BMRDA. '
              || 'Zonal regulations / FAR tables ingested (migration 20260722).',
         updated_at = now()
   WHERE id = p_biaapa;

  -- ── 2. Use-zones (§9.2 — nine use-zones + Integrated-Township sub-zone) ──
  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_biaapa, 'BIAAPA', 'BIAAPA MP 2021', 'BIA-R', 'Residential (BIAAPA)',
     1.50, 2.50,
     '[{"road_width_m":0,"fsi":1.50},{"road_width_m":9,"fsi":1.75},{"road_width_m":12,"fsi":2.00},{"road_width_m":18,"fsi":2.25},{"road_width_m":24,"fsi":2.50}]'::jsonb,
     NULL, ARRAY['Dwelling units/plotted residential','Apartments/group housing (plot >= 1 ha)','Semi-detached/row housing','Schools/creche/community','Public utilities (special)'],
     26, 'BIAAPA MP 2021 Zoning Regs §9.2 + Table 3', 0.950, 'approved', DATE '2009-01-29',
     'FAR road-width-driven (Table 3). Plots >= 1 ha (10000 sqm) are group housing — plot-area-driven FAR/coverage per Table 4 (min 12 m approach road).')
  RETURNING id INTO z_r;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_biaapa, 'BIAAPA', 'BIAAPA MP 2021', 'BIA-C', 'Commercial (BIAAPA)',
     1.50, 3.00,
     '[{"road_width_m":0,"fsi":1.50},{"road_width_m":9,"fsi":1.75},{"road_width_m":12,"fsi":2.00},{"road_width_m":18,"fsi":2.50},{"road_width_m":24,"fsi":3.00}]'::jsonb,
     NULL, ARRAY['Retail/shops/commercial complexes','Offices/business','Hotels/restaurants','Cinemas/multiplexes','Service industries (special)'],
     26, 'BIAAPA MP 2021 Zoning Regs §9.2 + Table 3', 0.950, 'approved', DATE '2009-01-29',
     'FAR road-width-driven (Table 3, Commercial column).')
  RETURNING id INTO z_c;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_biaapa, 'BIAAPA', 'BIAAPA MP 2021', 'BIA-I', 'Industrial (BIAAPA)',
     0.50, 1.25,
     '[{"road_width_m":0,"fsi":1.00,"max_ground_coverage_pct":80},{"road_width_m":6,"fsi":1.25,"max_ground_coverage_pct":60}]'::jsonb,
     NULL, ARRAY['Light/medium/heavy industries','Warehouses/storage','Flatted factories','Manager/staff dwellings (ancillary)'],
     31, 'BIAAPA MP 2021 Zoning Regs §9.2 + Table 9', 0.950, 'approved', DATE '2009-01-29',
     'FAR plot-area-driven (Table 9). Coverage falls 80%->30% and FAR 1.00->0.50 as plot grows; setbacks per Table 9 (Residential Table-1 setbacks may substitute where Table-9 is not adoptable).')
  RETURNING id INTO z_i;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_biaapa, 'BIAAPA', 'BIAAPA MP 2021', 'BIA-PSP', 'Public & Semi-Public (BIAAPA)',
     1.25, 2.00,
     '[{"road_width_m":0,"fsi":1.25},{"road_width_m":9,"fsi":1.50},{"road_width_m":12,"fsi":1.75},{"road_width_m":18,"fsi":1.75},{"road_width_m":24,"fsi":2.00}]'::jsonb,
     NULL, ARRAY['Government/institutional buildings','Hospitals/educational','Community/civic amenities'],
     26, 'BIAAPA MP 2021 Zoning Regs §9.2 + Table 3', 0.950, 'approved', DATE '2009-01-29',
     'FAR road-width-driven (Table 3, shared Public&Semi-public·T&T·Public-Utility column).')
  RETURNING id INTO z_psp;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_biaapa, 'BIAAPA', 'BIAAPA MP 2021', 'BIA-PU', 'Public Utilities (BIAAPA)',
     1.25, 2.00,
     '[{"road_width_m":0,"fsi":1.25},{"road_width_m":9,"fsi":1.50},{"road_width_m":12,"fsi":1.75},{"road_width_m":18,"fsi":1.75},{"road_width_m":24,"fsi":2.00}]'::jsonb,
     NULL, ARRAY['Water/sewage/power utilities','Telecom/electrical infrastructure','Solid-waste/treatment facilities'],
     26, 'BIAAPA MP 2021 Zoning Regs §9.2 + Table 3', 0.950, 'approved', DATE '2009-01-29',
     'FAR road-width-driven (Table 3, shared Public&Semi-public·T&T·Public-Utility column).')
  RETURNING id INTO z_pu;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_biaapa, 'BIAAPA', 'BIAAPA MP 2021', 'BIA-TC', 'Transport & Communication (BIAAPA)',
     1.25, 2.00,
     '[{"road_width_m":0,"fsi":1.25},{"road_width_m":9,"fsi":1.50},{"road_width_m":12,"fsi":1.75},{"road_width_m":18,"fsi":1.75},{"road_width_m":24,"fsi":2.00}]'::jsonb,
     NULL, ARRAY['Railway/bus/truck terminals','Logistics/cargo/depots','Filling/service stations'],
     26, 'BIAAPA MP 2021 Zoning Regs §9.2 + Table 3', 0.950, 'approved', DATE '2009-01-29',
     'FAR road-width-driven (Table 3, shared Public&Semi-public·T&T·Public-Utility column).')
  RETURNING id INTO z_tc;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_biaapa, 'BIAAPA', 'BIAAPA MP 2021', 'BIA-OS', 'Park & Open Spaces (BIAAPA)',
     ARRAY['Parks/playgrounds','Cemeteries/crematoria','Recreational (non-commercial)'],
     12, 'BIAAPA MP 2021 Zoning Regs §9.2 (6)', 0.950, 'approved', DATE '2009-01-29',
     'Recreational / essentially non-developable. No FAR matrix — a parcel zoned here is not developable for buildings.')
  RETURNING id INTO z_os;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_biaapa, 'BIAAPA', 'BIAAPA MP 2021', 'BIA-AZ', 'Airport Zone (BIAAPA)',
     ARRAY['Airport operations','Aviation-related infrastructure','Uses per airport authority clearance'],
     12, 'BIAAPA MP 2021 Zoning Regs §9.2 (7)', 0.950, 'approved', DATE '2009-01-29',
     'DEAL-CRITICAL overlay: Kempegowda International Airport operational zone. Building height + use are restricted by AAI / airport funnel (obstacle-limitation) clearances across the whole belt, not just this zone. Verify airport NOC / height clearance before reliance.')
  RETURNING id INTO z_az;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_biaapa, 'BIAAPA', 'BIAAPA MP 2021', 'BIA-AG', 'Agricultural Use (BIAAPA)',
     ARRAY['Agriculture/horticulture/farming','Farm houses (G+1, per rural-development norms)','Dairy/poultry/pisciculture'],
     12, 'BIAAPA MP 2021 Zoning Regs §9.2 (9)', 0.950, 'approved', DATE '2009-01-29',
     'DEAL-KILLER for urban development: agricultural land. No general agriculture FAR table in the ZR — do NOT assume a developable FAR. Only the Rural Development provision (FAR 1.0, G+1, within 150 m of a gramathana) applies, recorded as a fact. DC conversion (alienation) required before any urban development.')
  RETURNING id INTO z_ag;

  INSERT INTO regulatory_data.master_plan_zones
    (document_id, statutory_plan_id, city, plan_version, zone_code, zone_name,
     permissible_fsi_base, permissible_fsi_max, fsi_road_width_rules, ground_coverage_pct,
     permissible_uses, source_page, source_section, confidence_score, review_status, effective_from, notes)
  VALUES
    (v_doc, p_biaapa, 'BIAAPA', 'BIAAPA MP 2021', 'BIA-IT', 'Integrated Township (BIAAPA)',
     2.00, 2.50,
     '[{"road_width_m":18,"fsi":2.00,"max_ground_coverage_pct":60},{"road_width_m":24,"fsi":2.25,"max_ground_coverage_pct":55},{"road_width_m":30,"fsi":2.50,"max_ground_coverage_pct":50}]'::jsonb,
     NULL, ARRAY['Mixed-use integrated township (Residential/Commercial/Industrial/PSP/Park)'],
     33, 'BIAAPA MP 2021 Zoning Regs Table 10', 0.950, 'approved', DATE '2009-01-29',
     'Special development: min 40 Ha, access from min 18 m road. FAR road-width-driven (Table 10). Land-use mix within the township not restricted to prevailing zones subject to stipulated percentages.')
  RETURNING id INTO z_it;

  -- ── 3. FAR rules ───────────────────────────────────────────────────────
  -- BIA-R Residential — Table 3 (road-width-driven, plot < 1 ha)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, p_biaapa, z_r, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-R', 'residential', 0, 10000,  0,  9, 1.50, 1.50, NULL, false, 26, 'BIAAPA Table 3 (Residential)', 'Road up to 9m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_r, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-R', 'residential', 0, 10000,  9, 12, 1.75, 1.75, NULL, false, 26, 'BIAAPA Table 3 (Residential)', 'Road over 9 to 12m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_r, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-R', 'residential', 0, 10000, 12, 18, 2.00, 2.00, NULL, false, 26, 'BIAAPA Table 3 (Residential)', 'Road over 12 to 18m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_r, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-R', 'residential', 0, 10000, 18, 24, 2.25, 2.25, NULL, false, 26, 'BIAAPA Table 3 (Residential)', 'Road over 18 to 24m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_r, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-R', 'residential', 0, 10000, 24, NULL, 2.50, 2.50, NULL, false, 26, 'BIAAPA Table 3 (Residential)', 'Road over 24m', 0.950, 'approved', DATE '2009-01-29');

  -- BIA-R Group Housing — Table 4 (plot-area-driven, plot >= 1 ha)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, p_biaapa, z_r, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-R', 'residential_group_housing', 10000, 20000, 0, NULL, 1.75, 1.75, 60.00, false, 27, 'BIAAPA Table 4 (Group Housing)', 'Plot 1-2 ha; min road 9m (12m min approach road for group housing)', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_r, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-R', 'residential_group_housing', 20000, 30000, 0, NULL, 2.00, 2.00, 50.00, false, 27, 'BIAAPA Table 4 (Group Housing)', 'Plot 2-3 ha; min road 12m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_r, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-R', 'residential_group_housing', 30000, NULL, 0, NULL, 2.50, 2.50, 40.00, false, 27, 'BIAAPA Table 4 (Group Housing)', 'Plot above 3 ha; min road 15m', 0.950, 'approved', DATE '2009-01-29');

  -- BIA-C Commercial — Table 3 (Commercial column)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, p_biaapa, z_c, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-C', 'commercial', 0, NULL,  0,  9, 1.50, 1.50, NULL, false, 26, 'BIAAPA Table 3 (Commercial)', 'Road up to 9m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_c, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-C', 'commercial', 0, NULL,  9, 12, 1.75, 1.75, NULL, false, 26, 'BIAAPA Table 3 (Commercial)', 'Road over 9 to 12m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_c, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-C', 'commercial', 0, NULL, 12, 18, 2.00, 2.00, NULL, false, 26, 'BIAAPA Table 3 (Commercial)', 'Road over 12 to 18m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_c, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-C', 'commercial', 0, NULL, 18, 24, 2.50, 2.50, NULL, false, 26, 'BIAAPA Table 3 (Commercial)', 'Road over 18 to 24m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_c, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-C', 'commercial', 0, NULL, 24, NULL, 3.00, 3.00, NULL, false, 26, 'BIAAPA Table 3 (Commercial)', 'Road over 24m', 0.950, 'approved', DATE '2009-01-29');

  -- BIA-PSP / BIA-PU / BIA-TC — Table 3 (shared Public&Semi-public·T&T·Public-Utility column)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, p_biaapa, z_psp, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-PSP', 'public_semi_public', 0, NULL,  0,  9, 1.25, 1.25, NULL, false, 26, 'BIAAPA Table 3 (Public & Semi-public)', 'Road up to 9m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_psp, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-PSP', 'public_semi_public', 0, NULL,  9, 12, 1.50, 1.50, NULL, false, 26, 'BIAAPA Table 3 (Public & Semi-public)', 'Road over 9 to 12m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_psp, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-PSP', 'public_semi_public', 0, NULL, 12, 18, 1.75, 1.75, NULL, false, 26, 'BIAAPA Table 3 (Public & Semi-public)', 'Road over 12 to 18m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_psp, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-PSP', 'public_semi_public', 0, NULL, 18, 24, 1.75, 1.75, NULL, false, 26, 'BIAAPA Table 3 (Public & Semi-public)', 'Road over 18 to 24m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_psp, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-PSP', 'public_semi_public', 0, NULL, 24, NULL, 2.00, 2.00, NULL, false, 26, 'BIAAPA Table 3 (Public & Semi-public)', 'Road over 24m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_pu, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-PU', 'public_utility', 0, NULL,  0,  9, 1.25, 1.25, NULL, false, 26, 'BIAAPA Table 3 (Public Utility)', 'Road up to 9m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_pu, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-PU', 'public_utility', 0, NULL,  9, 12, 1.50, 1.50, NULL, false, 26, 'BIAAPA Table 3 (Public Utility)', 'Road over 9 to 12m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_pu, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-PU', 'public_utility', 0, NULL, 12, 18, 1.75, 1.75, NULL, false, 26, 'BIAAPA Table 3 (Public Utility)', 'Road over 12 to 18m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_pu, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-PU', 'public_utility', 0, NULL, 18, 24, 1.75, 1.75, NULL, false, 26, 'BIAAPA Table 3 (Public Utility)', 'Road over 18 to 24m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_pu, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-PU', 'public_utility', 0, NULL, 24, NULL, 2.00, 2.00, NULL, false, 26, 'BIAAPA Table 3 (Public Utility)', 'Road over 24m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_tc, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-TC', 'transport_communication', 0, NULL,  0,  9, 1.25, 1.25, NULL, false, 26, 'BIAAPA Table 3 (Transport & Communication)', 'Road up to 9m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_tc, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-TC', 'transport_communication', 0, NULL,  9, 12, 1.50, 1.50, NULL, false, 26, 'BIAAPA Table 3 (Transport & Communication)', 'Road over 9 to 12m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_tc, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-TC', 'transport_communication', 0, NULL, 12, 18, 1.75, 1.75, NULL, false, 26, 'BIAAPA Table 3 (Transport & Communication)', 'Road over 12 to 18m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_tc, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-TC', 'transport_communication', 0, NULL, 18, 24, 1.75, 1.75, NULL, false, 26, 'BIAAPA Table 3 (Transport & Communication)', 'Road over 18 to 24m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_tc, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-TC', 'transport_communication', 0, NULL, 24, NULL, 2.00, 2.00, NULL, false, 26, 'BIAAPA Table 3 (Transport & Communication)', 'Road over 24m', 0.950, 'approved', DATE '2009-01-29');

  -- BIA-I Industrial — Table 9 (FAR plot-area-driven; road = min frontage requirement in notes)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, p_biaapa, z_i, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-I', 'industrial',    0,   230, 0, NULL, 1.00, 1.00, 80.00, false, 31, 'BIAAPA Table 9 (Industrial)', 'Plot up to 230 sqm; min road up to 6m, front setback 1.0m, other sides 1.0m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_i, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-I', 'industrial',  230,  1000, 0, NULL, 1.25, 1.25, 60.00, false, 31, 'BIAAPA Table 9 (Industrial)', 'Plot 231-1000 sqm; min road over 6m, front 4.5m, other 3.0m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_i, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-I', 'industrial', 1000,  2000, 0, NULL, 1.25, 1.25, 50.00, false, 31, 'BIAAPA Table 9 (Industrial)', 'Plot 1000-2000 sqm; min road over 9m, front 6.0m, other 5.0m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_i, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-I', 'industrial', 2000,  4000, 0, NULL, 1.25, 1.25, 40.00, false, 31, 'BIAAPA Table 9 (Industrial)', 'Plot 2001-4000 sqm; min road over 12m, front 8.0m, other 5.0m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_i, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-I', 'industrial', 4000,  8000, 0, NULL, 1.00, 1.00, 35.00, false, 31, 'BIAAPA Table 9 (Industrial)', 'Plot 4001-8000 sqm; min road over 15m, front 8.0m, other 6.0m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_i, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-I', 'industrial', 8000,  NULL, 0, NULL, 0.50, 0.50, 30.00, false, 31, 'BIAAPA Table 9 (Industrial)', 'Plot above 8000 sqm; min road over 15m, front 15.0m, other 12.0m', 0.950, 'approved', DATE '2009-01-29');

  -- BIA-IT Integrated Township — Table 10 (road-width-driven; min 40 Ha, min 18m road)
  INSERT INTO regulatory_data.far_rules
    (org_id, evidence_source_id, statutory_plan_id, zone_id, city, plan_version, plan_status,
     zone_code, land_use_family, plot_area_min_sqm, plot_area_max_sqm, road_width_min_m, road_width_max_m,
     base_far, max_far, ground_coverage_pct, tdr_eligible, source_page, source_section, rule_notes,
     confidence_score, review_status, effective_from)
  VALUES
    (NULL, v_src, p_biaapa, z_it, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-IT', 'integrated_township', 400000, NULL, 18, 24, 2.00, 2.00, 60.00, false, 33, 'BIAAPA Table 10 (Integrated Township)', 'Min 40 Ha; road above 18 to 24m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_it, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-IT', 'integrated_township', 400000, NULL, 24, 30, 2.25, 2.25, 55.00, false, 33, 'BIAAPA Table 10 (Integrated Township)', 'Min 40 Ha; road above 24 to 30m', 0.950, 'approved', DATE '2009-01-29'),
    (NULL, v_src, p_biaapa, z_it, 'BIAAPA', 'BIAAPA MP 2021', 'operative', 'BIA-IT', 'integrated_township', 400000, NULL, 30, NULL, 2.50, 2.50, 50.00, false, 33, 'BIAAPA Table 10 (Integrated Township)', 'Min 40 Ha; road above 30m', 0.950, 'approved', DATE '2009-01-29');

  GET DIAGNOSTICS v_far = ROW_COUNT;

  -- ── 4. Cross-cutting facts (setbacks reference, rural dev, township, airport) ──
  INSERT INTO regulatory_data.evidence_facts
    (org_id, source_id, fact_type, fact_key, fact_value, source_section, page_number, confidence_score, review_status)
  VALUES
    (NULL, v_src, 'setback', 'biaapa_setbacks_reference',
     '{"applies":"all use zones","note":"Exterior open spaces / setbacks are prescribed in Table 1 (percentage-minimum, p.23) and Table 2 (detailed by sital depth/width per use, p.25). NOT transcribed here to avoid dimensional error — buildability handles setbacks separately; per-rule setback columns are NULL except the Industrial Table-9 setbacks captured in rule_notes. Transcribe Tables 1 & 2 in a follow-up before quoting exact setbacks in IC.","industrial_note":"Where Table-9 industrial setbacks cannot be adopted, Residential Table-1 setbacks may be adopted."}'::jsonb,
     'BIAAPA MP 2021 Tables 1 & 2', 23, 0.900, 'approved'),
    (NULL, v_src, 'far', 'biaapa_rural_development',
     '{"context":"Rural development within 150 m of an existing gramathana (revenue village settlement); +50 m per additional 1000 population over 1000 (2001 census). Uses permitted under residential + agricultural zone.","far":1.0,"max_floors":"G+1","setbacks":"per Table 1"}'::jsonb,
     'BIAAPA MP 2021 Regulations for Rural Development', 33, 0.950, 'approved'),
    (NULL, v_src, 'far', 'biaapa_integrated_township_eligibility',
     '{"lever":"Integrated Township (special development)","min_land_ha":40,"min_access_road_m":18,"far_by_road":[{"road_over_m":18,"road_up_to_m":24,"coverage_pct":60,"far":2.00},{"road_over_m":24,"road_up_to_m":30,"coverage_pct":55,"far":2.25},{"road_over_m":30,"coverage_pct":50,"far":2.50}],"note":"Land-use mix within the township not restricted to prevailing zones subject to stipulated percentages."}'::jsonb,
     'BIAAPA MP 2021 Table 10 + Integrated Township', 33, 0.950, 'approved'),
    (NULL, v_src, 'environmental', 'biaapa_airport_obstacle_limitation',
     '{"overlay":"Kempegowda International Airport obstacle-limitation / funnel zone","deal_killer":true,"note":"Across the BIAAPA belt, building HEIGHT is restricted by AAI / airport authority obstacle-limitation surfaces (funnel + horizontal surfaces around the runway). A permissible FAR does NOT guarantee the buildable height — a height NOC from the airport authority is required and can bind the envelope well below the FAR. Verify airport height clearance per parcel before reliance."}'::jsonb,
     'BIAAPA MP 2021 §9.2 (Airport Zone)', 12, 0.900, 'approved'),
    (NULL, v_src, 'far', 'biaapa_far_exclusions',
     '{"excluded_from_far":["effluent treatment plant","open-to-sky swimming pool","car parking"],"source":"Table 3 note"}'::jsonb,
     'BIAAPA MP 2021 Table 3 (note)', 26, 0.950, 'approved');

  RAISE NOTICE 'BIAAPA MP 2021 seeded: 1 source, 10 zones, % far_rules, 5 facts. Plan linked to evidence source.', v_far;
END $$;
