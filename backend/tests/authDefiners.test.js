/**
 * authDefiners — the tri-state SECURITY DEFINER probe (M1 Phase 2).
 *
 * The probe decides whether the auth bootstrap routes through the definer
 * functions (migration 20260801) or the original direct queries. Its safety
 * contract, pinned here:
 *   1. In the test env it NEVER touches the DB (existing mocked auth suites
 *      keep exercising the direct path deterministically).
 *   2. Only DEFINITIVE probe results are cached. A thrown/transient probe
 *      error is never cached as "absent" — a cold-start pooler hiccup must
 *      not pin a warm post-flip instance onto the (RLS-emptied) direct path.
 *   3. RLS_ENFORCED=true makes the direct fallback UNREACHABLE: probe errors
 *      and definitive absence both throw a loud 503 instead of silently
 *      returning empty rows.
 */

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../src/config/database');
const {
  requireDefinerPath,
  PROBE_SIGNATURE,
  __forceForTests,
  __resetForTests,
} = require('../src/lib/authDefiners');

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  __resetForTests();
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  delete process.env.RLS_ENFORCED;
  jest.clearAllMocks();
});

describe('authDefiners.requireDefinerPath — test-env guard', () => {
  test('returns false in the test env without ever querying the DB', async () => {
    await expect(requireDefinerPath()).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  test('__forceForTests(true) opts a test into the definer path, still without querying', async () => {
    __forceForTests(true);
    await expect(requireDefinerPath()).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('authDefiners.requireDefinerPath — probe semantics (non-test env)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  test('definitive true is cached — second call issues no query', async () => {
    query.mockResolvedValueOnce({ rows: [{ present: true }] });
    await expect(requireDefinerPath()).resolves.toBe(true);
    await expect(requireDefinerPath()).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      'SELECT to_regprocedure($1) IS NOT NULL AS present',
      [PROBE_SIGNATURE]
    );
  });

  test('definitive false is cached (RLS not enforced) — second call issues no query', async () => {
    query.mockResolvedValueOnce({ rows: [{ present: false }] });
    await expect(requireDefinerPath()).resolves.toBe(false);
    await expect(requireDefinerPath()).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('RED-TEAM PIN: a rejected probe is NOT cached — the next call re-probes and can flip to true', async () => {
    query
      .mockRejectedValueOnce(new Error('pooler hiccup'))
      .mockResolvedValueOnce({ rows: [{ present: true }] });

    await expect(requireDefinerPath()).resolves.toBe(false); // transient, uncached
    await expect(requireDefinerPath()).resolves.toBe(true);  // re-probed
    expect(query).toHaveBeenCalledTimes(2);
  });

  test('RLS_ENFORCED=true: a rejected probe throws 503 — never a silent direct fallback', async () => {
    process.env.RLS_ENFORCED = 'true';
    query.mockRejectedValueOnce(new Error('pooler hiccup'));
    await expect(requireDefinerPath()).rejects.toMatchObject({ statusCode: 503 });
  });

  test('RLS_ENFORCED=true: definitive absence throws 503 (flip before migration = loud misconfig)', async () => {
    process.env.RLS_ENFORCED = 'true';
    query.mockResolvedValueOnce({ rows: [{ present: false }] });
    await expect(requireDefinerPath()).rejects.toMatchObject({ statusCode: 503 });
  });

  test('probes the LAST/most-complex function so partial deployments fail closed', () => {
    expect(PROBE_SIGNATURE).toBe(
      'public.auth_provision_signup(text,text,text,text,text,text,text,boolean,boolean,text,text,text,text,text[],text,text,bigint[],inet,text)'
    );
  });
});
