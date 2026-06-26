'use strict';

// Deterministic comp-provenance deriver (CLAUDE.md hard rule: surface source +
// freshness + confidence honestly, or "No verified feed available"). These tests
// pin the category buckets, the honest verified mapping (null is NEVER verified),
// and the freshness preference order (as_of_date > data_type period > updated_at).

const {
  deriveCompProvenance,
  formatProvenanceLine,
  extractPeriodToken,
} = require('../src/utils/compProvenance');

describe('deriveCompProvenance — source-type from data_type (authoritative)', () => {
  test.each([
    ['ipc_q1_2026_v0_2_premium_project', 'research', 'Research report'],
    ['internal_benchmark_apr_2026', 'internal', 'Internal benchmark'],
    ['listing_magicbricks_2026', 'listing', 'Listing'],
    ['transaction_registry', 'transaction', 'Transaction'],
    ['guidance_sro_2026', 'guidance', 'Guidance value'],
  ])('data_type %s → %s', (dataType, key, label) => {
    const p = deriveCompProvenance({ data_type: dataType, is_verified: true });
    expect(p.sourceType).toBe(key);
    expect(p.sourceTypeLabel).toBe(label);
  });
});

describe('deriveCompProvenance — source-type from free-text source (fallback)', () => {
  test.each([
    ['Sale deed, Kaveri SRO Whitefield', 'transaction'],
    ['JLL Bengaluru Residential Report Q1 2026', 'research'],
    ['MagicBricks listing', 'listing'],
    ['REDIP internal desk benchmark', 'internal'],
    ['IGR guidance value notification', 'guidance'],
    ['some random note', 'other'],
  ])('source "%s" → %s', (source, key) => {
    expect(deriveCompProvenance({ source }).sourceType).toBe(key);
  });

  test('data_type wins over source when both present', () => {
    const p = deriveCompProvenance({ data_type: 'ipc_q1_2026', source: 'MagicBricks listing' });
    expect(p.sourceType).toBe('research'); // data_type ipc beats the listing keyword
  });

  test('no data_type and no source → none / "No verified feed"', () => {
    const p = deriveCompProvenance({});
    expect(p.sourceType).toBe('none');
    expect(p.sourceTypeLabel).toBe('No verified feed');
  });
});

describe('deriveCompProvenance — verified mapping is honest (null is NOT verified)', () => {
  test('is_verified === true → Verified', () => {
    expect(deriveCompProvenance({ is_verified: true }).verifiedLabel).toBe('Verified');
    expect(deriveCompProvenance({ is_verified: true }).verified).toBe(true);
  });
  test('is_verified === false → Unverified', () => {
    expect(deriveCompProvenance({ is_verified: false }).verifiedLabel).toBe('Unverified');
  });
  test('is_verified null/undefined → Unverified (the overclaim this fixes)', () => {
    expect(deriveCompProvenance({ is_verified: null }).verified).toBe(false);
    expect(deriveCompProvenance({}).verifiedLabel).toBe('Unverified');
    // truthiness traps: a stray non-boolean must never read as verified
    expect(deriveCompProvenance({ is_verified: 'yes' }).verified).toBe(false);
    expect(deriveCompProvenance({ is_verified: 1 }).verified).toBe(false);
  });
});

describe('deriveCompProvenance — freshness preference (as_of_date wins)', () => {
  test('as_of_date is preferred and labelled "as of <date>"', () => {
    const p = deriveCompProvenance({ as_of_date: '2026-05-04', data_type: 'ipc_q1_2026', updated_at: '2026-06-01T00:00:00Z' });
    expect(p.freshnessKind).toBe('as_of');
    expect(p.freshnessLabel).toBe('as of 4 May 2026');
  });
  test('falls back to the data_type period when no as_of_date', () => {
    const p = deriveCompProvenance({ data_type: 'ipc_q1_2026_v0_2', updated_at: '2026-06-01T00:00:00Z' });
    expect(p.freshnessKind).toBe('period');
    expect(p.freshnessLabel).toBe('Q1 2026');
  });
  test('falls back to updated_at last, labelled "updated <date>" (never "verified")', () => {
    const p = deriveCompProvenance({ source: 'broker note', updated_at: '2026-06-01T00:00:00Z' });
    expect(p.freshnessKind).toBe('updated');
    expect(p.freshnessLabel).toBe('updated 1 Jun 2026');
    expect(p.freshnessLabel).not.toMatch(/verified/i);
  });
  test('no date anywhere → null freshness', () => {
    expect(deriveCompProvenance({ source: 'x' }).freshnessLabel).toBeNull();
  });
});

describe('extractPeriodToken', () => {
  test.each([
    ['ipc_q1_2026_v0_2_premium_project', 'Q1 2026'],
    ['internal_benchmark_apr_2026', 'Apr 2026'],
    ['something_q4-2025', 'Q4 2025'],
    ['no_period_here', null],
  ])('%s → %s', (input, expected) => {
    expect(extractPeriodToken(input)).toBe(expected);
  });
});

describe('formatProvenanceLine — compact export line', () => {
  test('full triad', () => {
    const line = formatProvenanceLine({ data_type: 'ipc_q1_2026', is_verified: true, as_of_date: '2026-05-04' });
    expect(line).toBe('Research report · Verified · as of 4 May 2026');
  });
  test('unverified listing with no date', () => {
    expect(formatProvenanceLine({ source: 'MagicBricks listing', is_verified: false }))
      .toBe('Listing · Unverified');
  });
  test('genuinely unsourced → honest unavailable', () => {
    expect(formatProvenanceLine({})).toBe('No verified feed available');
  });
});
