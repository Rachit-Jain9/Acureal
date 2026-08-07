'use strict';

const { query, transaction } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const {
  ORGANIZATION_ROLES,
  ROLE_PRIORITY,
  normalizeRole,
  mapLegacyUserRoleToOrganizationRole,
} = require('../constants/roles');
const { normalizeEmailDomain, isPublicEmailDomain } = require('../utils/emailDomain');
const { getPlatformAdminEmails } = require('../utils/platformOrg');
const { assertAccountUsable } = require('../utils/accountState');
const organizationAuditLog = require('./organizationAuditLog.service');

const slugifyOrganizationName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const deriveWorkspaceName = ({ name, email, organizationName } = {}) => {
  const explicit = String(organizationName || '').trim();
  if (explicit) {
    return explicit;
  }

  const baseName = String(name || '').trim();
  if (baseName) {
    return `${baseName}'s Workspace`;
  }

  const emailPrefix = String(email || '').split('@')[0]?.trim();
  if (emailPrefix) {
    return `${emailPrefix}'s Workspace`;
  }

  return 'Acureal Workspace';
};

const listMembershipsForUser = async (userId, client = { query }) => {
  const result = await client.query(
    `SELECT
       om.organization_id,
       om.role,
       om.is_active,
       om.joined_at,
       o.name AS organization_name,
       o.slug AS organization_slug
     FROM organization_members om
     INNER JOIN organizations o ON o.id = om.organization_id
     WHERE om.user_id = $1
     ORDER BY om.joined_at ASC, o.created_at ASC`,
    [userId]
  );

  return result.rows.map((row) => ({
    organization_id: row.organization_id,
    role: normalizeRole(row.role) || 'viewer',
    is_active: row.is_active !== false,
    joined_at: row.joined_at,
    organization: {
      id: row.organization_id,
      name: row.organization_name,
      slug: row.organization_slug,
    },
  }));
};

const resolveActiveMembership = async (userId, requestedOrganizationId = null, client = { query }) => {
  const memberships = await listMembershipsForUser(userId, client);
  const activeMemberships = memberships.filter((membership) => membership.is_active);

  if (activeMemberships.length === 0) {
    throw createError('No active organization membership found for this account.', 403);
  }

  const activeMembership = requestedOrganizationId
    ? activeMemberships.find((membership) => membership.organization_id === requestedOrganizationId)
    : activeMemberships[0];

  if (!activeMembership) {
    throw createError('Organization access denied.', 403);
  }

  return {
    memberships,
    activeMembership,
  };
};

const buildAuthUser = (userRow, memberships, activeMembership) => ({
  id: userRow.id,
  email: userRow.email,
  name: userRow.name,
  phone: userRow.phone,
  is_active: userRow.is_active,
  // password_set === false means the user signed up via Google OAuth and
  // has never set a password. Frontend uses this to surface a "Set a
  // password" card on the Settings page. Defaults to true on the column
  // so anyone created before PR #145 is treated as having a real password.
  password_set: userRow.password_set !== false,
  oauth_provider: userRow.oauth_provider || null,
  mfa_enrolled: Boolean(userRow.mfa_enrolled_at),
  // Server-computed operator fact: the persisted users.is_platform_admin
  // flag (migration 20260803) OR the PLATFORM_ADMIN_EMAILS break-glass
  // allowlist. The OR keeps the founder un-lockable-out and makes the field
  // correct even before the migration is applied (the projection returns
  // NULL then). The browser renders this fact and holds NO operator list.
  is_platform_admin:
    userRow.is_platform_admin === true ||
    getPlatformAdminEmails().includes(String(userRow.email || '').trim().toLowerCase()),
  role: activeMembership.role,
  organization_role: activeMembership.role,
  organization_id: activeMembership.organization_id,
  default_organization_id: userRow.default_organization_id || activeMembership.organization_id,
  organization: activeMembership.organization,
  organizations: memberships.map((membership) => ({
    id: membership.organization_id,
    name: membership.organization.name,
    slug: membership.organization.slug,
    role: membership.role,
    is_active: membership.is_active,
  })),
});

const hydrateUserAuthContext = async (userId, requestedOrganizationId = null, client = { query }) => {
  const userResult = await client.query(
    // is_platform_admin rides a to_jsonb projection so this query cannot
    // 42703 before migration 20260803 adds the column — it just reads NULL,
    // and buildAuthUser falls back to the env allowlist.
    //
    // account_closed_at / erased_at are referenced DIRECTLY (migration
    // 20260511), not via to_jsonb. That is deliberate: a to_jsonb projection
    // would read NULL on an unmigrated database and silently let a closed
    // account authenticate — fail-open on the exact control this guard exists
    // to provide. A direct reference fails loud instead, and login() has
    // hard-depended on these same two columns since PR #158, so any database
    // that could serve this query already has them. tests/accountState.schema
    // .test.js asserts they are present so CI catches a drift before prod does.
    `SELECT id, email, name, phone, is_active, default_organization_id,
            password_set, oauth_provider, mfa_enrolled_at,
            account_closed_at, erased_at,
            (to_jsonb(users) ->> 'is_platform_admin')::boolean AS is_platform_admin
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (userResult.rows.length === 0) {
    throw createError('User not found.', 404);
  }

  const userRow = userResult.rows[0];

  // THE universal session gate. Every authenticated entry point reaches this
  // line: the `authenticate` middleware (so every protected request, not just
  // sign-in), password login, MFA completion, all three Google branches,
  // refresh-token rotation, and register. Enforcing terminal state here rather
  // than at each call site is what makes closure/erasure actually terminate
  // access — including on entry points added later, which inherit the check for
  // free. Ordering is most-terminal-first (erased → closed → deactivated).
  assertAccountUsable(userRow, createError);

  const preferredOrganizationId = requestedOrganizationId || userRow.default_organization_id || null;
  const { memberships, activeMembership } = await resolveActiveMembership(
    userId,
    preferredOrganizationId,
    client
  );

  if (!userRow.default_organization_id || userRow.default_organization_id !== activeMembership.organization_id) {
    await client.query(
      'UPDATE users SET default_organization_id = $1, updated_at = NOW() WHERE id = $2',
      [activeMembership.organization_id, userId]
    );
    userRow.default_organization_id = activeMembership.organization_id;
  }

  return {
    user: buildAuthUser(userRow, memberships, activeMembership),
    memberships,
    activeMembership,
  };
};

const createWorkspaceForUser = async (client, { userId, name, email, organizationName }) => {
  const workspaceName = deriveWorkspaceName({ name, email, organizationName });
  const baseSlug = slugifyOrganizationName(workspaceName) || `workspace-${userId.slice(0, 8)}`;

  const orgResult = await client.query(
    `INSERT INTO organizations (name, slug, created_by)
     VALUES ($1, $2, $3)
     RETURNING id, name, slug`,
    [workspaceName, `${baseSlug}-${userId.slice(0, 8)}`, userId]
  );

  const organization = orgResult.rows[0];

  await client.query(
    `INSERT INTO organization_members (organization_id, user_id, role, invited_by, is_active)
     VALUES ($1, $2, 'owner', $2, TRUE)`,
    [organization.id, userId]
  );

  await client.query(
    'UPDATE users SET default_organization_id = $1, updated_at = NOW() WHERE id = $2',
    [organization.id, userId]
  );

  return organization;
};

// How long an emailed invitation stays usable. Was hardcoded inline at 7 days;
// named here because phase 3 makes it a per-workspace setting (spec default 14)
// and a magic number inside a SQL string is not a thing you can configure.
const INVITATION_EXPIRY_DAYS = 14;

/**
 * Public, token-authenticated preview of an invitation — what the /invite
 * landing page shows BEFORE the recipient has an account.
 *
 * The token IS the secret, so returning the workspace name, the inviter and
 * the invited address to whoever holds it leaks nothing they were not already
 * sent by email. It deliberately returns no ids and nothing about the
 * workspace's contents.
 *
 * Errors are uniform: any unusable invitation (unknown, expired, accepted,
 * revoked) returns the same 404 shape, so this cannot be used to probe which
 * tokens exist.
 */
const previewInvitation = async (invitationToken) => {
  if (!invitationToken || typeof invitationToken !== 'string' || invitationToken.length < 16) {
    throw createError('This invitation link is not valid or has expired.', 404);
  }

  const result = await query(
    `SELECT
       oi.email,
       oi.role,
       oi.status,
       oi.expires_at,
       oi.accepted_at,
       o.name  AS organization_name,
       u.name  AS invited_by_name,
       u.email AS invited_by_email
     FROM organization_invitations oi
     JOIN organizations o ON o.id = oi.organization_id
     LEFT JOIN users u ON u.id = oi.invited_by
     WHERE oi.token = $1`,
    [invitationToken]
  );

  const invitation = result.rows[0];
  const unusable =
    !invitation
    || invitation.accepted_at
    || invitation.status === 'revoked'
    || invitation.status === 'rejected'
    || new Date(invitation.expires_at) < new Date();

  if (unusable) {
    throw createError('This invitation link is not valid or has expired.', 404);
  }

  // Does the invited address already have an account? Decides whether the
  // landing page offers "sign in" or "create your account".
  const existing = await query('SELECT id FROM users WHERE LOWER(email) = $1', [
    String(invitation.email).toLowerCase(),
  ]);

  return {
    email: invitation.email,
    role: normalizeRole(invitation.role) || invitation.role,
    organizationName: invitation.organization_name,
    invitedByName: invitation.invited_by_name,
    invitedByEmail: invitation.invited_by_email,
    expiresAt: invitation.expires_at,
    hasAccount: existing.rows.length > 0,
  };
};

// Pure invitation-usability gate, shared by consumeInvitation (the direct
// fallback path) and the register definer branch (M1 Phase 2), so both raise
// the exact same friendly errors in the same order. `invitation` may be null /
// undefined (token matched nothing).
const assertInvitationUsable = (invitation, email) => {
  if (!invitation) {
    throw createError('Invitation not found or already used.', 404);
  }

  if (invitation.accepted_at) {
    throw createError('Invitation has already been accepted.', 409);
  }

  // `status` may be absent on the definer path (auth_find_invitation predates
  // the column and does not select it) — treat missing as usable so the check
  // is additive, never a new way for a valid invitation to fail.
  if (invitation.status === 'revoked' || invitation.status === 'rejected') {
    throw createError('This invitation has been withdrawn.', 410);
  }

  if (new Date(invitation.expires_at) < new Date()) {
    throw createError('Invitation has expired.', 410);
  }

  // KNOWN GAP, deliberately left raw. The two sides arrive in different shapes
  // when the invitee signs up with GOOGLE: the invitation row holds /register's
  // normalised address while Google hands us claims.email with dots intact, so
  // invite-then-sign-up-with-Google is refused with this 409.
  //
  // A canonical comparison here would be inert AND actively harmful. This
  // function is only the friendly pre-check; on the live non-bypass role the
  // authoritative gate is inside public.auth_provision_signup, which does its
  // own raw `lower(v_inv.email) <> lower(p_email)` and RAISEs
  // AUTH_PROVISION_INVITATION_EMAIL_MISMATCH (P0001) — a code nothing in
  // errorHandler maps. Relaxing only the JS half would convert this readable
  // 409 into an opaque 500 while still not letting the invitation through.
  // Both halves have to move together, in a migration. See organization.routes.js.
  if (invitation.email.toLowerCase() !== email.toLowerCase()) {
    throw createError('Invitation email does not match this registration.', 409);
  }
};

const consumeInvitation = async (client, { userId, email, invitationToken }) => {
  const invitationResult = await client.query(
    `SELECT
       oi.id,
       oi.organization_id,
       oi.email,
       oi.role,
       oi.expires_at,
       oi.accepted_at,
       oi.status
     FROM organization_invitations oi
     WHERE oi.token = $1`,
    [invitationToken]
  );

  const invitation = invitationResult.rows[0];
  assertInvitationUsable(invitation, email);

  await client.query(
    `INSERT INTO organization_members (organization_id, user_id, role, invited_by, is_active)
     VALUES ($1, $2, $3, NULL, TRUE)
     ON CONFLICT (organization_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           is_active = TRUE,
           updated_at = NOW()`,
    [invitation.organization_id, userId, normalizeRole(invitation.role) || 'viewer']
  );

  await client.query(
    `UPDATE organization_invitations
     SET accepted_at = NOW(),
         accepted_by = $2,
         status = 'accepted',
         updated_at = NOW()
     WHERE id = $1`,
    [invitation.id, userId]
  );

  await client.query(
    'UPDATE users SET default_organization_id = $1, updated_at = NOW() WHERE id = $2',
    [invitation.organization_id, userId]
  );

  return invitation.organization_id;
};

const inviteOrganizationMember = async ({ organizationId, email, role, invitedBy }) => {
  const normalizedRole = normalizeRole(role);

  if (!normalizedRole || !ORGANIZATION_ROLES.includes(normalizedRole) || normalizedRole === 'owner') {
    throw createError('Invitations can only assign admin, editor, or viewer access.', 400);
  }

  const normalizedEmail = String(email || '').trim().toLowerCase();

  // If the invitee already has an Acureal account, add them to the workspace
  // directly. An emailed invitation token is only consumable at registration,
  // so it would never reach someone who already signed up. This is admin-
  // initiated (the route gates it to admin/owner) and grants the user access to
  // THIS workspace only — it exposes none of their own data to the org.
  //
  // KNOWN GAP, deliberately not fixed here: this is a single-shape match, and
  // gmail lives in this database two ways (dotted from Google sign-in,
  // dot-stripped from /register). Inviting a Google-created colleague at
  // first.last@gmail.com therefore misses their account and falls through to
  // the invitation branch below, which for someone who already has an account
  // can never be redeemed. Widening the match here requires the raw typed
  // address, which requires changing the route's sanitizer, which changes the
  // invitation STORAGE shape — and that shape is pinned by auth_provision_signup.
  // See the comment on the route in organization.routes.js.
  const existing = await query(
    'SELECT id, name, email FROM users WHERE LOWER(email) = $1',
    [normalizedEmail]
  );
  if (existing.rows.length > 0) {
    const targetUser = existing.rows[0];
    const upsert = await query(
      `INSERT INTO organization_members (organization_id, user_id, role, invited_by, is_active)
       VALUES ($1, $2, $3::organization_role, $4, TRUE)
       ON CONFLICT (organization_id, user_id) DO UPDATE
         SET role = EXCLUDED.role,
             is_active = TRUE,
             updated_at = NOW()
       RETURNING organization_id, user_id, role, is_active`,
      [organizationId, targetUser.id, normalizedRole, invitedBy]
    );

    await organizationAuditLog.recordAudit({
      organizationId,
      actorId: invitedBy,
      targetUserId: targetUser.id,
      eventType: 'member_invited',
      after: { email: normalizedEmail, role: normalizedRole, added_existing_user: true },
    });

    return {
      kind: 'added',
      member: {
        ...upsert.rows[0],
        role: normalizeRole(upsert.rows[0].role),
        name: targetUser.name,
        email: targetUser.email,
      },
    };
  }

  // Re-inviting REGENERATES the token. The previous upsert reset the role,
  // inviter and expiry but left `token` alone (it is a column DEFAULT, which
  // only fires on INSERT) — so a re-invite reissued the SAME secret, and could
  // resurrect an already-accepted row by nulling accepted_at beneath it. A
  // reissued invitation must invalidate whatever was sent before.
  const result = await query(
    `INSERT INTO organization_invitations (organization_id, email, role, invited_by, expires_at, status)
     VALUES ($1, LOWER($2), $3, $4, NOW() + ($5 || ' days')::INTERVAL, 'approved')
     ON CONFLICT (organization_id, email)
     DO UPDATE SET
       role = EXCLUDED.role,
       invited_by = EXCLUDED.invited_by,
       expires_at = EXCLUDED.expires_at,
       token = encode(gen_random_bytes(24), 'hex'),
       status = 'approved',
       accepted_at = NULL,
       accepted_by = NULL,
       revoked_at = NULL,
       revoked_by = NULL,
       updated_at = NOW()
     RETURNING id, organization_id, email, role, token, expires_at, created_at, status`,
    [organizationId, email, normalizedRole, invitedBy, INVITATION_EXPIRY_DAYS]
  );

  await organizationAuditLog.recordAudit({
    organizationId,
    actorId: invitedBy,
    eventType: 'member_invited',
    after: { email: result.rows[0].email, role: result.rows[0].role },
  });

  return { kind: 'invited', invitation: result.rows[0] };
};

/**
 * Mark an invitation as delivered. Called after the mailer succeeds, so
 * `sent_at` means "a message actually left the building" rather than "a row
 * was created" — the distinction the old UI got wrong for months.
 */
const markInvitationSent = async (invitationId) => {
  await query(
    `UPDATE organization_invitations
        SET status = 'sent',
            sent_at = COALESCE(sent_at, NOW()),
            last_sent_at = NOW(),
            send_count = send_count + 1,
            updated_at = NOW()
      WHERE id = $1
        AND status IN ('approved', 'sent')`,
    [invitationId]
  );
};

/**
 * Outstanding invitations for a workspace — what the Team page's pending list
 * reads. Expiry is computed at read time rather than trusted from `status`,
 * because nothing sweeps the table: a row can sit at 'sent' long past its
 * expires_at, and reporting that as pending would be the same class of lie as
 * the toast this feature is fixing.
 */
const listInvitations = async (organizationId) => {
  const result = await query(
    `SELECT
       oi.id,
       oi.email,
       oi.role,
       oi.status,
       oi.expires_at,
       oi.sent_at,
       oi.send_count,
       oi.created_at,
       u.name  AS invited_by_name,
       u.email AS invited_by_email,
       (oi.expires_at < NOW()) AS is_expired
     FROM organization_invitations oi
     LEFT JOIN users u ON u.id = oi.invited_by
     WHERE oi.organization_id = $1
       AND oi.status NOT IN ('accepted', 'revoked', 'rejected')
     ORDER BY oi.created_at DESC`,
    [organizationId]
  );

  return result.rows.map((row) => ({
    ...row,
    role: normalizeRole(row.role) || row.role,
    status: row.is_expired ? 'expired' : row.status,
  }));
};

/**
 * Withdraw an invitation. The token stays in the row (audit) but the status
 * makes it unusable — assertInvitationUsable refuses anything not 'approved'
 * or 'sent'.
 */
const revokeInvitation = async ({ organizationId, invitationId, actorId }) => {
  const result = await query(
    `UPDATE organization_invitations
        SET status = 'revoked',
            revoked_at = NOW(),
            revoked_by = $3,
            updated_at = NOW()
      WHERE id = $1
        AND organization_id = $2
        AND status IN ('approved', 'sent', 'pending_approval')
      RETURNING id, email, role`,
    [invitationId, organizationId, actorId]
  );

  if (result.rowCount === 0) {
    // Either it does not exist, belongs to another workspace, or has already
    // reached a terminal state. Not distinguished — an admin of org A must not
    // learn whether an invitation id exists in org B.
    throw createError('Invitation not found or no longer active.', 404);
  }

  await organizationAuditLog.recordAudit({
    organizationId,
    actorId,
    eventType: 'member_invite_revoked',
    before: { email: result.rows[0].email, role: result.rows[0].role },
  });

  return { revoked: true, email: result.rows[0].email };
};

// The active workspace roster. Pending domain auto-joins (is_active = FALSE)
// are intentionally excluded — they surface separately via
// listPendingJoinRequests so the Team page never conflates "awaiting approval"
// with "active member". Removing a member hard-deletes the row
// (removeOrganizationMember), so is_active = FALSE now unambiguously means a
// genuine pending join request.
const listOrganizationMembers = async (organizationId) => {
  const result = await query(
    `SELECT
       u.id,
       u.email,
       u.name,
       u.phone,
       om.role,
       om.is_active,
       om.joined_at
     FROM organization_members om
     INNER JOIN users u ON u.id = om.user_id
     WHERE om.organization_id = $1 AND om.is_active = TRUE
     ORDER BY
       CASE om.role
         WHEN 'owner' THEN 1
         WHEN 'admin' THEN 2
         WHEN 'editor' THEN 3
         ELSE 4
       END,
       om.joined_at ASC`,
    [organizationId]
  );

  return result.rows.map((row) => ({
    ...row,
    role: normalizeRole(row.role) || mapLegacyUserRoleToOrganizationRole(row.role),
  }));
};

// Remove a member from the workspace (hard delete of the membership row, the
// same idiom rejectJoinRequest uses). Re-inviting restores access; the audit
// log preserves the removal. Guards mirror updateOrganizationMemberRole so the
// server — not just the hidden UI button — enforces them:
//   • you cannot remove yourself through this control;
//   • you cannot remove a member who outranks you (rank ceiling); and
//   • you cannot remove the last active owner (the org must keep an owner).
// FOR UPDATE makes the last-owner check race-safe against a concurrent removal.
const removeOrganizationMember = async ({ organizationId, targetUserId, actor }) => {
  if (targetUserId === actor.id) {
    throw createError('You cannot remove your own workspace access.', 400);
  }
  const actorRole = normalizeRole(actor.role);

  return transaction(async (client) => {
    const targetRes = await client.query(
      `SELECT user_id, role, is_active
         FROM organization_members
        WHERE organization_id = $1 AND user_id = $2
        FOR UPDATE`,
      [organizationId, targetUserId]
    );
    if (targetRes.rows.length === 0) {
      throw createError('Organization member not found.', 404);
    }
    const currentRole = normalizeRole(targetRes.rows[0].role);

    if (ROLE_PRIORITY[currentRole] > ROLE_PRIORITY[actorRole]) {
      throw createError('You cannot remove a member who outranks you.', 403);
    }

    if (currentRole === 'owner' && targetRes.rows[0].is_active) {
      const ownerCount = await client.query(
        `SELECT COUNT(*)::int AS n
           FROM organization_members
          WHERE organization_id = $1 AND role = 'owner' AND is_active = TRUE`,
        [organizationId]
      );
      if (ownerCount.rows[0].n <= 1) {
        throw createError('Cannot remove the last active owner of the organization.', 409);
      }
    }

    await client.query(
      `DELETE FROM organization_members
        WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, targetUserId]
    );

    await organizationAuditLog.recordAudit(
      {
        organizationId,
        actorId: actor.id,
        targetUserId,
        eventType: 'member_removed',
        before: { role: currentRole, is_active: targetRes.rows[0].is_active },
      },
      client
    );

    return { removed: true, user_id: targetUserId };
  });
};

// ── Domain-based onboarding ─────────────────────────────────────────────────
// Called during signup (register / Google cold-signup) AFTER the invitation
// check. If the signup email's domain matches a VERIFIED, auto-join organization
// domain the user is placed into that org:
//   • require_admin_approval = false → ACTIVE membership; we set the user's
//     default org and RETURN the org id so the caller SKIPS creating a personal
//     workspace (the user lands straight in the company workspace).
//   • require_admin_approval = true  → a PENDING membership (is_active = FALSE)
//     and we RETURN null, so the caller still creates a personal workspace for
//     the user to sign into while an admin approves the pending membership.
// Returns null (caller creates a personal workspace) when there is no corporate
// domain, the domain is a public provider, or no verified claim exists. Runs on
// the backend's bypass role, so the cross-org domain lookup is intentional.
const joinByVerifiedDomain = async (client, { userId, email, hostedDomain = null }) => {
  const domain = normalizeEmailDomain(hostedDomain) || normalizeEmailDomain(email);
  if (!domain || isPublicEmailDomain(domain)) {
    return null;
  }

  // Resolve the verified domain on a SEPARATE connection (module `query`), not
  // the signup transaction's `client`. If organization_domains doesn't exist yet
  // (this migration not applied before deploy), a 42P01 on the client would
  // poison the whole signup transaction and break registration. On a separate
  // connection we can swallow it and fall back to a personal workspace.
  // organization_domains and organization_audit_log ship in the same migration,
  // so reaching the writes below guarantees both tables exist.
  let match;
  try {
    match = await query(
      `SELECT organization_id, default_role, require_admin_approval
         FROM organization_domains
        WHERE lower(domain) = lower($1) AND verified = TRUE
        LIMIT 1`,
      [domain]
    );
  } catch (error) {
    if (error && error.code === '42P01') {
      return null;
    }
    throw error;
  }
  if (match.rows.length === 0) {
    return null;
  }

  const { organization_id: organizationId } = match.rows[0];
  const role = normalizeRole(match.rows[0].default_role) || 'editor';
  const isActive = match.rows[0].require_admin_approval !== true;

  await client.query(
    `INSERT INTO organization_members (organization_id, user_id, role, invited_by, is_active)
     VALUES ($1, $2, $3::organization_role, NULL, $4)
     ON CONFLICT (organization_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           is_active = organization_members.is_active OR EXCLUDED.is_active,
           updated_at = NOW()`,
    [organizationId, userId, role, isActive]
  );

  await organizationAuditLog.recordAudit(
    {
      organizationId,
      actorId: userId,
      targetUserId: userId,
      eventType: 'member_domain_joined',
      after: { role, is_active: isActive, via: 'domain' },
    },
    client
  );

  if (isActive) {
    await client.query(
      'UPDATE users SET default_organization_id = $1, updated_at = NOW() WHERE id = $2',
      [organizationId, userId]
    );
    return organizationId;
  }

  return null;
};

// ── Member management (Team page) ───────────────────────────────────────────

const updateOrganizationMemberRole = async ({ organizationId, targetUserId, nextRole, actor }) => {
  const normalizedNext = normalizeRole(nextRole);
  if (!normalizedNext || !ORGANIZATION_ROLES.includes(normalizedNext)) {
    throw createError('Invalid role.', 400);
  }
  const actorRole = normalizeRole(actor.role);
  if (ROLE_PRIORITY[normalizedNext] > ROLE_PRIORITY[actorRole]) {
    throw createError('You cannot assign a role higher than your own.', 403);
  }

  // FOR UPDATE + atomic last-owner check so two concurrent demotions can't both
  // pass the count and leave the org ownerless.
  return transaction(async (client) => {
    const targetRes = await client.query(
      `SELECT user_id, role, is_active
         FROM organization_members
        WHERE organization_id = $1 AND user_id = $2
        FOR UPDATE`,
      [organizationId, targetUserId]
    );
    if (targetRes.rows.length === 0) {
      throw createError('Organization member not found.', 404);
    }
    const currentRole = normalizeRole(targetRes.rows[0].role);

    if (ROLE_PRIORITY[currentRole] > ROLE_PRIORITY[actorRole]) {
      throw createError('You cannot change the role of a member who outranks you.', 403);
    }

    if (currentRole === 'owner' && normalizedNext !== 'owner') {
      const ownerCount = await client.query(
        `SELECT COUNT(*)::int AS n
           FROM organization_members
          WHERE organization_id = $1 AND role = 'owner' AND is_active = TRUE`,
        [organizationId]
      );
      if (ownerCount.rows[0].n <= 1) {
        throw createError('Cannot demote the last active owner of the organization.', 409);
      }
    }

    const updated = await client.query(
      `UPDATE organization_members
          SET role = $3::organization_role, updated_at = NOW()
        WHERE organization_id = $1 AND user_id = $2
        RETURNING organization_id, user_id, role, is_active, joined_at`,
      [organizationId, targetUserId, normalizedNext]
    );

    await organizationAuditLog.recordAudit(
      {
        organizationId,
        actorId: actor.id,
        targetUserId,
        eventType: 'member_role_changed',
        before: { role: currentRole },
        after: { role: normalizedNext },
      },
      client
    );

    return { ...updated.rows[0], role: normalizeRole(updated.rows[0].role) };
  });
};

// Pending members are domain auto-joins awaiting approval: is_active = FALSE
// rows. (A deactivated former member is also is_active = FALSE; the Team UI
// distinguishes them by recency + the audit trail.)
const listPendingJoinRequests = async (organizationId) => {
  const result = await query(
    `SELECT u.id, u.email, u.name, u.phone,
            om.role, om.is_active, om.joined_at, om.invited_by
       FROM organization_members om
       INNER JOIN users u ON u.id = om.user_id
      WHERE om.organization_id = $1 AND om.is_active = FALSE
      ORDER BY om.joined_at ASC`,
    [organizationId]
  );
  return result.rows.map((row) => ({
    ...row,
    role: normalizeRole(row.role) || mapLegacyUserRoleToOrganizationRole(row.role),
  }));
};

const approveJoinRequest = async ({ organizationId, targetUserId, actor }) => {
  if (targetUserId === actor.id) {
    throw createError('You cannot approve your own join request.', 400);
  }
  const result = await query(
    `UPDATE organization_members
        SET is_active = TRUE, updated_at = NOW()
      WHERE organization_id = $1 AND user_id = $2 AND is_active = FALSE
      RETURNING organization_id, user_id, role, is_active`,
    [organizationId, targetUserId]
  );
  if (result.rows.length === 0) {
    throw createError('Pending join request not found.', 404);
  }
  await organizationAuditLog.recordAudit({
    organizationId,
    actorId: actor.id,
    targetUserId,
    eventType: 'join_request_approved',
    after: { is_active: true, role: normalizeRole(result.rows[0].role) },
  });
  return { ...result.rows[0], role: normalizeRole(result.rows[0].role) };
};

const rejectJoinRequest = async ({ organizationId, targetUserId, actor }) => {
  if (targetUserId === actor.id) {
    throw createError('You cannot reject your own join request.', 400);
  }
  // Reject = remove the inactive row, letting the user re-request later. (The
  // row is already is_active = FALSE, so a tri-state isn't needed.)
  const result = await query(
    `DELETE FROM organization_members
      WHERE organization_id = $1 AND user_id = $2 AND is_active = FALSE
      RETURNING organization_id, user_id, role`,
    [organizationId, targetUserId]
  );
  if (result.rows.length === 0) {
    throw createError('Pending join request not found.', 404);
  }
  await organizationAuditLog.recordAudit({
    organizationId,
    actorId: actor.id,
    targetUserId,
    eventType: 'join_request_rejected',
    before: { role: normalizeRole(result.rows[0].role), is_active: false },
  });
  return { rejected: true };
};

module.exports = {
  assertInvitationUsable,
  buildAuthUser,
  consumeInvitation,
  createWorkspaceForUser,
  deriveWorkspaceName,
  hydrateUserAuthContext,
  slugifyOrganizationName,
  inviteOrganizationMember,
  joinByVerifiedDomain,
  listMembershipsForUser,
  INVITATION_EXPIRY_DAYS,
  previewInvitation,
  markInvitationSent,
  listInvitations,
  revokeInvitation,
  listOrganizationMembers,
  listPendingJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  removeOrganizationMember,
  resolveActiveMembership,
  updateOrganizationMemberRole,
};
