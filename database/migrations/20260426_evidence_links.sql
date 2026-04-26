-- ──────────────────────────────────────────────────────────────────────────
-- Polymorphic evidence_links — extends the parcel evidence pattern to every
-- workflow object that benefits from a citation trail.
--
-- Pattern: any (owner_kind, owner_id) tuple can have one or many evidence
-- links, where each link references either an evidence_source row, an
-- evidence_fact row, a document, or a free-form `manual` URL/note.
--
-- Why polymorphic vs. one FK per workflow:
--   * DD, approvals, risk, comps, financials all need the same shape.
--   * Hard FKs would mean N tables and N RLS policies, all identical.
--   * The owner_kind enum is the audit boundary; RLS ensures org isolation.
--
-- The owner_id is NOT enforced as a foreign key (it points into a different
-- table per owner_kind). Integrity is enforced at the service layer
-- (`evidenceLinks.service.js`) which validates the owner row exists and
-- belongs to the caller's organization before writing the link.
-- ──────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'evidence_owner_kind'
  ) THEN
    CREATE TYPE evidence_owner_kind AS ENUM (
      'dd_item',
      'approval',
      'risk_flag',
      'comp',
      'financial_scenario',
      'parcel_intelligence',
      'deal_note',
      'guidance_value'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'evidence_link_kind'
  ) THEN
    CREATE TYPE evidence_link_kind AS ENUM (
      'evidence_source',
      'evidence_fact',
      'document',
      'manual_verification',
      'external_url'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS evidence_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- What is being cited?
  owner_kind          evidence_owner_kind NOT NULL,
  owner_id            UUID NOT NULL,

  -- Where does the citation point?
  link_kind           evidence_link_kind NOT NULL,
  evidence_source_id  UUID,                                          -- regulatory_data.evidence_sources.id (cross-schema, validated at app)
  evidence_fact_id    UUID,                                          -- regulatory_data.evidence_facts.id
  document_id         UUID REFERENCES documents(id) ON DELETE SET NULL,
  external_url        TEXT,                                          -- BBMP eAasthi, Kaveri portal, etc.

  -- Provenance
  confidence_score    NUMERIC(4,3) CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
  notes               TEXT,
  page_number         INTEGER CHECK (page_number IS NULL OR page_number > 0),
  source_section      TEXT,
  verified_at         TIMESTAMPTZ,
  verified_by         UUID REFERENCES users(id) ON DELETE SET NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,

  -- A single citation row must point to at least one concrete target. Free
  -- "external_url" links are allowed only when explicitly classified as
  -- 'manual_verification' or 'external_url' (e.g. an analyst confirms a fact
  -- by opening Kaveri and pasting the URL).
  CONSTRAINT evidence_links_target_present CHECK (
    evidence_source_id IS NOT NULL
    OR evidence_fact_id IS NOT NULL
    OR document_id IS NOT NULL
    OR (external_url IS NOT NULL AND link_kind IN ('manual_verification','external_url'))
  )
);

CREATE INDEX IF NOT EXISTS evidence_links_owner_idx
  ON evidence_links (organization_id, owner_kind, owner_id);

CREATE INDEX IF NOT EXISTS evidence_links_source_idx
  ON evidence_links (evidence_source_id)
  WHERE evidence_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS evidence_links_fact_idx
  ON evidence_links (evidence_fact_id)
  WHERE evidence_fact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS evidence_links_document_idx
  ON evidence_links (document_id)
  WHERE document_id IS NOT NULL;

-- An owner can link the same evidence target only once. Manual verifications
-- (which carry only a URL) are allowed to repeat — analysts may verify the
-- same DD item against different portals.
CREATE UNIQUE INDEX IF NOT EXISTS evidence_links_unique_target
  ON evidence_links (organization_id, owner_kind, owner_id, link_kind, COALESCE(evidence_source_id::text, ''), COALESCE(evidence_fact_id::text, ''), COALESCE(document_id::text, ''))
  WHERE link_kind <> 'manual_verification';

-- ──────────────────────────────────────────────────────────────────────────
-- RLS — strict per-org isolation. No global rows in this table.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE evidence_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS evidence_links_select ON evidence_links;
CREATE POLICY evidence_links_select ON evidence_links
  FOR SELECT
  USING (organization_id = current_organization_id());

DROP POLICY IF EXISTS evidence_links_insert ON evidence_links;
CREATE POLICY evidence_links_insert ON evidence_links
  FOR INSERT
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS evidence_links_update ON evidence_links;
CREATE POLICY evidence_links_update ON evidence_links
  FOR UPDATE
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS evidence_links_delete ON evidence_links;
CREATE POLICY evidence_links_delete ON evidence_links
  FOR DELETE
  USING (organization_id = current_organization_id());

COMMENT ON TABLE evidence_links IS 'Polymorphic citations. Any DD item, approval, risk flag, comp, or workflow object can attach one or many evidence sources / facts / documents / manual-verification URLs.';
COMMENT ON COLUMN evidence_links.owner_kind IS 'Owner table identifier — enum keeps the surface area explicit. Adding a new owner kind requires a schema migration.';
COMMENT ON COLUMN evidence_links.link_kind IS 'What kind of evidence is referenced. Drives UI rendering: evidence_source/fact get a citation chip, document gets a paperclip, manual_verification gets a "verified manually" pill.';
