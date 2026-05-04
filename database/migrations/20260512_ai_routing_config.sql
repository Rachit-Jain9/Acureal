-- ============================================================================
-- 0048 — ai_routing_config: runtime-editable task → provider map
-- ============================================================================
-- Today the task → provider routing is hardcoded in providerRegistry.js
-- with env-var overrides (AI_PROVIDER_REASONING etc). Changing a default
-- requires a code change + redeploy. That's friction that prevents
-- empirical A/B testing (e.g. "does GPT-4o or Claude write a better deal
-- analysis?") and slows incident response when a provider degrades.
--
-- This table makes the routing decision a single UPDATE. Resolution order
-- on every AI call:
--   1. ai_routing_config row for this task   ← runtime config
--   2. AI_PROVIDER_<TASK> env var             ← deploy-time override
--   3. Code default                            ← hardcoded fallback
--
-- The router caches the table for 60 seconds in-memory so the lookup is
-- effectively free and an admin's edit propagates within a minute.
--
-- Admin/owner-only writes (RLS). Public read so all server-side callers can
-- see the config without elevation.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_routing_config (
  task               TEXT PRIMARY KEY,
  provider           TEXT NOT NULL,
  model              TEXT,
  fallback_provider  TEXT,
  fallback_model     TEXT,
  notes              TEXT,
  last_changed_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  last_changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ai_routing_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_routing_config_select ON public.ai_routing_config;
CREATE POLICY ai_routing_config_select ON public.ai_routing_config
  FOR SELECT USING (true);

DROP POLICY IF EXISTS ai_routing_config_admin_write ON public.ai_routing_config;
CREATE POLICY ai_routing_config_admin_write ON public.ai_routing_config
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.users
     WHERE users.id = current_user_id()
       AND users.role = 'admin'::user_role
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
     WHERE users.id = current_user_id()
       AND users.role = 'admin'::user_role
  ));

-- Seed with current defaults so the first read returns something.
INSERT INTO public.ai_routing_config (task, provider, model, fallback_provider, fallback_model, notes)
VALUES
  ('document_classification', 'gemini', NULL, 'claude', NULL, 'Native multimodal classification on document upload.'),
  ('document_extraction',     'gemini', NULL, 'claude', NULL, 'Doc extraction. Claude takes over with full document context on Gemini failure.'),
  ('translation',             'gemini', NULL, NULL,     NULL, 'Multilingual translation; consider Bhashini adapter for Indic-only.'),
  ('reasoning',               'claude', NULL, 'openai', NULL, 'Per-deal analysis + IC memo. Claude Sonnet 4.6 default.'),
  ('market_synthesis',        'claude', NULL, 'openai', NULL, 'Daily market brief. Claude Sonnet 4.6 default.')
ON CONFLICT (task) DO NOTHING;

COMMENT ON TABLE  public.ai_routing_config IS 'Runtime-editable task -> provider/model map for AI calls. Falls back to env vars and code defaults on miss. Admin-only writes via RLS.';

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT to_regclass('public.ai_routing_config');
--   SELECT * FROM public.ai_routing_config ORDER BY task;
