-- ============================================================================
-- 20260712_statutory_plan_registry.sql
-- ----------------------------------------------------------------------------
-- Workstream 0 — the legal spine: a minimal, extensible statutory-plan registry
-- that lets REDIP resolve WHICH planning authority and WHICH operative master
-- plan govern a parcel, and scope its FAR rules to that plan.
--
-- WHY THIS EXISTS:
--   Today `loadFarRules` matches FAR rows on zone_code + city='Bengaluru' with
--   NO authority/plan scoping. A Jigani/Anekal parcel (governed by the Anekal
--   LPA Master Plan 2031 under BMRDA — a different rulebook) would silently
--   match BDA's RMP-2015 FAR rules, OR match nothing, with no honest signal
--   that the wrong rulebook was applied. This is exactly the catastrophic
--   blind spot REDIP exists to prevent. The registry + resolver fixes it:
--   far_rules are scoped to the resolved statutory_plan_id, so an Anekal parcel
--   resolves to the Anekal plan (whose rules are not yet ingested → honest
--   "rulebook not loaded" instead of wrong-rulebook FAR), while a Whitefield/
--   Bellandur parcel still resolves to RMP 2015.
--
-- SCOPE (deliberately minimal per the Workstream-0 plan):
--   - planning_authorities : seed BDA + Anekal Planning Authority (BMRDA) only.
--                            Shaped to extend (GBA/BIAAPA/KIADB later) — NOT the
--                            full lattice. taluk_aliases drives tabular-first
--                            resolution (no polygons required).
--   - statutory_plans      : consolidates rulebook + version (existing
--                            far_rules.plan_version / plan_status already carry
--                            most of this — we add the FK, not a rewrite).
--                            Seeds RMP 2015 (operative), Anekal LPA MP 2031
--                            (operative), RMP 2031 Bengaluru (withdrawn — for
--                            honest re-labelling of legacy rows; NEVER default).
--   - jurisdiction_resolution_log : per-parcel audit of HOW the authority/plan
--                            was decided (inputs, method, confidence, basis).
--   - far_rules / master_plan_zones : add nullable statutory_plan_id FK +
--                            backfill the operative RMP-2015 rows → RMP 2015 and
--                            the withdrawn RMP-2031 rows → RMP 2031.
--
-- RLS posture (corrected vs the design doc, which assumed a SQL is_platform_admin()
-- that does NOT exist — the platform-admin gate is application-layer):
--   New reference tables use ENABLE ROW LEVEL SECURITY (matching the sibling
--   regulatory_data tables). Read policy: org_id IS NULL OR org_id = current org.
--   WRITE policy: org_id = current org ONLY — so a tenant can create private
--   org overrides but can NEVER write a global (org_id NULL) reference row.
--   Global reference rows are migration-seeded only (the owner role bypasses
--   ENABLE RLS). This is STRICTER than the existing far_rules policy (which lets
--   any tenant write global rows) — it closes that hole for the new tables.
--
-- Idempotent: CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, a guarded
-- seed DO block (checks for the BDA global row), DROP POLICY IF EXISTS before
-- CREATE POLICY. Safe to re-run. The code degrades gracefully if this migration
-- is not yet applied (the resolver try/catches missing tables → unresolved).
--
-- Rollback: DROP the 3 new tables + the 2 added columns. No existing data is
-- destroyed (backfill only sets a new nullable FK; legacy plan_version/
-- plan_status are untouched).
-- ============================================================================

BEGIN;

-- ── 1. planning_authorities ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS regulatory_data.planning_authorities (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id           UUID REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = global reference
  authority_code   TEXT NOT NULL,
  authority_name   TEXT NOT NULL,
  authority_kind   TEXT NOT NULL DEFAULT 'lpa'
                     CHECK (authority_kind IN ('lpa','umbrella','corridor','industrial_board','corporation')),
  parent_code      TEXT,
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','transitioning','superseded')),
  status_note      TEXT,
  taluk_aliases    TEXT[] NOT NULL DEFAULT '{}',  -- K-GIS taluk/village names that resolve to this authority
  source_notification TEXT,
  confidence_score NUMERIC(4,3) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  review_status    TEXT NOT NULL DEFAULT 'pending'
                     CHECK (review_status IN ('pending','approved','rejected','needs_review')),
  effective_from   DATE,
  effective_to     DATE,
  last_verified_at TIMESTAMPTZ,
  next_review_due  DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_planning_authorities_code
  ON regulatory_data.planning_authorities
     (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), authority_code);

-- ── 2. statutory_plans (consolidated rulebook + version) ────────────────────
CREATE TABLE IF NOT EXISTS regulatory_data.statutory_plans (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id             UUID REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = global reference
  authority_id       UUID NOT NULL REFERENCES regulatory_data.planning_authorities(id) ON DELETE CASCADE,
  plan_code          TEXT NOT NULL,            -- 'RMP_2015','RMP_2031','ANEKAL_LPA_MP_2031'
  plan_name          TEXT NOT NULL,
  legal_status       TEXT NOT NULL DEFAULT 'operative'
                       CHECK (legal_status IN ('operative','provisional','withdrawn','draft','superseded')),
  version_label      TEXT,                     -- 'base-2007','amendment-2015'
  horizon_year       INT,
  supersedes_plan_id UUID REFERENCES regulatory_data.statutory_plans(id) ON DELETE SET NULL,
  source_notification TEXT,                    -- primary citation (G.O. / gazette) when available
  evidence_source_id UUID REFERENCES regulatory_data.evidence_sources(id) ON DELETE SET NULL,
  effective_from     DATE,
  effective_to       DATE,
  review_status      TEXT NOT NULL DEFAULT 'pending'
                       CHECK (review_status IN ('pending','approved','rejected','needs_review')),
  confidence_score   NUMERIC(4,3) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  last_verified_at   TIMESTAMPTZ,
  next_review_due    DATE,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_statutory_plans_code
  ON regulatory_data.statutory_plans
     (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), authority_id, plan_code);
CREATE INDEX IF NOT EXISTS idx_statutory_plans_authority
  ON regulatory_data.statutory_plans (authority_id, legal_status);

-- ── 3. jurisdiction_resolution_log (per-parcel audit of the resolution) ─────
CREATE TABLE IF NOT EXISTS regulatory_data.jurisdiction_resolution_log (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id                   UUID DEFAULT current_organization_id(),
  property_id              UUID REFERENCES properties(id) ON DELETE CASCADE,
  inputs                   JSONB NOT NULL,                 -- { taluk, hobli, village, lat, lng, city }
  resolved_authority_id    UUID REFERENCES regulatory_data.planning_authorities(id) ON DELETE SET NULL,
  resolved_authority_code  TEXT,
  resolved_plan_id         UUID REFERENCES regulatory_data.statutory_plans(id) ON DELETE SET NULL,
  resolved_plan_code       TEXT,
  method                   TEXT,                           -- 'taluk_alias' | 'default_bda' | 'unresolved'
  confidence               NUMERIC(4,3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  basis                    TEXT,
  needs_authority_confirmation BOOLEAN NOT NULL DEFAULT false,
  alternates               JSONB,
  resolved_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jurisdiction_log_property
  ON regulatory_data.jurisdiction_resolution_log (org_id, property_id, created_at DESC);

-- ── 4. Extend far_rules + master_plan_zones with the plan FK ────────────────
ALTER TABLE regulatory_data.far_rules
  ADD COLUMN IF NOT EXISTS statutory_plan_id UUID
    REFERENCES regulatory_data.statutory_plans(id) ON DELETE SET NULL;
ALTER TABLE regulatory_data.master_plan_zones
  ADD COLUMN IF NOT EXISTS statutory_plan_id UUID
    REFERENCES regulatory_data.statutory_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_far_rules_statutory_plan
  ON regulatory_data.far_rules (statutory_plan_id)
  WHERE statutory_plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_master_plan_zones_statutory_plan
  ON regulatory_data.master_plan_zones (statutory_plan_id)
  WHERE statutory_plan_id IS NOT NULL;

-- ── 5. Seed authorities + plans, then backfill the FK links (idempotent) ────
DO $$
DECLARE
  a_bda     UUID;
  a_anekal  UUID;
  p_rmp2015 UUID;
  p_rmp2031 UUID;
  p_anekal  UUID;
  v_rmp2015_src UUID;
  v_far_2015 INT := 0;
  v_far_2031 INT := 0;
BEGIN
  -- Skip the seed (but never the DDL above) if BDA is already registered.
  IF EXISTS (
    SELECT 1 FROM regulatory_data.planning_authorities
    WHERE authority_code = 'BDA' AND org_id IS NULL
  ) THEN
    RAISE NOTICE 'planning_authorities already seeded — skipping seed/backfill.';
    RETURN;
  END IF;

  -- Bangalore Development Authority (the operative LPA for the BBMP/BDA area).
  INSERT INTO regulatory_data.planning_authorities
    (org_id, authority_code, authority_name, authority_kind, parent_code, status,
     status_note, taluk_aliases, source_notification, confidence_score, review_status,
     effective_from, last_verified_at)
  VALUES
    (NULL, 'BDA', 'Bangalore Development Authority', 'lpa', NULL, 'active',
     'Operative sanctioning authority for the BDA Local Planning Area under RMP 2015. '
     || 'Transition note: the Greater Bengaluru Authority (Karnataka Act 36 of 2025) is now the statutory '
     || 'Planning Authority and BDA jurisdiction is being reduced via separate notifications — verify the '
     || 'sanctioning authority per parcel at deal time; do not assume BDA where a transfer notification applies.',
     ARRAY['bangalore north','bangalore south','bangalore east','yelahanka','krishnarajapuram',
           'mahadevapura','bommanahalli','dasarahalli','bengaluru','bangalore']::text[],
     'KTCP Act 1961; BDA Act 1976', 1.000, 'approved', DATE '1976-01-01', now())
  RETURNING id INTO a_bda;

  -- Anekal Planning Authority (under BMRDA) — governs Jigani/Bommasandra/Anekal.
  INSERT INTO regulatory_data.planning_authorities
    (org_id, authority_code, authority_name, authority_kind, parent_code, status,
     status_note, taluk_aliases, source_notification, confidence_score, review_status,
     effective_from, last_verified_at)
  VALUES
    (NULL, 'ANEKAL_PA', 'Anekal Planning Authority', 'lpa', 'BMRDA', 'active',
     'Anekal Local Planning Area under the Bangalore Metropolitan Region Development Authority (BMRDA). '
     || 'A distinct rulebook from BDA RMP — governs the Jigani / Bommasandra / Attibele / Anekal belt. '
     || 'KIADB notified industrial areas within this belt may OVERRIDE the LPA for building-plan sanction.',
     ARRAY['anekal']::text[],
     'G.O. UDD 151 BMR 2013 dated 03-09-2014', 1.000, 'approved', DATE '2014-09-03', now())
  RETURNING id INTO a_anekal;

  -- Link the operative RMP 2015 evidence source if it was already seeded.
  SELECT id INTO v_rmp2015_src
    FROM regulatory_data.evidence_sources
   WHERE source_title = 'Revised Master Plan 2015 — Volume III: Zoning of Land Use and Regulations'
     AND org_id IS NULL
   LIMIT 1;

  -- RMP 2015 (operative — the only operative master plan for the BDA LPA).
  INSERT INTO regulatory_data.statutory_plans
    (org_id, authority_id, plan_code, plan_name, legal_status, version_label, horizon_year,
     source_notification, evidence_source_id, effective_from, review_status, confidence_score,
     last_verified_at, notes)
  VALUES
    (NULL, a_bda, 'RMP_2015', 'Revised Master Plan 2015 — Volume III (Zoning of Land Use and Regulations)',
     'operative', 'base-2007', 2015,
     'G.O. No. UDD 540 BEM AA SE 2004 dated 22-06-2007', v_rmp2015_src, DATE '2007-06-22',
     'approved', 1.000, now(),
     'Operative statutory master plan for the entire BDA Local Planning Area (core and outskirts incl. '
     || 'Whitefield PD-315 and Bellandur/Varthur PD-316). RMP 2041 is in preparation under GBA; until '
     || 'notified, RMP 2015 governs.')
  RETURNING id INTO p_rmp2015;

  -- RMP 2031 (Bengaluru) — WITHDRAWN. Registered only for honest re-labelling of
  -- legacy rows; must NEVER be a default or surface as operative zoning.
  INSERT INTO regulatory_data.statutory_plans
    (org_id, authority_id, plan_code, plan_name, legal_status, version_label, horizon_year,
     source_notification, effective_from, effective_to, review_status, confidence_score,
     last_verified_at, notes)
  VALUES
    (NULL, a_bda, 'RMP_2031', 'Revised Master Plan 2031 (Bengaluru) — withdrawn draft',
     'withdrawn', 'draft-2017', 2031,
     'Provisional approval (2017) withdrawn by the Govt. of Karnataka in July 2020', NULL, DATE '2020-07-31',
     'approved', 1.000, now(),
     'Never notified. Provisional approval withdrawn Jul 2020; redraft ordered. Governs nothing. Retained '
     || 'as a labelled non-default reference for historical-approval edge cases only.')
  RETURNING id INTO p_rmp2031;

  -- Anekal LPA Master Plan 2031 (operative) — the registry entry exists and is
  -- operative as a fact; its zonal regulations / FAR tables are NOT yet ingested
  -- (Workstream 3, operator-gated). The resolver routes Anekal parcels here and
  -- the snapshot reports "rulebook not yet loaded" rather than applying RMP 2015.
  INSERT INTO regulatory_data.statutory_plans
    (org_id, authority_id, plan_code, plan_name, legal_status, version_label, horizon_year,
     source_notification, effective_from, review_status, confidence_score, last_verified_at, notes)
  VALUES
    (NULL, a_anekal, 'ANEKAL_LPA_MP_2031', 'Anekal Local Planning Area — Master Plan 2031 (BMRDA)',
     'operative', 'base-2014', 2031,
     'G.O. UDD 151 BMR 2013 dated 03-09-2014 (Anekal Planning Authority)', DATE '2014-09-03',
     'approved', 1.000, now(),
     'Operative master plan for the Anekal LPA under BMRDA. Zonal regulations / FAR tables are NOT yet '
     || 'ingested into far_rules — parcels resolving here surface an honest "Anekal rulebook not yet loaded" '
     || 'state instead of falling back to BDA RMP 2015.')
  RETURNING id INTO p_anekal;

  -- ── Backfill the plan FK on existing global reference rows ────────────────
  -- Operative RMP-2015 far_rules → RMP 2015 plan. Match by plan_version/status so
  -- a future seed that forgets to set statutory_plan_id is still captured.
  UPDATE regulatory_data.far_rules
     SET statutory_plan_id = p_rmp2015, updated_at = now()
   WHERE org_id IS NULL
     AND statutory_plan_id IS NULL
     AND (plan_version ILIKE '%2015%' OR plan_status = 'operative');
  GET DIAGNOSTICS v_far_2015 = ROW_COUNT;

  -- Withdrawn / legacy RMP-2031 far_rules → RMP 2031 plan (so they are scoped
  -- OUT of any operative resolution, not just review-gated).
  UPDATE regulatory_data.far_rules
     SET statutory_plan_id = p_rmp2031, updated_at = now()
   WHERE org_id IS NULL
     AND statutory_plan_id IS NULL
     AND (plan_version ILIKE '%2031%' OR plan_status = 'withdrawn' OR plan_status = 'draft_reference');
  GET DIAGNOSTICS v_far_2031 = ROW_COUNT;

  -- master_plan_zones: same partition.
  UPDATE regulatory_data.master_plan_zones
     SET statutory_plan_id = p_rmp2015
   WHERE statutory_plan_id IS NULL
     AND (plan_version ILIKE '%2015%' OR plan_version IS NULL);
  UPDATE regulatory_data.master_plan_zones
     SET statutory_plan_id = p_rmp2031
   WHERE statutory_plan_id IS NULL
     AND plan_version ILIKE '%2031%';

  RAISE NOTICE 'Statutory-plan registry seeded: 2 authorities (BDA, Anekal PA), 3 plans (RMP 2015 operative, RMP 2031 withdrawn, Anekal LPA MP 2031 operative). Backfilled % RMP-2015 + % RMP-2031 far_rules.', v_far_2015, v_far_2031;
END $$;

-- ── 6. RLS — ENABLE (owner/migration bypasses; tenants cannot write globals) ─
ALTER TABLE regulatory_data.planning_authorities         ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.statutory_plans              ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_data.jurisdiction_resolution_log  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS planning_authorities_rw ON regulatory_data.planning_authorities;
CREATE POLICY planning_authorities_rw ON regulatory_data.planning_authorities
  USING (org_id IS NULL OR org_id = current_organization_id())
  WITH CHECK (org_id = current_organization_id());   -- tenants may only write their own org overrides

DROP POLICY IF EXISTS statutory_plans_rw ON regulatory_data.statutory_plans;
CREATE POLICY statutory_plans_rw ON regulatory_data.statutory_plans
  USING (org_id IS NULL OR org_id = current_organization_id())
  WITH CHECK (org_id = current_organization_id());

DROP POLICY IF EXISTS jurisdiction_resolution_log_org ON regulatory_data.jurisdiction_resolution_log;
CREATE POLICY jurisdiction_resolution_log_org ON regulatory_data.jurisdiction_resolution_log
  USING (org_id = current_organization_id())
  WITH CHECK (org_id = current_organization_id());

COMMIT;

-- ── Verification (run after apply; expect: 2 authorities, 3 plans, >0 backfilled) ──
-- SELECT authority_code, authority_name, status, taluk_aliases
--   FROM regulatory_data.planning_authorities WHERE org_id IS NULL ORDER BY authority_code;
-- SELECT plan_code, plan_name, legal_status FROM regulatory_data.statutory_plans
--   WHERE org_id IS NULL ORDER BY plan_code;
-- SELECT sp.plan_code, count(*) FROM regulatory_data.far_rules fr
--   JOIN regulatory_data.statutory_plans sp ON sp.id = fr.statutory_plan_id
--   WHERE fr.org_id IS NULL GROUP BY sp.plan_code ORDER BY sp.plan_code;
