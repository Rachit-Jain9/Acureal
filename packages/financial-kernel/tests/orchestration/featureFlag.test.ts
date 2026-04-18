import {
  isDebtV2Enabled,
  getRolloutPct,
  getPythonUrl,
  hash32,
  dealBucket,
  shouldUseV2ForDeal,
} from '../../src/orchestration/featureFlag';

describe('featureFlag — truthy parsing', () => {
  test.each(['true', '1', 'on', 'yes', 'enabled', 'True', 'ON'])(
    'treats %p as enabled',
    (v) => {
      expect(isDebtV2Enabled({ DEBT_ENGINE_V2: v } as NodeJS.ProcessEnv)).toBe(true);
    },
  );

  test.each(['0', 'false', 'off', 'no', '', undefined])(
    'treats %p as disabled',
    (v) => {
      const env = (v === undefined ? {} : { DEBT_ENGINE_V2: v }) as NodeJS.ProcessEnv;
      expect(isDebtV2Enabled(env)).toBe(false);
    },
  );
});

describe('featureFlag — rollout percentage', () => {
  test('default is 0 when V2 disabled and no explicit pct', () => {
    expect(getRolloutPct({} as NodeJS.ProcessEnv)).toBe(0);
  });

  test('default is 100 when V2 enabled and no explicit pct', () => {
    expect(getRolloutPct({ DEBT_ENGINE_V2: 'true' } as NodeJS.ProcessEnv)).toBe(100);
  });

  test('explicit pct overrides default', () => {
    expect(
      getRolloutPct({ DEBT_ENGINE_V2: 'true', DEBT_ENGINE_V2_ROLLOUT_PCT: '25' } as NodeJS.ProcessEnv),
    ).toBe(25);
  });

  test('clamps to [0, 100]', () => {
    expect(getRolloutPct({ DEBT_ENGINE_V2_ROLLOUT_PCT: '-5' } as NodeJS.ProcessEnv)).toBe(0);
    expect(getRolloutPct({ DEBT_ENGINE_V2_ROLLOUT_PCT: '150' } as NodeJS.ProcessEnv)).toBe(100);
  });

  test('non-finite pct treated as 0', () => {
    expect(getRolloutPct({ DEBT_ENGINE_V2_ROLLOUT_PCT: 'abc' } as NodeJS.ProcessEnv)).toBe(0);
  });
});

describe('featureFlag — hash determinism', () => {
  test('hash32 is stable across runs', () => {
    expect(hash32('deal-123')).toBe(hash32('deal-123'));
    expect(hash32('deal-ABC')).toBe(hash32('deal-ABC'));
  });

  test('different inputs produce different hashes (sanity)', () => {
    expect(hash32('a')).not.toBe(hash32('b'));
  });

  test('dealBucket is always in [0, 99]', () => {
    for (let i = 0; i < 100; i++) {
      const b = dealBucket(`deal-${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });
});

describe('featureFlag — shouldUseV2ForDeal', () => {
  test('returns false when V2 disabled', () => {
    const d = shouldUseV2ForDeal('any', {} as NodeJS.ProcessEnv);
    expect(d.usedV2).toBe(false);
    expect(d.reason).toMatch(/off/);
  });

  test('returns true when rollout = 100%', () => {
    const d = shouldUseV2ForDeal('any', {
      DEBT_ENGINE_V2: 'true',
      DEBT_ENGINE_V2_ROLLOUT_PCT: '100',
    } as NodeJS.ProcessEnv);
    expect(d.usedV2).toBe(true);
  });

  test('returns false when rollout = 0%', () => {
    const d = shouldUseV2ForDeal('any', {
      DEBT_ENGINE_V2: 'true',
      DEBT_ENGINE_V2_ROLLOUT_PCT: '0',
    } as NodeJS.ProcessEnv);
    expect(d.usedV2).toBe(false);
  });

  test('is deterministic per deal id', () => {
    const env = {
      DEBT_ENGINE_V2: 'true',
      DEBT_ENGINE_V2_ROLLOUT_PCT: '50',
    } as NodeJS.ProcessEnv;
    const d1 = shouldUseV2ForDeal('deal-42', env);
    const d2 = shouldUseV2ForDeal('deal-42', env);
    expect(d1.usedV2).toBe(d2.usedV2);
    expect(d1.bucket).toBe(d2.bucket);
  });

  test('python url activates usedPython flag at rollout', () => {
    const d = shouldUseV2ForDeal('any', {
      DEBT_ENGINE_V2: 'true',
      DEBT_ENGINE_V2_ROLLOUT_PCT: '100',
      DEBT_ENGINE_PY_URL: 'http://localhost:8080',
    } as NodeJS.ProcessEnv);
    expect(d.usedV2).toBe(true);
    expect(d.usedPython).toBe(true);
  });

  test('python url does not activate when v2 off', () => {
    const d = shouldUseV2ForDeal('any', {
      DEBT_ENGINE_PY_URL: 'http://localhost:8080',
    } as NodeJS.ProcessEnv);
    expect(d.usedV2).toBe(false);
    expect(d.usedPython).toBe(false);
  });
});

describe('featureFlag — getPythonUrl', () => {
  test('returns null when unset or empty', () => {
    expect(getPythonUrl({} as NodeJS.ProcessEnv)).toBeNull();
    expect(getPythonUrl({ DEBT_ENGINE_PY_URL: '' } as NodeJS.ProcessEnv)).toBeNull();
    expect(getPythonUrl({ DEBT_ENGINE_PY_URL: '   ' } as NodeJS.ProcessEnv)).toBeNull();
  });

  test('trims whitespace', () => {
    expect(getPythonUrl({ DEBT_ENGINE_PY_URL: ' http://x  ' } as NodeJS.ProcessEnv)).toBe('http://x');
  });
});
