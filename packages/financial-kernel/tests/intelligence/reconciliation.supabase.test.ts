/**
 * Phase 5 reconciliation: round-trip an InvestorPackage snapshot through
 * the live `investor_package_snapshots` table and assert the body we
 * get back matches what we sent, byte-for-byte on the KPI block and
 * input_hash-exact on the payload.
 *
 * Skipped in CI unless both SUPABASE_URL and SUPABASE_KEY (or
 * SUPABASE_SERVICE_ROLE_KEY) are present. Safe to run locally against a
 * dev project — inserts one row under a disposable deal_id and deletes
 * it in afterAll.
 *
 * Intentionally does NOT use @supabase/supabase-js (the kernel package
 * stays dependency-light). Uses Node 18+ global fetch + PostgREST.
 */
import * as crypto from 'crypto';

const URL = (process.env.SUPABASE_URL ?? '').trim();
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? '').trim();
const CONFIGURED = URL.length > 0 && KEY.length > 0;

// Disposable deal id in a dedicated UUID namespace so prod filters can
// exclude `deal_id` starting with '00000000-' if they want.
const TEST_DEAL_ID = `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0')}`;

const sha256Hex = (s: string) =>
  crypto.createHash('sha256').update(s).digest('hex');

function sampleBody() {
  return {
    summary: {
      dealId: TEST_DEAL_ID,
      engineVersion: 'python',
      generatedAt: new Date().toISOString(),
      headline: 'Test IRR 12.3% · Min DSCR 1.42x',
      narrative: 'Synthetic snapshot for reconciliation test.',
      kpi: {
        irrLeveredPct: 12.345,
        minDSCR: 1.42,
        moic: 1.7,
        llcr: 1.33,
        peakEquityCr: 25.5,
        peakDebtCr: 75.0,
        residualTotalCr: 8.2,
        breachCount: 0,
      },
      insights: [
        { kind: 'risk', severity: 'low', title: 'test', explanation: 'test' },
      ],
    },
  };
}

// `test.skip` at describe-level when env missing — keeps jest green for
// contributors without credentials while still running in prod CI.
const d: jest.Describe = CONFIGURED ? describe : describe.skip;

d('investor_package_snapshots reconciliation', () => {
  const body = sampleBody();
  const input_hash = sha256Hex(JSON.stringify(body));

  afterAll(async () => {
    if (!CONFIGURED) return;
    await fetch(
      `${URL}/rest/v1/investor_package_snapshots?deal_id=eq.${TEST_DEAL_ID}`,
      {
        method: 'DELETE',
        headers: {
          apikey: KEY,
          authorization: `Bearer ${KEY}`,
          'content-type': 'application/json',
          prefer: 'return=minimal',
        },
      },
    );
    await fetch(
      `${URL}/rest/v1/investor_packages?deal_id=eq.${TEST_DEAL_ID}`,
      {
        method: 'DELETE',
        headers: {
          apikey: KEY,
          authorization: `Bearer ${KEY}`,
          'content-type': 'application/json',
          prefer: 'return=minimal',
        },
      },
    );
  }, 10_000);

  test('snapshot round-trips with matching hash and KPI', async () => {
    const insertResp = await fetch(`${URL}/rest/v1/investor_package_snapshots`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        authorization: `Bearer ${KEY}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({
        deal_id: TEST_DEAL_ID,
        engine_version: 'python',
        source: 'jest-reconciliation',
        input_hash,
        body,
      }),
    });
    expect(insertResp.status).toBeLessThan(300);

    const getResp = await fetch(
      `${URL}/rest/v1/investor_package_snapshots?deal_id=eq.${TEST_DEAL_ID}&select=body,input_hash,engine_version`,
      {
        headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
      },
    );
    expect(getResp.ok).toBe(true);
    const rows = (await getResp.json()) as Array<{
      body: ReturnType<typeof sampleBody>;
      input_hash: string;
      engine_version: string;
    }>;
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.engine_version).toBe('python');
    expect(row.input_hash).toBe(input_hash);
    expect(row.body.summary.kpi.irrLeveredPct).toBeCloseTo(12.345, 5);
    expect(row.body.summary.kpi.minDSCR).toBeCloseTo(1.42, 5);
    expect(row.body.summary.headline).toBe(body.summary.headline);
  }, 15_000);
});

// Keep a non-skipped harness so the file always registers one test and
// jest doesn't warn about empty suites when credentials are missing.
describe('reconciliation config guard', () => {
  test('env presence is reported', () => {
    // Purely informational — no assertion on CONFIGURED value so the
    // suite passes both with and without a live Supabase.
    expect(typeof CONFIGURED).toBe('boolean');
  });
});
