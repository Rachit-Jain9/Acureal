-- ============================================================================
-- 20260721_biaapa_planning_authority_registry.sql
-- ----------------------------------------------------------------------------
-- Extend the statutory-plan registry (20260712) with the Bengaluru International
-- Airport Area Planning Authority (BIAAPA) + its operative master plan, so the
-- jurisdiction resolver routes airport-belt / Devanahalli parcels to the REAL
-- BIAAPA rulebook instead of silently matching BDA's RMP-2015 or nothing.
--
-- WHY (same class of blind spot the registry was built to close, per 20260712):
--   A Devanahalli / airport-belt parcel is governed by the BIAAPA Master Plan
--   2021 (a distinct rulebook under BMRDA), NOT by BDA RMP 2015. Without a
--   BIAAPA authority row, the resolver defaults such a parcel to BDA (flagged,
--   low-confidence) and would apply the wrong FAR ladder. This registers BIAAPA
--   so the resolver picks it up by taluk alias; the zonal-regulation FAR tables
--   are seeded by the companion migration 20260722.
--
-- JURISDICTION (deliberately conservative):
--   taluk_aliases = ['devanahalli'] only. The current BIAAPA LPA (after the 2016
--   STRR carve-out and the 2017 Doddaballapura PA carve-out) is centred on the
--   Devanahalli taluk airport belt; the BMRDA register lists BIAAPA as serving
--   the Devanahalli area with no competing Devanahalli PA. The resolver returns
--   this as "likely BIAAPA (confidence 0.9 — verify with authority)", never
--   "verified", and a human-assigned zone plan still overrides. Bangalore North
--   / Doddaballapura parcels are intentionally NOT claimed here.
--
-- STATUS NOTE (GBA transition — honest): the Greater Bengaluru Authority
--   (Karnataka Act 36 of 2025) is the new apex Planning Authority for the region;
--   BIAAPA continues to operate under BMRDA during the transition. Verify the
--   sanctioning authority per parcel at deal time.
--
-- Idempotent: guarded DO block (skips if BIAAPA already registered). Safe to
-- re-run. Depends on 20260712 (planning_authorities + statutory_plans tables).
-- Rollback: delete the BIAAPA statutory_plans row then the BIAAPA
--   planning_authorities row (no far_rules yet at this layer).
-- ============================================================================

BEGIN;

DO $$
DECLARE
  a_biaapa UUID;
  p_biaapa UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM regulatory_data.planning_authorities
    WHERE authority_code = 'BIAAPA' AND org_id IS NULL
  ) THEN
    RAISE NOTICE 'BIAAPA already registered — skipping.';
    RETURN;
  END IF;

  -- Bengaluru International Airport Area Planning Authority (under BMRDA).
  INSERT INTO regulatory_data.planning_authorities
    (org_id, authority_code, authority_name, authority_kind, parent_code, status,
     status_note, taluk_aliases, source_notification, confidence_score, review_status,
     effective_from, last_verified_at)
  VALUES
    (NULL, 'BIAAPA', 'Bengaluru International Airport Area Planning Authority', 'lpa', 'BMRDA', 'active',
     'Local Planning Authority for the Kempegowda International Airport belt (Devanahalli area) under the '
     || 'Bangalore Metropolitan Region Development Authority (BMRDA). A distinct rulebook from BDA RMP — '
     || 'governs the airport-belt / Devanahalli LPA. The LPA was revised (G.O. 24-06-2016 STRR carve-out; '
     || 'G.O. 30-11-2017 Doddaballapura PA carve-out). GBA (Karnataka Act 36 of 2025) is the new apex '
     || 'Planning Authority in transition — verify the sanctioning authority per parcel at deal time. '
     || 'KIADB-notified industrial areas within this belt may OVERRIDE the LPA for building-plan sanction.',
     ARRAY['devanahalli']::text[],
     'BIAAPA constituted 12-01-1996 (KTCP Act 1961); LPA revised 2016 & 2017', 0.900, 'approved',
     DATE '1996-01-12', now())
  RETURNING id INTO a_biaapa;

  -- BIAAPA Master Plan 2021 (operative). Horizon year 2021 has passed, but no
  -- successor plan has been notified, so it remains the operative rulebook
  -- (same posture as RMP 2015). Its zonal regulations / FAR tables are seeded by
  -- migration 20260722; evidence_source_id is linked there.
  INSERT INTO regulatory_data.statutory_plans
    (org_id, authority_id, plan_code, plan_name, legal_status, version_label, horizon_year,
     source_notification, effective_from, review_status, confidence_score, last_verified_at, notes)
  VALUES
    (NULL, a_biaapa, 'BIAAPA_MP_2021', 'BIAAPA Master Plan 2021 — Zoning of Land Use and Regulations',
     'operative', 'base-2009', 2021,
     'Master Plan finally approved / gazette-notified 29-01-2009 (Govt. of Karnataka)', DATE '2009-01-29',
     'approved', 0.950, now(),
     'Operative master plan for the BIAAPA Local Planning Area (airport belt / Devanahalli) under BMRDA. '
     || 'Horizon year 2021 has elapsed but no successor plan is notified, so it continues to govern. '
     || 'Zonal regulations / FAR tables ingested by migration 20260722 (Tables 3, 4, 9, 10 + rural dev).')
  RETURNING id INTO p_biaapa;

  RAISE NOTICE 'BIAAPA registered: 1 authority + 1 operative plan (BIAAPA_MP_2021).';
END $$;

COMMIT;

-- ── Verification (run after apply) ──
-- SELECT authority_code, authority_name, status, taluk_aliases
--   FROM regulatory_data.planning_authorities WHERE authority_code = 'BIAAPA' AND org_id IS NULL;
-- SELECT plan_code, plan_name, legal_status, horizon_year
--   FROM regulatory_data.statutory_plans WHERE plan_code = 'BIAAPA_MP_2021' AND org_id IS NULL;
