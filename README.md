# Acureal

Acureal is an AI-powered deal intelligence, due diligence, underwriting, and investor reporting platform for India, with Bengaluru as the priority market.

## What the app does

- Keeps `deals` as the master workspace for parcel data, documents, activities, DD, approvals, risks, and underwriting.
- Ingests real documents and supports Gemini-based extraction for uploaded evidence.
- Synthesizes deterministic deal readiness and next steps from DD, approvals, risks, document coverage, and financial state.
- Supports investor-grade underwriting, market intelligence, comps, and reporting workflows without fabricating external facts.

## Stack

- Frontend: React 18, Vite, React Router, React Query, Zustand, Tailwind, Recharts, Leaflet
- Backend: Express, PostgreSQL, JWT auth, multer uploads
- Deployment: Vercel via `api/index.js`

## Current architecture

- Top-level navigation: Dashboard, Deals, Market Intelligence, Comps, Reports / Exports, Admin / Settings
- Deal detail modules: Overview, Parcel / Site, Documents, Activity, Financial, DD / Approvals, Risk, Market / Comps
- Legacy top-level routes for documents and activities redirect to deals
- Properties list is no longer part of the primary workflow

## Local setup

### Prerequisites

- Node.js 18+
- PostgreSQL or Supabase Postgres

### Install

```powershell
cd backend
npm install
cd ..\frontend
npm install
```

### Database

Fresh database:

```powershell
cd backend
npm run migrate
npm run seed
```

Incremental patching:

- use `database/migrations/` for existing databases
- make sure `database/migrations/20260411_deal_centric_expansion.sql` has been applied
- then apply `database/migrations/20260411_documents_and_security_alignment.sql`

### Run locally

```powershell
powershell -ExecutionPolicy Bypass -File .\run-redip.ps1 check
powershell -ExecutionPolicy Bypass -File .\run-redip.ps1 fullstack
```

Or separately:

```powershell
powershell -ExecutionPolicy Bypass -File .\run-redip.ps1 backend
powershell -ExecutionPolicy Bypass -File .\run-redip.ps1 frontend
```

## Environment variables

Copy `backend/.env.example` to `backend/.env.local` for local secrets. `backend/.env` still works, but `.env.local` is safer for machine-specific credentials.

Core backend vars:

- `DATABASE_URL`
- `JWT_SECRET`
- `CORS_ORIGINS`
- `CRON_SECRET` for the daily Vercel FX refresh job

AI / document pipeline:

- `GEMINI_API_KEY`
- `ANTHROPIC_API_KEY`
- optional provider routing vars such as `AI_PROVIDER_DOCUMENT_EXTRACTION`, `AI_PROVIDER_REASONING`

Storage / infra:

- `BLOB_READ_WRITE_TOKEN` or Supabase storage credentials
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `GOOGLE_MAPS_API_KEY` for backend geocoding if used

Backend env loading order:

- `.env`
- `.env.[NODE_ENV]`
- `.env.local`
- `.env.[NODE_ENV].local`

For document storage, Acureal prefers Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set and automatically falls back to Supabase Storage when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured.

Frontend:

- `VITE_API_URL=/api`

## Validation

Backend tests:

```powershell
cd backend
npm test
```

Frontend build:

```powershell
cd frontend
npm run build
```

## Important repo notes

- Do not fabricate zoning, legal, market, or comp intelligence.
- Do not use LLMs for financial math or deterministic scoring.
- Keep provider calls behind backend adapters.
- Check `TODO_MANUAL.md`, `TODO_DATA.md`, and `TODO_LEGAL.md` before presenting a feature as production-ready.

## Deployment

- GitHub remote: `https://github.com/Rachit-Jain9/Acureal.git`
- Vercel project metadata: `.vercel/project.json`
- Production app: `https://redip.vercel.app/`
- Daily FX refresh is scheduled in `vercel.json` at `03:05 UTC` via `/api/fx/refresh/daily`
