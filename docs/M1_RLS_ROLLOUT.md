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

## Phase 2 — Auth-bootstrap fix ✅ SHIPPED (code + migration `20260801`)

The careful part: the operations that run **before** a user/org context exists.
Shipped as two complementary moves, designed by an adversarially red-teamed
5-agent workflow and empirically validated on prod (rolled back):

**(a) Context the instant identity is known** (no SECURITY DEFINER needed):
- `middleware/auth.js` — `setRequestContext({ userId: decoded.userId })`
  **before** `hydrateUserAuthContext` (fixes EVERY authenticated request).
- `login()` — context stamped after credential validation, **before** the MFA
  check (closes a silent MFA bypass: pre-context, the enrollment self-read
  returns 0 rows → enrolled users would skip the challenge), the
  `last_login_at` UPDATE, and hydrate.
- `completeMfaLogin()` / Google path A (last-login UPDATE) / Google path B
  (the OAuth **bind** UPDATE — would otherwise silently no-op) /
  `mfa.verifyChallenge()` (recovery-code reads + consume UPDATEs).
- `emailVerification.confirmToken()` — a PUBLIC route with a `users` UPDATE;
  stamps the transaction-local context from the validated token row
  (red-team finding — an op the original enumeration missed).

**(b) Six SECURITY DEFINER helpers** (migration
[`20260801_auth_bootstrap_security_definer.sql`](../database/migrations/20260801_auth_bootstrap_security_definer.sql))
for the genuinely pre-identity ops — login-by-email, OAuth identity lookup,
MFA-challenge join, verified-domain lookup, invitation lookup, and
`auth_provision_signup` (the whole register/Google-cold-signup INSERT chain).
Red-team hardened:
- pinned `search_path`, `REVOKE FROM PUBLIC`, grants only to `redip_app`;
- user-lookup helpers **never return MFA secrets**;
- `auth_provision_signup` accepts the invitation **token** and domain
  **candidates** — never a caller-resolved org id or role — and re-validates
  the invitation internally (`FOR UPDATE`), so a SQLi sink or JS bug cannot
  mint membership in an arbitrary tenant. It is the codebase's ONE deliberate
  cross-tenant write primitive; a static migration-scan test pins all of this.

**Routing + the fail-loud switch** (`backend/src/lib/authDefiners.js`): each
call site prefers the definer function when a one-time probe finds it, else
falls back to the byte-identical original query. The probe is tri-state — a
transient probe error is NEVER cached as "absent". **`RLS_ENFORCED=true`**
(env) makes the direct fallback UNREACHABLE: probe errors and definitive
absence throw a loud 503 instead of silently running RLS-emptied queries.

> **RLS_ENFORCED contract:** set it to `true` in the SAME Vercel deploy that
> flips `DATABASE_URL` to `redip_app` (Phase 5) — never before the migration
> is applied. Unset = bypass-role operation, fallback allowed.

**Validated (2026-07-22):** full backend suite green (257 suites / 4,165 tests
— behavior-neutral under bypass). Prod probes under `SET LOCAL ROLE
authenticated` (rolled back): direct email lookup **0 rows** (RLS blocks) vs
definer **1 row**; full provisioning created user+workspace+membership; with
the Phase-1 self-read policy present the new user sees its own
user/membership/org (1/1/1) with **zero cross-user leakage**.

### 🌐 Operator step — apply Phase 2 (safe; nothing changes visibly)

Do this together with (or any time after) the Phase-1 apply above — same
routine, different file:

1. Open: `https://supabase.com/dashboard/project/niamgjbxxgmmffggumvj/sql/new`
2. Copy ALL the text from
   `database/migrations/20260801_auth_bootstrap_security_definer.sql`.
3. Paste it into the big text box, click the green **Run** button.
4. Success = **"Success. No rows returned"**.
5. Send me **"phase 2 done"**.

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
  dashboard rollups · an export · the **public email-verification confirm**
  flow (its `users` UPDATE is context-stamped from the token row).

Additional rehearsal checks (from the Phase-2 red-team):
- Re-confirm no trigger / column DEFAULT on the auth tables reads
  `current_user_id()` / `current_setting('app.current_%')` (verified clean on
  prod 2026-07-22 — only benign `updated_at` stampers — but the live DB is the
  source of truth at rehearsal time).
- Kill-switch drill: with `RLS_ENFORCED=true` and the migration deliberately
  absent on the branch, confirm auth endpoints return the loud 503 (never a
  silent empty-result login failure).
- Confirm the warm-instance probe converges: after applying the migration,
  two consecutive logins — the second must route via
  `auth_find_user_for_login` (memoized definer path).

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
5. **In the same session, add a new setting**: click **Add New** →
   Name: `RLS_ENFORCED` → Value: `true` → Save. (This makes the app fail LOUD
   instead of silently if anything about the new setup is missing — the safety
   net designed in Phase 2. It must ride in the same deploy as the
   `DATABASE_URL` change, never earlier.)
6. Click **Save**.
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
- [x] Phase 1 applied to production by operator (`20260731_rls_flip_readiness.sql`) — **2026-07-22**
- [x] Phase 2 auth-bootstrap code + SECURITY DEFINER migration merged
      (red-team hardened; 257 suites / 4,165 tests green; prod-probed under
      `SET LOCAL ROLE authenticated` — direct 0 rows vs definer 1 row; full
      provisioning chain 1/1/1 with zero cross-user leakage)
- [x] Phase 2 migration applied to production by operator (`20260801_auth_bootstrap_security_definer.sql`) — **2026-07-22**.
      Post-apply prod verification: all 6 functions present, self-read + 5
      system policies present, `auth_find_user_for_login` returns 1 complete
      row (live login lookup works); dashboard + authenticated flow healthy.
      The definer path is now the ACTIVE auth path (still under the bypass role,
      so behavior-neutral) — the flip is now purely Phases 3–5.
- [ ] Phase 3 `redip_app` role created
- [ ] Phase 4 branch rehearsal green across the full auth matrix (+ kill-switch drill)
- [ ] Phase 5 flip — `DATABASE_URL` → `redip_app` **and** `RLS_ENFORCED=true`
      in the same deploy — System Health canary shows `bypasses_rls: false`
- [ ] Phase 6 cleanup — delete the direct-query fallback branches once the flip
      is confirmed stable (they must not rot as a second live code path)
- [ ] `docs/SECURITY.md` §6 updated to state DB-enforced isolation is **live**
