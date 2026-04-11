# REDIP Project Guidance

REDIP is an India-first, Bengaluru-priority, AI-powered deal intelligence, due diligence, underwriting, and investor reporting platform. Treat it as the operating system for live deal work, not as a generic CRM or document vault.

## Product intent

- Make `deals` the master object. Documents, DD items, approvals, risks, activities, deadlines, and outputs belong to a deal.
- Optimize for real sourcing, diligence, underwriting, IC prep, and decision support.
- Support incomplete live data. Never block early sourcing because a parcel name or address is unknown.
- Keep copy, formatting, and outputs investor-grade and explicit about confidence, units, and missing data.
- Bengaluru first, India second.

## Hard rules

- Never fabricate zoning, legal, title, RERA, ownership, market, comp, GIS, or financial facts.
- Never use LLMs for deterministic math, rule-engine decisions, or core underwriting calculations.
- Never ship UI that looks production-ready if the underlying data source or workflow is stubbed, fake, or unsupported.
- Never hardcode secrets, tokens, or credentials.
- Never create duplicate top-level entities for the same real-world object.
- Never reintroduce top-level `Properties`, `Documents`, or `Actions` navigation as primary workflows.

## Current information architecture

Primary navigation should stay focused on:

- Dashboard
- Deals
- Market Intelligence
- Comps
- Reports / Exports
- Admin / Settings

Each deal should remain the workspace for:

- Overview
- Parcel / Site
- Documents
- Activity / Timeline
- Financial Engine
- DD / Approvals
- Risk
- Market / Comps

## Domain conventions

- Unknown parcel name/address is valid during sourcing.
- Land pricing supports total price in crore, INR per sqft, and INR per acre.
- Area inputs may be in sqft or acres, but calculations should normalize cleanly.
- Deal stages and transitions are defined in `backend/src/constants/domain.js`.
- `deals.is_archived` is the archive control. Do not hard-delete active live deals.
- External market intelligence must remain verified-data-only. If no verified feed exists, show a truthful unavailable state.

## Backend guardrails

- Keep routes thin. Put workflow logic in `backend/src/services/`.
- Reusable deterministic calculations belong in `backend/src/utils/` or dedicated engines.
- Read models that combine DD, approvals, risks, financials, and documents should be synthesized server-side so the frontend reads one grounded payload.
- Preserve Vercel serverless compatibility. No long-lived workers or background assumptions in request handlers.
- Provider integrations must stay behind adapters under `backend/src/services/ai/`.

## AI routing policy

- Gemini: document classification, OCR-style extraction, scanned Kannada/English understanding, translation, field extraction.
- Claude: cross-document reasoning, DD synthesis, risk narrative, next-step recommendations, IC-style analysis.
- Deterministic code only: financial math, KPI math, sensitivities, GIS math, approval status logic, comp normalization, scoring.

## Security and privacy

- Keep provider/API calls server-side unless a client-side provider flow is explicitly safe and intentional.
- Favor least privilege and private-by-default document access.
- Validate file type and size on upload.
- Prefer signed URLs or controlled access for private storage.
- Make session persistence explicit to the user. Default browser-session login should end on browser close unless `Remember me` is chosen.

## Validation expectations

When a workflow changes, verify as much of this chain as possible:

- create deal
- link/unlink parcel
- upload/download/delete document
- seed and edit DD items
- seed and edit approval items
- create/update/delete risk flags
- update deal stage
- refresh financial summary
- dashboard rollups

Do not claim a flow works unless it was exercised through API, build, test, or UI.

## Manual blockers to preserve

If a feature needs one of these, do not fake it:

- official zoning/master-plan/rule documents
- Karnataka RERA verification access
- EC/registry access beyond uploaded documents
- private provider credentials or storage tokens
- production deployment auth

Instead:

- build the right adapter, schema, or UI hook
- leave the feature disabled or clearly manual
- record the exact blocker in `TODO_MANUAL.md`, `TODO_DATA.md`, or `TODO_LEGAL.md`

## Local commands

- Health check: `powershell -ExecutionPolicy Bypass -File .\run-redip.ps1 check`
- Backend: `powershell -ExecutionPolicy Bypass -File .\run-redip.ps1 backend`
- Frontend: `powershell -ExecutionPolicy Bypass -File .\run-redip.ps1 frontend`
- Full stack: `powershell -ExecutionPolicy Bypass -File .\run-redip.ps1 fullstack`
- Backend tests: `cd backend && npm test`
- Frontend build: `cd frontend && npm run build`

## Repo hygiene

- Preserve useful in-progress work already on the branch.
- Prefer progressive refactors to broad rewrites.
- Remove low-value mock/demo logic instead of layering more UI over it.
- If a change affects deals, inspect downstream DD, approvals, risks, documents, dashboard summaries, and financial readouts.
