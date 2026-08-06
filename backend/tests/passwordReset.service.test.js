jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/lib/mailer', () => ({
  sendMail: jest.fn(),
  isProviderConfigured: jest.fn(() => false),
  redactEmail: jest.fn((addr) => `redacted:${addr}`),
}));

jest.mock('../src/lib/authDefiners', () => ({
  requireDefinerPath: jest.fn(async () => false),
}));

jest.mock('../src/utils/passwordBreach', () => ({
  isPasswordBreached: jest.fn(async () => ({ breached: false, failedOpen: false })),
}));

jest.mock('../src/services/securityEvents.service', () => ({
  recordEvent: jest.fn(async () => null),
}));

const { query, transaction } = require('../src/config/database');
const mailer = require('../src/lib/mailer');
const { requireDefinerPath } = require('../src/lib/authDefiners');
const { isPasswordBreached } = require('../src/utils/passwordBreach');
const securityEvents = require('../src/services/securityEvents.service');
const svc = require('../src/services/passwordReset.service');

const STRONG_PASSWORD = 'CorrectHorse7';

const ACTIVE_USER = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'User One',
  is_active: true,
  account_closed_at: null,
  erased_at: null,
  oauth_provider: null,
  password_set: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  requireDefinerPath.mockResolvedValue(false);
  isPasswordBreached.mockResolvedValue({ breached: false, failedOpen: false });
});

describe('passwordReset.service.issueToken', () => {
  // The whole of issueToken now runs inside one transaction behind a per-user
  // advisory lock, so these drive a mock client rather than bare query().
  const buildTxClient = (rows) => {
    const calls = [];
    const client = {
      query: jest.fn().mockImplementation((sql, params) => {
        calls.push({ sql, params });
        return Promise.resolve(rows.shift() || { rowCount: 1, rows: [] });
      }),
    };
    transaction.mockImplementation(async (fn) => fn(client));
    return { client, calls };
  };

  test('throws 429 when 5 tokens were already created in the last hour', async () => {
    const { calls } = buildTxClient([
      { rowCount: 1, rows: [] },        // advisory lock
      { rows: [{ recent: 5 }] },        // throttle check
    ]);

    await expect(svc.issueToken({ userId: 'user-1' })).rejects.toMatchObject({
      statusCode: 429,
      message: expect.stringMatching(/too many password reset emails/i),
    });

    // Throttle short-circuits before the supersede UPDATE / INSERT — and
    // crucially it does so INSIDE the transaction, which rolls back.
    expect(calls).toHaveLength(2);
    expect(calls[1].sql).toMatch(/COUNT\(\*\)/i);
  });

  // Regression pin (2026-08-06 adversarial review): as three autocommit
  // statements, concurrent requests all read `recent < 5` before any inserted,
  // defeating the inbox-bombing cap and leaving two simultaneously-valid
  // tokens. Serialise per user, in one transaction.
  test('serialises on a per-user advisory lock inside a single transaction', async () => {
    const { calls } = buildTxClient([
      { rowCount: 1, rows: [] },   // advisory lock
      { rows: [{ recent: 0 }] },   // throttle
      { rowCount: 1, rows: [] },   // supersede
      { rowCount: 1, rows: [] },   // insert
    ]);

    await svc.issueToken({ userId: 'user-1' });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(calls[0].sql).toMatch(/pg_advisory_xact_lock/);
    expect(calls[0].params).toEqual(['password_reset:user-1']);
    // The lock is taken BEFORE the count, or it serialises nothing.
    expect(calls[1].sql).toMatch(/COUNT\(\*\)/i);
  });

  test('supersedes prior unconsumed tokens and stores only the SHA-256 hash', async () => {
    const { calls } = buildTxClient([
      { rowCount: 1, rows: [] },   // advisory lock
      { rows: [{ recent: 0 }] },   // throttle check
      { rowCount: 1, rows: [] },   // supersede UPDATE
      { rowCount: 1, rows: [] },   // INSERT
    ]);

    const raw = await svc.issueToken({ userId: 'user-1', ipAddress: '1.2.3.4' });

    expect(typeof raw).toBe('string');
    expect(raw.length).toBeGreaterThanOrEqual(40); // base64url of 32 bytes ≈ 43 chars

    const supersede = calls[2];
    expect(supersede.sql).toMatch(/UPDATE\s+public\.password_reset_tokens/i);
    expect(supersede.sql).toMatch(/consumed_by\s*=\s*'superseded'/i);
    expect(supersede.params).toEqual(['user-1']);

    const insert = calls[3];
    expect(insert.sql).toMatch(/INSERT INTO public\.password_reset_tokens/i);
    expect(insert.sql).toMatch(/minutes/i); // 60-minute TTL, not verification's hours
    expect(insert.params[0]).toBe('user-1');
    expect(insert.params[1]).toMatch(/^[a-f0-9]{64}$/); // hash, never the raw token
    expect(insert.params[1]).not.toBe(raw);
    expect(insert.params[2]).toBe(svc.TOKEN_TTL_MINUTES);
  });
});

describe('passwordReset.service.requestReset (enumeration-resistant request leg)', () => {
  test('unknown email: resolves quietly, sends nothing, never throws', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // user lookup

    const result = await svc.requestReset({ email: 'Nobody@Example.com' });

    expect(result).toEqual({ dispatched: false, reason: 'unknown_account' });
    expect(mailer.sendMail).not.toHaveBeenCalled();
    // Lookup used the lowercased address.
    expect(query.mock.calls[0][1]).toEqual(['nobody@example.com']);
  });

  test.each([
    ['deactivated', { ...ACTIVE_USER, is_active: false }],
    ['closed', { ...ACTIVE_USER, account_closed_at: '2026-01-01T00:00:00Z' }],
    ['erased', { ...ACTIVE_USER, erased_at: '2026-01-01T00:00:00Z' }],
  ])('%s account: silently skipped — a reset link is never a side door', async (_label, userRow) => {
    query.mockResolvedValueOnce({ rows: [userRow] });

    const result = await svc.requestReset({ email: 'user@example.com' });

    expect(result).toEqual({ dispatched: false, reason: 'ineligible_account' });
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  // issueToken now runs in a transaction; requestReset still does its lookup
  // via query(). This wires both so the request-leg tests stay readable.
  const mockIssueTokenTransaction = () => {
    transaction.mockImplementation(async (fn) => fn({
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })  // advisory lock
        .mockResolvedValueOnce({ rows: [{ recent: 0 }] })  // throttle
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })  // supersede
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }), // insert
    }));
  };

  test('active account: issues a token and emails a /reset-password link', async () => {
    query.mockResolvedValueOnce({ rows: [ACTIVE_USER] }); // lookup
    mockIssueTokenTransaction();
    mailer.sendMail.mockResolvedValueOnce({ provider: 'console', id: null });

    const result = await svc.requestReset({ email: 'user@example.com' });

    expect(result).toEqual({ dispatched: true });
    const call = mailer.sendMail.mock.calls[0][0];
    expect(call.to).toBe('user@example.com');
    expect(call.subject).toMatch(/reset your acureal password/i);
    expect(call.html).toMatch(/\/reset-password\?token=/);
    expect(call.text).toMatch(/\/reset-password\?token=/);
    expect(securityEvents.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'password_reset_requested', actorId: 'user-1' })
    );
  });

  test('google-bound account: still gets a working link, with the Google hint in the EMAIL only', async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...ACTIVE_USER, oauth_provider: 'google', password_set: false }],
    });
    mockIssueTokenTransaction();
    mailer.sendMail.mockResolvedValueOnce({ provider: 'console', id: null });

    const result = await svc.requestReset({ email: 'user@example.com' });

    expect(result).toEqual({ dispatched: true });
    const call = mailer.sendMail.mock.calls[0][0];
    expect(call.html).toMatch(/sign in with google/i);
    expect(call.html).toMatch(/\/reset-password\?token=/);
  });

  test('routes the pre-identity lookup through the SECURITY DEFINER helper when available', async () => {
    requireDefinerPath.mockResolvedValueOnce(true);
    query.mockResolvedValueOnce({ rows: [] });

    await svc.requestReset({ email: 'user@example.com' });

    expect(query.mock.calls[0][0]).toMatch(/auth_find_user_for_login/);
  });

  // Regression pins (2026-08-06 adversarial review). Gmail is stored TWO ways:
  // dotted by the Google sign-in path, dot-stripped by /register. A
  // single-shape lookup silently found neither half, and the generic-200
  // contract hid the failure completely.
  describe('gmail dot handling — both stored shapes must resolve', () => {
    test('dotted stored row (Google signup shape) is found from a dotted submission', async () => {
      query.mockResolvedValueOnce({ rows: [{ ...ACTIVE_USER, email: 'first.last@gmail.com' }] });
      mockIssueTokenTransaction();
      mailer.sendMail.mockResolvedValueOnce({ provider: 'console', id: null });

      const result = await svc.requestReset({ email: 'First.Last@gmail.com' });

      expect(result).toEqual({ dispatched: true });
      // The literal (dotted) shape is tried FIRST, so one query suffices.
      expect(query.mock.calls[0][1]).toEqual(['first.last@gmail.com']);
      expect(mailer.sendMail.mock.calls[0][0].to).toBe('first.last@gmail.com');
    });

    test('dot-stripped stored row (/register shape) is found from a dotted submission', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })  // literal 'first.last@gmail.com' — miss
        .mockResolvedValueOnce({ rows: [{ ...ACTIVE_USER, email: 'firstlast@gmail.com' }] });
      mockIssueTokenTransaction();
      mailer.sendMail.mockResolvedValueOnce({ provider: 'console', id: null });

      const result = await svc.requestReset({ email: 'First.Last@gmail.com' });

      expect(result).toEqual({ dispatched: true });
      expect(query.mock.calls[0][1]).toEqual(['first.last@gmail.com']);
      expect(query.mock.calls[1][1]).toEqual(['firstlast@gmail.com']);
    });

    test('non-gmail addresses cost exactly ONE lookup (dots are significant there)', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      await svc.requestReset({ email: 'Some.One@anarock.com' });

      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][1]).toEqual(['some.one@anarock.com']);
    });
  });

  describe('APP_BASE_URL guard (fail closed on a deploy)', () => {
    const ORIGINAL = { ...process.env };
    afterEach(() => { process.env = { ...ORIGINAL }; });

    test('refuses to send when deployed without APP_BASE_URL', async () => {
      delete process.env.APP_BASE_URL;
      process.env.VERCEL = '1';
      query.mockResolvedValueOnce({ rows: [ACTIVE_USER] });
      mockIssueTokenTransaction();

      await expect(svc.requestReset({ email: 'user@example.com' })).rejects.toThrow(/APP_BASE_URL/);
      expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    test('uses the configured origin for the link when deployed', async () => {
      process.env.VERCEL = '1';
      process.env.APP_BASE_URL = 'https://acureal.in';
      query.mockResolvedValueOnce({ rows: [ACTIVE_USER] });
      mockIssueTokenTransaction();
      mailer.sendMail.mockResolvedValueOnce({ provider: 'resend', id: 'abc' });

      await svc.requestReset({ email: 'user@example.com' });

      const call = mailer.sendMail.mock.calls[0][0];
      expect(call.html).toContain('https://acureal.in/reset-password?token=');
      expect(call.html).not.toContain('localhost');
      expect(call.text).not.toContain('localhost');
    });
  });

  test('translates mailer failure into a 502 (caller is fire-and-forget; surfaces in logs)', async () => {
    query.mockResolvedValueOnce({ rows: [ACTIVE_USER] });
    mockIssueTokenTransaction();
    mailer.sendMail.mockRejectedValueOnce(new Error('Resend 500'));

    await expect(svc.requestReset({ email: 'user@example.com' })).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});

describe('passwordReset.service.confirmReset', () => {
  const futureTimestamp = () => new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const pastTimestamp = () => new Date(Date.now() - 30 * 60 * 1000).toISOString();

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

  test('rejects an obviously malformed token before any DB or HIBP call', async () => {
    await expect(svc.confirmReset('short', STRONG_PASSWORD)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/invalid or expired/i),
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(isPasswordBreached).not.toHaveBeenCalled();
  });

  test('rejects a breached password before touching the token', async () => {
    isPasswordBreached.mockResolvedValueOnce({ breached: true, failedOpen: false });

    await expect(svc.confirmReset('a'.repeat(43), STRONG_PASSWORD)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/known data breaches/i),
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  test.each([
    ['unknown token', [{ rowCount: 0, rows: [] }]],
    ['consumed token', [{ rowCount: 1, rows: [{ id: 1, user_id: 'u1', expires_at: new Date(Date.now() + 1e6).toISOString(), consumed_at: new Date().toISOString() }] }]],
    ['expired token', [{ rowCount: 1, rows: [{ id: 1, user_id: 'u1', expires_at: new Date(Date.now() - 1e6).toISOString(), consumed_at: null }] }]],
  ])('%s: identical vague 400', async (_label, rows) => {
    const { client } = buildClient(rows);
    transaction.mockImplementation(async (fn) => fn(client));

    await expect(svc.confirmReset('a'.repeat(43), STRONG_PASSWORD)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid or expired reset link.',
    });
  });

  test('success: stamps RLS context, consumes token, sets password, revokes sessions, clears lockout — atomically', async () => {
    const { client, calls } = buildClient([
      {
        rowCount: 1,
        rows: [{ id: 7, user_id: 'u1', expires_at: futureTimestamp(), consumed_at: null }],
      },
      { rowCount: 1, rows: [] }, // set_config (RLS context stamp)
      { rowCount: 1, rows: [] }, // token consume
      { rowCount: 1, rows: [{ id: 'u1', email: 'user@example.com' }] }, // users UPDATE
      { rowCount: 2, rows: [] }, // refresh grants revoke
      { rowCount: 1, rows: [] }, // login_attempts clear
    ]);
    transaction.mockImplementation(async (fn) => fn(client));

    const result = await svc.confirmReset('a'.repeat(43), STRONG_PASSWORD);

    expect(result).toEqual({ userId: 'u1', email: 'user@example.com' });

    // Regression pin (the M1 silent-zero-rows class): this PUBLIC route has no
    // JWT context — the transaction-local user context MUST be stamped from
    // the validated token row BEFORE the users UPDATE, or a non-BYPASSRLS
    // role silently updates zero rows.
    expect(calls[1].sql).toMatch(/set_config\('app\.current_user_id'/);
    expect(calls[1].params).toEqual(['u1']);

    expect(calls[2].sql).toMatch(/UPDATE\s+public\.password_reset_tokens[\s\S]*consumed_by\s*=\s*'reset'/i);

    // password_set = TRUE converts Google-only accounts cleanly; the stored
    // value is a bcrypt hash, never the raw password.
    expect(calls[3].sql).toMatch(/UPDATE\s+public\.users[\s\S]*password_set\s*=\s*TRUE/i);
    expect(calls[3].params[0]).toBe('u1');
    expect(calls[3].params[1]).toMatch(/^\$2[aby]\$/);
    expect(calls[3].params[1]).not.toBe(STRONG_PASSWORD);

    // Sessions die on reset, inside the same transaction.
    expect(calls[4].sql).toMatch(/UPDATE\s+public\.refresh_token_grants[\s\S]*'password_reset'/i);
    expect(calls[4].params).toEqual(['u1']);

    // Lockout cleared so the legitimate owner can sign straight in — keyed on
    // BOTH stored shapes, since login throttles on the canonical address while
    // users.email may hold the dotted gmail form.
    expect(calls[5].sql).toMatch(/DELETE FROM login_attempts/i);
    expect(calls[5].params[0]).toEqual(['user@example.com']);

    expect(securityEvents.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'password_reset_completed', actorId: 'u1' })
    );
  });

  test('clears the lockout under both gmail shapes', async () => {
    const { client, calls } = buildClient([
      { rowCount: 1, rows: [{ id: 7, user_id: 'u1', expires_at: futureTimestamp(), consumed_at: null }] },
      { rowCount: 1, rows: [] }, // set_config
      { rowCount: 1, rows: [] }, // token consume
      { rowCount: 1, rows: [{ id: 'u1', email: 'first.last@gmail.com' }] },
      { rowCount: 1, rows: [] }, // revoke
      { rowCount: 1, rows: [] }, // lockout clear
    ]);
    transaction.mockImplementation(async (fn) => fn(client));

    await svc.confirmReset('a'.repeat(43), STRONG_PASSWORD);

    expect(calls[5].params[0]).toEqual(
      expect.arrayContaining(['first.last@gmail.com', 'firstlast@gmail.com'])
    );
  });

  // Regression pin (2026-08-06 adversarial review, #1091 defect class): a token
  // minted while the account was healthy stayed usable across a closure —
  // rewriting credentials and wiping lockout history on a frozen account.
  test('re-asserts account eligibility inside the transaction', async () => {
    const { client, calls } = buildClient([
      { rowCount: 1, rows: [{ id: 7, user_id: 'u1', expires_at: futureTimestamp(), consumed_at: null }] },
      { rowCount: 1, rows: [] }, // set_config
      { rowCount: 1, rows: [] }, // token consume
      { rowCount: 1, rows: [{ id: 'u1', email: 'user@example.com' }] },
      { rowCount: 1, rows: [] },
      { rowCount: 1, rows: [] },
    ]);
    transaction.mockImplementation(async (fn) => fn(client));

    await svc.confirmReset('a'.repeat(43), STRONG_PASSWORD);

    expect(calls[3].sql).toMatch(/is_active\s*=\s*TRUE/i);
    expect(calls[3].sql).toMatch(/account_closed_at IS NULL/i);
    expect(calls[3].sql).toMatch(/erased_at IS NULL/i);
  });

  test('a closed account cannot be reset: zero rows → generic 400, token NOT consumed', async () => {
    const { client } = buildClient([
      {
        rowCount: 1,
        rows: [{ id: 7, user_id: 'u1', expires_at: futureTimestamp(), consumed_at: null }],
      },
      { rowCount: 1, rows: [] }, // set_config
      { rowCount: 1, rows: [] }, // token consume (rolled back with the txn)
      { rowCount: 0, rows: [] }, // users UPDATE — eligibility predicate matched nothing
    ]);
    transaction.mockImplementation(async (fn) => fn(client));

    // Generic message, not the old distinct 404 — the confirm leg must not
    // become an account-state oracle.
    await expect(svc.confirmReset('a'.repeat(43), STRONG_PASSWORD)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid or expired reset link.',
    });
  });

  test('expired-window sanity: TTL constant is minutes, and short', () => {
    expect(svc.TOKEN_TTL_MINUTES).toBeLessThanOrEqual(60);
  });
});

describe('refreshToken.service session revocation', () => {
  const refreshSvc = require('../src/services/refreshToken.service');

  test('revokeAllForUser revokes every live grant, unconditionally', async () => {
    query.mockResolvedValueOnce({ rowCount: 3, rows: [] });
    const result = await refreshSvc.revokeAllForUser('u1', 'password_reset');
    expect(result).toEqual({ revokedCount: 3 });
    const call = query.mock.calls[0];
    expect(call[0]).toMatch(/UPDATE public\.refresh_token_grants/);
    expect(call[1]).toEqual(['u1', 'password_reset']);
    // Regression pin: an "except this family" parameter was tried and removed.
    // The refresh cookie is Path=/api/auth/refresh, so no route outside that
    // path can identify the caller's family — the exemption silently degraded
    // to "exempt nothing" and logged the user out of their own device anyway.
    // Callers that must keep the current device revoke, then re-issue.
    expect(call[0]).not.toMatch(/family_id\s*<>/);
  });

  describe('latestActivePersistence — carries the remember-me tier across a re-issue', () => {
    test('returns the most recent live grant tier', async () => {
      query.mockResolvedValueOnce({ rows: [{ remember_me: false }] });
      await expect(refreshSvc.latestActivePersistence('u1')).resolves.toBe(false);
      expect(query.mock.calls[0][0]).toMatch(/revoked_at IS NULL[\s\S]*ORDER BY created_at DESC/i);
    });

    test('defaults to persistent when nothing live is found', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      await expect(refreshSvc.latestActivePersistence('u1')).resolves.toBe(true);
    });
  });
});

describe('emailDomain canonicalisation (the two stored gmail shapes)', () => {
  const { canonicalEmail, emailLookupCandidates } = require('../src/utils/emailDomain');

  test.each([
    ['First.Last@gmail.com', 'firstlast@gmail.com'],
    ['first.last@googlemail.com', 'firstlast@gmail.com'],
    ['a.b+tag@gmail.com', 'ab@gmail.com'],
    ['Some.One@anarock.com', 'some.one@anarock.com'],   // dots significant off-gmail
    ['rachit.jain@acureal.in', 'rachit.jain@acureal.in'],
  ])('canonicalEmail(%s) → %s', (input, expected) => {
    expect(canonicalEmail(input)).toBe(expected);
  });

  test('gmail yields two candidates, literal first', () => {
    expect(emailLookupCandidates('First.Last@gmail.com'))
      .toEqual(['first.last@gmail.com', 'firstlast@gmail.com']);
  });

  test('non-gmail yields exactly one candidate', () => {
    expect(emailLookupCandidates('Some.One@anarock.com')).toEqual(['some.one@anarock.com']);
  });

  test('an already-canonical gmail address does not duplicate', () => {
    expect(emailLookupCandidates('firstlast@gmail.com')).toEqual(['firstlast@gmail.com']);
  });
});
