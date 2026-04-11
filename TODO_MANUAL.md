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

## Current product notes

- Deals are the core entity and top-level properties list has been folded out of the main navigation.
- Documents and activities are deal-level modules, not separate primary pages.
- Session persistence is now explicit: browser-session by default, persistent only when `Remember me` is chosen.
