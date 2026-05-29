import { describe, it, expect } from 'vitest';
import { formatCrores, formatCroresOrDash } from '../format';

describe('formatCrores', () => {
  it('formats a positive number to ₹X.XX Cr', () => {
    expect(formatCrores(18)).toBe('₹18.00 Cr');
    expect(formatCrores(442.04)).toBe('₹442.04 Cr');
  });

  it('renders 0 as ₹0.00 Cr — correct for cost/revenue fields where 0 is real', () => {
    expect(formatCrores(0)).toBe('₹0.00 Cr');
    // The Postgres NUMERIC-as-string case that caused the ASK PRICE bug:
    expect(formatCrores('0.00')).toBe('₹0.00 Cr');
  });

  it('returns "-" for null / undefined / NaN', () => {
    expect(formatCrores(null)).toBe('-');
    expect(formatCrores(undefined)).toBe('-');
    expect(formatCrores('abc')).toBe('-');
  });
});

describe('formatCroresOrDash (price fields)', () => {
  it('formats a positive price', () => {
    expect(formatCroresOrDash(18)).toBe('₹18.00 Cr');
    expect(formatCroresOrDash('85.00')).toBe('₹85.00 Cr');
  });

  it('returns "-" for an unset price — including the pg NUMERIC-as-string "0.00"', () => {
    // This is the ASK PRICE bug: a deal with no ask price stored 0 / "0.00"
    // used to render "₹0.00 Cr" (implying the land is free) instead of "-".
    expect(formatCroresOrDash(0)).toBe('-');
    expect(formatCroresOrDash('0.00')).toBe('-');
    expect(formatCroresOrDash('0')).toBe('-');
  });

  it('returns "-" for null / undefined / NaN', () => {
    expect(formatCroresOrDash(null)).toBe('-');
    expect(formatCroresOrDash(undefined)).toBe('-');
    expect(formatCroresOrDash('')).toBe('-');
    expect(formatCroresOrDash('abc')).toBe('-');
  });

  it('returns "-" for negative values (not a valid acquisition price)', () => {
    expect(formatCroresOrDash(-5)).toBe('-');
  });
});
