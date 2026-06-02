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

  return 'REDIP Workspace';
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
    `SELECT id, email, name, phone, is_active, default_organization_id,
            password_set, oauth_provider, mfa_enrolled_at
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (userResult.rows.length === 0) {
    throw createError('User not found.', 404);
  }

  const userRow = userResult.rows[0];

  if (!userRow.is_active) {
    throw createError('Your account has been deactivated. Please contact the administrator.', 403);
  }

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

const consumeInvitation = async (client, { userId, email, invitationToken }) => {
  const invitationResult = await client.query(
    `SELECT
       oi.id,
       oi.organization_id,
       oi.email,
       oi.role,
       oi.expires_at,
       oi.accepted_at
     FROM organization_invitations oi
     WHERE oi.token = $1`,
    [invitationToken]
  );

  if (invitationResult.rows.length === 0) {
    throw createError('Invitation not found or already used.', 404);
  }

  const invitation = invitationResult.rows[0];

  if (invitation.accepted_at) {
    throw createError('Invitation has already been accepted.', 409);
  }

  if (new Date(invitation.expires_at) < new Date()) {
    throw createError('Invitation has expired.', 410);
  }

  if (invitation.email.toLowerCase() !== email.toLowerCase()) {
    throw createError('Invitation email does not match this registration.', 409);
  }

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
         accepted_by = $2
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

  // If the invitee already has a REDIP account, add them to the workspace
  // directly. An emailed invitation token is only consumable at registration,
  // so it would never reach someone who already signed up. This is admin-
  // initiated (the route gates it to admin/owner) and grants the user access to
  // THIS workspace only — it exposes none of their own data to the org.
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

  const result = await query(
    `INSERT INTO organization_invitations (organization_id, email, role, invited_by, expires_at)
     VALUES ($1, LOWER($2), $3, $4, NOW() + INTERVAL '7 days')
     ON CONFLICT (organization_id, email)
     DO UPDATE SET
       role = EXCLUDED.role,
       invited_by = EXCLUDED.invited_by,
       expires_at = EXCLUDED.expires_at,
       accepted_at = NULL,
       accepted_by = NULL,
       updated_at = NOW()
     RETURNING id, organization_id, email, role, token, expires_at, created_at`,
    [organizationId, email, normalizedRole, invitedBy]
  );

  await organizationAuditLog.recordAudit({
    organizationId,
    actorId: invitedBy,
    eventType: 'member_invited',
    after: { email: result.rows[0].email, role: result.rows[0].role },
  });

  return { kind: 'invited', invitation: result.rows[0] };
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
  buildAuthUser,
  consumeInvitation,
  createWorkspaceForUser,
  hydrateUserAuthContext,
  inviteOrganizationMember,
  joinByVerifiedDomain,
  listMembershipsForUser,
  listOrganizationMembers,
  listPendingJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  removeOrganizationMember,
  resolveActiveMembership,
  updateOrganizationMemberRole,
};
