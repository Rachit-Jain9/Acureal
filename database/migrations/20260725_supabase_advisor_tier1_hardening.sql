-- 20260725_supabase_advisor_tier1_hardening.sql
--
-- Tier-1 SAFE remediations from the 2026-07-08 Supabase advisor pass.
-- Additive / hardening only — does NOT touch tenant RLS policies (those are
-- Tier-2: a separate reviewed migration + tenant-isolation retest). The
-- multi-tenant isolation on deal data was verified SOLID and holding; this is
-- cleanup, not a breach fix. Every statement is idempotent and safe to re-paste.
-- Applied to production 2026-07-08 via the Supabase MCP.
--
-- Object existence verified against prod first:
--   spatial_ref_sys RLS = disabled; both duplicate indexes present;
--   deal_signoffs.document_id + yield_studies.property_id NOT yet indexed
--   (comp_id / document_embeddings.document_id already were — skipped);
--   st_estimatedextent has 3 overloads (text,text | text,text,text | +boolean).

-- 1) Close the one advisor ERROR: RLS disabled on public.spatial_ref_sys.
--    Non-sensitive PostGIS reference data. Server geocoding uses the service
--    role (BYPASSRLS) so it is unaffected; a permissive SELECT policy keeps any
--    client-side SRS lookups working. Guarded: spatial_ref_sys is PostGIS-owned
--    on some projects, so if this role lacks ownership we skip rather than fail
--    the whole migration (the advisory simply remains).
DO $$
BEGIN
  ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'spatial_ref_sys'
      AND policyname = 'spatial_ref_sys_read'
  ) THEN
    CREATE POLICY spatial_ref_sys_read ON public.spatial_ref_sys FOR SELECT USING (true);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'skipped spatial_ref_sys RLS (PostGIS-managed / not owner): %', SQLERRM;
END $$;

-- 2) Drop two redundant duplicate indexes (each identical to a constraint /
--    pkey index that stays).
DROP INDEX IF EXISTS public.idx_intelligence_briefs_org_date_scope;
DROP INDEX IF EXISTS public.idx_market_notes_org_section;

-- 3) Covering indexes on the two high-value unindexed foreign keys that were
--    NOT already indexed. (deal_comp_reliance.comp_id and
--    document_embeddings.document_id already carry a leading-column index.)
CREATE INDEX IF NOT EXISTS idx_deal_signoffs_document_id ON public.deal_signoffs(document_id);
CREATE INDEX IF NOT EXISTS idx_yield_studies_property_id ON public.yield_studies(property_id);

-- 4) Remove anon/authenticated EXECUTE on the PostGIS SECURITY DEFINER extent
--    estimators (minor info-leak / DoS RPC surface via /rest/v1/rpc; no tenant
--    data). Guarded: PostGIS-owned functions may reject the REVOKE — skip if so.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.st_estimatedextent(text, text) FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.st_estimatedextent(text, text, text) FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.st_estimatedextent(text, text, text, boolean) FROM anon, authenticated;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'skipped st_estimatedextent REVOKE (PostGIS-managed / not owner): %', SQLERRM;
END $$;
