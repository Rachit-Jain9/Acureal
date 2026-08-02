'use strict';

/**
 * Monitoring writes moved off PostgREST and onto the normal database pool.
 *
 * They used to go through `supabase-js`, which means through PostgREST —
 * Acureal's second door into the database. Two consequences:
 *
 *   1. They authenticated as `service_role`, which BYPASSES RLS, so every row
 *      landed outside the tenant boundary that governs every other write.
 *   2. It was one of only two things keeping the `public` schema on the
 *      PostgREST surface at all.
 *
 * `query()` opens a transaction and stamps the tenant context with SET LOCAL,
 * so these rows are now scoped like everything else. These tests pin that the
 * service uses that path, stays fail-soft, and cannot emit a value the
 * `monitoring_severity` enum would reject.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/lib/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const { query } = require('../src/config/database');
const monitoring = require('../src/services/monitoring.service');

const ORG = '11111111-1111-1111-1111-111111111111';
const DEAL = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  jest.clearAllMocks();
  query.mockResolvedValue({ rows: [{ id: 'row-1' }] });
});

describe('recordMonitoringEvent', () => {
  test('writes through the pooled pg path, not a Supabase client', async () => {
    const r = await monitoring.recordMonitoringEvent({
      organizationId: ORG, dealId: DEAL, event: 'investor_package_ok', severity: 'info',
    });

    expect(r).toEqual({ persisted: true, id: 'row-1' });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO monitoring_logs/i);
    expect(params[0]).toBe(ORG);
    expect(params[1]).toBe(DEAL);
  });

  test('casts severity to the enum so a bad value fails loudly at the type, not silently', () => {
    expect(query).not.toHaveBeenCalled();
    return monitoring.recordMonitoringEvent({ event: 'x' }).then(() => {
      expect(query.mock.calls[0][0]).toMatch(/\$5::monitoring_severity/);
    });
  });

  test.each([
    ['info', 'info'],
    ['critical', 'critical'],
    ['CRITICAL', 'info'],
    ['fatal', 'info'],
    [undefined, 'info'],
    [null, 'info'],
  ])('clamps severity %s -> %s', (input, expected) => {
    expect(monitoring.clampSeverity(input)).toBe(expected);
  });

  test('serialises the payload as JSON rather than handing an object to pg', async () => {
    await monitoring.recordMonitoringEvent({ event: 'x', payload: { a: 1 } });
    expect(query.mock.calls[0][1][6]).toBe('{"a":1}');
  });

  test('an absent payload becomes {} rather than null', async () => {
    await monitoring.recordMonitoringEvent({ event: 'x', payload: undefined });
    expect(query.mock.calls[0][1][6]).toBe('{}');
  });

  test('refuses without an event name, and does not touch the database', async () => {
    const r = await monitoring.recordMonitoringEvent({ organizationId: ORG });
    expect(r).toEqual({ persisted: false, reason: 'event_required' });
    expect(query).not.toHaveBeenCalled();
  });

  test('is fail-soft — monitoring must never take down what it monitors', async () => {
    query.mockRejectedValueOnce(new Error('pg down'));
    const r = await monitoring.recordMonitoringEvent({ event: 'x' });
    expect(r).toEqual({ persisted: false, reason: 'pg down' });
  });
});

describe('persistInvestorPackageSnapshot', () => {
  test('writes the snapshot through the pooled pg path', async () => {
    const r = await monitoring.persistInvestorPackageSnapshot({
      organizationId: ORG, dealId: DEAL, engineVersion: 'inline', inputHash: 'abc', body: { x: 1 },
    });

    expect(r).toEqual({ persisted: true, id: 'row-1' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO investor_package_snapshots/i);
    expect(params[5]).toBe('{"x":1}');
  });

  test.each([
    ['dealId', { engineVersion: 'inline', body: {} }],
    ['engineVersion', { dealId: DEAL, body: {} }],
    ['body', { dealId: DEAL, engineVersion: 'inline' }],
  ])('refuses without %s', async (_field, args) => {
    const r = await monitoring.persistInvestorPackageSnapshot(args);
    expect(r).toEqual({ persisted: false, reason: 'missing_required_fields' });
    expect(query).not.toHaveBeenCalled();
  });

  test('is fail-soft', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    const r = await monitoring.persistInvestorPackageSnapshot({
      dealId: DEAL, engineVersion: 'inline', body: {},
    });
    expect(r.persisted).toBe(false);
  });
});

describe('the retired cohort writer', () => {
  test('is a no-op that reports itself rather than throwing mid-deploy', async () => {
    expect(await monitoring.upsertCohortDecision()).toEqual({
      persisted: false, reason: 'cohort_persistence_removed',
    });
  });
});

describe('the PostgREST dependency is gone', () => {
  test('the service imports the database pool and no Supabase client', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'monitoring.service.js'), 'utf8',
    );
    // Strip comments: the header explains WHY it moved off supabase-js, and
    // that explanation must not be mistaken for a live dependency.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, '');
    expect(code).toMatch(/require\('\.\.\/config\/database'\)/);
    expect(code).not.toMatch(/getSupabaseClient|supabase-js|\.from\(/);
  });

  test('the old Supabase-backed module is deleted, not left as a second path', () => {
    const fs = require('fs');
    const path = require('path');
    expect(fs.existsSync(path.join(__dirname, '..', 'src', 'services', 'monitoring.supabase.js')))
      .toBe(false);
  });

  test('the caller registers the writes as durable background work', () => {
    // A bare `.catch(() => {})` after res.json() is a coin flip on serverless:
    // the instance may freeze before the write lands, and the swallowed error
    // makes that indistinguishable from success.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'intelligence.routes.js'), 'utf8',
    );
    expect(src).toMatch(/runInBackground\(\s*'monitoring\.investor_package_snapshot'/);
    expect(src).toMatch(/runInBackground\(\s*'monitoring\.investor_package_event'/);
    expect(src).toMatch(/runInBackground\(\s*'monitoring\.investor_package_exception'/);
    expect(src).not.toMatch(/monitoring\.[a-zA-Z]+\([\s\S]{0,400}?\}\)\.catch\(\(\) => \{\}\)/);
  });
});
