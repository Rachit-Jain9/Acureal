-- 20260711_far_rules_default_pending.sql
-- ----------------------------------------------------------------------------
-- Close the lone auto-approve hole on the regulatory tables.
--
-- regulatory_data.far_rules is the only one of the five regulatory tables whose
-- review_status defaults to 'approved'. Its siblings — master_plan_zones,
-- master_plan_documents, evidence_facts, guidance_values — all default to
-- 'pending' (default-deny). A FAR rule is the single most consequential
-- regulatory fact in the system: loadFarRules() reads ONLY review_status =
-- 'approved' rows and feeds them straight into buildable-area / FSI screening.
--
-- Today both live insert paths set review_status explicitly (the RMP-2015 seed
-- writes 'approved'; createManualFarRule writes 'pending'), so flipping the
-- column default is BEHAVIOR-NEUTRAL for current callers. It purely removes the
-- latent risk that a future bulk import, external tool, or new code path that
-- omits review_status would auto-publish an UNREVIEWED FAR rule directly into
-- screening — silently bypassing the human review gate the legal/regulatory
-- lanes require. Default-deny is the correct posture for this table.
--
-- Idempotent: re-running SET DEFAULT to the same value is a no-op. No data is
-- mutated; existing rows keep whatever review_status they already carry.

BEGIN;

ALTER TABLE regulatory_data.far_rules
  ALTER COLUMN review_status SET DEFAULT 'pending';

COMMIT;

-- Verify (read-only, run after commit):
--   SELECT column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'regulatory_data'
--      AND table_name   = 'far_rules'
--      AND column_name  = 'review_status';
--   -- expect: 'pending'::character varying
