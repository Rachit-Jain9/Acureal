-- ============================================================================
-- 0033 — Cover the 38 unindexed foreign keys flagged by the perf advisor
-- ============================================================================
-- Closes the 38 `unindexed_foreign_keys` lints from the 2026-04-29 audit.
--
-- Why this matters: every FK without a covering index forces a sequential
-- scan on the referencing table whenever Postgres needs to enforce the
-- constraint (cascading deletes, NOT VALID validations, plan rewrites that
-- decide whether the FK relationship can be exploited). On a 50k-row deals
-- table, a `DELETE FROM users WHERE id = $1` would force a seq scan over
-- every table that has `*_by` or `*_id` columns pointing at users.
--
-- Each index here covers a single FK column. Naming convention:
--   idx_<table>_<column>
--
-- Uses CREATE INDEX CONCURRENTLY so existing reads/writes are not blocked
-- during creation. CONCURRENTLY cannot run inside a transaction block, so
-- this migration is intentionally NOT wrapped in BEGIN/COMMIT — each
-- statement runs in its own implicit transaction.
--
-- IF NOT EXISTS guards every CREATE so the file is idempotent. Re-running
-- after partial application (e.g. one CONCURRENTLY index built but a later
-- one timed out and left an INVALID index) is safe; the failed index can
-- be cleaned up with `DROP INDEX CONCURRENTLY` separately.
-- ============================================================================

-- ── public schema (24 indexes) ──────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_completed_by                              ON public.activities (completed_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_call_logs_created_by                              ON public.ai_call_logs (created_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_approval_items_document_id                           ON public.approval_items (document_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comps_created_by                                     ON public.comps (created_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dd_items_assigned_to                                 ON public.dd_items (assigned_to);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dd_items_completed_by                                ON public.dd_items (completed_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dd_items_document_id                                 ON public.dd_items (document_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deal_events_actor_id                                 ON public.deal_events (actor_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deal_stage_history_changed_by                        ON public.deal_stage_history (changed_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_archived_by                                    ON public.deals (archived_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_extractions_reviewed_by                     ON public.document_extractions (reviewed_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evidence_links_created_by                            ON public.evidence_links (created_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evidence_links_verified_by                           ON public.evidence_links (verified_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_intelligence_briefs_created_by                       ON public.intelligence_briefs (created_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_investor_package_snapshots_organization_id           ON public.investor_package_snapshots (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_notes_updated_by                              ON public.market_notes (updated_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organization_invitations_accepted_by                 ON public.organization_invitations (accepted_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organization_invitations_invited_by                  ON public.organization_invitations (invited_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organization_members_invited_by                      ON public.organization_members (invited_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_created_by                             ON public.organizations (created_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_updated_by                                ON public.properties (updated_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_zone_assigned_by                          ON public.properties (zone_assigned_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_risk_flags_created_by                                ON public.risk_flags (created_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_default_organization_id                        ON public.users (default_organization_id);

-- ── regulatory_data schema (14 indexes) ─────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evidence_facts_created_by                            ON regulatory_data.evidence_facts (created_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evidence_facts_reviewed_by                           ON regulatory_data.evidence_facts (reviewed_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evidence_sources_created_by                          ON regulatory_data.evidence_sources (created_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evidence_sources_document_id                         ON regulatory_data.evidence_sources (document_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evidence_sources_reviewed_by                         ON regulatory_data.evidence_sources (reviewed_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_far_rules_zone_id                                    ON regulatory_data.far_rules (zone_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kgis_cache_org_id                                    ON regulatory_data.kgis_cache (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kgis_cache_property_id                               ON regulatory_data.kgis_cache (property_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_master_plan_documents_evidence_source_id             ON regulatory_data.master_plan_documents (evidence_source_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_master_plan_zones_document_id                        ON regulatory_data.master_plan_zones (document_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_master_plan_zones_reviewed_by                        ON regulatory_data.master_plan_zones (reviewed_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_parcel_intelligence_snapshots_generated_by           ON regulatory_data.parcel_intelligence_snapshots (generated_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_parcel_intelligence_snapshots_property_id            ON regulatory_data.parcel_intelligence_snapshots (property_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_zone_versions_changed_by                             ON regulatory_data.zone_versions (changed_by);

-- ── Verification ────────────────────────────────────────────────────────────
--   Re-run the FK coverage probe from the 2026-04-29 audit:
--     WITH fk AS (...)
--     SELECT count(*) FROM fk
--      WHERE NOT EXISTS (SELECT 1 FROM pg_index i ...);
--   -- expect: 0
--
--   Or via Supabase MCP:
--     get_advisors(type: "performance")  →  unindexed_foreign_keys count: 38 → 0
