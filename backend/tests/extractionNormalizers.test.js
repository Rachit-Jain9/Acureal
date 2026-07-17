'use strict';

/**
 * Deterministic normalizers for AI-extracted Indian real-estate values.
 *
 * The contract under test (each clause is a rule from the module header):
 *   raw immutable · never populate a blank · never touch identifiers/names ·
 *   ambiguity flagged, not hidden · every result names its versioned rule.
 *
 * Golden values come from REAL production extractions on the operator's
 * Jarakabande Kaval deal: "34 Acres 32 Guntas" and "06.02.2024" are verbatim
 * from the BDA acquisition-clarification letter; "13,06,800" is the deal's
 * land extent as Indian-grouped digits.
 */

const { normalizeField, __internal } = require('../src/utils/extractionNormalizers');
const { normalizeDate, normalizeArea, normalizeMoney, GUNTAS_PER_ACRE } = __internal;

describe('dates (date_in_v1)', () => {
  test('GOLDEN: the BDA letter date 06.02.2024 → 2024-02-06, flagged as day-first ASSUMED', () => {
    const r = normalizeField('document_date', '06.02.2024');
    expect(r).toMatchObject({ value: '2024-02-06', unit: 'date', rule: 'date_in_v1', status: 'assumed' });
    // The caveat must show the OTHER reading so the reviewer can check it.
    expect(r.reason).toMatch(/day-first/i);
    expect(r.reason).toMatch(/2024-06-02/);
  });

  test('day > 12 is provably day-first → EXACT', () => {
    expect(normalizeField('registration_date', '26/11/2023')).toMatchObject({
      value: '2023-11-26', status: 'exact', rule: 'date_in_v1',
    });
  });

  test('month-first only possible reading (second part > 12) → EXACT', () => {
    expect(normalizeField('issue_date', '02.24.2024')).toMatchObject({
      value: '2024-02-24', status: 'exact',
    });
  });

  test('named-month forms → EXACT, both orders', () => {
    expect(normalizeField('order_date', '6 Feb 2024').value).toBe('2024-02-06');
    expect(normalizeField('order_date', '6th February 2024').value).toBe('2024-02-06');
    expect(normalizeField('order_date', 'Feb 6, 2024').value).toBe('2024-02-06');
    expect(normalizeField('order_date', 'September 15, 2023').value).toBe('2023-09-15');
  });

  test('already-ISO dates need nothing → null', () => {
    expect(normalizeField('registration_date', '2024-02-06')).toBeNull();
  });

  test('two-digit years REFUSE (the century would be a guess)', () => {
    const r = normalizeField('mutation_date', '06.02.24');
    expect(r.status).toBe('failed');
    expect(r.value).toBeUndefined();
    expect(r.reason).toMatch(/two-digit year/);
  });

  test('impossible calendar dates fail, never coerce', () => {
    expect(normalizeDate('31.02.2024').status).toBe('failed'); // Feb 31
    expect(normalizeDate('45.13.2024').status).toBe('failed');
  });

  test('prose is not date-shaped → null (no opinion)', () => {
    expect(normalizeDate('sometime last year')).toBeNull();
  });
});

describe('areas (area_* v1)', () => {
  test('GOLDEN: the BDA letter extent "34 Acres 32 Guntas" → 34.8 acres, EXACT', () => {
    const r = normalizeField('total_area_acres', '34 Acres 32 Guntas');
    expect(r).toMatchObject({ value: 34.8, unit: 'acre', rule: 'area_acre_gunta_v1', status: 'exact' });
    expect(r.reason).toMatch(/1 gunta = 1\/40 acre/);
    expect(GUNTAS_PER_ACRE).toBe(40);
  });

  test('guntas alone convert (32 guntas → 0.8 acre)', () => {
    expect(normalizeField('area_acres', '32 guntas')).toMatchObject({ value: 0.8, unit: 'acre', status: 'exact' });
  });

  test('acres + cents (South-Indian deeds): 2 acres 20 cents → 2.2 acre', () => {
    expect(normalizeField('land_area_acres', '2 acres 20 cents')).toMatchObject({ value: 2.2, unit: 'acre' });
  });

  test('sq ft strings with Indian grouping → number + sqft unit', () => {
    expect(normalizeField('site_area_sqft', '45,000 sq ft')).toMatchObject({ value: 45000, unit: 'sqft', rule: 'area_sqft_v1' });
    expect(normalizeField('area_sqft', '1,306,800 sqft').value).toBe(1306800);
  });

  test('sq m stays sq m — cross-unit conversion is the ontology transform\'s job', () => {
    expect(normalizeField('plot_area_sqm', '1,200 sq m')).toMatchObject({ value: 1200, unit: 'sqm', rule: 'area_sqm_v1' });
  });

  test('a bare number is already canonical → null', () => {
    expect(normalizeField('land_area_acres', 34.8)).toBeNull();
    expect(normalizeField('land_area_sqft', '13,06,800')).toBeNull(); // validateAndCoerce already strips grouping
  });

  test('unreadable extents fail with a reason, never guess', () => {
    const r = normalizeArea('several acres');
    expect(r === null || r.status === 'failed').toBe(true);
  });
});

describe('money (money_in_v1)', () => {
  test('"₹1.25 crore" → 12,500,000 INR', () => {
    expect(normalizeField('consideration_inr', '₹1.25 crore')).toMatchObject({
      value: 12500000, unit: 'INR', rule: 'money_in_v1', status: 'exact',
    });
  });

  test('crore + lakh compound: "1 crore 25 lakh" → 12,500,000', () => {
    expect(normalizeMoney('1 crore 25 lakh').value).toBe(12500000);
  });

  test('lakh variants incl. "lacs": "₹85 lacs" → 8,500,000', () => {
    expect(normalizeField('sale_price_inr', '₹85 lacs').value).toBe(8500000);
  });

  test('"Rs. 12,50,000/-" (registrar style) → 1,250,000', () => {
    expect(normalizeField('stamp_duty_inr', 'Rs. 12,50,000/-')).toMatchObject({ value: 1250000, unit: 'INR' });
  });

  test('"2.5 Cr" shorthand → 25,000,000', () => {
    expect(normalizeField('total_consideration_inr', '2.5 Cr').value).toBe(25000000);
  });

  test('a bare number is already canonical → null', () => {
    expect(normalizeField('consideration_inr', 180000000)).toBeNull();
    expect(normalizeField('consideration_inr', '18,00,00,000')).toBeNull();
  });
});

describe('the hard exclusions — transcriptions are never restated', () => {
  test.each([
    ['survey_number', '72/1A'],
    ['sy_no', '72-1'],
    ['hissa_number', '2'],
    ['khata_number', '123/456'],
    ['pid_number', '1-2-3-4'],
    ['document_number', 'BNG-R-2024-1234'],
    ['mutation_number', 'M 45/2023'],
    ['owner_name', 'M. Ramesh bin Late M. Lakshminarayana'],
    ['grantor', 'Someone'],
    ['property_address', '12 Some Road, Yelahanka'],
    ['schedule_a_boundaries', 'East: road; West: S.No 71'],
  ])('%s is never normalized', (field, value) => {
    expect(normalizeField(field, value)).toBeNull();
  });

  test('registration_date is date-normalized even though registration_NUMBER is excluded', () => {
    // The exclusion must be keyed precisely: registration_number is an
    // identifier; registration_date is a date.
    expect(normalizeField('registration_number', '2024-1234')).toBeNull();
    expect(normalizeField('registration_date', '26/11/2023').value).toBe('2023-11-26');
  });
});

describe('the contract', () => {
  test('never populates a blank', () => {
    expect(normalizeField('consideration_inr', null)).toBeNull();
    expect(normalizeField('consideration_inr', '')).toBeNull();
    expect(normalizeField('consideration_inr', undefined)).toBeNull();
  });

  test('never touches containers (arrays / objects)', () => {
    expect(normalizeField('key_dates', [{ date: '06.02.2024' }])).toBeNull();
    expect(normalizeField('property_details', { area: '34 acres' })).toBeNull();
  });

  test('a field with no family rule gets no opinion', () => {
    expect(normalizeField('remarks', '34 Acres 32 Guntas')).toBeNull(); // name doesn't say area
    expect(normalizeField('soil_type', 'red loam')).toBeNull();
  });

  test('every successful result names its versioned rule + carries a human reason', () => {
    const results = [
      normalizeField('document_date', '06.02.2024'),
      normalizeField('total_area_acres', '34 Acres 32 Guntas'),
      normalizeField('consideration_inr', '₹1.25 crore'),
    ];
    for (const r of results) {
      expect(r.rule).toMatch(/_v\d+$/);
      expect(typeof r.reason).toBe('string');
      expect(r.reason.length).toBeGreaterThan(10);
    }
  });

  test('failed results carry NO value (the proposal falls back to the raw)', () => {
    const r = normalizeField('mutation_date', '06.02.24');
    expect(r.status).toBe('failed');
    expect('value' in r).toBe(false);
  });
});

describe('integration: the assessment carries the proposal', () => {
  const { assessExtractionFields } = require('../src/utils/extractionFieldQuality');

  test('an area string gets both an honest verification status AND a normalization', () => {
    const { assessments } = assessExtractionFields(
      { total_area_acres: '34 Acres 32 Guntas' },
      { sourceText: 'extent of 34 Acres 32 Guntas in Survey No. 72' },
    );
    const a = assessments.total_area_acres;
    expect(a.status).toBe('source_verified');   // the RAW value is judged
    expect(a.normalized).toMatchObject({ value: 34.8, unit: 'acre', status: 'exact' });
  });

  test('a bare-number field carries no normalized key at all', () => {
    const { assessments } = assessExtractionFields({ land_area_sqft: 1306800 });
    expect(assessments.land_area_sqft.normalized).toBeUndefined();
  });

  test('a legal-lane date still normalizes (format aid), while staying verify_legal', () => {
    const { assessments } = assessExtractionFields({ valid_until: '31/12/2025' });
    const a = assessments.valid_until;
    expect(a.status).toBe('verify_legal');      // the cap holds
    expect(a.normalized.value).toBe('2025-12-31'); // the format aid still helps
  });
});
