jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/lib/logger', () => {
  const child = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child };
});

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,FAKE'),
}));

const { authenticator } = require('otplib');
const { query } = require('../src/config/database');
const mfa = require('../src/services/mfa.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('mfa.beginEnrollment', () => {
  test('generates secret + recovery codes + QR data url', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ mfa_enrolled_at: null }] })  // existing check
      .mockResolvedValueOnce({ rowCount: 1 });                        // UPDATE

    const out = await mfa.beginEnrollment('u-1', 'rachit@example.com');
    expect(out.secret).toBeTruthy();
    expect(out.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(Array.isArray(out.recoveryCodes)).toBe(true);
    expect(out.recoveryCodes.length).toBe(8);
    expect(out.recoveryCodes[0]).toMatch(/^[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}$/);
    // Secret persisted; mfa_enrolled_at not yet set
    const updateArgs = query.mock.calls[1];
    expect(updateArgs[0]).toMatch(/UPDATE users[\s\S]+mfa_secret = \$2/);
    expect(updateArgs[1][1]).toBe(out.secret);
  });

  test('refuses when MFA already enabled', async () => {
    query.mockResolvedValueOnce({ rows: [{ mfa_enrolled_at: '2026-04-01T00:00:00Z' }] });
    await expect(mfa.beginEnrollment('u-1', 'a@b.com')).rejects.toThrow(/already enabled/i);
  });

  test('throws when userId missing', async () => {
    await expect(mfa.beginEnrollment(null)).rejects.toThrow(/userId required/);
  });
});

describe('mfa.verifyEnrollment', () => {
  test('valid code → sets mfa_enrolled_at', async () => {
    const secret = authenticator.generateSecret();
    const code = authenticator.generate(secret);
    query
      .mockResolvedValueOnce({ rows: [{ mfa_secret: secret, mfa_enrolled_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    const out = await mfa.verifyEnrollment('u-1', code);
    expect(out.enrolledAt).toBeTruthy();
    expect(query.mock.calls[1][0]).toMatch(/SET mfa_enrolled_at = NOW\(\)/);
  });

  test('invalid code → 401', async () => {
    const secret = authenticator.generateSecret();
    query.mockResolvedValueOnce({ rows: [{ mfa_secret: secret, mfa_enrolled_at: null }] });
    await expect(mfa.verifyEnrollment('u-1', '000000')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  test('returns alreadyEnrolled when row already finalised', async () => {
    query.mockResolvedValueOnce({
      rows: [{ mfa_secret: 'X', mfa_enrolled_at: '2026-01-01' }],
    });
    const out = await mfa.verifyEnrollment('u-1', '123456');
    expect(out.alreadyEnrolled).toBe(true);
  });

  test('refuses when enrollment not started', async () => {
    query.mockResolvedValueOnce({ rows: [{ mfa_secret: null, mfa_enrolled_at: null }] });
    await expect(mfa.verifyEnrollment('u-1', '123456')).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});

describe('mfa.isMfaRequired', () => {
  test('true when mfa_enrolled_at is set', async () => {
    query.mockResolvedValueOnce({ rows: [{ mfa_enrolled_at: '2026-05-04' }] });
    expect(await mfa.isMfaRequired('u-1')).toBe(true);
  });
  test('false when null', async () => {
    query.mockResolvedValueOnce({ rows: [{ mfa_enrolled_at: null }] });
    expect(await mfa.isMfaRequired('u-1')).toBe(false);
  });
});

describe('mfa.issueChallenge', () => {
  test('inserts a 64-hex challenge with 5-minute TTL', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });
    const out = await mfa.issueChallenge('u-1');
    expect(out.challenge).toMatch(/^[a-f0-9]{64}$/);
    expect(new Date(out.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(out.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);
  });

  test('stores sha256(challenge) at rest — never the raw value', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });
    const out = await mfa.issueChallenge('u-1');
    const stored = query.mock.calls[0][1][1];
    const expected = require('crypto').createHash('sha256').update(out.challenge).digest('hex');
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toBe(out.challenge);
    expect(stored).toBe(expected);
  });
});

describe('mfa.verifyChallenge', () => {
  test('valid challenge + valid TOTP → returns userId', async () => {
    const secret = authenticator.generateSecret();
    const code = authenticator.generate(secret);
    const future = new Date(Date.now() + 60_000);
    query
      .mockResolvedValueOnce({ rows: [{ id: 'c-1', user_id: 'u-1', expires_at: future, consumed_at: null, mfa_secret: secret }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const out = await mfa.verifyChallenge({ challenge: 'abcd', code });
    expect(out.userId).toBe('u-1');
    expect(out.usedRecoveryCode).toBe(false);
  });

  test('expired challenge → 401', async () => {
    const past = new Date(Date.now() - 60_000);
    query.mockResolvedValueOnce({
      rows: [{ id: 'c-1', user_id: 'u-1', expires_at: past, consumed_at: null, mfa_secret: 'X' }],
    });
    await expect(mfa.verifyChallenge({ challenge: 'abcd', code: '123456' })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  test('consumed challenge → 401', async () => {
    const future = new Date(Date.now() + 60_000);
    query.mockResolvedValueOnce({
      rows: [{ id: 'c-1', user_id: 'u-1', expires_at: future, consumed_at: '2026-04-01', mfa_secret: 'X' }],
    });
    await expect(mfa.verifyChallenge({ challenge: 'abcd', code: '123456' })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  test('non-existent challenge → 401', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(mfa.verifyChallenge({ challenge: 'xx', code: '123456' })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  test('recovery code path: non-numeric input redeems an array entry', async () => {
    const future = new Date(Date.now() + 60_000);
    query
      .mockResolvedValueOnce({ rows: [{ id: 'c-1', user_id: 'u-1', expires_at: future, consumed_at: null, mfa_secret: 'X' }] })
      .mockResolvedValueOnce({ rowCount: 1 })   // tryRecoveryCode UPDATE returns ROW
      .mockResolvedValueOnce({ rowCount: 1 });  // mark challenge consumed

    const out = await mfa.verifyChallenge({ challenge: 'abcd', code: 'abcd-1234-5678' });
    expect(out.usedRecoveryCode).toBe(true);
  });
});

describe('mfa.disable', () => {
  test('wipes secret + flags + active challenges', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 0 });
    const out = await mfa.disable('u-1');
    expect(out.disabled).toBe(true);
    expect(query.mock.calls[0][0]).toMatch(/mfa_secret = NULL/);
    expect(query.mock.calls[1][0]).toMatch(/UPDATE mfa_challenges/);
  });
});

describe('mfa.purgeExpiredChallenges', () => {
  test('returns row count + ignores transient errors', async () => {
    query.mockResolvedValueOnce({ rowCount: 7 });
    expect(await mfa.purgeExpiredChallenges()).toEqual({ rows_purged: 7 });

    query.mockRejectedValueOnce(new Error('boom'));
    const failed = await mfa.purgeExpiredChallenges();
    expect(failed.rows_purged).toBe(0);
    expect(failed.error).toMatch(/boom/);
  });
});
