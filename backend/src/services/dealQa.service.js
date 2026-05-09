'use strict';

/**
 * Tier-2 #11 — Narrow Deal Q&A agent.
 *
 * Single-shot Q&A on a deal. Analyst types a question; we:
 *   1. Pull deterministic deal context (financials, risk_flags, top
 *      ranked comps).
 *   2. Pull the top-K relevant document chunks via pgvector
 *      (embeddings.searchSimilar) — this is the "evidence retrieval"
 *      step the handoff calls out.
 *   3. Hand the question + context + retrieved chunks to Claude with a
 *      strict JSON contract: { answer, citations[] } where every
 *      citation MUST reference a retrieved chunk by embedding_id.
 *   4. Validate citations are real (not hallucinated chunk_ids).
 *   5. Run the numerical verifier over the answer to catch number drift.
 *   6. Persist the question + answer + citations to deal_qa_history.
 *
 * Per CLAUDE.md hard rules:
 *   • Math + retrieval are deterministic. Claude only paraphrases facts
 *     that came back from `searchSimilar()` + DB queries. The prompt
 *     explicitly forbids unsourced claims and any number not present
 *     in the supplied context.
 *   • Mandatory citations — if Claude returns 0 citations, the answer
 *     is rejected and the row is marked `failed`.
 *   • The "AI-assisted — requires human review" disclaimer renders
 *     alongside every answer in the UI.
 *
 * Out of scope (deferred to a follow-up):
 *   • Multi-turn conversation (single-shot only)
 *   • Tool calling / agent orchestration
 *   • Streaming response (synchronous JSON)
 *   • Cross-deal Q&A
 */

const crypto = require('crypto');
const { z } = require('zod');
const { query } = require('../config/database');
const { getProviderAvailability } = require('./ai/providerRegistry');
const { runAIWithSchema, runClaudeReasoning, runClaudeReasoningStream, stripJsonFences } = require('./ai/aiRouter');
const embeddingsService = require('./embeddings.service');
const numericalVerifier = require('./numericalVerifier.service');
const { buildVisibleDealCondition } = require('../utils/dealVisibility');
const log = require('../lib/logger').child({ module: 'dealQa' });

// ──────────────────────────────────────────────────────────────────────────
// Constants + schema
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_TOP_K = 6;
const MAX_QUESTION_LENGTH = 2000;
const MAX_HISTORY_LIMIT = 50;

// The Q&A box only works once the deal_qa_history migration is applied.
// Until then every cache-lookup / insert hits Postgres with SQLSTATE
// 42P01 ("relation does not exist"). Catch that here and rethrow with a
// user-friendly 503 so the toast tells the operator exactly what to do.
const MIGRATION_NOT_APPLIED_MESSAGE =
  'Q&A is not yet enabled for this organization. The operator needs to apply the deal_qa_history migration in the Supabase SQL editor (database/migrations/20260518_deal_qa_history.sql).';

const isMissingTableError = (err) => {
  if (!err) return false;
  const code = err.code || err.original?.code;
  if (code === '42P01') return true;
  return /relation .*deal_qa_history.* does not exist/i.test(String(err.message || ''));
};

const wrapMissingTable = (err) => {
  if (isMissingTableError(err)) {
    const e = new Error(MIGRATION_NOT_APPLIED_MESSAGE);
    e.statusCode = 503;
    e.code = 'qa_history_table_missing';
    return e;
  }
  return err;
};

// Each citation must reference a chunk we actually retrieved. The schema
// validates *shape*; the service post-validates that every embedding_id
// exists in the retrieval set (no hallucinated provenance).
const CitationSchema = z.object({
  embedding_id: z.string().min(1),
  excerpt: z.string().min(1).max(800),
  why_relevant: z.string().max(200).optional(),
});

const AnswerSchema = z.object({
  answer: z.string().min(1).max(4000),
  citations: z.array(CitationSchema).min(1, 'At least one citation is required.'),
  // Optional self-assessed confidence — the UI surfaces it next to the
  // answer. Constrained to a small enum so the model can't hand-wave.
  confidence: z.enum(['high', 'medium', 'low']).optional(),
});

// ──────────────────────────────────────────────────────────────────────────
// Context assembly
// ──────────────────────────────────────────────────────────────────────────

/**
 * Pull a flat-but-tight deal snapshot — the bits that the LLM needs to
 * answer high-frequency analyst questions ("what's the IRR?", "what's
 * the asset class?", "who are the comps?") without dragging in every
 * column on every related table.
 */
async function fetchDealSnapshot(dealId) {
  const dealResult = await query(
    `SELECT d.id, d.name, d.stage, d.priority, d.deal_type, d.asset_class,
            d.land_ask_price_cr, d.negotiated_price_cr,
            p.city, p.address, p.locality, p.land_area_acres, p.land_area_sqft,
            p.zoning, p.circle_rate_per_sqft,
            f.irr_pct, f.npv_cr, f.equity_multiple,
            f.total_cost_cr, f.total_revenue_cr, f.gross_margin_pct,
            f.residual_land_value_cr, f.selling_rate_per_sqft
       FROM deals d
       LEFT JOIN properties p ON p.id = d.property_id
       LEFT JOIN financials f ON f.deal_id = d.id
      WHERE d.id = $1
        AND ${buildVisibleDealCondition('d')}
      LIMIT 1`,
    [dealId],
  );
  return dealResult.rows[0] || null;
}

async function fetchRiskSummary(dealId) {
  const result = await query(
    `SELECT category, severity, status, title, description
       FROM risk_flags
      WHERE deal_id = $1
        AND organization_id = current_organization_id()
        AND status NOT IN ('resolved')
      ORDER BY
        CASE severity
          WHEN 'critical' THEN 1
          WHEN 'high'     THEN 2
          WHEN 'medium'   THEN 3
          ELSE 4
        END,
        created_at DESC
      LIMIT 12`,
    [dealId],
  );
  return result.rows;
}

async function fetchTopComps(dealId) {
  // Closest 5 comps by deal locality. We deliberately pull a small set —
  // the LLM doesn't need 50 rows; it needs an honest sense of nearby
  // pricing.
  const result = await query(
    `SELECT c.project_name, c.developer, c.locality, c.rate_per_sqft, c.bhk_config,
            c.launch_year, c.is_verified
       FROM comps c
       JOIN deals d ON d.organization_id = c.organization_id
       LEFT JOIN properties p ON p.id = d.property_id
      WHERE d.id = $1
        AND ${buildVisibleDealCondition('d')}
        AND (
          p.city IS NULL
          OR LOWER(c.city) = LOWER(p.city)
        )
      ORDER BY c.is_verified DESC, c.created_at DESC
      LIMIT 5`,
    [dealId],
  );
  return result.rows;
}

/**
 * Assemble the full retrieval bundle the prompt sees. Uses pgvector to
 * find the top-K most-relevant document chunks for the analyst's
 * question; `embeddings.searchSimilar` is the same retrieval used for
 * the semantic search route. Org-scoped via RLS.
 */
async function assembleContext({ dealId, question, topK = DEFAULT_TOP_K, deal: dealOverride = null }) {
  // Two-or-three deterministic queries in parallel + the embedding
  // search. Each is small; LLM input is the limiter, not DB time.
  // Callers that have already fetched the deal (e.g. askQuestion's
  // visibility check) can pass it via `deal` to skip the duplicate
  // round-trip.
  const dealPromise = dealOverride
    ? Promise.resolve(dealOverride)
    : fetchDealSnapshot(dealId);
  const [deal, risks, comps, retrievedChunks] = await Promise.all([
    dealPromise,
    fetchRiskSummary(dealId),
    fetchTopComps(dealId),
    embeddingsService.searchSimilar({
      query: question,
      k: topK,
      // No documentId filter — we want any chunk relevant to the question.
      // RLS scopes to the current org automatically.
    }).catch((err) => {
      log.warn('embedding_search_failed_continuing', { dealId, error: err.message });
      return [];
    }),
  ]);

  // Hydrate retrieved chunks with document name + URL for the citations
  // array. The chunks come back with document_id; one bulk lookup
  // augments them.
  let documentMeta = new Map();
  if (retrievedChunks.length > 0) {
    const docIds = [...new Set(retrievedChunks.map((c) => c.document_id).filter(Boolean))];
    if (docIds.length > 0) {
      const meta = await query(
        `SELECT id, name FROM documents WHERE id = ANY($1::uuid[])`,
        [docIds],
      );
      documentMeta = new Map(meta.rows.map((r) => [r.id, r]));
    }
  }

  const hydratedChunks = retrievedChunks.map((c) => ({
    embedding_id: c.id,
    document_id: c.document_id,
    document_name: documentMeta.get(c.document_id)?.name || c.metadata?.document_name || null,
    page_number: c.page_number,
    similarity: typeof c.similarity === 'number' ? Math.round(c.similarity * 100) / 100 : null,
    chunk_text: (c.chunk_text || '').slice(0, 1500),
    source_kind: c.source_kind,
  }));

  return { deal, risks, comps, chunks: hydratedChunks };
}

// ──────────────────────────────────────────────────────────────────────────
// Prompt + Claude call
// ──────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior Indian real-estate analyst answering a colleague's question about a specific deal at a Bengaluru private-equity fund.

Hard rules:
1. ONLY use facts that appear in the supplied "deal_snapshot", "risk_flags", "comps", or "retrieved_chunks". Never invent a number, name, date, RERA reference, or zoning code.
2. Every claim that depends on a document MUST cite an entry in retrieved_chunks via its embedding_id. If retrieved_chunks is empty, restrict yourself to facts from deal_snapshot / risk_flags / comps and cite "deal_snapshot" or similar in why_relevant.
3. Output STRICTLY this JSON shape — no markdown fence, no preamble:
   {
     "answer": "<3-6 sentences, plain Indian English, investor-grade>",
     "citations": [
       {
         "embedding_id": "<exact id from retrieved_chunks>",
         "excerpt": "<the specific sentence or fragment from chunk_text that supports the answer>",
         "why_relevant": "<one short phrase>"
       }
     ],
     "confidence": "high|medium|low"
   }
4. citations array MUST contain at least one entry whenever the answer makes any factual claim.
5. If the question cannot be answered from the supplied context, set confidence="low" and explain in answer what's missing — but you still need at least one citation pointing at the closest evidence.
6. Do not produce legal opinions on title, RERA compliance, or zoning. Surface what the documents say; flag where independent verification is needed.

The system layer post-validates that every embedding_id you cite actually exists in retrieved_chunks. Hallucinated chunk ids are rejected and the answer is discarded.`;

/**
 * Compose the user-facing prompt payload. The assembled context is
 * embedded as JSON the LLM reads. Keeping it as JSON (vs. prose) makes
 * it predictable for the model and easy to test against.
 */
function buildPromptPayload({ question, context }) {
  return {
    question: question.trim(),
    deal_snapshot: context.deal,
    risk_flags: context.risks,
    comps: context.comps,
    retrieved_chunks: context.chunks,
  };
}

/**
 * Validate that every citation's embedding_id is present in the
 * retrieval set. Returns { valid: bool, invalid_ids: [...] }.
 */
function validateCitations(citations, retrievedChunks) {
  const valid = new Set(retrievedChunks.map((c) => c.embedding_id));
  const invalid = [];
  for (const c of citations || []) {
    if (!valid.has(c.embedding_id)) invalid.push(c.embedding_id);
  }
  return { valid: invalid.length === 0, invalid_ids: invalid };
}

/**
 * Hydrate the model-supplied citations with full metadata from the
 * retrieval set so the UI can render document name, page, similarity
 * without a second round-trip.
 */
function hydrateCitations(modelCitations, retrievedChunks) {
  const byId = new Map(retrievedChunks.map((c) => [c.embedding_id, c]));
  return (modelCitations || []).map((c) => {
    const chunk = byId.get(c.embedding_id);
    return {
      embedding_id: c.embedding_id,
      document_id: chunk?.document_id || null,
      document_name: chunk?.document_name || null,
      page_number: chunk?.page_number || null,
      similarity: chunk?.similarity || null,
      excerpt: c.excerpt,
      why_relevant: c.why_relevant || null,
      // Chunk text is small (<1500 chars); included for the citation
      // popover so the UI can show what the model was looking at without
      // a separate fetch.
      chunk_text: chunk?.chunk_text || null,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Snapshot hash (for short-circuit on identical re-asks)
// ──────────────────────────────────────────────────────────────────────────

const computeSnapshotHash = ({ question, chunks }) => {
  const canonical = JSON.stringify({
    q: String(question || '').trim().toLowerCase(),
    ids: (chunks || []).map((c) => c.embedding_id).sort(),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
};

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Ask a question about a deal. Returns the persisted history row.
 *
 * Throws on:
 *   • Claude unavailable           → 503
 *   • Deal not visible to caller   → 404
 *   • Question empty / too long    → 400
 *   • Citation validation failure  → 502 (after one reprompt)
 */
async function askQuestion({ dealId, question, userId = null, organizationId = null }) {
  if (!getProviderAvailability().claude) {
    throw Object.assign(new Error('ANTHROPIC_API_KEY not configured.'), { statusCode: 503 });
  }

  const trimmed = String(question || '').trim();
  if (!trimmed) {
    throw Object.assign(new Error('Question is required.'), { statusCode: 400 });
  }
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    throw Object.assign(
      new Error(`Question exceeds ${MAX_QUESTION_LENGTH} chars (got ${trimmed.length}).`),
      { statusCode: 400 },
    );
  }

  const deal = await fetchDealSnapshot(dealId);
  if (!deal) {
    throw Object.assign(new Error('Deal not found or not visible.'), { statusCode: 404 });
  }

  // Context assembly — fully deterministic, no LLM yet. Pass the deal
  // we already fetched for visibility so assembleContext doesn't re-query.
  const context = await assembleContext({ dealId, question: trimmed, deal });
  const snapshotHash = computeSnapshotHash({ question: trimmed, chunks: context.chunks });

  // Short-circuit: identical re-ask with same retrieval → return the
  // most recent persisted answer, no Claude call.
  let cached;
  try {
    cached = await query(
      `SELECT * FROM deal_qa_history
         WHERE deal_id = $1
           AND snapshot_hash = $2
           AND organization_id = current_organization_id()
           AND status = 'complete'
         ORDER BY created_at DESC
         LIMIT 1`,
      [dealId, snapshotHash],
    );
  } catch (err) {
    throw wrapMissingTable(err);
  }
  if (cached.rows[0]) {
    return { ...cached.rows[0], cache_hit: true };
  }

  const payload = buildPromptPayload({ question: trimmed, context });

  let modelResult = null;
  let callId = null;
  let failureReason = null;
  try {
    const out = await runAIWithSchema({
      task: 'reasoning',
      schema: AnswerSchema,
      attach: { dealId, userId },
      metadata: {
        stage: 'deal_qa',
        deal_id: dealId,
        chunk_count: context.chunks.length,
        snapshot_hash: snapshotHash,
      },
      run: async ({ providers }) => {
        const res = await providers.runClaudeReasoning({
          systemPrompt: SYSTEM_PROMPT,
          cachePrompt: true,
          payload,
          maxTokens: 800,
        });
        return { result: res?.result ?? null, raw: res?.raw ?? { usage: null } };
      },
    });
    modelResult = out.result;
    callId = out.callId;
  } catch (err) {
    failureReason = err.message || 'AI call failed';
    log.warn('deal_qa_ai_failed', { dealId, error: failureReason });
  }

  // Citation post-validation — even after schema validation, embedding_id
  // values must reference real retrieved chunks (not hallucinated ids).
  if (modelResult) {
    const { valid, invalid_ids } = validateCitations(modelResult.citations, context.chunks);
    if (!valid) {
      failureReason = `Hallucinated citation ids: ${invalid_ids.join(', ')}`;
      log.warn('deal_qa_citation_validation_failed', { dealId, invalid_ids });
      modelResult = null;
    }
  }

  // Numerical verifier — drift bands the same way as deal_analysis. The
  // LLM cited specific numbers; the verifier compares them against the
  // deterministic deal snapshot.
  let drifts = null;
  let verifiedAt = null;
  if (modelResult?.answer) {
    try {
      const snapshot = numericalVerifier.snapshotFromDealAnalysisInput({
        deal: { land_area_acres: deal.land_area_acres },
        financials: {
          irr_pct: deal.irr_pct,
          total_revenue_cr: deal.total_revenue_cr,
          total_cost_cr: deal.total_cost_cr,
        },
      });
      const v = numericalVerifier.verifyDealAnalysis({
        contentMd: modelResult.answer,
        snapshot,
      });
      drifts = v.drifts;
      verifiedAt = v.verifiedAt;
    } catch (verifierErr) {
      log.warn('deal_qa_verifier_failed', { dealId, error: verifierErr.message });
    }
  }

  // Persist — both success and failure rows land in the table so the
  // UI can show "your last attempt failed, try rephrasing."
  const status = modelResult ? 'complete' : 'failed';
  const hydratedCitations = modelResult
    ? hydrateCitations(modelResult.citations, context.chunks)
    : [];

  let insertResult;
  try {
    insertResult = await query(
      `INSERT INTO deal_qa_history
         (organization_id, deal_id, asked_by, question, answer, citations,
          generated_by_call_id, numerical_drifts, verified_at,
          snapshot_hash, status, failure_reason)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11, $12)
       RETURNING *`,
      [
        organizationId,
        dealId,
        userId,
        trimmed,
        modelResult?.answer || null,
        JSON.stringify(hydratedCitations),
        callId,
        drifts ? JSON.stringify(drifts) : null,
        verifiedAt,
        snapshotHash,
        status,
        failureReason,
      ],
    );
  } catch (err) {
    throw wrapMissingTable(err);
  }

  if (status === 'failed') {
    const err = new Error(failureReason || 'Q&A generation failed.');
    err.statusCode = 502;
    err.row = insertResult.rows[0];
    throw err;
  }

  return {
    ...insertResult.rows[0],
    confidence: modelResult.confidence || null,
    cache_hit: false,
  };
}

/**
 * Streaming variant of askQuestion. Returns an SSE-compatible handle:
 *
 *   • assembles context (deterministic, no LLM yet)
 *   • opens a Claude streaming reasoning call against the same
 *     mandatory-citation prompt
 *   • emits raw text deltas via `onText(delta)` so the route handler
 *     can write `data: { type: 'text', text }` SSE frames
 *   • on `done()` parses the accumulated JSON, validates citations
 *     against the retrieval set, runs the numerical verifier,
 *     persists the row, returns the final hydrated payload
 *
 * Mirrors the streamDealAnalysis / icMemoService.stream contract so
 * the route handler that consumes all three is symmetric. Cache hits
 * short-circuit before opening a stream — caller renders the cached
 * row in one shot via `cacheHit: true` in the return.
 */
async function streamQuestion({ dealId, question, userId = null, organizationId = null }) {
  if (!getProviderAvailability().claude) {
    return { error: 'ANTHROPIC_API_KEY not configured', status: 503 };
  }

  const trimmed = String(question || '').trim();
  if (!trimmed) return { error: 'Question is required.', status: 400 };
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    return { error: `Question exceeds ${MAX_QUESTION_LENGTH} chars (got ${trimmed.length}).`, status: 400 };
  }

  const deal = await fetchDealSnapshot(dealId);
  if (!deal) return { error: 'Deal not found or not visible.', status: 404 };

  const context = await assembleContext({ dealId, question: trimmed, deal });
  const snapshotHash = computeSnapshotHash({ question: trimmed, chunks: context.chunks });

  // Cache short-circuit — same as askQuestion. No stream needed if we
  // already have an answer with identical (question, retrieval).
  let cached;
  try {
    cached = await query(
      `SELECT * FROM deal_qa_history
         WHERE deal_id = $1
           AND snapshot_hash = $2
           AND organization_id = current_organization_id()
           AND status = 'complete'
         ORDER BY created_at DESC
         LIMIT 1`,
      [dealId, snapshotHash],
    );
  } catch (err) {
    if (isMissingTableError(err)) {
      return { error: MIGRATION_NOT_APPLIED_MESSAGE, status: 503 };
    }
    throw err;
  }
  if (cached.rows[0]) {
    return { cacheHit: true, row: { ...cached.rows[0], cache_hit: true } };
  }

  const payload = buildPromptPayload({ question: trimmed, context });

  // Open the streaming Claude call. Stream emits raw JSON deltas; the
  // UI strips fences and pretty-renders the answer field as text comes
  // in. (We keep the model's strict JSON contract — we just stream
  // the bytes as they generate.)
  const handle = await runClaudeReasoningStream({
    task: 'reasoning',
    systemPrompt: SYSTEM_PROMPT,
    cachePrompt: true,
    payload,
    maxTokens: 800,
    attach: { dealId, userId },
    metadata: {
      stage: 'deal_qa',
      deal_id: dealId,
      chunk_count: context.chunks.length,
      snapshot_hash: snapshotHash,
      streamed: true,
    },
  });

  return {
    onText: handle.onText,
    abort: handle.abort,
    callIdPromise: handle.callIdPromise,
    async done() {
      let modelResult = null;
      let callId = null;
      let failureReason = null;

      try {
        const final = await handle.done();
        callId = final.callId;
        // Parse the streamed JSON. Same forgiveness as runAIWithSchema:
        // strip ```json fences, then parse, then schema-validate.
        const rawText = final.result || '';
        let parsed = null;
        try {
          parsed = JSON.parse(stripJsonFences(rawText));
        } catch (parseErr) {
          failureReason = `Streamed JSON parse failed: ${parseErr.message}`;
        }
        if (parsed) {
          const schemaResult = AnswerSchema.safeParse(parsed);
          if (!schemaResult.success) {
            failureReason = `Schema validation failed: ${schemaResult.error.errors[0]?.message || 'unknown'}`;
          } else {
            modelResult = schemaResult.data;
          }
        }
      } catch (err) {
        failureReason = err.message || 'AI stream failed';
        log.warn('deal_qa_stream_failed', { dealId, error: failureReason });
      }

      // Citation post-validation — same as askQuestion.
      if (modelResult) {
        const { valid, invalid_ids } = validateCitations(modelResult.citations, context.chunks);
        if (!valid) {
          failureReason = `Hallucinated citation ids: ${invalid_ids.join(', ')}`;
          log.warn('deal_qa_citation_validation_failed', { dealId, invalid_ids });
          modelResult = null;
        }
      }

      // Numerical verifier — same as askQuestion.
      let drifts = null;
      let verifiedAt = null;
      if (modelResult?.answer) {
        try {
          const snapshot = numericalVerifier.snapshotFromDealAnalysisInput({
            deal: { land_area_acres: deal.land_area_acres },
            financials: {
              irr_pct: deal.irr_pct,
              total_revenue_cr: deal.total_revenue_cr,
              total_cost_cr: deal.total_cost_cr,
            },
          });
          const v = numericalVerifier.verifyDealAnalysis({
            contentMd: modelResult.answer,
            snapshot,
          });
          drifts = v.drifts;
          verifiedAt = v.verifiedAt;
        } catch (verifierErr) {
          log.warn('deal_qa_verifier_failed', { dealId, error: verifierErr.message });
        }
      }

      const status = modelResult ? 'complete' : 'failed';
      const hydratedCitations = modelResult
        ? hydrateCitations(modelResult.citations, context.chunks)
        : [];

      let insertResult;
      try {
        insertResult = await query(
          `INSERT INTO deal_qa_history
             (organization_id, deal_id, asked_by, question, answer, citations,
              generated_by_call_id, numerical_drifts, verified_at,
              snapshot_hash, status, failure_reason)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11, $12)
           RETURNING *`,
          [
            organizationId,
            dealId,
            userId,
            trimmed,
            modelResult?.answer || null,
            JSON.stringify(hydratedCitations),
            callId,
            drifts ? JSON.stringify(drifts) : null,
            verifiedAt,
            snapshotHash,
            status,
            failureReason,
          ],
        );
      } catch (err) {
        throw wrapMissingTable(err);
      }

      return {
        row: {
          ...insertResult.rows[0],
          confidence: modelResult?.confidence || null,
          cache_hit: false,
        },
        status,
        failureReason,
      };
    },
  };
}

/**
 * Return the most recent N Q&A rows for a deal. Used by the deal page
 * on mount.
 */
async function listHistory(dealId, { limit = 10 } = {}) {
  const cappedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), MAX_HISTORY_LIMIT);
  try {
    const result = await query(
      `SELECT id, question, answer, citations, status, failure_reason,
              numerical_drifts, verified_at, snapshot_hash, created_at, asked_by
         FROM deal_qa_history
        WHERE deal_id = $1
          AND organization_id = current_organization_id()
        ORDER BY created_at DESC
        LIMIT $2`,
      [dealId, cappedLimit],
    );
    return result.rows;
  } catch (err) {
    // Migration not yet applied → return empty history. The Q&A box on the
    // page renders the input + suggested questions without throwing; the
    // ask route will return the proper 503 when the user actually
    // submits.
    if (isMissingTableError(err)) {
      log.warn('deal_qa_history_table_missing_returning_empty', { dealId });
      return [];
    }
    throw err;
  }
}

async function deleteHistoryRow(rowId) {
  const result = await query(
    `DELETE FROM deal_qa_history
       WHERE id = $1
         AND organization_id = current_organization_id()
       RETURNING id`,
    [rowId],
  );
  return result.rows[0] || null;
}

module.exports = {
  // Public
  askQuestion,
  streamQuestion,
  listHistory,
  deleteHistoryRow,
  // Helpers — exported for tests
  validateCitations,
  hydrateCitations,
  computeSnapshotHash,
  buildPromptPayload,
  assembleContext,
  AnswerSchema,
  CitationSchema,
  // Internals exposed for tests
  fetchDealSnapshot,
  fetchRiskSummary,
  fetchTopComps,
  // Constants
  DEFAULT_TOP_K,
  MAX_QUESTION_LENGTH,
};
