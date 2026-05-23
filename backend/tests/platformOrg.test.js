jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../src/config/database');
const {
  getPlatformOrgId,
  getPlatformAdminEmails,
  __resetPlatformOrgCache,
} = require('../src/utils/platformOrg');

describe('platformOrg', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetPlatformOrgCache();
    delete process.env.PLATFORM_ADMIN_EMAILS;
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

  describe('getPlatformOrgId', () => {
    test('resolves the org id for the earliest admin user', async () => {
      query.mockResolvedValueOnce({ rows: [{ default_organization_id: 'org-123' }] });
      const id = await getPlatformOrgId();
      expect(id).toBe('org-123');
      expect(query).toHaveBeenCalledTimes(1);
    });

    test('caches the result — subsequent calls do not re-query', async () => {
      query.mockResolvedValueOnce({ rows: [{ default_organization_id: 'org-456' }] });
      await getPlatformOrgId();
      const id2 = await getPlatformOrgId();
      expect(id2).toBe('org-456');
      expect(query).toHaveBeenCalledTimes(1);
    });

    test('caches the null result too — no admin found means no re-query', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const first = await getPlatformOrgId();
      const second = await getPlatformOrgId();
      expect(first).toBeNull();
      expect(second).toBeNull();
      expect(query).toHaveBeenCalledTimes(1);
    });

    test('returns null gracefully on a query error', async () => {
      query.mockRejectedValueOnce(new Error('db down'));
      const id = await getPlatformOrgId();
      expect(id).toBeNull();
    });
  });
});
