import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollapsibleCard } from '../CollapsibleCard';

// Reset localStorage between tests so persistence doesn't leak.
beforeEach(() => {
  window.localStorage.clear();
});

describe('CollapsibleCard', () => {
  it('renders title and content when defaultExpanded', () => {
    render(
      <CollapsibleCard title="Financial Summary" defaultExpanded>
        <p>BODY</p>
      </CollapsibleCard>,
    );
    expect(screen.getByText('Financial Summary')).toBeInTheDocument();
    expect(screen.getByText('BODY')).toBeInTheDocument();
  });

  it('hides body when defaultExpanded=false', () => {
    render(
      <CollapsibleCard title="Stage History" defaultExpanded={false}>
        <p>BODY</p>
      </CollapsibleCard>,
    );
    expect(screen.queryByText('BODY')).not.toBeInTheDocument();
  });

  it('clicking the header toggles expanded state', () => {
    render(
      <CollapsibleCard title="Recent Activities" defaultExpanded={false}>
        <p>BODY</p>
      </CollapsibleCard>,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('BODY')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { expanded: true }));
    expect(screen.queryByText('BODY')).not.toBeInTheDocument();
  });

  it('persists expand state to localStorage when id is provided', () => {
    const { unmount } = render(
      <CollapsibleCard id="test-section" title="Notes" defaultExpanded={false}>
        <p>BODY</p>
      </CollapsibleCard>,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(window.localStorage.getItem('redip.ui.collapse.test-section')).toBe('1');
    unmount();

    // Remount — should read the persisted value, not the default.
    render(
      <CollapsibleCard id="test-section" title="Notes" defaultExpanded={false}>
        <p>BODY</p>
      </CollapsibleCard>,
    );
    expect(screen.getByText('BODY')).toBeInTheDocument();
  });

  it('forceExpanded hides the toggle and shows content', () => {
    render(
      <CollapsibleCard title="Always" forceExpanded>
        <p>BODY</p>
      </CollapsibleCard>,
    );
    expect(screen.getByText('BODY')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders meta in both expanded + collapsed states', () => {
    render(
      <CollapsibleCard
        title="History"
        meta={<span>3 transitions</span>}
        defaultExpanded={false}
      >
        <p>BODY</p>
      </CollapsibleCard>,
    );
    // meta visible while collapsed
    expect(screen.getByText('3 transitions')).toBeInTheDocument();
    // expand and confirm meta still visible
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('3 transitions')).toBeInTheDocument();
  });
});
