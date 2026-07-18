import { describe, it, expect } from 'vitest';
import { deriveEvidenceChip } from '../useEvidenceLinks';

describe('deriveEvidenceChip', () => {
  it('falls back to a "needs verification" pill when no summary', () => {
    expect(deriveEvidenceChip()).toMatchObject({
      tone: 'muted',
      label: 'Unverified',
    });
  });

  it('returns the verified pill for the verified bucket (human-reviewed)', () => {
    const chip = deriveEvidenceChip({
      bucket: 'verified',
      source_count: 2,
      manual_count: 0,
      max_confidence: 0.9,
    });
    expect(chip.tone).toBe('success');
    expect(chip.label).toBe('Verified');
    expect(chip.sublabel).toBe('2 sources · human-reviewed');
  });

  it('uses singular "source" when count is exactly one', () => {
    const chip = deriveEvidenceChip({ bucket: 'verified', source_count: 1, manual_count: 0 });
    expect(chip.sublabel).toBe('1 source · human-reviewed');
  });

  it('labels a manual-only verification as human-verified', () => {
    const chip = deriveEvidenceChip({ bucket: 'verified', source_count: 0, manual_count: 2 });
    expect(chip.tone).toBe('success');
    expect(chip.label).toBe('Verified');
    expect(chip.sublabel).toBe('Human-verified');
  });

  it('returns the inferred pill, honestly marked unverified, for extracted-but-unreviewed sources', () => {
    const chip = deriveEvidenceChip({
      bucket: 'inferred',
      source_count: 3,
      manual_count: 0,
      max_confidence: 0.6,
    });
    expect(chip.tone).toBe('warning');
    expect(chip.label).toBe('Inferred');
    expect(chip.sublabel).toBe('3 references · unverified');
  });

  it('a HIGH-confidence extraction is still honestly "unverified" until a human signs off', () => {
    const chip = deriveEvidenceChip({
      bucket: 'inferred',
      source_count: 1,
      manual_count: 0,
      max_confidence: 0.95,
    });
    expect(chip.tone).toBe('warning');
    expect(chip.label).toBe('Inferred');
    expect(chip.sublabel).toBe('High-confidence extraction · unverified');
  });

  it('returns the unverified pill for the needs_verification bucket', () => {
    const chip = deriveEvidenceChip({
      bucket: 'needs_verification',
      source_count: 0,
      manual_count: 0,
    });
    expect(chip.tone).toBe('muted');
    expect(chip.label).toBe('Unverified');
  });
});
