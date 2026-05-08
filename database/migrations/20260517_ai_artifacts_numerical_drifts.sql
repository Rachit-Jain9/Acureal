-- ============================================================================
-- 0063 — ai_artifacts: numerical_drifts + verified_at columns
-- ============================================================================
-- Tier-1 #3 from the 2026-05-08 handoff: post-hoc numerical verifier.
--
-- The system prompts behind every AI-generated narrative (deal analysis,
-- IC memo draft, risk brief, parcel narrative) instruct Claude to ground
-- every number in the supplied context. CLAUDE.md's "never fabricate"
-- hard rule reinforces this. But until now nothing CHECKED the output —
-- if Claude hallucinated a 22% IRR when the model says 18.5%, no
-- automated guardrail caught it.
--
-- This migration adds the two columns the verifier service writes to:
--
--   numerical_drifts (JSONB, nullable)
--     Array of detected drifts. Each element:
--       {
--         "field":     "irr_pct" | "total_revenue_cr" | "land_area_acres" | ...,
--         "claimed":   <number from the narrative text>,
--         "snapshot":  <number from the deterministic financial / property model>,
--         "delta_pct": <abs(claimed - snapshot) / snapshot * 100>,
--         "severity":  "high" (>10%) | "medium" (5-10%) | "low" (<5%),
--         "claim_context": "<~80 chars of surrounding text from the narrative>"
--       }
--     NULL means the verifier hasn't run yet. [] means it ran and found
--     no drifts. A non-empty array means human review is needed.
--
--   verified_at (TIMESTAMPTZ, nullable)
--     When the verifier last evaluated this artifact. Lets us re-verify
--     stale rows on demand without re-running Claude.
--
-- Per CLAUDE.md hard rules:
--   - The verifier never auto-corrects. It only flags. The narrative
--     stays exactly as Claude wrote it; the UI surfaces drifts as a
--     review prompt next to the existing "AI-assisted — requires human
--     review" disclaimer.
--   - All math is deterministic JS in the verifier service. Zero LLM
--     calls in the verification path.
--
-- Idempotent — every operation guarded by IF NOT EXISTS.
-- ============================================================================

BEGIN;

ALTER TABLE public.ai_artifacts
  ADD COLUMN IF NOT EXISTS numerical_drifts JSONB,
  ADD COLUMN IF NOT EXISTS verified_at      TIMESTAMPTZ;

-- Partial index for "show me artifacts that need a human look" queries.
-- We don't index empty arrays or nulls because they're the boring case;
-- only rows with a real flag count are worth indexing.
CREATE INDEX IF NOT EXISTS ai_artifacts_drifts_present_idx
  ON public.ai_artifacts (deal_id, generated_at DESC)
  WHERE numerical_drifts IS NOT NULL
    AND jsonb_array_length(numerical_drifts) > 0;

COMMENT ON COLUMN public.ai_artifacts.numerical_drifts IS
  'Array of detected drifts between numbers claimed in content_md and the deterministic snapshot. NULL if verifier has not run, [] if it ran and found nothing, non-empty array means human review needed. Written by services/numericalVerifier.service.js.';

COMMENT ON COLUMN public.ai_artifacts.verified_at IS
  'When the post-hoc numerical verifier last evaluated this artifact.';

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'ai_artifacts'
--      AND column_name IN ('numerical_drifts', 'verified_at');
--   -- expect: 2 rows
