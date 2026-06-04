-- 20260629_deal_workspace_cache.sql
--
-- Server-side cache for the DETERMINISTIC (lite) deal-workspace payload.
--
-- Why: opening a deal re-runs getDealWorkspace's full deterministic assembly
-- (financials + DD + risk + approvals + documents + comps + the recommendation
-- engine + Deal Doctor + IC-readiness + the micro-market / best-use / capital-
-- stack / RERA composers). On a cold Vercel serverless instance that is several
-- seconds of work on every first open. The result is a pure function of the
-- deal's own data, so it is safe to cache and serve to the next reader.
--
-- Correctness model (this is the important part):
--   • Keyed by (deal_id, organization_id). FORCE RLS isolates rows per org, so
--     a cached payload can never cross a tenant boundary. Shared deals get one
--     row per viewing org (their team-feedback ranking differs).
--   • A `version_key` (count(*) + max(updated_at) across EVERY per-deal input
--     table + the deal row) is recomputed cheaply on every read. Any edit to the
--     deal, its financials, DD items, risk flags, approvals, documents,
--     extractions, promoter profile, scenarios, waterfalls or recommendation
--     verdicts changes the key → the cache misses → the page recomputes. So an
--     operator's own edit is ALWAYS reflected immediately; the cache can only
--     ever serve a payload whose deterministic inputs are byte-for-byte current.
--   • A short TTL (enforced in app code, default 120s) bounds staleness from the
--     two inputs that are NOT per-deal: the verified comps table and per-org
--     team-feedback ranking. Neither carries a legal/title/RERA conclusion.
--
-- Migration-tolerant: the app degrades gracefully when this table is absent
-- (every cache read/write is wrapped in try/catch → a miss just recomputes,
-- exactly like today). Deploy order is therefore flexible and a DROP TABLE is a
-- complete, instant rollback.
--
-- Operator action required: apply via the Supabase SQL editor.
--   🌐 https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new
--   📋 paste this whole file → Run → expect "Success. No rows returned."

BEGIN;

CREATE TABLE IF NOT EXISTS deal_workspace_cache (
  deal_id          UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL,
  version_key      TEXT NOT NULL,
  payload          JSONB NOT NULL,
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (deal_id, organization_id)
);

-- Supports a cheap age sweep / TTL housekeeping job if one is ever added.
CREATE INDEX IF NOT EXISTS deal_workspace_cache_by_computed_at
  ON deal_workspace_cache (computed_at);

ALTER TABLE deal_workspace_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_workspace_cache FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_workspace_cache_org_isolation ON deal_workspace_cache;
CREATE POLICY deal_workspace_cache_org_isolation
  ON deal_workspace_cache
  FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

COMMIT;
