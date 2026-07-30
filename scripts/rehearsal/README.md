# M1 Phase-4 rehearsal kit

Everything needed to rehearse the database role flip on a **throwaway Supabase
branch** before touching production. The kit proves, as the restricted
`redip_app` role, that: every login/signup path works, one customer can never
see another customer's data, the emergency "fail loud" switch works, and the
whole thing is reversible.

**Never run any of this against production.** The seed and the drill are
branch-only by design.

## What's in this folder

| File | What it is |
|---|---|
| `seed_security.sql` | Test data: 2 companies ("Rehearsal Alpha" and "Rehearsal Beta"), 9 users covering every account state (normal, viewer, member of both companies, MFA-enabled, Google-only, deactivated, closed, unverified), invitations in every state, session tokens in every state, and 2 deals per company. Also publishes placeholder Terms/Privacy versions — **no migration seeds those**, and without them every signup path refuses and the probe runner skips its register coverage. |
| `run-probes.js` | The automated test run. Talks to a locally running backend over HTTP exactly like the real app does, and prints ✓/✗ for every check. |
| `drop_definers.sql` | Step 1 of the kill-switch drill (branch only) — temporarily removes the special login functions to prove the app fails loudly, not silently. |

## Run order

Everything below happens on the **branch**, with a **local backend** — the
live site is never touched.

1. **Create the branch** (operator): Supabase dashboard → the Acureal project →
   **Branches** → **Create branch**. Any name (e.g. `m1-rehearsal`). Small
   metered cost on the Pro plan; deleted at the end.

2. **Create the `redip_app` role on the branch**: open the branch's SQL
   editor and run the amended Phase-3 block from
   [`docs/M1_RLS_ROLLOUT.md`](../../docs/M1_RLS_ROLLOUT.md) (Phase 3 section),
   with a throwaway password. This also confirms the block runs clean before
   production ever sees it.

3. **Apply migration `20260802`** on the branch (same SQL editor):
   `database/migrations/20260802_rls_flip_hardening.sql`. (The branch copied
   prod, so 20260731 + 20260801 are already there.)

4. **Seed the fixtures** — 🖥 in a terminal at the repo root, with the
   branch's **direct** connection string (the `postgres` one, since seeding
   needs to write across both fake companies):

   ```bash
   DATABASE_URL="<branch-postgres-connection-string>" node backend/scripts/run-sql.js scripts/rehearsal/seed_security.sql
   ```

5. **Start a local backend as `redip_app`**: edit `backend/.env` →
   set `DATABASE_URL` to the branch **pooler** URL with the
   `redip_app.<branch-ref>` username (this is also the live confirmation that
   Supabase's pooler accepts the custom role — a known Phase-3 risk). Then:

   ```bash
   powershell -ExecutionPolicy Bypass -File .\run-redip.ps1 backend
   ```

6. **Run the probes** — 🖥 second terminal:

   ```bash
   node scripts/rehearsal/run-probes.js
   ```

   Optionally set `REHEARSAL_DATABASE_URL` to the same redip_app pooler URL
   first — that enables the extra direct-database checks (role posture,
   fail-closed visibility).

7. **Kill-switch drill** (proves the loud-failure safety net):
   1. Run `drop_definers.sql` on the branch (SQL editor or `run-sql.js`).
   2. Restart the local backend with `RLS_ENFORCED=true` in `backend/.env`.
   3. `node scripts/rehearsal/run-probes.js --drill=killswitch` — it must
      show a **503 with a clear message**, never a silent login failure.
   4. Restore: re-run `database/migrations/20260802_rls_flip_hardening.sql`
      on the branch, remove `RLS_ENFORCED`, restart the backend.
   5. Re-run step 6 — everything green again.

8. **Manual checks the runner can't do** (needs a real Google account):
   Google sign-in as a new user, as a returning user, and binding Google to
   an existing email account. Do these by opening the local frontend against
   the local backend, or accept them as covered by the post-flip production
   verification (they ride the same definer functions the runner already
   exercises).

9. **Delete the branch** (operator): Supabase dashboard → Branches → delete.

## Reading the output

- Every line is `✓` (pass), `○` (skipped, with the reason), or `✗ FAIL`.
- The run exits red if ANY check fails — a single failure means **do not
  proceed to the production flip** until it's understood.
- Some fixtures are one-shot (the invitation accept, the email-verify token):
  on a second full run they report `○ skipped — consumed`. Reset the branch
  for a pristine pass.

Green across steps 6 + 7 (with step 8 noted) is the **gate to Phase 5** in
`docs/M1_RLS_ROLLOUT.md`.

## Rehearsal executed 2026-07-27 — results

Run on branch `m1-rehearsal` (ref `fasdpnaqyjcajmomooqv`), against the real
Supabase pooler as `redip_app`. **19/19 isolation checks + 4/4 kill-switch
checks passed.**

What it proved:

| Claim | Result |
|---|---|
| Supabase's pooler accepts a **custom role** (`redip_app.<ref>`) | ✅ — this was the open Phase-3 risk; now closed |
| The role genuinely cannot bypass RLS (`rolbypassrls = false`) | ✅ |
| Tenant tables return **zero rows with no request context** (fail-closed) | ✅ deals, financials, dd_items, approval_items, risk_flags |
| Alpha sees only Alpha's deals; Beta only Beta's — both directions | ✅ |
| Writing to another tenant's deal affects **0 rows** | ✅ |
| Child tables (DD / approvals / risks / financials) are org-scoped too | ✅ |
| The pre-identity auth bootstrap works via SECURITY DEFINER | ✅ |
| The **direct** `users` read is blocked by RLS (so the definer is genuinely required, not decorative) | ✅ |
| With definers absent + `RLS_ENFORCED=true`, auth fails **loud 503**, never a silent empty result | ✅ |

### The finding that justified the rehearsal

The first isolation run **failed with a real cross-tenant leak** — Alpha could
read Beta's deals. Root cause: legacy `*_select_all` policies with
`USING (true)`, which are OR'd alongside the org-scope policy and therefore
nullify it for every SELECT.

**Production was checked immediately and is clean** — it has only
`*_org_scope` + `*_shared_read`, because migration
`20260623_fix_rls_cross_tenant_select.sql` (whose entire purpose is dropping
those policies) is applied there. The leak existed only on the freshly-built
branch, where that migration had not yet run.

Two things this establishes: the harness genuinely detects cross-tenant
leakage rather than rubber-stamping, and `20260623` is **load-bearing** — any
environment missing it leaks across tenants the moment the app stops running
as a BYPASSRLS role.

### Honest limits of this run

- **Google OAuth (new / returning / bind) was not exercised** — it needs a real
  Google ID token. Still the one manual step before or just after the flip.
- Checks ran as direct SQL over the pooler rather than through the HTTP API,
  so they prove the **database boundary** (which is what M1 changes), not the
  route layer. Route-level behaviour stays covered by the backend suite.
- `regulatory_data.bbmp_street_index` was absent from the branch, so its
  policy fix was verified directly against production instead.
