/**
 * authDefiners — the SECURITY DEFINER probe (M1).
 *
 * The probe decides whether the auth bootstrap routes through the definer
 * functions (migration 20260801) or the original direct queries. Its safety
 * contract, pinned here:
 *   1. In the test env it NEVER touches the DB (existing mocked auth suites
 *      keep exercising the direct path deterministically).
 *   2. A thrown/transient probe error NEVER silently selects the direct path —
 *      it throws 503, because a probe failure means we could not DETERMINE
 *      which path is safe, and guessing wrong costs a total auth outage
 *      disguised as "invalid email or password".
 *   3. The fallback is gated on the LIVE ROLE's RLS posture, not on an env
 *      var. Post-flip (2026-07-28) production runs as `redip_app`, which
 *      cannot bypass RLS, so the direct path would read RLS-emptied rows.
 *      Basing the guard on `rolbypassrls` means it cannot be disarmed by
 *      deleting or mistyping a Vercel setting, and it self-configures: a dev
 *      database still on the bypass role keeps its working fallback.
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

// The probe now returns two facts in one round trip.
const probeRow = ({ present, bypassesRls }) => ({
  rows: [{ present, bypasses_rls: bypassesRls }],
});

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
    query.mockResolvedValueOnce(probeRow({ present: true, bypassesRls: false }));
    await expect(requireDefinerPath()).resolves.toBe(true);
    await expect(requireDefinerPath()).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('the probe reads BOTH the definer presence and the live RLS posture in one round trip', async () => {
    query.mockResolvedValueOnce(probeRow({ present: true, bypassesRls: false }));
    await requireDefinerPath();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('to_regprocedure($1) IS NOT NULL AS present');
    expect(sql).toContain('rolbypassrls');
    expect(sql).toContain('current_user');
    expect(params).toEqual([PROBE_SIGNATURE]);
  });

  test('definers absent BUT the role bypasses RLS → fallback is genuinely safe, cached', async () => {
    // A dev/pre-flip database: the direct queries are fully correct there.
    query.mockResolvedValueOnce(probeRow({ present: false, bypassesRls: true }));
    await expect(requireDefinerPath()).resolves.toBe(false);
    await expect(requireDefinerPath()).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('RED-TEAM PIN: definers absent AND the role cannot bypass RLS → loud 503, never a silent empty read', async () => {
    query.mockResolvedValueOnce(probeRow({ present: false, bypassesRls: false }));
    await expect(requireDefinerPath()).rejects.toMatchObject({ statusCode: 503 });
  });

  test('the misconfiguration 503 names the remedy', async () => {
    query.mockResolvedValueOnce(probeRow({ present: false, bypassesRls: false }));
    await expect(requireDefinerPath()).rejects.toMatchObject({
      message: expect.stringMatching(/Apply migration 20260801/),
    });
  });

  test('RED-TEAM PIN: a rejected probe ALWAYS throws 503 — it is never resolved into a fallback', async () => {
    // Previously this returned false whenever RLS_ENFORCED was absent. That
    // made a single deleted env var re-arm a silent auth outage across every
    // path at once. A probe failure now fails loud regardless of config.
    query.mockRejectedValueOnce(new Error('pooler hiccup'));
    await expect(requireDefinerPath()).rejects.toMatchObject({ statusCode: 503 });
  });

  test('a rejected probe is NOT cached — a later call re-probes and can succeed', async () => {
    query
      .mockRejectedValueOnce(new Error('pooler hiccup'))
      .mockResolvedValueOnce(probeRow({ present: true, bypassesRls: false }));

    await expect(requireDefinerPath()).rejects.toMatchObject({ statusCode: 503 });
    await expect(requireDefinerPath()).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });

  test('the guard cannot be disarmed by removing RLS_ENFORCED', async () => {
    // The env var is gone; the live role still cannot bypass RLS. The guard
    // must hold on the database fact alone.
    delete process.env.RLS_ENFORCED;
    query.mockResolvedValueOnce(probeRow({ present: false, bypassesRls: false }));
    await expect(requireDefinerPath()).rejects.toMatchObject({ statusCode: 503 });
  });

  test('probes the LAST/most-complex function so partial deployments fail closed', () => {
    expect(PROBE_SIGNATURE).toBe(
      'public.auth_provision_signup(text,text,text,text,text,text,text,boolean,boolean,text,text,text,text,text[],text,text,bigint[],inet,text)'
    );
  });
});
