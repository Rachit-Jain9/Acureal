-- Immutable audit trail for masterplan source-document registry edits.

CREATE TABLE IF NOT EXISTS regulatory_data.master_plan_document_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES regulatory_data.master_plan_documents(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  previous_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  change_reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mpd_versions_document_changed
  ON regulatory_data.master_plan_document_versions(document_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_mpd_versions_changed_by
  ON regulatory_data.master_plan_document_versions(changed_by);
