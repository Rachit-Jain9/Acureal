-- ============================================================================
-- 20260611 — Extraction field verdicts (Workstream C — the standing
--            extraction-quality system)
-- ============================================================================
-- REDIP's moat is network learning: each deal worked should make the next one
-- smarter. Workstream C1 (PR-NX112) captured which comparables an analyst
-- relies on. This is the document-extraction equivalent: when an operator
-- reviews AI-extracted document fields and applies them to a deal, record —
-- per field — whether they used the AI's value unchanged (`accepted`) or
-- corrected it (`overridden`).
--
-- That is the genuine ground truth a "which fields does the model get wrong"
-- quality metric needs, and a useful "these extracted fields were human-
-- verified" record on the deal in its own right.
--
-- Two pieces, mirroring the comp-reliance pattern (20260610):
--
--   1. public.extraction_field_verdicts — the durable operational state. One
--      row per (extraction, canonical field) the operator applied; the row
--      records the verdict. Re-applying updates the verdict in place (it is
--      current state, not an event log). Follows the deal-scoped business-table
--      pattern (dd_items / risk_flags / deal_comp_reliance): organization_id
--      defaults to current_organization_id(); RLS is FORCEd with a FOR ALL
--      policy. The table is values-free — it stores the field KEY and metadata,
--      never the field VALUE (those live on document_extractions / the deal).
--
--   2. The improvement_signals.signal_type CHECK is widened to also accept
--      `extraction_field_verdict`, so every apply ALSO appends a values-free
--      Layer-5 learning signal (via learningSignals.service.js) — the append-
--      only event log behind the standing quality metric.
--
-- Idempotent: every operation guarded by IF EXISTS / IF NOT EXISTS, and the
-- CHECK constraint is dropped-then-re-added. Safe to re-run.
--
-- Dependencies:
--   - public.current_organization_id() from 20260416_multitenancy_foundation
--   - public.document_extractions, public.deals, public.organizations,
--     public.users from the baseline schema
--   - public.improvement_signals from 20260608_improvement_signals
-- ============================================================================

-- ── 1. Operational state — the human verdict on each applied extracted field ─

CREATE TABLE IF NOT EXISTS public.extraction_field_verdicts (
  id              BIGSERIAL PRIMARY KEY,
  extraction_id   UUID NOT NULL REFERENCES public.document_extractions(id) ON DELETE CASCADE,
  -- The deal the field was applied to. Denormalised from the extraction for
  -- deal-scoped reads; nullable because an extraction need not have a deal.
  deal_id         UUID REFERENCES public.deals(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL DEFAULT current_organization_id()
                    REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- The ontology canonical field key (e.g. 'survey_number', 'land_area_sqft').
  -- A schema name, never a value — this keeps the table values-free.
  canonical_field TEXT NOT NULL,
  -- The raw extraction key the canonical field mapped from (provenance).
  source_field    TEXT,
  doc_type        TEXT,
  ai_provider     TEXT,
  -- The AI's confidence on this field at extraction time, [0,1] or NULL.
  ai_confidence   NUMERIC(4,3),

  -- The operator's verdict: did they use the AI value as-is, or change it?
  verdict         TEXT NOT NULL CHECK (verdict IN ('accepted', 'overridden')),

  -- Provenance — who applied this field, and when.
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One current verdict per (extraction, canonical field). Re-applying the
  -- same extraction upserts the verdict — operational state, not a log.
  UNIQUE (extraction_id, canonical_field)
);

CREATE INDEX IF NOT EXISTS extraction_field_verdicts_deal_idx
  ON public.extraction_field_verdicts (deal_id);
-- The accuracy read-model filters by org + a trailing created_at window.
CREATE INDEX IF NOT EXISTS extraction_field_verdicts_org_created_idx
  ON public.extraction_field_verdicts (organization_id, created_at DESC);

ALTER TABLE public.extraction_field_verdicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_field_verdicts FORCE ROW LEVEL SECURITY;

-- Tenant scoping — identical posture to dd_items / risk_flags /
-- deal_comp_reliance: every read and write is confined to the caller's org.
DROP POLICY IF EXISTS extraction_field_verdicts_org_scope ON public.extraction_field_verdicts;
CREATE POLICY extraction_field_verdicts_org_scope
  ON public.extraction_field_verdicts
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

COMMENT ON TABLE public.extraction_field_verdicts IS
  'Workstream C: the human verdict (accepted / overridden) on each AI-extracted '
  'document field an operator applied to a deal. Durable operational state '
  '(one current verdict per extraction+field); each apply also appends an '
  'extraction_field_verdict learning signal to improvement_signals. Values-free '
  '— stores field keys and metadata, never field values.';

-- ── 2. Widen the improvement_signals signal_type CHECK ──────────────────────
-- 20260608 permitted `extraction_field_review`; 20260610 added `comp_reliance`.
-- Drop-then-re-add so the migration stays re-runnable. `extraction_field_review`
-- is kept as a historical signal type — enum values are never removed.

ALTER TABLE public.improvement_signals
  DROP CONSTRAINT IF EXISTS improvement_signals_signal_type_check;

ALTER TABLE public.improvement_signals
  ADD CONSTRAINT improvement_signals_signal_type_check
  CHECK (signal_type IN (
    'extraction_field_review',
    'comp_reliance',
    'extraction_field_verdict'
  ));

-- ── Verification (run as separate queries) ──────────────────────────────────
--   SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--    WHERE relname = 'extraction_field_verdicts'
--      AND relnamespace = 'public'::regnamespace;
--   -- expect: t, t
--
--   SELECT count(*) FROM public.extraction_field_verdicts;
--   -- expect: 0 (no rows until an operator applies an AI-extracted field)
