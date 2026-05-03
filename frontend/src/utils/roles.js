// Frontend mirror of backend/src/constants/roles.js. Keep in sync — if the
// priority table or alias map changes there, change it here too. Sidebar and
// other UI gating should use roleSatisfies(); raw role-equality checks (like
// `user.role === 'admin'`) miss the editor/analyst alias and the priority
// ordering.

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

export function normalizeRole(role) {
  return ROLE_ALIASES[String(role || '').trim().toLowerCase()] || null;
}

export function roleSatisfies(actualRole, requiredRoles = []) {
  const normalized = normalizeRole(actualRole);
  if (!normalized) return false;
  const required = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  return required
    .map(normalizeRole)
    .filter(Boolean)
    .some((r) => ROLE_PRIORITY[normalized] >= ROLE_PRIORITY[r]);
}

export const ROLE_LABEL = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};
