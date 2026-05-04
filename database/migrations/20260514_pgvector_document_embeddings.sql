-- ============================================================================
-- 0050 — pgvector + document_embeddings (Tier 4.1 PR 1/3)
-- ============================================================================
-- Foundation for semantic search over uploaded documents + extracted
-- evidence. "Find similar deals / clauses across our corpus" is what
-- this unlocks once the embedding pipeline (PR 2/3) and the search UI
-- (PR 3/3) ship on top of this schema.
--
-- Choices:
--   • text-embedding-3-small (1536 dim) — $0.02/M tokens, strong baseline
--     for English + Indic mixed text. text-embedding-3-large (3072 dim,
--     $0.13/M) is a future toggle if quality demands it; the column
--     declares vector(1536) so a model swap requires a backfill.
--   • HNSW index over cosine distance — better recall + smaller build
--     time than ivfflat at our expected scale (≤1M rows for years).
--     m=16, ef_construction=64 are the documented sweet-spot defaults.
--   • RLS by organization_id — tenant isolation is non-negotiable for
--     deal corpora; cross-org search would leak strategy.
--   • source_kind enum so the same table indexes document chunks,
--     extracted-field text, and evidence_fact rows uniformly. Keeps
--     the search service from juggling N tables.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.document_embeddings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id         UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  page_number         INTEGER,
  chunk_index         INTEGER NOT NULL DEFAULT 0,
  chunk_text          TEXT NOT NULL,
  embedding           vector(1536),
  embedding_model     TEXT NOT NULL,
  source_kind         TEXT NOT NULL CHECK (source_kind IN (
                        'document_chunk',
                        'extraction_field',
                        'evidence_fact',
                        'manual'
                      )),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_embeddings_org_doc_idx
  ON public.document_embeddings (organization_id, document_id);

CREATE INDEX IF NOT EXISTS document_embeddings_org_kind_idx
  ON public.document_embeddings (organization_id, source_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS document_embeddings_hnsw_cosine_idx
  ON public.document_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE public.document_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_embeddings_select ON public.document_embeddings;
CREATE POLICY document_embeddings_select ON public.document_embeddings
  FOR SELECT
  USING (organization_id = current_organization_id());

DROP POLICY IF EXISTS document_embeddings_insert ON public.document_embeddings;
CREATE POLICY document_embeddings_insert ON public.document_embeddings
  FOR INSERT
  WITH CHECK (organization_id = current_organization_id());

DROP POLICY IF EXISTS document_embeddings_delete ON public.document_embeddings;
CREATE POLICY document_embeddings_delete ON public.document_embeddings
  FOR DELETE
  USING (organization_id = current_organization_id());

COMMENT ON TABLE  public.document_embeddings IS 'Per-chunk vector embeddings for semantic search across uploaded documents and extracted evidence. text-embedding-3-small (1536 dim) by default.';
COMMENT ON COLUMN public.document_embeddings.source_kind IS 'document_chunk | extraction_field | evidence_fact | manual — describes what the embedding indexes.';

COMMIT;
