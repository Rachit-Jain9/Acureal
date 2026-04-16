'use strict';

const ORGANIZATION_ROLES = ['owner', 'admin', 'editor', 'viewer'];

const ROLE_ALIASES = {
  owner: 'owner',
  admin: 'admin',
  analyst: 'editor',
  editor: 'editor',
  viewer: 'viewer',
};

const ROLE_PRIORITY = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

const normalizeRole = (role) => ROLE_ALIASES[String(role || '').trim().toLowerCase()] || null;

const roleSatisfies = (actualRole, requiredRoles = []) => {
  const normalizedActualRole = normalizeRole(actualRole);
  if (!normalizedActualRole) {
    return false;
  }

  return requiredRoles
    .map((role) => normalizeRole(role))
    .filter(Boolean)
    .some((requiredRole) => ROLE_PRIORITY[normalizedActualRole] >= ROLE_PRIORITY[requiredRole]);
};

const mapLegacyUserRoleToOrganizationRole = (role) => {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === 'owner') return 'owner';
  if (normalizedRole === 'admin') return 'admin';
  if (normalizedRole === 'editor') return 'editor';
  return 'viewer';
};

const mapOrganizationRoleToLegacyUserRole = (role) => {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === 'owner' || normalizedRole === 'admin') return 'admin';
  if (normalizedRole === 'editor') return 'analyst';
  return 'viewer';
};

module.exports = {
  ORGANIZATION_ROLES,
  normalizeRole,
  roleSatisfies,
  mapLegacyUserRoleToOrganizationRole,
  mapOrganizationRoleToLegacyUserRole,
};
