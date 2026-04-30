# REDIP Session Log

Running history of every working session. Read this to understand what was built, what changed, and what's next — even if the chat session is gone.

---

## 2026-04-30 (Codex source-document review history)

**What was worked on in plain English:**
- Added a history view for uploaded masterplan and regulatory source files.
- Reviewers can now see who changed source metadata, when it changed, and what the previous values were.
- This makes authority status, OCR readiness, confidence, and source-role changes easier to trust before extraction output is used.

**PRs opened/merged:** PR #98 opened and merged.

**Verification:**
- Backend source-registry history test passed.
- Frontend Master Plan admin history test passed.
- Backend full test suite passed: 453 tests.
- Frontend full test suite passed: 84 tests.
- Frontend production build passed.

**What's left to do:**
- Continue toward the next source-registry step: OCR/review workflow for image-heavy files and richer source explorer behavior.
- No manual environment-variable action was needed for this task.

---

## 2026-04-30 (Codex source-registry start)

**What was worked on in plain English:**
- Read the repo Markdown rulebook, TODOs, architecture notes, and session history to align on product rules and prior work.
- Separated BBMP Unit Area Value / property-tax material from true IGR guidance-value material.
- Added a new BBMP UAV source type to intake, classification, extraction prompts, and the Master Plan source-document picker.
- Guarded ingestion so BBMP UAV/property-tax rows are kept as review evidence only and never written into the IGR guidance-value candidate table.

**PRs opened/merged:** PR #93 opened and merged.

**Verification:**
- Backend full test suite passed.
- Frontend Master Plan admin test passed.
- Frontend production build passed.

**What's left to do:**
- Continue the source-registry pass for the attached RMP/masterplan PDFs: legal status, authority metadata, OCR coverage, and source roles.
- Add OCR handling for image-only/provisional PDFs before trusting extracted rows.
- Decide whether BBMP UAV needs its own structured table later; for now it is intentionally evidence-only.

---

## 2026-04-30 (Codex source-registry metadata)

**What was worked on in plain English:**
- Shipped the first source-registry slice as draft PR #93 with a Vercel preview: BBMP Unit Area Value / property-tax PDFs are separated from true IGR guidance-value PDFs.
- Started the next source-registry slice on branch `codex/source-registry-metadata`.
- Added registry metadata for uploaded masterplan/regulatory source files: source role, legal status, authority, published date, source URL, page count, OCR readiness, text coverage, source confidence, and registry notes.
- Updated the source-document intake screen so analysts can record authority/status/OCR context before extraction.

**PRs opened/merged:** PR #93 and PR #94 opened and merged.

**Verification:**
- Backend full test suite passed: 448 tests.
- Frontend Master Plan admin test passed.
- Frontend production build passed.

**What's left to do:**
- Continue with OCR-specific handling for image-only PDFs such as provisional scans.
- Consider seeding the attached official documents into the registry with source role, legal status, authority, and OCR status.

---

## 2026-04-30 (Codex source-registry readiness)

**What was worked on in plain English:**
- Landed the source-registry metadata step and deployed it to production.
- Added a clear readiness view for masterplan source files so analysts can separate text-ready sources from OCR/image-review, manual-entry, metadata-gap, and failed sources.
- Blocked automated extraction when a source is explicitly marked as OCR-required, image-review, manual-entry, or not extractable.
- Kept provisional/image-heavy PDFs from looking equally ready until a human review or OCR pass happens.

**PRs opened/merged:** PR #94 and PR #95 opened and merged.

**Verification:**
- Backend full test suite passed: 449 tests.
- Frontend Master Plan admin test passed.
- Frontend production build passed.

**What's left to do:**
- Add an actual OCR/review workflow for image-heavy PDFs once the queue is visible.

---

## 2026-04-30 (Codex deal overview hotfix)

**What was worked on in plain English:**
- Investigated a production deal-page crash showing "id is not defined" on the overview page.
- Fixed the Full Model link so it uses the current deal identifier from the deal workspace context.
- Added a regression test to make sure the overview page can render the financial summary link without crashing.

**PRs opened/merged:** PR #96 opened and merged.

**Verification:**
- Frontend Overview tab regression test passed.
- Frontend production build passed.

**What's left to do:**
- Watch for any remaining deal-page context migration regressions.

---

## 2026-04-30 (Codex source-document review controls)

**What was worked on in plain English:**
- Added review controls for uploaded masterplan/regulatory source files so analysts can correct authority, legal status, source role, processing mode, OCR flag, text coverage, confidence, source URL, page count, and notes after upload.
- Added a source-document edit history table so registry changes are recorded instead of silently overwritten.
- Applied the additive Supabase migration for that history table and verified it exists.
- Checked the Vercel environment-variable list from the CLI; secret values stay hidden, and the dashboard badges may still need manual review in Vercel.

**PRs opened/merged:** Source-document review-controls branch in progress.

**Verification:**
- Backend full test suite passed: 451 tests.
- Frontend Master Plan admin test passed.
- Frontend production build passed.
- Supabase migration verified.

**What's left to do:**
- Push, preview, merge, and deploy this branch.
- Manually review the Vercel "Needs Attention" environment-variable badges in the dashboard if Vercel requires rotation or re-save.

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

## 2026-04-29

**Context:** Comprehensive deep-dive audit of REDIP — backend, frontend, database, migrations, deployment, AI routing, security posture. Plan filed at `~/.claude/plans/go-through-all-the-joyful-pebble.md` (5 strategic bets + 18 tactical sweeps). Two PRs shipped from the audit's first cut.

### Audit findings (highlights)

- Live Supabase advisor: 25 security lints (3 ERROR-severity), 235 performance lints (109 stacked permissive policies, 86 unused indexes, 38 unindexed FKs, 7 mutable `search_path` functions).
- Supabase migration tracking: 3 of 29 migrations registered in `schema_migrations` — preview branches and rollbacks were uncalibrated.
- CI: only `defaults-staleness.yml` (one JSON-field check) — no test gate, no lint, no security scan.
- Operational guard rails: AI calls had no cost cap, `PARCEL_SIGNING_SECRET` silently null in prod, two cron routes had drifted-twin auth helpers.
- Frontend: no count-up on KPI changes, Toast lacked `aria-live`, Recharts ticks lacked `tabular-nums`. Five components > 600 LOC. (Aria-modal already shipped, contrary to the audit's initial finding.)

### PRs shipped

**PR #74 — `feat(infra): CI gate + AI cost cap + cron-auth middleware + signing-secret hard-throw` (merged)**
- New `.github/workflows/ci.yml` runs kernel build+tests, backend tests, frontend build+tests on every PR/push to master.
- New `backend/src/lib/costGuard.js` — per-org daily AI spend cap via `AI_DAILY_COST_CAP_USD`. `aiRouter.runAI` calls `assertWithinDailyCap` before every provider request; cap-tripped attempts get logged with `status='cost_capped'`. NULL-org gets 2× cap. No-op when env unset.
- New `backend/src/middleware/cronAuth.js` — single `requireCronAuth` middleware replaces two duplicated `getCronToken` helpers in `parcelCron.routes.js` and `fx.routes.js`.
- `parcelIntelligence.service.computeSignature` now hard-throws in `NODE_ENV=production` when `PARCEL_SIGNING_SECRET` is missing — no more silently-unsigned snapshots in prod.
- Tests: 401 → 418 backend (+17 across costGuard + cronAuth). Frontend build green.

**PR #75 — `feat(ui): KPI cross-fade, count-up + reduced-motion hooks, Toast aria-live, Recharts tabular-nums` (merged)**
- New `frontend/src/hooks/useReducedMotion.js` — live `prefers-reduced-motion: reduce` subscription with OS-toggle updates, SSR-safe and Safari < 14 compatible.
- New `frontend/src/hooks/useCountUp.js` — rAF interpolation with cubic-out easing (default 600ms per FRONTEND_GUIDELINES §5). Snaps instantly under reduced-motion.
- `MetricTile` value node re-mounts on change with a 180ms `value-cross-fade` keyframe (defined in `index.css`). Collapses to no-op under reduced-motion. Every KPI tile across the app picks this up automatically.
- `Toast` — `role="alert" aria-live="assertive"` for errors, `role="status" aria-live="polite"` for everything else. Dismiss button gets accessible label + focus ring.
- `FinancialVisualizationLayer` — 13 inline `tick={{ fontSize: ... }}` props collapsed onto two module-scoped constants (`AXIS_TICK`, `AXIS_TICK_SMALL`) with `fontVariantNumeric: 'tabular-nums'` per FRONTEND_GUIDELINES §7.
- Tests: 60 → 70 frontend (+10 across the new hooks + Toast a11y).

### Required operator action (env vars on Vercel)

- `AI_DAILY_COST_CAP_USD` — daily per-org cap (suggested 50.00). Unset = no cap.
- `PARCEL_SIGNING_SECRET` — 32-char random, generated via `openssl rand -hex 32`. **Production deploy refuses to mint snapshots without it.**

### What's next

From the plan file (in priority order):
- **Bet 2 partial — RLS + advisor cleanup**: write `0030_rls_consolidation.sql`, `0031_index_hygiene.sql`, `0032_function_hardening.sql`, `0033_users_rls.sql` for the user to apply via Supabase. Targets the 235 performance lints + 3 ERROR security lints.
- **Bet 3 — decompose**: `parcelIntelligenceAdmin.service.js` (1,801 LOC), `dealPptx.service.js` (2,292 LOC), `dealXlsx.service.js` (1,520 LOC). Same for the 5 frontend components > 600 LOC. Unblocks signed exports (CLEANUP Gate 4) and interactive `MethodologyExplorer` (TODO_MANUAL #10).
- **Bet 5 remaining — reactive seam**: `useDealContext()` hook + migrate the 9 deal tabs onto a single read model. Currently each tab has its own query.

### Late session — same day, PR #76 (Bet 2 first cut)

**PR #76 — `chore(security): close 3 ERROR + 8 WARN Supabase advisor lints` (merged)**

Three new SQL migration files authored. Migrations are **not auto-applied** — operator runs them via psql. Postgres 17.6 confirmed on production. CI green (kernel + backend + frontend + Vercel preview).

- `database/migrations/20260430_users_rls_and_summary_invoker.sql` — Enable RLS on `public.users` (was OFF; PostgREST `anon` could `GET /rest/v1/users` and dump every email + password_hash). Three policies: `users_self_read` (full row, self only), `users_org_mates_read` (rows of users sharing any organization with the caller — preserves the collaboration UX), `users_self_update` (UPDATE self only). INSERT/DELETE intentionally have no policy. Recreates `public.deal_summary` `WITH (security_invoker = true)` so it honors the caller's RLS instead of the creator's.

- `database/migrations/20260430_function_search_path_lockdown.sql` — `ALTER FUNCTION ... SET search_path` on the 7 REDIP-owned functions flagged by `function_search_path_mutable`: `current_user_id`, `current_organization_id`, `update_updated_at_column`, `feature_flag_cohorts_touch`, `investor_packages_touch`, `sync_property_geom`, `regulatory_data.effective_fsi`. Closes the schema-shadow attack vector.

- `database/migrations/20260430_feature_flag_cohorts_write_policy.sql` — Drop the `feature_flag_cohorts_write` RLS policy whose USING and WITH CHECK clauses were both literally `true`. Backend writes still work via the postgres-role bypass; PostgREST writes denied. Read policy (intentional public read for landing-page beta-banner cohort lookup) preserved.

- `database/current_schema.sql` — manifest updated with a new "Phase 4 — RLS hardening" section.

**Operator action required to land the security improvement:**

```
psql "$DATABASE_URL" -f database/migrations/20260430_users_rls_and_summary_invoker.sql
psql "$DATABASE_URL" -f database/migrations/20260430_function_search_path_lockdown.sql
psql "$DATABASE_URL" -f database/migrations/20260430_feature_flag_cohorts_write_policy.sql
```

After applying, the Supabase advisor `error`-severity count drops 3 → 1 (only PostGIS-shipped `spatial_ref_sys` remains, intentionally), the 7 `function_search_path_mutable` warnings → 0, and the `rls_policy_always_true` warning on `feature_flag_cohorts` → 0.

**Deliberately deferred (per audit roadmap):** the 109 `multiple_permissive_policies`, 86 `unused_index`, and 38 `unindexed_foreign_keys` items. Each requires per-table audit and a 30-day `pg_stat_user_indexes` snapshot before `DROP INDEX` is safe.

### Operator env vars set this session

- `PARCEL_SIGNING_SECRET` — 32-byte hex generated locally, pasted into Vercel (Production + Preview).
- `CRON_SECRET` — 32-byte hex generated locally, pasted into Vercel (Production + Preview).

### PR #76 applied — verification (2026-04-29 evening)

Operator ran the three SQL files from PR #76. Verified post-apply via Supabase MCP:

- `public.users` RLS enabled, 3 policies present (`users_self_read`, `users_org_mates_read`, `users_self_update`).
- `public.deal_summary` reloptions: `security_invoker=true`.
- `feature_flag_cohorts` policy count: 1 (read only — write policy dropped).
- All 7 functions have pinned `search_path` (six at `""`, `sync_property_geom` at `"public"`, `regulatory_data.effective_fsi` at `"regulatory_data"`).

Advisor security count: **25 → 14**. ERROR-severity: **3 → 1** (only PostGIS-shipped `spatial_ref_sys`). The 7 `function_search_path_mutable` WARN lints and the `rls_policy_always_true` WARN are gone.

### PR #78 — `chore(perf): cover 38 unindexed foreign keys` (merged, awaits apply)

One new SQL migration file authored. Closes the 38 `unindexed_foreign_keys` performance lints from the audit's perf advisor.

- `database/migrations/20260430_unindexed_fk_covering_indexes.sql` — 24 indexes on `public` (every `*_by` user-tracking column plus a few document/org references), 14 on `regulatory_data` (evidence + masterplan + parcel snapshot lineage). All single-column. Built with `CREATE INDEX CONCURRENTLY IF NOT EXISTS` so writes are not blocked during apply, and the file is idempotent.
- `database/current_schema.sql` — manifest updated under Phase 4.

**Operator action required:**

```
psql "$DATABASE_URL" -f database/migrations/20260430_unindexed_fk_covering_indexes.sql
```

Or paste the file into Supabase SQL editor → Run. Do not wrap in a transaction — `CONCURRENTLY` is incompatible with explicit `BEGIN/COMMIT`.

After apply: perf advisor `unindexed_foreign_keys` count drops 38 → 0.

**Deliberately deferred:** the 109 `multiple_permissive_policies` and 86 `unused_index` lints. The first needs per-table audit (replacing stacked policies with single unions); the second needs a 30-day `pg_stat_user_indexes` snapshot before any `DROP INDEX` can be safely run.

### PR #80 — `fix(migrations): drop CONCURRENTLY so FK index migration runs in Supabase SQL editor` (merged + applied)

PR #78 used `CREATE INDEX CONCURRENTLY` which errored with `25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction block` when pasted into the Supabase SQL editor (which auto-wraps all queries in `BEGIN/COMMIT`). PR #80 swapped to plain `CREATE INDEX IF NOT EXISTS` wrapped in a single `BEGIN/COMMIT`. Applied successfully on 2026-04-29 evening. Verified: 38 indexes built, perf advisor `unindexed_foreign_keys` count 38 → 0.

Trade-off accepted: brief table-level write locks during index creation (negligible on REDIP's current sub-1k row volumes). If a table grows past ~100k rows, that one index can be dropped and rebuilt with CONCURRENTLY via psql separately.

### PR #81 — `chore(security): add policies for the 5 RLS-on-no-policy tables` (merged + applied)

Closes the 5 `rls_enabled_no_policy` advisor INFO lints. Each table had RLS turned on but no policies — meaning PostgREST anon/authenticated were silently denied via the absence of a matching policy. Backend kept working (postgres role bypasses RLS) but the *intent* of each table's access model wasn't expressed in code.

| Table | Policy added |
|---|---|
| `public.exchange_rate_fetch_log` | Explicit deny-all for anon/authenticated (internal cron log) |
| `regulatory_data.master_plan_documents` | Global-or-tenant `org_id IS NULL OR org_id = current_organization_id()` |
| `regulatory_data.master_plan_zones` | SELECT-only `USING (true)` (public reference data) |
| `regulatory_data.planning_districts` | SELECT-only `USING (true)` (public reference data) |
| `regulatory_data.zone_versions` | SELECT-only `USING (true)` (audit history) |

Applied successfully on 2026-04-30. Verified: every table now has 1 policy, `rls_enabled_no_policy` count 5 → 0.

### Final advisor state (end of session)

Security advisor count: **25 → 9**. ERROR-severity: **3 → 1**. Every one of the remaining 9 lints is PostGIS-shipped, not REDIP code:

| Lint | Count | Disposition |
|---|---|---|
| `rls_disabled_in_public` on `public.spatial_ref_sys` | 1 ERROR | PostGIS metadata table; intentionally untouched |
| `extension_in_public` on `pg_trgm`, `postgis` | 2 WARN | Extension placement; risky to move (every unqualified PostGIS call would break) |
| `anon_security_definer_function_executable` on `st_estimatedextent` (3 overloads) | 3 WARN | PostGIS-shipped function; revoking EXECUTE could break Supabase row-count estimates |
| `authenticated_security_definer_function_executable` on `st_estimatedextent` (3 overloads) | 3 WARN | Same as above |

REDIP-controlled security advisor lints: **0**. The session-long advisor cleanup theme (PRs #74, #76, #78, #80, #81) is complete for the safe, mechanical subset.

Performance advisor `unindexed_foreign_keys`: **38 → 0**. Remaining performance lints (`multiple_permissive_policies`, `unused_index`) are deferred for a future PR with proper per-table audit + 30-day usage data.

---

## 2026-04-30 (continued — Bet 3 + Bet 5 push)

### PRs shipped

**PR #83 — `refactor(extraction)`: extract 19 Gemini doctype prompts** (merged) — first Bet 3 cut. `extraction.service.js` 1,168 → 692 LOC; new `services/ai/extractionPrompts.js` holds all 19 doctype prompts + the classifier prompt. Public re-export of `GEMINI_EXTRACTION_PROMPTS` preserved.

**PR #84 — `feat(a11y)`: focus trap on the 3 modal/drawer surfaces** (merged) — new `useFocusTrap(active, opts)` hook. Wired into `CommandPalette`, `SourceExplorerDrawer`, `VerifyItemDialog`. Tab/Shift+Tab cycles within the dialog; previously-focused element restored on close. Frontend tests 60 → 70.

**PR #85 — `refactor(parcel)`: decompose parcelIntelligenceAdmin.service** (merged) — first major Bet 3 god-service split. 1,801 LOC → 6 files (4 concerns + helpers + shim) under `services/parcelIntelligence/`. Largest post-split: 545 LOC. Public API preserved via thin shim. 418 backend tests still green.

**PR #86 — `feat(deal-context)`: useDealContext scaffolding** (merged) — TODO_ARCHITECTURE Phase A foundation. New `frontend/src/hooks/useDealContext.jsx` with `<DealContextProvider>` + 6 typed selector hooks (`useDealRecord`, `useDealKpis`, `useDealRedFlags`, `useDealEvents`, `useDealDocuments`, `useDealActivities`). Each selector returns a stable ref via useMemo; provider mounted in `DealDetailPage`. 11 new vitest cases (70 → 81 frontend tests).

**PR #87 — `feat(deal-context)`: migrate OverviewTab to consume useDealContext** (merged) — pilot consumer. Drops `({ deal, id })` props, uses `useDealContext()` + `useDealRecord()`. Validates the seam end-to-end.

**PR #88 — `feat(deal-context)`: migrate 3 more tabs (Documents, Activity, Risk)** (merged) — drops `({ dealId })` props on three more bounded surfaces. 4 of 9 deal tabs on the new pattern.

**PR #89 — `feat(deal-context)`: migrate final 5 tabs (Parcel, Zoning, Financial, DD, Comps)** (merged) — TODO_ARCHITECTURE Phase A complete. All 9 deal tabs read deal/dealId from useDealContext. Auxiliary props kept where they're not deal-derived (`ParcelTab.canEdit`, `ZoningTab.setTab`). Side artifact: dropped DDTab's dead `assetClass`/`dealStructure` props.

**PR #90 — `refactor(exports)`: decompose dealPptx.service (2,292 LOC) into 5 modules** (merged) — largest god-service in the repo. New layout under `services/exports/pptx/`: `_helpers.js` (294), `contentBuilders.js` (803), `deckContext.js` (283), `primitives.js` (209), `slides.js` (918). Orchestrator shim drops to 107 LOC. Same PPTX bytes for the same input — proven by 4 dealPptx parity tests passing unchanged. Side artifact: `scripts/split-deal-pptx.py` for future decompositions (e.g. `dealXlsx.service.js` at 1,520 LOC).

**PR #91 — `test(osm-adapter)`: integration tests for the T6 OSM road-width adapter** (merged) — closes audit's S18 coverage gap. 24 new tests across `HIGHWAY_DEFAULTS` sanity, pure-function tests for `selectBestWay`/`deriveWidth`, and `fetchRoadWidth` integration tests with axios mocked. Confidence ≤ 0.55 hard cap (CLAUDE.md) regression-guarded. Backend tests 418 → 442.

### Where the audit roadmap stands at session end

| Bet | Status |
|---|---|
| 1 — CI gate + migration baseline | ✅ CI shipped (#74); baseline reconciliation deferred |
| 2 — RLS + advisor cleanup | ✅ Safe subset shipped (#76, #78, #80, #81); 109 multiple_permissive + 86 unused_index deferred |
| 3 — Decompose god-services | ✅ Three cuts shipped (#83, #85, #90). `dealXlsx.service.js` (1,520 LOC) is the only remaining target — pattern + tooling (split-deal-pptx.py) ready. |
| 4 — Observability + cost caps + AI fallback | ✅ Cost cap + signing guards + cron auth (#74); OTel tracing + retry/fallback chain deferred |
| 5 — Frontend reactive seam + a11y/motion | ✅ Motion + a11y + focus trap + useDealContext scaffolding + **9/9 tabs migrated** (Phase A complete) |

### Net counts

- **18 PRs merged across the two-day session** (#74 → #91).
- **6 operator-applied migrations** (RLS hardening, function search_path, FK index hygiene, no-policy table policies).
- **2 Vercel env vars** set (`PARCEL_SIGNING_SECRET`, `CRON_SECRET`).
- **Security advisor**: 25 → 9 lints (every remaining one is PostGIS-shipped).
- **Performance advisor `unindexed_foreign_keys`**: 38 → 0.
- **Backend tests**: 401 → **442** (+41 across costGuard, cronAuth, OSM adapter).
- **Frontend tests**: 60 → **81** (+21 across useReducedMotion, useCountUp, Toast a11y, useDealContext).

### What's left (priority for next session)

1. **`dealXlsx.service.js` decomposition** — last remaining Bet 3 god-service (1,520 LOC). Same pattern as #90, can reuse `scripts/split-deal-pptx.py` as a starting template.
2. **`multiple_permissive_policies` cleanup (109 lints)** — risky one-way door; needs per-table audit + EXPLAIN ANALYZE pre/post on hot queries.
3. **OTel tracing + AI retry/fallback chain** — Bet 4 second cut. Wraps `aiRouter.runAI` with `AbortController` timeouts + Honeycomb/Axiom export.
4. **Override history drawer** — uses `useDealEvents()` selector exposed by PR #86. Closes the audit-trail visibility gap noted in TODO_MANUAL.

---
