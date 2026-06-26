import { describe, it, expect } from 'vitest';
import { deriveCompProvenance, extractPeriodToken } from '../compProvenance';

// Frontend twin of backend/tests/compProvenance.test.js — the bucket logic MUST
// stay equivalent so a comp reads identically in-app and in exports.

describe('deriveCompProvenance — source-type', () => {
  it.each([
    ['ipc_q1_2026_v0_2_premium_project', 'research', 'Research report'],
    ['internal_benchmark_apr_2026', 'internal', 'Internal benchmark'],
    ['listing_magicbricks_2026', 'listing', 'Listing'],
    ['transaction_registry', 'transaction', 'Transaction'],
    ['guidance_sro_2026', 'guidance', 'Guidance value'],
  ])('data_type %s → %s', (dataType, key, label) => {
    const p = deriveCompProvenance({ data_type: dataType });
    expect(p.sourceType).toBe(key);
    expect(p.sourceTypeLabel).toBe(label);
  });

  it('falls back to free-text source keywords', () => {
    expect(deriveCompProvenance({ source: 'Sale deed, Kaveri SRO' }).sourceType).toBe('transaction');
    expect(deriveCompProvenance({ source: 'JLL report' }).sourceType).toBe('research');
    expect(deriveCompProvenance({ source: 'MagicBricks listing' }).sourceType).toBe('listing');
    expect(deriveCompProvenance({ source: 'random' }).sourceType).toBe('other');
  });

  it('no data_type and no source → none / "No verified feed"', () => {
    const p = deriveCompProvenance({});
    expect(p.sourceType).toBe('none');
    expect(p.sourceTypeLabel).toBe('No verified feed');
  });
});

describe('deriveCompProvenance — verified is honest (null is NOT verified)', () => {
  it('only is_verified===true earns Verified', () => {
    expect(deriveCompProvenance({ is_verified: true }).verifiedLabel).toBe('Verified');
    expect(deriveCompProvenance({ is_verified: false }).verifiedLabel).toBe('Unverified');
    expect(deriveCompProvenance({}).verified).toBe(false);
    expect(deriveCompProvenance({ is_verified: 'yes' }).verified).toBe(false);
  });
});

describe('deriveCompProvenance — freshness preference', () => {
  it('prefers as_of_date as "as of <date>"', () => {
    expect(deriveCompProvenance({ as_of_date: '2026-05-04' }).freshnessLabel).toBe('as of 4 May 2026');
  });
  it('then the data_type period, then updated_at', () => {
    expect(deriveCompProvenance({ data_type: 'ipc_q1_2026' }).freshnessLabel).toBe('Q1 2026');
    expect(deriveCompProvenance({ updated_at: '2026-06-01T00:00:00Z' }).freshnessLabel).toBe('updated 1 Jun 2026');
  });
  it('never labels freshness "verified"', () => {
    expect(deriveCompProvenance({ updated_at: '2026-06-01T00:00:00Z' }).freshnessLabel).not.toMatch(/verified/i);
  });
});

describe('extractPeriodToken', () => {
  it.each([
    ['ipc_q1_2026_v0_2_premium_project', 'Q1 2026'],
    ['internal_benchmark_apr_2026', 'Apr 2026'],
    ['no_period', null],
  ])('%s → %s', (input, expected) => {
    expect(extractPeriodToken(input)).toBe(expected);
  });
});
