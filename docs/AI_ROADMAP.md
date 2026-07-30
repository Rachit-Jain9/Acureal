# AI Roadmap — Institutional Analyst, not a Chatbot

**Last reviewed:** 2026-05-17 (after PR-NX25 + PR-NX26 shipped Document Ingestion auto-fill end-to-end — canonical ontology package + apply-extractions endpoint + AutoFillFromDocumentsModal frontend — closing the flagship priority from the 2026-05-15 Strategic Review §III.1).
**Owner:** Acureal core
**Status:** Tiers 0–2 LANDED in full. Tier 4.1 LANDED. Tier 3 foundation LANDED (registry only). The 4-of-4 AI artifact suite is fully wired (deal_analysis, risk_brief, ic_memo, parcel_narrative all share persistence + numerical verifier + Copy/Download exports). **Document Ingestion + auto-fill LANDED 2026-05-17** (Strategic Review §III.1 flagship — PR-NX25 #345 + PR-NX26 #346): operator uploads sale deed → Gemini extracts → modal proposes → operator approves → deal + property populated with full audit trail via `@redip/real-estate-ontology` v1.0.0 single source of truth. Open Tier work: Tier 2.1 (Vercel AI SDK migration — bundled with Tier 3.2 agent runner whenever that ships) and Tier 5 reliability items.

This is the canonical, single-source roadmap for AI work in Acureal. It supersedes any earlier plan doc that named individual prompts or models. Whenever something here changes, update this file in the same PR.

### Operator-locked deferrals / skips (2026-05-09)

Items the operator (Rachit) explicitly chose NOT to pursue from the 2026-05-08 product-roadmap document. Recorded here so future sessions don't re-relitigate. These are distinct from the AI-tier numbering above; they reference the data-flywheel tier numbering in the 2026-05-08 handoff:

| Handoff item | Decision (2026-05-09) | Rationale |
|---|---|---|
| Tier-1 #5 — Karnataka IGR SRO PDF extraction | DEFERRED until operator uploads PDF | Manual data-acquisition blocker; extraction infra ready (`igr_guidance_pdf` doctype) |
| Tier-1 #6 — Co-working / managed office benchmarks | SKIPPED | Operator-initiated 2026-05-08; no schema follow-up planned |
| Tier-1 #7 — Student housing / co-living benchmarks | SKIPPED | Operator-initiated 2026-05-08 |
| Tier-1 #8 — Senior living benchmarks | SKIPPED | Operator-initiated 2026-05-08 |
| Tier-1 #9 — Data center detailed comps | SKIPPED | Operator-initiated 2026-05-08 |
| Tier-3 (handoff) — Source-identity verification for broker reports | SKIPPED | Operator-initiated 2026-05-09 |
| Tier-3 (handoff) — Fine-tune small extraction model on reviewed corpus | SKIPPED | Operator-initiated 2026-05-09; was conditional on >2,000 reviewed rows anyway |
| Tier-3 (handoff) — Multi-agent orchestration | SKIPPED | Operator-initiated 2026-05-09; the narrow Q&A agent stays narrow on purpose |
| Tier-3 (handoff) — WhatsApp Business API ingestion | SKIPPED | Operator-initiated 2026-05-09; email ingestion (Tier-0 #181) covers the use case |

---

## 1. Mission

Acureal's AI does **not** chat with a deal. It reviews a deal the way an institutional analyst would — by reading uploaded documents, calling deterministic underwriting tools, comparing outputs against verified comps, surfacing weak assumptions with citations, and drafting an IC-grade memo for human approval.

The winning UX is one button: **"Have Acureal review this deal."** Output: a structured memo with evidence, downside scenarios, missing diligence items, and a recommendation — never a free-form chat reply.

If a feature could be called "chat with your deal", we don't ship it. That's the bright line.

---

## 2. Hard rules (non-negotiable)

These extend `CLAUDE.md`'s AI Routing Policy with what we've learned:

1. **Deterministic code is the only thing that calculates numbers.** AI explains, summarises, structures, and diagnoses. The TS financial-kernel calculates IRR/NPV/DSCR/residual land value/NOI. AI calls the kernel; AI never replaces it.
2. **Every AI output that influences a decision carries traceable references** to specific uploaded documents or verified feeds. No free-floating assertions.
3. **Cite or null.** If a fact isn't anchored to a `source_document_pages` row, it doesn't surface in evidence. The AI extraction prompt registry (19 doctypes) enforces this at the prompt level.
4. **Per-call cost cap before invocation.** `costGuard.assertWithinDailyCap()` blocks calls that would breach the org's daily budget. Throws `CostCapExceededError` (HTTP 429).
5. **Never expose unscoped DB access to the AI.** Tool calls go through narrow backend functions that enforce RLS via the requesting user's session, not service-role.
6. **Drafts before commits.** AI-generated artifacts (memos, narratives) land as `approval_status = 'draft'` until a human approves. Then they're persisted/exported.
7. **No service-role key in browser. No raw API key in browser. Ever.**
8. **Cross-border-transfer is disclosed.** Anthropic + Google = US. Privacy Policy §6 names them as sub-processors with the DPDP §16 disclosure.

---

## 3. Architecture

### 3.1 Current (as of 2026-05-16)

> **2026-05-16 refresh** (PR-NX20): model defaults bumped per PR-NX9 (#322); cross-product AI-Assisted Briefing now lives on XLSX (PR-NX12 #328), DOCX + PPTX (PR-NX18 #335) — all 3 formats share the same `dealBriefing.service.js`. Cross-product consistency enforced by `exports.crossProductReconciliation.test.js` (PR-NX19 #336). See `SESSION_LOG.md` for the full PR-by-PR history since 2026-05-04.

### 3.1.legacy Architecture snapshot (as of 2026-05-04, kept for diff reference)

```
React 18 / Vite frontend
  ↓ axios with httpOnly cookie auth
Express on Vercel serverless (api/index.js, 300s maxDuration, 1024MB)
  ↓
AI Router (backend/src/services/ai/aiRouter.js)
  ├── runAI({ task, attach, metadata, cache, retry, run })
  │     ├── cost-guard pre-check
  │     ├── response-cache lookup (90-day TTL, deterministic key)
  │     ├── retry with exponential backoff (3 attempts, jittered)
  │     └── persist call log → ai_call_logs
  ├── runGeminiInline / runClaudeReasoning / runClaudeWithDocument / runOpenAIReasoning helpers
  ├── runAIWithSchema (Zod-validated structured output, reprompt once on parse fail)
  └── Provider Registry (lazy-init SDKs; Gemini + Anthropic + OpenAI)
        ↓
   Deterministic tools (NOT AI)
   ├── financial-kernel (TS, parity-tested)
   ├── parcel intelligence service (HMAC-signed snapshots)
   ├── extraction.service (Gemini-first, Claude fallback)
   ├── comps service (verified-data only)
   └── evidence ingestion (per-fact provenance)
        ↓
   Supabase Postgres (RLS on 25+ tables) + Vercel Blob storage
```

### 3.2 Target (after Tiers 1–3)

```
[Same chrome up to AI Router]
        ↓
AI Router (extended)
  ├── ...existing...
  ├── prompt-cache control (Anthropic ephemeral cache for stable prefixes)
  ├── streaming dispatcher (SSE for long Claude calls)
  ├── Zod-validated structured output boundary
  └── Tool registry resolver
        ↓
Tool Registry (new layer — backend/src/services/ai/tools/)
  ├── Read tools:    getDeal, searchComps, getMarketSnapshot, getEvidence
  ├── Compute tools: runUnderwriting, runSensitivity, getParcelIntelligence
  ├── Draft tools:   draftICMemo, draftRiskNarrative
  └── Approval tools (gated): saveAsDraft, exportToPDF
        ↓
Agent Personas (one coherent layer; no five-agent fragmentation)
  ├── Deal Analyst  (default — review/screen/critique a deal)
  └── Doc Q&A       (answer from a deal's evidence corpus only)
        ↓
[Tools call existing deterministic services]
```

### 3.3 What we deliberately do NOT build

- **Five separate agents** (Deal Screening + Comps Intelligence + IC Memo + Q&A + Market Intelligence as distinct personas). One coherent reasoning layer with task-specific prompt templates instead. Less drift, less eval surface, less prompt soup.
- **Floating "Ask AI" chat bubble.** Commoditises the product. We ship specific opinionated workflows, not a general chat box.
- **AI-driven SQL.** The AI never sees the DB schema. Tools return pre-shaped JSON.
- **AI-driven destructive actions.** No `deleteDeal`, no `updateDealAssumptions` without explicit per-action user confirmation.
- **Custom-trained ML / RL** for underwriting. Not until ≥500 labelled samples per class exist AND explainability survives an LP question. See `CLAUDE.md` §"Hard rules".

---

## 4. What's already shipped (reality check)

This section exists because external advice tends to prescribe things Acureal already does. Cross-check before "adding" any of these.

| Capability | Status | Where |
|---|---|---|
| Gemini extraction (19 doctypes, structured JSON, multi-language) | ✅ Live | `extractionPrompts.js` |
| Claude reasoning + document-input fallback | ✅ Live | `runClaudeWithDocument` in providerRegistry |
| Per-call cost ledger (provider, model, tokens, status, lineage) | ✅ Live | `ai_call_logs` table (PR #134) |
| Per-org daily cost cap (HTTP 429 when breached) | ✅ Live | `lib/costGuard.js` |
| Response cache (90-day TTL, deterministic key, fail-open) | ✅ Live | `ai_response_cache` table (PR #146) |
| Prompt versioning (registry version + per-prompt sha256) | ✅ Live | `extractionPrompts.js` (PR #146) |
| Retry with exponential backoff (5xx/429/network/timeout only) | ✅ Live | `aiRetry.js` (PR #149, consolidated PR #151) |
| Provider fallback (Gemini → Claude with document) | ✅ Live | `extraction.service.callExtractionWithFallback` |
| Per-fact evidence registry (page + bbox + confidence) | ✅ Live | `evidence_facts` + `source_document_pages` |
| HMAC-signed snapshots (T4) | ✅ Live | `parcel_intelligence_signature.sql` |
| RLS on tenant tables | ✅ Live | 25+ tables |
| Daily retention sweep cron (DPDP §8(7)) | ✅ Live | PR #147 |
| Service-role key never in browser | ✅ Enforced | server-only env |

If a roadmap proposal restates one of the above as "build this", it's noise — already done.

---

## 5. Tier framework

Tiers run in order. Each tier has an entry criterion (the prior tier shipped) and a measurable exit. Within a tier, items can ship in parallel if they don't share files.

### Tier 0 — Foundations (LANDED 2026-05-04)
Cost ledger, cost cap, response cache, prompt versioning, retry, fallback, evidence registry.

**Exit criterion:** met. Every AI call is logged, capped, retryable, deduplicatable, and traceable to evidence.

### Tier 1 — Cost & latency wins (IN PROGRESS)
Lowest-effort, highest-immediate-ROI hardening. Each item is 1–2 PRs.

| # | Task | Effort | Status |
|---|---|---:|:---|
| 1.1 | Anthropic ephemeral prompt caching on stable prefixes | 1 PR | ✅ LANDED PR #152 |
| 1.2 | Gemini context caching for the master-plan corpus | 1 PR | DEFERRED — Acureal doesn't attach a single huge corpus per call; low ROI |
| 1.3 | Streaming for IC memo generation (SSE → progressive UI) | 1 PR | ✅ LANDED PR #154 |
| 1.4 | Zod validation at provider boundary (reprompt-on-parse-fail) | 1 PR | ✅ LANDED PR #153 |
| 1.5 | OpenAI as third available provider (reasoning + embeddings) | 1 PR | ✅ LANDED PR #153 |

**Exit criterion:** met for the ROI-bearing items.

### Tier 2 — Structured AI plumbing (mostly LANDED)
Provider abstraction + observability. Sets the foundation for Tier 3.

| # | Task | Effort | Status |
|---|---|---:|:---|
| 2.1 | Vercel AI SDK migration (`@ai-sdk/anthropic` + `@ai-sdk/google`) | 3 PRs | DEFERRED — refactor with no new capability today; revisit when streaming + tool use share a use case the SDK simplifies meaningfully |
| 2.2 | OpenTelemetry-shape tracing per `runAI` call | 1 PR | ✅ LANDED PR #161 |
| 2.3 | `ai_routing_config` table — runtime-editable task→provider map | 1 PR | ✅ LANDED PR #160 |

**Status note on 2.1:** the streaming + retry + cache + observability story already works through the raw Anthropic + Google + OpenAI SDKs. The Vercel AI SDK doesn't add capability; it simplifies _future_ tool use + streaming patterns. We'll migrate when the agent runner (Tier 3.2) ships and the provider-call sites change shape anyway — bundling the migration with that refactor avoids two passes over every site.

### Tier 3 — Agentic layer (foundation LANDED; full agent DEFERRED)
The "Deal Analyst" workflow. Multi-PR; full agent gated by entry criterion.

| # | Task | Effort | Status |
|---|---|---:|:---|
| 3.1 | Tool registry — narrow backend functions with permission gates | 2 PRs | ✅ LANDED PR #166 (foundation: registry + 3 read-tier tools) |
| 3.2 | Function/tool-use wiring through provider SDKs (agent runner) | 2 PRs | DEFERRED until entry criterion |
| 3.3 | Agent persona: **Deal Analyst** (one persona, task-templated prompts) | 2 PRs | DEFERRED until entry criterion |
| 3.4 | Draft → Approve → Persist flow for AI artifacts | 1 PR | partial — `ai_artifacts` table + draft status shipped (PR #155); UI approval flow deferred |
| 3.5 | Agent persona: **Doc Q&A** (answers from one deal's evidence only) | 2 PRs | DEFERRED until entry criterion |

**Entry criterion for 3.2/3.3/3.5:** Tier 2 shipped + at least 50 real deals in production with full evidence chains.
**Exit criterion:** "Have Acureal review this deal" produces a draft IC memo from real inputs, with citations to specific uploaded pages and underwriting tool outputs, gated by user approval before any persistence.

### Tier 4 — Semantic + Indic layer (DEFERRED, parallel)
Independent of Tiers 2–3 — can run in parallel once Tier 1 ships.

| # | Task | Effort | Status |
|---|---|---:|:---|
| 4.1 | pgvector + OpenAI embeddings for cross-document search | 3 PRs | ✅ LANDED PR #164 (schema + service + auto-index on extraction) + PR #165 (search route + UI on Documents tab) |
| 4.2 | Field-level PII encryption (`pgcrypto` for users.email/phone) | 2 PRs | DEFERRED — Postgres-at-rest encryption + RLS adequate until enterprise contract demands more |
| 4.3 | Bhashini API adapter (Indic translation, govt-of-India) | 1 PR | DEFERRED — wait for actual Indic quality dips before adding |
| 4.4 | IndicTrans2 self-host fallback (only if Bhashini SLA insufficient) | 2 PRs | conditional |
| 4.5 | Tesseract Kannada fallback (Gemini outage insurance) | 1 PR | DEFERRED — Gemini reliability has been adequate |

**Entry criterion:** Tier 1 shipped.
**Exit criterion:** "find clauses similar to this one across the corpus" works in <500ms p95; Indic-only documents extract at parity with English on field-completion-rate metric.

---

## 6. Tier 1 — Cost & latency wins (detail)

### 6.1 Anthropic ephemeral prompt caching (Task 1.1) — 🎯 next-up

**Problem.** Every Claude reasoning call resends the full system prompt + tool definitions + Bengaluru taxonomy on every request. The system block is ~2–4k tokens of stable text that doesn't change per call. At Claude Sonnet 4.6 input pricing of $3/MTok, a memo workflow making 10 reasoning calls/day burns ~$0.50/day on context that should be cached.

**Solution.** Anthropic's prompt cache. Cache reads are **0.1× base input price** (90% discount). The cache TTL is 5 minutes ephemeral; renewed on each hit. As long as a workflow makes more than one Claude call within 5 minutes, the second+ calls pay 10% of the input cost.

**Implementation shape:**
```js
// In providerRegistry.runClaudeReasoning + runClaudeWithDocument:
// Mark the system block (and tool defs, when added) with cache_control.
const message = await client.messages.create({
  model,
  max_tokens: maxTokens,
  system: [
    { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
  ],
  messages: [...],
});
```

The router records `cache_creation_input_tokens` and `cache_read_input_tokens` from `message.usage` into `ai_call_logs.metadata` so the cost dashboard can split paid-input vs cached-input.

**Exit:** observable in `ai_call_logs.metadata.cache_read_input_tokens > 0` for the 2nd+ Claude call within a 5-minute window of the same workflow.

### 6.2 Gemini context caching (Task 1.2) — scoped

**Problem.** Master-plan extraction prompts re-attach the same large reference corpus (zoning rule book, district taxonomy) on every call. Gemini's context cache addresses this but is opt-in.

**Solution.** Build a `geminiContextCache.js` adapter that creates a Gemini cache once per corpus version and reuses the cache name across calls. Cached tokens cost less and reduce time-to-first-token.

**Defer flag:** scope first — measure how many extraction calls actually share a stable prefix. May be a smaller win than Anthropic caching.

### 6.3 Streaming for IC memo (Task 1.3) — scoped

**Problem.** IC memo generation is 20–40s. The page looks frozen. The user thinks it crashed and reloads, killing the generation.

**Solution.** SSE endpoint `POST /api/ai/memo/draft/stream` emits `data:` chunks as Claude streams. Frontend renders progressively (typing-indicator illusion). Perceived latency drops to <1s first-paint.

**Two PRs:**
- Backend: SSE endpoint, stream chunk serializer, abort handling, partial-on-error recovery
- Frontend: streaming reader hook, progressive render in IC Memo Drawer, "Cancel" button wiring

### 6.4 Zod validation at provider boundary (Task 1.4) — scoped

**Problem.** Every extraction prompt says "Return ONLY JSON" but the model sometimes wraps the response in markdown fences, adds a preamble, or returns a comma-trailing object. Currently we strip fences + JSON.parse in try/catch. A parse failure throws an opaque error.

**Solution.** Each prompt registers a Zod schema. The provider wrapper does `safeParse`. On parse fail: emit a structured error with the validation problem, *re-prompt* with the validator's complaint, and try once more before bubbling up. Parse failures get logged to `ai_call_logs.metadata.parse_failure_reason` for diagnostics.

---

## 7. Tier 3 — Agentic layer (detail; reference for when entry criteria hit)

The Deal Analyst Agent is the flagship. Spec it now so when we ship, scope is clear.

### 7.1 Tool registry shape

```ts
type Tool = {
  name: string;
  description: string;            // for the AI's tool selection
  inputSchema: z.ZodType;
  permission: 'read' | 'compute' | 'draft' | 'approval-required';
  handler: (input, ctx: { user, org, deal }) => Promise<output>;
};
```

Each tool runs server-side under the requesting user's session; RLS enforces tenant scope.

### 7.2 Permission tiers
- **read** — `getDeal`, `searchComps`, `getMarketSnapshot`, `getEvidence`. AI can call freely.
- **compute** — `runUnderwriting`, `runSensitivity`, `getParcelIntelligence`. AI can call; results cached per call.
- **draft** — `draftICMemo`, `draftRiskNarrative`. AI can call; output lands in `ai_artifacts` with `approval_status='draft'`.
- **approval-required** — `saveAsDraft`, `exportToPDF`. AI cannot call directly; surfaces the proposed action to the user as a confirmation modal.

### 7.3 What's banned outright
`deleteDeal`, `updateDealAssumptions`, `transitionStage`, anything that mutates an audit-trail-bearing record. Those stay strictly user-driven.

---

## 8. Cost framework

### 8.1 Model routing (per-task, env-overridable)

**Defaults refreshed 2026-05-15 per PR-NX9 (#322):** Gemini bumped from 2.5-flash → 3.1-flash-lite (cheaper + faster), Claude unchanged at Sonnet 4.6, OpenAI added for reasoning/synthesis paths at GPT-5.4. The `narrative_synthesis` task (used by the cross-product AI-Assisted Briefing in XLSX, DOCX, PPTX per PR-NX12 / PR-NX18) routes to Claude Sonnet 4.6 by default; operator can override per-task via `AI_PROVIDER_<TASK>` env vars without a code redeploy.

| Task | Default | Cheapest acceptable | Why |
|---|---|---|---|
| Document classification | Gemini 3.1 Flash-Lite | Gemini 3.1 Flash-Lite | Fast, multimodal, cheap |
| Document extraction (text+image) | Gemini 3.1 Flash-Lite | — | Required: multimodal native |
| Translation (Indic) | Gemini 3.1 Flash-Lite | Bhashini (when integrated) | Cost cliff vs paid LLMs |
| Comps cleanup | Gemini 3.1 Flash-Lite | GPT-5.4 mini | Either works; route by ops cost target |
| Reasoning / risk narrative | GPT-5.4 | Claude Sonnet 4.6 | OpenAI now leads on benchmark + cost; Claude fallback retained for redundancy |
| Market synthesis | GPT-5.4 | Claude Sonnet 4.6 | Same routing rationale as reasoning |
| **Narrative synthesis (AI-Assisted Briefing)** | **Claude Sonnet 4.6** | GPT-5.4 | Claude's prose quality + institutional voice strength is the right primary; OpenAI is the fallback when Anthropic is rate-limited |
| IC memo generation | Claude Sonnet 4.6 | GPT-5.4 | Long-form, structured |
| Scenario diagnosis ("why did IRR drop?") | Claude Sonnet 4.6 | — | Diagnostic reasoning |
| Red-team review (when added) | Claude Sonnet 4.6 | Sonnet 4.6 | Opus 4.7 is 5× output cost; not worth it pre-revenue |

**Opus 4.7 is explicitly NOT used.** $5/$25 per Mtok input/output is 5× Sonnet's output cost. Revisit only when the platform has paying-customer revenue absorbing the cost.

### 8.2 Cost guards (defence in depth)
1. Daily per-org cap (`AI_DAILY_COST_CAP_USD` env, costGuard middleware).
2. Per-call response cache hit (90-day TTL, fail-open).
3. Prompt cache on Anthropic stable prefixes (Tier 1.1, planned).
4. Retry classifier never retries permanent errors (no money burnt on 4xx loops).
5. `ai_call_logs.cost_usd` aggregates daily for dashboard.

---

## 9. Database schema additions (planned)

Listed here so the schema migrations stay coherent. Each table only ships when its tier ships.

### 9.1 Tier 1 (no schema changes — pure provider wiring)
None.

### 9.2 Tier 2
- `ai_routing_config` — `(task TEXT PK, provider TEXT, model TEXT, last_changed_by, last_changed_at)`. Service-role only.

### 9.3 Tier 3
- `ai_artifacts` — `(id, org_id, deal_id, artifact_type, content_md, content_jsonb, created_by_call_id FK ai_call_logs, approval_status TEXT, approved_by, approved_at, created_at)`. RLS by org.
- `ai_tool_calls` — child of `ai_call_logs`: `(id, ai_call_log_id, tool_name, input_jsonb, output_jsonb, latency_ms, status, error_message)`. Service-role only.

### 9.4 Tier 4
- `document_embeddings` — `(id, organization_id, document_id, page_number, chunk_text, embedding VECTOR(1024), created_at)`. RLS by org. ANN index `hnsw`.
- Field-level encryption: `users.email_encrypted BYTEA`, `users.email_lookup_hash TEXT`. Migration also rotates the existing `email` column to `email_normalized` for legacy reads while we phase it out.

---

## 10. UX/UI conventions for AI surfaces

These extend `docs/FRONTEND_GUIDELINES.md` for AI-specific affordances:

1. **Every AI artifact carries a banner.** "AI-assisted — requires human review" pill in `text-content-muted` on `bg-bg-secondary`. Mandatory in both UI and exported outputs (PPTX/XLSX/PDF).
2. **Confidence is rendered as a band, not a percentage.** "High / Medium / Low" with an explanation tooltip. Raw confidence numbers go into the source-explorer drawer, not on the surface.
3. **Citations are clickable.** Every AI fact opens the `EvidenceDrawer` deep-linked to the exact `source_document_pages` row.
4. **Streaming uses skeleton-then-stream.** Show the SkeletonCard for the first 200ms, then begin streaming chunks into a typing-indicator state. Never a spinner.
5. **Cost is invisible by default.** Operators see cost on the admin AI dashboard. Regular users see "Generated by Acureal" with no cost surfacing — would only confuse without context.
6. **Draft state is visually distinct.** AI drafts have a `border-amber-300` left edge until approved. After approval, the edge becomes neutral.

---

## 11. Manual blockers (carry forward)

These remain blocked for Tier 3+ and don't change with this roadmap:
- Karnataka land record APIs (Bhoomi, Kaveri) — manual upload only.
- K-RERA project verification — manual upload only.
- BBMP / BDA approval portals — manual upload only.
- Production Supabase DDL — operator action via SQL editor.
- Vercel env vars — operator action via dashboard.
- Anthropic + Google API key rotation — operator action.

See `TODO_DATA.md` and `TODO_LEGAL.md` for the full list.

---

## 12. Versioning

This doc moves with the code. When a tier ships, mark its row LANDED in §5 with the PR number. When the schema in §9 is migrated, link the migration file. When the architecture in §3 evolves, redraw the diagram.

| Last reviewed | By | Trigger |
|---|---|---|
| 2026-05-04 | session — Tier 0 ship | Initial integrated roadmap |
