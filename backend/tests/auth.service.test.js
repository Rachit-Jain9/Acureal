jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'signed-token'),
}));

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/services/organization.service', () => ({
  consumeInvitation: jest.fn(),
  createWorkspaceForUser: jest.fn(),
  hydrateUserAuthContext: jest.fn(),
}));

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../src/config/database');
const { hydrateUserAuthContext } = require('../src/services/organization.service');
const authService = require('../src/services/auth.service');

const makeAccessDeniedError = () => {
  const error = new Error('Organization access denied.');
  error.statusCode = 403;
  return error;
};

describe('auth.service login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('retries login without a stale requested organization id', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'user-1',
          email: 'user@example.com',
          password_hash: 'hashed-password',
          name: 'User One',
          phone: null,
          is_active: true,
          last_login_at: null,
          default_organization_id: 'org-default',
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    bcrypt.compare.mockResolvedValue(true);
    hydrateUserAuthContext
      .mockRejectedValueOnce(makeAccessDeniedError())
      .mockResolvedValueOnce({
        user: { id: 'user-1', role: 'admin' },
      });

    const result = await authService.login('user@example.com', 'password', 'org-stale');

    expect(hydrateUserAuthContext).toHaveBeenNthCalledWith(1, 'user-1', 'org-stale');
    expect(hydrateUserAuthContext).toHaveBeenNthCalledWith(2, 'user-1', null);
    expect(query).not.toHaveBeenCalledWith(
      'UPDATE users SET default_organization_id = NULL, updated_at = NOW() WHERE id = $1',
      ['user-1']
    );
    expect(jwt.sign).toHaveBeenCalledWith(
      { userId: 'user-1', role: 'admin' },
      expect.any(String),
      { expiresIn: expect.any(String) }
    );
    expect(result).toEqual({
      user: { id: 'user-1', role: 'admin' },
      token: 'signed-token',
    });
  });

  test('clears a stale default organization id before retrying login', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'user-2',
          email: 'user2@example.com',
          password_hash: 'hashed-password',
          name: 'User Two',
          phone: null,
          is_active: true,
          last_login_at: null,
          default_organization_id: 'org-stale',
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    bcrypt.compare.mockResolvedValue(true);
    hydrateUserAuthContext
      .mockRejectedValueOnce(makeAccessDeniedError())
      .mockResolvedValueOnce({
        user: { id: 'user-2', role: 'editor' },
      });

    const result = await authService.login('user2@example.com', 'password');

    expect(hydrateUserAuthContext).toHaveBeenNthCalledWith(1, 'user-2', null);
    expect(hydrateUserAuthContext).toHaveBeenNthCalledWith(2, 'user-2', null);
    expect(query).toHaveBeenNthCalledWith(
      3,
      'UPDATE users SET default_organization_id = NULL, updated_at = NOW() WHERE id = $1',
      ['user-2']
    );
    expect(result).toEqual({
      user: { id: 'user-2', role: 'editor' },
      token: 'signed-token',
    });
  });
});
