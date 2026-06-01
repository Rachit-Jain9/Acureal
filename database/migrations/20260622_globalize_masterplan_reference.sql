-- ============================================================================
-- 20260622 — Make the curated RMP master-plan reference visible to ALL users
--             + tag the 7 per-district land-use facts with their PD code
-- ============================================================================
-- The regulatory_data evidence_* / far_rules tables use the RLS policy
--   USING (org_id IS NULL OR org_id = current_organization_id())
-- so org_id = NULL means "every org/user sees this row". Until now the curated
-- RMP reference (planning-district demographics, land-use, zoning, city
-- callouts, UAV rates) was scoped to a single org, so only that org's users
-- saw the planning intelligence. This globalises the *curated reference* so it
-- reaches all current and future users.
--
-- PRIVACY: only source_kind = 'official_pdf' rows (the BDA/RMP documents) are
-- globalised. The operator's own uploaded deal documents
-- (source_kind = 'user_upload' — sale deeds, e-Khatas, ECs, survey sketches)
-- and their extracted facts are NOT touched — they stay private to the org.
--
-- Idempotent: every UPDATE is guarded (org_id IS NOT NULL); re-running is a
-- no-op. jsonb_set re-applies the same pd_code. Paste-safe in the Supabase SQL
-- editor (no CONCURRENTLY).
-- ============================================================================

BEGIN;

-- 1. Curated reference SOURCES (official RMP PDFs) → global.
UPDATE regulatory_data.evidence_sources
   SET org_id = NULL, updated_at = NOW()
 WHERE source_kind = 'official_pdf' AND org_id IS NOT NULL;

-- 2. FACTS extracted from those reference sources → global.
--    (Deal-document facts hang off user_upload sources and are left private.)
UPDATE regulatory_data.evidence_facts ef
   SET org_id = NULL
 WHERE ef.org_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM regulatory_data.evidence_sources es
      WHERE es.id = ef.source_id AND es.source_kind = 'official_pdf'
   );

-- 3. RMP zoning rules (FAR / setback / coverage — all reference) → global.
UPDATE regulatory_data.far_rules
   SET org_id = NULL, updated_at = NOW()
 WHERE org_id IS NOT NULL;

-- 4. BBMP UAV rate card (guidance-value reference) → global.
UPDATE regulatory_data.bbmp_uav_entries
   SET org_id = NULL
 WHERE org_id IS NOT NULL;

-- 5. Tag the 7 per-district existing-land-use facts with their PD code so the
--    parcel-context service can join them to a resolved planning district.
--    Mapping: area-match (6/7 exact to < 0.1 ha) + name. Malleswaram → PD-06
--    "Yeshwantpur – Malleswaram" by name (PD-06's stored area is a known
--    duplicate of PD-01, so the area key is unreliable for it).
UPDATE regulatory_data.evidence_facts SET fact_value = jsonb_set(fact_value, '{pd_code}', '"PD-01"')
 WHERE fact_type = 'pd_existing_land_use' AND fact_key = 'pd_cbd_central_core_existing_land_use';
UPDATE regulatory_data.evidence_facts SET fact_value = jsonb_set(fact_value, '{pd_code}', '"PD-02"')
 WHERE fact_type = 'pd_existing_land_use' AND fact_key = 'pd_indiranagar_existing_land_use';
UPDATE regulatory_data.evidence_facts SET fact_value = jsonb_set(fact_value, '{pd_code}', '"PD-03"')
 WHERE fact_type = 'pd_existing_land_use' AND fact_key = 'pd_austin_town_existing_land_use';
UPDATE regulatory_data.evidence_facts SET fact_value = jsonb_set(fact_value, '{pd_code}', '"PD-04"')
 WHERE fact_type = 'pd_existing_land_use' AND fact_key = 'pd_jayanagar_existing_land_use';
UPDATE regulatory_data.evidence_facts SET fact_value = jsonb_set(fact_value, '{pd_code}', '"PD-05"')
 WHERE fact_type = 'pd_existing_land_use' AND fact_key = 'pd_rajajinagar_existing_land_use';
UPDATE regulatory_data.evidence_facts SET fact_value = jsonb_set(fact_value, '{pd_code}', '"PD-06"')
 WHERE fact_type = 'pd_existing_land_use' AND fact_key = 'pd_malleswaram_existing_land_use';
UPDATE regulatory_data.evidence_facts SET fact_value = jsonb_set(fact_value, '{pd_code}', '"PD-07"')
 WHERE fact_type = 'pd_existing_land_use' AND fact_key = 'pd_rt_nagar_existing_land_use';

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   -- Curated reference now global (expect 0 org-scoped official rows):
--   SELECT count(*) FROM regulatory_data.evidence_sources
--    WHERE source_kind='official_pdf' AND org_id IS NOT NULL;          -- 0
--   SELECT count(*) FROM regulatory_data.far_rules WHERE org_id IS NOT NULL; -- 0
--   -- Deal docs still private (expect > 0):
--   SELECT count(*) FROM regulatory_data.evidence_sources
--    WHERE source_kind='user_upload' AND org_id IS NOT NULL;           -- 7
--   -- PD codes tagged (expect 7 rows, PD-01..PD-07):
--   SELECT fact_value->>'pd_name', fact_value->>'pd_code'
--   FROM regulatory_data.evidence_facts WHERE fact_type='pd_existing_land_use'
--   ORDER BY fact_value->>'pd_code';
-- ============================================================================
