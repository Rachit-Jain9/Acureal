const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, transaction } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const {
  consumeInvitation,
  createWorkspaceForUser,
  hydrateUserAuthContext,
} = require('./organization.service');
const { mapOrganizationRoleToLegacyUserRole } = require('../constants/roles');

const SALT_ROUNDS = 12;

const getJwtSecret = () => {
  const configuredSecret = process.env.JWT_SECRET;

  if (configuredSecret && !/your[_-]/i.test(configuredSecret)) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw createError('JWT_SECRET is not configured.', 500);
  }

  return 'redip-dev-jwt-secret-change-me-please';
};

const generateToken = (userId, role) =>
  jwt.sign(
    { userId, role },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

const isOrganizationAccessDenied = (error) =>
  error?.statusCode === 403 && error?.message === 'Organization access denied.';

const resolveLoginAuthContext = async (userId, requestedOrganizationId, defaultOrganizationId) => {
  try {
    return await hydrateUserAuthContext(userId, requestedOrganizationId);
  } catch (error) {
    if (!isOrganizationAccessDenied(error)) {
      throw error;
    }

    if (requestedOrganizationId) {
      try {
        return await hydrateUserAuthContext(userId, null);
      } catch (retryError) {
        if (!isOrganizationAccessDenied(retryError) || !defaultOrganizationId) {
          throw retryError;
        }
      }
    } else if (!defaultOrganizationId) {
      throw error;
    }

    await query(
      'UPDATE users SET default_organization_id = NULL, updated_at = NOW() WHERE id = $1',
      [userId]
    );

    return hydrateUserAuthContext(userId, null);
  }
};

// Cold signup (no invitation token) creates a brand-new workspace and grants
// the registrant Owner role on it. Without a gate, anyone who finds the
// /register URL can stand up their own workspace — fine for solo tenancy but
// risks brand-spoofed invites and quota abuse if the URL leaks.
//
// Default-deny: cold signup is blocked unless ALLOW_COLD_SIGNUP=true. Invite-
// based registration is always allowed regardless of this flag.
const isColdSignupAllowed = () => {
  const value = String(process.env.ALLOW_COLD_SIGNUP || '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
};

const register = async (name, email, password, phone = null, options = {}) => {
  const normalizedEmail = email.toLowerCase();
  const existingUser = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);

  if (existingUser.rows.length > 0) {
    throw createError('An account with this email already exists.', 409);
  }

  if (!options.invitationToken && !isColdSignupAllowed()) {
    throw createError(
      'Sign-up is by invitation only. Please ask your workspace admin to invite you.',
      403
    );
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  return transaction(async (client) => {
    const defaultLegacyRole = options.invitationToken
      ? mapOrganizationRoleToLegacyUserRole(options.invitedRole || 'viewer')
      : 'admin';

    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, name, role, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, phone, is_active, default_organization_id`,
      [normalizedEmail, passwordHash, name, defaultLegacyRole, phone]
    );

    const user = userResult.rows[0];

    if (options.invitationToken) {
      await consumeInvitation(client, {
        userId: user.id,
        email: normalizedEmail,
        invitationToken: options.invitationToken,
      });
    } else {
      await createWorkspaceForUser(client, {
        userId: user.id,
        name,
        email: normalizedEmail,
        organizationName: options.organizationName,
      });
    }

    const authContext = await hydrateUserAuthContext(user.id, null, client);
    const token = generateToken(authContext.user.id, authContext.user.role);

    return { user: authContext.user, token };
  });
};

const login = async (email, password, requestedOrganizationId = null) => {
  const result = await query(
    `SELECT id, email, password_hash, name, phone, is_active, last_login_at, default_organization_id
     FROM users
     WHERE email = $1`,
    [email.toLowerCase()]
  );

  if (result.rows.length === 0) {
    throw createError('Invalid email or password.', 401);
  }

  const user = result.rows[0];

  if (!user.is_active) {
    throw createError('Your account has been deactivated. Please contact the administrator.', 403);
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    throw createError('Invalid email or password.', 401);
  }

  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

  const authContext = await resolveLoginAuthContext(
    user.id,
    requestedOrganizationId,
    user.default_organization_id
  );
  const token = generateToken(authContext.user.id, authContext.user.role);

  return { user: authContext.user, token };
};

const getUserById = async (id, requestedOrganizationId = null) => {
  const authContext = await hydrateUserAuthContext(id, requestedOrganizationId);

  const result = await query(
    `SELECT id, email, name, phone, is_active, last_login_at, created_at, updated_at, default_organization_id
     FROM users
     WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    throw createError('User not found.', 404);
  }

  return {
    ...authContext.user,
    last_login_at: result.rows[0].last_login_at,
    created_at: result.rows[0].created_at,
    updated_at: result.rows[0].updated_at,
  };
};

const updateUser = async (id, data, requestedOrganizationId = null) => {
  const allowedFields = ['name', 'phone'];
  const updates = [];
  const values = [];
  let paramCount = 1;

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updates.push(`${field} = $${paramCount}`);
      values.push(data[field]);
      paramCount++;
    }
  }

  if (data.newPassword && data.currentPassword) {
    const userResult = await query('SELECT password_hash FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) {
      throw createError('User not found.', 404);
    }

    const isValid = await bcrypt.compare(data.currentPassword, userResult.rows[0].password_hash);
    if (!isValid) {
      throw createError('Current password is incorrect.', 400);
    }

    const newHash = await bcrypt.hash(data.newPassword, SALT_ROUNDS);
    updates.push(`password_hash = $${paramCount}`);
    values.push(newHash);
    paramCount++;
  }

  if (updates.length === 0) {
    throw createError('No valid fields to update.', 400);
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const result = await query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}
     RETURNING id`,
    values
  );

  if (result.rows.length === 0) {
    throw createError('User not found.', 404);
  }

  return getUserById(id, requestedOrganizationId);
};

module.exports = {
  register,
  login,
  getUserById,
  updateUser,
  getJwtSecret,
};
