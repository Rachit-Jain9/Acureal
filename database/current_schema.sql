-- ============================================================================
-- REDIP — Schema consolidation manifest (P7)
-- Last reviewed: 2026-04-30
-- ============================================================================
-- This file is NOT applied directly. It is the *ordered manifest* of every
-- migration in `database/migrations/`. New environments (Supabase preview
-- branches, local dev, fresh staging) should apply the listed files in the
-- exact order shown — they are date-sorted and idempotent (each guarded by
-- IF NOT EXISTS / DROP IF EXISTS).
--
-- To rebuild a fresh database:
--   1. Apply core extensions:  uuid-ossp, pgcrypto, postgis, pg_trgm
--      (handled inside migrations themselves where required)
--   2. Apply the migration files below in listed order.
--   3. Run the seed inserts inside `20260420_master_plan.sql` and
--      `20260427_masterplan_guidance_intake.sql` for the 27 RMP 2031 Draft
--      FAR rows (org_id IS NULL — global reference).
--
-- Production source of truth: Supabase project `lsbhrbvuynzqhdtzczco`,
-- `supabase_migrations.schema_migrations` table.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Phase 0 — foundation (organizations, users, deals, properties, documents)
-- ────────────────────────────────────────────────────────────────────────────
\i 20260327_remove_demo_records.sql
\i 20260327_workflow_upgrade.sql
\i 20260331_financials_asset_class.sql
\i 20260331_market_notes.sql
\i 20260403_bengaluru_comps_seed.sql
\i 20260403_rls_and_security.sql
\i 20260404_market_data.sql

-- ────────────────────────────────────────────────────────────────────────────
-- Phase 1 — deal-centric expansion + multi-tenancy hardening
-- ────────────────────────────────────────────────────────────────────────────
\i 20260411_deal_centric_expansion.sql
\i 20260411_documents_and_security_alignment.sql
\i 20260413_exchange_rates.sql
\i 20260413_property_geocode_enhancement.sql
\i 20260413_rls_fix.sql
\i 20260416_deal_shares.sql
\i 20260416_enforce_org_scoping.sql
\i 20260416_merge_bangalore_bengaluru.sql
\i 20260416_multitenancy_foundation.sql

-- ────────────────────────────────────────────────────────────────────────────
-- Phase 2 — intelligence / financials / waterfall / deal events
-- ────────────────────────────────────────────────────────────────────────────
\i 20260418_intelligence_monitoring.sql
\i 20260419_financial_scenarios_and_waterfall.sql
\i 20260422_deal_events.sql            -- HMAC-signed audit trail (deal_events)

-- ────────────────────────────────────────────────────────────────────────────
-- Phase 3 — parcel intelligence + evidence vault (regulatory_data schema)
-- ────────────────────────────────────────────────────────────────────────────
\i 20260420_master_plan.sql                    -- master_plan_zones, far_rules, guidance_values base
\i 20260425_parcel_intelligence_phase1.sql     -- evidence_sources, evidence_facts, kgis_cache, snapshots
\i 20260425_parcel_intelligence_phase1_1.sql   -- evidence_facts indexes + relations
\i 20260425_evidence_ingestion_indexes.sql     -- pg_trgm gin indexes on guidance_values
\i 20260426_ai_call_logs.sql                   -- AI telemetry (cost / latency / failures)
\i 20260426_evidence_links.sql                 -- polymorphic evidence_links
\i 20260427_masterplan_guidance_intake.sql     -- 27 RMP 2031 Draft FAR rows (seed)
\i 20260428_parcel_intelligence_signature.sql  -- HMAC snapshot signing (T4)
\i 20260429_osm_road_cache.sql                 -- OSM Overpass road-width cache (T6)
\i 20260430_source_document_registry_metadata.sql -- source authority/status/OCR metadata

-- ────────────────────────────────────────────────────────────────────────────
-- Phase 4 — RLS hardening (Bet 2 from 2026-04-29 audit)
-- ────────────────────────────────────────────────────────────────────────────
\i 20260430_users_rls_and_summary_invoker.sql  -- public.users RLS + deal_summary as security_invoker
\i 20260430_function_search_path_lockdown.sql  -- pin search_path on REDIP functions
\i 20260430_feature_flag_cohorts_write_policy.sql -- drop USING(true) write policy
\i 20260430_unindexed_fk_covering_indexes.sql  -- 38 CREATE INDEX CONCURRENTLY for FK coverage
\i 20260430_rls_no_policy_tables.sql           -- policies for the 5 RLS-on-no-policy tables

-- ============================================================================
-- After applying:
--   1. Verify: SELECT COUNT(*) FROM regulatory_data.far_rules WHERE org_id IS NULL;
--      → expect 27 (RMP 2031 Draft Zones A–B, residential + commercial)
--   2. Set required env vars on the deployment target:
--        DATABASE_URL                — Supabase connection string
--        JWT_SECRET                  — token signing
--        DEAL_EVENTS_HMAC_KEY        — financial audit trail signing
--        PARCEL_SIGNING_SECRET       — parcel snapshot signing (T4)
--        GEMINI_API_KEY              — document extraction
--        ANTHROPIC_API_KEY           — Claude reasoning
--        BLOB_READ_WRITE_TOKEN       — Vercel Blob (or Supabase Storage equivalent)
--        SUPABASE_URL / SUPABASE_KEY — server-side admin client
--        CRON_SECRET                 — Vercel cron auth (P4)
--   3. (Optional) Apply UI smoke check via run-redip.ps1 fullstack and exercise the
--      compose chain: deal → property → upload RMP PDF → extract → review → snapshot.
-- ============================================================================
