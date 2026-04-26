import { describe, it, expect } from 'vitest';
import { deriveParcelVerdict } from '../useParcelVerdict';

/**
 * Pin the Quick Verdict logic so the parcel intelligence tab keeps a single
 * source of truth for "Proceed / Caution / Hold". The pure function is
 * tested directly; the hook is just a useMemo wrapper.
 */
describe('deriveParcelVerdict', () => {
  it('returns null when intelligence is missing', () => {
    expect(deriveParcelVerdict(null)).toBeNull();
    expect(deriveParcelVerdict(undefined)).toBeNull();
  });

  it('passes through a backend-computed verdict verbatim', () => {
    const intelligence = {
      verdict: { label: 'Server says hold', tone: 'danger', confidence_pct: 12 },
    };
    expect(deriveParcelVerdict(intelligence)).toEqual(intelligence.verdict);
  });

  it('marks high-severity flags as "Do Not Rely Yet" with danger tone', () => {
    const verdict = deriveParcelVerdict({
      red_flags: [{ severity: 'high' }, { severity: 'medium' }],
      confidence: { overall: 0.82 },
      buckets: { needs_verification: [] },
    });
    expect(verdict.label).toBe('Do Not Rely Yet');
    expect(verdict.tone).toBe('danger');
    expect(verdict.counts.high).toBe(1);
    expect(verdict.counts.medium).toBe(1);
  });

  it('marks medium flags as "Proceed With Caution" / warning tone', () => {
    const verdict = deriveParcelVerdict({
      red_flags: [{ severity: 'medium' }, { severity: 'low' }],
      confidence: { overall: 0.78 },
      buckets: { needs_verification: [{ key: 'something' }] },
    });
    expect(verdict.label).toBe('Proceed With Caution');
    expect(verdict.tone).toBe('warning');
    expect(verdict.counts.needs_verification).toBe(1);
  });

  it('marks low-confidence-only as "Proceed With Caution"', () => {
    const verdict = deriveParcelVerdict({
      red_flags: [],
      confidence: { overall: 0.55 },
      buckets: {},
    });
    expect(verdict.label).toBe('Proceed With Caution');
    expect(verdict.tone).toBe('warning');
    expect(verdict.confidence_pct).toBe(55);
  });

  it('marks clean state with high confidence as "Screening Ready"', () => {
    const verdict = deriveParcelVerdict({
      red_flags: [{ severity: 'low' }],
      confidence: { overall: 0.91 },
      buckets: {},
    });
    expect(verdict.label).toBe('Screening Ready');
    expect(verdict.tone).toBe('success');
    expect(verdict.confidence_pct).toBe(91);
  });

  it('summary text reports counts for analyst skim', () => {
    const verdict = deriveParcelVerdict({
      red_flags: [
        { severity: 'high' },
        { severity: 'high' },
        { severity: 'medium' },
        { severity: 'low' },
      ],
      confidence: { overall: 0.4 },
      buckets: { needs_verification: [] },
    });
    expect(verdict.summary).toBe('2 high, 1 medium, 1 low flags.');
  });
});
