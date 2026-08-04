const REAL_SECRET_A = 'a-real-32-char-random-secret-xyz';
const REAL_SECRET_B = 'another-real-32-char-secret-abcd';
const REAL_DB_URL = 'postgresql://user:pass@host:5432/postgres';

describe('validateEnv', () => {
  const originalEnv = process.env;
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const load = () => require('../src/config/validateEnv');

  test('skips entirely under NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    const { validateEnv } = load();
    const result = validateEnv({ exitOnFailure: false });
    expect(result.skipped).toBe(true);
    expect(result.ok).toBe(true);
  });

  test('isPlaceholder flags empty, copy-me, and bracketed values', () => {
    const { isPlaceholder } = load();
    expect(isPlaceholder('')).toBe(true);
    expect(isPlaceholder(undefined)).toBe(true);
    expect(isPlaceholder('replace-with-a-long-random-secret')).toBe(true);
    expect(isPlaceholder('postgresql://postgres.YOUR_PROJECT_ID:pw@h/db')).toBe(true);
    expect(isPlaceholder('[insert value]')).toBe(true);
    expect(isPlaceholder('change-me')).toBe(true);
    expect(isPlaceholder(REAL_SECRET_A)).toBe(false);
    expect(isPlaceholder(REAL_DB_URL)).toBe(false);
  });

  test('throws in production when a critical secret is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL;
    process.env.DATABASE_URL = REAL_DB_URL;
    process.env.JWT_SECRET = REAL_SECRET_A;
    delete process.env.DEAL_EVENTS_HMAC_KEY;
    const { validateEnv } = load();
    expect(() => validateEnv({ exitOnFailure: false })).toThrow(/startup aborted/i);
  });

  test('throws in production when a critical secret is still a placeholder', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL;
    process.env.DATABASE_URL = REAL_DB_URL;
    process.env.JWT_SECRET = 'replace-with-a-long-random-secret';
    process.env.DEAL_EVENTS_HMAC_KEY = REAL_SECRET_B;
    const { validateEnv } = load();
    expect(() => validateEnv({ exitOnFailure: false })).toThrow(/startup aborted/i);
  });

  test('passes in production when all critical secrets are set', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL;
    process.env.DATABASE_URL = REAL_DB_URL;
    process.env.JWT_SECRET = REAL_SECRET_A;
    process.env.DEAL_EVENTS_HMAC_KEY = REAL_SECRET_B;
    const { validateEnv } = load();
    const result = validateEnv({ exitOnFailure: false });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('does not throw in development when critical secrets are missing', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.VERCEL;
    delete process.env.DATABASE_URL;
    delete process.env.JWT_SECRET;
    delete process.env.DEAL_EVENTS_HMAC_KEY;
    const { validateEnv } = load();
    let result;
    expect(() => {
      result = validateEnv({ exitOnFailure: false });
    }).not.toThrow();
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  const setCriticalEnv = () => {
    process.env.NODE_ENV = 'development';
    delete process.env.VERCEL;
    process.env.DATABASE_URL = REAL_DB_URL;
    process.env.JWT_SECRET = REAL_SECRET_A;
    process.env.DEAL_EVENTS_HMAC_KEY = REAL_SECRET_B;
  };

  test('warns when an AI key has the wrong provider prefix', () => {
    setCriticalEnv();
    process.env.ANTHROPIC_API_KEY = 'sk-proj-this-is-not-an-anthropic-key';
    const { validateEnv } = load();
    const result = validateEnv({ exitOnFailure: false });
    expect(result.warnings.some((w) => /ANTHROPIC_API_KEY does not look like/.test(w))).toBe(true);
  });

  test('warns when an AI key has surrounding whitespace', () => {
    setCriticalEnv();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-a-valid-looking-key-value\n';
    const { validateEnv } = load();
    const result = validateEnv({ exitOnFailure: false });
    expect(result.warnings.some((w) => /ANTHROPIC_API_KEY has leading\/trailing whitespace/.test(w))).toBe(true);
    // The trimmed value still has the right prefix, so no format warning.
    expect(result.warnings.some((w) => /ANTHROPIC_API_KEY does not look like/.test(w))).toBe(false);
  });

  test('correctly-formatted AI keys produce no format or whitespace warning', () => {
    setCriticalEnv();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-a-valid-looking-anthropic-key';
    process.env.OPENAI_API_KEY = 'sk-a-valid-looking-openai-key';
    process.env.GEMINI_API_KEY = 'AIza-a-valid-looking-google-key';
    const { validateEnv } = load();
    const result = validateEnv({ exitOnFailure: false });
    expect(result.warnings.some((w) => /does not look like/.test(w))).toBe(false);
    expect(result.warnings.some((w) => /whitespace/.test(w))).toBe(false);
  });

  describe('production-ref leak guard (preview isolation)', () => {
    const PROD_REF = 'niamgjbxxgmmffggumvj';
    const prodPoolerUrl = `postgresql://redip_app.${PROD_REF}:pw@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`;
    // A structurally-real Supabase legacy key: JWT whose payload carries the ref.
    const jwtFor = (ref) => {
      const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
      return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', ref, role: 'service_role' })}.sig`;
    };

    test('a preview deployment holding the production DATABASE_URL is fatal', () => {
      process.env.NODE_ENV = 'production';
      process.env.VERCEL = '1';
      process.env.VERCEL_ENV = 'preview';
      process.env.DATABASE_URL = prodPoolerUrl;
      process.env.JWT_SECRET = REAL_SECRET_A;
      process.env.DEAL_EVENTS_HMAC_KEY = REAL_SECRET_B;
      const { validateEnv } = load();
      expect(() => validateEnv({ exitOnFailure: false })).toThrow(/startup aborted/i);
    });

    test('the same DATABASE_URL on the production deployment passes', () => {
      process.env.NODE_ENV = 'production';
      process.env.VERCEL = '1';
      process.env.VERCEL_ENV = 'production';
      process.env.DATABASE_URL = prodPoolerUrl;
      process.env.JWT_SECRET = REAL_SECRET_A;
      process.env.DEAL_EVENTS_HMAC_KEY = REAL_SECRET_B;
      const { validateEnv } = load();
      const result = validateEnv({ exitOnFailure: false });
      expect(result.ok).toBe(true);
    });

    test('a preview pointed at the preview-branch database passes', () => {
      process.env.NODE_ENV = 'production';
      process.env.VERCEL = '1';
      process.env.VERCEL_ENV = 'preview';
      process.env.DATABASE_URL = 'postgresql://redip_app.aphgtgyuuycorhqhjxqx:pw@aws-1-ap-south-1.pooler.supabase.com:6543/postgres';
      process.env.JWT_SECRET = REAL_SECRET_A;
      process.env.DEAL_EVENTS_HMAC_KEY = REAL_SECRET_B;
      const { validateEnv } = load();
      const result = validateEnv({ exitOnFailure: false });
      expect(result.ok).toBe(true);
    });

    test('productionRefLeaks names every leaking variable, including a JWT-embedded ref', () => {
      const { productionRefLeaks } = load();
      const env = {
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        DATABASE_URL: prodPoolerUrl,
        SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
        SUPABASE_SERVICE_ROLE_KEY: jwtFor(PROD_REF),
      };
      expect(productionRefLeaks(env)).toEqual([
        'DATABASE_URL',
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
      ]);
    });

    test('productionRefLeaks is silent off Vercel and for non-production refs', () => {
      const { productionRefLeaks } = load();
      // Local scripts legitimately hold the production URL — never a leak.
      expect(productionRefLeaks({ DATABASE_URL: prodPoolerUrl })).toEqual([]);
      // Branch-ref credentials on a preview are the intended configuration.
      expect(productionRefLeaks({
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        SUPABASE_URL: 'https://aphgtgyuuycorhqhjxqx.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: jwtFor('aphgtgyuuycorhqhjxqx'),
      })).toEqual([]);
      // A malformed key must not crash the guard.
      expect(productionRefLeaks({
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_not_a_jwt',
      })).toEqual([]);
    });
  });
});
