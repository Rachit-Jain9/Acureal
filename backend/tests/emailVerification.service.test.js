jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/lib/mailer', () => ({
  sendMail: jest.fn(),
  isProviderConfigured: jest.fn(() => false),
}));

const { query, transaction } = require('../src/config/database');
const mailer = require('../src/lib/mailer');
const svc = require('../src/services/emailVerification.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('emailVerification.service.issueToken', () => {
  test('throws 429 when more than 5 tokens were created in the last hour', async () => {
    query.mockResolvedValueOnce({ rows: [{ recent: 5 }] });

    await expect(
      svc.issueToken({ userId: 'user-1' })
    ).rejects.toMatchObject({
      statusCode: 429,
      message: expect.stringMatching(/too many verification emails/i),
    });

    // Throttle should short-circuit before the supersede UPDATE / INSERT.
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('supersedes prior unconsumed tokens and inserts a fresh one', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ recent: 0 }] })  // throttle check
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })  // supersede UPDATE
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT

    const raw = await svc.issueToken({ userId: 'user-1', ipAddress: '1.2.3.4' });

    expect(typeof raw).toBe('string');
    expect(raw.length).toBeGreaterThanOrEqual(40); // base64url of 32 bytes ≈ 43 chars

    const supersede = query.mock.calls[1];
    expect(supersede[0]).toMatch(/UPDATE\s+public\.email_verification_tokens/i);
    expect(supersede[0]).toMatch(/consumed_by\s*=\s*'superseded'/i);
    expect(supersede[1]).toEqual(['user-1']);

    const insert = query.mock.calls[2];
    expect(insert[0]).toMatch(/INSERT INTO public\.email_verification_tokens/i);
    // Stored token is the SHA-256 hash, never the raw value.
    expect(insert[1][0]).toBe('user-1');
    expect(insert[1][1]).toMatch(/^[a-f0-9]{64}$/);
    expect(insert[1][1]).not.toBe(raw);
  });
});

describe('emailVerification.service.sendVerificationEmail', () => {
  test('issues a token, calls mailer with HTML containing the verify URL', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ recent: 0 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    mailer.sendMail.mockResolvedValueOnce({ provider: 'console', id: null });

    const result = await svc.sendVerificationEmail({
      userId: 'user-1',
      email: 'user@example.com',
      name: 'User One',
    });

    expect(result.delivered).toBe(true);
    expect(result.provider).toBe('console');

    const call = mailer.sendMail.mock.calls[0][0];
    expect(call.to).toBe('user@example.com');
    expect(call.subject).toMatch(/verify your acureal email/i);
    expect(call.html).toMatch(/\/verify-email\?token=/);
    expect(call.text).toMatch(/\/verify-email\?token=/);
  });

  // Regression: production shipped verification emails whose link pointed at
  // http://localhost:5173 because APP_BASE_URL was never set on the deploy.
  // The send SUCCEEDED, so nothing errored and nothing was logged — the link
  // was simply dead on arrival and no account could be verified. A deploy must
  // refuse to send rather than emit an unusable link.
  describe('APP_BASE_URL guard', () => {
    const ORIGINAL = { ...process.env };
    afterEach(() => { process.env = { ...ORIGINAL }; });

    test('refuses to send when deployed without APP_BASE_URL', async () => {
      delete process.env.APP_BASE_URL;
      process.env.VERCEL = '1';
      query
        .mockResolvedValueOnce({ rows: [{ recent: 0 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });

      await expect(
        svc.sendVerificationEmail({ userId: 'user-1', email: 'user@example.com', name: 'User One' })
      ).rejects.toThrow();
      expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    test('uses the configured origin for the link when deployed', async () => {
      process.env.VERCEL = '1';
      process.env.APP_BASE_URL = 'https://acureal.in';
      query
        .mockResolvedValueOnce({ rows: [{ recent: 0 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });
      mailer.sendMail.mockResolvedValueOnce({ provider: 'resend', id: 'abc' });

      await svc.sendVerificationEmail({ userId: 'user-1', email: 'user@example.com', name: 'User One' });

      const call = mailer.sendMail.mock.calls[0][0];
      expect(call.html).toContain('https://acureal.in/verify-email?token=');
      expect(call.html).not.toContain('localhost');
      expect(call.text).not.toContain('localhost');
    });
  });

  test('translates mailer failure into a 502 with a friendly message', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ recent: 0 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    mailer.sendMail.mockRejectedValueOnce(new Error('Resend 500'));

    await expect(
      svc.sendVerificationEmail({
        userId: 'user-1',
        email: 'user@example.com',
        name: 'User One',
      })
    ).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringMatching(/could not send the verification email/i),
    });
  });
});

describe('emailVerification.service.confirmToken', () => {
  const futureTimestamp = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const pastTimestamp = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const buildClient = (rows) => {
    const calls = [];
    return {
      calls,
      client: {
        query: jest.fn().mockImplementation((sql, params) => {
          calls.push({ sql, params });
          return Promise.resolve(rows.shift());
        }),
      },
    };
  };

  test('rejects an obviously malformed token before any DB call', async () => {
    await expect(svc.confirmToken('short')).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/invalid or expired/i),
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  test('rejects an unknown token', async () => {
    const { client } = buildClient([{ rowCount: 0, rows: [] }]);
    transaction.mockImplementation(async (fn) => fn(client));

    await expect(svc.confirmToken('a'.repeat(43))).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/invalid or expired/i),
    });
  });

  test('rejects an already-consumed token', async () => {
    const { client } = buildClient([
      {
        rowCount: 1,
        rows: [{ id: 1, user_id: 'u1', expires_at: futureTimestamp(), consumed_at: futureTimestamp() }],
      },
    ]);
    transaction.mockImplementation(async (fn) => fn(client));

    await expect(svc.confirmToken('a'.repeat(43))).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test('rejects an expired token', async () => {
    const { client } = buildClient([
      {
        rowCount: 1,
        rows: [{ id: 1, user_id: 'u1', expires_at: pastTimestamp(), consumed_at: null }],
      },
    ]);
    transaction.mockImplementation(async (fn) => fn(client));

    await expect(svc.confirmToken('a'.repeat(43))).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test('marks token consumed and stamps users.email_verified_at on success', async () => {
    const verifiedAt = new Date().toISOString();
    const { client, calls } = buildClient([
      {
        rowCount: 1,
        rows: [{ id: 7, user_id: 'u1', expires_at: futureTimestamp(), consumed_at: null }],
      },
      { rowCount: 1, rows: [] }, // set_config (M1 Phase 2 context stamp)
      { rowCount: 1, rows: [] }, // token-consume UPDATE
      {
        rowCount: 1,
        rows: [{ id: 'u1', email: 'user@example.com', email_verified_at: verifiedAt }],
      },
    ]);
    transaction.mockImplementation(async (fn) => fn(client));

    const result = await svc.confirmToken('a'.repeat(43));

    expect(result).toEqual({
      userId: 'u1',
      alreadyVerified: false,
      email: 'user@example.com',
      verifiedAt,
    });

    // M1 Phase 2 regression pin (red-team finding): this PUBLIC route has no
    // JWT context, so the transaction-local user context MUST be stamped from
    // the validated token row BEFORE the users UPDATE — otherwise a
    // non-BYPASSRLS role silently updates zero rows (users_self_update).
    expect(calls[1].sql).toMatch(/set_config\('app\.current_user_id'/);
    expect(calls[1].params).toEqual(['u1']);

    // Then: mark consumed before updating users.
    expect(calls[2].sql).toMatch(/UPDATE\s+public\.email_verification_tokens[\s\S]*consumed_by\s*=\s*'verified'/i);
    expect(calls[3].sql).toMatch(/UPDATE\s+public\.users[\s\S]*email_verified_at/i);
  });
});
