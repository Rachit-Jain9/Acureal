'use strict';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(() => Promise.resolve('hashed-password')),
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
  resolveSignupAcceptance: jest.fn(),
  recordAcceptance: jest.fn(),
}));

const { query, transaction } = require('../src/config/database');
const {
  createWorkspaceForUser,
  hydrateUserAuthContext,
} = require('../src/services/organization.service');
const legalService = require('../src/services/legal.service');
const authService = require('../src/services/auth.service');

const setupTransactionMock = (clientImpl) => {
  transaction.mockImplementation(async (fn) => fn(clientImpl));
};

const stubExistingUserLookup = () => {
  // First query() call from register() is the duplicate-email lookup.
  query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
};

describe('auth.service.register — terms acceptance gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects (400) signup that does not echo current legal versions', async () => {
    stubExistingUserLookup();
    const err = Object.assign(new Error('You must accept ...'), { statusCode: 400 });
    legalService.resolveSignupAcceptance.mockRejectedValueOnce(err);

    await expect(
      authService.register('Jane', 'jane@example.com', 'Password1!', null, {
        // missing acceptedTermsVersion / acceptedPrivacyVersion
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(transaction).not.toHaveBeenCalled();
    expect(legalService.recordAcceptance).not.toHaveBeenCalled();
  });

  test('rejects (409) when a published version moved between page-load and submit', async () => {
    stubExistingUserLookup();
    const err = Object.assign(new Error('Terms updated'), { statusCode: 409 });
    legalService.resolveSignupAcceptance.mockRejectedValueOnce(err);

    await expect(
      authService.register('Jane', 'jane@example.com', 'Password1!', null, {
        acceptedTermsVersion: 'v0-stale',
        acceptedPrivacyVersion: 'v1',
      })
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(transaction).not.toHaveBeenCalled();
  });

  test('on success: writes user, creates workspace, records acceptance, returns token', async () => {
    stubExistingUserLookup();
    legalService.resolveSignupAcceptance.mockResolvedValueOnce([11, 22]);

    const client = { query: jest.fn() };
    client.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'user-99',
          email: 'jane@example.com',
          name: 'Jane',
          phone: null,
          is_active: true,
          default_organization_id: null,
        },
      ],
      rowCount: 1,
    });
    setupTransactionMock(client);
    createWorkspaceForUser.mockResolvedValueOnce(undefined);
    hydrateUserAuthContext.mockResolvedValueOnce({
      user: { id: 'user-99', email: 'jane@example.com', role: 'admin' },
    });

    const result = await authService.register(
      'Jane',
      'jane@example.com',
      'Password1!',
      null,
      {
        acceptedTermsVersion: 'v1',
        acceptedPrivacyVersion: 'v1',
        requestContext: { ipAddress: '203.0.113.7', userAgent: 'jest-test' },
      }
    );

    // Acceptance recorded inside the same transaction (passes the client).
    expect(legalService.recordAcceptance).toHaveBeenCalledWith(
      {
        userId: 'user-99',
        documentIds: [11, 22],
        ipAddress: '203.0.113.7',
        userAgent: 'jest-test',
      },
      client
    );

    expect(result).toEqual({
      user: { id: 'user-99', email: 'jane@example.com', role: 'admin' },
      token: 'signed-token',
    });
  });

  test('does not record acceptance if the workspace creation fails (transaction rollback)', async () => {
    stubExistingUserLookup();
    legalService.resolveSignupAcceptance.mockResolvedValueOnce([11, 22]);

    const client = { query: jest.fn() };
    client.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'user-100',
          email: 'fail@example.com',
          name: 'Fail Case',
          phone: null,
          is_active: true,
          default_organization_id: null,
        },
      ],
      rowCount: 1,
    });

    // Real transaction() rolls back on throw. We simulate that by having
    // transaction() rethrow the workspace error AFTER the inner fn runs.
    transaction.mockImplementation(async (fn) => {
      try {
        return await fn(client);
      } catch (e) {
        throw e;
      }
    });
    createWorkspaceForUser.mockRejectedValueOnce(new Error('workspace failed'));

    await expect(
      authService.register('Fail Case', 'fail@example.com', 'Password1!', null, {
        acceptedTermsVersion: 'v1',
        acceptedPrivacyVersion: 'v1',
      })
    ).rejects.toThrow('workspace failed');

    // recordAcceptance should not have been reached because the workspace
    // failure happens earlier inside the transaction body.
    expect(legalService.recordAcceptance).not.toHaveBeenCalled();
  });
});
