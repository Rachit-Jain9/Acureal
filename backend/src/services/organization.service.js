'use strict';

const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const {
  ORGANIZATION_ROLES,
  normalizeRole,
  mapLegacyUserRoleToOrganizationRole,
} = require('../constants/roles');

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
    `SELECT id, email, name, phone, is_active, default_organization_id
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

  return result.rows[0];
};

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
     WHERE om.organization_id = $1
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

const setOrganizationMemberStatus = async ({ organizationId, userId, isActive, requestingUserId }) => {
  if (userId === requestingUserId) {
    throw createError('You cannot deactivate your own workspace access.', 400);
  }

  const result = await query(
    `UPDATE organization_members
     SET is_active = $1, updated_at = NOW()
     WHERE organization_id = $2 AND user_id = $3
     RETURNING organization_id, user_id, role, is_active`,
    [isActive, organizationId, userId]
  );

  if (result.rows.length === 0) {
    throw createError('Organization member not found.', 404);
  }

  return result.rows[0];
};

module.exports = {
  buildAuthUser,
  consumeInvitation,
  createWorkspaceForUser,
  hydrateUserAuthContext,
  inviteOrganizationMember,
  listMembershipsForUser,
  listOrganizationMembers,
  resolveActiveMembership,
  setOrganizationMemberStatus,
};
