/**
 * M1 Phase 2 — definer-path routing (auth.service + mfa.service).
 *
 * With the probe forced TRUE these tests pin, per call site:
 *   • the SECURITY DEFINER function is called (never the inline SQL),
 *   • auth_provision_signup receives its 19 args in signature order,
 *   • the SINGLE-CANDIDATE domain contract (byte-parity with
 *     joinByVerifiedDomain: hosted domain wins outright, no email fallback,
 *     public providers filtered, invitation suppresses domain join),
 *   • context is stamped and hydrate retried per the provisioning contract.
 * With the probe left FALSE (the default in the test env) the byte-identical
 * fallback is exercised by the existing auth suites — not re-tested here.
 */

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('hashed-pw'),
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'signed-token'),
}));

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/services/organization.service', () => {
  const actual = jest.requireActual('../src/services/organization.service');
  return {
    // Real pure helpers — the workspace-name/slug parity is part of what we pin.
    assertInvitationUsable: actual.assertInvitationUsable,
    deriveWorkspaceName: actual.deriveWorkspaceName,
    slugifyOrganizationName: actual.slugifyOrganizationName,
    consumeInvitation: jest.fn(),
    createWorkspaceForUser: jest.fn(),
    joinByVerifiedDomain: jest.fn(),
    hydrateUserAuthContext: jest.fn(),
  };
});

jest.mock('../src/services/legal.service', () => ({
  resolveSignupAcceptance: jest.fn().mockResolvedValue([1, 2]),
  recordAcceptance: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/utils/passwordBreach', () => ({
  isPasswordBreached: jest.fn().mockResolvedValue({ breached: false }),
}));

const bcrypt = require('bcryptjs');
const { query, transaction } = require('../src/config/database');
const { hydrateUserAuthContext } = require('../src/services/organization.service');
const { __forceForTests, __resetForTests } = require('../src/lib/authDefiners');
const authService = require('../src/services/auth.service');
const mfaService = require('../src/services/mfa.service');

const AUTH_CONTEXT = {
  user: { id: 'uid-1', role: 'admin', organization_id: 'org-1', email: 'a@b.c' },
};

beforeEach(() => {
  jest.clearAllMocks();
  // mockReset (not just clear): clearAllMocks does NOT drain unconsumed
  // mockResolvedValueOnce queues, so one failed test would leak stale queue
  // entries into every later test in the file.
  query.mockReset();
  transaction.mockReset();
  __forceForTests(true);
  hydrateUserAuthContext.mockResolvedValue(AUTH_CONTEXT);
});

afterEach(() => {
  __resetForTests();
});

const provisionCall = () =>
  query.mock.calls.find(([sql]) => /auth_provision_signup/.test(sql));

describe('login() routes the email lookup through auth_find_user_for_login', () => {
  test('definer path replaces the inline users SELECT', async () => {
    query
      // enforceLoginThrottle SELECT (login_attempts — runs FIRST)
      .mockResolvedValueOnce({ rows: [] })
      // definer email lookup
      .mockResolvedValueOnce({
        rows: [{
          id: 'uid-1', email: 'a@b.c', password_hash: 'h', name: 'A', phone: null,
          is_active: true, last_login_at: null, default_organization_id: null,
          account_closed_at: null, erased_at: null,
        }],
      })
      // clearLoginAttempts DELETE
      .mockResolvedValueOnce({ rows: [] })
      // mfa isMfaRequired self-read (not enrolled)
      .mockResolvedValueOnce({ rows: [{ mfa_enrolled_at: null }] })
      // last_login_at UPDATE
      .mockResolvedValueOnce({ rows: [] });
    bcrypt.compare.mockResolvedValue(true);

    const result = await authService.login('a@b.c', 'pw');

    const lookup = query.mock.calls.find(([sql]) => /auth_find_user_for_login/.test(sql));
    expect(lookup).toBeDefined();
    expect(lookup[1]).toEqual(['a@b.c']);
    expect(query.mock.calls.some(([sql]) => /FROM users\s+WHERE email/i.test(sql))).toBe(false);
    expect(result.token).toBe('signed-token');
  });
});

describe('register() definer branch — auth_provision_signup', () => {
  test('19 args in signature order; transaction() never called; hydrate follows', async () => {
    query
      // dup-check via definer
      .mockResolvedValueOnce({ rows: [] })
      // provisioning call
      .mockResolvedValueOnce({ rows: [{ id: 'new-uid' }] });

    const result = await authService.register(
      'New User', 'user@corp-example.com', 'Str0ng!Passw0rd', '9999999999',
      {
        acceptedTermsVersion: '1', acceptedPrivacyVersion: '1',
        company: 'Acme', jobTitle: 'VP', city: 'Bengaluru',
        requestContext: { ipAddress: '1.2.3.4', userAgent: 'jest' },
      }
    );

    expect(transaction).not.toHaveBeenCalled();

    const call = provisionCall();
    expect(call).toBeDefined();
    expect(call[1]).toEqual([
      'user@corp-example.com',        // p_email
      'hashed-pw',                    // p_password_hash
      'New User',                     // p_name
      'admin',                        // p_role (no invitation → admin)
      '9999999999',                   // p_phone
      null,                           // p_oauth_provider
      null,                           // p_oauth_subject
      false,                          // p_email_verified
      true,                           // p_password_set
      'Acme',                         // p_company
      'VP',                           // p_job_title
      'Bengaluru',                    // p_city
      null,                           // p_invitation_token
      ['corp-example.com'],           // p_domain_candidates (single candidate)
      "New User's Workspace",         // p_workspace_name (real deriveWorkspaceName)
      'new-user-s-workspace',         // p_workspace_slug_base (real slugify)
      [1, 2],                         // p_legal_document_ids
      '1.2.3.4',                      // p_ip
      'jest',                         // p_user_agent
    ]);

    expect(hydrateUserAuthContext).toHaveBeenCalledWith('new-uid', null);
    expect(result.token).toBe('signed-token');
  });

  test('public email domains produce NO domain candidates', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'new-uid' }] });

    await authService.register('G User', 'guser@gmail.com', 'Str0ng!Passw0rd', null, {
      acceptedTermsVersion: '1', acceptedPrivacyVersion: '1',
    });

    expect(provisionCall()[1][13]).toBeNull(); // p_domain_candidates
  });

  test('an invalid invitation surfaces the friendly 404 BEFORE provisioning runs', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })  // dup-check
      .mockResolvedValueOnce({ rows: [] }); // auth_find_invitation → no row

    await expect(
      authService.register('I User', 'invited@corp.com', 'Str0ng!Passw0rd', null, {
        acceptedTermsVersion: '1', acceptedPrivacyVersion: '1',
        invitationToken: 'tok-x', invitedRole: 'editor',
      })
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(provisionCall()).toBeUndefined();
  });

  test('hydrate is retried once; second failure yields the truthful "please log in" 500', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'new-uid' }] });
    hydrateUserAuthContext
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient again'));

    await expect(
      authService.register('R User', 'r@corp.com', 'Str0ng!Passw0rd', null, {
        acceptedTermsVersion: '1', acceptedPrivacyVersion: '1',
      })
    ).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringMatching(/account was created.*log in/i),
    });

    expect(hydrateUserAuthContext).toHaveBeenCalledTimes(2);
  });
});

describe('Google cold-signup definer branch — single-candidate domain contract', () => {
  const mockGoogleVerify = (claims) => {
    jest.spyOn(require('../src/lib/oauthGoogle'), 'verifyIdToken').mockResolvedValue(claims);
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('hosted domain wins OUTRIGHT — no fallback to the email domain (joinByVerifiedDomain parity)', async () => {
    mockGoogleVerify({
      provider: 'google', subject: 'sub-1', email: 'user@other-corp.com',
      emailVerified: true, name: 'HD User', hostedDomain: 'hosted-corp.com',
    });
    query
      .mockResolvedValueOnce({ rows: [] })  // path A oauth lookup
      .mockResolvedValueOnce({ rows: [] })  // path B email lookup
      .mockResolvedValueOnce({ rows: [{ id: 'g-uid' }] }); // provisioning

    const result = await authService.loginOrRegisterWithGoogle('id-token', {
      acceptedTermsVersion: '1', acceptedPrivacyVersion: '1',
    });

    const call = provisionCall();
    expect(call[1][13]).toEqual(['hosted-corp.com']); // NOT [..., 'other-corp.com']
    expect(call[1][5]).toBe('google');   // p_oauth_provider
    expect(call[1][6]).toBe('sub-1');    // p_oauth_subject
    expect(call[1][7]).toBe(true);       // p_email_verified
    expect(call[1][8]).toBe(false);      // p_password_set
    expect(call[1][4]).toBeNull();       // p_phone
    expect(result.mode).toBe('register');
  });

  test('path A/B lookups route through the definer functions', async () => {
    mockGoogleVerify({
      provider: 'google', subject: 'sub-2', email: 'ret@corp.com',
      emailVerified: true, name: 'Returning',
    });
    query
      .mockResolvedValueOnce({
        rows: [{ id: 'uid-9', is_active: true, oauth_provider: 'google', oauth_subject: 'sub-2' }],
      })
      .mockResolvedValueOnce({ rows: [] }); // last_login UPDATE

    const result = await authService.loginOrRegisterWithGoogle('id-token', {});

    expect(query.mock.calls[0][0]).toContain('public.auth_find_user_by_oauth($1, $2)');
    expect(query.mock.calls[0][1]).toEqual(['google', 'sub-2']);
    expect(result.mode).toBe('login');
  });
});

describe('mfa.verifyChallenge routes through auth_find_mfa_challenge', () => {
  test('definer path replaces the mfa_challenges JOIN users query', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    query
      .mockResolvedValueOnce({
        rows: [{ id: 'ch-1', user_id: 'uid-7', expires_at: future, consumed_at: null, mfa_secret: 'JBSWY3DPEHPK3PXP' }],
      })
      .mockResolvedValueOnce({ rows: [] })  // consume UPDATE
      .mockResolvedValueOnce({ rows: [] }); // mfa_last_used_at UPDATE
    jest.spyOn(require('otplib').authenticator, 'check').mockReturnValue(true);

    const result = await mfaService.verifyChallenge({ challenge: 'ch-raw', code: '123456' });

    expect(query.mock.calls[0][0]).toContain('public.auth_find_mfa_challenge($1)');
    // Challenges are stored hashed at rest — the lookup param is sha256(raw).
    const challengeHash = require('crypto').createHash('sha256').update('ch-raw').digest('hex');
    expect(query.mock.calls[0][1]).toEqual([challengeHash]);
    expect(result).toEqual({ userId: 'uid-7', usedRecoveryCode: false });
    jest.restoreAllMocks();
  });
});
