-- REDIP investor-grade audit: immutable document-access log
--
-- CLAUDE.md requires "Log access to sensitive documents." None of the three
-- download paths recorded an access event before this migration:
--   - document.service.getSignedUrl        (deal-document signed URL issuance)
--   - document.service.streamDownload      (deal-document byte-stream download)
--   - masterplan.service.getSourceDocumentDownload (regulatory source-PDF URL)
--
-- This table is the append-only home for those access events. It is
-- DELIBERATELY separate from two existing trails:
--   - activities    — the investor-facing deal timeline. Its activity_type is
--                     a CLOSED enum (ACTIVITY_TYPES in constants/domain.js) that
--                     does not include document access; routing downloads there
--                     would either no-op or bury the material-change story under
--                     routine reads.
--   - deal_audit_log — deal-lifecycle MUTATIONS (stage, archive, reassign...).
--                     A download is a read, not a mutation.
-- A download is a security / compliance access record, so it gets its own home.
--
-- Polymorphic by design: document_id references EITHER a public.documents row
-- (document_kind = 'deal_document') OR a regulatory_data.master_plan_documents
-- row (document_kind = 'masterplan_source'). No foreign key is declared on
-- document_id precisely so the access record SURVIVES deletion of the source
-- document — an audit trail that vanishes when the evidence is deleted is not
-- an audit trail. document_name is snapshotted for the same reason.
--
-- Append-only via RLS: SELECT + INSERT policies scoped to the caller's org,
-- and no UPDATE / DELETE policy (the same append-only posture as deal_audit_log
-- and deal_events). organization_id defaults to current_organization_id() so a
-- write that omits it still lands in the caller's tenant and the RLS WITH CHECK
-- validates it.
--
-- No plpgsql / dollar-quoted bodies — the Supabase SQL editor mis-parses them.
-- Plain DDL only. Idempotent: every statement guards with IF [NOT] EXISTS, so
-- the whole file is safe to re-paste.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS document_access_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Tenant scope: the organization under which the access happened (the
  -- accessing user's current org). NOT NULL so every access is attributable
  -- to a tenant. CASCADE matches deal_audit_log — deleting an organization
  -- (full tenant offboarding) takes its access logs with it.
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Polymorphic document pointer. No FK on purpose — the audit row must
  -- outlive the document. document_kind disambiguates which table id targets.
  document_id     UUID NOT NULL,
  document_kind   VARCHAR(32) NOT NULL DEFAULT 'deal_document',
  document_name   TEXT,

  -- Denormalised deal id for deal-document accesses so the deal AuditTab can
  -- ask "who downloaded documents on this deal". NULL for masterplan source
  -- docs (org-level regulatory references, not deal-scoped). No FK cascade —
  -- the access record must survive deal deletion too.
  deal_id         UUID,

  -- Who + how.
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  action          VARCHAR(32) NOT NULL,

  -- Request forensics. TEXT (not INET) so a malformed / proxied /
  -- comma-joined X-Forwarded-For value can never make the audit insert throw.
  ip_address      TEXT,
  user_agent      TEXT,

  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_access_log_document_idx
  ON document_access_log (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS document_access_log_org_created_idx
  ON document_access_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS document_access_log_deal_idx
  ON document_access_log (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS document_access_log_user_idx
  ON document_access_log (user_id);

-- Default the org the same way every other tenant table does, so an insert
-- that omits organization_id still lands in the caller's org and the RLS
-- WITH CHECK validates it.
ALTER TABLE document_access_log
  ALTER COLUMN organization_id SET DEFAULT current_organization_id();

-- Row-level security: read + insert scoped to the caller's organization. No
-- UPDATE / DELETE policy is created, which makes the table append-only under
-- non-superuser credentials (the intended audit posture).
ALTER TABLE document_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_access_log_org_read  ON document_access_log;
DROP POLICY IF EXISTS document_access_log_org_write ON document_access_log;

CREATE POLICY document_access_log_org_read ON document_access_log
  FOR SELECT USING (organization_id = current_organization_id());

CREATE POLICY document_access_log_org_write ON document_access_log
  FOR INSERT WITH CHECK (organization_id = current_organization_id());

COMMENT ON TABLE document_access_log IS
  'Append-only access log for sensitive-document downloads (deal documents + '
  'masterplan source PDFs). Satisfies the CLAUDE.md "log access to sensitive '
  'documents" rule and the investor-grade immutable-audit requirement. Written '
  'only by documentAccessLog.sink.js via the DOCUMENT_ACCESSED event. Separate '
  'from activities (deal timeline) and deal_audit_log (deal mutations).';
COMMENT ON COLUMN document_access_log.action IS
  'How the document was accessed: signed_url (a time-limited download URL was '
  'issued) or download (bytes were streamed through the server).';
COMMENT ON COLUMN document_access_log.document_kind IS
  'Which table document_id points at: deal_document (public.documents) or '
  'masterplan_source (regulatory_data.master_plan_documents). No FK so the '
  'access record survives deletion of the source document.';

-- ── Verification (run as separate queries after applying) ───────────────────
--   SELECT relrowsecurity FROM pg_class
--    WHERE relname = 'document_access_log' AND relnamespace = 'public'::regnamespace;
--   -- expect: t
--
--   SELECT count(*) FROM public.document_access_log;
--   -- expect: 0 (no rows until the first download after deploy)
