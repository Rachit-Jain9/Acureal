# Deal & Workspace Access Control — Architecture

**Status:** architecture agreed, phased build not started
**Spec:** operator specification v1.0, 2026-08-06
**Principle:** zero-trust access with seamless same-firm collaboration and tightly governed external participation.

---

## 0. What already exists (and why this is an extension, not a build)

A four-lens survey of the codebase (2026-08-06) found that Acureal already has
**three** partially-built access-granting mechanisms. The spec is mostly a matter
of finishing and connecting them, not starting over.

| Capability the spec asks for | Status today | Evidence |
|---|---|---|
| Org membership + roles | **Complete.** owner/admin/editor/viewer, rank-ceiling and last-owner guards, org-scoped RLS | `organization.service.js`, `organization_members` |
| Member-management API | **Complete.** roster, invite, role change, remove, approve/reject join requests | `organization.routes.js` |
| Team-Lead concept | **Exists.** `requireRole('admin')` is rank-based, so owner satisfies it | `middleware/auth.js` |
| Approval queue idiom | **Exists twice.** Pending domain join-requests (`is_active=FALSE` + approve/reject) and the pending-invitation table | `TeamPage.jsx` PendingRow |
| Domain verification | **Complete and real.** DNS TXT `_redip-verify.<domain>`, per-domain `default_role` + `require_admin_approval`, anti-squatting uniqueness | `organizationDomain.service.js`, migrations 20260625/20260626 |
| Same-workspace deal sharing | **Complete since 20260806.** Cross-org shared-read policies dropped | `dealShare.service.js` |
| Transactional email | **Live in production.** Resend, fail-closed in prod | `lib/mailer.js` |
| One-shot token blueprint | **Live, security-reviewed twice** | `passwordReset.service.js` |

### The five real gaps

1. **The invitation loop is dead end to end — and the UI lies about it.**
   `POST /api/organization/invitations` creates a tokened row and returns the raw
   token in the HTTP response. `sendMail` is imported by exactly three services;
   invitations is not one of them. No email is ever sent. No frontend surface
   ever reads or forwards `invitationToken`. Meanwhile `TeamPage.jsx` toasts
   *"Invitation sent"* and the modal says *"They'll get an email link to join
   this workspace"*. **This is the highest-priority item in the program**: a
   platform selling auditability cannot tell users an email was sent when the
   code cannot send one.
2. **Invitation tokens are stored in plaintext**, DB-default-generated, and a
   re-invite reuses the same token (the `ON CONFLICT` upsert does not regenerate
   it, and can resurrect an already-accepted row). This contradicts the
   sha256-only house blueprint that both other token flows follow.
3. **No colleague discovery.** `ShareDealPanel.jsx` is a free-text email box.
   With the workspace lock in place, typing a colleague's address that is not
   yet a member simply dead-ends — which is exactly how the operator hit it.
4. **No external/"External" concept at all.** No cross-domain proposal, no
   approval gate, no caps, no revocation surface, no badge.
5. **No feature-flag mechanism** anywhere in the backend.

### Two constraints the spec assumes and this codebase does not have

- **Redis.** The spec asks for per-domain caching in Redis. There is none, and
  Vercel serverless makes an in-process cache near-useless. The colleague roster
  is a single indexed query against `organization_members` scoped to one org —
  fast enough that caching is premature. **Decision: no cache.** Revisit only if
  measurement says otherwise.
- **Open/bounce tracking.** Resend supports webhooks, but no webhook receiver
  exists. **Decision: ship delivery status only (dispatched / failed) in phase 3;
  open+bounce tracking is its own phase and needs a public webhook endpoint with
  signature verification.**

---

## 1. Domain model

### The identity question the spec raises

The spec says *"strictly limited to users whose verified email domain matches
the inviter's domain"*, and separately that *"domain ownership is never inferred
solely from email string"*. Those two pull in opposite directions, and this
codebase already resolved the tension: **`organization_domains` with real DNS
TXT verification.**

**Decision: the discovery dropdown is scoped by ORGANISATION MEMBERSHIP, not by
raw email domain.** Reasons:

- Membership is the boundary the RLS policies, the deal-share lock and the whole
  multi-tenancy model already enforce. Introducing a second, weaker boundary
  (string-matched email domain) beside it invites the two to disagree.
- Two firms can share a public-provider domain (`gmail.com`); the
  `PUBLIC_EMAIL_PROVIDERS` denylist exists precisely because email domain is not
  identity.
- A verified domain already *produces* membership via `joinByVerifiedDomain`. So
  "colleagues on my verified domain" and "members of my workspace" converge —
  by construction, and auditable.

The spec's user-visible promise is preserved exactly ("only my colleagues appear,
nobody else"); it is the *mechanism* that is stronger than string matching.
The domain badge in the UI comes from the org's verified domain claim, so it
means "verified", not "we split their address on @".

### Schema changes

Extend the existing `organization_invitations` rather than adding a table:

```
ALTER TABLE organization_invitations
  ADD status            invitation_status NOT NULL DEFAULT 'approved',
  ADD token_hash        TEXT,          -- sha256; replaces plaintext `token`
  ADD proposed_by       UUID REFERENCES users(id),
  ADD decided_by        UUID REFERENCES users(id),
  ADD decided_at        TIMESTAMPTZ,
  ADD decision_note     TEXT,
  ADD is_external       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD sent_at           TIMESTAMPTZ,
  ADD revoked_at        TIMESTAMPTZ,
  ADD revoked_by        UUID REFERENCES users(id);

CREATE TYPE invitation_status AS ENUM
  ('pending_approval','approved','sent','accepted','declined','rejected','expired','revoked');
```

Notes that matter:

- `status` defaults to `'approved'` so existing rows keep today's semantics.
- `token_hash` is added alongside `token`; the plaintext column is dropped in a
  **second** migration after the code stops reading it (never both at once).
- The `UNIQUE(organization_id, email)` constraint must be reconsidered: it makes
  "one live invitation per address per org" free, but also means a rejected
  proposal blocks a later legitimate one. **Decision: keep the constraint, and
  have re-proposal update the existing row** (regenerating the token — the
  current upsert's failure to do so is a defect).
- Expiry becomes configurable per workspace (default 14 days) rather than the
  hardcoded 7.

### Workspace policy

```
ALTER TABLE organizations
  ADD external_invite_policy  TEXT NOT NULL DEFAULT 'any_one_approves',
  ADD external_invite_expiry_days INT NOT NULL DEFAULT 14,
  ADD external_invite_max_pending INT NOT NULL DEFAULT 20,
  ADD external_default_role   organization_role NOT NULL DEFAULT 'viewer';
```

`'majority'` is accepted by the enum from day one but **not implemented in
phase 3** — shipping a config value the engine ignores is worse than not
offering it, so the API rejects it until the engine exists.

---

## 2. Non-negotiable rules for the build

These come from defects this repo has actually shipped. Every one is a test pin.

1. **Post-response work uses `runInBackground`**, never `setImmediate` or a bare
   promise. On Vercel the instance can freeze after the flush; the loss looks
   exactly like success. (Cost us the reset email in #1094.)
2. **Any new table ships its own RLS policy + explicit role-guarded `redip_app`
   grants in the same migration.** New tables inherit nothing. (geocode_cache,
   20260807.)
3. **Any write on a public/pre-identity route stamps
   `set_config('app.current_user_id', …, true)` inside the transaction**, and
   uses `RETURNING` + rowCount so a zero-row RLS miss fails loud.
4. **Email lookups use `emailLookupCandidates`**, never a bare exact match —
   gmail is stored in two shapes. Throttles key on `canonicalEmail`.
5. **Tokens: sha256 at rest, raw returned exactly once, never logged.**
6. **Every state transition writes `organization_audit_log`** with actor,
   timestamp and reason. The event-type vocabulary already has `member_invited`.
7. **No UI copy may claim an action the backend did not perform.** The current
   "Invitation sent" toast is the anti-pattern being corrected.

---

## 3. Phasing

Each phase is independently shippable and independently valuable.

### Phase 1 — Colleague discovery in Share Deal
*Fixes the operator's actual dead end.*

- `GET /api/organization/members?q=` — already exists as the roster endpoint;
  add type-ahead filtering, exclude self, exclude existing shares, exclude
  inactive/pending.
- New design-system `Combobox` (searchable single/multi select). **None exists.**
  Build it on the WAI-ARIA pattern already implemented in `CommandPalette`
  (`aria-activedescendant`, debounced search, `useFocusTrap`), plus an `Avatar`
  primitive (also absent).
- `ShareDealPanel.jsx`: replace the free-text email input with the combobox.
  Empty state: *"No colleagues from your organization found. You can invite
  external users with Team Lead approval."* — with the external path visually
  separated below.
- Audit entry for each discovery lookup performed in a deal context.

### Phase 2 — Make invitations real
*Stops the product lying, and closes the plaintext-token defect.*

- Hash tokens; regenerate on re-invite; single-use consume with `FOR UPDATE`.
- Actually send the email (both templates from spec §4, Case A / Case B).
- Frontend acceptance path: `/invite?token=…` landing page, and thread
  `invitationToken` through register + Google sign-in (both already accept it
  server-side; no client ever sends it).
- Invitation list + revoke API and UI.
- Fix the false toast and modal copy.

### Phase 3 — External proposals + Team Lead approval
- Proposal endpoint (any member), pending queue, approve/reject with note.
- Self-approval blocked; per-workspace pending cap; configurable expiry;
  proposer notified on decision.
- `sent_at` only after approval — the email dispatch is gated on it.
- "Awaiting Approval" section in TeamPage, reusing the PendingRow pattern.
- External badge everywhere a member is rendered.

### Phase 4 — Observability & polish
- Metrics: invite→accept conversion, approval latency, dispatch failures.
- Delivery status via a Resend webhook receiver (signature-verified).
- Feature flags — needs a mechanism first; the repo has none.
- In-app micro-survey.

---

## 4. Open questions for the operator

1. **External access scope.** The spec says "time-bound or role-scoped".
   Time-bound access needs an expiry on `organization_members` and a sweep —
   materially more work than role-scoping. Recommend role-scoped (`viewer`) in
   phase 3; time-bound as a later addition.
2. **Should an external invitation grant workspace membership at all**, or only
   per-deal access via `deal_shares`? The spec mixes "workspace" and "deal"
   language throughout. Per-deal is tighter and matches the zero-trust framing,
   but the entire approval/membership substrate is org-level.
3. **Majority approval** — worth building, or is any-one-approves sufficient
   indefinitely? (Currently: accepted by config, rejected by API.)
