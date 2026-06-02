'use strict';

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/organizationAuditLog.service', () => ({ recordAudit: jest.fn() }));
jest.mock('dns', () => ({ promises: { resolveTxt: jest.fn() } }));

const { query } = require('../src/config/database');
const dns = require('dns');
const domainService = require('../src/services/organizationDomain.service');

const ORG = 'org-1';
const ACTOR = { id: 'user-1' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('addDomainClaim', () => {
  test('rejects a public email provider (422)', async () => {
    await expect(
      domainService.addDomainClaim({ organizationId: ORG, domain: 'gmail.com', actor: ACTOR }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(query).not.toHaveBeenCalled();
  });

  test('rejects an unparseable domain (400)', async () => {
    await expect(
      domainService.addDomainClaim({ organizationId: ORG, domain: 'not-a-domain', actor: ACTOR }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('inserts a normalized, unverified claim and returns DNS instructions', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'dom-1',
        domain: 'acme.in',
        verified: false,
        default_role: 'editor',
        require_admin_approval: false,
        verification_method: 'dns_txt',
        verification_token: 'tok-abc',
        verified_at: null,
        created_at: 'now',
      }],
    });

    const result = await domainService.addDomainClaim({
      organizationId: ORG,
      domain: 'ACME.in',
      actor: ACTOR,
    });

    expect(query.mock.calls[0][1]).toEqual([ORG, 'acme.in', 'user-1']);
    expect(result.verified).toBe(false);
    expect(result.verification).toEqual({
      host: '_redip-verify.acme.in',
      type: 'TXT',
      value: 'redip-verify=tok-abc',
    });
  });

  test('maps a duplicate-domain unique violation to 409', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(
      domainService.addDomainClaim({ organizationId: ORG, domain: 'acme.in', actor: ACTOR }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('verifyDomain', () => {
  const claimRow = {
    id: 'dom-1',
    domain: 'acme.in',
    verified: false,
    verification_token: 'tok-abc',
    default_role: 'editor',
    require_admin_approval: false,
    verification_method: 'dns_txt',
    verified_at: null,
    created_at: 'now',
  };

  test('404 when the claim is not in the org', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(
      domainService.verifyDomain({ organizationId: ORG, domainId: 'dom-x', actor: ACTOR }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('422 (with guidance) when no matching TXT record exists yet', async () => {
    query.mockResolvedValueOnce({ rows: [claimRow] });
    dns.promises.resolveTxt.mockRejectedValueOnce(
      Object.assign(new Error('not found'), { code: 'ENOTFOUND' }),
    );
    await expect(
      domainService.verifyDomain({ organizationId: ORG, domainId: 'dom-1', actor: ACTOR }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(dns.promises.resolveTxt).toHaveBeenCalledWith('_redip-verify.acme.in');
  });

  test('422 when a TXT record exists but its value mismatches', async () => {
    query.mockResolvedValueOnce({ rows: [claimRow] });
    dns.promises.resolveTxt.mockResolvedValueOnce([['redip-verify=WRONG']]);
    await expect(
      domainService.verifyDomain({ organizationId: ORG, domainId: 'dom-1', actor: ACTOR }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  test('verifies when a matching TXT record is found (multi-chunk joined)', async () => {
    query
      .mockResolvedValueOnce({ rows: [claimRow] })
      .mockResolvedValueOnce({ rows: [{ ...claimRow, verified: true, verified_at: 'now' }] });
    dns.promises.resolveTxt.mockResolvedValueOnce([['redip-verify=', 'tok-abc']]);

    const result = await domainService.verifyDomain({
      organizationId: ORG,
      domainId: 'dom-1',
      actor: ACTOR,
    });

    expect(result.verified).toBe(true);
    expect(query.mock.calls[1][0]).toMatch(/SET verified = TRUE/i);
  });

  test('is idempotent — already-verified returns without a DNS lookup', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...claimRow, verified: true }] });
    const result = await domainService.verifyDomain({
      organizationId: ORG,
      domainId: 'dom-1',
      actor: ACTOR,
    });
    expect(result.verified).toBe(true);
    expect(dns.promises.resolveTxt).not.toHaveBeenCalled();
  });
});

describe('removeDomainClaim', () => {
  test('404 when nothing was deleted', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(
      domainService.removeDomainClaim({ organizationId: ORG, domainId: 'dom-x', actor: ACTOR }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('removes a claim', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'dom-1', domain: 'acme.in' }] });
    const result = await domainService.removeDomainClaim({
      organizationId: ORG,
      domainId: 'dom-1',
      actor: ACTOR,
    });
    expect(result).toEqual({ removed: true, domain: 'acme.in' });
  });
});

describe('setDomainPolicy', () => {
  test('rejects owner as a default role (400)', async () => {
    await expect(
      domainService.setDomainPolicy({
        organizationId: ORG, domainId: 'dom-1', defaultRole: 'owner', actor: ACTOR,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects an empty patch (400)', async () => {
    await expect(
      domainService.setDomainPolicy({ organizationId: ORG, domainId: 'dom-1', actor: ACTOR }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('updates default_role + approval and returns the new policy', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'dom-1',
        domain: 'acme.in',
        verified: true,
        default_role: 'viewer',
        require_admin_approval: true,
        verification_method: 'dns_txt',
        verification_token: 't',
        verified_at: 'now',
        created_at: 'now',
      }],
    });

    const result = await domainService.setDomainPolicy({
      organizationId: ORG,
      domainId: 'dom-1',
      defaultRole: 'viewer',
      requireAdminApproval: true,
      actor: ACTOR,
    });

    expect(result.default_role).toBe('viewer');
    expect(result.require_admin_approval).toBe(true);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/default_role = \$3::organization_role/);
    expect(sql).toMatch(/require_admin_approval = \$4/);
  });
});
