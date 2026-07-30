# Acureal — Multi-Tenancy, Roles & Organization Onboarding Plan

_Authored 2026-06-02. Grounded entirely in the live Supabase production database (`niamgjbxxgmmffggumvj`, ap-south-1, Postgres 17) and the current `master`/branch source. No assumptions — every claim below was verified against the real schema, real RLS policies, and real source files._

---

## 0. TL;DR (the one-paragraph version)

Acureal is **already a multi-tenant, role-isolated platform** — not a single-admin app. It has organizations, per-organization roles (`owner / admin / editor / viewer`), invitations, FORCED Row-Level Security on 49 tenant tables, a platform-operator (super-admin) concept gated by an email allowlist, a three-tier data model (org-private / platform-shared reference / cross-org deal-share), per-org AI cost caps, and document access logging. **The thing that is actually missing — and the thing your question is really about — is _domain-based onboarding_: a way for everyone at one company to land in one shared workspace with a sensible role, instead of each person creating a lonely solo workspace.** That, plus a Team-management UI and an org switcher, is the core of this plan. A short security/ledger-hygiene pass comes first.

---

## 1. Verified current state (what you already have)

### 1.1 Identity & tenancy — a clean two-tier model

| Layer | Table | What it is | Verified facts |
|---|---|---|---|
| **Global identity** | `users` | One row per human. `id, email, name, phone, is_active, default_organization_id, password_set, oauth_provider, mfa_enrolled_at`, legacy `role`. **No `organization_id`** — tenancy is via membership, not on the user row. | 6 users live |
| **Membership (tenancy)** | `organization_members` | The (user × organization) join. `role organization_role`, `is_active`, `invited_by`, `joined_at`, `UNIQUE(org,user)`. A user can belong to **many** orgs with **different** roles. | 6 memberships |
| **Tenant** | `organizations` | `id, name, slug (unique), created_by`. **No domain column** (this is the gap). | 4 orgs live |
| **Pending access** | `organization_invitations` | `email, role, token, expires_at (7d), accepted_at/by`, `UNIQUE(org,email)`. Owner role cannot be invited. | — |

The **active organization for a request** is resolved in `backend/src/services/organization.service.js → hydrateUserAuthContext()`:
`x-organization-id` header → else `users.default_organization_id` → else first active membership. The hydrated `req.user.role` is the **active-org membership role** (`buildAuthUser`, line 102), so authorization is correctly per-org, not global. The legacy `users.role` column is now essentially vestigial (kept only as a seed/fallback).

### 1.2 Roles — a real hierarchy, enforced both ends

Defined in `backend/src/constants/roles.js` and mirrored in `frontend/src/utils/roles.js`:

```
owner (4)  >  admin (3)  >  editor (2)  >  viewer (1)        ENUM organization_role
```
- `analyst` is a legacy alias for `editor`.
- Backend enforcement: `requireRole(...)` in `backend/src/middleware/auth.js` (hierarchical via `roleSatisfies`), with `requireAdmin` / `requireAdminOrAnalyst` helpers.
- Frontend enforcement: `roleSatisfies()` + route guards.
- Member management already exists: `inviteOrganizationMember` (assigns admin/editor/viewer), `listOrganizationMembers`, `setOrganizationMemberStatus` (cannot deactivate yourself). **Missing: a role-_change_ endpoint** (you can invite/deactivate, but not promote/demote an existing member via API).

### 1.3 Platform operator (super-admin) — that's you, and it's an email allowlist (not a DB role)

Two independent gates, both defaulting to `rachitj579@gmail.com`:
- **Backend** `backend/src/utils/platformOrg.js` — `PLATFORM_ADMIN_EMAILS` env → resolves the *platform org* whose verified comps are shared to every workspace (read-only).
- **Frontend** `frontend/src/utils/permissions.js` — `isPlatformAdmin(user)` reads the server-computed `is_platform_admin` fact from `/auth/me` (persisted `users.is_platform_admin` flag OR backend break-glass allowlist; shipped 2026-07-23). The browser holds no operator list. Shows/hides the **Admin** nav group and the `RequirePlatformAdmin` route guard.

The Admin nav group (operator-only, from `frontend/src/components/layout/Sidebar.jsx`): **Master Plan · Parcel Intelligence · Comps Review Queue · AI Usage & Cost · A/B Evaluations · Learning Signals · Audit Trail**. Everyone else sees only the five primary items + Settings.

> **Key distinction to lock in:** "Platform Admin / Operator" (you, runs Acureal, curates shared data across all orgs) is a **different axis** from "Organization Owner/Admin" (a customer who runs their own workspace). Today they're conflated in the word "admin." The plan keeps them cleanly separate.

### 1.4 Data isolation — three tiers, all real and enforced

**Tier A — Org-private** (49 tables carry `organization_id`, under `FORCE ROW LEVEL SECURITY`, policy `USING (organization_id = current_organization_id())`): `deals, properties, documents, document_extractions, financials, financial_scenarios, waterfall_distributions, dd_items, approval_items, risk_flags, activities, deal_stage_history, deal_audit_log, deal_events, intelligence_briefs (own), market_notes (own), investor_packages, export_events, document_access_log, ai_call_logs`, and all the per-deal analytics tables. Each org sees only its own rows.

**Tier B — Platform-shared verified reference** (read-all to every org, writes operator-only): the `regulatory_data` schema (21 tables — master-plan zones, planning districts, FAR rules, BBMP UAV/guidance-value, Karnataka RERA, official-PDF evidence) and the city-level market benchmark tables (`office/retail/industrial/hospitality/residential/niche_market_benchmarks`, `market_macro_kpis`, `micro_market_benchmarks`). The `regulatory_data` reference uses `org_id IS NULL OR org_id = current_organization_id()` so `org_id = NULL` means "global." Migration `20260622_globalize_masterplan_reference.sql` deliberately globalized the curated RMP/zoning reference **while keeping each org's own uploaded deal documents private** (`source_kind = 'user_upload'` stays org-scoped).

**Tier C — Cross-org deal sharing**: `deal_shares (deal_id, shared_with=user)`. `backend/src/utils/dealVisibility.js → buildVisibleDealCondition()` = `own-org OR shared-with-me`. Lets you share one specific deal with one specific external user (e.g., a co-investor) without exposing the rest of your workspace.

**Platform comps catalog**: your (platform org's) verified comps are unioned into every org's comps view at the app layer (`platformOrg.js`) — read-only — so all customers benefit from the curated Bengaluru comp set while their own comps stay private.

### 1.5 Security posture — mature, and verified clean

- **RLS is FORCED** and the app _also_ filters every query by org (`backend/src/config/database.js → applyRequestContext` sets `app.current_user_id` + `app.current_organization_id` per request via `set_config`). Defense in depth: even though the Node backend connects as a `BYPASSRLS` role, it never relies on that alone.
- A genuine historical cross-tenant SELECT leak (permissive `*_select_all USING(true)` policies that the Supabase Data API could exploit) was found and closed in `20260623_fix_rls_cross_tenant_select.sql`, **and a CI guard added** (`scripts/check-permissive-rls.js`). **I verified against live `pg_policies`: none of `deals/properties/documents/financials/comps/risk_flags/dd_items/approval_items/activities_select_all` exist in production.** The hole is closed.
- Remaining `USING(true)` SELECT policies in prod are all on **intentionally** shared reference/config tables (city benchmarks, master-plan zones, RERA, planning districts, `feature_flag_cohorts`, `geocode_cache`, `ai_routing_config`) — by design.
- **Per-org AI spend cap** (`backend/src/lib/costGuard.js`, `AI_DAILY_COST_CAP_USD`, calendar-day UTC, scoped per organization) and **document access logging** (`document_access_log`, append-only) are live.

### 1.6 The actual problem, visible in your live data

| Organization | Members | Roles |
|---|---|---|
| Default Workspace | 3 | owner, editor |
| Rahul Jose's Workspace | 1 | owner |
| Adit's Workspace | 1 | owner |
| Rachit Jain's Workspace | 1 | owner |

Total: **4 owners, 2 editors.** When Rahul and Adit registered, the current logic (`createWorkspaceForUser`) gave each a **solo workspace as owner** instead of joining them into one company org. Your team is scattered across four workspaces. **This is the precise gap domain-based onboarding closes.**

---

## 2. Gap analysis (what's missing for a true multi-org product)

| # | Gap | Today | Needed |
|---|---|---|---|
| G1 | **Domain-based onboarding** | Every self-registration → a new solo workspace (owner). | A company's verified email domain routes its people into one shared org with a default role. |
| G2 | **Role changes** | Invite + deactivate only. | Promote/demote existing members (API + UI). |
| G3 | **Team-management UI** | None (only backend functions). | A "Team / Members" settings page: roster, role dropdowns, invites, pending requests, domain settings. |
| G4 | **Org switcher** | `req.user.organizations[]` is returned but there's no UI to switch. | A workspace switcher in the shell (users can be in multiple orgs). |
| G5 | **Org-scoped operator surfaces** | Audit Trail & AI Usage are operator-only (cross-org). | An **org-scoped** Audit Trail + Usage view for organization owners/admins. |
| G6 | **Per-role UI states** | Role gates nav; in-deal actions aren't consistently role-gated in the UI. | Viewers see read-only; editors edit; admins manage/delete/share. |
| G7 | **Plan/seat tiers** | All orgs identical. | Optional plan tiers (free/pro/enterprise) gating features + seats via existing `feature_flag_cohorts`. |
| G8 | **Migration ledger drift** | `supabase_migrations` ledger trails the real schema (later migrations applied out-of-band). | Reconcile to one runner so no RLS migration is ever silently unapplied. |
| G9 | **Read-all market tables that also carry `org_id`** | `market_transactions`, public `micro_market_benchmarks` are read-all but org-writable. | Confirm they hold only curated reference; otherwise split curated (`org_id NULL`) from org-private and scope the SELECT policy. |

---

## 3. Target model

### 3.1 Two axes of access (keep them separate)

```
            ┌───────────────────────────────────────────────┐
            │  AXIS 1 — Platform role (who runs Acureal)        │
            │  • Platform Operator  → you (email allowlist)   │
            │  • Everyone else      → customer                │
            └───────────────────────────────────────────────┘
            ┌───────────────────────────────────────────────┐
            │  AXIS 2 — Organization role (within a workspace)│
            │  owner > admin > editor > viewer                │
            └───────────────────────────────────────────────┘
```
A platform operator is *also* an owner of their own org. A customer org owner has **zero** visibility into other orgs or into the operator's curation surfaces.

### 3.2 Role × capability matrix (organization axis)

| Capability | viewer | editor | admin | owner |
|---|:--:|:--:|:--:|:--:|
| View deals, docs, financials, risk, DD, market, comps | ✅ | ✅ | ✅ | ✅ |
| Generate / download exports (DOCX/PPTX/XLSX/PDF) | ✅\* | ✅ | ✅ | ✅ |
| Create/edit deals, upload docs, run AI extraction | — | ✅ | ✅ | ✅ |
| Edit financial model, DD, approvals, risk flags, comps, market notes | — | ✅ | ✅ | ✅ |
| Delete a deal · share a deal externally (`deal_shares`) | — | — | ✅ | ✅ |
| Invite members · change roles (≤ own level) · deactivate members | — | — | ✅ | ✅ |
| Org settings: domain, benchmark opt-out, branding | — | — | ✅ | ✅ |
| Org-scoped Audit Trail + AI Usage | — | — | ✅ | ✅ |
| Transfer ownership · delete org · billing/seats | — | — | — | ✅ |

\* viewer export is a policy choice — recommend **on** (read-only consumers often need the IC memo) but gate behind a per-org toggle.

### 3.3 Data-visibility matrix

| Data | Tier | Who can read | Who can write |
|---|---|---|---|
| Deals, docs, extraction, financials, DD, approvals, risk, activities, exports, own comps, own market notes, investor packages | **A — org-private** | members of that org (+ `deal_shares` grantees) | editor+ in that org |
| Master plan / zoning / FAR / guidance-value / RERA / planning districts / official evidence | **B — shared reference** | every org (read) | platform operator only |
| City market benchmarks (office/retail/industrial/hospitality/residential/niche/macro/micro) | **B — shared reference** | every org (read) | platform operator only |
| Platform comps catalog | **B — shared read (app-layer union)** | every org (read) | platform operator only |
| A single deal shared to an outside user | **C — cross-org grant** | the specific grantee | grantor admin/owner |

**Governance rule (write it into CONTRIBUTING):** every new tenant table must (1) carry `organization_id NOT NULL DEFAULT current_organization_id()`, (2) `ENABLE` + `FORCE ROW LEVEL SECURITY`, (3) get an `_org_scope` policy, and (4) pass `scripts/check-permissive-rls.js` in CI. Reference tables go in `regulatory_data` (or carry `org_id NULL` semantics) with read-all + operator-only writes.

---

## 4. Domain-based onboarding (the core net-new feature)

### 4.1 Schema

```sql
CREATE TABLE organization_domains (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain                 text NOT NULL,                         -- 'acme.com', lowercased, no '@'
  verification_status    text NOT NULL DEFAULT 'pending'
                           CHECK (verification_status IN ('pending','verified','rejected')),
  verification_method    text,                                  -- 'dns_txt' | 'email_claim' | 'operator'
  verification_token     text,
  verified_at            timestamptz,
  is_primary             boolean NOT NULL DEFAULT false,
  auto_join              boolean NOT NULL DEFAULT true,          -- new same-domain signups auto-join
  default_role           organization_role NOT NULL DEFAULT 'viewer',
  require_admin_approval  boolean NOT NULL DEFAULT false,         -- if true, join is 'pending' until approved
  created_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now(),
  UNIQUE (domain)                                               -- a verified domain → exactly ONE org
);
-- RLS: org members read their own rows; only the platform operator may flip
-- verification_status to 'verified' (prevents an org claiming a domain it
-- doesn't control). auto_join/default_role editable by org admin+.
```

Plus a small reference table `public_email_providers(domain text primary key)` seeded with `gmail.com, googlemail.com, outlook.com, hotmail.com, yahoo.com, proton.me, icloud.com, …` — these can **never** be claimed as an org domain (personal-email signups always get a personal workspace).

### 4.2 Registration / login decision tree (extends `auth.service.register`)

```
register(email = local@D, password|google, [invitationToken], [organizationName]):
 1. invitationToken present?            → consumeInvitation (EXISTS today). Role = invite role.
 2. D ∈ public_email_providers?         → createWorkspaceForUser, role = owner (today's behaviour).
 3. verified organization_domains[D]
       with auto_join = true?           → join that org.
                                           role = default_role
                                           (or membership.is_active = false +
                                            'pending' if require_admin_approval)
                                           default_organization_id = that org.
 4. otherwise (first corporate signup
    for domain D)                       → createWorkspaceForUser (role = owner)
                                         + INSERT organization_domains(D, status='verified',
                                           verification_method='email_claim', auto_join=true,
                                           default_role = <org-chosen default>).
```

Net effect — exactly your intent, made safe:
- **The first person from a company becomes the owner** and their org auto-claims the domain.
- **Everyone who signs up later with that domain auto-joins the same org** with the org's chosen default role.
- Free/personal emails keep getting a personal workspace (no accidental cross-company merges).

### 4.3 The "everyone with the domain is admin" decision — flagged

Making **every** domain-joiner an `admin` means any new hire (or anyone who guesses the email pattern) can delete deals, change roles, and read everything. That's a security anti-pattern. Recommended default: **first user = owner, subsequent domain-joiners = `editor`** (full deal work, no org control), with admins promoting trusted people. Offer `viewer` if you want read-only-until-approved. Keep it a per-org setting (`organization_domains.default_role`) so you _can_ choose `admin` per org if you really want it — but it's opt-in, not the default. Pair with `require_admin_approval = true` for sensitive orgs (new joiner sits in a pending queue the owner approves).

### 4.4 Verification methods (pick per customer)

- **`operator`** (simplest for enterprise sales): you verify a customer's domain from the operator console when you provision them. Zero friction for the customer.
- **`email_claim`** (self-serve): first corporate signup auto-claims; good enough for SMB.
- **`dns_txt`** (strongest): customer adds a TXT record; needed before you'd ever auto-assign elevated roles. Recommended before enabling `default_role = admin`.

### 4.5 One-time reconciliation of your existing fragmentation

After the domain feature ships, a guided merge: claim your company domain for one canonical org, then move Rahul's and Adit's memberships (and any deals/docs they created — a careful `organization_id` re-parenting migration, audit-logged) into it, or invite them and archive the empty solo workspaces. This is a data migration, not just a flag flip — plan it as its own reviewed PR with a dry-run count first.

---

## 5. Role assignment & Team management

### 5.1 New endpoints

- `PATCH /api/organization/members/:userId/role` (admin+; cannot set a role above your own; cannot demote the last owner). Audit-logged.
- `GET/POST/DELETE /api/organization/domains` (admin+ for `auto_join`/`default_role`; operator-only for `verification_status='verified'`).
- `GET /api/organization/join-requests` + `POST …/:id/approve|reject` (for `require_admin_approval`).
- Org-scoped `GET /api/organization/audit` and `GET /api/organization/usage` (reuse existing audit/usage services with the org filter already present).

### 5.2 "Team" settings page (new) — `frontend/src/pages/TeamPage.jsx`

- **Members table**: name · email · role dropdown (disabled above your own level) · status · joined. Inline role change with optimistic update + count-up of seat usage.
- **Invite**: email + role select → `inviteOrganizationMember` (exists). Show pending invites with expiry; resend/revoke.
- **Domain card**: the org's verified domain(s), `auto_join` toggle, `default_role` select, `require_admin_approval` toggle, "Add domain" with verification instructions.
- **Pending join requests** (when approval required): approve/reject.
- All states per `docs/FRONTEND_GUIDELINES.md` (skeletons, status-pill cross-fades, focus-visible, reduced-motion, WCAG AA).

### 5.3 Workspace switcher (new) — shell header

Because a user can belong to many orgs (`req.user.organizations[]` already returns them), add a switcher in the sidebar header: current workspace + role badge, dropdown to switch (sets `x-organization-id`, persists `default_organization_id`, refetches). Empty/solo state nudges "Join your company workspace."

### 5.4 Operator console (you)

Keep the email-allowlist gate, but add an **Organizations** admin surface (operator-only): list orgs, seats, plan, domain status; provision a new org + assign its owner + verify its domain; impersonate-for-support (read-only, heavily audit-logged) — optional, later.

---

## 6. Plan / seat tiers (optional, Phase 4)

Add `organizations.plan text` (`free|pro|enterprise`) and `seats int`. Gate features through the **existing** `feature_flag_cohorts` infrastructure keyed by org (e.g., export formats, AI synthesis volume, semantic search, investor packages, SSO). Enterprise tier unlocks **SAML/SSO** (via the existing Google OAuth seam, extended) and optionally a **dedicated-isolation** tier (separate Postgres schema or project) for customers whose diligence requires physical isolation — relevant given enterprise investors are in your pipeline. Until then, shared-schema + FORCED RLS is the correct, standard architecture for your scale.

---

## 7. Security & hygiene pass (do this first — small, high-trust)

1. **Reconcile the migration ledger.** The live `supabase_migrations` table trails the real schema (later migrations applied out-of-band). Adopt one runner (Supabase CLI), backfill the ledger, and make CI fail if a migration file isn't applied — so an RLS migration can never silently miss production.
2. **Audit the read-all market tables that also carry `org_id`** (`market_transactions`, public `micro_market_benchmarks`). Confirm they contain only curated platform reference. If an org can write private rows there, split curated (`org_id NULL`, read-all) from org-private (`org_id`, org-scoped) — same fix already applied to `market_notes`.
3. **Clear the advisor ERROR** on `public.spatial_ref_sys` (PostGIS EPSG reference — benign): apply the guarded `ENABLE RLS + read-all` tail from `20260623`.
4. **WARN cleanups** (low priority, with care): set `search_path` on `bbmp_street_index_touch_updated_at`, `touch_user_preferences_updated_at`, `_mig_load`; consider moving `postgis/pg_trgm/vector` out of `public` (test first — can break references).
5. **Document the 5 RLS-enabled-no-policy tables** (`ai_response_cache, email_verification_tokens, login_attempts, mfa_challenges, refresh_token_grants`) as deliberate deny-by-default (backend uses the bypass role; Data API gets nothing). Add explicit deny policies for clarity.
6. **Confirm `scripts/check-permissive-rls.js` runs in CI** on every PR (it exists; make it blocking).

---

## 8. Phased roadmap (PR-sized; ship fully, don't auto-merge to master)

| Phase | PRs | Outcome | Risk |
|---|---|---|---|
| **0 — Security & ledger** | 1–2 | Ledger reconciled; market read-all reviewed; advisor ERROR cleared; CI guard blocking. | Low |
| **1 — Domain onboarding core** | 2 | `organization_domains` + `public_email_providers`; registration decision tree; first-corp-signup claims domain; same-domain auto-join with safe default role. | Med (auth path — needs tests + dry-run) |
| **2 — Team UI + org switcher** | 2–3 | Team page (roster, role change, invites, domain card, approvals); workspace switcher; role-change + domain + join-request endpoints. | Med |
| **3 — Per-role UI + org audit/usage** | 2 | Viewer read-only across deal tabs; org-scoped Audit Trail + AI Usage for owners/admins. | Low–Med |
| **4 — Plan tiers / enterprise** | later | Plans + seats via feature flags; SSO/SAML; optional dedicated isolation. | Med–High |
| **1.5 — Fragmentation merge** | 1 | One-time, audited migration to consolidate the solo workspaces into the company org. | Med (data move — dry-run first) |

---

## 9. Decisions — LOCKED 2026-06-02 (operator)

1. **How do other organizations get in?** → **Domain-verified self-serve.** Anyone may sign up; people sharing a verified company email domain auto-group into one shared org. (Implements §4.2 branch 3–4.)
2. **Default role for domain auto-joiners?** → **`editor`.** First corporate signup = `owner`; everyone after = `editor` (full deal work, no people-management or workspace deletion). `admin` remains opt-in per org, never the default (see §4.3).
3. **Verification strictness?** → Start with **email-claim self-serve** for SMB; reserve **DNS-TXT / operator-verified** before ever raising a domain's `default_role` above `editor`. (Free/personal email providers can never be claimed — §4.1.)
4. **Plan/seat tiers?** → **Later.** RBAC + onboarding first; tiers are Phase 4.
5. **Immediate next action?** → **Deliver this plan for review only — no code yet.** When greenlit, start with Phase 1 (domain onboarding) then Phase 2 (Team page + org switcher), each as a separate reviewed PR, not auto-merged to `master`.

---

## 10. Appendix — files & tables this plan touches

**Backend:** `services/auth.service.js` (register decision tree), `services/organization.service.js` (domain join, role change, approvals), new `services/organizationDomain.service.js`, `routes/organization.routes.js` (+members/role, +domains, +join-requests, +audit/usage), `constants/roles.js` (unchanged), `middleware/auth.js` (unchanged).
**DB (new migrations):** `organization_domains`, `public_email_providers`, `organizations.plan/seats` (Phase 4), market read-all split (Phase 0), ledger backfill.
**Frontend:** new `pages/TeamPage.jsx`, workspace switcher in `components/layout/Sidebar.jsx`, role-aware states in `components/deal/*Tab.jsx`, `services/api.js` (org endpoints), `store/authStore.js` (active-org switch), `utils/permissions.js`/`utils/roles.js` (unchanged core).
**Ops:** Vercel env `PLATFORM_ADMIN_EMAILS` (backend break-glass allowlist only — `VITE_PLATFORM_ADMIN_EMAILS` is retired and should be deleted from Vercel; the operator fact is the persisted `users.is_platform_admin` flag), CI `check-permissive-rls.js` blocking, Supabase CLI as the single migration runner.
