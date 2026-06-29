import { describe, it, expect, beforeEach } from 'vitest';
import { loadYieldStudy, saveYieldStudy, clearYieldStudy } from '../yieldStudioStore';

beforeEach(() => {
  localStorage.clear();
});

describe('yieldStudioStore', () => {
  it('round-trips a study per deal', () => {
    const study = { env: { landAreaSqft: '43560', effectiveFsi: '2.5' }, assumptions: { loadingFactorPct: 30 } };
    saveYieldStudy('deal-1', study);
    expect(loadYieldStudy('deal-1')).toEqual(study);
  });

  it('isolates studies by deal id', () => {
    saveYieldStudy('deal-1', { env: { effectiveFsi: '2' } });
    saveYieldStudy('deal-2', { env: { effectiveFsi: '3' } });
    expect(loadYieldStudy('deal-1').env.effectiveFsi).toBe('2');
    expect(loadYieldStudy('deal-2').env.effectiveFsi).toBe('3');
  });

  it('returns null for an unknown deal', () => {
    expect(loadYieldStudy('nope')).toBeNull();
  });

  it('clears a study', () => {
    saveYieldStudy('deal-1', { env: {} });
    clearYieldStudy('deal-1');
    expect(loadYieldStudy('deal-1')).toBeNull();
  });

  it('no-ops without a deal id and never throws on bad input', () => {
    expect(() => saveYieldStudy(null, { a: 1 })).not.toThrow();
    expect(loadYieldStudy(null)).toBeNull();
    expect(() => clearYieldStudy(undefined)).not.toThrow();
  });

  it('returns null on corrupt stored JSON', () => {
    localStorage.setItem('redip:yieldstudio:deal-x', '{not json');
    expect(loadYieldStudy('deal-x')).toBeNull();
  });
});
