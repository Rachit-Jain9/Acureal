-- REDIP Parcel Intelligence Evidence Ingestion Indexes
-- Keeps extraction-created review queues fast and idempotent.

CREATE INDEX IF NOT EXISTS idx_evidence_sources_org_document
  ON regulatory_data.evidence_sources(org_id, document_id, created_at DESC)
  WHERE document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_evidence_facts_source_review
  ON regulatory_data.evidence_facts(source_id, review_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guidance_values_source_review
  ON regulatory_data.guidance_values(evidence_source_id, review_status, created_at DESC)
  WHERE evidence_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_far_rules_source_review
  ON regulatory_data.far_rules(evidence_source_id, review_status, created_at DESC)
  WHERE evidence_source_id IS NOT NULL;
