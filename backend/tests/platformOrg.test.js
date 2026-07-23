jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/lib/logger', () => {
  const child = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
  return { child: () => child, __mockChild: child };
});

jest.mock('../src/lib/sentry', () => ({
  Sentry: { captureException: jest.fn(), captureMessage: jest.fn() },
  isEnabled: () => true,
}));

const { query } = require('../src/config/database');
const { __mockChild: mockLog } = require('../src/lib/logger');
const { Sentry } = require('../src/lib/sentry');
const {
  getPlatformOrgId,
  getPlatformAdminEmails,
  __resetPlatformOrgCache,
} = require('../src/utils/platformOrg');

describe('platformOrg', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    __resetPlatformOrgCache();
    delete process.env.PLATFORM_ADMIN_EMAILS;
    delete process.env.PLATFORM_ORG_ID;
  });

  describe('getPlatformAdminEmails', () => {
    test('falls back to the founding admin when env is unset', () => {
      expect(getPlatformAdminEmails()).toEqual(['rachitj579@gmail.com']);
    });

    test('parses a comma-separated list and lowercases / trims each', () => {
      process.env.PLATFORM_ADMIN_EMAILS = 'A@example.com, B@EXAMPLE.com,  ,c@example.com';
      expect(getPlatformAdminEmails()).toEqual([
        'a@example.com',
        'b@example.com',
        'c@example.com',
      ]);
    });
  });

  describe('PLATFORM_ORG_ID env pin', () => {
    test('a valid pin short-circuits the DB entirely', async () => {
      process.env.PLATFORM_ORG_ID = '11111111-2222-4333-8444-555555555555';
      const id = await getPlatformOrgId();
      expect(id).toBe('11111111-2222-4333-8444-555555555555');
      expect(query).not.toHaveBeenCalled();
    });

    test('the pin is case/whitespace tolerant', async () => {
      process.env.PLATFORM_ORG_ID = '  11111111-2222-4333-8444-AAAAAAAAAAAA ';
      expect(await getPlatformOrgId()).toBe('11111111-2222-4333-8444-aaaaaaaaaaaa');
      expect(query).not.toHaveBeenCalled();
    });

    test('an invalid pin logs loudly ONCE and falls back to the email lookup', async () => {
      process.env.PLATFORM_ORG_ID = 'not-a-uuid';
      query.mockResolvedValue({ rows: [{ default_organization_id: 'org-legacy' }] });
      expect(await getPlatformOrgId()).toBe('org-legacy');
      expect(await getPlatformOrgId()).toBe('org-legacy');
      expect(mockLog.error).toHaveBeenCalledWith('platform_org_id_invalid', expect.any(Object));
      expect(mockLog.error).toHaveBeenCalledTimes(1);
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPlatformOrgId (legacy email lookup)', () => {
    test('resolves the org id for the earliest admin user', async () => {
      query.mockResolvedValueOnce({ rows: [{ default_organization_id: 'org-123' }] });
      const id = await getPlatformOrgId();
      expect(id).toBe('org-123');
      expect(query).toHaveBeenCalledTimes(1);
    });

    test('caches a NON-NULL result for the process lifetime', async () => {
      query.mockResolvedValueOnce({ rows: [{ default_organization_id: 'org-456' }] });
      await getPlatformOrgId();
      const id2 = await getPlatformOrgId();
      expect(id2).toBe('org-456');
      expect(query).toHaveBeenCalledTimes(1);
    });

    test('concurrent callers share one in-flight query', async () => {
      query.mockResolvedValueOnce({ rows: [{ default_organization_id: 'org-789' }] });
      const [a, b] = await Promise.all([getPlatformOrgId(), getPlatformOrgId()]);
      expect(a).toBe('org-789');
      expect(b).toBe('org-789');
      expect(query).toHaveBeenCalledTimes(1);
    });

    test('a null result is cached within the retry TTL (no immediate re-query)', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      expect(await getPlatformOrgId()).toBeNull();
      expect(await getPlatformOrgId()).toBeNull();
      expect(query).toHaveBeenCalledTimes(1);
      expect(mockLog.warn).toHaveBeenCalledWith('platform_org_admin_not_found', expect.any(Object));
    });

    test('a null result is RE-ATTEMPTED after the TTL — the silent-vanish fix', async () => {
      const now = Date.now();
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
      query.mockResolvedValueOnce({ rows: [] });
      expect(await getPlatformOrgId()).toBeNull();

      nowSpy.mockReturnValue(now + 61_000);
      query.mockResolvedValueOnce({ rows: [{ default_organization_id: 'org-recovered' }] });
      expect(await getPlatformOrgId()).toBe('org-recovered');
      expect(query).toHaveBeenCalledTimes(2);
    });

    test('a query error resolves null, logs, reports to Sentry — and retries after the TTL', async () => {
      const now = Date.now();
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
      const boom = new Error('db down');
      query.mockRejectedValueOnce(boom);
      expect(await getPlatformOrgId()).toBeNull();
      expect(mockLog.error).toHaveBeenCalledWith('platform_org_lookup_failed', boom);
      expect(Sentry.captureException).toHaveBeenCalledWith(boom, expect.objectContaining({
        fingerprint: ['platform-org', 'lookup-failed'],
      }));

      // Within the TTL: still the cached null, no extra query.
      expect(await getPlatformOrgId()).toBeNull();
      expect(query).toHaveBeenCalledTimes(1);

      // Past the TTL: recovers.
      nowSpy.mockReturnValue(now + 61_000);
      query.mockResolvedValueOnce({ rows: [{ default_organization_id: 'org-back' }] });
      expect(await getPlatformOrgId()).toBe('org-back');
    });
  });
});
