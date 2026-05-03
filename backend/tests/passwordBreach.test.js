// Test the HIBP k-anonymity wrapper directly. The wrapper short-circuits in
// NODE_ENV=test (so it never actually calls the network from the rest of
// the suite), so these tests temporarily flip NODE_ENV to exercise the real
// path while mocking global.fetch.

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe('passwordBreach.isPasswordBreached', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    process.env.NODE_ENV = 'production';
    delete process.env.SKIP_PASSWORD_BREACH_CHECK;
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  test('short-circuits in test env (no network call)', async () => {
    process.env.NODE_ENV = 'test';
    global.fetch = jest.fn(() => {
      throw new Error('fetch should not have been called');
    });
    const { isPasswordBreached } = require('../src/utils/passwordBreach');
    const result = await isPasswordBreached('password');
    expect(result).toEqual({ breached: false, count: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('honors SKIP_PASSWORD_BREACH_CHECK=1 escape hatch', async () => {
    process.env.SKIP_PASSWORD_BREACH_CHECK = '1';
    global.fetch = jest.fn();
    const { isPasswordBreached } = require('../src/utils/passwordBreach');
    const result = await isPasswordBreached('password');
    expect(result.breached).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('flags a password whose suffix appears with count > 0', async () => {
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    // prefix "5BAA6", suffix "1E4C9B93F3F0682250B6CF8331B7EE68FD8"
    const fakeBody = [
      '0018A45C4D1DEF81644B54AB7F969B88D65:1',           // unrelated
      '1E4C9B93F3F0682250B6CF8331B7EE68FD8:9659365',     // our hit
      '011053FD0102E94D6AE2F8B83D76FAF94F6:1',           // padding
    ].join('\r\n');

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(fakeBody),
    });

    const { isPasswordBreached } = require('../src/utils/passwordBreach');
    const result = await isPasswordBreached('password');
    expect(result.breached).toBe(true);
    expect(result.count).toBe(9659365);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://api.pwnedpasswords.com/range/5BAA6'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Add-Padding': 'true' }),
      })
    );
  });

  test('treats padding rows (count=0) as not breached', async () => {
    // SHA-1("password") suffix matches but count is 0 (HIBP padding)
    const fakeBody = '1E4C9B93F3F0682250B6CF8331B7EE68FD8:0';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(fakeBody),
    });
    const { isPasswordBreached } = require('../src/utils/passwordBreach');
    const result = await isPasswordBreached('password');
    expect(result.breached).toBe(false);
    expect(result.count).toBe(0);
  });

  test('returns clean result when suffix not found in range', async () => {
    const fakeBody = [
      '0018A45C4D1DEF81644B54AB7F969B88D65:1',
      '01330C689E5D64F660D6947A93AD634EF8F:8',
    ].join('\n');

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(fakeBody),
    });

    const { isPasswordBreached } = require('../src/utils/passwordBreach');
    const result = await isPasswordBreached('correct horse battery staple unique');
    expect(result.breached).toBe(false);
    expect(result.count).toBe(0);
  });

  test('fails open when HIBP returns non-200', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve(''),
    });
    const { isPasswordBreached } = require('../src/utils/passwordBreach');
    const result = await isPasswordBreached('password');
    expect(result.breached).toBe(false);
    expect(result.failedOpen).toBe(true);
  });

  test('fails open on network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ENETUNREACH'));
    const { isPasswordBreached } = require('../src/utils/passwordBreach');
    const result = await isPasswordBreached('password');
    expect(result.breached).toBe(false);
    expect(result.failedOpen).toBe(true);
  });

  test('fails open on timeout (AbortError)', async () => {
    global.fetch = jest.fn().mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    const { isPasswordBreached } = require('../src/utils/passwordBreach');
    const result = await isPasswordBreached('password');
    expect(result.breached).toBe(false);
    expect(result.failedOpen).toBe(true);
  });
});
