/**
 * Unit tests for the cashFlows post-processor.
 *
 * Covers:
 *   - Quarter 0 "Effective Date" semantics
 *   - Quarter N start/end date math (UTC-anchored)
 *   - Year 0 synthetic row (only when cfs[0] !== 0)
 *   - Year bucketing + partial-last-year handling
 *   - Rounding: quarterly.net passthrough, yearly.net + summary 2dp
 *   - Summary sign convention (totalOutflow is |sum(negatives)|)
 *   - Date edge cases (invalid effective date, leap year, month-end overflow)
 */

import {
  buildCashFlows,
  normalizeEffectiveDate,
  addUtcDays,
  addUtcMonths,
} from '../src/postprocess/cashFlows';

describe('normalizeEffectiveDate', () => {
  it('returns today (UTC) for falsy input', () => {
    const out = normalizeEffectiveDate(null);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('parses a YYYY-MM-DD string unchanged', () => {
    expect(normalizeEffectiveDate('2026-04-21')).toBe('2026-04-21');
  });

  it('handles Date instances', () => {
    const d = new Date('2026-01-15T00:00:00.000Z');
    expect(normalizeEffectiveDate(d)).toBe('2026-01-15');
  });

  it('returns today for invalid strings', () => {
    const out = normalizeEffectiveDate('not a date');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('addUtcDays / addUtcMonths', () => {
  it('adds days without timezone drift', () => {
    expect(addUtcDays('2026-04-21', 1)).toBe('2026-04-22');
    expect(addUtcDays('2026-04-21', -1)).toBe('2026-04-20');
  });

  it('adds months with month-end overflow mapping', () => {
    // Jan 31 + 1 month → March 3 (JS setUTCMonth overflows forward)
    expect(addUtcMonths('2026-01-31', 1)).toBe('2026-03-03');
    expect(addUtcMonths('2026-01-15', 3)).toBe('2026-04-15');
  });

  it('handles year boundary', () => {
    expect(addUtcMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addUtcDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('buildCashFlows', () => {
  it('produces the top-level shape legacy emits', () => {
    const out = buildCashFlows([-100, 10, 10, 10, 100], { effectiveDate: '2026-01-01' });
    expect(Object.keys(out).sort()).toEqual(['quarterly', 'summary', 'yearly'].sort());
    expect(Object.keys(out.summary).sort()).toEqual(['totalInflow', 'totalOutflow'].sort());
  });

  it('quarter 0 is the Effective Date row with collapsed dates', () => {
    const out = buildCashFlows([-100, 10, 20], { effectiveDate: '2026-01-01' });
    expect(out.quarterly[0]).toEqual({
      quarter: 0,
      label: 'Effective Date',
      startDate: '2026-01-01',
      endDate: '2026-01-01',
      period: '2026-01-01',
      net: -100,
    });
  });

  it('quarter N spans (N-1)*3 to N*3 months − 1 day', () => {
    const out = buildCashFlows([0, 0, 0], { effectiveDate: '2026-01-01' });
    expect(out.quarterly[1]).toMatchObject({
      quarter: 1,
      label: 'Q1',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      period: '2026-01-01 to 2026-03-31',
    });
    expect(out.quarterly[2]).toMatchObject({
      quarter: 2,
      label: 'Q2',
      startDate: '2026-04-01',
      endDate: '2026-06-30',
    });
  });

  it('quarterly.net is passed through without rounding', () => {
    const out = buildCashFlows([-100.123456, 10.987654], { effectiveDate: '2026-01-01' });
    expect(out.quarterly[0].net).toBe(-100.123456);
    expect(out.quarterly[1].net).toBe(10.987654);
  });

  it('omits Year 0 when cfs[0] === 0', () => {
    const out = buildCashFlows([0, 10, 10, 10, 10], { effectiveDate: '2026-01-01' });
    expect(out.yearly[0].year).toBe(1);
  });

  it('includes Year 0 when cfs[0] !== 0 (rounded to 2dp)', () => {
    const out = buildCashFlows([-99.999, 0, 0, 0, 0], { effectiveDate: '2026-01-01' });
    expect(out.yearly[0]).toMatchObject({
      year: 0,
      label: 'Effective Date',
      startDate: '2026-01-01',
      endDate: '2026-01-01',
      period: '2026-01-01',
      net: -100, // round2(−99.999)
    });
  });

  it('buckets quarters 1..N into year groups of 4', () => {
    const cfs = [0, 1, 2, 3, 4, 5, 6, 7, 8]; // 1 construction + 8 op quarters = 2 full years
    const out = buildCashFlows(cfs, { effectiveDate: '2026-01-01' });
    // Year 0 skipped because cfs[0] === 0
    expect(out.yearly).toHaveLength(2);
    expect(out.yearly[0].year).toBe(1);
    expect(out.yearly[0].net).toBe(10); // 1+2+3+4
    expect(out.yearly[1].year).toBe(2);
    expect(out.yearly[1].net).toBe(26); // 5+6+7+8
  });

  it('handles partial final year (less than 4 quarters)', () => {
    const cfs = [0, 1, 2, 3, 4, 5, 6]; // 1 + 6 quarters → Year 1 full, Year 2 partial (2 qs)
    const out = buildCashFlows(cfs, { effectiveDate: '2026-01-01' });
    expect(out.yearly).toHaveLength(2);
    expect(out.yearly[0].net).toBe(10); // 1+2+3+4
    expect(out.yearly[1].net).toBe(11); // 5+6
  });

  it('yearly.period spans the first and last quarters of its bucket', () => {
    const cfs = [0, 0, 0, 0, 0];
    const out = buildCashFlows(cfs, { effectiveDate: '2026-01-01' });
    expect(out.yearly[0].startDate).toBe('2026-01-01'); // Q1 start
    expect(out.yearly[0].endDate).toBe('2026-12-31'); // Q4 end
    expect(out.yearly[0].period).toBe('2026-01-01 to 2026-12-31');
  });

  it('summary.totalInflow sums positives only, 2dp', () => {
    const out = buildCashFlows([-100, 25.5, -10, 50.123], {
      effectiveDate: '2026-01-01',
    });
    expect(out.summary.totalInflow).toBe(75.62); // round2(25.5 + 50.123)
  });

  it('summary.totalOutflow is |sum(negatives)|, 2dp', () => {
    const out = buildCashFlows([-100.5, 25, -10.2, 50], {
      effectiveDate: '2026-01-01',
    });
    expect(out.summary.totalOutflow).toBe(110.7); // round2(|−110.7|)
  });

  it('zero-length input returns empty bundle with zeroed summary', () => {
    const out = buildCashFlows([], {});
    expect(out.quarterly).toEqual([]);
    expect(out.yearly).toEqual([]);
    expect(out.summary).toEqual({ totalInflow: 0, totalOutflow: 0 });
  });

  it('defaults to today UTC when no effective date provided', () => {
    const out = buildCashFlows([-100, 10], {});
    // Can't assert exact date, but structure must be valid
    expect(out.quarterly[0].startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('leap year: Q1 ending on Feb 29', () => {
    const out = buildCashFlows([0, 0], { effectiveDate: '2028-12-01' });
    // Q1 spans 2028-12-01 to 2029-03-01 − 1 day = 2029-02-28
    // (2029 is not a leap year)
    expect(out.quarterly[1].endDate).toBe('2029-02-28');
  });

  it('leap year boundary: Q1 ending in Feb of a leap year', () => {
    const out = buildCashFlows([0, 0], { effectiveDate: '2027-12-01' });
    // Q1 spans 2027-12-01 to 2028-03-01 − 1 day = 2028-02-29 (2028 is a leap year)
    expect(out.quarterly[1].endDate).toBe('2028-02-29');
  });
});
