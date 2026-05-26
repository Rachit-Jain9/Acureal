-- ============================================================================
-- 20260618 — Link a deal's manual promoter profile to a K-RERA promoter
-- ============================================================================
-- Phase 1 / Pillar 6 — promoter cross-link.
--
-- Adds four columns to public.deal_promoter_profiles that record which
-- K-RERA promoter the operator has confirmed this deal's promoter maps to.
-- The K-RERA aggregate stats (delivery delay, lapsed projects, ongoing
-- count) then surface alongside the analyst's manually-verified findings as
-- a "what the public record shows" cross-check — never overwriting the
-- analyst's truth, only augmenting it.
--
-- Why a column (not a separate table): one promoter per deal already, the
-- profile already carries verified_by / verified_at provenance, and tenant
-- scoping is already enforced by the existing RLS policy. Adding columns
-- keeps the linkage co-located with the data it describes; no new RLS
-- policy, no new index strategy, no new join.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). Safe to re-run.
--
-- Dependencies:
--   - public.deal_promoter_profiles from 20260609_deal_promoter_profiles
--   - public.users from baseline schema
--   - regulatory_data.karnataka_rera_projects from 20260617 (data side)
-- ============================================================================

BEGIN;

ALTER TABLE public.deal_promoter_profiles
  ADD COLUMN IF NOT EXISTS linked_rera_promoter_name    TEXT,
  ADD COLUMN IF NOT EXISTS linked_rera_match_confidence NUMERIC(4, 3)
                            CHECK (linked_rera_match_confidence IS NULL
                                   OR (linked_rera_match_confidence >= 0
                                       AND linked_rera_match_confidence <= 1)),
  ADD COLUMN IF NOT EXISTS linked_rera_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS linked_rera_by               UUID
                            REFERENCES public.users(id) ON DELETE SET NULL;

-- Useful for the future "list every deal linked to promoter X" admin query.
-- Trigram'd because operators may search by partial promoter name.
CREATE INDEX IF NOT EXISTS deal_promoter_profiles_linked_rera_idx
  ON public.deal_promoter_profiles (linked_rera_promoter_name)
  WHERE linked_rera_promoter_name IS NOT NULL;

COMMENT ON COLUMN public.deal_promoter_profiles.linked_rera_promoter_name IS
  'The canonical promoter_name from regulatory_data.karnataka_rera_projects '
  'that this deal''s promoter has been confirmed to map to. NULL when the '
  'operator has not yet linked, or when no K-RERA match exists. Provenance: '
  'linked_rera_by / linked_rera_at. Match strength: linked_rera_match_confidence.';

COMMENT ON COLUMN public.deal_promoter_profiles.linked_rera_match_confidence IS
  'The trigram similarity (0..1) between the analyst-recorded promoter_name '
  'and the K-RERA promoter_name at the time of linking. 1.0 = exact match. '
  'Low values flag the link for operator review.';

COMMIT;

-- ── Verification (run as separate queries) ──────────────────────────────────
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name = 'deal_promoter_profiles'
--      AND column_name LIKE 'linked_rera%';
--   -- expect: 4 rows (linked_rera_promoter_name, linked_rera_match_confidence,
--   --                  linked_rera_at, linked_rera_by)
--
--   SELECT count(*)
--     FROM public.deal_promoter_profiles
--    WHERE linked_rera_promoter_name IS NOT NULL;
--   -- expect: 0 (no links recorded yet until operators confirm via UI)
