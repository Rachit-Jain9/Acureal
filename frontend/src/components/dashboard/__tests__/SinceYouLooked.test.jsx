import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SinceYouLooked from '../SinceYouLooked';

/**
 * The strip has THREE states and the whole point is that they stay distinct:
 * "could not compute" must never look like "nothing moved", because the second
 * is a claim about the user's portfolio and the first is an admission we have
 * no idea. Conflating them is how a dashboard quietly lies.
 */

const renderStrip = (data, onPrefetchDeal) =>
  render(
    <MemoryRouter>
      <SinceYouLooked data={data} onPrefetchDeal={onPrefetchDeal} />
    </MemoryRouter>
  );

const deal = (over = {}) => ({
  deal_id: 'd1',
  name: 'Hopefarm Junction',
  stage: 'screening',
  last_visited_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  total: 6,
  changes: {
    documents_added: 2, extractions_completed: 0,
    risks_added: 1, risks_updated: 0,
    dd_updated: 3, approvals_updated: 0,
    financials_updated: 0, activities_added: 0,
  },
  ...over,
});

describe('SinceYouLooked', () => {
  it('renders NOTHING when the rollup could not be computed', () => {
    const { container } = renderStrip(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing has moved — quietly — on a genuinely empty answer', () => {
    renderStrip({ deals: [], moved_count: 0, never_opened: 0 });
    expect(screen.getByText(/Nothing has moved since your last pass/i)).toBeInTheDocument();
    // No heading, no list: a calm day should not look like a section.
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('counts deals never opened rather than listing them', () => {
    renderStrip({ deals: [], moved_count: 0, never_opened: 9 });
    expect(screen.getByText('9 deals not yet opened')).toBeInTheDocument();
  });

  it('singularises the never-opened count', () => {
    renderStrip({ deals: [], moved_count: 0, never_opened: 1 });
    expect(screen.getByText('1 deal not yet opened')).toBeInTheDocument();
  });

  it('lists a moved deal with its stage, its chips and when it was last opened', () => {
    renderStrip({ deals: [deal()], moved_count: 1, never_opened: 0 });
    expect(screen.getByText('Hopefarm Junction')).toBeInTheDocument();
    expect(screen.getByText('Screening')).toBeInTheDocument();
    expect(screen.getByText('+2 documents')).toBeInTheDocument();
    expect(screen.getByText('+1 risk')).toBeInTheDocument();
    expect(screen.getByText('3 DD items updated')).toBeInTheDocument();
    expect(screen.getByText(/opened 2h ago/)).toBeInTheDocument();
  });

  it('renders only the slices that actually changed', () => {
    renderStrip({ deals: [deal()], moved_count: 1, never_opened: 0 });
    // Zero-count slices must not render as "0 approvals updated".
    expect(screen.queryByText(/approvals updated/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/model updated/i)).not.toBeInTheDocument();
  });

  it('links each row to the deal — opening it is what clears the row', () => {
    renderStrip({ deals: [deal()], moved_count: 1, never_opened: 0 });
    expect(screen.getByRole('link', { name: /Hopefarm Junction/ }))
      .toHaveAttribute('href', '/dashboard/deals/d1');
  });

  it('prefetches the workspace on hover and on keyboard focus', () => {
    const onPrefetchDeal = vi.fn();
    renderStrip({ deals: [deal()], moved_count: 1, never_opened: 0 }, onPrefetchDeal);
    const link = screen.getByRole('link', { name: /Hopefarm Junction/ });
    link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(onPrefetchDeal).toHaveBeenCalledWith('d1');
    // Keyboard users get the same head start, not just mouse users.
    link.focus();
    expect(onPrefetchDeal).toHaveBeenCalledTimes(2);
  });

  it('pluralises the header on more than one moved deal', () => {
    renderStrip({
      deals: [deal(), deal({ deal_id: 'd2', name: 'Jaraka Bande' })],
      moved_count: 2,
      never_opened: 0,
    });
    expect(screen.getByText(/2 deals moved/)).toBeInTheDocument();
  });
});
