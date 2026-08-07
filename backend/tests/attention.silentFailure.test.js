'use strict';

/**
 * "Today's Attention" must never claim an all-clear it did not verify.
 *
 * The service fans out five independent queries and degrades each to an empty
 * list so one broken read cannot blank the tile. That part is right. What was
 * wrong is that it did it with a bare `.catch(() => [])` and the file contained
 * no logger at all — so a failing query and a genuinely clear portfolio
 * produced byte-identical output, and the user read "nothing needs your
 * attention".
 *
 * On a surface whose entire job is "tell me what I must not miss", that is the
 * one sentence it must never say when it does not know. This repo has shipped
 * the class before: a deal audit trail dead for four months, an invitation loop
 * that never sent an email.
 *
 * Two guarantees are pinned here: the failure is LOGGED, and it is REPORTED to
 * the caller in `unavailable` so the UI can distinguish "clear" from "unknown".
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const mockLog = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
jest.mock('../src/lib/logger', () => ({ child: () => mockLog }));

const { query } = require('../src/config/database');
const attention = require('../src/services/attention.service');

const rows = (r) => Promise.resolve({ rows: r });
const boom = (code) => {
  const e = new Error('relation does not exist');
  e.code = code;
  return Promise.reject(e);
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('every signal healthy', () => {
  test('reports nothing unavailable and does not log', async () => {
    query.mockImplementation(() => rows([]));

    const result = await attention.getAttention();

    expect(result.unavailable).toEqual([]);
    expect(result.totals.any).toBe(false);
    expect(mockLog.error).not.toHaveBeenCalled();
  });

  test('a genuinely populated portfolio still counts correctly', async () => {
    // Five calls, in the order getAttention fans them out.
    query
      .mockImplementationOnce(() => rows([{ id: 'dd-1' }, { id: 'dd-2' }]))
      .mockImplementationOnce(() => rows([{ id: 'ap-1' }]))
      .mockImplementationOnce(() => rows([{ id: 'rf-1' }]))
      .mockImplementationOnce(() => rows([]))
      .mockImplementationOnce(() => rows([{ id: 'act-1' }]));

    const result = await attention.getAttention();

    expect(result.unavailable).toEqual([]);
    expect(result.totals.overdue_dd).toBe(2);
    expect(result.totals.expiring_approvals).toBe(1);
    expect(result.totals.new_risk_flags).toBe(1);
    expect(result.totals.stale_deals).toBe(0);
    expect(result.totals.any).toBe(true);
  });
});

describe('a failing signal is never presented as an all-clear', () => {
  test('one broken query is named in `unavailable` and logged', async () => {
    query
      .mockImplementationOnce(() => boom('42P01')) // overdue_dd_items
      .mockImplementationOnce(() => rows([]))
      .mockImplementationOnce(() => rows([]))
      .mockImplementationOnce(() => rows([]))
      .mockImplementationOnce(() => rows([]));

    const result = await attention.getAttention();

    // The list is still empty — the tile does not break…
    expect(result.overdue_dd_items).toEqual([]);
    // …but the response says WHY, so the UI need not guess.
    expect(result.unavailable).toEqual(['overdue_dd_items']);

    expect(mockLog.error).toHaveBeenCalledTimes(1);
    const [event, err, meta] = mockLog.error.mock.calls[0];
    expect(event).toBe('attention_signal_failed');
    expect(err).toBeInstanceOf(Error);
    expect(meta).toMatchObject({ signal: 'overdue_dd_items', code: '42P01' });
  });

  test('the other four signals still return their rows', async () => {
    query
      .mockImplementationOnce(() => boom('42P01'))
      .mockImplementationOnce(() => rows([{ id: 'ap-1' }]))
      .mockImplementationOnce(() => rows([{ id: 'rf-1' }]))
      .mockImplementationOnce(() => rows([{ id: 'deal-1' }]))
      .mockImplementationOnce(() => rows([{ id: 'act-1' }]));

    const result = await attention.getAttention();

    expect(result.expiring_approvals).toHaveLength(1);
    expect(result.new_risk_flags).toHaveLength(1);
    expect(result.stale_deals).toHaveLength(1);
    expect(result.recent_activity).toHaveLength(1);
    expect(result.unavailable).toEqual(['overdue_dd_items']);
  });

  test('TOTAL failure is the case that used to read as a clean portfolio', async () => {
    // Before the fix this returned every list empty, totals.any === false, and
    // nothing anywhere said the database had not been reachable.
    query.mockImplementation(() => boom('57P01'));

    const result = await attention.getAttention();

    expect(result.unavailable).toEqual([
      'expiring_approvals',
      'new_risk_flags',
      'overdue_dd_items',
      'recent_activity',
      'stale_deals',
    ]);
    // totals.any is still false — there genuinely are no rows to show — but a
    // caller can no longer read that as "all clear" without checking this.
    expect(result.totals.any).toBe(false);
    expect(mockLog.error).toHaveBeenCalledTimes(5);
  });

  test('the log carries codes and counts only — never deal content', async () => {
    query.mockImplementationOnce(() => boom('42P01')).mockImplementation(() => rows([]));

    await attention.getAttention();

    const meta = mockLog.error.mock.calls[0][2];
    expect(Object.keys(meta).sort()).toEqual(['code', 'signal']);
  });
});

describe('the individual getters stay usable standalone', () => {
  // They are exported "for tests / future composition"; the failures array is
  // optional so an existing caller cannot break.
  test('a getter called without a failures array still degrades safely', async () => {
    query.mockImplementation(() => boom('42P01'));
    await expect(attention.getOverdueDdItems()).resolves.toEqual([]);
    expect(mockLog.error).toHaveBeenCalledWith(
      'attention_signal_failed',
      expect.any(Error),
      expect.objectContaining({ signal: 'overdue_dd_items' }),
    );
  });
});
