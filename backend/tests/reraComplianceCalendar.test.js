'use strict';

/**
 * Unit tests for rera/complianceCalendar — the deterministic post-registration
 * due schedule. Pure; a fixed `now` makes every assertion stable.
 */

const cal = require('../src/services/rera/complianceCalendar');

const compose = (ctx, opts) => cal.composeComplianceCalendar(ctx, opts);

describe('composeComplianceCalendar — scope', () => {
  test('not registered + in_scope → preview (cadence only, no live items)', () => {
    const out = compose({ reraNumber: null }, { applicabilityStatus: 'in_scope' });
    expect(out.applicable).toBe(true);
    expect(out.registered).toBe(false);
    expect(out.status).toBe('preview');
    expect(out.items).toEqual([]);
    expect(out.note).toMatch(/registered/i);
  });

  test('not registered + exempt → not applicable', () => {
    const out = compose({ reraNumber: null }, { applicabilityStatus: 'likely_exempt' });
    expect(out.applicable).toBe(false);
    expect(out.status).toBe('not_applicable');
  });
});

describe('composeComplianceCalendar — active (registered)', () => {
  const NOW = new Date('2026-06-04T00:00:00Z');

  test('produces a forward-looking schedule with quarterly + annual + completion', () => {
    const out = compose(
      { reraNumber: 'PRM/KA/RERA/1251/446/PR/0001', completionDate: '2027-12-31' },
      { applicabilityStatus: 'in_scope', now: NOW },
    );
    expect(out.status).toBe('active');
    expect(out.registered).toBe(true);
    const kinds = out.items.map((i) => i.kind);
    expect(kinds).toContain('quarterly');
    expect(kinds).toContain('annual');
    expect(kinds).toContain('extension');
    // First quarterly after 2026-06-04 is the quarter ending 2026-06-30 → due 2026-07-15.
    const firstQpr = out.items.find((i) => i.kind === 'quarterly');
    expect(firstQpr.due_date).toBe('2026-07-15');
    expect(firstQpr.days_until).toBe(41);
  });

  test('HONESTY: quarterly + annual items are NEVER marked overdue (no filing data)', () => {
    // Use a `now` just after a quarter-end so a deadline has recently passed.
    const out = compose(
      { reraNumber: 'X' },
      { now: new Date('2026-07-20T00:00:00Z') }, // past Jul 15
    );
    for (const it of out.items) {
      if (it.kind === 'quarterly' || it.kind === 'annual') {
        expect(it.status).not.toBe('overdue');
        expect(it.days_until).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('declared completion in the PAST → overdue (the deal\'s own date)', () => {
    const out = compose(
      { reraNumber: 'X', completionDate: '2025-01-01' },
      { now: NOW },
    );
    const completion = out.items.find((i) => i.kind === 'extension');
    expect(completion.status).toBe('overdue');
    expect(completion.days_until).toBeLessThan(0);
  });

  test('a deadline within 30 days → due_soon', () => {
    const out = compose({ reraNumber: 'X' }, { now: new Date('2026-07-05T00:00:00Z') });
    const firstQpr = out.items.find((i) => i.kind === 'quarterly');
    expect(firstQpr.due_date).toBe('2026-07-15');
    expect(firstQpr.status).toBe('due_soon');
  });

  test('certificate expiry anchor is included when present', () => {
    const out = compose({ reraNumber: 'X', reraExpiryDate: '2028-03-31' }, { now: NOW });
    expect(out.items.some((i) => i.kind === 'validity' && i.due_date === '2028-03-31')).toBe(true);
  });
});

describe('quarterlyDeadlinesFrom', () => {
  test('returns deadlines on/after today, sorted, of the requested count', () => {
    const today = new Date(Date.UTC(2026, 5, 4)); // 2026-06-04
    const ds = cal.quarterlyDeadlinesFrom(today, 3);
    expect(ds).toHaveLength(3);
    expect(ds.map((d) => `${d.due.getUTCFullYear()}-${String(d.due.getUTCMonth() + 1).padStart(2, '0')}-${String(d.due.getUTCDate()).padStart(2, '0')}`))
      .toEqual(['2026-07-15', '2026-10-15', '2027-01-15']);
  });
});
