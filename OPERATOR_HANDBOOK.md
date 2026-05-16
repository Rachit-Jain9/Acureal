# REDIP — Operator Handbook

**Single dashboard for everything the operator (you, Rachit) needs to do, decide, or pay for.**
Last refreshed: 2026-05-04 (after the PR #159–#166 sprint: UI polish, ai_routing_config, OTel tracing, MFA/TOTP, VirtualizedList, pgvector flagship, semantic search UI, tool registry foundation).

> **⚠ Stale notice (2026-05-16, PR-NX20):** This handbook captures ops procedures + the live status snapshot as of **2026-05-04**. Since then we've shipped ~175 PRs (#167 → #336+), most notably: Tokyo→Mumbai Supabase migration; AI model bump to GPT-5.4 / Gemini 3.1 Flash-Lite / Claude Sonnet 4.6 (PR-NX9 #322); XLSX investor-grade arc completion (PR #312–#334); cross-product AI-Assisted Briefing covering 10 native asset classes × 4 deal structures × 7 exit strategies, now on XLSX (PR-NX12 #328) + DOCX + PPTX (PR-NX18 #335); cross-product reconciliation suite (PR-NX19 #336). For the chronological PR log + plain-English summaries see **`SESSION_LOG.md`**. The operator-action items in §2 (legal red-line, domain, entity, Vercel env) + §4 (migrations) remain current.

This file aggregates from the working TODO files. It is the **first** place to look when starting a session.

| Other tracking files (don't replace, complement) | What's in them |
|---|---|
| [SESSION_LOG.md](SESSION_LOG.md) | Running history of every session. What was built. |
| [TODO_MANUAL.md](TODO_MANUAL.md) | Migration / env-var / credential checklists, per area |
| [TODO_DATA.md](TODO_DATA.md) | External data sources that are blocked or manual-only |
| [TODO_LEGAL.md](TODO_LEGAL.md) | Legal & regulatory principles (not actionable items) |
| [TODO_ARCHITECTURE.md](TODO_ARCHITECTURE.md) | Multi-PR deferred architecture work |
| [docs/AI_ROADMAP.md](docs/AI_ROADMAP.md) | Canonical AI tiers (cost wins → plumbing → agents → semantic) |
| [docs/legal/](docs/legal/) | DRAFT legal documents — lawyer review pending |

---

## 1. Live status snapshot

| System | Status | Notes |
|---|---|---|
| Production app | Live at https://redip.vercel.app | |
| Database (Supabase project `niamgjbxxgmmffggumvj`) | Free tier, ap-south-1 (Mumbai) ✅ migrated to Mumbai 2026-05-04 (was Tokyo `lsbhrbvuynzqhdtzczco`) | See §3.2 |
| Vercel hosting | Hobby tier | See §3.1 |
| Auth — password sign-up | Live, gated by `ALLOW_COLD_SIGNUP` env | Default deny; add invite token to bypass |
| Auth — Google sign-in | Live (PR #139) | Confirmed `enabled: true` on `/api/auth/google/config` |
| Auth — token storage | httpOnly cookies + 15-min access / 30-day refresh, rotated on each use (PR #142) | Reuse detection kills the family on replay; legacy `Authorization: Bearer` header still accepted for back-compat |
| Auth — set-first-password (OAuth-only users) | Live (PR #145) | Settings → Security flips to "Set a password" card when `user.password_set === false` |
| Legal — re-acceptance gate | Live (PR #144) | Modal blocks protected app until user re-accepts current Terms/Privacy. Founder will see this on next prod login (Privacy v2 not yet accepted) |
| Email verification | Live (PR #138), dev-mode delivery | Links surface in Vercel logs until Resend is wired |
| Legal docs | Terms v1, Privacy v2, Cookies v1 — published, DRAFT | **Not lawyer-reviewed.** Do not onboard user #2 until reviewed. |
| Domain | None (using `redip.vercel.app`) | See §3.3 |

---

## 2. Pending operator tasks (what's actually on your plate today)

### URGENT — before user #2 onboards
None of these are written in code; all need a human action.

- [ ] **Engage a Bengaluru technology / data-protection lawyer** to red-line `docs/legal/terms_of_service_v1.md`, `docs/legal/privacy_policy_v2.md`, `docs/legal/cookie_policy_v1.md`, and `docs/legal/grievance_officer.md`. Budget: ₹40k–₹1.5L for first-pass review. **Reason:** every DRAFT marker on those files says "before opening REDIP to any user other than the founder".
- [ ] **Fill in the operator placeholders** in those documents: `[NAME]`, `[GRIEVANCE OFFICER NAME]`, `[YOUR DOMAIN]`, `[ADDRESS]`, `[REGISTERED ADDRESS]`, `[CIN/GSTIN]`, `[LEGAL ENTITY NAME]`, `[LAWYER NAME on retainer]`.
- [ ] **Decide entity structure** (Sole Proprietorship vs LLP vs Pvt Ltd) and reflect it in Terms §1. This affects T&C enforceability.

### NEXT — pure ops, no urgency but still pending
- [ ] **Buy a domain** (e.g., `redip.in`, `redip.app`, or company-specific). Required for: real Resend email delivery, grievance@ address, professional sender domain on legal docs. ~₹1k/year via Cloudflare Registrar / GoDaddy / Namecheap. **Recommendation:** `.in` or `.co.in` for India clarity.
- [x] ~~Verify Supabase region~~ ✅ **Confirmed 2026-05-04: ap-south-1 (Mumbai).** DPDP soft-compliance + Indian-enterprise procurement plus side both satisfied.
- [ ] **Resend (email delivery)** — currently deferred Option B (links in Vercel logs). When you buy a domain: sign up at https://resend.com, add domain, set SPF/DKIM/DMARC DNS records, generate API key, set Vercel env vars `RESEND_API_KEY` + `MAIL_FROM`.
- [ ] **Move the repo off OneDrive.** Currently at `C:\Users\rachi\OneDrive - UW\Desktop\REDIP`; OneDrive prompts to "delete 320 items?" after every build. Move to `C:\dev\REDIP` (or similar) — git is the source of truth.

### WATCHLIST — only do if a specific trigger fires
- [ ] **Vercel Pro upgrade** ($20/user/month) — only if you hit the Hobby limits: 100 GB-hours serverless execution, 100 GB bandwidth, no team members, no commercial use. Hobby explicitly disallows commercial use; if you accept payment via REDIP, you must upgrade.
- [ ] **Supabase Pro** ($25/month) — only if you hit Free-tier limits: 500 MB DB, 1 GB storage, 2 GB egress, 50k monthly active users, daily backups → 7-day. The free tier auto-pauses after 7 days of inactivity — Pro removes that. Trigger: production has consistent traffic, OR you need point-in-time recovery, OR you cross 500 MB DB.
- [ ] **Anthropic / Google AI tier upgrade** — pay-as-you-go currently. Track spend at https://console.anthropic.com (Anthropic) and https://aistudio.google.com (Google AI). Set monthly cap alarms at $50, $200, $500. The internal `ai_call_logs` table + cost-guard middleware enforces a per-org daily cap.
- [ ] **Apply for Google OAuth verification** — only if you ever request *sensitive scopes* (Gmail, Drive, etc.). REDIP only requests `openid email profile` (non-sensitive); no verification needed today. Stays in "External + Testing" mode with up to 100 test users for free.

---

## 3. Tier-upgrade decision matrix

### 3.1 Vercel — Hobby → Pro

**Stay on Hobby until:**
- You start charging anyone for REDIP access (Hobby disallows commercial use — *enforced by ToS*, not technically blocked).
- You need any of: team members, password-protected previews, 1 TB bandwidth, 1000 GB-hours serverless, advanced analytics, custom DNS edge config.

**Pro pricing:** $20/user/month. Includes Speed Insights + Web Analytics (currently sitting as draft PRs #1, #2 — would consume a Pro seat).

**Recommendation:** Stay Hobby until you take the first paying customer or onboard a co-founder.

### 3.2 Supabase — Free → Pro

**Pooler credential cache (operational gotcha — recorded 2026-05-05):** The Supabase transaction-mode pooler (`*.pooler.supabase.com:6543`) caches the database password for ~10 minutes after rotation. If you rotate the DB password and the new one keeps failing with `password authentication failed`, **don't retry the same password** — the cache is stale. **Pause the project from the dashboard, then restore it.** That flushes the pooler instantly. Verified the workaround during the Tokyo→Mumbai cutover.



**Free-tier hard limits:**
- 500 MB database, 1 GB file storage, 2 GB egress/month
- 7-day project pause after inactivity (kills uptime SLAs)
- No PITR (point-in-time recovery), only daily backups for 7 days
- No log retention beyond 1 day
- 50,000 MAU on Supabase Auth (we don't use Supabase Auth, so irrelevant)

**Pro pricing:** $25/month base + usage. Adds: PITR (7-day window), daily backups (7-day → 14-day), 8 GB DB included (overages billed), branching, log retention.

**Recommendation:** Move to Pro the moment you take the first paying customer OR before you go offline for 7+ days (project pause = downtime). The PITR alone is worth $25/month for any deal-intelligence platform.

### 3.3 Domain

**Recommendation:** Buy `.in` or `.co.in` (clearest signal that REDIP is India-first). Cost: ~₹700–₹1,200/year.

**Where to buy:**
- Cloudflare Registrar — at-cost pricing, no upsell, free DNS, free SSL.
- Namecheap — slightly higher but UI is friendlier for a non-DevOps owner.
- Avoid GoDaddy — markup + aggressive upsells.

**Once bought, this unblocks:** Resend (Option A — real email delivery), `grievance@your-domain` address (currently `grievance@[YOUR-DOMAIN]` placeholder), professional sender-domain reputation, custom Vercel domain (free on Hobby tier).

---

## 4. Database migrations — applied vs pending

**All migrations live at `database/migrations/`. New ones are applied via Supabase MCP `apply_migration` (assistant-applied with explicit user approval) or via `psql "$DATABASE_URL" -f <file>` (operator-applied).**

| Migration | Applied | Notes |
|---|---|---|
| `20260411_deal_centric_expansion.sql` | ✅ | Core deal model |
| `20260411_documents_and_security_alignment.sql` | ✅ | Documents + RLS |
| `20260422_deal_events.sql` | ✅ | HMAC-signed audit log |
| `20260426_ai_call_logs.sql` | ✅ | Cost guard |
| `20260428_parcel_intelligence_signature.sql` | ✅ | Snapshot HMAC signing |
| `20260430_source_document_pages_and_uav.sql` | ✅ | Source page ledger |
| `20260430_users_rls_and_summary_invoker.sql` | ✅ | Users RLS |
| `20260501_extraction_started_at.sql` | ✅ | Extraction timing |
| `20260501_master_plan_zones_unique_active.sql` | ✅ | Active zone uniqueness |
| `20260504_legal_documents_and_acceptances.sql` | ✅ | Legal docs + acceptance log |
| `20260504_login_attempts.sql` | ✅ | Per-account login throttle |
| `20260505_email_verification.sql` | ✅ | Email verification tokens |
| `20260506_user_oauth.sql` | ✅ | Google OAuth identity binding |
| `20260507_refresh_tokens.sql` | ✅ | Refresh-token grants with rotation + family revocation |
| `20260504_rls_hardening` | ✅ | RLS enabled on `login_attempts` + `refresh_token_grants` |
| `20260508_password_set_flag.sql` | ✅ | `users.password_set` boolean — distinguishes real password from OAuth-only unusable bcrypt |
| `20260509_ai_response_cache.sql` | ✅ | `ai_response_cache` table for deduplicating identical AI calls (90-day TTL) |
| `20260510_ai_artifacts_and_log_dimensions.sql` | ✅ | New `ai_artifacts` table + `language`/`doctype` columns on `ai_call_logs`. Verified post-apply: RLS on, 4 indexes, 3 policies, 2 new columns. |
| `20260511_account_closure.sql` | ✅ | `users.account_closed_at` + `users.erased_at` + sweep index. Verified post-apply: 2 new columns, 1 partial index. |
| `20260512_ai_routing_config.sql` | ✅ | `ai_routing_config` table — runtime task→provider routing. Admin-only writes via RLS. Seeded with 5 default tasks. |
| `20260513_mfa_totp.sql` | ✅ | `users.mfa_secret/enrolled_at/recovery_codes/last_used_at` + `mfa_challenges` table. Required before paying customers. |
| `20260514_pgvector_document_embeddings.sql` | ✅ | `CREATE EXTENSION vector` + `document_embeddings` table with HNSW cosine index, RLS by org. Foundation for semantic search. |

**No migration is currently pending application.** When the next PR adds one, it surfaces here.

### Scheduled crons (Vercel)

| Path | Schedule (UTC) | What it does |
|---|---|---|
| `/api/fx/refresh/daily` | 03:05 | Refreshes USD↔INR FX rates |
| `/api/cron/parcel-cache-sweep/daily` | 03:20 | Purges KGIS/OSM cache, reports stale parcel snapshots |
| `/api/cron/retention-sweep/daily` | 03:35 | Enforces DPDP §8(7) retention: AI cache expiry, refresh-token forensic window, login-attempts cleanup, AI call logs > 12 months, **erasure of accounts past 90-day grace window** |

All cron endpoints require `Authorization: Bearer ${CRON_SECRET}` (set in Vercel env). 503s if `CRON_SECRET` is missing — never silently allows.

### Known Security Advisor false positive

**`public.spatial_ref_sys` — "RLS Disabled in Public"** — this is a PostGIS extension table owned by the database superuser. Neither Supabase nor the service role can enable RLS on it. It contains only coordinate-system reference data (no PII, no user data, read-only). This warning will persist in the Security Advisor permanently and can be safely ignored. The two real tables (`login_attempts`, `refresh_token_grants`) are now protected.

---

## 5. APIs and external services

### 5.1 Currently in use

| Service | Purpose | Tier | Auth surface |
|---|---|---|---|
| Supabase | Postgres + storage + signed URLs | Free | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Vercel | Hosting + serverless API + blob storage | Hobby | `BLOB_READ_WRITE_TOKEN` |
| Anthropic Claude | Reasoning, narrative synthesis, IC memo | Pay-as-you-go | `ANTHROPIC_API_KEY` |
| Google Gemini | OCR, document extraction | Pay-as-you-go | `GEMINI_API_KEY` |
| OpenAI | Embeddings (future Tier 4.1) + optional reasoning fallback | Pay-as-you-go | `OPENAI_API_KEY` |
| Google Identity Services | Federated sign-in | Free | `GOOGLE_OAUTH_CLIENT_ID` |
| Open-Meteo | Weather (used in some deal contexts) | Free | None (open API) |
| OpenStreetMap | Map tiles | Free | None (ODbL) |
| ArcGIS server | Satellite map tiles | Free | None |

### 5.2 Pending integration

| Service | When to add | Blockers |
|---|---|---|
| **Resend** (transactional email) | When you have a domain | Domain purchase + DNS records |
| **Bhashini API** (Indic translation, govt-of-India) | Phase 5 NLP improvements | None blocking; pragmatic to add when Indic-only docs cause Gemini extraction quality dips |
| **HaveIBeenPwned** Passwords | ✅ Already used (k-anonymity API, no key) | — |

### 5.3 Permanently NOT integrating (manual blockers — see TODO_DATA.md)

These have no usable public API or are explicitly disallowed in REDIP's T&C §5:

- **Bhoomi** (Karnataka land records) — manual upload only
- **Kaveri** (sub-registrar EC) — manual upload only
- **K-RERA** project verification — manual upload only
- **BBMP / BDA** approval status portals — manual upload only
- **K-GIS** — manual GeoJSON upload only

---

## 6. Routine / ongoing operator tasks

### 6.1 Per-session

- [ ] At the end of every session: append to `SESSION_LOG.md` (the assistant does this, but check it landed).

### 6.2 Weekly (5–10 min)

- [ ] Check Vercel logs for `verification_email_dispatched` lines (until Resend is wired) — these are emails the system "sent" but logged instead.
- [ ] Skim Anthropic + Google AI billing dashboards. Cost guard caps each org/day, but a runaway prompt loop will still show up.
- [ ] If you have any pending PR you didn't merge: review and either merge or close.

### 6.3 Monthly

- [ ] Run `cd backend && npm audit` and `cd frontend && npm audit`. Patch high/critical. Audit gate is part of CI but advisories sometimes appear between deploys.
- [ ] Confirm Supabase auto-pause hasn't fired (check at https://supabase.com/dashboard).
- [ ] Verify the daily FX-refresh cron and parcel-cache-sweep cron are firing — they're configured in `vercel.json`. Check Vercel → Functions → Cron Jobs.
- [ ] Review backups: Supabase Free = 7-day rolling. If on Pro, take a manual snapshot before any DDL session.

### 6.4 Quarterly

- [ ] Restore the latest Supabase backup to a fresh project; run smoke tests; document outcome. (Backups exist; recovery is unverified until tested.)
- [ ] Rotate `JWT_SECRET`, `DEAL_EVENTS_HMAC_KEY`, `PARCEL_SIGNING_SECRET`. Each rotation invalidates prior signatures — coordinate with verification routes (currently no rotation tooling exists; this is a known Phase 2.5 gap).
- [ ] Read the latest [DPDP Act notifications](https://www.meity.gov.in/) for any "Significant Data Fiduciary" classification updates that might apply to REDIP.
- [ ] Re-read [TODO_LEGAL.md](TODO_LEGAL.md) to make sure UI copy still matches stated boundaries.

### 6.5 Code-cleanup checkpoints

These exist as scheduled-task signals; the assistant typically opens cleanup PRs:

- [ ] Remove `TODO`/`FIXME` markers older than 90 days that have stopped being load-bearing.
- [ ] Sweep stale feature flags after a feature has been live 30 days without complaints.
- [ ] Quarterly: review the seven feel-check questions in `docs/FRONTEND_GUIDELINES.md` §12 against the current UI.

---

## 7. Future tasks — Phase 2 onwards

Sourced from this session's plan + earlier session logs. Sequenced by impact.

### Phase 2 — Auth hardening (in progress)
- [x] PR #131–#134 — login throttle + HIBP password breach check
- [x] PR #135 — security headers (CSP enforcing, HSTS, X-Frame-Options, etc.)
- [x] PR #138 — email verification (token + mailer + UI)
- [x] PR #139 — Google sign-in via raw OIDC
- [x] PR #140 — Privacy v2 disclosure
- [x] PR #142 — refresh-token rotation + httpOnly cookies (with reuse-detection family revocation)
- [x] PR #144 — re-acceptance modal for legal-doc version bumps (existing users no longer grandfathered)
- [x] PR #145 — set-first-password for OAuth-only users (Settings → Security)
- [ ] **Drop legacy `Authorization` header path + body `data.token`** (cleanup PR ~2 release cycles after #142, once every active session has rolled over to cookies — target ~early June 2026)
- [ ] MFA / TOTP (lowest urgency; opt-in)
- [ ] Email verification *enforcement* — currently the banner reminds; future PR can require verification before sensitive actions

### Phase 3 — AI hardening
- [x] Retry/fallback chain — already in `extraction.service.js::callExtractionWithFallback` (Gemini retries → Claude fallback)
- [x] PR #146 — Prompt versioning (`prompt_version` + `prompt_sha256` in `ai_call_logs.metadata`)
- [x] PR #146 — Response cache (`ai_response_cache`, 90d TTL, opt-in via `aiRouter.runAI` cache arg)
- [ ] Daily cron to call `aiResponseCache.purgeExpired()` so the table doesn't grow indefinitely (small follow-up; can be added to `vercel.json` next to existing fx-refresh + parcel-cache-sweep crons)
- [ ] Vercel AI SDK migration (S16 from older roadmap)
- [ ] OpenTelemetry tracing per `routeAi` call
- [ ] Zod validation at provider boundary
- [ ] Streaming for long Claude calls (IC memo)
- [ ] Generic retry on Claude reasoning calls (today only extraction retries; reasoning calls one-shot)

### Phase 4 — Data layer
- [ ] `pgvector` enable + Voyage / OpenAI embeddings for cross-document similarity
- [ ] Field-level PII encryption (`pgcrypto` for users.email, users.phone)
- [ ] Erasure cron (DPDP §8(7) — currently disclosed, not enforced)
- [ ] Field-level access log (who read which sensitive document, when)
- [ ] Quarterly backup-restore drill (see §6.4)

### Phase 5 — Indic NLP
- [ ] Bhashini API adapter for Kannada/Hindi pre-translation
- [ ] IndicTrans2 self-host fallback (only if Bhashini SLA inadequate)
- [ ] Tesseract OCR fallback for Gemini outages
- [ ] pgvector-backed clause similarity ("find every encumbrance clause like this one")

### Phase 6 — Deferred / not recommended yet
- [ ] ML / RL — *do not pursue without ≥500 labelled samples per class.* See plan §11 for full rationale.
- [ ] SAML SSO via WorkOS — *do not build until first enterprise prospect requests it.* Speculative work otherwise.
- [ ] Microsoft OAuth — *do not build until a user with M365-only sign-on asks.* Same pattern as Google.

---

## 8. Cleanup inventory

Files / directories that survived from earlier explorations and should be reviewed:

- [ ] `scripts/extract-pdf-text.py`, `scripts/generate-rmp-ocr-sql.py`, `scripts/ocr-rmp-provisional.py`, `scripts/pdf-text-coverage.py`, `scripts/seed-masterplan-corpus.js` — untracked scripts. Either commit or delete.
- [ ] `.claude/worktrees/` — should be in `.gitignore` (currently untracked, harmless)
- [ ] Anything in `frontend/dist/` — build output; shouldn't be in OneDrive sync (see §2 NEXT)

---

## 9. Suggestions and feedback (assistant's standing recommendations)

These are calibrated to REDIP specifically — not generic best-practice. They survive across sessions until you act on them or explicitly mark "won't do".

### 9.1 Architecture / sequencing
- **Token storage is now cookie-based** (PR #142). The legacy `Authorization` header path and `data.token` response body are kept for back-compat through ~2 release cycles, then cut. Schedule the cleanup PR after the post-#142 deploy has been live ≥4 weeks (every old session will have rolled over by then).
- **Resist adopting Supabase Auth.** REDIP's `users` table is the master and every other system (legal acceptance, org membership, deal events) is built around it. Adopting Supabase Auth means a parallel `auth.users` table with trigger sync — pure liability for a solo-founder MVP.
- **Resist adopting SAML SSO before a first enterprise prospect asks.** Procurement teams hand you metadata XML on day one of an enterprise pilot — that's the right moment to build it, via WorkOS or Auth0 (NOT Supabase Auth — vendor coupling).
- **The "set first password" flow for OAuth-only users is the next sequenced item.** They currently have a 64-byte random bcrypt they cannot possibly know. Without this flow, an OAuth-only user is locked out if Google ever revokes their account or they delete the linked Google account.

### 9.2 Compliance / legal
- **Lawyer red-line is the bottleneck before user #2.** Every other security item in flight (refresh tokens, MFA, etc.) is moot if the legal docs aren't signed off. Treat that engagement as the critical path.
- **The grievance officer is currently the founder.** Acceptable while solo. The day you cross 100 users or take any external funding, separate the role — investors will ask.
- **The shortcut columns `users.terms_accepted_at` / `privacy_accepted_at` need a weekly cron** to assert they reconcile against `user_legal_acceptances`. Cheap insurance against drift.

### 9.3 Code hygiene
- **Move the project off OneDrive.** Recurring 320-file delete prompts after every `npm run build` is friction that compounds. `C:\dev\REDIP` is the right home; git is your backup.
- **The TODO files have started fragmenting.** This handbook is the index, not a replacement. When something's done, mark it here and add a one-line entry to SESSION_LOG. Don't sprinkle "DONE" markers across four files.
- **DRAFT markers in `docs/legal/*.md` should not get more comprehensive without a lawyer first.** Adding more clauses without legal review just gives the lawyer more text to red-line.

### 9.4 Cost guardrails
- **Set hard cost caps NOW before traffic exists**, not after. Anthropic + Google both let you set monthly spending caps in the console. $200/month each is plenty for solo-founder use; pulls a brake before a runaway loop bills $5,000.
- **Vercel Hobby's "no commercial use" clause is the compliance landmine.** The day you ask anyone to pay for REDIP, upgrade to Pro the same hour. Vercel actively enforces this.

### 9.5 What I'd skip even if you ask for it
- **Self-hosted models (Llama, Mistral) for "data sovereignty".** The infra cost and quality drop are not worth it until DPDP §16 actually restricts cross-border transfers (no such restriction is currently in force).
- **A blockchain audit trail.** HMAC-signed `deal_events` already gives investor-grade tamper-evidence; blockchain adds complexity for marginal cred.
- **GraphQL replacement of REST.** REDIP's read-models are server-composed today; the JSON shapes are stable. GraphQL would be a refactor without a payoff.

---

## 10. How to use this file

**At the start of every session:**
1. Read this file.
2. Cross-reference §2 with what the current task is.
3. If the task adds an operator action, append to §2 and §4 / §5 / §6 as appropriate.

**At the end of every session:**
1. Mark anything completed with ✅ + date.
2. Add new pending items.
3. Re-summarise §1 if the live status changed.
4. Append the date to "Last refreshed" at the top.

**When in doubt:** SESSION_LOG.md is the chronological history; this file is the cross-section view. Both should agree.
