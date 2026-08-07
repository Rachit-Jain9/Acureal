/**
 * The TWO gmail storage shapes, on the sign-in path.
 *
 * This database holds gmail addresses two ways and both are live production
 * data: the Google sign-in path stores `claims.email.toLowerCase()` with DOTS
 * INTACT, while /register runs express-validator's normalizeEmail() and stores
 * them DOT-STRIPPED. /login used to normalise before the service saw the
 * address and then match on equality, so an account created with a dotted
 * gmail Google identity could not sign in with email + password at all — it got
 * the same generic "Invalid email or password." as a wrong guess.
 *
 * The fix drops normalizeEmail() from the route and resolves every stored shape
 * in the service. The half that needs the most protection is the OTHER half:
 * the per-account lockout must not follow the address as typed, or an attacker
 * splits one 5-failure budget across unlimited dot variants of the same
 * address and the lockout stops existing. That property gets the most
 * thorough test here — a real counter, not an assertion about an argument.
 */

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
  joinByVerifiedDomain: jest.fn(),
}));

jest.mock('../src/services/legal.service', () => ({
  resolveSignupAcceptance: jest.fn().mockResolvedValue([1, 2]),
  recordAcceptance: jest.fn().mockResolvedValue(undefined),
}));

const bcrypt = require('bcryptjs');
const { query } = require('../src/config/database');
const { hydrateUserAuthContext } = require('../src/services/organization.service');
const authService = require('../src/services/auth.service');

const LOCK_THRESHOLD = 5;

/**
 * A working stand-in for the two tables login() touches.
 *
 * Deliberately NOT a call-order mock. The lockout claim under test is "these
 * five different typed strings share one budget", which a sequence of
 * mockResolvedValueOnce cannot express — it would only pin the argument passed
 * to a SQL string, which is what the buggy version would also have done. A
 * counter that actually increments proves the property.
 */
const installFakeDb = ({ users = [] } = {}) => {
  const attempts = new Map(); // canonical email -> { failed, locked }
  const usersByEmail = new Map(users.map((u) => [u.email, u]));

  query.mockImplementation(async (sql, params = []) => {
    if (/SELECT locked_until FROM login_attempts/i.test(sql)) {
      const row = attempts.get(params[0]);
      return { rows: row && row.locked ? [{ locked_until: row.locked }] : [] };
    }
    if (/INSERT INTO login_attempts/i.test(sql)) {
      const key = params[0];
      const row = attempts.get(key) || { failed: 0, locked: null };
      row.failed += 1;
      if (row.failed >= LOCK_THRESHOLD) {
        row.locked = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }
      attempts.set(key, row);
      return { rowCount: 1, rows: [] };
    }
    if (/DELETE FROM login_attempts/i.test(sql)) {
      attempts.delete(params[0]);
      return { rowCount: 1, rows: [] };
    }
    if (/FROM users\s+WHERE email = \$1/i.test(sql)) {
      const hit = usersByEmail.get(params[0]);
      return { rows: hit ? [hit] : [] };
    }
    if (/SELECT mfa_enrolled_at FROM users/i.test(sql)) {
      return { rows: [{ mfa_enrolled_at: null }] }; // MFA is a separate concern
    }
    if (/UPDATE users SET last_login_at/i.test(sql)) {
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`unexpected SQL in fake db: ${sql}`);
  });

  return {
    attempts,
    failuresFor: (key) => attempts.get(key)?.failed || 0,
    keys: () => [...attempts.keys()],
  };
};

const makeUser = (overrides) => ({
  id: 'user-1',
  email: 'firstlast@gmail.com',
  password_hash: 'hashed-password',
  name: 'First Last',
  phone: null,
  is_active: true,
  last_login_at: null,
  default_organization_id: null,
  account_closed_at: null,
  erased_at: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  hydrateUserAuthContext.mockResolvedValue({ user: { id: 'user-1', role: 'admin' } });
});

describe('login resolves both stored gmail shapes', () => {
  test('an account stored DOTTED (created by Google sign-in) signs in with the dotted address', async () => {
    // The regression that motivated the fix. Before it, normalizeEmail() turned
    // the typed address into firstlast@gmail.com, the equality match found
    // nothing, and this user was told their password was wrong — forever.
    installFakeDb({
      users: [makeUser({ id: 'google-user', email: 'first.last@gmail.com' })],
    });
    bcrypt.compare.mockResolvedValue(true);

    const result = await authService.login('first.last@gmail.com', 'correct-password');

    expect(result.token).toBe('signed-token');
    expect(hydrateUserAuthContext).toHaveBeenCalledWith('google-user', null);
  });

  test('an account stored DOT-STRIPPED (created by /register) signs in with the dotted address', async () => {
    // The other direction: the address as typed misses, the canonical form
    // hits. This is what normalizeEmail() used to do for us on this path.
    installFakeDb({
      users: [makeUser({ id: 'password-user', email: 'firstlast@gmail.com' })],
    });
    bcrypt.compare.mockResolvedValue(true);

    const result = await authService.login('first.last@gmail.com', 'correct-password');

    expect(result.token).toBe('signed-token');
    expect(hydrateUserAuthContext).toHaveBeenCalledWith('password-user', null);
  });

  test('an account stored DOT-STRIPPED still signs in with the address as stored', async () => {
    // The overwhelmingly common case must be untouched: one candidate, one
    // lookup, the old straight-line path.
    installFakeDb({ users: [makeUser({ id: 'password-user' })] });
    bcrypt.compare.mockResolvedValue(true);

    await expect(
      authService.login('firstlast@gmail.com', 'correct-password')
    ).resolves.toMatchObject({ token: 'signed-token' });

    const lookups = query.mock.calls.filter(([sql]) => /FROM users\s+WHERE email/i.test(sql));
    expect(lookups).toHaveLength(1);
  });

  test('googlemail.com and a +tag both resolve to the gmail account', async () => {
    installFakeDb({ users: [makeUser({ email: 'firstlast@gmail.com' })] });
    bcrypt.compare.mockResolvedValue(true);

    await expect(
      authService.login('First.Last+deals@googlemail.com', 'correct-password')
    ).resolves.toMatchObject({ token: 'signed-token' });
  });

  test('a non-gmail address costs exactly one lookup — the dual query is gmail-only', async () => {
    installFakeDb({ users: [makeUser({ email: 'asha@acme-realty.in' })] });
    bcrypt.compare.mockResolvedValue(true);

    await authService.login('asha@acme-realty.in', 'correct-password');

    const lookups = query.mock.calls.filter(([sql]) => /FROM users\s+WHERE email/i.test(sql));
    expect(lookups).toHaveLength(1);
    expect(lookups[0][1]).toEqual(['asha@acme-realty.in']);
  });

  test('a genuinely unknown address is still a generic 401, not a hint', async () => {
    installFakeDb({ users: [] });

    await expect(
      authService.login('nobody@gmail.com', 'irrelevant')
    ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid email or password.' });
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });
});

describe('login lockout is keyed on the canonical address', () => {
  test('THE CORE PROPERTY: failures against dot variants of one address share a single budget', async () => {
    // Five different typed strings, all reaching the same mailbox. Under the
    // defect this fix must not introduce, each would open its own 5-failure
    // budget — 25 free guesses instead of 5, and unbounded beyond that, because
    // a gmail local part of length n has 2^(n-1) dotted spellings.
    const db = installFakeDb({
      users: [makeUser({ email: 'first.last@gmail.com' })],
    });
    bcrypt.compare.mockResolvedValue(false);

    const variants = [
      'first.last@gmail.com',
      'f.irstlast@gmail.com',
      'fi.rst.last@gmail.com',
      'firstlast@gmail.com',
      'first.last+anything@googlemail.com',
    ];

    for (const variant of variants) {
      await expect(authService.login(variant, 'guess')).rejects.toMatchObject({
        statusCode: 401,
      });
    }

    // One row, one counter, five failures — not five rows of one.
    expect(db.keys()).toEqual(['firstlast@gmail.com']);
    expect(db.failuresFor('firstlast@gmail.com')).toBe(5);

    // And the budget is now spent: a sixth attempt on ANY spelling is locked
    // out, including one never tried before.
    await expect(
      authService.login('firs.tlast@gmail.com', 'guess')
    ).rejects.toMatchObject({
      statusCode: 429,
      message: expect.stringMatching(/too many failed sign-in attempts/i),
    });
  });

  test('the lock is enforced before any lookup or password compare', async () => {
    const db = installFakeDb({ users: [makeUser({ email: 'first.last@gmail.com' })] });
    bcrypt.compare.mockResolvedValue(false);

    for (let i = 0; i < LOCK_THRESHOLD; i += 1) {
      await expect(authService.login('first.last@gmail.com', 'guess')).rejects.toBeDefined();
    }
    expect(db.failuresFor('firstlast@gmail.com')).toBe(LOCK_THRESHOLD);

    bcrypt.compare.mockClear();
    query.mockClear();

    await expect(
      authService.login('f.i.r.s.t.last@gmail.com', 'guess')
    ).rejects.toMatchObject({ statusCode: 429 });

    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1); // the lock check, nothing else
  });

  test('unknown addresses are throttled canonically too, so lockout does not leak existence', async () => {
    const db = installFakeDb({ users: [] });

    await authService.login('no.such.person@gmail.com', 'x').catch(() => {});
    await authService.login('nosuchperson@gmail.com', 'x').catch(() => {});

    expect(db.keys()).toEqual(['nosuchperson@gmail.com']);
    expect(db.failuresFor('nosuchperson@gmail.com')).toBe(2);
  });

  test('a successful sign-in clears the shared row, whichever spelling was used', async () => {
    const db = installFakeDb({ users: [makeUser({ email: 'first.last@gmail.com' })] });

    bcrypt.compare.mockResolvedValue(false);
    await authService.login('f.irst.last@gmail.com', 'wrong').catch(() => {});
    expect(db.failuresFor('firstlast@gmail.com')).toBe(1);

    bcrypt.compare.mockResolvedValue(true);
    await authService.login('first.last@gmail.com', 'correct-password');

    expect(db.keys()).toEqual([]);
  });

  test('a non-gmail address is keyed on itself — no unrelated account shares its budget', async () => {
    const db = installFakeDb({ users: [] });

    await authService.login('asha@acme-realty.in', 'x').catch(() => {});
    await authService.login('as.ha@acme-realty.in', 'x').catch(() => {});

    // Dots are meaningful outside gmail: these are two different mailboxes and
    // must not be collapsed into one lockout row.
    expect(db.keys().sort()).toEqual(['as.ha@acme-realty.in', 'asha@acme-realty.in']);
  });
});

describe('login when BOTH stored shapes exist as separate accounts', () => {
  // register()'s duplicate-email guard cannot see across the two shapes, so a
  // user who signed in with Google and later registered with a password has two
  // rows. Resolving the typed address to the first hit would pick the Google
  // row — whose hash is unusable random bytes — and reject a password that is
  // valid on the other row. That would have turned a working sign-in into a 401.
  const googleRow = makeUser({
    id: 'google-row',
    email: 'first.last@gmail.com',
    password_hash: 'unusable-random-hash',
  });
  const passwordRow = makeUser({
    id: 'password-row',
    email: 'firstlast@gmail.com',
    password_hash: 'real-hash',
  });

  test('the password is tried against every shape, so the real account still authenticates', async () => {
    installFakeDb({ users: [googleRow, passwordRow] });
    bcrypt.compare.mockImplementation(async (_pw, hash) => hash === 'real-hash');

    const result = await authService.login('first.last@gmail.com', 'correct-password');

    expect(result.token).toBe('signed-token');
    expect(hydrateUserAuthContext).toHaveBeenCalledWith('password-row', null);
    expect(bcrypt.compare).toHaveBeenCalledTimes(2); // dotted row first, then canonical
  });

  test('signing in to ONE of the pair does not refund the budget the other is spending', async () => {
    // The attack this guards: register firstlast@gmail.com (register()'s
    // duplicate guard is single-shape, so it allows this even though the
    // victim's Google account first.last@gmail.com already exists), then loop
    // {four wrong guesses at the victim, one real sign-in to your own row}. If
    // the successful sign-in cleared the shared canonical row, that loop is an
    // unlimited online password-guessing machine.
    const db = installFakeDb({ users: [googleRow, passwordRow] });

    // Only the attacker's own password opens their own row; the guesses at the
    // victim open nothing.
    bcrypt.compare.mockImplementation(
      async (pw, hash) => pw === 'their-own-password' && hash === 'real-hash'
    );

    for (let i = 0; i < 4; i += 1) {
      await authService.login('first.last@gmail.com', 'guess').catch(() => {});
    }
    expect(db.failuresFor('firstlast@gmail.com')).toBe(4);

    // The attacker signs in to the row they legitimately control — using the
    // CANONICAL spelling, which resolves to exactly one row and so looks
    // unshared from inside login(). This is the case a naive
    // "clear when one row matched" guard would miss.
    await authService.login('firstlast@gmail.com', 'their-own-password');

    // Budget survives — the victim's row is still one failure from locked.
    expect(db.failuresFor('firstlast@gmail.com')).toBe(4);
  });

  test('a dotted sign-in with no canonical sibling still clears normally', async () => {
    // The other side of the rule: both spellings were probed and only one row
    // came back, so nothing can be sharing the key. Behaviour is unchanged.
    const db = installFakeDb({ users: [makeUser({ email: 'first.last@gmail.com' })] });

    bcrypt.compare.mockResolvedValue(false);
    await authService.login('first.last@gmail.com', 'wrong').catch(() => {});
    expect(db.failuresFor('firstlast@gmail.com')).toBe(1);

    bcrypt.compare.mockResolvedValue(true);
    await authService.login('first.last@gmail.com', 'correct-password');
    expect(db.keys()).toEqual([]);
  });

  test('a wrong password against the pair is still one failure on one shared row', async () => {
    const db = installFakeDb({ users: [googleRow, passwordRow] });
    bcrypt.compare.mockResolvedValue(false);

    await expect(
      authService.login('first.last@gmail.com', 'guess')
    ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid email or password.' });

    expect(db.failuresFor('firstlast@gmail.com')).toBe(1);
  });

  test('a closed row does not mask a live one', async () => {
    // Closing the Google duplicate must not take the password account down
    // with it — they are different accounts that merely share a mailbox.
    installFakeDb({
      users: [
        { ...googleRow, account_closed_at: new Date().toISOString() },
        passwordRow,
      ],
    });
    bcrypt.compare.mockImplementation(async (_pw, hash) => hash === 'real-hash');

    await expect(
      authService.login('first.last@gmail.com', 'correct-password')
    ).resolves.toMatchObject({ token: 'signed-token' });
  });
});

describe('closed and deactivated accounts keep their existing behaviour', () => {
  test('a closed account still reports closure rather than a generic 401', async () => {
    installFakeDb({
      users: [makeUser({ account_closed_at: new Date().toISOString() })],
    });

    await expect(
      authService.login('firstlast@gmail.com', 'correct-password')
    ).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringMatching(/closed/i),
    });
  });

  test('a closed account does not spend lockout budget', async () => {
    // Unchanged from before the fix: the closure branch returns ahead of
    // recordFailedLogin, because this is the legitimate owner of a frozen
    // account, not somebody guessing a password.
    const db = installFakeDb({
      users: [makeUser({ account_closed_at: new Date().toISOString() })],
    });

    await authService.login('firstlast@gmail.com', 'whatever').catch(() => {});

    expect(db.keys()).toEqual([]);
  });

  test('a deactivated account is refused without reaching bcrypt', async () => {
    installFakeDb({ users: [makeUser({ is_active: false })] });

    await expect(
      authService.login('firstlast@gmail.com', 'correct-password')
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  test('an erased row (NULL password_hash) is refused, never handed to bcrypt', async () => {
    installFakeDb({
      users: [makeUser({ erased_at: new Date().toISOString(), password_hash: null })],
    });

    await expect(
      authService.login('firstlast@gmail.com', 'anything')
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });
});
