import { describe, it, expect } from 'vitest';
import { formatTradeTooltip, formatRevenueMixTooltip } from '../HotelCharts';

// Regression guard for the dataKey-vs-name trap: a Recharts <Tooltip> formatter
// is called with the series `name` prop, not the dataKey. Keying on the
// lowercase dataKey collapsed every revenue series onto "Other" and rendered
// GOP margin as ₹ instead of %. These formatters MUST branch on the label each
// series is given in HotelCharts.jsx (name="Room" / "F&B" / "Other" /
// "GOP margin"; name="ADR" / "Occupancy").

describe('formatTradeTooltip (ADR bars + occupancy line)', () => {
  it('formats occupancy as a percentage', () => {
    expect(formatTradeTooltip(60, 'Occupancy')).toEqual(['60.0%', 'Occupancy']);
    expect(formatTradeTooltip(70.16, 'Occupancy')).toEqual(['70.2%', 'Occupancy']);
  });

  it('formats ADR as rupees with Indian grouping', () => {
    expect(formatTradeTooltip(6000, 'ADR')).toEqual(['₹6,000', 'ADR']);
  });
});

describe('formatRevenueMixTooltip (stacked revenue + GOP-margin line)', () => {
  it('labels each revenue series by its own name, not a fallback', () => {
    // These are the four names the series carry in HotelCharts.jsx.
    expect(formatRevenueMixTooltip(10800000, 'Room')).toEqual(['₹1,08,00,000', 'Room']);
    expect(formatRevenueMixTooltip(2700000, 'F&B')).toEqual(['₹27,00,000', 'F&B']);
    expect(formatRevenueMixTooltip(1080000, 'Other')).toEqual(['₹10,80,000', 'Other']);
  });

  it('formats GOP margin as a percentage, never as currency', () => {
    const [formatted, label] = formatRevenueMixTooltip(34.3, 'GOP margin');
    expect(label).toBe('GOP margin');
    expect(formatted).toBe('34.3%');
    expect(formatted).not.toContain('₹');
  });

  it('never collapses a revenue series onto a hardcoded fallback label', () => {
    // If a future edit reverts to keying on the dataKey, every branch would
    // return the same fallback — assert the labels stay distinct.
    const room = formatRevenueMixTooltip(1, 'Room')[1];
    const fnb = formatRevenueMixTooltip(1, 'F&B')[1];
    const other = formatRevenueMixTooltip(1, 'Other')[1];
    expect(new Set([room, fnb, other]).size).toBe(3);
  });
});
