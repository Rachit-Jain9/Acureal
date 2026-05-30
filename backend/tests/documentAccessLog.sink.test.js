'use strict';

// Unit + integration tests for the immutable document-access audit sink.
//
// Two contracts the rest of the system leans on:
//   1. writeAccessRow is FAIL-OPEN. A missing migration (42P01), a generic DB
//      error, or an incomplete payload all collapse to a logged warning + null.
//      A download must NEVER break because its audit insert did.
//   2. Wired onto the bus, a DOCUMENT_ACCESSED event lands exactly one
//      append-only INSERT into document_access_log with the expected columns.

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const { query } = require('../src/config/database');
const { EVENTS, publish, clearAllSubscribers } = require('../src/lib/eventBus');
const sink = require('../src/services/documentAccessLog.sink');

// Silence the warn path so the fail-open tests don't spam test output.
let warnSpy;
beforeAll(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { warnSpy.mockRestore(); });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('documentAccessLog.writeAccessRow', () => {
  test('happy path: inserts the row and returns its id, with columns in order', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'log-1' }] });
    const id = await sink.writeAccessRow({
      documentId: 'doc-1',
      organizationId: 'org-1',
      userId: 'user-1',
      action: 'signed_url',
      documentKind: 'deal_document',
      documentName: 'Title Deed.pdf',
      dealId: 'deal-1',
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });
    expect(id).toBe('log-1');
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO document_access_log/);
    // params: org, doc, kind, name, deal, user, action, ip, ua, metadata
    expect(params.slice(0, 9)).toEqual([
      'org-1', 'doc-1', 'deal_document', 'Title Deed.pdf', 'deal-1',
      'user-1', 'signed_url', '203.0.113.7', 'Mozilla/5.0',
    ]);
  });

  test('skips when documentId is missing — no DB call', async () => {
    const id = await sink.writeAccessRow({ action: 'download' });
    expect(id).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  test('skips when action is missing — no DB call', async () => {
    const id = await sink.writeAccessRow({ documentId: 'doc-1' });
    expect(id).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  test('normalises an unknown action + kind to safe defaults', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'log-2' }] });
    await sink.writeAccessRow({ documentId: 'doc-1', action: 'exfiltrate', documentKind: 'evil' });
    const params = query.mock.calls[0][1];
    expect(params[6]).toBe('download');      // action normalised
    expect(params[2]).toBe('deal_document'); // kind normalised
  });

  test('truncates oversized ip + user-agent so the insert never overflows', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'log-3' }] });
    await sink.writeAccessRow({
      documentId: 'doc-1',
      action: 'download',
      ip: 'x'.repeat(500),
      userAgent: 'y'.repeat(5000),
    });
    const params = query.mock.calls[0][1];
    expect(params[7].length).toBeLessThanOrEqual(100);
    expect(params[8].length).toBeLessThanOrEqual(1000);
  });

  test('falls back to current_organization_id() when org is absent', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'log-4' }] });
    await sink.writeAccessRow({ documentId: 'doc-1', action: 'download' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(\$1, current_organization_id\(\)\)/);
    expect(params[0]).toBeNull();
  });

  test('returns null when the migration is missing (Postgres 42P01) — never throws', async () => {
    const err = new Error('relation "document_access_log" does not exist');
    err.code = '42P01';
    query.mockRejectedValueOnce(err);
    await expect(
      sink.writeAccessRow({ documentId: 'doc-1', action: 'download' }),
    ).resolves.toBeNull();
  });

  test('returns null on a generic DB error — never throws', async () => {
    query.mockRejectedValueOnce(new Error('connection terminated'));
    await expect(
      sink.writeAccessRow({ documentId: 'doc-1', action: 'download' }),
    ).resolves.toBeNull();
  });
});

describe('documentAccessLog sink — wired onto the event bus', () => {
  afterEach(() => {
    sink.unregister();
    clearAllSubscribers();
  });

  test('a DOCUMENT_ACCESSED event writes exactly one access row', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'log-bus-1' }] });
    sink.register();
    await publish(EVENTS.DOCUMENT_ACCESSED, {
      documentId: 'doc-9',
      organizationId: 'org-9',
      userId: 'user-9',
      action: 'signed_url',
      documentName: 'EC.pdf',
      dealId: 'deal-9',
    });
    const insert = query.mock.calls.find(([sql]) => /INSERT INTO document_access_log/.test(sql));
    expect(insert).toBeTruthy();
    expect(insert[1][1]).toBe('doc-9');     // document_id
    expect(insert[1][6]).toBe('signed_url'); // action
  });

  test('register is idempotent — a single event still writes only one row', async () => {
    query.mockResolvedValue({ rows: [{ id: 'log-bus-2' }] });
    sink.register();
    sink.register(); // second call must not double-subscribe
    await publish(EVENTS.DOCUMENT_ACCESSED, { documentId: 'doc-1', action: 'download' });
    const inserts = query.mock.calls.filter(([sql]) => /INSERT INTO document_access_log/.test(sql));
    expect(inserts).toHaveLength(1);
  });

  test('after unregister, an event writes nothing', async () => {
    sink.register();
    sink.unregister();
    await publish(EVENTS.DOCUMENT_ACCESSED, { documentId: 'doc-1', action: 'download' });
    expect(query).not.toHaveBeenCalled();
  });
});
