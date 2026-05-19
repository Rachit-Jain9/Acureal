'use strict';

/**
 * Tests for aiAugmentEntitlement.service.js (PR-NX69).
 *
 * Mocks the database query so tests run synchronously. Asserts:
 *   - Admin / owner roles → allowed: true, unlimited: true (no DB read).
 *   - Under-limit users → allowed: true, remaining count returned.
 *   - At-limit users → allowed: false, reason: 'quota_exceeded'.
 *   - Missing userId → allowed: false, reason: 'unauthenticated'.
 *   - User-not-found → allowed: false, reason: 'user_not_found'.
 *   - DB error → allowed: false, reason: 'check_failed'.
 *   - recordUsage:
 *     - Admin → not recorded (admin_unlimited).
 *     - Regular user → increments counter, bumps timestamp.
 *     - DB error → recorded: false, error surfaced.
 *   - Defensive re-check of role from DB (handles stale JWT).
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/lib/logger', () => ({
  child: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));

const { query } = require('../src/config/database');
const entitlement = require('../src/services/aiAugmentEntitlement.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('aiAugmentEntitlement.checkEntitlement', () => {
  test('admin role short-circuits to unlimited without a DB read', async () => {
    const out = await entitlement.checkEntitlement({
      userId: 'user-1',
      userRole: 'admin',
    });
    expect(out.allowed).toBe(true);
    expect(out.unlimited).toBe(true);
    expect(out.reason).toBe('admin');
    expect(query).not.toHaveBeenCalled();
  });

  test('owner role is treated like admin (unlimited)', async () => {
    const out = await entitlement.checkEntitlement({
      userId: 'user-1',
      userRole: 'owner',
    });
    expect(out.allowed).toBe(true);
    expect(out.unlimited).toBe(true);
    expect(out.reason).toBe('admin');
    expect(query).not.toHaveBeenCalled();
  });

  test('case-insensitive role matching ("ADMIN", "Admin")', async () => {
    const upper = await entitlement.checkEntitlement({ userId: 'u', userRole: 'ADMIN' });
    const mixed = await entitlement.checkEntitlement({ userId: 'u', userRole: 'Admin' });
    expect(upper.allowed).toBe(true);
    expect(upper.unlimited).toBe(true);
    expect(mixed.allowed).toBe(true);
  });

  test('returns unauthenticated when userId is missing and role is not admin', async () => {
    const out = await entitlement.checkEntitlement({ userRole: 'analyst' });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('unauthenticated');
    expect(query).not.toHaveBeenCalled();
  });

  test('non-admin user under the BETA limit is allowed with remaining count', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'user-1', role: 'analyst', ai_augment_reports_used: 0 }],
    });
    const out = await entitlement.checkEntitlement({
      userId: 'user-1',
      userRole: 'analyst',
    });
    expect(out.allowed).toBe(true);
    expect(out.unlimited).toBe(false);
    expect(out.reason).toBe('under_limit');
    expect(out.limit).toBe(1); // BETA_FREE_LIMIT
    expect(out.used).toBe(0);
    expect(out.remaining).toBe(1);
  });

  test('non-admin user AT the BETA limit is denied with quota_exceeded', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'user-1', role: 'analyst', ai_augment_reports_used: 1 }],
    });
    const out = await entitlement.checkEntitlement({
      userId: 'user-1',
      userRole: 'analyst',
    });
    expect(out.allowed).toBe(false);
    expect(out.unlimited).toBe(false);
    expect(out.reason).toBe('quota_exceeded');
    expect(out.limit).toBe(1);
    expect(out.used).toBe(1);
  });

  test('non-admin user OVER the BETA limit is also quota_exceeded', async () => {
    // Edge case: legacy data where counter somehow exceeded the limit.
    query.mockResolvedValueOnce({
      rows: [{ id: 'user-1', role: 'analyst', ai_augment_reports_used: 5 }],
    });
    const out = await entitlement.checkEntitlement({ userId: 'user-1', userRole: 'analyst' });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('quota_exceeded');
  });

  test('user-not-found returns deny envelope', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const out = await entitlement.checkEntitlement({
      userId: 'missing-user',
      userRole: 'analyst',
    });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('user_not_found');
  });

  test('defensive: DB-role admin overrides stale-JWT non-admin role', async () => {
    // User's JWT says 'analyst' but their actual DB row is 'admin' (promoted
    // between JWT issuance and this request). Must be treated as admin.
    query.mockResolvedValueOnce({
      rows: [{ id: 'user-1', role: 'admin', ai_augment_reports_used: 10 }],
    });
    const out = await entitlement.checkEntitlement({
      userId: 'user-1',
      userRole: 'analyst',
    });
    expect(out.allowed).toBe(true);
    expect(out.unlimited).toBe(true);
    expect(out.reason).toBe('admin');
  });

  test('DB error → allowed:false, reason:check_failed (never throws)', async () => {
    query.mockRejectedValueOnce(new Error('connection refused'));
    const out = await entitlement.checkEntitlement({
      userId: 'user-1',
      userRole: 'analyst',
    });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('check_failed');
  });
});

describe('aiAugmentEntitlement.recordUsage', () => {
  test('admin → not recorded (admin_unlimited)', async () => {
    const out = await entitlement.recordUsage({
      userId: 'user-1',
      userRole: 'admin',
    });
    expect(out.recorded).toBe(false);
    expect(out.reason).toBe('admin_unlimited');
    expect(query).not.toHaveBeenCalled();
  });

  test('regular user → increments counter, bumps timestamp', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        ai_augment_reports_used: 1,
        ai_augment_last_used_at: new Date('2026-05-19T08:00:00Z'),
      }],
    });
    const out = await entitlement.recordUsage({
      userId: 'user-1',
      userRole: 'analyst',
    });
    expect(out.recorded).toBe(true);
    expect(out.newCount).toBe(1);
    expect(query).toHaveBeenCalledTimes(1);
    // SQL spans multiple lines; use [\s\S] to match across newlines.
    expect(query.mock.calls[0][0]).toMatch(/UPDATE users[\s\S]*ai_augment_reports_used[\s\S]*\+ 1/i);
  });

  test('missing userId → not recorded (no_user)', async () => {
    const out = await entitlement.recordUsage({ userRole: 'analyst' });
    expect(out.recorded).toBe(false);
    expect(out.reason).toBe('no_user');
    expect(query).not.toHaveBeenCalled();
  });

  test('user-not-found after update → recorded:false', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const out = await entitlement.recordUsage({
      userId: 'gone-user',
      userRole: 'analyst',
    });
    expect(out.recorded).toBe(false);
    expect(out.reason).toBe('user_not_found');
  });

  test('DB error → recorded:false, error surfaced (never throws)', async () => {
    query.mockRejectedValueOnce(new Error('FK violation'));
    const out = await entitlement.recordUsage({
      userId: 'user-1',
      userRole: 'analyst',
    });
    expect(out.recorded).toBe(false);
    expect(out.reason).toBe('write_failed');
    expect(out.error).toMatch(/FK violation/);
  });
});

describe('aiAugmentEntitlement — public constants', () => {
  test('BETA_FREE_LIMIT exported as 1 (the BETA-stage rule)', () => {
    expect(entitlement.BETA_FREE_LIMIT).toBe(1);
  });

  test('ADMIN_ROLES is a Set including admin + owner', () => {
    expect(entitlement.ADMIN_ROLES).toBeInstanceOf(Set);
    expect(entitlement.ADMIN_ROLES.has('admin')).toBe(true);
    expect(entitlement.ADMIN_ROLES.has('owner')).toBe(true);
  });
});
