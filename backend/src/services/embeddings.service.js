'use strict';

/**
 * Embedding generation + semantic search via pgvector.
 *
 * High level:
 *   • chunkText(text)              — split long text into ~1000-char windows
 *   • embedAndStore(...)           — generate embeddings via OpenAI and INSERT
 *   • searchSimilar({ query, ... }) — k-NN over cosine distance, RLS-scoped
 *
 * Routing: uses runOpenAIEmbedding via the AI router so embedding cost
 * lands in ai_call_logs alongside reasoning + extraction. The cost dashboard
 * widget already aggregates by task; embeddings show up as task='embedding'.
 *
 * Fail-open: every public function logs + returns empty/null on DB or
 * provider failure rather than throwing into a request handler. Semantic
 * search is an enhancement; absent it, the rest of Acureal keeps working.
 */

const { query } = require('../config/database');
// Route through aiRouter (not providerRegistry directly) so embedding cost
// + latency lands in `ai_call_logs` and the daily cost cap applies. See
// aiRouter.runOpenAIEmbedding for why response caching is intentionally off.
const { runOpenAIEmbedding } = require('./ai/aiRouter');
// The model name itself comes from the registry, never a local literal — a
// second copy of an embedding model name silently re-embeds new documents in a
// different vector space than the existing corpus, which makes similarity
// search quietly wrong rather than loudly broken.
const { DEFAULT_OPENAI_EMBEDDING_MODEL } = require('./ai/providerRegistry');
const log = require('../lib/logger').child({ module: 'embeddings' });

const DEFAULT_MODEL = process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_OPENAI_EMBEDDING_MODEL;
const DEFAULT_DIMENSIONS = 1536;

const CHUNK_SIZE = 1000;        // chars
const CHUNK_OVERLAP = 150;      // chars

/**
 * Naïve but predictable text chunker. Splits on paragraph breaks first,
 * then slides a window of ~CHUNK_SIZE chars (with CHUNK_OVERLAP) over each
 * paragraph that exceeds the size. Good enough for legal documents where
 * paragraph boundaries are meaningful; we'll swap to a tokenizer-aware
 * chunker if/when quality demands it.
 */
const chunkText = (text, { size = CHUNK_SIZE, overlap = CHUNK_OVERLAP } = {}) => {
  if (typeof text !== 'string' || !text.trim()) return [];
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= size) {
      chunks.push(paragraph);
      continue;
    }
    let cursor = 0;
    while (cursor < paragraph.length) {
      const end = Math.min(cursor + size, paragraph.length);
      chunks.push(paragraph.slice(cursor, end));
      if (end >= paragraph.length) break;
      cursor = end - overlap;
    }
  }
  return chunks;
};

/**
 * Generate embeddings for one or more strings via OpenAI. Returns
 * `{ embeddings: number[][], model, dimensions }`. Throws on provider
 * failure — callers wrap with try/catch when invoking from a request path.
 */
const embed = async (input, { model = DEFAULT_MODEL } = {}) => {
  const { result, dimensions } = await runOpenAIEmbedding({
    input,
    model,
    dimensions: DEFAULT_DIMENSIONS,
  });
  return { embeddings: result, model, dimensions };
};

/**
 * Insert N (chunk_text, embedding) rows. The caller supplies pre-chunked
 * text + the metadata that should ride with each row. Uses an array
 * UNNEST insert so a 100-chunk document is one round-trip.
 */
const storeChunks = async ({
  organizationId,
  documentId = null,
  pageNumber = null,
  sourceKind = 'document_chunk',
  chunks,
  embeddings,
  model,
  metadata = null,
}) => {
  if (!organizationId) throw new Error('storeChunks: organizationId required');
  if (!Array.isArray(chunks) || chunks.length === 0) return { rows_inserted: 0 };
  if (!Array.isArray(embeddings) || embeddings.length !== chunks.length) {
    throw new Error('storeChunks: embeddings length must match chunks length');
  }

  // Insert in a single statement — UNNEST + per-row chunk_index for ordering.
  const result = await query(
    `INSERT INTO public.document_embeddings
       (organization_id, document_id, page_number, chunk_index, chunk_text, embedding, embedding_model, source_kind, metadata)
     SELECT
       $1, $2, $3, ord.idx - 1, ord.txt::text, ord.emb::vector, $6, $7, $8::jsonb
     FROM UNNEST($4::text[], $5::text[]) WITH ORDINALITY AS ord(txt, emb, idx)
     RETURNING id`,
    [
      organizationId,
      documentId,
      pageNumber,
      chunks,
      embeddings.map((e) => `[${e.join(',')}]`),
      model,
      sourceKind,
      JSON.stringify(metadata || {}),
    ],
  );
  return { rows_inserted: result.rowCount || 0 };
};

/**
 * One-shot ingestion: chunk → embed → store. Intended for the
 * document-extraction pipeline to call after Gemini returns raw text.
 *
 *   await indexDocumentText({ organizationId, documentId, text })
 *
 * Failures are caught and logged; ingestion is best-effort.
 */
const indexDocumentText = async ({
  organizationId,
  documentId,
  text,
  pageNumber = null,
  sourceKind = 'document_chunk',
  metadata = null,
}) => {
  try {
    if (!organizationId || !text || !String(text).trim()) {
      return { rows_inserted: 0, skipped: true };
    }
    const chunks = chunkText(text);
    if (chunks.length === 0) return { rows_inserted: 0, skipped: true };

    const { embeddings, model } = await embed(chunks);
    return await storeChunks({
      organizationId,
      documentId,
      pageNumber,
      sourceKind,
      chunks,
      embeddings,
      model,
      metadata,
    });
  } catch (err) {
    log.warn('document_embedding_failed', {
      error: err.message,
      organization_id: organizationId,
      document_id: documentId,
    });
    return { rows_inserted: 0, error: err.message };
  }
};

/**
 * k-NN search over cosine distance, scoped to the caller's org via RLS
 * (the table policy filters; we don't need to add it to the WHERE).
 *
 * Returns rows ordered by cosine similarity DESC. `1 - distance` is the
 * displayed similarity (0..1, higher = closer).
 */
const searchSimilar = async ({
  query: searchQuery,
  k = 8,
  documentId = null,
  sourceKind = null,
  model = DEFAULT_MODEL,
}) => {
  if (!searchQuery || !String(searchQuery).trim()) return [];
  try {
    const { embeddings } = await embed(searchQuery, { model });
    const queryVector = `[${embeddings[0].join(',')}]`;
    const filters = [];
    const params = [queryVector, k];
    if (documentId) {
      params.push(documentId);
      filters.push(`document_id = $${params.length}`);
    }
    if (sourceKind) {
      params.push(sourceKind);
      filters.push(`source_kind = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await query(
      `SELECT id, document_id, page_number, chunk_index, chunk_text,
              source_kind, metadata,
              1 - (embedding <=> $1::vector) AS similarity
         FROM public.document_embeddings
         ${where}
        ORDER BY embedding <=> $1::vector ASC
        LIMIT $2`,
      params,
    );
    return result.rows;
  } catch (err) {
    log.warn('semantic_search_failed', { error: err.message });
    return [];
  }
};

module.exports = {
  chunkText,
  embed,
  storeChunks,
  indexDocumentText,
  searchSimilar,
  DEFAULT_MODEL,
  DEFAULT_DIMENSIONS,
};
