'use strict';

/**
 * Unit tests for rera/groundTruthChecks — recorded-vs-extracted parcel-identity
 * reconciliation. Pure; conservative (khata + owner only).
 */

const { compareGroundTruth, extractedValue } = require('../src/services/rera/groundTruthChecks');

describe('extractedValue', () => {
  test('reads { value } objects and bare values', () => {
    expect(extractedValue({ k: { value: 'X' } }, 'k')).toBe('X');
    expect(extractedValue({ k: 'Y' }, 'k')).toBe('Y');
    expect(extractedValue({ k: { value: '' } }, 'k')).toBeNull();
    expect(extractedValue({}, 'k')).toBeNull();
  });
});

describe('compareGroundTruth — khata', () => {
  test('flags a khata-number mismatch (title-lane finding)', () => {
    const out = compareGroundTruth({ khata_no: 'KH-111' }, { khata_number: { value: 'KH-999' } });
    expect(out).toHaveLength(1);
    expect(out[0].title).toMatch(/khata/i);
    expect(out[0].category).toBe('title');
    expect(out[0].evidence).toHaveLength(2);
  });

  test('no finding when khata matches (normalised: spaces/dashes/case)', () => {
    expect(compareGroundTruth({ khata_no: 'KH 111' }, { khata_number: { value: 'kh-111' } })).toEqual([]);
  });

  test('handles a bare (non-object) field_map value', () => {
    expect(compareGroundTruth({ khata_no: 'A' }, { khata_number: 'B' })).toHaveLength(1);
  });
});

describe('compareGroundTruth — owner', () => {
  test('flags a clear owner divergence (high severity)', () => {
    const out = compareGroundTruth({ owner_name: 'Rajesh Kumar' }, { owner_name: { value: 'Suresh Patil' } });
    const owner = out.find((f) => /owner/i.test(f.title));
    expect(owner).toBeDefined();
    expect(owner.severity).toBe('high');
  });

  test('no finding when owner names are similar (extra middle initial)', () => {
    expect(compareGroundTruth({ owner_name: 'Rajesh Kumar' }, { owner_name: { value: 'Rajesh A Kumar' } })).toEqual([]);
  });
});

describe('compareGroundTruth — guards', () => {
  test('no finding when a side is missing', () => {
    expect(compareGroundTruth({ khata_no: 'KH-1' }, {})).toEqual([]);
    expect(compareGroundTruth({}, { khata_number: { value: 'KH-1' } })).toEqual([]);
    expect(compareGroundTruth(null, { khata_number: { value: 'KH-1' } })).toEqual([]);
    expect(compareGroundTruth({ khata_no: 'KH-1' }, null)).toEqual([]);
  });

  test('survey number is intentionally NOT reconciled (multi-parcel safety)', () => {
    const out = compareGroundTruth({ survey_number: '12/3' }, { survey_number: { value: '99/9' } });
    expect(out).toEqual([]);
  });
});
