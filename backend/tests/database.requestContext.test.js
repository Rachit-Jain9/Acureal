'use strict';

// Regression guard for the transaction-pooler org-context race (2026-07-09).
//
// Under Supabase's transaction-mode pooler (:6543), a session-level `SET`
// issued as a separate statement from the query it scopes can land on a
// DIFFERENT backend — so `current_organization_id()` read NULL and org-scoped
// queries intermittently returned ZERO rows (blank dashboard widgets / empty
// Deals list). The fix: set the tenant context with SET LOCAL (is_local=true)
// INSIDE the same transaction (BEGIN … COMMIT) as the query. This test pins
// that sequence so the fix can't silently regress.
//
// (jest hoists jest.mock() factories above the file, so anything they close
// over must be prefixed `mock`.)

const mockCalls = [];
const mockClient = {
  query: jest.fn((text) => {
    const t = typeof text === 'string' ? text : text && text.text;
    if (t === '__BOOM__') {
      mockCalls.push('__BOOM__');
      return Promise.reject(new Error('boom'));
    }
    mockCalls.push(t);
    return Promise.resolve({ rows: [], rowCount: 0 });
  }),
  release: jest.fn(),
};

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    connect: jest.fn(() => Promise.resolve(mockClient)),
    on: jest.fn(),
  })),
}));

jest.mock('../src/lib/requestContext', () => ({
  getRequestContext: () => ({ userId: 'user-1', organizationId: 'org-1' }),
}));

const { query } = require('../src/config/database');

describe('database.query — tenant context under the transaction pooler', () => {
  beforeEach(() => { mockCalls.length = 0; mockClient.query.mockClear(); mockClient.release.mockClear(); });

  it('runs BEGIN → SET LOCAL context → query → COMMIT in one transaction', async () => {
    await query('SELECT 1', []);

    // The context-set + query share one transaction — that is what pins them to
    // the same pooled backend and guarantees current_organization_id() is set.
    expect(mockCalls[0]).toBe('BEGIN');
    expect(mockCalls[1]).toMatch(/set_config\('app\.current_user_id'/);
    expect(mockCalls[1]).toMatch(/set_config\('app\.current_organization_id'/);
    // is_local = true (the 3rd arg) — so the GUC is scoped to THIS transaction
    // and discarded at COMMIT (no cross-request leak).
    expect(mockCalls[1]).toMatch(/,\s*true\)/);
    expect(mockCalls[1]).not.toMatch(/,\s*false\)/);
    expect(mockCalls[2]).toBe('SELECT 1');
    expect(mockCalls[3]).toBe('COMMIT');

    // Context values are passed as params (parameterised — no injection).
    const ctxCall = mockClient.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('set_config'),
    );
    expect(ctxCall[1]).toEqual(['user-1', 'org-1']);

    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('ROLLBACKs and rethrows if the query fails, and still releases the client', async () => {
    await expect(query('__BOOM__', [])).rejects.toThrow('boom');
    expect(mockCalls).toContain('BEGIN');
    expect(mockCalls).toContain('ROLLBACK');
    expect(mockCalls).not.toContain('COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
