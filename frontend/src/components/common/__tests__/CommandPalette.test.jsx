import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CommandPalette, { recordRecentDeal } from '../CommandPalette';

vi.mock('../../../services/api', () => ({
  dealsAPI: {
    list: vi.fn(() =>
      Promise.resolve({
        data: {
          data: [
            { id: 'd1', name: 'Whitefield Tower', city: 'Bengaluru', stage: 'screening' },
            { id: 'd2', name: 'Sarjapur Plotted', city: 'Bengaluru', stage: 'site_visit' },
          ],
        },
      })
    ),
  },
}));

const wrap = (ui) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
};

describe('CommandPalette', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('does not render anything before Ctrl+K is pressed', () => {
    wrap(<CommandPalette />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on Ctrl+K and shows the quick-action list', () => {
    wrap(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('All deals')).toBeInTheDocument();
  });

  it('also opens on Cmd+K (mac modifier)', () => {
    wrap(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'K', metaKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    wrap(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders recent deals from localStorage when opened', () => {
    recordRecentDeal({ id: 'r1', name: 'Recent Whitefield', city: 'Bengaluru', stage: 'screening' });
    wrap(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByText('Recent deals')).toBeInTheDocument();
    expect(screen.getByText('Recent Whitefield')).toBeInTheDocument();
  });

  it('filters quick actions by typed query', () => {
    wrap(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox', { name: /command palette search/i });
    fireEvent.change(input, { target: { value: 'comp' } });
    // After 200ms debounce + render, Comparables should still appear
    expect(screen.getByText('Comparables')).toBeInTheDocument();
  });

  it('runs a deal search after a 2+ char query', async () => {
    wrap(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox', { name: /command palette search/i });
    fireEvent.change(input, { target: { value: 'whit' } });

    // Wait for the debounced query to fire and render the result row
    await waitFor(
      () => {
        expect(screen.getByText('Whitefield Tower')).toBeInTheDocument();
      },
      { timeout: 1500 }
    );
  });
});

describe('recordRecentDeal', () => {
  beforeEach(() => localStorage.clear());

  it('persists a deal id and stays unique on repeat visits', () => {
    recordRecentDeal({ id: 'a', name: 'A' });
    recordRecentDeal({ id: 'b', name: 'B' });
    recordRecentDeal({ id: 'a', name: 'A' });

    const stored = JSON.parse(localStorage.getItem('redip:cmdk:recent'));
    expect(stored).toHaveLength(2);
    expect(stored[0].id).toBe('a');
    expect(stored[1].id).toBe('b');
  });

  it('caps the recent list at 8 entries', () => {
    for (let i = 0; i < 12; i += 1) {
      recordRecentDeal({ id: `d${i}`, name: `Deal ${i}` });
    }
    const stored = JSON.parse(localStorage.getItem('redip:cmdk:recent'));
    expect(stored).toHaveLength(8);
    // Latest write is at index 0
    expect(stored[0].id).toBe('d11');
  });

  it('ignores writes without an id', () => {
    recordRecentDeal({});
    recordRecentDeal(null);
    expect(localStorage.getItem('redip:cmdk:recent')).toBeNull();
  });
});
