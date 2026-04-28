# REDIP Project Guidance

REDIP is an India-first, Bengaluru-priority, AI-powered deal intelligence, due diligence, underwriting, and investor reporting platform. Treat it as the operating system for live deal work, not as a generic CRM or document vault.

## Product intent

- Make `deals` the master object. Documents, DD items, approvals, risks, activities, deadlines, and outputs belong to a deal.
- Optimize for real sourcing, diligence, underwriting, IC prep, and decision support.
- Support incomplete live data. Never block early sourcing because a parcel name or address is unknown.
- Keep copy, formatting, and outputs investor-grade and explicit about confidence, units, and missing data.
- Bengaluru first, India second.

## Core philosophy

REDIP exists to compress the time between spotting a deal and making a confident IC decision, while reducing the catastrophic blind spots common in Indian real estate — title disputes, hidden encumbrances, approval gaps, RERA deviations, and promoter execution risk. The platform must feel like a sharp co-pilot for seasoned deal professionals in Bengaluru, not a generic tool.

Prioritize depth on live deals over breadth of features. Support messy, early-stage sourcing data without friction, but enforce rigor and explicit confidence levels as the deal matures toward underwriting and IC.

## Hard rules

- Never fabricate zoning, legal, title, RERA, ownership, market, comp, GIS, or financial facts.
- Never use LLMs for deterministic math, rule-engine decisions, or core underwriting calculations.
- Never ship UI that looks production-ready if the underlying data source or workflow is stubbed, fake, or unsupported.
- Never hardcode secrets, tokens, or credentials.
- Never create duplicate top-level entities for the same real-world object.
- Never reintroduce top-level `Properties`, `Documents`, or `Actions` navigation as primary workflows.
- Never auto-generate or imply legal conclusions on title, zoning, RERA compliance, or approvals. AI outputs must be framed as "extraction/synthesis aid" with clear disclaimers and human verification prompts.
- Never expose unverified market intelligence or comps as authoritative. Always surface source, freshness, and confidence level — or "No verified feed available."
- Every AI-synthesized narrative (risk summary, DD brief, IC memo) must carry a prominent "AI-assisted — requires human review" label in both UI and exported outputs.
- Preserve an immutable audit trail for every material change to a deal (stage, financials, risks, approvals, DD items). This is non-negotiable for investor-grade reporting.

## Current information architecture

Primary navigation should stay focused on:

- Dashboard
- Deals
- Market Intelligence (broad/external — city-level benchmarks, macro data, market trends)
- Comps (verified transaction database)
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
- Market / Comps (deal-contextualized — nearby comps, benchmarks specific to this site)

Note: **Market Intelligence** (top-nav) is broad and external. **Market / Comps** (deal tab) is deal-specific and contextualized. Keep these distinct in both UI and data model.

## Domain conventions

- Unknown parcel name/address is valid during sourcing. Every deal must support a "Sourcing" stage with minimal required fields — even just a temporary label like "Opportunity X – Whitefield area."
- Land pricing supports total price in crore, INR per sqft, and INR per acre. Financial inputs must gracefully handle mixed units and partial data (e.g., "approx. 5 acres @ ₹2.5 Cr/acre" or "total consideration ₹18 Cr for ~2,80,000 sqft").
- Area inputs may be in sqft or acres, but calculations should normalize cleanly.
- Deal stages and transitions are defined in `backend/src/constants/domain.js`.
- `deals.is_archived` is the archive control. Do not hard-delete active live deals.
- External market intelligence must remain verified-data-only. If no verified feed exists, show a truthful unavailable state.
- Risk flags must support categories common in Indian deals: Legal/Title, Regulatory/Approvals, Promoter/Execution, Market/Demand, Environmental, Financial/Model, Operational.
- Track promoter/builder track record, past project delivery delays, and RERA project linkages — even if verification is manual initially. Never leave this field absent from the deal model.

## Backend guardrails

- Keep routes thin. Put workflow logic in `backend/src/services/`.
- Reusable deterministic calculations belong in `backend/src/utils/` or dedicated engines.
- Read models that combine DD, approvals, risks, financials, and documents should be synthesized server-side so the frontend reads one grounded payload. Version these where material.
- Preserve Vercel serverless compatibility. No long-lived workers or background assumptions in request handlers.
- Provider integrations must stay behind adapters under `backend/src/services/ai/`.
- All document processing happens server-side. Never send full documents to client-side AI calls. Log access to sensitive documents.

## Data and integration strategy

- Verified external data only for Market Intelligence and Comps. If no reliable, up-to-date feed exists for a data type, show a clear "Unavailable — manual input required" state with import hooks. Never fake it.
- Prioritize adapters for:
  - Document storage with signed URLs
  - Future official sources (BDA, BBMP, RERA, Registration dept.) via secure APIs when available
  - WhatsApp/email for deal activity logging — common in Indian deal flow and should be a first-class ingestion path
- Track data provenance and last-verified date for every critical field. An unverified comp looks different from a verified one.
- Synthesized read models (DD + approvals + risks + financials + documents) must be generated server-side and versioned where material.
- Direct integration with Karnataka land records (Bhoomi / Kaveri portal) and automated RERA project status verification are classic manual blockers. Record the exact workaround in `TODO_DATA.md` or `TODO_LEGAL.md`. Do not fake connectivity.

## AI routing policy

- **Gemini**: Document classification, OCR-style extraction (including scanned Kannada/English/Hindi), translation, structured field extraction from agreements, sale deeds, approvals, and RERA documents.
- **Claude**: Cross-document reasoning, DD synthesis, risk narrative generation, next-step recommendations, IC-style memo drafting, inconsistency detection across documents.
- **Deterministic code only**: All financial math, KPI calculations, sensitivities, area/price normalizations (sqft ↔ acres, crore, per-acre, per-sqft), comp normalization, approval status logic, scoring/risk flagging, GIS calculations.
- Route AI only when confidence thresholds are met. Otherwise surface raw extraction with a "low confidence — manual verification required" prompt.
- All AI outputs that influence decisions must include traceable references back to specific uploaded documents or verified feeds. No free-floating AI assertions.

## Security and privacy

- Keep provider/API calls server-side unless a client-side provider flow is explicitly safe and intentional.
- Favor least privilege and private-by-default document access.
- Validate file type and size on upload.
- Prefer signed URLs or controlled access for private storage.
- Make session persistence explicit to the user. Default browser-session login should end on browser close unless `Remember me` is chosen.
- All document processing happens server-side. Never send full documents to client-side AI calls. Log access to sensitive documents.

## Validation expectations

When a workflow changes, verify as much of this chain as possible:

- create deal
- link/unlink parcel
- upload/download/delete document
- AI extraction → human review → commit to deal record
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
- Direct integration with Karnataka land records (Bhoomi / Kaveri portal)
- Automated RERA project status verification
- private provider credentials or storage tokens
- production deployment auth

Instead:

- build the right adapter, schema, or UI hook
- leave the feature disabled or clearly manual
- record the exact blocker in `TODO_MANUAL.md`, `TODO_DATA.md`, or `TODO_LEGAL.md`

## Adoption and success metrics

The platform succeeds when deal teams spend dramatically less time on mechanical data chasing and more time on judgment. Target outcomes:

- Time from deal creation to complete DD summary is significantly reduced.
- IC memos are generated with clear traceability and explicit confidence calls.
- Zero tolerance for "it worked in demo but breaks on real messy data."
- High internal adoption: users actively use the Financial Engine, Risk module, and Activity timeline instead of falling back to Excel and email.

Track via session usage, time-to-stage transitions, and qualitative feedback from Bengaluru deal professionals.

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

## Frontend motion and polish rules

For every frontend change — components, pages, modals, charts, maps, exports — the standing bar is defined in `docs/FRONTEND_GUIDELINES.md`. Read that file before writing UI code. Key non-negotiables:

- Smooth, alive, decisive, trustworthy — Bloomberg / Stripe / Linear, never AI-SaaS-tacky.
- Every interactive element needs all four states: default, hover, focus-visible, active.
- Skeletons (not spinners) for loads > 100ms. Numbers count up/down on change. Status pills cross-fade.
- Exact timing values (120ms hover, 220ms modal open, 600ms count-up, etc.) live in the guidelines table — use those, do not invent your own.
- Respect `prefers-reduced-motion`. WCAG AA contrast. 60fps minimum.
- Default to flat. 3D / parallax only when it earns its complexity (hero KPI hover, card flip for source detail, cadastral map tilt).
- Charts must draw in on first render and transition smoothly on update. Tabular numbers always.
- No decorative emojis, no gradients on hero tiles, no auto-playing media, no spinner-for-skeleton.

The seven feel-check questions in section 12 of the guidelines doc are mandatory before any visual PR merges.

## PR communication rule

Every PR must include a plain-English section explaining:
- What the site can do now that it couldn't before (or what was broken and is now fixed)
- What the user can see or click that's different
- Why it matters

No jargon. Write it as if explaining to someone who doesn't code.

## Session logging rule

At the end of every session, append a summary to `SESSION_LOG.md` in the repo root:
- Date
- What was worked on in plain English
- Which PRs were opened or merged
- What's left to do next

This is mandatory. It ensures work history survives even when chat sessions disappear.
