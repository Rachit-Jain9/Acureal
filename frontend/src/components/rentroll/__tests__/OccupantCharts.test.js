import { describe, it, expect } from 'vitest';
import { formatObligationTooltip, formatAreaTooltip } from '../OccupantCharts';

// The occupant charts are single-series bars, so their tooltip formatters shape
// the VALUE only and never branch on a Recharts series name — the opposite of
// the multi-series trap that bit the hotel charts. Locking that here keeps the
// contract explicit: if a future edit adds a second series, these tests force a
// deliberate rewrite rather than a silent collapse onto a fallback label.

describe('formatObligationTooltip (rehousing-obligation bars)', () => {
  it('formats a crore-scale amount with Indian grouping', () => {
    expect(formatObligationTooltip(9465000)).toEqual(['₹94.65 L', '']);
    expect(formatObligationTooltip(12300000)).toEqual(['₹1.23 Cr', '']);
  });

  it('formats a small amount as plain rupees', () => {
    expect(formatObligationTooltip(40000)).toEqual(['₹40,000', '']);
  });
});

describe('formatAreaTooltip (rehab-area bars)', () => {
  it('formats an area in sqft with Indian grouping', () => {
    expect(formatAreaTooltip(1650)).toEqual(['1,650 sqft', '']);
    expect(formatAreaTooltip(1880.4)).toEqual(['1,880 sqft', '']);
  });
});
