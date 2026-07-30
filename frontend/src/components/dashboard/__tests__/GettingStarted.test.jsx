import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GettingStarted from '../GettingStarted';

// GettingStarted is presentational now — it renders the live checklist it's
// handed (built in utils/setupChecklist.js, unit-tested separately) with ticks,
// CTAs on undone steps, a progress ring, compact + celebratory variants.

const ITEMS = [
  { id: 'create-deal', label: 'Create your first deal', hint: 'Start with anything.', done: false, to: '/dashboard/deals?new=1', cta: 'New deal' },
  { id: 'explore-intel', label: 'Scan Market Intelligence', hint: 'City benchmarks.', done: true, to: '/dashboard/intelligence', cta: 'Open' },
];

function renderPanel(props = {}) {
  return render(
    <MemoryRouter>
      <GettingStarted userName="Test User" items={ITEMS} onDismiss={() => {}} {...props} />
    </MemoryRouter>,
  );
}

describe('GettingStarted checklist', () => {
  it('greets the user by first name only', () => {
    renderPanel({ userName: 'Rachit Jain' });
    expect(screen.getByText('Welcome to Acureal, Rachit.')).toBeInTheDocument();
  });

  it('greets gracefully when no name is available', () => {
    renderPanel({ userName: undefined });
    expect(screen.getByText('Welcome to Acureal.')).toBeInTheDocument();
  });

  it('renders an undone step with its deep-linked CTA', () => {
    renderPanel();
    expect(screen.getByText('Create your first deal')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /new deal/i })).toHaveAttribute(
      'href',
      '/dashboard/deals?new=1',
    );
  });

  it('shows a done step without a CTA (no action needed)', () => {
    renderPanel();
    expect(screen.getByText('Scan Market Intelligence')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^open$/i })).toBeNull();
  });

  it('compact mode hides done steps and shows only what is left', () => {
    renderPanel({ compact: true });
    expect(screen.getByText('Create your first deal')).toBeInTheDocument();
    expect(screen.queryByText('Scan Market Intelligence')).toBeNull();
  });

  it('shows a celebratory done-state when every step is complete', () => {
    const allDone = ITEMS.map((i) => ({ ...i, done: true }));
    renderPanel({ items: allDone });
    expect(screen.getByRole('heading', { name: /all set/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open the guide/i })).toBeInTheDocument();
  });

  it('calls onDismiss when the skip control is clicked', () => {
    const onDismiss = vi.fn();
    renderPanel({ onDismiss });
    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
