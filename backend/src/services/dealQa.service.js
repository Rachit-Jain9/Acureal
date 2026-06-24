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
const { sanitizeAiProse } = require('../utils/aiLegalProseGuard');
const { buildVisibleDealCondition } = require('../utils/dealVisibility');
// P7-PR1 (Q&A v2) — pull the full structural workspace (lite mode skips AI
// narration + persistence + activities) so the Q&A model can cite ANY
// slice (recommendations / deal_doctor / ic_readiness / micro_market /
// best_use / structure / capital_stack / promoter / k_rera / dd /
// approvals / waterfall) — not just the 4 V1 synthetic ids.
const dealWorkspaceService = require('./dealWorkspace.service');
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
        AND deleted_at IS NULL
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
  // V1 fired three deterministic queries + the embedding search in
  // parallel. V2 (P7-PR1) adds the FULL workspace via the composer's
  // lite mode — IC Readiness, Micro-Market, Best Use, Deal-Structure
  // Recommender, Capital-Stack Optimizer, K-RERA Readiness, Promoter
  // Profile, DD checklist, Approvals, Recommendations (deterministic
  // only — no narration), Deal Doctor findings, Waterfall — all
  // become citable sources. Lite mode skips the narration AI calls +
  // persistence + activities + audit events so the wall time stays
  // within an interactive Q&A budget (~500-800ms).
  //
  // Callers that have already fetched the deal (e.g. askQuestion's
  // visibility check) can pass it via `deal` to skip the duplicate
  // round-trip.
  const dealPromise = dealOverride
    ? Promise.resolve(dealOverride)
    : fetchDealSnapshot(dealId);
  // The workspace composer fails-closed on access (not-found / not-visible)
  // so we wrap it in a catch — Q&A should still answer with the V1 surfaces
  // even if a single workspace slice errors. The lite-mode composer is
  // migration-tolerant for every secondary slice.
  const workspacePromise = dealWorkspaceService
    .getDealWorkspace(dealId, { lite: true })
    .catch((err) => {
      log.warn('qa_workspace_lite_failed_continuing', { dealId, error: err.message });
      return null;
    });
  const [deal, risks, comps, retrievedChunks, workspace] = await Promise.all([
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
    workspacePromise,
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

  // V2 — flatten the workspace into the prompt's structured-slice slots.
  // Each slot is tightly-bounded so a verbose slice can't blow out the
  // token budget: ic_readiness ships top_gaps only, recommendations ship
  // headline + verb + severity + signals only, etc. The model uses the
  // slice's canonical synthetic citation id when claiming a fact.
  const slices = workspace ? slimWorkspaceForPrompt(workspace) : null;

  return { deal, risks, comps, chunks: hydratedChunks, slices };
}

/**
 * Convert the lite-workspace payload into a flat, prompt-token-efficient
 * shape. Each slice keeps only the fields the model can actually cite,
 * and array fields are capped (5-12 entries) so a deal with 200 documents
 * doesn't push the prompt past the model's input window.
 *
 * Returns `null` for slices that don't have data for this deal — the
 * model is told to mention "data not yet recorded" instead of fabricating.
 */
function slimWorkspaceForPrompt(workspace) {
  const out = {};
  // ── IC Readiness Pack ─────────────────────────────────────────────────
  const icr = workspace.ic_readiness;
  if (icr) {
    out.ic_readiness = {
      score: icr.score,
      tier: icr.tier,
      pillars: Array.isArray(icr.pillars)
        ? icr.pillars.slice(0, 7).map((p) => ({
            key: p.key,
            label: p.label,
            score: p.score,
            weight: p.weight,
            status: p.status,
          }))
        : [],
      top_gaps: Array.isArray(icr.top_gaps)
        ? icr.top_gaps.slice(0, 10).map((g) => ({
            label: g.label,
            severity: g.severity,
            pillar: g.pillar,
            recommended_action: g.recommended_action,
          }))
        : [],
    };
  }
  // ── Karnataka RERA Readiness Pack ─────────────────────────────────────
  const kr = workspace.karnataka_rera_readiness;
  if (kr) {
    out.karnataka_rera_readiness = {
      applicable: kr.applicable,
      score: kr.score,
      tier: kr.tier,
      top_gaps: Array.isArray(kr.top_gaps)
        ? kr.top_gaps.slice(0, 8).map((g) => ({
            label: g.label,
            severity: g.severity,
            recommended_action: g.recommended_action,
          }))
        : [],
    };
  }
  // ── Micro-Market Briefing ─────────────────────────────────────────────
  const mm = workspace.micro_market;
  if (mm) {
    out.micro_market = {
      classification: mm.classification,
      locality: mm.locality
        ? {
            name: mm.locality.name,
            tier: mm.locality.tier,
            asset_class_fit: mm.locality.asset_class_fit,
            primary_demand_drivers: mm.locality.primary_demand_drivers,
          }
        : null,
      benchmarks: Array.isArray(mm.benchmarks)
        ? mm.benchmarks.slice(0, 8).map((b) => ({
            metric: b.metric,
            value: b.value,
            unit: b.unit,
            band_lo: b.band_lo,
            band_hi: b.band_hi,
            n_observations: b.n_observations,
          }))
        : [],
      demand_signals: Array.isArray(mm.demand_signals)
        ? mm.demand_signals.slice(0, 6).map((s) => ({
            label: s.label,
            tone: s.tone,
            value: s.value,
          }))
        : [],
    };
  }
  // ── Best Use Simulator ────────────────────────────────────────────────
  const bu = workspace.best_use;
  if (bu) {
    out.best_use = {
      top: Array.isArray(bu.scenarios)
        ? bu.scenarios.slice(0, 4).map((s) => ({
            asset_class: s.asset_class,
            score: s.score,
            tier: s.tier,
            reason: s.reason,
          }))
        : [],
    };
  }
  // ── Deal-Structure Recommender ────────────────────────────────────────
  const ds = workspace.deal_structure_recommender;
  if (ds) {
    out.deal_structure_recommender = {
      top: Array.isArray(ds.scenarios)
        ? ds.scenarios.slice(0, 4).map((s) => ({
            structure: s.structure,
            score: s.score,
            tier: s.tier,
            reason: s.reason,
          }))
        : [],
    };
  }
  // ── Capital-Stack Optimizer ───────────────────────────────────────────
  const cs = workspace.capital_stack_optimizer;
  if (cs) {
    out.capital_stack_optimizer = {
      top: Array.isArray(cs.scenarios)
        ? cs.scenarios.slice(0, 3).map((s) => ({
            label: s.label,
            score: s.score,
            tier: s.tier,
            debt_pct: s.debt_pct,
            equity_pct: s.equity_pct,
            mezz_pct: s.mezz_pct,
            covenant_issues: s.covenant_issues,
          }))
        : [],
    };
  }
  // ── Promoter Profile ──────────────────────────────────────────────────
  const pp = workspace.promoter_profile;
  if (pp) {
    out.promoter_profile = {
      promoter_name: pp.promoter_name,
      entity_type: pp.entity_type,
      posture: pp.posture,
      total_projects: pp.total_projects,
      delivered_on_time: pp.delivered_on_time,
      delivered_delayed: pp.delivered_delayed,
      rera_registered: pp.rera_registered,
      rera_complaints: pp.rera_complaints,
      signals: Array.isArray(pp.signals)
        ? pp.signals.slice(0, 6).map((s) => ({ label: s.label, tone: s.tone }))
        : [],
    };
  }
  // ── DD checklist ──────────────────────────────────────────────────────
  if (workspace.dd) {
    const ddItems = Array.isArray(workspace.dd.items) ? workspace.dd.items : [];
    const openDealBreakers = ddItems.filter(
      (i) => i.severity === 'deal_breaker' && !['completed', 'not_applicable'].includes(i.status),
    );
    const recentlyUpdated = ddItems
      .filter((i) => i.status && i.status !== 'pending')
      .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
      .slice(0, 8);
    out.dd_checklist = {
      score: workspace.dd.score,
      open_deal_breakers: openDealBreakers.slice(0, 8).map((d) => ({
        title: d.title,
        category: d.category,
        status: d.status,
        due_date: d.due_date,
      })),
      recent: recentlyUpdated.map((d) => ({
        title: d.title,
        category: d.category,
        status: d.status,
        severity: d.severity,
      })),
    };
  }
  // ── Approvals ─────────────────────────────────────────────────────────
  if (Array.isArray(workspace.approvals)) {
    const required = workspace.approvals.filter((a) => a.is_required !== false);
    const available = required.filter((a) => a.is_available || a.is_uploaded || a.is_validated);
    const missing = required.filter((a) => !(a.is_available || a.is_uploaded || a.is_validated));
    out.approvals = {
      required_count: required.length,
      available_count: available.length,
      missing: missing.slice(0, 10).map((a) => ({
        name: a.name,
        approval_type: a.approval_type,
        status: a.is_validated ? 'validated' : a.is_uploaded ? 'uploaded' : a.is_available ? 'available' : 'missing',
        expiry_date: a.expiry_date,
      })),
    };
  }
  // ── Recommendations (deterministic — no narration) ───────────────────
  const recs = workspace.recommendations;
  if (recs) {
    out.recommendations = {
      generated_at: recs.generated_at,
      snapshot_hash: recs.snapshot_hash,
      cards: Array.isArray(recs.recommendations)
        ? recs.recommendations.slice(0, 12).map((c) => ({
            id: c.id,
            verb: c.verb,
            topic: c.topic,
            topic_label: c.topic_label,
            severity: c.severity,
            headline: c.headline,
            detail: c.detail,
            ai_narratable: c.ai_narratable,
            team_feedback: c.team_feedback || null,
          }))
        : [],
    };
  }
  // ── Deal Doctor findings (deterministic — no narration) ──────────────
  const dd = workspace.deal_doctor;
  if (dd) {
    out.deal_doctor = {
      finding_count: dd.finding_count,
      groups: dd.groups,
      findings: Array.isArray(dd.findings)
        ? dd.findings.slice(0, 12).map((f) => ({
            id: f.id,
            verb: f.verb,
            topic: f.topic,
            severity: f.severity,
            finding: f.finding,
            why_it_matters: f.why_it_matters,
          }))
        : [],
    };
  }
  // ── Waterfall (JDA / JV) ─────────────────────────────────────────────
  if (workspace.waterfall && (workspace.waterfall.jda || workspace.waterfall.jv)) {
    out.waterfall = {
      jda: workspace.waterfall.jda
        ? {
            landowner_share_pct: workspace.waterfall.jda.landowner_share_pct,
            developer_share_pct: workspace.waterfall.jda.developer_share_pct,
            preferred_return_pct: workspace.waterfall.jda.preferred_return_pct,
          }
        : null,
      jv: workspace.waterfall.jv
        ? {
            preferred_return_pct: workspace.waterfall.jv.preferred_return_pct,
            catch_up_pct: workspace.waterfall.jv.catch_up_pct,
            promote_tier: workspace.waterfall.jv.promote_tier,
          }
        : null,
    };
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Prompt + Claude call
// ──────────────────────────────────────────────────────────────────────────

// Synthetic source ids the model is allowed to cite when grounding a
// claim in non-document context (the deal snapshot, comps table, or
// risk flags). These are NOT document chunks — they're the structured
// fields the prompt already supplies as context. Without these the
// validator rejects answers grounded in deal-level facts whenever the
// deal has no uploaded documents (a common case).
const SYNTHETIC_CITATION_IDS = new Set([
  // V1 — base slices (always populated)
  'deal_snapshot',              // financials + property + ask price + locality
  'risk_flags',                 // open risk_flags rows
  'comps',                      // top-N comparable transactions
  'financials',                 // alias often surfaced by the model
  // V2 (P7-PR1) — every workspace slice that ships structural facts the
  // model can ground a claim in. Each maps to a `slices.<key>` payload
  // (see slimWorkspaceForPrompt) and renders in the UI as a "Deal data"
  // citation chip with a friendly label.
  'ic_readiness',               // IC Readiness Pack (7 pillars + top gaps)
  'karnataka_rera_readiness',   // K-RERA Readiness Pack
  'micro_market',               // Micro-Market Briefing (locality + benchmarks)
  'best_use',                   // Best Use Simulator scoring
  'deal_structure_recommender', // Deal Structure scoring
  'capital_stack_optimizer',    // Capital Stack Optimizer
  'promoter_profile',           // Promoter posture + factors
  'dd_checklist',               // DD score + open deal-breakers
  'approvals',                  // Required vs available approvals
  'recommendations',            // Recommendation Engine cards
  'deal_doctor',                // Deal Doctor findings
  'waterfall',                  // JDA/JV waterfall shape
]);

// Display labels for synthetic citations — surfaced in the citation
// chip so the UI doesn't show a raw token like "deal_snapshot".
const SYNTHETIC_CITATION_LABELS = {
  // V1
  deal_snapshot: 'Deal snapshot',
  risk_flags:    'Open risk flags',
  comps:         'Comparable transactions',
  financials:    'Financial model',
  // V2
  ic_readiness:               'IC Readiness Pack',
  karnataka_rera_readiness:   'K-RERA Readiness Pack',
  micro_market:               'Micro-Market Briefing',
  best_use:                   'Best Use Simulator',
  deal_structure_recommender: 'Deal-Structure Recommender',
  capital_stack_optimizer:    'Capital-Stack Optimizer',
  promoter_profile:           'Promoter Profile',
  dd_checklist:               'DD checklist',
  approvals:                  'Required approvals',
  recommendations:            'Recommendation Engine',
  deal_doctor:                'Deal Doctor findings',
  waterfall:                  'Waterfall (JDA/JV)',
};

const SYSTEM_PROMPT = `You are a senior Indian real-estate analyst answering a colleague's question about a specific deal at a Bengaluru private-equity fund.

Hard rules:
1. ONLY use facts that appear in the supplied context (deal_snapshot, risk_flags, comps, retrieved_chunks, OR any populated entry under "slices"). Never invent a number, name, date, RERA reference, or zoning code.
2. Every factual claim MUST be backed by a citation. Citations work in TWO modes:
   • **Document-grounded** — when the claim comes from an uploaded document, the embedding_id MUST match an entry in retrieved_chunks exactly.
   • **Slice-grounded** — when the claim comes from a structured workspace slice (NOT a document), use the slice's canonical synthetic id as the embedding_id. The full set of allowed slice ids:
       — "deal_snapshot"              → financials + property + ask price + locality (the base deal row)
       — "risk_flags"                 → open risk flags
       — "comps"                      → comparable transactions
       — "financials"                 → alias for financial fields on deal_snapshot
       — "ic_readiness"               → IC Readiness Pack (score, tier, 7 pillars, top gaps)
       — "karnataka_rera_readiness"   → K-RERA Readiness Pack (applicable, score, tier, gaps)
       — "micro_market"               → Micro-Market Briefing (locality, benchmarks, demand signals)
       — "best_use"                   → Best Use Simulator scoring (top asset classes for this parcel)
       — "deal_structure_recommender" → Deal Structure scoring (outright / JDA / JV / etc.)
       — "capital_stack_optimizer"    → Capital Stack scenarios (debt/equity/mezz mix + covenants)
       — "promoter_profile"           → Promoter posture + delivery track record + signals
       — "dd_checklist"               → DD score + open deal-breakers + recent items
       — "approvals"                  → Required approval count vs available count + the missing list
       — "recommendations"            → Recommendation Engine cards (each carries verb, topic, headline, severity, team_feedback)
       — "deal_doctor"                → Deal Doctor diagnostic findings
       — "waterfall"                  → JDA/JV waterfall split
     Pick the most-specific slice. E.g. for "Why is this deal Pre-IC?" cite "ic_readiness", not "deal_snapshot".
3. Do not put document chunk ids in why_relevant; put them in embedding_id. why_relevant is a one-phrase note about why the cited evidence supports the claim.
4. Output STRICTLY this JSON shape — no markdown fence, no preamble:
   {
     "answer": "<3-6 sentences, plain Indian English, investor-grade>",
     "citations": [
       {
         "embedding_id": "<retrieved chunk id OR one of the slice ids listed above>",
         "excerpt": "<for slice citations, paraphrase the specific field/value that supports the claim — e.g. 'IC tier: Pre-IC (58/100), top gap: financial model not finalised'>",
         "why_relevant": "<one short phrase>"
       }
     ],
     "confidence": "high|medium|low"
   }
5. citations array MUST contain at least one entry whenever the answer makes any factual claim.
6. If retrieved_chunks is empty AND the relevant slice is also empty, set confidence="low" and explain in answer what's missing — still cite the closest available source.
7. Do not produce legal opinions on title chain, encumbrance, RERA compliance status, or statutory approvals. Surface what the supplied facts say; for those four topics flag where independent verification is needed (the legal carve-out from CLAUDE.md).
8. Use the closed verb dictionary when characterising the deal's posture: "Recommend / Consider / Re-examine / Flag / Stress-test" for recommendations; "Diverges / Lacks support / Inconsistent / Below benchmark / Above benchmark / Missing" for diagnoses. Never use absolute verbs ("Buy / Reject / Approve / Decline / Clear / Pass").

The system layer post-validates that every embedding_id you cite is either a real retrieved chunk OR one of the slice ids listed above. Anything else is rejected and the answer is discarded.`;

/**
 * Compose the user-facing prompt payload. The assembled context is
 * embedded as JSON the LLM reads. Keeping it as JSON (vs. prose) makes
 * it predictable for the model and easy to test against.
 */
function buildPromptPayload({ question, context }) {
  const payload = {
    question: question.trim(),
    deal_snapshot: context.deal,
    risk_flags: context.risks,
    comps: context.comps,
    retrieved_chunks: context.chunks,
  };
  // P7-PR1 — flat-but-bounded structural slices. The model reads these
  // to ground a claim in a specific workspace surface (ic_readiness /
  // micro_market / etc.). Omitted when the workspace lite fetch failed
  // so the V1 surfaces continue to work even on a degraded read.
  if (context.slices && Object.keys(context.slices).length > 0) {
    payload.slices = context.slices;
  }
  return payload;
}

/**
 * Validate that every citation's embedding_id is either a real retrieved
 * chunk id OR one of the synthetic non-document ids (deal_snapshot /
 * risk_flags / comps / financials). The latter let the model ground a
 * claim in deal-level fields when no document chunks were retrieved —
 * which is the common case for sourcing-stage deals with no uploaded
 * documents yet. Returns { valid: bool, invalid_ids: [...] }.
 */
function validateCitations(citations, retrievedChunks) {
  const documentIds = new Set(retrievedChunks.map((c) => c.embedding_id));
  const invalid = [];
  for (const c of citations || []) {
    const id = c.embedding_id;
    if (documentIds.has(id)) continue;
    if (SYNTHETIC_CITATION_IDS.has(id)) continue;
    invalid.push(id);
  }
  return { valid: invalid.length === 0, invalid_ids: invalid };
}

/**
 * Hydrate the model-supplied citations with full metadata from the
 * retrieval set so the UI can render document name, page, similarity
 * without a second round-trip. Synthetic citations (deal_snapshot etc.)
 * get a friendly display label and a `kind: 'synthetic'` flag so the
 * UI can differentiate them from document-backed citations.
 */
function hydrateCitations(modelCitations, retrievedChunks) {
  const byId = new Map(retrievedChunks.map((c) => [c.embedding_id, c]));
  return (modelCitations || []).map((c) => {
    if (SYNTHETIC_CITATION_IDS.has(c.embedding_id)) {
      return {
        embedding_id: c.embedding_id,
        kind: 'synthetic',
        document_id: null,
        document_name: SYNTHETIC_CITATION_LABELS[c.embedding_id] || c.embedding_id,
        page_number: null,
        similarity: null,
        excerpt: c.excerpt,
        why_relevant: c.why_relevant || null,
        chunk_text: null,
      };
    }
    const chunk = byId.get(c.embedding_id);
    return {
      embedding_id: c.embedding_id,
      kind: 'document',
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
  if (!getProviderAvailability().gpt_compatible) {
    throw Object.assign(new Error('OPENAI_API_KEY not configured.'), { statusCode: 503 });
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

  // Legal-four + closed-verb backstop on the AI answer before it is verified,
  // persisted, or returned: strip any statutory-verdict sentence (title / RERA /
  // encumbrance / approval) and rewrite absolute IC verbs — the same guard the
  // deal-analysis Overview + IC exports use. Prompt is primary; this is the
  // deterministic backstop (CLAUDE.md legal carve-out).
  if (modelResult?.answer) {
    modelResult.answer = sanitizeAiProse(modelResult.answer).text;
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
  if (!getProviderAvailability().gpt_compatible) {
    return { error: 'OPENAI_API_KEY not configured', status: 503 };
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

      // Legal-four + closed-verb backstop on the streamed answer before it is
      // verified/persisted — mirrors askQuestion (CLAUDE.md legal carve-out).
      if (modelResult?.answer) {
        modelResult.answer = sanitizeAiProse(modelResult.answer).text;
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
