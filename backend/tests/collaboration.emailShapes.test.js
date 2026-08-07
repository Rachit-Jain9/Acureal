'use strict';

/**
 * The TWO gmail storage shapes, on the two collaboration paths that resolve a
 * colleague BY EMAIL: sharing a deal, and inviting someone to a workspace.
 *
 * Same root cause as the sign-in defect (see auth.emailShapes.test.js): the
 * Google sign-in path stores gmail addresses with dots intact, /register stores
 * them dot-stripped, and both routes ran express-validator's normalizeEmail()
 * before an equality match. A colleague whose account came from Google with a
 * dotted address was therefore invisible to both flows — and both failed
 * SILENTLY, in ways that read as something else entirely:
 *
 *   • Deal share  → a 404 saying they are not a member of this workspace,
 *                   which is exactly what it says when they genuinely are not.
 *   • Org invite  → falls through to "create a pending invitation". But an
 *                   invitation token is only consumable at registration, and
 *                   this person already has an account, so it can never be
 *                   redeemed. The admin sees success; nobody is ever added.
 */

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../src/services/organizationAuditLog.service', () => ({
  recordAudit: jest.fn().mockResolvedValue(undefined),
}));

const { query, transaction } = require('../src/config/database');
const { shareDeal } = require('../src/services/dealShare.service');
const {
  inviteOrganizationMember,
  assertInvitationUsable,
} = require('../src/services/organization.service');

const DEAL_ID = '11111111-1111-1111-1111-111111111111';
const OWNER_ID = '22222222-2222-2222-2222-222222222222';
const ORG_ID = '33333333-3333-3333-3333-333333333333';
const TARGET_ID = '44444444-4444-4444-4444-444444444444';
const INVITER_ID = '55555555-5555-5555-5555-555555555555';

beforeEach(() => jest.clearAllMocks());

// ── Deal share ─────────────────────────────────────────────────────────────

// Recipient rows keyed by the exact address the service asks for, so the fake
// only answers a query that names a shape actually present in the table.
const runShare = (membersByEmail) => {
  const lookups = [];
  transaction.mockImplementation(async (cb) => cb({
    query: jest.fn((sql, params) => {
      if (/FROM deals/i.test(sql)) {
        return Promise.resolve({
          rows: [{ id: DEAL_ID, created_by: OWNER_ID, name: 'Whitefield', organization_id: ORG_ID }],
        });
      }
      if (/FROM users/i.test(sql)) {
        lookups.push(params[0]);
        const hit = membersByEmail[params[0]];
        return Promise.resolve({ rows: hit ? [hit] : [] });
      }
      return Promise.resolve({ rows: [{ id: 'share-1', deal_id: DEAL_ID }] });
    }),
  }));
  return lookups;
};

describe('shareDeal resolves a colleague in either stored shape', () => {
  test('finds a colleague stored DOTTED (their account came from Google sign-in)', async () => {
    const lookups = runShare({
      'first.last@gmail.com': { id: TARGET_ID, email: 'first.last@gmail.com', name: 'Colleague' },
    });

    const share = await shareDeal(DEAL_ID, OWNER_ID, 'first.last@gmail.com', 'viewer');

    expect(share.shared_with_email).toBe('first.last@gmail.com');
    expect(lookups[0]).toBe('first.last@gmail.com'); // literal shape tried first
  });

  test('finds a colleague stored DOT-STRIPPED when the dotted address is typed', async () => {
    const lookups = runShare({
      'firstlast@gmail.com': { id: TARGET_ID, email: 'firstlast@gmail.com', name: 'Colleague' },
    });

    const share = await shareDeal(DEAL_ID, OWNER_ID, 'First.Last@gmail.com', 'viewer');

    expect(share.shared_with_email).toBe('firstlast@gmail.com');
    expect(lookups).toEqual(['first.last@gmail.com', 'firstlast@gmail.com']);
  });

  test('a non-gmail address still costs exactly one lookup', async () => {
    const lookups = runShare({
      'asha@acme-realty.in': { id: TARGET_ID, email: 'asha@acme-realty.in', name: 'Asha' },
    });

    await shareDeal(DEAL_ID, OWNER_ID, 'Asha@Acme-Realty.in', 'viewer');

    expect(lookups).toEqual(['asha@acme-realty.in']);
  });

  test('the workspace boundary is unchanged — a non-member is still refused', async () => {
    // Both shapes are asked for and neither is a member of THIS deal's org.
    // Widening which typed addresses resolve must never widen who is eligible.
    const lookups = runShare({});

    await expect(
      shareDeal(DEAL_ID, OWNER_ID, 'first.last@gmail.com', 'viewer')
    ).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringMatching(/no active member of this workspace/i),
    });
    expect(lookups).toEqual(['first.last@gmail.com', 'firstlast@gmail.com']);
  });
});

// ── Organisation invitation ────────────────────────────────────────────────

const runInvite = (usersByEmail) => {
  const lookups = [];
  query.mockImplementation(async (sql, params = []) => {
    if (/SELECT id, name, email FROM users/i.test(sql)) {
      lookups.push(params[0]);
      const hit = usersByEmail[params[0]];
      return { rows: hit ? [hit] : [] };
    }
    if (/INSERT INTO organization_members/i.test(sql)) {
      return { rows: [{ organization_id: ORG_ID, user_id: TARGET_ID, role: 'editor', is_active: true }] };
    }
    if (/INSERT INTO organization_invitations/i.test(sql)) {
      return { rows: [{ id: 'inv-1', organization_id: ORG_ID, email: params[1], role: 'editor' }] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  return lookups;
};

// ── The org-invitation gap, pinned deliberately ────────────────────────────
//
// The invitation flow has the SAME defect and is NOT fixed in this change. Its
// email is not only a lookup key, it is the storage key of the
// organization_invitations row, and that shape is pinned by SQL: on the live
// non-bypass role, public.auth_provision_signup redeems an invitation with a
// raw `lower(v_inv.email) <> lower(p_email)` comparison against the address
// /register normalises (database/migrations/20260802_rls_flip_hardening.sql).
//
// These tests pin the CURRENT behaviour on purpose, so that a future half-fix
// — relaxing the JS side without the migration — fails here instead of turning
// a readable 409 into an opaque P0001 500 in production.

describe('org invitation still matches a single shape (known gap, migration-gated)', () => {
  test('a Google-created colleague is missed, and gets an invitation that can never be redeemed', async () => {
    const lookups = runInvite({
      'first.last@gmail.com': { id: TARGET_ID, name: 'Colleague', email: 'first.last@gmail.com' },
    });

    // The route's normalizeEmail() has already folded the admin's input by the
    // time the service sees it, so this is what actually arrives.
    const result = await inviteOrganizationMember({
      organizationId: ORG_ID,
      email: 'firstlast@gmail.com',
      role: 'editor',
      invitedBy: INVITER_ID,
    });

    expect(lookups).toEqual(['firstlast@gmail.com']); // one shape, not two
    expect(result.kind).toBe('invited'); // the dead-end invitation
  });

  test('assertInvitationUsable compares raw — relaxing it alone would be worse than the gap', () => {
    const invitation = {
      email: 'firstlast@gmail.com',
      accepted_at: null,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };

    // Google hands us claims.email with dots intact. Today: a readable 409.
    // Make this pass in JS only and auth_provision_signup raises P0001 instead,
    // which errorHandler does not map — a 500 on an unauthenticated route.
    expect(() => assertInvitationUsable(invitation, 'first.last@gmail.com'))
      .toThrow(/does not match this registration/i);

    expect(() => assertInvitationUsable(invitation, 'firstlast@gmail.com')).not.toThrow();
  });
});
