# M1 — Make tenant isolation real at the database (RLS role flip)

**Status:** Phase 1 shipped (safe, additive). Phases 2–5 staged, not yet executed.
**Owner:** REDIP engineering + operator (Rachit) for the two live-config steps.
**Why this matters:** Today REDIP's isolation between customers is enforced by
application code (every query is scoped to the caller's organization). The
database *also* has Row-Level Security (RLS) policies for the same thing — but
the application connects using a database role (`postgres`) that is allowed to
**bypass** RLS, so at runtime those policies are a prepared second layer, not the
active gate. M1 moves the application onto a non-privileged database role so
**PostgreSQL itself rejects any cross-organization access**, independent of
application code. That is the single highest-trust change for institutional
diligence (a serious buyer's security reviewer asks exactly this question).

This document is the complete, staged, reversible plan. **Do not do a blind role
flip** — the audit below proves it would break login for every user. Each phase
is gated and independently reversible.

---

## The current true posture (measured on production 2026-07-19)

| Fact | Value |
|---|---|
| Application DB role | `postgres` |
| Role bypasses RLS? | **Yes** (`rolbypassrls = true`) |
| RLS policies defined on tenant tables? | Yes |
| FORCE RLS on core tenant tables? | Yes (`deals`, `financials`, `documents`, `dd_items`, `risk_flags`, `approval_items`, `activities`, …) |
| Live tenant boundary today | Application-layer `organization_id` scoping |
| Monitored by | System Health tenant-isolation canary (`/dashboard/admin/system-health`) — reports `db_role`, `bypasses_rls`, `fail_closed` |

The canary already reports `db_role: postgres, bypasses_rls: true` today. **It
flips to `bypasses_rls: false` the moment M1 completes** — that is the live
confirmation signal for Phase 5.

---

## Why a blind flip breaks everything — the empirical proof

Run against production in a rolled-back transaction (`BEGIN … SET LOCAL ROLE
authenticated … ROLLBACK`), simulating the app connecting as a non-bypass role:

| Scenario | memberships | user-by-id | deals | refresh-tokens | login-attempts |
|---|---|---|---|---|---|
| Non-bypass role, **no context** (the login/hydrate bootstrap condition) | **0** | **0** | **0** | **0** | **0** |

Every read returns zero (no "permission denied" — grants are fine; it is RLS).
Because login and the per-request `hydrateUserAuthContext` read `users` and
`organization_members` **before** the request's user/org context is set, a blind
flip returns empty → 403 → **login and every authenticated request break**.

The fix has three moving parts, below.

---

## Phase 1 — Additive readiness migration ✅ SHIPPED

**File:** [`database/migrations/20260731_rls_flip_readiness.sql`](../database/migrations/20260731_rls_flip_readiness.sql)

Adds six policies. Behavior-neutral today (the `postgres` role bypasses RLS, so
they do nothing until the flip); reversible; validated on prod (rolled back).

1. Permissive `FOR ALL` policies on the five RLS-enabled-but-policy-less system
   tables — `ai_response_cache`, `email_verification_tokens`, `login_attempts`,
   `mfa_challenges`, `refresh_token_grants`. None are org-scoped; their boundary
   is a per-token/per-email/per-hash application WHERE clause, and several are
   touched pre-authentication.
2. `organization_members_self_read` — lets a user read their **own** membership
   rows across orgs (the login/hydrate bootstrap), and is the enabler for the
   `organizations_member_access` EXISTS subquery.

**Validated on prod (rolled back):** after these policies, a non-bypass role read
`refresh_token_grants` (788), `email_verification_tokens` (3),
`ai_response_cache` (150), and — with the user id in context — its own single
membership and single user row, **with no cross-org leakage**.

### 🌐 Operator step — apply Phase 1 (safe; nothing changes visibly)

This is safe to apply any time before the flip. It does **not** change how the
site behaves today.

1. Open this exact web address in your browser:
   `https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new`
2. Open the migration file in GitHub (or ask me for the raw link) and **copy ALL
   the text** from `database/migrations/20260731_rls_flip_readiness.sql`.
3. Paste it into the big text box in the Supabase editor.
4. Click the green **Run** button (bottom-right).
5. Success looks like a grey bar saying **"Success. No rows returned"**.
6. Send me **"phase 1 done"**.

---

## Phase 2 — Auth-bootstrap fix (engineering; ships as normal code + one migration)

This is the careful part: the operations that run **before** a user/org context
exists. Enumerated from `backend/src/services/auth.service.js` +
`organization.service.js`:

| Operation | Location | Breaks under flip because |
|---|---|---|
| `SELECT … FROM users WHERE email=$1` | `login()` L245 | no context; `users` policies are self / org-mates only |
| `UPDATE users SET last_login_at` | `login()` L293, others | needs `id = current_user_id()` in context first |
| duplicate-email `SELECT id FROM users` | `register()` L153 | no context → cannot see the existing row |
| **`INSERT INTO users …`** | `register()` L187 | **there is no INSERT policy on `users`** |
| `createWorkspaceForUser` / `joinByVerifiedDomain` / `consumeInvitation` INSERTs | `register()` | write into `organizations` / `organization_members` pre-context |
| `findUserByOAuthIdentity` (`oauth_provider`,`oauth_subject`) | Google path A | no context |
| `findUserByEmail` | Google path B | no context |
| post-MFA `SELECT id, default_organization_id FROM users WHERE id=$1` | `completeMfaLogin()` L312 | has userId but no context set yet |

### Design (two complementary moves)

**(a) Set request context the instant identity is known.** Everything *after*
the user is identified already works via the self-policies (`users_self_read`,
`users_self_update`, `organization_members_self_read`) once the context carries
the user id. Concretely:

- In `middleware/auth.js` `authenticate`, set the request context from the
  validated `decoded.userId` (+ `x-organization-id` header) **before** calling
  `hydrateUserAuthContext`, then re-set with the resolved org after. Under the
  current bypass role this is a no-op (RLS skipped); post-flip it makes the
  per-request hydrate self-reads resolve.
- In `auth.service.js`, after credential validation, set context = `user.id`
  before `UPDATE users SET last_login_at` and before `resolveLoginAuthContext`.

**(b) SECURITY DEFINER helpers for the genuinely pre-identity operations.** These
cannot be expressed as safe policies (a `USING(true)` on `users` would leak every
user to any authenticated caller). Wrap them in functions owned by a privileged
role, with a pinned `search_path`, that the app calls in place of the direct
queries. Under bypass today they return exactly what the direct queries return;
post-flip they perform the bootstrap without opening a hole:

```sql
-- Owned by postgres; runs as owner (bypasses RLS) for ONLY these bootstrap reads.
CREATE OR REPLACE FUNCTION public.auth_find_user_for_login(p_email text)
  RETURNS SETOF public.users
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT * FROM public.users WHERE email = p_email LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.auth_find_user_for_login(text) FROM public;
GRANT EXECUTE ON FUNCTION public.auth_find_user_for_login(text) TO redip_app;
-- + auth_find_user_by_oauth(provider,subject), auth_email_exists(email),
--   and a provisioning function that performs the register INSERT chain
--   (users + workspace/membership) as owner, returning the new user id.
```

Then `auth.service.js` calls `auth_find_user_for_login` instead of the inline
`SELECT`, `findUserByOAuthIdentity`/`findUserByEmail` call their `auth_*`
equivalents, and registration routes its bootstrap INSERTs through the
provisioning function.

**Why this is safe to ship before the flip:** every change is behavior-identical
under the current bypass role, so the full existing auth test suite exercises it
unchanged, and it can ship on its own normal deploy — decoupled from the risky
config flip. **It must be tested against a real non-bypass role (Phase 4) before
Phase 5.**

---

## Phase 3 — Create the `redip_app` role (operator, in Supabase)

A dedicated **login role that cannot bypass RLS and owns nothing**, so RLS
applies to it on every table.

### 📋 Operator step — create the role

1. Open: `https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new`
2. **First, pick a long random password** (letters + numbers, ~24 chars, no
   spaces or quotes). Keep it somewhere safe — you'll paste it into Vercel in
   Phase 5. If you'd like, I can generate one for you to copy.
3. Paste the block below, **replacing `PASTE_STRONG_PASSWORD_HERE`** with the
   password from step 2:

```sql
CREATE ROLE redip_app WITH LOGIN PASSWORD 'PASTE_STRONG_PASSWORD_HERE' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT USAGE ON SCHEMA public TO redip_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO redip_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO redip_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO redip_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO redip_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO redip_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO redip_app;

-- Regulatory reference data lives in its own schema.
GRANT USAGE ON SCHEMA regulatory_data TO redip_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA regulatory_data TO redip_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA regulatory_data GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO redip_app;
```

4. Click green **Run**. Success = **"Success. No rows returned"**.
5. Send me **"role created"** (do **not** send the password in chat).

> **Engineering note / known risk to clear in Phase 4:** Supabase's transaction
> pooler (Supavisor, port 6543) must accept a **custom** role. Current Supavisor
> authenticates `role.projectref` usernames, but this MUST be confirmed on the
> Phase-4 branch before touching production. If the pooler rejects custom roles,
> the fallback is to keep `postgres` but drop its `BYPASSRLS` attribute — which
> is heavier and needs its own analysis (Supabase internals rely on it).

---

## Phase 4 — Rehearse on a throwaway Supabase branch (mandatory gate)

Never rehearse on production. Create a Supabase **branch** (an isolated copy),
apply Phases 1–3 there, point a local backend at the branch's connection string
as `redip_app`, and exercise the full matrix as the non-bypass role:

- login (password) · register (fresh workspace) · register (domain auto-join) ·
  invitation accept · Google OAuth (new + returning + bind) · MFA challenge +
  verify · token refresh + rotation · logout · a deal read/write round-trip ·
  dashboard rollups · an export.

Green on all of the above **as `redip_app`** is the gate to Phase 5. Delete the
branch afterward.

---

## Phase 5 — Flip production (operator, one Vercel setting)

Only after Phase 2 code is deployed and Phase 4 is green.

### 🌐 Operator step — point the app at the new role

1. Open: `https://vercel.com/` → your REDIP project → **Settings** →
   **Environment Variables**.
2. Find the row named **`DATABASE_URL`**. Click **⋯ → Edit**.
3. **Before changing it, copy the current value into a safe note** — that is your
   instant rollback.
4. Replace the username part so it connects as `redip_app`. The value looks like:
   `postgresql://redip_app.niamgjbxxgmmffggumvj:THE_PASSWORD@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require`
   (same host/port/database as before — only the username `redip_app…` and the
   password change). Send me the *current* value first and I'll hand you the
   exact new value to paste.
5. Click **Save**.
6. Trigger a redeploy (Vercel usually offers **"Redeploy"** after an env change),
   or push any commit.
7. **Verify:** open `https://<your-app>/dashboard/admin/system-health`. The
   tenant-isolation line must now read **`bypasses_rls: false`** and stay green.
   Then sign out and sign back in, open a deal, and confirm the dashboard loads.
8. Send me **"flip done"** with a screenshot of the System Health line.

---

## Phase 6 — Rollback (instant, if anything looks wrong)

The flip is **one setting**, so rollback is one setting:

1. Open the same Vercel `DATABASE_URL` row → **⋯ → Edit**.
2. Paste back the **old value you saved in Phase 5 step 3** (the `postgres…`
   one).
3. Click **Save** and redeploy.
4. The System Health line returns to `bypasses_rls: true`. Login/data are
   restored immediately.

Phase 1's policies and Phase 2's SECURITY DEFINER functions are additive and can
stay in place across a rollback — they are harmless under the `postgres` role.

---

## Definition of done

- [x] Phase 1 migration written + prod-validated (rolled back) + shipped to repo
- [ ] Phase 1 applied to production by operator
- [ ] Phase 2 auth-bootstrap code + SECURITY DEFINER migration merged
- [ ] Phase 3 `redip_app` role created
- [ ] Phase 4 branch rehearsal green across the full auth matrix
- [ ] Phase 5 flip — System Health canary shows `bypasses_rls: false`
- [ ] `docs/SECURITY.md` §6 updated to state DB-enforced isolation is **live**
