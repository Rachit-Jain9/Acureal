import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Skeleton,
  SkeletonLine,
  SkeletonHeading,
  SkeletonKpi,
  SkeletonCard,
  SkeletonTableRow,
  SkeletonList,
} from '../Skeleton';

describe('Skeleton (base)', () => {
  it('is decorative by default (presentation + aria-hidden) so a cluster keeps one status landmark', () => {
    render(<Skeleton data-testid="s" />);
    const el = screen.getByTestId('s');
    expect(el.className).toMatch(/redip-skeleton/);
    expect(el).toHaveAttribute('role', 'presentation');
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el).not.toHaveAttribute('aria-busy');
  });

  it('opts into a status landmark when role="status" (standalone loading indicator)', () => {
    render(<Skeleton data-testid="s" role="status" ariaLabel="Loading widget" />);
    const el = screen.getByTestId('s');
    expect(el).toHaveAttribute('role', 'status');
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(el).toHaveAttribute('aria-label', 'Loading widget');
    expect(el).not.toHaveAttribute('aria-hidden');
  });

  it('forwards className overrides', () => {
    render(<Skeleton data-testid="s" className="h-20 w-32 rounded-full" />);
    expect(screen.getByTestId('s').className).toMatch(/h-20/);
    expect(screen.getByTestId('s').className).toMatch(/w-32/);
    expect(screen.getByTestId('s').className).toMatch(/rounded-full/);
  });
});

describe('SkeletonLine + SkeletonHeading', () => {
  it('SkeletonLine accepts a width override', () => {
    const { container } = render(<SkeletonLine width="w-1/3" />);
    const el = container.querySelector('.redip-skeleton');
    expect(el.className).toMatch(/w-1\/3/);
  });

  it('SkeletonHeading is taller than a line', () => {
    const { container } = render(<SkeletonHeading />);
    const el = container.querySelector('.redip-skeleton');
    expect(el.className).toMatch(/h-7/);
  });
});

describe('SkeletonKpi', () => {
  it('renders the metric-tile chrome with three internal skeletons', () => {
    const { container } = render(<SkeletonKpi />);
    // Outer wrapper is the role=status node.
    const wrappers = container.querySelectorAll('[role="status"]');
    expect(wrappers.length).toBeGreaterThanOrEqual(1);
    // 3 inner skeleton bars (label, value, footnote).
    const inner = container.querySelectorAll('.redip-skeleton');
    expect(inner.length).toBe(3);
  });

  it('mimics MetricTile chrome (elevated card)', () => {
    const { container } = render(<SkeletonKpi />);
    const wrapper = container.querySelector('[role="status"]');
    expect(wrapper.className).toMatch(/bg-bg-elevated/);
    expect(wrapper.className).toMatch(/rounded-editorial/);
    expect(wrapper.className).toMatch(/shadow-editorial/);
  });
});

describe('SkeletonCard', () => {
  it('honors the height + titleWidth props', () => {
    const { container } = render(<SkeletonCard height="h-40" titleWidth="w-1/4" />);
    const skeletons = container.querySelectorAll('.redip-skeleton');
    expect(skeletons[0].className).toMatch(/w-1\/4/);
    expect(skeletons[1].className).toMatch(/h-40/);
  });
});

describe('SkeletonTableRow + SkeletonList', () => {
  it('renders the requested column count', () => {
    const { container } = render(<SkeletonTableRow columns={5} />);
    expect(container.querySelectorAll('.redip-skeleton').length).toBe(5);
  });

  it('SkeletonList renders rows × columns skeletons', () => {
    const { container } = render(<SkeletonList rows={3} columns={4} />);
    expect(container.querySelectorAll('.redip-skeleton').length).toBe(12);
  });
});
