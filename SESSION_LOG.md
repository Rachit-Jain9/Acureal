# REDIP Session Log

Running history of every working session. Read this to understand what was built, what changed, and what's next — even if the chat session is gone.

---

## 2026-04-28

**What happened:**
This was a setup/housekeeping session. No feature code was written.

**What was done:**
- Created `AGENTS.md` at the project root — a rules file that Codex, Cursor, and every other AI tool can now read. Previously these rules only existed inside Claude's private memory folder, invisible to anything else.
- Updated `CLAUDE.md` with two new mandatory rules:
  1. Every PR must be explained in plain English (not just code terms)
  2. Every session must end with a log entry here in `SESSION_LOG.md`
- Created this file (`SESSION_LOG.md`) so work history is permanently stored in the repo and never lost when a chat session disappears.

**PRs merged:** None (these were direct file changes, no PR needed for housekeeping files)

**What's next:**
- The morning session from 2026-04-28 was lost before this log existed — that content is unrecoverable. Going forward it will be captured here.

**Late session — same day:**

Major doc cleanup and a UI redesign PR.

Doc cleanup (committed directly to master):
- Deleted `PHASE_MERGE_PLAN.md` and `docs/LEGACY_SHAPE_AUDIT.md` (both stale, documenting work that's already done or deleted)
- Rewrote `docs/CLEANUP_INVENTORY.md` from 100 lines to 24 — only the open cryptographic-signing gate remains
- Fixed `packages/financial-kernel/README.md` — it had stale info saying a feature flag existed that was removed weeks ago
- Stripped completed items from `TODO_MANUAL.md` (3 done items removed and renumbered) and `TODO_ARCHITECTURE.md` (2 done items removed)
- Deleted 3 redundant memory files (`feedback_approach.md`, `feedback_craftsmanship.md`, `project_redesign_plan.md`) — content was duplicated in CLAUDE.md and AGENTS.md
- Expanded CLAUDE.md and AGENTS.md with India-specific guardrails: Core Philosophy section, 4 new hard rules (AI must be labeled "AI-assisted, requires human review"; comps must show source/freshness; immutable audit trail), risk flag categories common in Indian deals, sourcing-stage tolerance, Data & Integration Strategy section, Adoption & Success Metrics section

Database cleanup:
- Deleted 4 user accounts via Supabase: 2 orphaned test accounts (`abc@gmail.com`, `ayush781007@yahoo.com` aka "Lana Rhoades"), 1 duplicate of Rachit's account (`rachitjain348@gmail.com`), and 1 unused workspace owned by Rekha Jain
- 5 real users remain: Rachit (owner of Default Workspace) + Bharath and Mourya (editors in Default Workspace) + Rahul Jose and Adit (each owns their own separate workspace)

UI redesign — PR opened, not yet merged:
- **PR #70** — Editorial overhaul of the Parcel Intelligence panel (the page that shows on every deal under Regulatory/Zoning tab)
- Replaced 8 yellow/beige "Needs verification" tiles with neutral grey tiles that show em-dash + a single small "Needs review" chip when data is missing
- Replaced single half-filled confidence bar with 4 segmented mini-bars, one per pillar (Zoning / Buildability / Guidance / K-GIS), each colored by its own score
- Replaced pastel verdict banner (amber background) with neutral chrome + 4px colored left stripe
- Fixed the broken sideways layout in Authority Verification — header now sits on top, 3-column card grid below
- Hierarchy chips (Village/Hobli/Taluk/District) in the K-GIS card use proper neutral chrome instead of pastel boxes
- VerifiedPill now uses the design-system `<Badge tone="success">` primitive instead of hand-rolled emerald
- 1 file changed, +287 / −196 lines, build green, no logic/hook/query changes (presentation only)

**Late-late session — same day, after PR #70 merged and deployed:**

Two more PRs shipped, both merged and deployed to https://redip.vercel.app.

**PR #71 — Frontend motion/polish guidelines** (merged):
- Created `docs/FRONTEND_GUIDELINES.md` — the standing rulebook for every visual change
- 13 numbered sections: motion principles, exact timing tables (120ms hover, 220ms modal open, 600ms count-up, 700ms chart draw-in), required 4-state interactions, skeleton-not-spinner rule, live data treatment, 3D/parallax used surgically, chart animation, page transitions, accessibility, performance budget, content presence, 7 feel-check questions, default tooling
- Wired into `CLAUDE.md` and `AGENTS.md` so every AI tool (Claude Code, Codex, Cursor) reads it automatically at session start
- Anti-patterns explicitly banned: gradients on hero, glow/neon, decorative emojis, auto-play, spinner-for-skeleton, saturated pastel tints, decorative parallax, bouncy spring physics on professional surfaces
- 253 lines added, no code changes. Pure docs.

**PR #72 — Master Plan panel editorial + larger interactive K-GIS map** (merged):
- First PR following the new FRONTEND_GUIDELINES rulebook
- **Master Plan Zone panel** (`MasterPlanZonePanel.jsx`):
  - Saturated `bg-primary-600` blue header replaced with neutral chrome + 4px colored left stripe (green=assigned, amber=unassigned)
  - "Assigned" success Badge appears next to zone code
  - ZoneFact tiles: em-dash + single "Needs review" chip for missing values; review status renders as proper Badge tone (success/warn) instead of plain text
  - Picker dropdown slides in 220ms decelerate, skeleton rows pulse staggered while loading
  - Save/Cancel buttons fade-up 180ms when notes are dirty
  - All buttons have full 4-state interactions (default → hover → focus-visible → active)
  - Custom rotating chevron on source-notes details element
- **K-GIS map upgrade** (`ReadOnlyPropertyMap.jsx`):
  - Default height 224px → **440px** (almost 2× bigger)
  - **Layer toggle** in top-right: Streets (OSM) ↔ Satellite (Esri imagery)
  - **Scroll-wheel zoom enabled** — was disabled before, felt dead
  - **Auto-fits to parcel geometry** with 500ms animated zoom when geometry exists
  - **Fullscreen button** bottom-right (browser Fullscreen API, no new dependency)
  - Better marker (filled blue circle, proper border) and stronger teal geometry overlay
- **Parcel panel layout restructure** (`ParcelIntelligencePanel.jsx`):
  - K-GIS card moved out of the cramped right sidebar into its own full-width row at the bottom
  - Right sidebar now reserved for confidence + flags only
- **Motion plumbing** (`index.css`):
  - 3 new keyframes: `zonepicker-slide` (220ms decelerate), `fadeInUp` (180ms ease-out), `scaleIn` (150ms ease-out)
  - Already covered by existing `prefers-reduced-motion: reduce` media query
- 4 files changed, +396 / −123 lines, build green (37s)
- No new dependencies. framer-motion considered and rejected — pure CSS keyframes sufficient.

**What's next:**
- Visually verify the live https://redip.vercel.app deal Regulatory/Zoning tab after deploy completes
- Open candidates for follow-up:
  - Build a "change member role" admin UI (currently no way to demote/promote existing teammates without direct DB updates)
  - Add a verification UI for the new authority-verification card cluster (Grok flagged that interactivity needs work)
  - Apply the same editorial treatment to other surfaces with similar issues (Comps, Risk tab, Financials KPI cards as needed)
  - Add count-up animations to KPI tiles on data refresh per FRONTEND_GUIDELINES section 5

---

## 2026-04-28 (second session — same day, continued after PRs #71/#72)

**Context:** Resumed from a prior context-compressed session. Q-now roadmap from the Command Deck plan was in-flight.

### PRs shipped this session

**T5: Red-flag rule registry + snapshot_stale rule (direct commits)**
- Extracted 10 inline red-flag predicates from `composeParcelIntelligence` into `backend/src/engines/parcelRedFlags.engine.js`. Each rule is a named object with `id`, `severity`, `label`, `description`, `predicate`, `detailFor`.
- Added 11th rule `snapshot_stale` — fires when a prior snapshot is >30 days old, silent on first load.
- Renamed `getLatestSnapshotId` → `loadLatestSnapshotMeta` (returns `{ id, generated_at }`), eliminating a redundant DB query.
- Admin widget `RedFlagRulesCard` in `ParcelIntelligenceAdminPage.jsx` — lists all 11 rules with severity Badge, collapsed to 4 rows by default.
- Full per-rule unit tests for `snapshot_stale` (7 cases), 7-fixture parity guard, updated service/verify tests.
- **P1/P2**: Replaced hand-rolled `StatusPill`/`SourceStatusBadge`/`StatusBadge` with `<Badge tone>` primitives; replaced amber warning divs with `<ErrorState tone="warn">`.

**P3 — Drop inline CSS-var color styles from LandingPage.jsx (commit ef71495)**
- Replaced all `style={{ color: 'var(--color-text-*)' }}` and `style={{ color: 'var(--color-brand-*)' }}` with Tailwind utilities (`text-content-primary`, `text-content-secondary`, `text-content-muted`, `text-premium`, `text-accent`). Net −50 lines. Build green.

**T4 — HMAC snapshot signing (commit b57653d)**
- `computeSignature` HMAC-SHA256 over `inputs_hash|output_hash|engine_version`, keyed by `PARCEL_SIGNING_SECRET`. Gracefully returns null when secret not set.
- `saveSnapshot` writes `signature` + `engine_version` columns to DB.
- `verifySnapshotSignature(snapshotId)` with `timingSafeEqual`.
- New route: `GET /api/parcel-intelligence/snapshots/:id/verify-signature`
- `ParcelIntelligencePanel.jsx`: "Signed" Badge pill appears when refresh response carries a signature.
- Migration: `database/migrations/20260428_parcel_intelligence_signature.sql`

**Manual steps still required:**
1. Apply migration to Supabase production (two nullable ADD COLUMN IF NOT EXISTS).
2. Set `PARCEL_SIGNING_SECRET` on Vercel (32+ char random string).

**What's next (Q-next):**
- T1 — What-if buildability sliders (client-side, zero new endpoints)
- T2 — Source explorer drawer (citation chip → PDF page + bounding box)
- P5/P6 — AI cost widget + confidence breakdown drilldown

---
