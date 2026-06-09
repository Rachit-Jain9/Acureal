import { describe, it, expect } from 'vitest';
import {
  inferAmountKind,
  groupIndian,
  formatAmountScale,
  describeAmount,
} from '../format';

describe('inferAmountKind', () => {
  it('classifies ₹ Cr fields as rupeeCrore', () => {
    expect(inferAmountKind('Land Cost (₹ Cr)')).toBe('rupeeCrore');
    expect(inferAmountKind('Forward Purchase Price (₹ Cr)')).toBe('rupeeCrore');
    expect(inferAmountKind('Negotiated price (₹ Cr)')).toBe('rupeeCrore');
  });

  it('classifies ₹/… rate fields as rupeePlain (before the area branch)', () => {
    expect(inferAmountKind('Selling Rate (₹/sqft)')).toBe('rupeePlain');
    expect(inferAmountKind('Approval Cost (₹/sqft GFA)')).toBe('rupeePlain');
    expect(inferAmountKind('Construction Cost (₹/key)')).toBe('rupeePlain');
    expect(inferAmountKind('Average Daily Rate (₹/night)')).toBe('rupeePlain');
    // contains "month" but must still be a rupee rate, not "none"
    expect(inferAmountKind('Base Rent (₹/sqft/month)')).toBe('rupeePlain');
  });

  it('classifies bare sqft area fields as count', () => {
    expect(inferAmountKind('Plot Area (sqft)')).toBe('count');
    expect(inferAmountKind('Avg Unit Size (saleable sqft)')).toBe('count');
    expect(inferAmountKind('Total Land Area (sqft)')).toBe('count');
  });

  it('classifies ratios, percentages, durations and counts as none', () => {
    expect(inferAmountKind('Debt LTV (0–1)')).toBe('none');
    expect(inferAmountKind('GST on Construction (%)')).toBe('none');
    expect(inferAmountKind('Hold Period (years)')).toBe('none');
    expect(inferAmountKind('Construction Start (months)')).toBe('none');
    expect(inferAmountKind('Exit Cap Rate (%)')).toBe('none');
    expect(inferAmountKind('Number of Keys (rooms)')).toBe('none');
    expect(inferAmountKind('FSI / FAR')).toBe('none');
    expect(inferAmountKind('Exit Multiple (× stabilized NOI)')).toBe('none');
  });

  it('returns none for non-string input', () => {
    expect(inferAmountKind(undefined)).toBe('none');
    expect(inferAmountKind(null)).toBe('none');
    expect(inferAmountKind(123)).toBe('none');
  });
});

describe('groupIndian', () => {
  it('groups with the Indian 2-2-3 convention', () => {
    expect(groupIndian(53567890)).toBe('5,35,67,890');
    expect(groupIndian(200000)).toBe('2,00,000');
    expect(groupIndian(8000)).toBe('8,000');
  });

  it('keeps decimals when asked', () => {
    expect(groupIndian(25.5, 2)).toBe('25.5');
  });

  it('returns "" for non-finite input', () => {
    expect(groupIndian(NaN)).toBe('');
    expect(groupIndian(Infinity)).toBe('');
    expect(groupIndian('abc')).toBe('');
  });
});

describe('formatAmountScale', () => {
  it('formats each fixed scale unit', () => {
    expect(formatAmountScale(25.5, 'cr')).toBe('₹25.50 Cr');
    expect(formatAmountScale(53567890, 'crINR')).toBe('₹5.36 Cr');
    expect(formatAmountScale(8000000, 'lakhINR')).toBe('₹80.00 L');
    expect(formatAmountScale(8000, 'plainINR')).toBe('₹8,000');
    expect(formatAmountScale(20000000, 'crCount')).toBe('2.00 Cr');
    expect(formatAmountScale(200000, 'lakhCount')).toBe('2.00 Lakh');
  });

  it('returns "" for no scale unit or non-finite value', () => {
    expect(formatAmountScale(123, null)).toBe('');
    expect(formatAmountScale(NaN, 'cr')).toBe('');
  });
});

describe('describeAmount', () => {
  it('rupeeCrore: shows the ₹ Cr figure, animatable, no grouped echo', () => {
    expect(describeAmount('25.5', 'rupeeCrore')).toEqual({
      grouped: null, compact: '₹25.50 Cr', scaleValue: 25.5, scaleUnit: 'cr',
    });
    // a fat-finger 2550 stands out loudly
    expect(describeAmount('2550', 'rupeeCrore').compact).toBe('₹2,550.00 Cr');
  });

  it('rupeePlain ≥ ₹1 Cr: grouped digits + ₹ Cr compact', () => {
    expect(describeAmount('53567890', 'rupeePlain')).toEqual({
      grouped: '5,35,67,890', compact: '₹5.36 Cr', scaleValue: 53567890, scaleUnit: 'crINR',
    });
  });

  it('rupeePlain ≥ ₹1 L: grouped digits + ₹ L compact (e.g. ₹/key)', () => {
    expect(describeAmount('8000000', 'rupeePlain')).toEqual({
      grouped: '80,00,000', compact: '₹80.00 L', scaleValue: 8000000, scaleUnit: 'lakhINR',
    });
  });

  it('rupeePlain < ₹1 L: single ₹ figure, no redundant grouped echo', () => {
    expect(describeAmount('8000', 'rupeePlain')).toEqual({
      grouped: null, compact: '₹8,000', scaleValue: 8000, scaleUnit: 'plainINR',
    });
  });

  it('count: grouped digits + trimmed lakh/crore gloss, no animation', () => {
    expect(describeAmount('200000', 'count')).toEqual({
      grouped: '2,00,000', compact: '2 Lakh', scaleValue: null, scaleUnit: null,
    });
    expect(describeAmount('20000000', 'count')).toEqual({
      grouped: '2,00,00,000', compact: '2 Cr', scaleValue: null, scaleUnit: null,
    });
    expect(describeAmount('50000', 'count')).toEqual({
      grouped: '50,000', compact: null, scaleValue: null, scaleUnit: null,
    });
  });

  it('respects thresholds (≥1000 for plain/count, >0 for crore)', () => {
    expect(describeAmount('999', 'rupeePlain')).toBeNull();
    expect(describeAmount('500', 'count')).toBeNull();
    expect(describeAmount('0.0001', 'rupeeCrore')).not.toBeNull();
  });

  it('returns null for empty / zero / negative / NaN / kind none', () => {
    expect(describeAmount('', 'rupeeCrore')).toBeNull();
    expect(describeAmount(null, 'rupeePlain')).toBeNull();
    expect(describeAmount('0', 'rupeePlain')).toBeNull();
    expect(describeAmount('-5', 'rupeeCrore')).toBeNull();
    expect(describeAmount('abc', 'count')).toBeNull();
    expect(describeAmount('53567890', 'none')).toBeNull();
  });
});
