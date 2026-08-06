jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

const { query } = require('../src/config/database');
const svc = require('../src/services/dealShare.service');

const DEAL_ID = 'deal-1';
const OWNER_ID = 'owner-1';
const ORG_ID = 'org-1';

const mockOwnedDeal = () =>
  query.mockResolvedValueOnce({ rows: [{ id: DEAL_ID, organization_id: ORG_ID }] });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('dealShare.service.listShareCandidates', () => {
  test('404s when the caller does not own the deal — no roster is leaked', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // ownership check misses

    await expect(svc.listShareCandidates(DEAL_ID, 'not-the-owner')).rejects.toMatchObject({
      statusCode: 404,
    });

    // Critically: the candidate query must never run for a non-owner.
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('scopes to the DEAL organisation and excludes self and existing shares', async () => {
    mockOwnedDeal();
    query.mockResolvedValueOnce({ rows: [{ id: 'u2', name: 'Bharath', email: 'b@acureal.in', role: 'editor' }] });

    const rows = await svc.listShareCandidates(DEAL_ID, OWNER_ID);

    expect(rows).toHaveLength(1);
    const [sql, params] = query.mock.calls[1];

    // Membership is the boundary — not an email-domain string match.
    expect(sql).toMatch(/organization_members/);
    expect(sql).toMatch(/om\.organization_id\s*=\s*\$1/);
    expect(sql).not.toMatch(/@/); // no address splitting anywhere in the query

    // Self-exclusion and already-shared exclusion happen SERVER-side.
    expect(sql).toMatch(/u\.id\s*<>\s*\$2/);
    expect(sql).toMatch(/NOT EXISTS[\s\S]*deal_shares/i);

    // Terminated accounts never appear in a picker.
    expect(sql).toMatch(/om\.is_active\s*=\s*TRUE/i);
    expect(sql).toMatch(/account_closed_at IS NULL/i);
    expect(sql).toMatch(/erased_at IS NULL/i);

    expect(params[0]).toBe(ORG_ID);
    expect(params[1]).toBe(OWNER_ID);
    expect(params[2]).toBe(DEAL_ID);
  });

  test('no query term passes NULL, so the whole eligible roster returns', async () => {
    mockOwnedDeal();
    query.mockResolvedValueOnce({ rows: [] });

    await svc.listShareCandidates(DEAL_ID, OWNER_ID, { q: '   ' });

    expect(query.mock.calls[1][1][3]).toBeNull();
  });

  test('a search term becomes a wrapped LIKE pattern', async () => {
    mockOwnedDeal();
    query.mockResolvedValueOnce({ rows: [] });

    await svc.listShareCandidates(DEAL_ID, OWNER_ID, { q: 'bhar' });

    expect(query.mock.calls[1][1][3]).toBe('%bhar%');
    expect(query.mock.calls[1][0]).toMatch(/ILIKE \$4 ESCAPE/);
  });

  // A raw '%' would turn one keystroke into a full roster dump, and '_' would
  // silently widen every search by one character.
  test.each([
    ['%', '%\\%%'],
    ['_', '%\\_%'],
    ['a%b_c', '%a\\%b\\_c%'],
    ['back\\slash', '%back\\\\slash%'],
  ])('escapes LIKE metacharacters in %j', async (input, expected) => {
    mockOwnedDeal();
    query.mockResolvedValueOnce({ rows: [] });

    await svc.listShareCandidates(DEAL_ID, OWNER_ID, { q: input });

    expect(query.mock.calls[1][1][3]).toBe(expected);
  });

  test('clamps the limit so a crafted request cannot dump the org', async () => {
    mockOwnedDeal();
    query.mockResolvedValueOnce({ rows: [] });

    await svc.listShareCandidates(DEAL_ID, OWNER_ID, { limit: 10000 });

    expect(query.mock.calls[1][1][4]).toBe(50);
  });

  test('falls back to a sane limit when given junk', async () => {
    mockOwnedDeal();
    query.mockResolvedValueOnce({ rows: [] });

    await svc.listShareCandidates(DEAL_ID, OWNER_ID, { limit: 'not-a-number' });

    expect(query.mock.calls[1][1][4]).toBe(20);
  });
});
