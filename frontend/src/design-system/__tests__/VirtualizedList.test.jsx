import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import VirtualizedList from '../VirtualizedList';

// Stub `useVirtualizer` so we don't need a real DOM with measured heights.
// The hook still has to be called (rules-of-hooks), but its returned items
// are only consumed in the virtualized branch.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    measureElement: () => {},
  }),
}));

describe('VirtualizedList', () => {
  it('renders the empty state when items is empty', () => {
    render(
      <VirtualizedList items={[]} emptyState={<div>No items.</div>}>
        {(x) => <div>{x}</div>}
      </VirtualizedList>,
    );
    expect(screen.getByText('No items.')).toBeInTheDocument();
  });

  it('renders inline (non-virtualized) below threshold', () => {
    const items = ['a', 'b', 'c'];
    render(
      <VirtualizedList items={items} threshold={100}>
        {(x) => <div data-testid="row">{x}</div>}
      </VirtualizedList>,
    );
    expect(screen.getAllByTestId('row')).toHaveLength(3);
  });

  it('switches to windowed mode at/above threshold', () => {
    const items = Array.from({ length: 150 }, (_, i) => `r-${i}`);
    const { container } = render(
      <VirtualizedList items={items} threshold={100}>
        {(x) => <div>{x}</div>}
      </VirtualizedList>,
    );
    // The windowed branch wraps in a relative-positioned scroll container.
    // Mocked virtualizer returns 0 items so no rows render, but the role=list
    // wrapper is the signal we're in the windowed code path.
    expect(container.querySelector('[role="list"]')).toBeInTheDocument();
  });

  it('default threshold is 100 — 99-item list renders inline', () => {
    const items = Array.from({ length: 99 }, (_, i) => `r-${i}`);
    render(
      <VirtualizedList items={items}>
        {(x) => <div data-testid="row">{x}</div>}
      </VirtualizedList>,
    );
    expect(screen.getAllByTestId('row')).toHaveLength(99);
  });
});
