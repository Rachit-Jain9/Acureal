'use strict';

/**
 * The audit-trail visibility gate.
 *
 * ── The bug these tests exist to prevent ────────────────────────────────────
 * `listDealEvents` gated on `getFinancials(dealId)`, which INNER JOINs the
 * `financials` table and throws 404 "Financials not found for this deal."
 * That answered the wrong question. Reading a deal's events is authorized by
 * access to the DEAL; whether a financial model exists is unrelated — and for
 * most deals there is none (CLAUDE.md requires sourcing-stage deals to work
 * with minimal data). In production this 404'd 44×/day.
 *
 * It was not merely noise. This feed MERGES two independent sources:
 *   • deal_events    — HMAC-signed financial computations. Legitimately empty
 *                      with no model.
 *   • deal_audit_log — stage transitions, archive/restore, reassign, update.
 *                      POPULATED for deals that never had a model.
 * So the gate suppressed a real, readable audit trail and made the Audit tab
 * render "Couldn't load the audit trail" — inverting CLAUDE.md's
 * non-negotiable: an immutable audit trail for every material change.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock('../src/services/audit.service', () => ({
  listEvents: jest.fn(),
  verifyEvent: jest.fn(() => ({ valid: true })),
  recordEvent: jest.fn(),
  flattenOutputsForAudit: jest.fn(() => ({})),
}));
jest.mock('../src/services/dealAuditLog.service', () => ({ listForDeal: jest.fn() }));

const { query } = require('../src/config/database');
const auditService = require('../src/services/audit.service');
const dealAuditLog = require('../src/services/dealAuditLog.service');
const financialService = require('../src/services/financial.service');

// A stage change on a deal that has never had a financial model — exactly the
// row the old gate threw away.
const MUTATION_ROW = {
  id: 'm1',
  deal_id: 'deal-1',
  event_type: 'stage_changed',
  actor_id: 'u1',
  before_json: { stage: 'screening' },
  after_json: { stage: 'loi' },
  metadata: {},
  created_at: '2026-07-01T10:00:00Z',
};

const visibleDeal = () => query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
const invisibleDeal = () => query.mockResolvedValueOnce({ rows: [] });

beforeEach(() => {
  jest.clearAllMocks();
  auditService.listEvents.mockResolvedValue([]);
  dealAuditLog.listForDeal.mockResolvedValue([MUTATION_ROW]);
  // Bulk actor-name hydration lookup.
  query.mockResolvedValue({ rows: [] });
});

describe('a deal with NO financial model still returns its audit trail', () => {
  test('returns the mutation rows instead of throwing 404', async () => {
    visibleDeal();

    const out = await financialService.listDealEvents('deal-1', { limit: 50 });

    expect(Array.isArray(out.events ?? out)).toBe(true);
    const events = out.events ?? out;
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.event_type === 'stage_changed')).toBe(true);
  });

  test('the gate queries DEAL visibility, never the financials table', async () => {
    visibleDeal();
    await financialService.listDealEvents('deal-1', { limit: 50 });

    const gateSql = String(query.mock.calls[0][0]);
    expect(gateSql).toMatch(/FROM deals/i);
    // The defect in one assertion: the gate must not depend on financials.
    expect(gateSql).not.toMatch(/financials/i);
  });

  test('never emits the misleading "Financials not found" message', async () => {
    visibleDeal();
    await expect(financialService.listDealEvents('deal-1', { limit: 50 }))
      .resolves.toBeDefined();
  });
});

describe('authorization is preserved — the gate still gates', () => {
  test('an invisible / non-existent deal 404s', async () => {
    invisibleDeal();
    await expect(financialService.listDealEvents('deal-nope', { limit: 50 }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('an invisible deal never reaches either feed', async () => {
    invisibleDeal();
    await expect(financialService.listDealEvents('deal-nope', { limit: 50 })).rejects.toThrow();
    expect(auditService.listEvents).not.toHaveBeenCalled();
    expect(dealAuditLog.listForDeal).not.toHaveBeenCalled();
  });

  test('the 404 message does not leak whether the deal id exists', async () => {
    invisibleDeal();
    await expect(financialService.listDealEvents('deal-nope', { limit: 50 }))
      .rejects.toMatchObject({ message: 'Deal not found.' });
  });
});

describe('the composer path skips the redundant re-check', () => {
  // dealWorkspace already authorized the deal via getDealById, so it threads
  // the financials row. A NULL row means "no model yet" — not "unauthorized".
  test('a threaded NULL financials row no longer throws (the workspace fix)', async () => {
    const out = await financialService.listDealEvents('deal-1', { limit: 50, financialsRow: null });
    const events = out.events ?? out;
    expect(events.some((e) => e.event_type === 'stage_changed')).toBe(true);
  });

  test('a threaded row issues NO extra visibility query', async () => {
    await financialService.listDealEvents('deal-1', { limit: 50, financialsRow: null });
    const gateCalls = query.mock.calls.filter(([sql]) => /FROM deals d WHERE d\.id/i.test(String(sql)));
    expect(gateCalls).toHaveLength(0);
  });
});
