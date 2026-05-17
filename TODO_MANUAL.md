# TODO_MANUAL

Manual actions that still require credentials, authority, or infrastructure outside this repo.

## Pending now (most recent first)

### BBMP Guidance Value — Phase 2b LLM enrichment (post-PRs #350-#355)

**Status:** Schema + 9,913 streets seeded on Mumbai. 2,943 (30%) enriched with zone + guidance band via heuristic. Remaining ~70% need an LLM pass over the per-page PDF images.

**Why this is manual:** the local `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` in `backend/.env` + `backend/.env.local` both return 401. Production Vercel keys are valid (updated 10h ago per dashboard) — easiest fix is to sync them locally.

**One-time setup (~2 min):**
```powershell
# From repo root — overwrites .env.local with current production env (includes refreshed keys)
cd backend
vercel env pull .env.local --environment=production
cd ..
# Verify the key works:
$env:NODE_PATH = "backend/node_modules"
node -e "require('dotenv').config({path:'backend/.env.local'}); const {GoogleGenerativeAI}=require('@google/generative-ai'); (async()=>{const r=await new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({model:'gemini-2.5-flash'}).generateContent('Reply OK'); console.log('OK:', r.response.text().trim());})();"
```

**Run the enrichment (~15 min, < $1):**
```powershell
# Regenerate per-page PDFs if tmp/ was wiped (gitignored, so probably needed):
$env:PYTHONIOENCODING = "utf-8"
python scripts/split-guidance-value-pdf.py
# Then run the enrichment (concurrent, idempotent — re-runnable on failure):
node scripts/enrich-bbmp-street-zones.js
```
The script processes only pages where at least one street still has `zone_code IS NULL`, so re-runs are cheap. Expected output: ~351 page-callouts succeed, total updated rows takes the coverage from 30% → ~95-100%.

**Verify post-run** in Supabase SQL editor:
```sql
SELECT
  COUNT(*) FILTER (WHERE zone_code IS NOT NULL)::int AS enriched,
  COUNT(*)::int AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE zone_code IS NOT NULL) / COUNT(*), 1) AS coverage_pct
FROM regulatory_data.bbmp_street_index;
```
Should report `coverage_pct` close to 100.

### Delete the legacy Tokyo Supabase project (`lsbhrbvuynzqhdtzczco`)

**Status:** Production is `niamgjbxxgmmffggumvj` (Mumbai). Tokyo (`lsbhrbvuynzqhdtzczco`) has been "still alive, awaiting explicit user go-ahead to delete after smoke-test bake-in period" for 11+ days. The BBMP street-index schema was applied to BOTH as a safety hedge — Tokyo has the schema but only Mumbai got the 9,913-row seed.

**Why this is manual:** the Supabase MCP exposed to the agent only includes `pause_project` / `restore_project`, not `delete_project`. Deletion requires the dashboard or the Supabase Management API directly.

**Steps:**
1. Open https://supabase.com/dashboard/project/lsbhrbvuynzqhdtzczco/settings/general
2. Scroll to "Delete project"
3. Type the project name to confirm

**Before clicking delete, sanity-check:**
- Vercel env vars don't reference Tokyo anywhere (`vercel env ls | grep lsbhr` should return nothing).
- (Optional) Run `pg_dump` for a final snapshot — no real data loss because all production data is on Mumbai.

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

