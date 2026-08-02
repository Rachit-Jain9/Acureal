'use strict';

/**
 * Deal sharing is locked to a single workspace.
 *
 * The defect: `shareDeal` resolved the recipient with
 * `SELECT id FROM users WHERE LOWER(email) = LOWER($1)` — no organisation
 * comparison anywhere in the service. Any deal owner could hand a complete deal
 * (documents, financial model, diligence, risks, full activity history) to any
 * account on the platform, including one inside another customer's workspace,
 * and nine `*_shared_read` RLS policies made the database honour it. There was
 * no audit surface for it and no way for the receiving workspace's owner to
 * know. `deal_shares` held zero rows in production, so nothing leaked — but the
 * path was one API call wide.
 *
 * These tests pin the recipient lookup to the deal's organisation. The RLS half
 * lives in `database/migrations/20260806_deal_shares_same_workspace.sql`.
 */

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

const { transaction } = require('../src/config/database');
const { shareDeal } = require('../src/services/dealShare.service');

const DEAL_ID = '11111111-1111-1111-1111-111111111111';
const OWNER_ID = '22222222-2222-2222-2222-222222222222';
const ORG_ID = '33333333-3333-3333-3333-333333333333';
const TARGET_ID = '44444444-4444-4444-4444-444444444444';

// Drives the service's three sequential queries: deal lookup, recipient
// lookup, share upsert. `recipientRows` empty models "not a member here".
const runWithClient = ({ dealRows, recipientRows, upsertRows }) => {
  const calls = [];
  transaction.mockImplementation(async (cb) => cb({
    query: jest.fn((sql, params) => {
      calls.push({ sql, params });
      if (/FROM deals/i.test(sql)) return Promise.resolve({ rows: dealRows });
      if (/FROM users/i.test(sql)) return Promise.resolve({ rows: recipientRows });
      return Promise.resolve({ rows: upsertRows || [{ id: 'share-1', deal_id: DEAL_ID }] });
    }),
  }));
  return calls;
};

const DEAL_ROW = [{ id: DEAL_ID, created_by: OWNER_ID, name: 'Whitefield', organization_id: ORG_ID }];
const MEMBER_ROW = [{ id: TARGET_ID, email: 'mate@acme.test', name: 'Mate' }];

beforeEach(() => jest.clearAllMocks());

describe('shareDeal resolves the recipient inside the deal workspace', () => {
  test('scopes the lookup by joining organization_members on the deal org', async () => {
    const calls = runWithClient({ dealRows: DEAL_ROW, recipientRows: MEMBER_ROW });

    await shareDeal(DEAL_ID, OWNER_ID, 'mate@acme.test', 'viewer');

    const lookup = calls.find((c) => /FROM users/i.test(c.sql));
    expect(lookup.sql).toMatch(/JOIN\s+organization_members/i);
    expect(lookup.sql).toMatch(/om\.organization_id = \$2/);
    // The DEAL's organisation is the scope — not the caller's active org, which
    // is a value the request could otherwise influence.
    expect(lookup.params).toEqual(['mate@acme.test', ORG_ID]);
  });

  test('reads organization_id off the deal so the scope cannot be spoofed', async () => {
    const calls = runWithClient({ dealRows: DEAL_ROW, recipientRows: MEMBER_ROW });
    await shareDeal(DEAL_ID, OWNER_ID, 'mate@acme.test');
    expect(calls[0].sql).toMatch(/SELECT id, created_by, name, organization_id FROM deals/i);
  });

  test('refuses a recipient who is not a member of that workspace', async () => {
    // The user row exists on the platform; the membership join yields nothing.
    runWithClient({ dealRows: DEAL_ROW, recipientRows: [] });

    await expect(shareDeal(DEAL_ID, OWNER_ID, 'outsider@other.test'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('the refusal does not reveal whether the account exists elsewhere', async () => {
    runWithClient({ dealRows: DEAL_ROW, recipientRows: [] });

    // Distinguishing "no such account" from "account is in another workspace"
    // would turn this endpoint into a membership oracle for other customers.
    await expect(shareDeal(DEAL_ID, OWNER_ID, 'outsider@other.test'))
      .rejects.toThrow(/No active member of this workspace/);
    await expect(shareDeal(DEAL_ID, OWNER_ID, 'nobody@nowhere.test'))
      .rejects.toThrow(/No active member of this workspace/);
  });

  test('still refuses when the caller does not own the deal', async () => {
    runWithClient({ dealRows: [], recipientRows: MEMBER_ROW });
    await expect(shareDeal(DEAL_ID, OWNER_ID, 'mate@acme.test'))
      .rejects.toThrow(/not the owner/);
  });

  test('still refuses self-share and invalid permissions', async () => {
    runWithClient({
      dealRows: DEAL_ROW,
      recipientRows: [{ id: OWNER_ID, email: 'me@acme.test', name: 'Me' }],
    });
    await expect(shareDeal(DEAL_ID, OWNER_ID, 'me@acme.test')).rejects.toThrow(/share a deal with yourself/);

    await expect(shareDeal(DEAL_ID, OWNER_ID, 'mate@acme.test', 'owner'))
      .rejects.toThrow(/viewer or editor/);
  });

  test('never resolves a recipient with an unscoped email lookup', async () => {
    const calls = runWithClient({ dealRows: DEAL_ROW, recipientRows: MEMBER_ROW });
    await shareDeal(DEAL_ID, OWNER_ID, 'mate@acme.test');

    // The regression, pinned structurally: no query may select a user by email
    // without also constraining the organisation.
    for (const call of calls) {
      if (/FROM users/i.test(call.sql) && /LOWER\(.*email.*\)/i.test(call.sql)) {
        expect(call.sql).toMatch(/organization_members/i);
      }
    }
  });
});
