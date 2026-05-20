'use strict';

/**
 * Unit tests for dsar.service.js — the DPDP §11 Data Subject Access Request
 * service behind the Privacy Centre: the page overview, the full personal-data
 * export, and the identity check that gates the export.
 */

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/consent.service', () => ({
  getConsentState: jest.fn(),
  getConsentHistory: jest.fn(),
}));
jest.mock('../src/services/legal.service', () => ({
  getUserAcceptances: jest.fn(),
}));
jest.mock('bcryptjs', () => ({ compare: jest.fn() }));

const { query } = require('../src/config/database');
const consentService = require('../src/services/consent.service');
const legalService = require('../src/services/legal.service');
const bcrypt = require('bcryptjs');
const dsarService = require('../src/services/dsar.service');

const USER_ID = '11111111-1111-1111-1111-111111111111';

const PROFILE_ROW = {
  id: USER_ID,
  email: 'analyst@example.com',
  name: 'Test Analyst',
  phone: '9876543210',
  role: 'analyst',
  is_active: true,
  password_set: true,
  oauth_provider: null,
  email_verified_at: '2026-05-01T00:00:00.000Z',
  terms_accepted_at: '2026-05-01T00:00:00.000Z',
  privacy_accepted_at: '2026-05-01T00:00:00.000Z',
  last_login_at: '2026-05-20T00:00:00.000Z',
  account_closed_at: null,
  erased_at: null,
  created_at: '2026-04-01T00:00:00.000Z',
  updated_at: '2026-05-20T00:00:00.000Z',
};

// Configure the query mock by inspecting the SQL of each call — robust to the
// order Promise.all happens to start the reads in.
const wireQuery = ({ profile = PROFILE_ROW, identity, orgs = [], sessions = [], orgError } = {}) => {
  query.mockImplementation((sql) => {
    if (/password_hash, password_set/.test(sql)) {
      return Promise.resolve({ rows: identity === undefined ? [] : [identity] });
    }
    if (/FROM public\.users/.test(sql)) {
      return Promise.resolve({ rows: profile ? [profile] : [] });
    }
    if (/organization_members/.test(sql)) {
      if (orgError) return Promise.reject(orgError);
      return Promise.resolve({ rows: orgs });
    }
    if (/refresh_token_grants/.test(sql)) {
      return Promise.resolve({ rows: sessions });
    }
    return Promise.resolve({ rows: [] });
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  consentService.getConsentState.mockResolvedValue({
    state: {
      product_improvement: false,
      anonymized_benchmarking: true,
      marketing: false,
      ai_processing: false,
    },
    available: true,
  });
  consentService.getConsentHistory.mockResolvedValue([
    {
      purpose: 'anonymized_benchmarking',
      granted: true,
      created_at: '2026-05-10T00:00:00.000Z',
      policy_version: 'v2',
      source: 'privacy_centre',
    },
  ]);
  legalService.getUserAcceptances.mockResolvedValue([
    {
      kind: 'terms_of_service',
      version: 'v1',
      accepted_at: '2026-05-01T00:00:00.000Z',
      effective_at: '2026-04-01T00:00:00.000Z',
      ip_address: '203.0.113.1',
    },
  ]);
});

describe('summarizeUserAgent', () => {
  test('summarises a Chrome-on-Windows User-Agent', () => {
    expect(
      dsarService.summarizeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      )
    ).toBe('Chrome on Windows');
  });

  test('falls back gracefully for a missing User-Agent', () => {
    expect(dsarService.summarizeUserAgent(null)).toBe('Unknown device');
  });
});

describe('getPrivacyOverview', () => {
  test('assembles profile, organisations, legal acceptances and sessions', async () => {
    wireQuery({
      orgs: [
        {
          organization_id: 'org-1',
          organization_name: 'Acme Capital',
          organization_slug: 'acme',
          role: 'owner',
          is_active: true,
          joined_at: '2026-04-01T00:00:00.000Z',
        },
      ],
      sessions: [
        {
          created_at: '2026-05-20T00:00:00.000Z',
          expires_at: '2026-06-19T00:00:00.000Z',
          ip_address: '203.0.113.9',
          user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120 Safari/537.36',
        },
      ],
    });
    const overview = await dsarService.getPrivacyOverview(USER_ID);
    expect(overview.profile.email).toBe('analyst@example.com');
    expect(overview.profile.sign_in_method).toBe('password');
    expect(overview.profile.password_set).toBe(true);
    expect(overview.organisation_memberships).toHaveLength(1);
    expect(overview.legal_acceptances[0].document_kind).toBe('terms_of_service');
    expect(overview.active_sessions[0].device).toBe('Chrome on macOS');
    // A refresh-token hash must never reach the data subject.
    expect(JSON.stringify(overview)).not.toMatch(/token_hash/);
  });

  test('throws 404 when the user does not exist', async () => {
    wireQuery({ profile: null });
    await expect(dsarService.getPrivacyOverview(USER_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  test('degrades to empty when an optional table is not migrated (42P01)', async () => {
    wireQuery({
      orgError: Object.assign(new Error('relation does not exist'), { code: '42P01' }),
    });
    const overview = await dsarService.getPrivacyOverview(USER_ID);
    expect(overview.organisation_memberships).toEqual([]);
  });
});

describe('buildDataExport', () => {
  test('returns a structured export with metadata, profile and consents', async () => {
    wireQuery({ orgs: [], sessions: [] });
    const exported = await dsarService.buildDataExport(USER_ID);
    expect(exported.export_metadata.format_version).toBe('1.0');
    expect(exported.export_metadata.subject_user_id).toBe(USER_ID);
    expect(exported.profile.email).toBe('analyst@example.com');
    expect(exported.consents.current.anonymized_benchmarking).toBe(true);
    expect(exported.consents.history).toHaveLength(1);
    expect(exported.consents.history[0].purpose).toBe('anonymized_benchmarking');
  });
});

describe('verifyExportIdentity', () => {
  test('rejects a password account with no password supplied', async () => {
    wireQuery({ identity: { password_hash: '$2a$hash', password_set: true } });
    await expect(dsarService.verifyExportIdentity(USER_ID, undefined)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test('rejects a password account with the wrong password', async () => {
    wireQuery({ identity: { password_hash: '$2a$hash', password_set: true } });
    bcrypt.compare.mockResolvedValueOnce(false);
    await expect(dsarService.verifyExportIdentity(USER_ID, 'wrong')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  test('accepts a password account with the correct password', async () => {
    wireQuery({ identity: { password_hash: '$2a$hash', password_set: true } });
    bcrypt.compare.mockResolvedValueOnce(true);
    await expect(dsarService.verifyExportIdentity(USER_ID, 'correct')).resolves.toMatchObject({
      verified: true,
      method: 'password',
    });
  });

  test('accepts an OAuth-only account without a password', async () => {
    wireQuery({ identity: { password_hash: 'unusable', password_set: false } });
    await expect(dsarService.verifyExportIdentity(USER_ID, undefined)).resolves.toMatchObject({
      verified: true,
      method: 'session',
    });
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  test('throws 404 when the user does not exist', async () => {
    wireQuery({ identity: undefined });
    await expect(dsarService.verifyExportIdentity(USER_ID, 'x')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
