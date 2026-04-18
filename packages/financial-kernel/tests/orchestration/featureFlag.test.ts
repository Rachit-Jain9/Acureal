import {
  isKillSwitchOn,
  getPythonUrl,
  isSilent,
  hash32,
  dealBucket,
  selectEngine,
} from '../../src/orchestration/featureFlag';

describe('featureFlag — kill-switch', () => {
  test.each(['true', '1', 'on', 'yes', 'enabled', 'True', 'ON'])(
    'treats %p as engaged under DEBT_ENGINE_KILL',
    (v) => {
      expect(isKillSwitchOn({ DEBT_ENGINE_KILL: v } as NodeJS.ProcessEnv)).toBe(true);
    },
  );

  test.each(['0', 'false', 'off', 'no', '', undefined])(
    'treats %p as disengaged',
    (v) => {
      const env = (v === undefined ? {} : { DEBT_ENGINE_KILL: v }) as NodeJS.ProcessEnv;
      expect(isKillSwitchOn(env)).toBe(false);
    },
  );

  test('honors legacy DEBT_ENGINE_V2_KILL as alias', () => {
    expect(isKillSwitchOn({ DEBT_ENGINE_V2_KILL: '1' } as NodeJS.ProcessEnv)).toBe(true);
  });

  test('current name wins over legacy alias', () => {
    expect(
      isKillSwitchOn({
        DEBT_ENGINE_KILL: '1',
        DEBT_ENGINE_V2_KILL: '0',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
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

describe('featureFlag — isSilent', () => {
  test('accepts DEBT_ENGINE_SILENT=1', () => {
    expect(isSilent({ DEBT_ENGINE_SILENT: '1' } as NodeJS.ProcessEnv)).toBe(true);
  });
  test('accepts legacy DEBT_ENGINE_V2_SILENT=1', () => {
    expect(isSilent({ DEBT_ENGINE_V2_SILENT: '1' } as NodeJS.ProcessEnv)).toBe(true);
  });
  test('false when unset', () => {
    expect(isSilent({} as NodeJS.ProcessEnv)).toBe(false);
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

describe('featureFlag — selectEngine', () => {
  test('defaults to inline when no env configured', () => {
    const d = selectEngine('deal-1', {} as NodeJS.ProcessEnv);
    expect(d.engineVersion).toBe('inline');
    expect(d.killed).toBe(false);
    expect(d.pythonAvailable).toBe(false);
    expect(d.reason).toBe('inline_default');
  });

  test('returns python when DEBT_ENGINE_PY_URL is set', () => {
    const d = selectEngine('deal-1', {
      DEBT_ENGINE_PY_URL: 'http://kernel.local',
    } as NodeJS.ProcessEnv);
    expect(d.engineVersion).toBe('python');
    expect(d.pythonAvailable).toBe(true);
    expect(d.reason).toBe('python_url_configured');
  });

  test('kill-switch always wins', () => {
    const d = selectEngine('deal-1', {
      DEBT_ENGINE_KILL: '1',
      DEBT_ENGINE_PY_URL: 'http://kernel.local',
    } as NodeJS.ProcessEnv);
    expect(d.engineVersion).toBe('safe-mode');
    expect(d.killed).toBe(true);
    expect(d.pythonAvailable).toBe(false);
    expect(d.reason).toBe('kill_switch_on');
  });

  test('legacy DEBT_ENGINE_V2_KILL still engages safe-mode', () => {
    const d = selectEngine('deal-1', {
      DEBT_ENGINE_V2_KILL: '1',
    } as NodeJS.ProcessEnv);
    expect(d.engineVersion).toBe('safe-mode');
    expect(d.killed).toBe(true);
  });

  test('decision is deterministic for a given (deal, env)', () => {
    const env = { DEBT_ENGINE_PY_URL: 'http://x' } as NodeJS.ProcessEnv;
    const d1 = selectEngine('deal-42', env);
    const d2 = selectEngine('deal-42', env);
    expect(d1.engineVersion).toBe(d2.engineVersion);
    expect(d1.bucket).toBe(d2.bucket);
    expect(d1.reason).toBe(d2.reason);
  });

  test('bucket is always populated', () => {
    const d = selectEngine('any-deal', {} as NodeJS.ProcessEnv);
    expect(d.bucket).toBeGreaterThanOrEqual(0);
    expect(d.bucket).toBeLessThan(100);
  });
});
