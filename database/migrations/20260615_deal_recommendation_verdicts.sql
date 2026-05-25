-- 20260615_deal_recommendation_verdicts.sql
--
-- Operational store for per-recommendation operator verdicts (PR-C). When an
-- operator dismisses or snoozes a Recommendation Engine card, the verdict is
-- (a) persisted here so the workspace hides it on subsequent loads, and (b)
-- captured as a Layer-5 `recommendation_verdict` improvement_signals row so
-- the data flywheel records which rules operators consistently dismiss.
--
-- One row per (deal_id, rule_id). UPSERT replaces the previous verdict — an
-- operator who snoozes then later dismisses doesn't accrete history rows.
-- The Layer-5 telemetry table carries the immutable event log; this table
-- carries the current state.
--
-- Snooze model:
--   • `snooze_until` is the absolute time the snooze expires. The workspace
--     hides snoozed cards while NOW() < snooze_until; otherwise they reappear.
--   • `snooze_until_snapshot_change` is true for "Until inputs change" — the
--     workspace then hides the card only while the active snapshot_hash
--     matches `snoozed_at_snapshot_hash`.
--
-- Migration-tolerant: the recommendation engine + UI both work without this
-- table being applied (verdict capture just silently no-ops).
--
-- Operator action required: apply via Supabase SQL editor.
--   🌐 https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new
--   📋 paste this file → Run → expect "Success. No rows returned."

BEGIN;

CREATE TABLE IF NOT EXISTS deal_recommendation_verdicts (
  id                              BIGSERIAL PRIMARY KEY,
  organization_id                 UUID NOT NULL,
  deal_id                         UUID NOT NULL,
  rule_id                         TEXT NOT NULL,
  verdict                         TEXT NOT NULL CHECK (verdict IN ('acted', 'dismissed', 'snoozed')),
  reason                          TEXT,
  snooze_until                    TIMESTAMPTZ,
  snooze_until_snapshot_change    BOOLEAN NOT NULL DEFAULT FALSE,
  snoozed_at_snapshot_hash        TEXT,
  created_by                      UUID,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (deal_id, rule_id)
);

CREATE INDEX IF NOT EXISTS deal_recommendation_verdicts_by_deal
  ON deal_recommendation_verdicts (deal_id, updated_at DESC);

ALTER TABLE deal_recommendation_verdicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_recommendation_verdicts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_recommendation_verdicts_org_isolation ON deal_recommendation_verdicts;
CREATE POLICY deal_recommendation_verdicts_org_isolation
  ON deal_recommendation_verdicts
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Extend the improvement_signals CHECK constraint to accept the new signal
-- type. The constraint name is the canonical name from migration 20260608.
ALTER TABLE public.improvement_signals
  DROP CONSTRAINT IF EXISTS improvement_signals_signal_type_check;

ALTER TABLE public.improvement_signals
  ADD CONSTRAINT improvement_signals_signal_type_check
  CHECK (signal_type IN (
    'extraction_field_review',
    'comp_reliance',
    'extraction_field_verdict',
    'recommendation_verdict'
  ));

COMMIT;
