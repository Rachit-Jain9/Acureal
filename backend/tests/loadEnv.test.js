const fs = require('fs');
const os = require('os');
const path = require('path');

describe('loadEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
    delete process.env.CORS_ORIGINS;
    delete process.env.PORT;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('keeps local runtime in development even when .env.local contains production NODE_ENV', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redip-env-'));

    try {
      fs.writeFileSync(path.join(tempDir, '.env'), 'PORT=5000\n');
      fs.writeFileSync(
        path.join(tempDir, '.env.local'),
        'NODE_ENV=production\nCORS_ORIGINS=https://acureal.in\nPORT=6000\n'
      );

      const { loadEnv } = require('../src/config/loadEnv');

      delete process.env.NODE_ENV;
      delete process.env.CORS_ORIGINS;
      delete process.env.PORT;

      loadEnv(tempDir);

      expect(process.env.NODE_ENV).toBe('development');
      expect(process.env.CORS_ORIGINS).toBe('https://acureal.in');
      expect(process.env.PORT).toBe('6000');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
