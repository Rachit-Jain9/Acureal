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

jest.mock('../src/services/legal.service', () => ({
  resolveSignupAcceptance: jest.fn().mockResolvedValue([1, 2]),
  recordAcceptance: jest.fn().mockResolvedValue(undefined),
}));

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../src/config/database');
const { hydrateUserAuthContext } = require('../src/services/organization.service');
const legalService = require('../src/services/legal.service');
const authService = require('../src/services/auth.service');

const makeAccessDeniedError = () => {
  const error = new Error('Organization access denied.');
  error.statusCode = 403;
  return error;
};

describe('auth.service register cold-signup gate', () => {
  const originalFlag = process.env.ALLOW_COLD_SIGNUP;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ALLOW_COLD_SIGNUP;
  });

  afterAll(() => {
    if (originalFlag === undefined) {
      delete process.env.ALLOW_COLD_SIGNUP;
    } else {
      process.env.ALLOW_COLD_SIGNUP = originalFlag;
    }
  });

  test('rejects cold signup with 403 when ALLOW_COLD_SIGNUP is not enabled', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // no existing user

    await expect(
      authService.register('Stranger', 'stranger@example.com', 'Password123', null, {})
    ).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringMatching(/by invitation only/i),
    });

    // Gate must short-circuit before any password hashing or DB writes
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  test('allows cold signup when ALLOW_COLD_SIGNUP=true', async () => {
    process.env.ALLOW_COLD_SIGNUP = 'true';
    query.mockResolvedValueOnce({ rows: [] }); // no existing user
    bcrypt.hash.mockResolvedValue('hashed');

    const { transaction } = require('../src/config/database');
    transaction.mockImplementation(async (fn) => {
      const fakeClient = {
        query: jest.fn().mockResolvedValueOnce({
          rows: [{
            id: 'new-user',
            email: 'newuser@example.com',
            name: 'New User',
            phone: null,
            is_active: true,
            default_organization_id: null,
          }],
        }),
      };
      hydrateUserAuthContext.mockResolvedValue({ user: { id: 'new-user', role: 'owner' } });
      return fn(fakeClient);
    });

    const result = await authService.register(
      'New User', 'newuser@example.com', 'Password123', null, {}
    );

    expect(bcrypt.hash).toHaveBeenCalled();
    expect(result.token).toBe('signed-token');
  });

  test('always allows invitation-based signup regardless of flag', async () => {
    delete process.env.ALLOW_COLD_SIGNUP;
    query.mockResolvedValueOnce({ rows: [] });
    bcrypt.hash.mockResolvedValue('hashed');

    const { transaction } = require('../src/config/database');
    const { consumeInvitation } = require('../src/services/organization.service');
    transaction.mockImplementation(async (fn) => {
      const fakeClient = {
        query: jest.fn().mockResolvedValueOnce({
          rows: [{
            id: 'invited-user',
            email: 'invited@example.com',
            name: 'Invited User',
            phone: null,
            is_active: true,
            default_organization_id: null,
          }],
        }),
      };
      hydrateUserAuthContext.mockResolvedValue({ user: { id: 'invited-user', role: 'editor' } });
      return fn(fakeClient);
    });

    await authService.register(
      'Invited User', 'invited@example.com', 'Password123', null, { invitationToken: 'tok-123' }
    );

    expect(consumeInvitation).toHaveBeenCalled();
  });
});

describe('auth.service login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // The throttle helper issues a SELECT against login_attempts as its first
  // call inside login(). Tests that expect login to succeed have to provide
  // an empty result for that lookup.
  const noActiveLock = { rows: [] };

  test('retries login without a stale requested organization id', async () => {
    query
      .mockResolvedValueOnce(noActiveLock) // enforceLoginThrottle
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
      }) // SELECT user
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // clearLoginAttempts
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE last_login_at

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
      .mockResolvedValueOnce(noActiveLock) // enforceLoginThrottle
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
      }) // SELECT user
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // clearLoginAttempts
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // UPDATE last_login_at
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE default_organization_id (stale clear)

    bcrypt.compare.mockResolvedValue(true);
    hydrateUserAuthContext
      .mockRejectedValueOnce(makeAccessDeniedError())
      .mockResolvedValueOnce({
        user: { id: 'user-2', role: 'editor' },
      });

    const result = await authService.login('user2@example.com', 'password');

    expect(hydrateUserAuthContext).toHaveBeenNthCalledWith(1, 'user-2', null);
    expect(hydrateUserAuthContext).toHaveBeenNthCalledWith(2, 'user-2', null);
    expect(query).toHaveBeenCalledWith(
      'UPDATE users SET default_organization_id = NULL, updated_at = NOW() WHERE id = $1',
      ['user-2']
    );
    expect(result).toEqual({
      user: { id: 'user-2', role: 'editor' },
      token: 'signed-token',
    });
  });
});

describe('auth.service login throttle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects with 429 when account has an active lock', async () => {
    query.mockResolvedValueOnce({
      rows: [{ locked_until: new Date(Date.now() + 5 * 60 * 1000).toISOString() }],
    });

    await expect(
      authService.login('locked@example.com', 'whatever')
    ).rejects.toMatchObject({
      statusCode: 429,
      message: expect.stringMatching(/too many failed sign-in attempts/i),
    });

    // Should not have proceeded to user lookup or password compare.
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('records a failed attempt when password is wrong', async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // enforceLoginThrottle — no lock
      .mockResolvedValueOnce({
        rows: [{
          id: 'user-3',
          email: 'user3@example.com',
          password_hash: 'hashed-password',
          name: 'User Three',
          phone: null,
          is_active: true,
          last_login_at: null,
          default_organization_id: null,
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // recordFailedLogin

    bcrypt.compare.mockResolvedValue(false);

    await expect(
      authService.login('user3@example.com', 'bad-password')
    ).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid email or password.',
    });

    // Third query call should be the upsert into login_attempts.
    const recordCall = query.mock.calls[2];
    expect(recordCall[0]).toMatch(/INSERT INTO login_attempts/i);
    expect(recordCall[1][0]).toBe('user3@example.com');
  });

  test('records a failed attempt when email does not exist', async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // enforceLoginThrottle — no lock
      .mockResolvedValueOnce({ rows: [] }) // SELECT user — not found
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // recordFailedLogin

    await expect(
      authService.login('nobody@example.com', 'irrelevant')
    ).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid email or password.',
    });

    // Unknown emails are throttled too — prevents account-existence leak.
    const recordCall = query.mock.calls[2];
    expect(recordCall[0]).toMatch(/INSERT INTO login_attempts/i);
    expect(recordCall[1][0]).toBe('nobody@example.com');
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  test('clears throttle row on successful login', async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // enforceLoginThrottle
      .mockResolvedValueOnce({
        rows: [{
          id: 'user-4',
          email: 'user4@example.com',
          password_hash: 'hashed-password',
          name: 'User Four',
          phone: null,
          is_active: true,
          last_login_at: null,
          default_organization_id: null,
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // clearLoginAttempts
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE last_login_at

    bcrypt.compare.mockResolvedValue(true);
    hydrateUserAuthContext.mockResolvedValueOnce({
      user: { id: 'user-4', role: 'admin' },
    });

    await authService.login('user4@example.com', 'correct-password');

    const clearCall = query.mock.calls[2];
    expect(clearCall[0]).toMatch(/DELETE FROM login_attempts/i);
    expect(clearCall[1]).toEqual(['user4@example.com']);
  });
});
