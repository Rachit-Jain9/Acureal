# TODO_MANUAL

Manual actions that still require credentials, authority, or infrastructure outside this repo.

## Critical

### 1. Apply the deal-centric database migrations

Files:

- `database/migrations/20260411_deal_centric_expansion.sql`
- `database/migrations/20260411_documents_and_security_alignment.sql`

Run them against the target Postgres/Supabase database before using DD, approvals, risks, extraction history, or the updated document metadata / RLS alignment.

```powershell
psql "$DATABASE_URL" -f database/migrations/20260411_deal_centric_expansion.sql
psql "$DATABASE_URL" -f database/migrations/20260411_documents_and_security_alignment.sql
```

Current assumption:

- the backend Postgres role is a superuser or service-role style account that can bypass RLS for writes
- if you use a restricted DB role, add explicit write policies before enabling production traffic

### 2. Verify production AI environment variables

Required for current AI-backed features:

- `GEMINI_API_KEY`
- `ANTHROPIC_API_KEY`

Recommended routing defaults:

- `AI_PROVIDER_DOCUMENT_CLASSIFICATION=gemini`
- `AI_PROVIDER_DOCUMENT_EXTRACTION=gemini`
- `AI_PROVIDER_TRANSLATION=gemini`
- `AI_PROVIDER_REASONING=claude`

### 3. Verify document storage configuration

At least one of these needs to be valid in the deployed environment:

- `BLOB_READ_WRITE_TOKEN`
- or Supabase storage credentials (`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_STORAGE_BUCKET`)

## High priority

### 4. Confirm geocoding provider access

- `GOOGLE_MAPS_API_KEY` if Google geocoding is being used
- otherwise keep location workflows manual / cached / low-volume

### 5. Run real post-migration smoke tests

Verify these flows against a live DB and storage setup:

- create deal
- upload and download document
- seed DD checklist
- seed approval checklist
- create risk flag
- open deal overview and confirm readiness + next steps render
- trigger document extraction on an uploaded PDF/image

### 6. Re-run blocked validations outside sandbox if needed

The local sandbox blocked process spawning for:

- `backend` tests
- `frontend` build

Re-run these with local shell access or escalated execution:

```powershell
cd backend
powershell -ExecutionPolicy Bypass -Command "npm test"

cd ..\frontend
powershell -ExecutionPolicy Bypass -Command "npm run build"
```

## Data / legal blockers

These are intentionally not faked in code:

- official zoning/master-plan/rule ingestion
- verified RERA lookup workflow
- live registry / encumbrance connectivity
- production-grade overlay datasets for lakes, drains, rajakaluves, heritage, and airport constraints

Track those in:

- `TODO_DATA.md`
- `TODO_LEGAL.md`

## Financial-engine roast — items explicitly out of scope

These were raised in the 2026-04-21 roast. They need design, credentials, or infrastructure this repo doesn't have, and should NOT be faked:

### 7. Delete legacy JS financial engine

- Gated by `backend/tests/kernel.parity.test.js`. The "PARITY REPORT" log lines in that test must all reach `[PASS]` before deletion.
- Current gap (residential_apartments canonical deal): totalCostCr Δ=6.39 Cr, grossMarginPct Δ=4.68 pp, RLV Δ=5.32 Cr.
- Root cause: legacy and kernel use different finance-cost formulas and different order of developer-margin vs contingency application. A dedicated parity sweep (non-trivial) is needed to align them.
- Once PASS, delete `backend/src/engines/financial.engine.js` and its adapter; remove the `FIN_KERNEL_V2` kill switch; keep the kernel as the single path.

### 8. Delete Python debt-engine companion

- Needs explicit user confirmation — it's a separate service with its own deploy story.
- Route: `packages/financial-kernel/src/debt-engine/*` (TS) vs. the Python FastAPI under `api/` or similar. Kill switch: `DEBT_ENGINE_PY_URL`.
- Before deletion: confirm no client depends on the Python endpoint, and the TS debt engine has parity for all scenarios the Python one was handling.

### 9. Cryptographic signing of investor packages

- Needs key management (HSM or KMS), a signing service, and a verification UX in the frontend.
- Blocked on: signing key provisioning, rotation policy, and a compliance sign-off on the chosen scheme (RSA/ECDSA, envelope format).
- Do NOT mock this — a fake signature is worse than no signature.

### 10. Immutable audit log for underwriting runs

- Needs a dedicated append-only table (or WORM storage), retention policy, and a read UI.
- Blocked on: schema decision (Postgres with insert-only RLS vs. separate store), retention duration, who can read audit rows.

### 11. Self-hosted OCR / fine-tuned Kannada model

- Needs GPU-backed infrastructure and a model-ops pipeline.
- Current AI routing (`AI_PROVIDER_DOCUMENT_EXTRACTION=gemini`) stays in place until this is real.

### 12. ML layer over deterministic engine

- Risk model, scoring, recommendation — all blocked on a labeled-deal dataset.
- CLAUDE.md hard rule: "Never use LLMs for deterministic math, rule-engine decisions, or core underwriting calculations." Any ML here must be an overlay, not a replacement.

### 13. Recharts → Tremor or custom charts rewrite

- Cosmetic, non-urgent. Don't do it unless a concrete chart requirement can't be met by Recharts.

### 14. Interactive MethodologyExplorer rewrite

- Currently a static page. Partially addressed in this cycle by the new client-side `ProvenanceGraphView` (deal-level DAG view). A full interactive explainer (filter by asset class, toggle kill switches live, what-if) is a bigger UX project.

## Current product notes

- Deals are the core entity and top-level properties list has been folded out of the main navigation.
- Documents and activities are deal-level modules, not separate primary pages.
- Session persistence is now explicit: browser-session by default, persistent only when `Remember me` is chosen.
- India regulatory constants live in `packages/financial-kernel/src/config/india.ts` — all downstream code imports from there instead of hardcoding rates.
