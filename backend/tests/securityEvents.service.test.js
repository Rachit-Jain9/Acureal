'use strict';

// Unit tests for the security_events register service.
//
// Pins the contracts callers depend on:
//   1. recordEvent() is fail-open — a missing migration, bad input, or an
//      arbitrary DB error all collapse to a logged warning + null return.
//      Recording a security event must never break its trigger.
//   2. listEvents() reads newest-first with the limit clamped, and returns
//      [] when the table is missing.
//   3. updateEvent() only writes whitelisted columns and stamps the
//      regulatory-clock timestamps on request.

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

const { query } = require('../src/config/database');
const securityEvents = require('../src/services/securityEvents.service');

beforeEach(() => {
  jest.clearAllMocks();
});

let warnSpy;
beforeAll(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { warnSpy.mockRestore(); });

describe('securityEvents.recordEvent', () => {
  test('happy path: inserts and returns the row', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'se-1', event_type: 'login_lockout', severity: 'medium', status: 'open' }],
    });
    const row = await securityEvents.recordEvent({
      organizationId: 'o-1',
      eventType: 'login_lockout',
      severity: 'medium',
      summary: 'Account locked after 5 failed attempts',
    });
    expect(row).toMatchObject({ id: 'se-1', event_type: 'login_lockout' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('skips when eventType or summary is missing — no DB call', async () => {
    expect(await securityEvents.recordEvent({ summary: 'x' })).toBeNull();
    expect(await securityEvents.recordEvent({ eventType: 'x' })).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  test('coerces an unknown severity to low', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'se-2' }] });
    await securityEvents.recordEvent({
      eventType: 'test_event', summary: 'test', severity: 'apocalyptic',
    });
    expect(query.mock.calls[0][1][2]).toBe('low');
  });

  test('returns null when the migration is missing (42P01) — never throws', async () => {
    const err = new Error('relation "security_events" does not exist');
    err.code = '42P01';
    query.mockRejectedValueOnce(err);
    const row = await securityEvents.recordEvent({ eventType: 'suspected_breach', summary: 'x' });
    expect(row).toBeNull();
  });

  test('returns null on a generic DB error — never throws', async () => {
    query.mockRejectedValueOnce(new Error('connection terminated'));
    const row = await securityEvents.recordEvent({ eventType: 'vendor_incident', summary: 'x' });
    expect(row).toBeNull();
  });
});

describe('securityEvents.listEvents', () => {
  test('reads newest-first and clamps the limit to 500', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'se-2' }, { id: 'se-1' }] });
    const rows = await securityEvents.listEvents({ organizationId: 'o-1', limit: 99999 });
    expect(rows).toHaveLength(2);
    const params = query.mock.calls[0][1];
    expect(params[params.length - 1]).toBeLessThanOrEqual(500);
  });

  test('applies status and severity filters', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await securityEvents.listEvents({ organizationId: 'o-1', status: 'open', severity: 'critical' });
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/status = \$/);
    expect(sql).toMatch(/severity = \$/);
  });

  test('returns [] when the table is missing (42P01)', async () => {
    const err = new Error('relation "security_events" does not exist');
    err.code = '42P01';
    query.mockRejectedValueOnce(err);
    expect(await securityEvents.listEvents({ organizationId: 'o-1' })).toEqual([]);
  });

  test('rethrows a generic DB error so the caller can decide', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    await expect(securityEvents.listEvents({ organizationId: 'o-1' })).rejects.toThrow('boom');
  });
});

describe('securityEvents.updateEvent', () => {
  test('writes whitelisted columns and stamps resolved_at on resolution', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'se-1', status: 'resolved' }] });
    const row = await securityEvents.updateEvent('se-1', 'o-1', { status: 'resolved' });
    expect(row).toMatchObject({ status: 'resolved' });
    expect(query.mock.calls[0][0]).toMatch(/resolved_at = NOW\(\)/);
  });

  test('stamps the CERT-In clock when cert_in_reported_at is flagged', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'se-1' }] });
    await securityEvents.updateEvent('se-1', 'o-1', { cert_in_reported_at: true });
    expect(query.mock.calls[0][0]).toMatch(/cert_in_reported_at = NOW\(\)/);
  });

  test('ignores an unknown status — falls through to a no-op read', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'se-1' }] });
    await securityEvents.updateEvent('se-1', 'o-1', { status: 'made_up' });
    // No UPDATE built — the only call is the getEvent() SELECT fallback.
    expect(query.mock.calls[0][0]).toMatch(/SELECT/);
  });
});
