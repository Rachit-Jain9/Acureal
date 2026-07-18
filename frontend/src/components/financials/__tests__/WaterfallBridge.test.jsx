import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { calculateJVWaterfall, calculateJDAWaterfall } from '../../../utils/waterfall';
import WaterfallBridge, { jvSegments, jdaSegments } from '../WaterfallBridge';

// The normalizers are the only place with logic — they RE-KEY the kernel's own
// numbers into { label, amountCr, parts }. They must never invent a value, and
// the floating bars must always tie out to the closing total.

describe('jvSegments', () => {
  const result = calculateJVWaterfall({
    totalRevenueCr: 200, totalCostCr: 120,
    landownerEquityCr: 40, developerEquityCr: 40,
    developerPromotePct: 20, promoteThresholdMultiple: 1.2,
  });

  it('starts with the soft Return-of-Capital base and ends with a closing Total bar', () => {
    const segs = jvSegments(result);
    expect(segs[0].label).toBe('Return of Capital');
    expect(segs[0].soft).toBe(true);
    expect(segs[segs.length - 1].isTotal).toBe(true);
  });

  it('the floating bars tie out to the total (cumulative is conserved)', () => {
    const segs = jvSegments(result);
    const nonTotal = segs.filter((s) => !s.isTotal);
    const sum = nonTotal.reduce((a, s) => a + s.amountCr, 0);
    const total = segs.find((s) => s.isTotal).amountCr;
    expect(Math.abs(sum - total)).toBeLessThan(0.05);
  });

  it('each segment’s parts sum to its own amount (no invented money)', () => {
    for (const s of jvSegments(result)) {
      const partsSum = s.parts.reduce((a, pt) => a + pt.cr, 0);
      expect(Math.abs(partsSum - s.amountCr)).toBeLessThan(0.05);
    }
  });

  it('returns [] for an empty / null result', () => {
    expect(jvSegments(null)).toEqual([]);
    expect(jvSegments({})).toEqual([]);
  });
});

describe('jdaSegments', () => {
  it('splits revenue into landowner → costs → developer profit → total, tying out', () => {
    const r = calculateJDAWaterfall({ totalRevenueCr: 100, totalConstructionCostCr: 40, landownerSharePct: 40 });
    const segs = jdaSegments(r);
    expect(segs.map((s) => s.label)).toEqual(['Landowner', 'Dev costs', 'Dev profit', 'Total revenue']);
    expect(segs[segs.length - 1].isTotal).toBe(true);
    const sum = segs.filter((s) => !s.isTotal).reduce((a, s) => a + s.amountCr, 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.05);
  });

  it('falls back to table-only ([]) when the developer takes a loss', () => {
    const r = calculateJDAWaterfall({ totalRevenueCr: 100, totalConstructionCostCr: 90, landownerSharePct: 40 });
    expect(jdaSegments(r)).toEqual([]);
  });
});

describe('WaterfallBridge component', () => {
  it('renders a labelled bar per segment + a legend', () => {
    const segs = jvSegments(calculateJVWaterfall({
      totalRevenueCr: 200, totalCostCr: 120, landownerEquityCr: 40, developerEquityCr: 40,
      developerPromotePct: 20, promoteThresholdMultiple: 1.2,
    }));
    render(<WaterfallBridge segments={segs} />);
    expect(screen.getByText('Return of Capital')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    // legend tones present
    expect(screen.getByText('Landowner')).toBeInTheDocument();
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });

  it('renders nothing when there are no segments', () => {
    const { container } = render(<WaterfallBridge segments={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
