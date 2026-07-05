-- ============================================================================
-- 20260723_hoskote_planning_authority_registry.sql
-- ----------------------------------------------------------------------------
-- Extend the statutory-plan registry (20260712) with the Hoskote Planning
-- Authority (HPA) + its master plan, so the jurisdiction resolver routes Hoskote
-- (east Bengaluru) parcels to the REAL Hoskote rulebook instead of silently
-- matching BDA's RMP-2015 or nothing. Same pattern as Anekal (20260712) + BIAAPA
-- (20260721). Companion seed: 20260724.
--
-- JURISDICTION: taluk_aliases = ['hoskote'] — the Hoskote LPA (474 sq km) is the
--   Hoskote taluk belt under BMRDA. The resolver returns "likely Hoskote PA
--   (confidence 0.9 — verify)", never "verified"; a human-assigned zone plan
--   overrides. KIADB-notified industrial areas in the belt may override the LPA.
--
-- PLAN STATUS (honest): the source document is titled "Master Plan (Provisional)
--   for Hoskote Local Planning Area 2031". A Karnataka provisional master plan is
--   the operative regulatory framework used to sanction development pending final
--   approval — so it is registered legal_status='operative' (else the resolver,
--   which only routes operative plans, would fall a Hoskote parcel back to BDA —
--   the WRONG rulebook). The provisional label + a verify-final-approval prompt
--   are recorded in the plan notes + a fact (20260724). Confidence 0.90.
--
-- Idempotent (guarded DO block). Depends on 20260712. Rollback: delete the
-- HOSKOTE_LPA_MP_2031 plan row then the HOSKOTE_PA authority row.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  a_hoskote UUID;
  p_hoskote UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM regulatory_data.planning_authorities
    WHERE authority_code = 'HOSKOTE_PA' AND org_id IS NULL
  ) THEN
    RAISE NOTICE 'Hoskote PA already registered — skipping.';
    RETURN;
  END IF;

  INSERT INTO regulatory_data.planning_authorities
    (org_id, authority_code, authority_name, authority_kind, parent_code, status,
     status_note, taluk_aliases, source_notification, confidence_score, review_status,
     effective_from, last_verified_at)
  VALUES
    (NULL, 'HOSKOTE_PA', 'Hoskote Planning Authority', 'lpa', 'BMRDA', 'active',
     'Hoskote Local Planning Area (474 sq km, east Bengaluru — industrial / logistics belt) under the '
     || 'Bangalore Metropolitan Region Development Authority (BMRDA). A distinct rulebook from BDA RMP. '
     || 'GBA (Karnataka Act 36 of 2025) is the new apex Planning Authority in transition — verify the '
     || 'sanctioning authority per parcel at deal time. KIADB-notified industrial areas within this belt '
     || 'may OVERRIDE the LPA for building-plan sanction.',
     ARRAY['hoskote']::text[],
     'Hoskote LPA constituted under the KTCP Act 1961 (BMRDA)', 0.900, 'approved',
     NULL, now())
  RETURNING id INTO a_hoskote;

  INSERT INTO regulatory_data.statutory_plans
    (org_id, authority_id, plan_code, plan_name, legal_status, version_label, horizon_year,
     source_notification, effective_from, review_status, confidence_score, last_verified_at, notes)
  VALUES
    (NULL, a_hoskote, 'HOSKOTE_LPA_MP_2031', 'Hoskote LPA Master Plan 2031 (Provisional)',
     'operative', 'provisional-2031', 2031,
     'Provisional Master Plan for the Hoskote Local Planning Area 2031 (BMRDA)', NULL,
     'approved', 0.900, now(),
     'Operative regulatory rulebook for the Hoskote LPA under BMRDA. The source document is a PROVISIONAL '
     || 'master plan (used to sanction development pending final approval) — registered operative so the '
     || 'resolver routes Hoskote parcels here rather than to BDA RMP 2015. VERIFY the final-approval / '
     || 'notification status per deal. Zonal regulations / FAR tables ingested by migration 20260724 '
     || '(Chapter 10: Tables 4, 5, 10, 11 + setback Tables 2/3).')
  RETURNING id INTO p_hoskote;

  RAISE NOTICE 'Hoskote PA registered: 1 authority + 1 plan (HOSKOTE_LPA_MP_2031, provisional/operative).';
END $$;

COMMIT;

-- ── Verification (run after apply) ──
-- SELECT authority_code, taluk_aliases FROM regulatory_data.planning_authorities WHERE authority_code='HOSKOTE_PA' AND org_id IS NULL;
-- SELECT plan_code, legal_status, horizon_year FROM regulatory_data.statutory_plans WHERE plan_code='HOSKOTE_LPA_MP_2031' AND org_id IS NULL;
