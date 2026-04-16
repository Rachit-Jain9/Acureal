const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');

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

const generateToken = (userId, role) => {
  return jwt.sign(
    { userId, role },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

const register = async (name, email, password, role = 'analyst', phone = null) => {
  // Check if email already exists
  const existingUser = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existingUser.rows.length > 0) {
    throw createError('An account with this email already exists.', 409);
  }

  // Validate role
  const allowedRoles = ['admin', 'analyst', 'viewer'];
  if (!allowedRoles.includes(role)) {
    throw createError(`Invalid role. Must be one of: ${allowedRoles.join(', ')}`, 400);
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await query(
    `INSERT INTO users (email, password_hash, name, role, phone)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, name, role, phone, created_at`,
    [email.toLowerCase(), passwordHash, name, role, phone]
  );

  const user = result.rows[0];
  const token = generateToken(user.id, user.role);

  return { user, token };
};

const login = async (email, password) => {
  const result = await query(
    'SELECT id, email, password_hash, name, role, phone, is_active, last_login_at FROM users WHERE email = $1',
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

  // Update last login
  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

  const token = generateToken(user.id, user.role);

  const { password_hash, ...userWithoutPassword } = user;

  return { user: userWithoutPassword, token };
};

const getUserById = async (id) => {
  const result = await query(
    'SELECT id, email, name, role, phone, is_active, last_login_at, created_at, updated_at FROM users WHERE id = $1',
    [id]
  );

  if (result.rows.length === 0) {
    throw createError('User not found.', 404);
  }

  return result.rows[0];
};

const updateUser = async (id, data) => {
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

  // Handle password change separately
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

  updates.push(`updated_at = NOW()`);
  values.push(id);

  const result = await query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}
     RETURNING id, email, name, role, phone, is_active, created_at, updated_at`,
    values
  );

  if (result.rows.length === 0) {
    throw createError('User not found.', 404);
  }

  return result.rows[0];
};

const listUsers = async () => {
  const result = await query(
    'SELECT id, email, name, role, phone, is_active, last_login_at, created_at FROM users ORDER BY created_at DESC'
  );
  return result.rows;
};

const toggleUserStatus = async (id, isActive, requestingUserId) => {
  if (id === requestingUserId) {
    throw createError('You cannot deactivate your own account.', 400);
  }

  const result = await query(
    'UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, name, role, is_active',
    [isActive, id]
  );

  if (result.rows.length === 0) {
    throw createError('User not found.', 404);
  }

  return result.rows[0];
};

module.exports = { register, login, getUserById, updateUser, listUsers, toggleUserStatus, getJwtSecret };
