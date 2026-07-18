jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

jest.mock('../src/lib/logger', () => {
  const child = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child };
});

jest.mock('../src/lib/sentry', () => ({
  Sentry: { captureMessage: jest.fn() },
  isEnabled: jest.fn(() => true),
}));

const { query, getClient } = require('../src/config/database');
const { Sentry, isEnabled } = require('../src/lib/sentry');
const health = require('../src/services/healthCheck.service');

// A tenant-isolation client that returns the given canary row for the SELECT
// and resolves BEGIN / set_config / COMMIT. Used to drive checkTenantIsolation.
const mockIsolationClient = (canaryRow) => {
  const client = {
    query: jest.fn((sql) => {
      if (/scoped_visible_deals/.test(sql)) return Promise.resolve({ rows: [canaryRow] });
      return Promise.resolve({ rows: [] });
    }),
    release: jest.fn(),
  };
  getClient.mockResolvedValueOnce(client);
  return client;
};

beforeEach(() => {
  jest.clearAllMocks();
  isEnabled.mockReturnValue(true);
});

describe('healthCheck.checkAiErrorShare', () => {
  test('healthy when every model is within the error threshold', async () => {
    query.mockResolvedValueOnce({
      rows: [{ provider: 'gemini', model: 'gemini-3.1-flash-lite', provider_calls: 100, failures: 3 }],
    });
    const r = await health.checkAiErrorShare();
    expect(r.status).toBe('healthy');
    expect(r.offenders).toHaveLength(0);
    expect(r.models_checked).toBe(1);
  });

  test('unhealthy when a model crosses the error-share threshold', async () => {
    query.mockResolvedValueOnce({
      rows: [{ provider: 'gemini', model: 'retired-model', provider_calls: 40, failures: 40 }],
    });
    const r = await health.checkAiErrorShare();
    expect(r.status).toBe('unhealthy');
    expect(r.offenders).toHaveLength(1);
    expect(r.offenders[0].error_share).toBe(1);
    expect(r.detail).toMatch(/retired-model/);
  });

  test('the min-sample HAVING guard is in the SQL', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await health.checkAiErrorShare();
    expect(query.mock.calls[0][0]).toMatch(/HAVING/i);
    expect(query.mock.calls[0][0]).toMatch(/ai_call_logs/);
  });

  test('unknown (never throws) when the query fails', async () => {
    query.mockRejectedValueOnce(new Error('logs table gone'));
    const r = await health.checkAiErrorShare();
    expect(r.status).toBe('unknown');
    expect(r.error).toBe('logs table gone');
  });
});

describe('healthCheck.checkAuditWrites', () => {
  test('healthy when deals mutated AND audit rows were written', async () => {
    query.mockResolvedValueOnce({
      rows: [{ audit_writes: 12, event_writes: 4, activity_writes: 9, deal_mutations: 6 }],
    });
    const r = await health.checkAuditWrites();
    expect(r.status).toBe('healthy');
  });

  test('unhealthy when deals mutated but ZERO audit + event writes (the dead-trail signature)', async () => {
    query.mockResolvedValueOnce({
      rows: [{ audit_writes: 0, event_writes: 0, activity_writes: 5, deal_mutations: 3 }],
    });
    const r = await health.checkAuditWrites();
    expect(r.status).toBe('unhealthy');
    expect(r.detail).toMatch(/ZERO audit writes/);
  });

  test('healthy (not suspicious) when the window is genuinely quiet', async () => {
    query.mockResolvedValueOnce({
      rows: [{ audit_writes: 0, event_writes: 0, activity_writes: 0, deal_mutations: 0 }],
    });
    const r = await health.checkAuditWrites();
    expect(r.status).toBe('healthy');
    expect(r.detail).toMatch(/nothing to audit/i);
  });
});

describe('healthCheck.checkStuckExtractions', () => {
  test('healthy when nothing is stuck', async () => {
    query.mockResolvedValueOnce({ rows: [{ stuck: 0 }] });
    const r = await health.checkStuckExtractions();
    expect(r.status).toBe('healthy');
    expect(r.stuck).toBe(0);
  });

  test('unhealthy when processing rows are stuck past the budget', async () => {
    query.mockResolvedValueOnce({ rows: [{ stuck: 2 }] });
    const r = await health.checkStuckExtractions();
    expect(r.status).toBe('unhealthy');
    expect(r.stuck).toBe(2);
    // The staleness predicate must survive a NULL extraction_started_at.
    expect(query.mock.calls[0][0]).toMatch(/COALESCE\(extraction_started_at, created_at\)/);
  });
});

describe('healthCheck.checkTenantIsolation', () => {
  test('healthy + fail_closed when no org context yields zero visible deals', async () => {
    const client = mockIsolationClient({
      db_role: 'postgres', is_superuser: 'on', bypasses_rls: true,
      ctx_is_null: true, scoped_visible_deals: 0,
    });
    const r = await health.checkTenantIsolation();
    expect(r.status).toBe('healthy');
    expect(r.fail_closed).toBe(true);
    expect(r.bypasses_rls).toBe(true);
    // Surfaces the M1 posture note when the role still bypasses RLS.
    expect(r.detail).toMatch(/defence-in-depth/);
    // Clears the org context inside its own transaction.
    expect(client.query).toHaveBeenCalledWith(expect.stringMatching(/set_config\('app.current_organization_id', '', true\)/));
    expect(client.release).toHaveBeenCalled();
  });

  test('UNHEALTHY when a scoped read leaks rows with no org context', async () => {
    mockIsolationClient({
      db_role: 'postgres', is_superuser: 'on', bypasses_rls: true,
      ctx_is_null: true, scoped_visible_deals: 17,
    });
    const r = await health.checkTenantIsolation();
    expect(r.status).toBe('unhealthy');
    expect(r.fail_closed).toBe(false);
    expect(r.detail).toMatch(/FAIL-CLOSED BROKEN/);
  });

  test('rolls back and reports unknown if the canary query throws', async () => {
    const client = {
      query: jest.fn((sql) => {
        if (/scoped_visible_deals/.test(sql)) return Promise.reject(new Error('pg down'));
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    getClient.mockResolvedValueOnce(client);
    const r = await health.checkTenantIsolation();
    expect(r.status).toBe('unknown');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('healthCheck.runHealthCheck', () => {
  const healthyCanary = {
    db_role: 'postgres', is_superuser: 'on', bypasses_rls: true,
    ctx_is_null: true, scoped_visible_deals: 0,
  };

  test('aggregates all four checks and reports overall healthy', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })                                            // ai
      .mockResolvedValueOnce({ rows: [{ audit_writes: 1, event_writes: 1, activity_writes: 1, deal_mutations: 1 }] }) // audit
      .mockResolvedValueOnce({ rows: [{ stuck: 0 }] });                               // extractions
    mockIsolationClient(healthyCanary);

    const summary = await health.runHealthCheck({ raiseAlerts: false });
    expect(summary.overall).toBe('healthy');
    expect(Object.keys(summary.checks)).toEqual(['ai_providers', 'audit_trail', 'extractions', 'tenant_isolation']);
    expect(summary.unhealthy_count).toBe(0);
    expect(typeof summary.duration_ms).toBe('number');
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  test('overall unhealthy when any subsystem is unhealthy, and raiseAlerts fires one fingerprinted Sentry alert per unhealthy check', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ provider: 'gemini', model: 'dead', provider_calls: 20, failures: 20 }] }) // ai unhealthy
      .mockResolvedValueOnce({ rows: [{ audit_writes: 5, event_writes: 1, activity_writes: 5, deal_mutations: 2 }] }) // audit healthy
      .mockResolvedValueOnce({ rows: [{ stuck: 3 }] });                               // extractions unhealthy
    mockIsolationClient(healthyCanary);

    const summary = await health.runHealthCheck({ raiseAlerts: true });
    expect(summary.overall).toBe('unhealthy');
    expect(summary.unhealthy_count).toBe(2);
    expect(summary.alerts_raised).toBe(2);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
    // Each alert carries a stable fingerprint so hourly repeats collapse to one issue.
    const call = Sentry.captureMessage.mock.calls[0];
    expect(call[1].fingerprint).toEqual(['liveness', expect.any(String)]);
    expect(call[1].level).toBe('error');
    expect(call[1].tags.watchdog).toBe('liveness');
  });

  test('never raises alerts when Sentry is disabled', async () => {
    isEnabled.mockReturnValue(false);
    query
      .mockResolvedValueOnce({ rows: [{ provider: 'gemini', model: 'dead', provider_calls: 20, failures: 20 }] })
      .mockResolvedValueOnce({ rows: [{ audit_writes: 1, event_writes: 1, activity_writes: 1, deal_mutations: 1 }] })
      .mockResolvedValueOnce({ rows: [{ stuck: 0 }] });
    mockIsolationClient(healthyCanary);

    const summary = await health.runHealthCheck({ raiseAlerts: true });
    expect(summary.overall).toBe('unhealthy');
    expect(summary.alerts_raised).toBe(0);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});
