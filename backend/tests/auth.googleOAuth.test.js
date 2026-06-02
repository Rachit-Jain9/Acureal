jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('hashed-unusable'),
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
  joinByVerifiedDomain: jest.fn(),
}));

jest.mock('../src/services/legal.service', () => ({
  resolveSignupAcceptance: jest.fn().mockResolvedValue([1, 2]),
  recordAcceptance: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/lib/oauthGoogle', () => ({
  isConfigured: jest.fn(() => true),
  getClientId: jest.fn(() => 'client-id.apps.googleusercontent.com'),
  verifyIdToken: jest.fn(),
}));

const { query, transaction } = require('../src/config/database');
const googleOAuth = require('../src/lib/oauthGoogle');
const {
  hydrateUserAuthContext,
  createWorkspaceForUser,
} = require('../src/services/organization.service');
const authService = require('../src/services/auth.service');

const validClaims = {
  provider: 'google',
  subject: 'google-sub-12345',
  email: 'user@example.com',
  emailVerified: true,
  name: 'Real Estate Pro',
  picture: null,
  hostedDomain: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('auth.service.loginOrRegisterWithGoogle — token validation', () => {
  test('rejects when Google reports email_verified=false', async () => {
    googleOAuth.verifyIdToken.mockResolvedValueOnce({ ...validClaims, emailVerified: false });

    await expect(
      authService.loginOrRegisterWithGoogle('id-token', {})
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/google account email is not verified/i),
    });

    expect(query).not.toHaveBeenCalled();
  });

  test('rejects when Google does not return an email', async () => {
    googleOAuth.verifyIdToken.mockResolvedValueOnce({ ...validClaims, email: null });

    await expect(
      authService.loginOrRegisterWithGoogle('id-token', {})
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/google did not return an email/i),
    });
  });
});

describe('auth.service.loginOrRegisterWithGoogle — Path A (returning user by identity)', () => {
  test('logs in an existing user matched by (provider, subject)', async () => {
    googleOAuth.verifyIdToken.mockResolvedValueOnce(validClaims);
    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'user-1',
          email: 'user@example.com',
          name: 'Real Estate Pro',
          phone: null,
          is_active: true,
          default_organization_id: 'org-1',
          oauth_provider: 'google',
          oauth_subject: 'google-sub-12345',
          email_verified_at: new Date().toISOString(),
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE last_login_at

    hydrateUserAuthContext.mockResolvedValueOnce({
      user: { id: 'user-1', role: 'admin' },
    });

    const result = await authService.loginOrRegisterWithGoogle('id-token', {});

    expect(result).toMatchObject({
      user: { id: 'user-1', role: 'admin' },
      token: 'signed-token',
      mode: 'login',
    });

    // Should not have entered the new-workspace creation transaction.
    expect(transaction).not.toHaveBeenCalled();
    expect(createWorkspaceForUser).not.toHaveBeenCalled();
  });

  test('rejects deactivated identity-matched user', async () => {
    googleOAuth.verifyIdToken.mockResolvedValueOnce(validClaims);
    query.mockResolvedValueOnce({
      rows: [{
        id: 'user-1',
        email: 'user@example.com',
        is_active: false,
        oauth_provider: 'google',
        oauth_subject: 'google-sub-12345',
      }],
    });

    await expect(
      authService.loginOrRegisterWithGoogle('id-token', {})
    ).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringMatching(/account has been deactivated/i),
    });
  });
});

describe('auth.service.loginOrRegisterWithGoogle — Path B (account linking)', () => {
  test('binds Google identity to a password-only user with the same email', async () => {
    googleOAuth.verifyIdToken.mockResolvedValueOnce(validClaims);
    query
      .mockResolvedValueOnce({ rows: [] }) // identity lookup miss
      .mockResolvedValueOnce({
        rows: [{
          id: 'user-2',
          email: 'user@example.com',
          is_active: true,
          oauth_provider: null,
          oauth_subject: null,
          default_organization_id: 'org-1',
        }],
      }) // email match
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE bind

    hydrateUserAuthContext.mockResolvedValueOnce({
      user: { id: 'user-2', role: 'editor' },
    });

    const result = await authService.loginOrRegisterWithGoogle('id-token', {});

    expect(result.mode).toBe('bound');

    const updateCall = query.mock.calls[2];
    expect(updateCall[0]).toMatch(/UPDATE users[\s\S]*oauth_provider/i);
    expect(updateCall[0]).toMatch(/email_verified_at\s*=\s*COALESCE/i);
    expect(updateCall[1]).toEqual(['user-2', 'google', 'google-sub-12345']);
  });

  test('refuses to rebind when the email is already tied to a DIFFERENT provider', async () => {
    googleOAuth.verifyIdToken.mockResolvedValueOnce(validClaims);
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'user-3',
          email: 'user@example.com',
          is_active: true,
          oauth_provider: 'microsoft',
          oauth_subject: 'ms-sub',
        }],
      });

    await expect(
      authService.loginOrRegisterWithGoogle('id-token', {})
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/different sign-in method/i),
    });
  });

  test('refuses to rebind when the same provider returns a DIFFERENT subject for the email', async () => {
    googleOAuth.verifyIdToken.mockResolvedValueOnce(validClaims);
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'user-4',
          email: 'user@example.com',
          is_active: true,
          oauth_provider: 'google',
          oauth_subject: 'OLD-SUBJECT',
        }],
      });

    await expect(
      authService.loginOrRegisterWithGoogle('id-token', {})
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/different google identity/i),
    });
  });
});

describe('auth.service.loginOrRegisterWithGoogle — Path C (new workspace)', () => {
  test('creates a fresh workspace for a brand-new Google identity', async () => {
    googleOAuth.verifyIdToken.mockResolvedValueOnce(validClaims);
    query
      .mockResolvedValueOnce({ rows: [] }) // identity miss
      .mockResolvedValueOnce({ rows: [] }); // email miss

    transaction.mockImplementation(async (fn) => {
      const fakeClient = {
        query: jest.fn().mockResolvedValueOnce({
          rows: [{
            id: 'new-user',
            email: 'user@example.com',
            name: 'Real Estate Pro',
            phone: null,
            is_active: true,
            default_organization_id: null,
          }],
        }),
      };
      hydrateUserAuthContext.mockResolvedValue({
        user: { id: 'new-user', role: 'owner' },
      });
      return fn(fakeClient);
    });

    const result = await authService.loginOrRegisterWithGoogle('id-token', {
      acceptedTermsVersion: 'v1',
      acceptedPrivacyVersion: 'v1',
    });

    expect(result.mode).toBe('register');
    expect(result.token).toBe('signed-token');
    expect(createWorkspaceForUser).toHaveBeenCalled();
  });
});
