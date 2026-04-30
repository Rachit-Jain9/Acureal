# TODO_MANUAL

Manual actions that still require credentials, authority, or infrastructure outside this repo.

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

Applied to Supabase project `lsbhrbvuynzqhdtzczco` on 2026-04-30 via Supabase MCP `apply_migration` (history version `20260430180134`, name `source_document_pages_and_uav`). Both `regulatory_data.master_plan_document_pages` and `regulatory_data.bbmp_uav_entries` now exist with RLS enabled and read/modify policies scoped via `current_organization_id()`.

If a fresh environment ever needs the same migration:

```powershell
psql "$DATABASE_URL" -f database/migrations/20260430_source_document_pages_and_uav.sql
```

### 3. Verify production AI environment variables

Required for current AI-backed features:

- `GEMINI_API_KEY`
- `ANTHROPIC_API_KEY`

Recommended routing defaults:

- `AI_PROVIDER_DOCUMENT_CLASSIFICATION=gemini`
- `AI_PROVIDER_DOCUMENT_EXTRACTION=gemini`
- `AI_PROVIDER_TRANSLATION=gemini`
- `AI_PROVIDER_REASONING=claude`

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

