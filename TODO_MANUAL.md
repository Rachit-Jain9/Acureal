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

### 2. Verify production AI environment variables

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

### 7. ~~Delete legacy JS financial engine~~ ✅ DONE (2026-04-22)

- Parity gate closed; legacy engine (`financial.engine.js`, `kernel.adapter.js`)
  and all six parity test suites deleted.
- `backend/src/engines/kernel.service.js` composes the TS kernel with its
  post-processors and is the sole path called by `financial.service.js`.
- `FIN_KERNEL_V2` kill switch removed; kernel is unconditional.
- 28-test `kernel.service.acceptance.test.js` suite pins golden values for
  every asset class at 1-bp / 50k-INR tolerance.
- Full regression: 101 backend tests + 392 kernel tests green.

### 8. ~~Delete Python debt-engine companion~~ ✅ DONE (retired pre-session)

- Confirmed 2026-04-22: no `.py` files, no `debt-engine-py/` directory,
  no runtime reads of `DEBT_ENGINE_PY_URL`.
- TS debt engine (`packages/financial-kernel/src/debt-engine/*`) is the
  sole runtime. `orchestration/featureFlag.ts` records the retirement.

### 9. Cryptographic signing of investor packages

- Needs key management (HSM or KMS), a signing service, and a verification UX in the frontend.
- Blocked on: signing key provisioning, rotation policy, and a compliance sign-off on the chosen scheme (RSA/ECDSA, envelope format).
- Do NOT mock this — a fake signature is worse than no signature.

### 10. ~~Immutable audit log for underwriting runs~~ ✅ DONE (2026-04-22)

- Append-only `deal_events` table landed in `database/migrations/20260422_deal_events.sql`
  with org-scoped RLS that grants `SELECT` + `INSERT` only (no `UPDATE`/`DELETE` policy).
- `backend/src/services/audit.service.js` signs every row with HMAC-SHA256 over
  `(inputs_hash || "|" || outputs_hash || "|" || engine_version)` using
  `DEAL_EVENTS_HMAC_KEY`. `recordEvent` wired into `calculate_and_save` +
  `sensitivity_run` paths; failures log and do not block the underlying save.
- `verifyEvent` re-hashes the stored JSON and replays the HMAC against the
  current key. `replayEvent` additionally re-executes the kernel from the
  stored inputs and compares output hashes — this is the primitive that
  proves the number on the pitch deck was produced by the exact engine +
  inputs on file.
- Routes: `GET /api/financials/:dealId/events`, `GET …/events/:eventId/verify`,
  `POST …/events/:eventId/replay`. 23-test `audit.service.test.js` suite
  covers stable-stringify, deterministic signing, tamper detection, and a
  real residential kernel replay.
- Retention: "forever" today (no pruner) — revisit once volume justifies it.
- Read UI: `frontend/src/components/financials/AuditTimelineView.jsx` now
  consumes the list/verify/replay endpoints. Wired into both `FinancialTab`
  (deal workspace) and `FinancialsPage` (dedicated Financial Engine page).
  Replay button is role-gated to admin/analyst to mirror the backend's
  `requireRole` policy on `POST …/events/:eventId/replay`.

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
