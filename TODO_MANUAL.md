# TODO_MANUAL

Manual actions that still require credentials, authority, or infrastructure outside this repo.

## Pending now (most recent first)

### Apply migration: `20260601_rmp_vol3_vol1_callouts_and_rules.sql` (Phase A4)
Path: `database/migrations/20260601_rmp_vol3_vol1_callouts_and_rules.sql`. Idempotent. Inserts 6 evidence_facts rows extracted via Gemini from RMP 2031 Volume-3 + Volume-1: 5 SDZ corridors (Bellary/Old Madras/Sarjapur/Hosur/Mysuru roads), 12 heritage zones (Central Administrative, Raj Bhavan, etc.), regional parks aggregate, NGT drainage classification, Peripheral Ring Road alignment, and 17 substantive zoning rule narratives (FAR base, setback floor, etc.). All review_status='pending' so they land in the Review Queue for human verification. Until applied, DealPlanningContextCard's SDZ/heritage/NGT/PRR callouts stay empty.
```powershell
psql "$DATABASE_URL" -f database/migrations/20260601_rmp_vol3_vol1_callouts_and_rules.sql
```
Volume-6 zoning regulations not in this PR — hit Gemini's output-token budget on the full inventory pass; needs a narrower chunked extraction in a follow-up.

### Apply migration: `20260531_land_use_insight_and_city_callouts.sql` (Phase A3)
Path: `database/migrations/20260531_land_use_insight_and_city_callouts.sql`. Idempotent. Inserts 32 evidence_facts rows: 14 existing (2015) + 12 proposed (2031) land-use shares + 4 totals (BMA area, developable area, agriculture-outside-developable, LPA of BDA) + 1 landmark aggregate (22 named landmarks) + 1 boundary aggregate (7 adjacent planning authorities). Hand-extracted from the RMP 2031 Existing/Proposed Land Use maps, confidence 0.95. Until applied, the Land Use Insight panel at `/admin/planning-intelligence` and the DealPlanningContextCard on every Bengaluru deal's Zoning tab render empty.
```powershell
psql "$DATABASE_URL" -f database/migrations/20260531_land_use_insight_and_city_callouts.sql
```
SDZ corridors, heritage zones, NGT drainage classification, regional parks, and PRR alignment detail are NOT in this PR — those need a Volume-6 deeper Gemini multimodal pass (deferred to a follow-up). The card will show empty for those callouts.

### Apply migration: `20260530_bbmp_uav_rate_card.sql` (Phase A1)
Path: `database/migrations/20260530_bbmp_uav_rate_card.sql`. Idempotent. Inserts 108 rows into `regulatory_data.bbmp_uav_entries` — the BBMP Unit Area Value rate card from Gazette Notification 384 dated 09-Mar-2016 (18 property-use categories × 6 zones). Hand-extracted from the gazette tables, confidence 0.95, review_status 'approved'. Until applied, the UAV Benchmark panel at `/admin/planning-intelligence` renders an empty matrix.
```powershell
psql "$DATABASE_URL" -f database/migrations/20260530_bbmp_uav_rate_card.sql
```
Or paste into Supabase SQL editor. Trailing `SELECT` reports per-zone row counts (each of A-F should show 18 uses, 18 rows).

### Apply migration: `20260529_planning_district_demographics.sql` (Phase A2)
Path: `database/migrations/20260529_planning_district_demographics.sql`. Idempotent. Inserts a single `evidence_facts` row (`fact_type='rmp_table', fact_key='planning_districts'`) containing all 42 Bengaluru Planning Districts with population, area, density, ward count, and village count extracted from RMP 2031 Volume-4 PDR. Until applied, the District Intelligence panel at `/admin/planning-intelligence` shows 42 stub rows with no demographics.
```powershell
psql "$DATABASE_URL" -f database/migrations/20260529_planning_district_demographics.sql
```
Or paste contents into Supabase SQL editor (Mumbai). The migration is ~17KB with the JSONB literal inline — copy-friendly. After applying, the trailing `SELECT` reports `rich_pd_facts = 1` and `total_pd_facts = 3` (existing 2 thin routing-key facts + the new rich one).

### ~~BBMP Guidance Value — Phase 2b LLM enrichment~~ — DONE 2026-05-17

Closed out the same night. Final state: **9,913 / 9,913 streets (100%)** classified by zone + guidance bandwidth on Mumbai production. Achieved via:
1. `scripts/enrich-bbmp-street-zones.js` — Gemini 2.5 Flash multimodal over per-page PDFs (added trigram-similarity fallback so Gemini's street names don't need exact match).
2. `scripts/apply-bbmp-zone-inheritance.sql` — page-neighbour inheritance heuristic (4 layered passes by confidence) for pages that have no zone header of their own.

Total Gemini spend ~$0.05 of the $10 credits the user added.

To re-seed a fresh DB in the future, run in order: `split-guidance-value-pdf.py` → `extract-guidance-value-pdf.py` → `build-bbmp-street-index.py` → `seed-bbmp-street-index.js` → `heuristic-enrich-bbmp-zones.py` + `apply-bbmp-zone-heuristic.js` → `enrich-bbmp-street-zones.js` → `apply-bbmp-zone-inheritance.sql`.

### ~~Delete the legacy Tokyo Supabase project~~ — DONE 2026-05-17

User confirmed deletion via Supabase dashboard. `lsbhrbvuynzqhdtzczco` is gone. Mumbai (`niamgjbxxgmmffggumvj`) is the only Supabase project. No Vercel env vars referenced Tokyo, so no follow-up needed.

### Apply migration: `20260526_ab_eval_runs.sql` (Tier 2 #14)
Path: `database/migrations/20260526_ab_eval_runs.sql`. Idempotent. Adds `ab_eval_runs` + `ab_eval_results` tables that back the new `/dashboard/admin/ab-eval` page (PR #222). Until applied, the page still works for one-shot runs but does not persist past comparisons.
```powershell
psql "$DATABASE_URL" -f database/migrations/20260526_ab_eval_runs.sql
```

### Smoke: Tier 1 #10 cross-locality geocode upgrade (PR #221)
No migration. When ready to re-pin the existing 80 production comps, operator runs the script from the `backend/` directory:
```powershell
cd backend
node ../scripts/upgrade-comps-geocoding.mjs --apply --allow-cross-locality
```
The summary at the end lists every "cross-locality correction" — these are rows where Google said the project is in a different locality from what the comp recorded. Manually spot-check those before flipping the `locality` column (the script does NOT auto-rewrite locality).

## Critical

### 1. Apply the deal-centric database migrations

Files:

- `database/migrations/20260411_deal_centric_expansion.sql`
- `database/migrations/20260411_documents_and_security_alignment.sql`
- `database/migrations/20260422_deal_events.sql` (new — immutable audit log)

Run them against the target Postgres/Supabase database before using DD, approvals, risks, extraction history, or the updated document metadata / RLS alignment. The `20260422_deal_events.sql` migration gates the new `/api/financials/:dealId/events` + replay endpoints — without it, every persisted calc logs a warning but the save itself still succeeds.

```powershell
psql "$DATABASE_URL" -f database/migrations/20260411_deal_centric_expansion.sql
psql "$DATABASE_URL" -f database/migrations/20260411_documents_and_security_alignment.sql
psql "$DATABASE_URL" -f database/migrations/20260422_deal_events.sql
```

Current assumption:

- the backend Postgres role is a superuser or service-role style account that can bypass RLS for writes
- if you use a restricted DB role, add explicit write policies before enabling production traffic

### 2. Apply the source page ledger migration — APPLIED 2026-04-30

File:

- `database/migrations/20260430_source_document_pages_and_uav.sql`

Applied to former Supabase project `lsbhrbvuynzqhdtzczco` (Tokyo) on 2026-04-30 via Supabase MCP `apply_migration` (history version `20260430180134`, name `source_document_pages_and_uav`). Both `regulatory_data.master_plan_document_pages` and `regulatory_data.bbmp_uav_entries` now exist with RLS enabled and read/modify policies scoped via `current_organization_id()`. Re-applied to current Supabase project `niamgjbxxgmmffggumvj` (Mumbai, `ap-south-1`) on 2026-05-04 as part of the Tokyo→Mumbai region migration.

If a fresh environment ever needs the same migration:

```powershell
psql "$DATABASE_URL" -f database/migrations/20260430_source_document_pages_and_uav.sql
```

### 3. Verify production AI environment variables

Required for current AI-backed features:

- `GEMINI_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY` (embeddings + reasoning fallback)

Recommended routing defaults:

- `AI_PROVIDER_DOCUMENT_CLASSIFICATION=gemini`
- `AI_PROVIDER_DOCUMENT_EXTRACTION=gemini`
- `AI_PROVIDER_TRANSLATION=gemini`
- `AI_PROVIDER_REASONING=claude`

**Model ID defaults (post-bump 2026-05-15, PR-NX9 #322):**

| Provider | Default model ID | Override env var |
|---|---|---|
| Gemini | `gemini-3.1-flash-lite` | `GEMINI_MODEL` |
| Claude | `claude-sonnet-4-6` | `CLAUDE_MODEL` |
| OpenAI | `gpt-5.4` | `OPENAI_MODEL` |

If a model goes flaky in prod, set the override env var on Vercel and redeploy — no code revert needed. Roll-back targets: `gemini-2.5-flash` (Google previous-gen), `gpt-4o-mini` (OpenAI previous-gen), `claude-haiku` (Anthropic previous-gen).

**Per-task routing overrides (PR-NX9 added):** `AI_PROVIDER_DOCUMENT_CLASSIFICATION`, `AI_PROVIDER_DOCUMENT_EXTRACTION`, `AI_PROVIDER_TRANSLATION`, `AI_PROVIDER_REASONING`, `AI_PROVIDER_MARKET_SYNTHESIS`, `AI_PROVIDER_NARRATIVE_SYNTHESIS`. Set to `claude` / `openai` / `gemini` to override the routing config in `ai_routing_config` (which itself can be edited via the DB without code change).

**Cross-product AI-Assisted Briefing (PR-NX12 #328 + PR-NX18 #335):** The `narrative_synthesis` task is what produces the briefing now rendered in XLSX (Executive Briefing tab), DOCX (Section 2), and PPTX (Slide 2). All 3 formats share the same `dealBriefing.service.js` — cross-product consistency enforced by `exports.crossProductReconciliation.test.js` (PR-NX19 #336). If the AI is dark in prod, all 3 fall back to the templated narrative (still asset-class-aware).

Also required for the investor-grade audit log:

- `DEAL_EVENTS_HMAC_KEY` — secret used to HMAC-sign every `deal_events` row.
  Minimum 16 chars, generated once and rotated per your operator policy.
  In production the audit service refuses to sign with a dev fallback; a
  missing key logs a warning on `calculate_and_save` but does not block the
  calc. Suggested: `openssl rand -hex 32`.

### 4. Verify document storage configuration

At least one of these needs to be valid in the deployed environment:

- `BLOB_READ_WRITE_TOKEN`
- or Supabase storage credentials (`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_STORAGE_BUCKET`)

## High priority

### 5. Confirm geocoding provider access

- `GOOGLE_MAPS_API_KEY` if Google geocoding is being used
- otherwise keep location workflows manual / cached / low-volume

### 6. Run real post-migration smoke tests

Verify these flows against a live DB and storage setup:

- create deal
- upload and download document
- seed DD checklist
- seed approval checklist
- create risk flag
- open deal overview and confirm readiness + next steps render
- trigger document extraction on an uploaded PDF/image

## Data / legal blockers

These are intentionally not faked in code:

- official zoning/master-plan/rule ingestion
- verified RERA lookup workflow
- live registry / encumbrance connectivity
- production-grade overlay datasets for lakes, drains, rajakaluves, heritage, and airport constraints

Track those in:

- `TODO_DATA.md`
- `TODO_LEGAL.md`

## Financial-engine items

These need design, credentials, or infrastructure this repo doesn't have. Do NOT fake them.

### 7. Cryptographic signing of investor packages

- Needs key management (HSM or KMS), a signing service, and a verification UX in the frontend.
- Blocked on: signing key provisioning, rotation policy, and a compliance sign-off on the chosen scheme (RSA/ECDSA, envelope format).
- Do NOT mock this — a fake signature is worse than no signature.

### 8. Self-hosted OCR / fine-tuned Kannada model

- Needs GPU-backed infrastructure and a model-ops pipeline.
- Current AI routing (`AI_PROVIDER_DOCUMENT_EXTRACTION=gemini`) stays in place until this is real.

### 9. ML layer over deterministic engine

- Risk model, scoring, recommendation — all blocked on a labeled-deal dataset.
- CLAUDE.md hard rule: "Never use LLMs for deterministic math, rule-engine decisions, or core underwriting calculations." Any ML here must be an overlay, not a replacement.

### 10. Interactive MethodologyExplorer rewrite

- Currently a static page. Partially addressed in this cycle by the new client-side `ProvenanceGraphView` (deal-level DAG view). A full interactive explainer (filter by asset class, toggle kill switches live, what-if) is a bigger UX project.

