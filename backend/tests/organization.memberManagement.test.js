'use strict';

jest.mock('../src/config/database', () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock('../src/services/organizationAuditLog.service', () => ({ recordAudit: jest.fn() }));

const { query, transaction } = require('../src/config/database');
const orgService = require('../src/services/organization.service');

const ORG = 'org-1';
const ownerActor = { id: 'owner-1', role: 'owner' };
const adminActor = { id: 'admin-1', role: 'admin' };

const runTxnWith = (client) => transaction.mockImplementation(async (fn) => fn(client));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('updateOrganizationMemberRole', () => {
  test('rejects assigning a role above your own (403)', async () => {
    await expect(
      orgService.updateOrganizationMemberRole({
        organizationId: ORG, targetUserId: 'u2', nextRole: 'owner', actor: adminActor,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(transaction).not.toHaveBeenCalled();
  });

  test('rejects an unknown role (400)', async () => {
    await expect(
      orgService.updateOrganizationMemberRole({
        organizationId: ORG, targetUserId: 'u2', nextRole: 'wizard', actor: ownerActor,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('404 when the target is not a member', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
    runTxnWith(client);
    await expect(
      orgService.updateOrganizationMemberRole({
        organizationId: ORG, targetUserId: 'ghost', nextRole: 'editor', actor: ownerActor,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('admin cannot change the role of an owner who outranks them (403)', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({ rows: [{ user_id: 'u2', role: 'owner', is_active: true }] }),
    };
    runTxnWith(client);
    await expect(
      orgService.updateOrganizationMemberRole({
        organizationId: ORG, targetUserId: 'u2', nextRole: 'editor', actor: adminActor,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('blocks demoting the last active owner (409)', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ user_id: 'u2', role: 'owner', is_active: true }] })
        .mockResolvedValueOnce({ rows: [{ n: 1 }] }),
    };
    runTxnWith(client);
    await expect(
      orgService.updateOrganizationMemberRole({
        organizationId: ORG, targetUserId: 'u2', nextRole: 'admin', actor: ownerActor,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test('promotes a member and returns the normalized role', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ user_id: 'u2', role: 'viewer', is_active: true }] })
        .mockResolvedValueOnce({
          rows: [{ organization_id: ORG, user_id: 'u2', role: 'editor', is_active: true, joined_at: 'now' }],
        }),
    };
    runTxnWith(client);
    const member = await orgService.updateOrganizationMemberRole({
      organizationId: ORG, targetUserId: 'u2', nextRole: 'editor', actor: ownerActor,
    });
    expect(member.role).toBe('editor');
  });

  test('demotes an owner when another owner remains', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ user_id: 'u2', role: 'owner', is_active: true }] })
        .mockResolvedValueOnce({ rows: [{ n: 2 }] })
        .mockResolvedValueOnce({
          rows: [{ organization_id: ORG, user_id: 'u2', role: 'admin', is_active: true, joined_at: 'now' }],
        }),
    };
    runTxnWith(client);
    const member = await orgService.updateOrganizationMemberRole({
      organizationId: ORG, targetUserId: 'u2', nextRole: 'admin', actor: ownerActor,
    });
    expect(member.role).toBe('admin');
  });
});

describe('removeOrganizationMember', () => {
  test('rejects removing your own access (400)', async () => {
    await expect(
      orgService.removeOrganizationMember({
        organizationId: ORG, targetUserId: 'admin-1', actor: adminActor,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });

  test('404 when the target is not a member', async () => {
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
    runTxnWith(client);
    await expect(
      orgService.removeOrganizationMember({
        organizationId: ORG, targetUserId: 'ghost', actor: ownerActor,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('admin cannot remove an owner who outranks them (403)', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({ rows: [{ user_id: 'u2', role: 'owner', is_active: true }] }),
    };
    runTxnWith(client);
    await expect(
      orgService.removeOrganizationMember({
        organizationId: ORG, targetUserId: 'u2', actor: adminActor,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('blocks removing the last active owner (409)', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ user_id: 'u2', role: 'owner', is_active: true }] })
        .mockResolvedValueOnce({ rows: [{ n: 1 }] }),
    };
    runTxnWith(client);
    await expect(
      orgService.removeOrganizationMember({
        organizationId: ORG, targetUserId: 'u2', actor: ownerActor,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test('removes a non-owner member and returns removed:true', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ user_id: 'u2', role: 'editor', is_active: true }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };
    runTxnWith(client);
    const result = await orgService.removeOrganizationMember({
      organizationId: ORG, targetUserId: 'u2', actor: ownerActor,
    });
    expect(result).toEqual({ removed: true, user_id: 'u2' });
    // A non-owner skips the owner-count query: SELECT FOR UPDATE then DELETE.
    expect(client.query.mock.calls[1][0]).toMatch(/DELETE FROM organization_members/i);
  });

  test('removes an owner when another active owner remains', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ user_id: 'u2', role: 'owner', is_active: true }] })
        .mockResolvedValueOnce({ rows: [{ n: 2 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };
    runTxnWith(client);
    const result = await orgService.removeOrganizationMember({
      organizationId: ORG, targetUserId: 'u2', actor: ownerActor,
    });
    expect(result).toEqual({ removed: true, user_id: 'u2' });
  });
});

describe('inviteOrganizationMember', () => {
  test('rejects assigning owner (400)', async () => {
    await expect(
      orgService.inviteOrganizationMember({
        organizationId: ORG, email: 'x@acme.in', role: 'owner', invitedBy: 'admin-1',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('adds an EXISTING user directly as an active member', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'u-existing', name: 'Asha', email: 'asha@acme.in' }] })
      .mockResolvedValueOnce({ rows: [{ organization_id: ORG, user_id: 'u-existing', role: 'editor', is_active: true }] });

    const res = await orgService.inviteOrganizationMember({
      organizationId: ORG, email: 'Asha@Acme.in', role: 'editor', invitedBy: 'admin-1',
    });

    expect(res.kind).toBe('added');
    expect(res.member).toMatchObject({ user_id: 'u-existing', role: 'editor', is_active: true, email: 'asha@acme.in' });
    expect(query.mock.calls[0][1]).toEqual(['asha@acme.in']); // lookup normalizes the email
    expect(query.mock.calls[1][0]).toMatch(/INSERT INTO organization_members/i);
    expect(query.mock.calls[1][1]).toEqual([ORG, 'u-existing', 'editor', 'admin-1']);
  });

  test('creates an invitation for a NEW (unknown) email', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1', organization_id: ORG, email: 'new@acme.in', role: 'viewer', token: 't', expires_at: 'soon', created_at: 'now' }] });

    const res = await orgService.inviteOrganizationMember({
      organizationId: ORG, email: 'new@acme.in', role: 'viewer', invitedBy: 'admin-1',
    });

    expect(res.kind).toBe('invited');
    expect(res.invitation).toMatchObject({ id: 'inv-1', email: 'new@acme.in' });
    expect(query.mock.calls[1][0]).toMatch(/INSERT INTO organization_invitations/i);
  });
});

describe('approveJoinRequest / rejectJoinRequest', () => {
  test('approve: self-approval blocked (400)', async () => {
    await expect(
      orgService.approveJoinRequest({ organizationId: ORG, targetUserId: 'admin-1', actor: adminActor }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('approve: 404 when no pending row', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(
      orgService.approveJoinRequest({ organizationId: ORG, targetUserId: 'u2', actor: adminActor }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('approve: activates a pending member', async () => {
    query.mockResolvedValueOnce({
      rows: [{ organization_id: ORG, user_id: 'u2', role: 'editor', is_active: true }],
    });
    const member = await orgService.approveJoinRequest({
      organizationId: ORG, targetUserId: 'u2', actor: adminActor,
    });
    expect(member.is_active).toBe(true);
    expect(member.role).toBe('editor');
    expect(query.mock.calls[0][0]).toMatch(/SET is_active = TRUE/i);
  });

  test('reject: removes a pending member', async () => {
    query.mockResolvedValueOnce({ rows: [{ organization_id: ORG, user_id: 'u2', role: 'editor' }] });
    const result = await orgService.rejectJoinRequest({
      organizationId: ORG, targetUserId: 'u2', actor: adminActor,
    });
    expect(result).toEqual({ rejected: true });
    expect(query.mock.calls[0][0]).toMatch(/DELETE FROM organization_members/i);
  });
});

describe('joinByVerifiedDomain', () => {
  // The domain lookup runs on the module `query` (a separate connection so a
  // missing table can't poison the signup transaction); the membership writes
  // run on the transaction `client`.
  const fakeClient = () => ({ query: jest.fn() });

  test('returns null for a public email provider (no DB hit)', async () => {
    const client = fakeClient();
    const result = await orgService.joinByVerifiedDomain(client, { userId: 'u1', email: 'a@gmail.com' });
    expect(result).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });

  test('returns null when no verified domain matches', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const client = fakeClient();
    const result = await orgService.joinByVerifiedDomain(client, { userId: 'u1', email: 'a@acme.in' });
    expect(result).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });

  test('deploy-before-migrate: a missing organization_domains table → null, no writes', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('no table'), { code: '42P01' }));
    const client = fakeClient();
    const result = await orgService.joinByVerifiedDomain(client, { userId: 'u1', email: 'a@acme.in' });
    expect(result).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });

  test('active auto-join: inserts an active member, sets default org, returns org id', async () => {
    query.mockResolvedValueOnce({ rows: [{ organization_id: 'org-acme', default_role: 'editor', require_admin_approval: false }] });
    const client = fakeClient();
    client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await orgService.joinByVerifiedDomain(client, { userId: 'u1', email: 'a@acme.in' });

    expect(result).toBe('org-acme');
    expect(client.query.mock.calls[0][0]).toMatch(/INSERT INTO organization_members/i);
    expect(client.query.mock.calls[0][1]).toEqual(['org-acme', 'u1', 'editor', true]);
    expect(client.query.mock.calls[1][0]).toMatch(/UPDATE users SET default_organization_id/i);
  });

  test('approval-required: inserts a PENDING member and returns null', async () => {
    query.mockResolvedValueOnce({ rows: [{ organization_id: 'org-acme', default_role: 'editor', require_admin_approval: true }] });
    const client = fakeClient();
    client.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await orgService.joinByVerifiedDomain(client, { userId: 'u1', email: 'a@acme.in' });

    expect(result).toBeNull();
    expect(client.query.mock.calls[0][1]).toEqual(['org-acme', 'u1', 'editor', false]);
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  test('prefers the Google hosted-domain claim over the email domain', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const client = fakeClient();
    await orgService.joinByVerifiedDomain(client, {
      userId: 'u1',
      email: 'a@personal-alias.com',
      hostedDomain: 'acme.in',
    });
    expect(query.mock.calls[0][1]).toEqual(['acme.in']);
  });
});
