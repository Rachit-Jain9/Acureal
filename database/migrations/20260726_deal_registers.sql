-- ============================================================================
-- 20260726 — Deal Registers: rent roll / sales & collections / hotel / occupants
-- ============================================================================
-- The evidence-grade income substrate under the deterministic kernel. One
-- register per deal, with family-specific record tables:
--
--   deal_registers          parent — as-of date, denominator, settings, summary cache
--   register_snapshots      immutable as-of snapshots (IC traceability, staleness)
--   lease_records           Shape A — one row per lease/licence (7 asset classes)
--   sale_records            Shape B — plotted / free-sale inventory & collections
--   hotel_key_blocks        Shape C — room-type key inventory
--   hotel_contracts         Shape C — HMA / franchise / master-lease economics
--   hotel_operating_months  Shape C — ACTUAL monthly trading history (evidence;
--                           forecasting stays the kernel's job)
--   occupant_records        Shape C — redevelopment occupant entitlements/obligations
--
-- Derived metrics (WALE, MTM, occupancy, NOI, expiry ladders, funnels) are
-- NEVER stored per row — they are computed by backend/src/utils/rentRollMetrics.js.
-- The parent `summary` JSONB is a cache recomputed inside every mutation
-- transaction; exports always recompute from live rows.
--
-- Statuses are TEXT + CHECK (not PG enums) so value sets can evolve.
-- Money is absolute ₹ NUMERIC; areas are normalized to sqft at write time.
--
-- Follows the deal-scoped business-table pattern (deal_promoter_profiles):
-- organization_id defaults to current_organization_id(); RLS ENABLEd + FORCEd
-- with FOR ALL org-scope policies; soft delete via deleted_at/deleted_by with
-- partial live indexes.
--
-- Idempotent: every operation guarded by IF EXISTS / IF NOT EXISTS.
-- Safe to re-run.
--
-- Dependencies:
--   - public.current_organization_id() from 20260416_multitenancy_foundation
--   - public.deals, public.organizations, public.users, public.documents
-- ============================================================================

-- ── 1. Parent register ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.deal_registers (
  id                        BIGSERIAL PRIMARY KEY,
  deal_id                   UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  organization_id           UUID NOT NULL DEFAULT current_organization_id()
                              REFERENCES public.organizations(id) ON DELETE CASCADE,

  register_family           TEXT NOT NULL CHECK (register_family IN (
                              'lease_income', 'sales_collections',
                              'hotel_operating', 'redevelopment'
                            )),
  status                    TEXT NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'active')),

  -- The "rent roll as of" anchor date every derived metric is computed against.
  as_of_date                DATE,

  -- Occupancy denominator. Nullable — metrics fall back to the summed row
  -- areas (including vacant rows) and report which denominator was used.
  total_leasable_area_sqft  NUMERIC CHECK (
                              total_leasable_area_sqft IS NULL
                              OR total_leasable_area_sqft >= 0
                            ),
  area_display_unit         TEXT NOT NULL DEFAULT 'sqft'
                              CHECK (area_display_unit IN ('sqft', 'acres')),

  -- Per-register policies and per-class assumptions. Known keys include
  -- loi_policy ('include'|'exclude' — whether LOIs count toward committed
  -- occupancy; a visible policy, never an invisible filter).
  settings                  JSONB NOT NULL DEFAULT '{}',

  -- CACHE ONLY — recomputed by the service inside every mutation transaction.
  -- Never the source of truth; exports recompute from live rows.
  summary                   JSONB NOT NULL DEFAULT '{}',

  -- Last import provenance: template version, filename, file hash, parser
  -- version, row counts, timestamp.
  import_meta               JSONB NOT NULL DEFAULT '{}',

  created_by                UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by                UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMPTZ,
  deleted_by                UUID REFERENCES public.users(id) ON DELETE SET NULL
);

-- One LIVE register per deal (soft-deleted registers do not block a new one).
CREATE UNIQUE INDEX IF NOT EXISTS deal_registers_deal_live_uidx
  ON public.deal_registers (deal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS deal_registers_org_idx
  ON public.deal_registers (organization_id);

-- ── 2. Immutable snapshots ──────────────────────────────────────────────────
-- Frozen copies of the register (rows + computed metrics) taken on demand, on
-- Apply-to-Financials, and on export. Append-only: no UPDATE path exists in
-- the service; provenance and staleness checks compare snapshot ids + hashes.

CREATE TABLE IF NOT EXISTS public.register_snapshots (
  id               BIGSERIAL PRIMARY KEY,
  register_id      BIGINT NOT NULL REFERENCES public.deal_registers(id) ON DELETE CASCADE,
  deal_id          UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL DEFAULT current_organization_id()
                     REFERENCES public.organizations(id) ON DELETE CASCADE,

  label            TEXT,                 -- e.g. 'Applied to financials', 'XLSX export'
  trigger          TEXT NOT NULL DEFAULT 'manual'
                     CHECK (trigger IN ('manual', 'apply_to_financials', 'export', 'import')),
  as_of_date       DATE,
  records          JSONB NOT NULL,       -- frozen record rows at snapshot time
  metrics          JSONB NOT NULL,       -- rentRollMetrics output at snapshot time
  metrics_version  TEXT NOT NULL,
  data_hash        TEXT NOT NULL,        -- sha256 over canonicalized records

  created_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS register_snapshots_register_idx
  ON public.register_snapshots (register_id);
CREATE INDEX IF NOT EXISTS register_snapshots_org_idx
  ON public.register_snapshots (organization_id);

-- ── 3. Lease records (Shape A) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lease_records (
  id                          BIGSERIAL PRIMARY KEY,
  register_id                 BIGINT NOT NULL REFERENCES public.deal_registers(id) ON DELETE CASCADE,
  deal_id                     UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  organization_id             UUID NOT NULL DEFAULT current_organization_id()
                                REFERENCES public.organizations(id) ON DELETE CASCADE,
  position                    INTEGER NOT NULL DEFAULT 0,

  -- Identity
  record_label                TEXT,
  building                    TEXT,
  unit_ref                    TEXT,
  tenant_name                 TEXT,
  sector_use                  TEXT,

  -- Status drives metric eligibility:
  --   physical occupancy   = occupied, notice_served
  --   contracted           = + committed (executed lease, not yet commenced)
  --   committed (measure)  = + loi   (only under settings.loi_policy = 'include')
  --   vacant               = ERV / vacant-potential only, NEVER contracted revenue
  status                      TEXT NOT NULL DEFAULT 'vacant' CHECK (status IN (
                                'vacant', 'loi', 'committed', 'occupied',
                                'notice_served', 'expired'
                              )),

  -- Area & rent basis. Area is ALWAYS stored in sqft (acres × 43,560 at write);
  -- the raw entry is echoed in attributes.area_input for display fidelity.
  rent_basis                  TEXT NOT NULL DEFAULT 'per_sqft_month' CHECK (rent_basis IN (
                                'per_sqft_month', 'per_unit_month', 'per_acre_month'
                              )),
  chargeable_area_sqft        NUMERIC CHECK (
                                chargeable_area_sqft IS NULL OR chargeable_area_sqft >= 0
                              ),

  -- Dates
  lease_start                 DATE,
  rent_commencement           DATE,
  lease_expiry                DATE,
  lockin_end                  DATE,
  notice_period_months        NUMERIC,

  -- Economics (₹ absolute; rates per declared rent_basis per month)
  base_rent_rate              NUMERIC,
  cam_rate                    NUMERIC,
  -- CAM treatment decides whether CAM enters income (critique-adopted):
  cam_treatment               TEXT NOT NULL DEFAULT 'recovery' CHECK (cam_treatment IN (
                                'pass_through', 'recovery', 'included_in_rent', 'owner_borne'
                              )),
  ancillary_qty               NUMERIC,
  ancillary_rate_monthly      NUMERIC,
  other_income_monthly        NUMERIC,
  sales_revenue_base_annual   NUMERIC,   -- retail turnover base
  variable_rent_pct           NUMERIC,   -- retail % of sales
  escalation_pct              NUMERIC,
  escalation_every_months     INTEGER CHECK (
                                escalation_every_months IS NULL OR escalation_every_months > 0
                              ),
  -- Optional explicit stepped schedule: [{from_date, rate}] — when present it
  -- OVERRIDES escalation_pct/escalation_every_months in all derived math.
  rent_steps                  JSONB,
  rent_free_months            NUMERIC,
  deposit_months              NUMERIC,
  -- Actual negotiated deposit ₹ — the source of truth when present; the
  -- months-derived figure becomes a cross-check, not the value.
  security_deposit_amount     NUMERIC,
  gst_pct                     NUMERIC,   -- informational; excluded from rent/NOI metrics
  tds_pct                     NUMERIC,   -- informational; excluded from rent/NOI metrics
  collection_pct              NUMERIC,   -- feeds cash-adjusted NOI only, never accrual NOI
  market_rent_rate            NUMERIC,   -- same basis as base_rent_rate
  owner_opex_annual           NUMERIC,

  -- Per-class descriptors (whitelisted app-side from the shared column catalog):
  -- BHK/furnishing, plot+built-up, office grade/SEZ/fit-out, retail category/
  -- anchor/trading density, industrial clear height/docks/kVA, mixed-use
  -- component_asset_class/tower, raw-land permitted use/licence/premium.
  attributes                  JSONB NOT NULL DEFAULT '{}',

  -- Provenance
  source                      TEXT NOT NULL DEFAULT 'manual'
                                CHECK (source IN ('manual', 'import', 'extraction')),
  verified                    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Per-field evidence map {field: {source_document_id, verification_status,
  -- confidence}} — populated by the AI-extraction path.
  field_sources               JSONB NOT NULL DEFAULT '{}',
  source_document_id          UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  extraction_id               BIGINT,

  created_by                  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by                  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ,
  deleted_by                  UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS lease_records_register_live_idx
  ON public.lease_records (register_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS lease_records_deal_live_idx
  ON public.lease_records (deal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS lease_records_org_idx
  ON public.lease_records (organization_id);

-- ── 4. Sale records (Shape B) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sale_records (
  id                        BIGSERIAL PRIMARY KEY,
  register_id               BIGINT NOT NULL REFERENCES public.deal_registers(id) ON DELETE CASCADE,
  deal_id                   UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  organization_id           UUID NOT NULL DEFAULT current_organization_id()
                              REFERENCES public.organizations(id) ON DELETE CASCADE,
  position                  INTEGER NOT NULL DEFAULT 0,

  record_label              TEXT,      -- plot no. / unit no.
  block_phase               TEXT,
  unit_type                 TEXT,      -- plot use / configuration
  customer_name             TEXT,

  status                    TEXT NOT NULL DEFAULT 'unsold' CHECK (status IN (
                              'unsold', 'booked', 'sold', 'registered', 'cancelled'
                            )),

  area_sqft                 NUMERIC CHECK (area_sqft IS NULL OR area_sqft >= 0),
  base_price_per_sqft       NUMERIC,
  other_charges_amount      NUMERIC,   -- PLC + infra + club + other, ₹ absolute
  gst_pct                   NUMERIC,   -- informational
  agreement_value           NUMERIC,
  amount_collected          NUMERIC,
  amount_overdue            NUMERIC,
  current_market_rate       NUMERIC,   -- ₹/sqft, feeds unsold GDV / MTM

  booking_date              DATE,
  agreement_date            DATE,
  possession_date           DATE,

  -- Structured milestone rows: [{name, pct, amount, due_date, demanded,
  -- collected, collected_date}] — enough for funnels + receivables aging at
  -- underwriting stage; promote to a table if collection-event granularity is
  -- ever needed.
  payment_milestones        JSONB,

  attributes                JSONB NOT NULL DEFAULT '{}',

  source                    TEXT NOT NULL DEFAULT 'manual'
                              CHECK (source IN ('manual', 'import', 'extraction')),
  verified                  BOOLEAN NOT NULL DEFAULT FALSE,
  field_sources             JSONB NOT NULL DEFAULT '{}',
  source_document_id        UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  extraction_id             BIGINT,

  created_by                UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by                UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMPTZ,
  deleted_by                UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS sale_records_register_live_idx
  ON public.sale_records (register_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sale_records_deal_live_idx
  ON public.sale_records (deal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sale_records_org_idx
  ON public.sale_records (organization_id);

-- ── 5. Hotel key inventory (Shape C) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hotel_key_blocks (
  id                    BIGSERIAL PRIMARY KEY,
  register_id           BIGINT NOT NULL REFERENCES public.deal_registers(id) ON DELETE CASCADE,
  deal_id               UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  organization_id       UUID NOT NULL DEFAULT current_organization_id()
                          REFERENCES public.organizations(id) ON DELETE CASCADE,
  position              INTEGER NOT NULL DEFAULT 0,

  room_type             TEXT,
  keys_count            INTEGER CHECK (keys_count IS NULL OR keys_count >= 0),
  operational           BOOLEAN NOT NULL DEFAULT TRUE,
  ooo_pct               NUMERIC,   -- out-of-order %
  adr_premium_pct       NUMERIC,   -- premium/(discount) vs blended base ADR
  floor_wing            TEXT,

  attributes            JSONB NOT NULL DEFAULT '{}',

  source                TEXT NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('manual', 'import', 'extraction')),
  verified              BOOLEAN NOT NULL DEFAULT FALSE,
  field_sources         JSONB NOT NULL DEFAULT '{}',
  source_document_id    UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  extraction_id         BIGINT,

  created_by            UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by            UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,
  deleted_by            UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS hotel_key_blocks_register_live_idx
  ON public.hotel_key_blocks (register_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS hotel_key_blocks_org_idx
  ON public.hotel_key_blocks (organization_id);

-- ── 6. Hotel contracts (Shape C) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hotel_contracts (
  id                      BIGSERIAL PRIMARY KEY,
  register_id             BIGINT NOT NULL REFERENCES public.deal_registers(id) ON DELETE CASCADE,
  deal_id                 UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  organization_id         UUID NOT NULL DEFAULT current_organization_id()
                            REFERENCES public.organizations(id) ON DELETE CASCADE,
  position                INTEGER NOT NULL DEFAULT 0,

  record_label            TEXT,      -- contract ref
  operator_name           TEXT,
  brand                   TEXT,
  contract_type           TEXT CHECK (contract_type IS NULL OR contract_type IN (
                            'hma', 'franchise', 'master_lease', 'revenue_share', 'other'
                          )),
  start_date              DATE,
  end_date                DATE,
  lockin_end              DATE,
  notice_period_months    NUMERIC,
  base_fee_pct            NUMERIC,   -- of total revenue
  incentive_fee_pct       NUMERIC,   -- of GOP
  minimum_guarantee_annual NUMERIC,
  owner_priority_annual   NUMERIC,
  ffe_reserve_pct         NUMERIC,
  key_money               NUMERIC,
  security_deposit_amount NUMERIC,
  keys_covered            INTEGER,

  -- Performance test, termination rights, renewal options etc.
  attributes              JSONB NOT NULL DEFAULT '{}',

  source                  TEXT NOT NULL DEFAULT 'manual'
                            CHECK (source IN ('manual', 'import', 'extraction')),
  verified                BOOLEAN NOT NULL DEFAULT FALSE,
  field_sources           JSONB NOT NULL DEFAULT '{}',
  source_document_id      UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  extraction_id           BIGINT,

  created_by              UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by              UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ,
  deleted_by              UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS hotel_contracts_register_live_idx
  ON public.hotel_contracts (register_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS hotel_contracts_org_idx
  ON public.hotel_contracts (organization_id);

-- ── 7. Hotel operating months (Shape C — ACTUALS ONLY) ──────────────────────
-- Monthly trading history as DD evidence for operating hotels. The 36-month
-- FORECAST remains the deterministic kernel's job — this table never feeds
-- projections directly; it grounds them.

CREATE TABLE IF NOT EXISTS public.hotel_operating_months (
  id                       BIGSERIAL PRIMARY KEY,
  register_id              BIGINT NOT NULL REFERENCES public.deal_registers(id) ON DELETE CASCADE,
  deal_id                  UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  organization_id          UUID NOT NULL DEFAULT current_organization_id()
                             REFERENCES public.organizations(id) ON DELETE CASCADE,

  month                    DATE NOT NULL,   -- first of month
  occupancy_pct            NUMERIC,
  adr                      NUMERIC,
  room_revenue             NUMERIC,
  fnb_revenue              NUMERIC,
  other_revenue            NUMERIC,
  dept_expenses            NUMERIC,
  undistributed_expenses   NUMERIC,
  gop                      NUMERIC,
  fees_paid                NUMERIC,   -- base + incentive management fees
  ffe_reserve              NUMERIC,
  owner_noi                NUMERIC,

  attributes               JSONB NOT NULL DEFAULT '{}',

  source                   TEXT NOT NULL DEFAULT 'manual'
                             CHECK (source IN ('manual', 'import', 'extraction')),
  verified                 BOOLEAN NOT NULL DEFAULT FALSE,
  field_sources            JSONB NOT NULL DEFAULT '{}',
  source_document_id       UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  extraction_id            BIGINT,

  created_by               UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by               UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  deleted_by               UUID REFERENCES public.users(id) ON DELETE SET NULL
);

-- One live row per register-month.
CREATE UNIQUE INDEX IF NOT EXISTS hotel_operating_months_register_month_uidx
  ON public.hotel_operating_months (register_id, month) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS hotel_operating_months_org_idx
  ON public.hotel_operating_months (organization_id);

-- ── 8. Occupant records (Shape C — redevelopment) ───────────────────────────

CREATE TABLE IF NOT EXISTS public.occupant_records (
  id                         BIGSERIAL PRIMARY KEY,
  register_id                BIGINT NOT NULL REFERENCES public.deal_registers(id) ON DELETE CASCADE,
  deal_id                    UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  organization_id            UUID NOT NULL DEFAULT current_organization_id()
                               REFERENCES public.organizations(id) ON DELETE CASCADE,
  position                   INTEGER NOT NULL DEFAULT 0,

  record_label               TEXT,      -- existing unit ref
  building                   TEXT,      -- existing building / wing
  occupant_name              TEXT,
  occupancy_type             TEXT,      -- owner / tenant / commercial / other
  agreement_status           TEXT,      -- e.g. 'Registered PAAA', free text

  status                     TEXT NOT NULL DEFAULT 'in_place' CHECK (status IN (
                               'in_place', 'vacated', 'disputed'
                             )),

  existing_carpet_area_sqft  NUMERIC,
  rehab_entitlement_sqft     NUMERIC,   -- base entitlement
  additional_area_sqft       NUMERIC,   -- fungible / additional
  transit_rent_monthly       NUMERIC,
  transit_rent_start         DATE,
  transit_rent_end           DATE,
  transit_rent_escalation_pct NUMERIC,  -- annual
  shifting_allowance         NUMERIC,
  brokerage_amount           NUMERIC,
  corpus_amount              NUMERIC,
  other_obligation_amount    NUMERIC,
  rehab_possession_target    DATE,
  documentation_risk         TEXT CHECK (documentation_risk IS NULL OR documentation_risk IN (
                               'low', 'medium', 'high'
                             )),

  attributes                 JSONB NOT NULL DEFAULT '{}',

  source                     TEXT NOT NULL DEFAULT 'manual'
                               CHECK (source IN ('manual', 'import', 'extraction')),
  verified                   BOOLEAN NOT NULL DEFAULT FALSE,
  field_sources              JSONB NOT NULL DEFAULT '{}',
  source_document_id         UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  extraction_id              BIGINT,

  created_by                 UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by                 UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                 TIMESTAMPTZ,
  deleted_by                 UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS occupant_records_register_live_idx
  ON public.occupant_records (register_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS occupant_records_deal_live_idx
  ON public.occupant_records (deal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS occupant_records_org_idx
  ON public.occupant_records (organization_id);

-- ── RLS: ENABLE + FORCE + org-scope FOR ALL on every table ──────────────────

ALTER TABLE public.deal_registers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_registers         FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.register_snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.register_snapshots     FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.lease_records          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lease_records          FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.sale_records           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_records           FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.hotel_key_blocks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_key_blocks       FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.hotel_contracts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_contracts        FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.hotel_operating_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_operating_months FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.occupant_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.occupant_records       FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_registers_org_scope ON public.deal_registers;
CREATE POLICY deal_registers_org_scope ON public.deal_registers
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS register_snapshots_org_scope ON public.register_snapshots;
CREATE POLICY register_snapshots_org_scope ON public.register_snapshots
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS lease_records_org_scope ON public.lease_records;
CREATE POLICY lease_records_org_scope ON public.lease_records
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS sale_records_org_scope ON public.sale_records;
CREATE POLICY sale_records_org_scope ON public.sale_records
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS hotel_key_blocks_org_scope ON public.hotel_key_blocks;
CREATE POLICY hotel_key_blocks_org_scope ON public.hotel_key_blocks
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS hotel_contracts_org_scope ON public.hotel_contracts;
CREATE POLICY hotel_contracts_org_scope ON public.hotel_contracts
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS hotel_operating_months_org_scope ON public.hotel_operating_months;
CREATE POLICY hotel_operating_months_org_scope ON public.hotel_operating_months
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS occupant_records_org_scope ON public.occupant_records;
CREATE POLICY occupant_records_org_scope ON public.occupant_records
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- ── Comments ────────────────────────────────────────────────────────────────

COMMENT ON TABLE public.deal_registers IS
  'One live register per deal: the evidence-grade income substrate (rent roll / '
  'sales & collections / hotel operating / redevelopment occupants). summary is '
  'a cache recomputed in-transaction; derived metrics live in code, never rows.';
COMMENT ON TABLE public.register_snapshots IS
  'Immutable as-of snapshots of a register (rows + metrics + hash). Append-only; '
  'taken on demand, on Apply-to-Financials, and on export. Anchors provenance '
  'and staleness checks.';
COMMENT ON TABLE public.lease_records IS
  'Shape A: one row per lease/licence. Status drives metric eligibility — vacant '
  'rows feed ERV potential, never contracted revenue. Rates are gross (pre '
  'JDA/JV share); money in absolute ₹; area normalized to sqft.';
COMMENT ON TABLE public.sale_records IS
  'Shape B: plotted / free-sale inventory with collections. payment_milestones '
  'holds structured milestone rows for funnels and receivables aging.';
COMMENT ON TABLE public.hotel_operating_months IS
  'Actual monthly trading history (occupancy/ADR/GOP/NOI) as DD evidence. '
  'Forecasting stays the deterministic kernel''s job.';
COMMENT ON TABLE public.occupant_records IS
  'Redevelopment occupant entitlements and obligations (rehab area, transit '
  'rent, corpus/shifting/brokerage), with documentation risk.';

-- ── Verification (run as separate queries) ──────────────────────────────────
--   SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--    WHERE relname IN ('deal_registers','register_snapshots','lease_records',
--                      'sale_records','hotel_key_blocks','hotel_contracts',
--                      'hotel_operating_months','occupant_records')
--      AND relnamespace = 'public'::regnamespace;
--   -- expect: 8 rows, all t, t
--
--   SELECT count(*) FROM public.deal_registers;
--   -- expect: 0 (no rows until a deal opens its register)
