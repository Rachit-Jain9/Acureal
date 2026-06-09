# TODO_MANUAL

Manual actions that still require credentials, authority, or infrastructure outside this repo.

> **Operator-facing checklist:** the current plain-English list of tasks for the
> operator (Rachit) — backups, legal counsel, breach-runbook names, security
> mailbox, schema squash — lives in [`TODO_OPERATOR.md`](TODO_OPERATOR.md). This
> file (`TODO_MANUAL.md`) remains the engineering-detail record.

## Pending now (most recent first)

> **✅ Migration backlog FULLY APPLIED + VERIFIED on production (Mumbai `niamgjbxxgmmffggumvj`) — 2026-06-09.**
> Verified live via the Supabase MCP that every migration through `20260701_deal_signoffs.sql` is applied. In particular the cross-tenant SELECT hole is **CLOSED** — `0` permissive `USING(true)` SELECT policies remain on tenant tables — so the "🔴 URGENT" `20260623` item below is **DONE**, not pending. Also confirmed present: `document_access_log`, `deal_signoffs`, durable `deal_audit_log` (`deal_id` nullable / `ON DELETE SET NULL`), `organization_domains` + `organization_audit_log`, `deal_workspace_cache`, `deals.rera_inputs`, the market-reference Data-API scoping (`20260628`), the function search-path lockdown (`20260627b`), and the `document_extractions.extraction_started_at` reaper column. Supabase's security advisor shows **no actionable findings**; the only remaining lints are benign/intentional: auth/cache tables RLS-enabled-with-no-policy (that is *default-deny*, the correct locked-down posture); `extension_in_public` on PostGIS/pgvector (deliberately left — relocating in-use extensions is riskier than the lint); and the `spatial_ref_sys` RLS ERROR, which is unfixable via SQL (public PostGIS EPSG reference owned by `supabase_admin`) and carries no sensitive data. The per-migration entries below are retained for history.

### K-RERA compliance-deadline email reminders — DEFERRED until a sending domain + Resend exist (2026-06-04)
The post-registration compliance calendar (PRs #770–#771) deterministically computes each registered deal's upcoming K-RERA deadlines (quarterly updates, annual audit, declared-completion/extension, certificate expiry) and surfaces them in the cockpit **and** the DOCX pack. The **proactive email-reminder layer** is intentionally NOT built yet — it shares the `RESEND_API_KEY` blocker below (no verified sending domain). Operator confirmed (2026-06-04) they will set up a domain soon; see the plain-English step **#6 in `TODO_OPERATOR.md`**. When email sending is enabled, build `/api/cron/compliance-reminders/daily` — a `cronAuth`-guarded handler (pattern: `backend/src/routes/parcelCron.routes.js`; register the schedule in `vercel.json`) that, per active org/deal, calls `complianceCalendar.composeComplianceCalendar`, selects items inside a configurable due-soon window, and batches one digest email via `backend/src/lib/mailer.js` to the deal owner/assignee. Idempotent + fire-and-forget. Optional later: a `compliance_reminder_preferences` table for per-deal opt-out + a "last reminded" stamp to avoid repeat sends. The calendar VIEW already ships and is fully usable without this — reminders are additive nudges only.

### ~~Apply migration: `20260623_fix_rls_cross_tenant_select.sql`~~ — ✅ DONE + VERIFIED 2026-06-09 (live probe: 0 permissive cross-tenant SELECT policies remain)
Path: `database/migrations/20260623_fix_rls_cross_tenant_select.sql`. **CRITICAL multi-tenant security fix.** Drops 13 permissive `*_select_all USING(true)` SELECT policies that let the anon Supabase Data API read every org's private data (deals, landowner PII, financials, documents, …). The Node app uses a BYPASSRLS role + explicit org filters, so this is **zero-downtime / zero app impact**. Idempotent. To apply: open https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new, paste the entire file, click the green Run button, expect "Success. No rows returned." Verify: the footer probe should return 0 rows. (PR #690.)

### ~~Apply migration: `20260624_deal_audit_log_durable_on_delete.sql`~~ — ✅ DONE + VERIFIED 2026-06-09 (deal_audit_log.deal_id is nullable)
Path: `database/migrations/20260624_deal_audit_log_durable_on_delete.sql`. Makes the deal-delete audit trail durable: `deal_audit_log.deal_id` becomes nullable + FK `ON DELETE SET NULL` (was `CASCADE`, which annihilated the 'deleted' audit row at commit). Idempotent, no data change. Same Supabase paste-flow. (PR #691.)

### ~~Apply migration: `20260620_deals_list_perf_indexes.sql`~~ — DONE 2026-06-01 (applied + verified, 3 indexes). Also applied + verified this session: `20260621_pd_existing_land_use.sql` (7 per-district land-use facts) and `20260622_globalize_masterplan_reference.sql` (curated RMP reference globalised → visible to all users; deal docs kept private — verified 0 org-scoped reference rows, 7 `user_upload` sources still private, 7 PDs tagged PD-01..07).
Path: `database/migrations/20260620_deals_list_perf_indexes.sql`. Three composite indexes for the deals-list per-deal rollups: `dd_items (deal_id, is_required, status)`, `risk_flags (deal_id, status, severity)`, `activities (deal_id, activity_date DESC)`. Speeds up the correlated-subquery rollups `getDeals` runs per row (currently each can only use a single-column `deal_id` index, then filters in memory). **The PR #685 code ships safely without it** — the indexes are a speed boost, not a dependency, so nothing breaks if applied later. Plain `CREATE INDEX IF NOT EXISTS` in `BEGIN/COMMIT` (Supabase-paste-safe, idempotent, no `CONCURRENTLY`). To apply: open https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new, paste the entire file, click the green Run button, expect "Success. No rows returned." Verify with the `SELECT indexname FROM pg_indexes …` probe in the file footer (expect 3 rows).

### ~~Apply migration: `20260530_document_access_log.sql`~~ — ✅ DONE + VERIFIED 2026-06-09 (table public.document_access_log exists)
Path: `database/migrations/20260530_document_access_log.sql`. Creates the append-only `document_access_log` table (immutable, org-scoped RLS) that records every signed-URL issuance + byte-stream download of a deal/master-plan document — satisfies the CLAUDE.md "log access to sensitive documents" rule + the investor-grade audit trail. The backend code (the `documentAccessLog` sink subscribing to `DOCUMENT_ACCESSED`) already ships and is **migration-tolerant**: until this migration runs it logs a one-time `document_access_log_table_missing` warning and no-ops, so nothing breaks — but **no access is recorded until the table exists**. To apply: open https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new, paste the entire file, click Run, expect "Success. No rows returned."

### `RESEND_API_KEY` — DEFERRED until a sending domain exists (2026-05-30)
Operator decision: no email-sending domain yet, so transactional email (signup verification + password reset) stays unconfigured for now. Consequence (intended, post the 2026-05-30 mailer-hardening PR): in production the mailer **fails closed** — those emails simply don't send (and crucially, the verification/reset link + token is NOT logged) rather than leaking. The boot logs a `RESEND_API_KEY is not set` warning. When a domain is acquired: verify it in Resend (DNS records) → create an API key (`re_…`) → set `RESEND_API_KEY` + `MAIL_FROM` ("REDIP <noreply@yourdomain>") in Vercel. Also set `AI_DAILY_COST_CAP_USD` while there (the only hard ceiling on AI spend; the cost guard is a no-op until set).

### Confirm the rotated Google Maps key — old key deleted in Google Cloud Console (2026-05-30)
`GOOGLE_MAPS_API_KEY` + `VITE_GOOGLE_MAPS_API_KEY` were updated in Vercel after the audit found a live key committed in git history (commit 55045e7, since redacted from the doc but still in history → permanently burned). **Updating Vercel does not disable the old key** — confirm the old/leaked key was **deleted or regenerated** in https://console.cloud.google.com/google/maps-apis/credentials and that the new key carries HTTP-referrer (browser) + API (server) restrictions and a billing budget cap. Until the old key is deleted in GCP, the leaked value still works.

_(All Phase A1-A4 + auto-derived columns migrations confirmed applied 2026-05-19; see DONE entries below.)_

### ~~Apply migration: `20260602_properties_auto_derived_context_columns.sql`~~ — DONE 2026-05-18
Path: `database/migrations/20260602_properties_auto_derived_context_columns.sql`. Adds 13 `auto_derived_*` columns to `public.properties` + 3 partial indexes (zone / PD / ward). Backs the `PATCH /properties/:id/apply-auto-derived-context` endpoint so AutoFillCard Apply persists all 6 picks. Verified applied via `information_schema.columns` check 2026-05-19.

### ~~Apply migration: `20260601_rmp_vol3_vol1_callouts_and_rules.sql`~~ — DONE 2026-05-17
Path: `database/migrations/20260601_rmp_vol3_vol1_callouts_and_rules.sql`. 6 evidence_facts rows from RMP 2031 Volume-3 + Volume-1: 5 SDZ corridors, 12 heritage zones, regional parks, NGT drainage, PRR alignment, 17 zoning rule narratives. Verified applied via 6-row evidence_facts coverage check 2026-05-19. (Volume-6 zoning regulations still deferred — needs narrower chunked Gemini extraction.)

### ~~Apply migration: `20260531_land_use_insight_and_city_callouts.sql`~~ — DONE 2026-05-17
Path: `database/migrations/20260531_land_use_insight_and_city_callouts.sql`. 32 evidence_facts rows: land-use shares (existing + proposed), totals, landmarks, boundaries. Verified applied via 32-fact coverage check 2026-05-19. (SDZ / heritage / NGT detail shipped via 20260601 above.)

### ~~Apply migration: `20260530_bbmp_uav_rate_card.sql`~~ — DONE 2026-05-17
Path: `database/migrations/20260530_bbmp_uav_rate_card.sql`. 108 rows into `regulatory_data.bbmp_uav_entries` — BBMP UAV rate card from Gazette Notification 384 (18 use categories × 6 zones). Verified applied 2026-05-19 (108 UAV rows confirmed).

### ~~Apply migration: `20260529_planning_district_demographics.sql`~~ — DONE 2026-05-17
Path: `database/migrations/20260529_planning_district_demographics.sql`. Single `evidence_facts` row containing all 42 Bengaluru Planning Districts with population, area, density, ward count, village count from RMP 2031 Volume-4 PDR. Verified applied 2026-05-19 (42 PDs confirmed in evidence_facts).

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

