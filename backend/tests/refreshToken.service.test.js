jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

const { query, transaction } = require('../src/config/database');
const svc = require('../src/services/refreshToken.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('refreshToken.service.issueFamily', () => {
  test('inserts a new grant with a fresh family_id and returns the raw token', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 99 }] });

    const result = await svc.issueFamily({ userId: 'user-1', ipAddress: '1.2.3.4' });

    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(result.familyId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.grantId).toBe(99);

    const insert = query.mock.calls[0];
    expect(insert[0]).toMatch(/INSERT INTO public\.refresh_token_grants/i);
    // The persisted token is the SHA-256 hash, not the raw token.
    expect(insert[1][0]).toBe('user-1');
    expect(insert[1][2]).toMatch(/^[a-f0-9]{64}$/);
    expect(insert[1][2]).not.toBe(result.rawToken);
  });

  test('throws when userId missing', async () => {
    await expect(svc.issueFamily({})).rejects.toMatchObject({ statusCode: 400 });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('refreshToken.service.rotate', () => {
  const futureTimestamp = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const pastTimestamp = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const buildClient = (responses) => {
    const calls = [];
    return {
      calls,
      client: {
        query: jest.fn().mockImplementation((sql, params) => {
          calls.push({ sql, params });
          return Promise.resolve(responses.shift());
        }),
      },
    };
  };

  test('rejects malformed token without DB call', async () => {
    await expect(svc.rotate({ rawToken: 'short' })).rejects.toMatchObject({ statusCode: 401 });
    expect(transaction).not.toHaveBeenCalled();
  });

  test('rejects unknown token', async () => {
    const { client } = buildClient([{ rowCount: 0, rows: [] }]);
    transaction.mockImplementation(async (fn) => fn(client));

    await expect(
      svc.rotate({ rawToken: 'a'.repeat(43) })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  test('rejects expired token', async () => {
    const { client } = buildClient([
      {
        rowCount: 1,
        rows: [{
          id: 1,
          user_id: 'u1',
          family_id: 'fam-1',
          expires_at: pastTimestamp(),
          revoked_at: null,
          revoked_reason: null,
        }],
      },
    ]);
    transaction.mockImplementation(async (fn) => fn(client));

    await expect(
      svc.rotate({ rawToken: 'a'.repeat(43) })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  test('detects reuse — revokes entire family when an already-rotated token is presented again', async () => {
    const { client, calls } = buildClient([
      {
        rowCount: 1,
        rows: [{
          id: 1,
          user_id: 'u1',
          family_id: 'fam-1',
          expires_at: futureTimestamp(),
          revoked_at: pastTimestamp(),
          revoked_reason: 'rotated',
        }],
      },
      { rowCount: 3, rows: [] }, // family revoke
    ]);
    transaction.mockImplementation(async (fn) => fn(client));

    await expect(
      svc.rotate({ rawToken: 'a'.repeat(43) })
    ).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringMatching(/session expired/i),
    });

    // The follow-up query must revoke the WHOLE family.
    expect(calls[1].sql).toMatch(/UPDATE\s+public\.refresh_token_grants/i);
    expect(calls[1].sql).toMatch(/family_id\s*=\s*\$1/i);
    expect(calls[1].sql).toMatch(/revoked_reason\s*=\s*COALESCE\(revoked_reason,\s*'reuse'\)/i);
    expect(calls[1].params).toEqual(['fam-1']);
  });

  test('rejects already-revoked-non-rotated token without family kill', async () => {
    const { client, calls } = buildClient([
      {
        rowCount: 1,
        rows: [{
          id: 1,
          user_id: 'u1',
          family_id: 'fam-1',
          expires_at: futureTimestamp(),
          revoked_at: pastTimestamp(),
          revoked_reason: 'logout',
        }],
      },
    ]);
    transaction.mockImplementation(async (fn) => fn(client));

    await expect(
      svc.rotate({ rawToken: 'a'.repeat(43) })
    ).rejects.toMatchObject({ statusCode: 401 });

    // Only the lookup ran; no second UPDATE for family kill.
    expect(calls.length).toBe(1);
  });

  test('successful rotation issues new grant in same family + revokes source as rotated', async () => {
    const { client, calls } = buildClient([
      {
        rowCount: 1,
        rows: [{
          id: 7,
          user_id: 'u1',
          family_id: 'fam-7',
          expires_at: futureTimestamp(),
          revoked_at: null,
          revoked_reason: null,
        }],
      },
      { rowCount: 1, rows: [{ id: 8 }] }, // INSERT new grant
      { rowCount: 1, rows: [] },          // UPDATE source as rotated
    ]);
    transaction.mockImplementation(async (fn) => fn(client));

    const result = await svc.rotate({ rawToken: 'a'.repeat(43) });

    expect(result.userId).toBe('u1');
    expect(result.familyId).toBe('fam-7');
    expect(result.grantId).toBe(8);
    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    // INSERT must reuse family_id and store the SHA-256 hash.
    expect(calls[1].sql).toMatch(/INSERT INTO public\.refresh_token_grants/i);
    expect(calls[1].params[1]).toBe('fam-7');
    expect(calls[1].params[2]).toMatch(/^[a-f0-9]{64}$/);

    // UPDATE marks the SOURCE row revoked_reason='rotated' and links replaced_by.
    expect(calls[2].sql).toMatch(/SET[\s\S]*revoked_reason\s*=\s*'rotated'/i);
    expect(calls[2].sql).toMatch(/replaced_by\s*=\s*\$2/i);
    expect(calls[2].params).toEqual([7, 8]);
  });
});

describe('refreshToken.service.revokeFamily', () => {
  test('marks every active grant in the family revoked', async () => {
    query.mockResolvedValueOnce({ rowCount: 2, rows: [] });

    const result = await svc.revokeFamily('fam-1', 'logout');

    expect(result.revokedCount).toBe(2);
    const call = query.mock.calls[0];
    expect(call[0]).toMatch(/UPDATE\s+public\.refresh_token_grants/i);
    expect(call[0]).toMatch(/WHERE family_id = \$1 AND revoked_at IS NULL/i);
    expect(call[1]).toEqual(['fam-1', 'logout']);
  });

  test('returns 0 without DB call when familyId missing', async () => {
    const result = await svc.revokeFamily(null);
    expect(result.revokedCount).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('refreshToken.service.findFamilyByToken', () => {
  test('returns null on malformed token', async () => {
    expect(await svc.findFamilyByToken('short')).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  test('returns family + user when found', async () => {
    query.mockResolvedValueOnce({
      rows: [{ family_id: 'fam-9', user_id: 'u9' }],
    });

    const result = await svc.findFamilyByToken('a'.repeat(43));
    expect(result).toEqual({ family_id: 'fam-9', user_id: 'u9' });

    const call = query.mock.calls[0];
    expect(call[1][0]).toMatch(/^[a-f0-9]{64}$/);
  });
});
