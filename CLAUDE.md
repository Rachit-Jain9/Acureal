# Acureal Project Guidance

Acureal is an India-first, Bengaluru-priority, AI-powered deal intelligence, due diligence, underwriting, and investor reporting platform. Treat it as the operating system for live deal work, not as a generic CRM or document vault.

## Product intent

- Make `deals` the master object. Documents, DD items, approvals, risks, activities, deadlines, and outputs belong to a deal.
- Optimize for real sourcing, diligence, underwriting, IC prep, and decision support.
- Support incomplete live data. Never block early sourcing because a parcel name or address is unknown.
- Keep copy, formatting, and outputs investor-grade and explicit about confidence, units, and missing data.
- Bengaluru first, India second.

## Core philosophy

Acureal exists to compress the time between spotting a deal and making a confident IC decision, while reducing the catastrophic blind spots common in Indian real estate — title disputes, hidden encumbrances, approval gaps, RERA deviations, and promoter execution risk. The platform must feel like a sharp co-pilot for seasoned deal professionals in Bengaluru, not a generic tool.

Prioritize depth on live deals over breadth of features. Support messy, early-stage sourcing data without friction, but enforce rigor and explicit confidence levels as the deal matures toward underwriting and IC.

## Operator communication style — non-technical reader (PERMANENT, set 2026-05-18)

The operator (Rachit) is **not a technical person**. Every manual instruction you give him in chat must be written like you're explaining to a 5-year-old. This is a standing rule, in perpetuity, across every Claude session, every Cowork session, and every agent that ever reads this repo. Do not regress.

**Mandatory format for any manual step:**

1. **Name the exact tool** — "Vercel", "Google Cloud Console", "Supabase SQL editor", "your terminal in VS Code". Never assume he knows which tool a step belongs to.
2. **Provide a direct deep-link** wherever possible — e.g. `https://supabase.com/dashboard/project/<id>/sql/new` rather than "open Supabase".
3. **Number every click and keystroke** — "Click ⋯ → Edit → paste this exact value: `...` → click Save". No skipped "obvious" steps.
4. **Describe the success signal** — "you'll see a green toast saying 'Updated'" so he knows when to stop.
5. **Tell him what to send back** — "send 'done'" or "paste a screenshot if it looks different".
6. **No jargon.** Replace technical terms with plain English. "env var" → "setting". "deploy" → "publish the change". "migration" → "database update file". "endpoint" → "web address the app uses". "PR" → "code change request".
7. **Label commands by environment** — "🖥 In your terminal:" vs "🌐 In your browser:" vs "📋 Copy this and paste into Supabase SQL editor".
8. **Pre-empt confusion** — "if you see a yellow warning, click 'Yes, continue'".

**When the rule does NOT apply:** code itself, PR descriptions / commit messages / SESSION_LOG entries (those are for engineering audit, use normal technical detail). The rule is purely about **manual steps and findings communicated to Rachit in chat**.

**Examples:**

| ❌ Don't say | ✅ Say instead |
|---|---|
| "Update GOOGLE_MAPS_API_KEY in Vercel env vars" | "Open https://vercel.com/.../environment-variables. Find the row called `GOOGLE_MAPS_API_KEY`. Click ⋯ → Edit. Paste this exact value: `XXX`. Click Save. You'll see a green 'Updated' toast." |
| "Apply migration 20260529" | "Open https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new. Copy ALL text from this file: <raw link>. Paste it into the big text box. Click the green 'Run' button bottom-right. Send 'success' if you see 'Success. No rows returned'." |
| "Geocoder hitting REQUEST_DENIED on referrer-restricted key" | "Google is rejecting the key because that key is locked to browser-only use. The server can't use it. Easiest fix: 1) Open <link> 2) Click 'Application restrictions' 3) Select 'None' 4) Click Save. Takes 30 seconds." |

This section mirrors the canonical memory file at `~/.claude/projects/.../memory/feedback_communication_style_non_technical.md` (READ FIRST in `MEMORY.md`). When the two diverge, the memory file is the source of truth — update both.

## Hard rules

- Never fabricate zoning, legal, title, RERA, ownership, market, comp, GIS, or financial facts.
- Never use LLMs for deterministic math, rule-engine decisions, or core underwriting calculations.
- Never ship UI that looks production-ready if the underlying data source or workflow is stubbed, fake, or unsupported.
- Never hardcode secrets, tokens, or credentials.
- Never create duplicate top-level entities for the same real-world object.
- Never reintroduce top-level `Properties`, `Documents`, or `Actions` navigation as primary workflows.
- Never auto-generate or imply **legal conclusions** on **title chain, encumbrance status, RERA registration status, or statutory approval status** — these four lanes remain extraction/synthesis aid only, with human verification prompts. The Recommendation Engine and AI Deal Doctor MUST filter these topics to deterministic `Flag` cards backed by extracted facts; no AI-narrated recommendations on the legal four. AI is also barred from any sentence that asserts a statutory fact as truth ("title is clear", "RERA-compliant", "Khata is valid", "approval will be granted"). For everything else — financial, market, structural, pricing, capital-stack, absorption, leasing, design-efficiency, exit-route, negotiation — institutional-grade AI-narrated recommendations and diagnostic call-outs are **permitted and expected**, provided each call-out (a) is composed from deterministic kernel signals + evidence links, never invented; (b) uses the closed verb dictionary (`Recommend / Consider / Re-examine / Flag / Stress-test` for recommendations; `Diverges / Lacks support / Inconsistent / Below benchmark / Above benchmark / Missing` for diagnoses) — absolute verbs (`Buy / Reject / Approve / Decline / Clear / Pass`) are forbidden at the JSON-schema level; (c) follows the institutional / analytical / sharp / diagnostic tone bar — never theatrical, never slander-grade, never addressing promoter competence or intent.
- Never expose unverified market intelligence or comps as authoritative. Always surface source, freshness, and confidence level — or "No verified feed available."
- AI disclosure policy (operator override 2026-05-19, supersedes earlier rule): the customer-facing surface should NOT lean on AI as a marketing concept. Specifically:
  - **DOCX exports**: a single quiet first-page disclaimer (Arial 7pt italic muted) covers model-assisted synthesis for the whole report. No per-section "AI-Assisted" banners, no "REQUIRES HUMAN REVIEW" pills, no provider names (Claude / OpenAI / gpt-N / Sonnet), no auto-failover JSON in footers, no cross-product reconciliation copy.
  - **PPTX exports**: no mention of AI usage anywhere. No disclosure banners on slides. Cover/contents/briefing slide titles use plain product language ("Executive Briefing", not "AI-Assisted Briefing"). Generation footers carry only the date.
  - **XLSX exports**: no mention of AI usage anywhere. Tabs use neutral names ("Analysis Notes", not "AI Synthesis"). No amber disclosure banners.
  - **In-app UI**: the existing `aiBadge` and confidence chips on the live workspace stay (operator-facing only). Customer-facing exports are the constrained surface.
  - **Audit trail and admin tooling** (the `/dashboard/admin/ai-usage` page when it ships) MAY surface provider names + auto-failover diagnostics — those are operator-only.
  - **The deterministic-kernel guarantee is technical, not promotional**. All numbers come from the kernel; AI is restricted to interpretive prose. State this in the cover-page disclaimer but don't repeat the framing per section.
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

## Plain-English recap rule

After every shipped task — every commit pushed, every deploy, every migration applied — write a short plain-English recap in chat for the user. Rules:

- No code terms, no file paths, no jargon.
- 2–4 short bullets max. One sentence each.
- Lead with what the user can now see, do, or trust that they couldn't before.
- Close with one line on why it matters for the product, if non-obvious.

This is in addition to the PR communication rule (which lives in the PR body). The recap rule is for the in-chat reply right after work lands.

## Session logging rule

At the end of every session, append a summary to `SESSION_LOG.md` in the repo root:
- Date
- What was worked on in plain English
- Which PRs were opened or merged
- What's left to do next

This is mandatory. It ensures work history survives even when chat sessions disappear.
