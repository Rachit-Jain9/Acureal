import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const usePortfolioReadinessMock = vi.fn();
vi.mock('../../../hooks/useDashboard', () => ({
  usePortfolioReadiness: (...a) => usePortfolioReadinessMock(...a),
}));

import PortfolioReadinessWidget from '../PortfolioReadinessWidget';

beforeEach(() => {
  usePortfolioReadinessMock.mockReset();
});

const wrap = (ui) => <MemoryRouter>{ui}</MemoryRouter>;

describe('PortfolioReadinessWidget', () => {
  it('renders the loading skeleton', () => {
    usePortfolioReadinessMock.mockReturnValue({ data: null, isLoading: true, isError: false });
    const { container } = render(wrap(<PortfolioReadinessWidget />));
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders error state', () => {
    usePortfolioReadinessMock.mockReturnValue({ data: null, isLoading: false, isError: true });
    render(wrap(<PortfolioReadinessWidget />));
    expect(screen.getByText(/Couldn't load portfolio readiness/)).toBeInTheDocument();
  });

  it('renders the no-deals empty state with a CTA', () => {
    usePortfolioReadinessMock.mockReturnValue({
      data: {
        totals: { total: 0, ic_ready: 0, pre_ic: 0, diligence: 0, early: 0 },
        average_score: 0,
        portfolio_blockers: [],
        top_ready: [],
        top_needs_attention: [],
        deals_count: 0,
      },
      isLoading: false, isError: false,
    });
    render(wrap(<PortfolioReadinessWidget />));
    expect(screen.getByText(/No live deals yet/)).toBeInTheDocument();
    expect(screen.getByText(/Go to deals/)).toBeInTheDocument();
  });

  it('renders the full readiness card with tier counts, blockers, and top deals', () => {
    usePortfolioReadinessMock.mockReturnValue({
      data: {
        totals: { total: 4, ic_ready: 1, pre_ic: 1, diligence: 1, early: 1 },
        average_score: 55,
        portfolio_blockers: [
          {
            id: 'no_financial_model',
            label: 'Deals without a financial model',
            severity: 'critical',
            affected_count: 1,
            recommended_action: 'Open the Financial tab on each affected deal and run the kernel.',
          },
        ],
        top_ready: [
          { deal_id: 'd1', deal_name: 'Jigani Apartments', tier: 'ic_ready', score: 85, top_blocker: null },
        ],
        top_needs_attention: [
          { deal_id: 'd2', deal_name: 'New Sourcing Deal', tier: 'early', score: 12, top_blocker: 'No financial model' },
        ],
        deals_count: 4,
        disclaimer: 'Portfolio Readiness is an aggregated organisation aid…',
      },
      isLoading: false, isError: false,
    });
    render(wrap(<PortfolioReadinessWidget />));
    expect(screen.getByText('Portfolio Readiness')).toBeInTheDocument();
    expect(screen.getByText(/4 live deals/)).toBeInTheDocument();
    expect(screen.getByText('55')).toBeInTheDocument(); // average score
    expect(screen.getByText('Top blockers across portfolio')).toBeInTheDocument();
    expect(screen.getByText('Deals without a financial model')).toBeInTheDocument();
    expect(screen.getByText('Jigani Apartments')).toBeInTheDocument();
    expect(screen.getByText('New Sourcing Deal')).toBeInTheDocument();
    // Top blocker text appears next to needs-attention deal
    expect(screen.getByText(/No financial model/)).toBeInTheDocument();
    // Disclaimer surfaced
    expect(screen.getByText(/aggregated organisation aid/)).toBeInTheDocument();
  });

  it('top-ready deals link to their deal pages', () => {
    usePortfolioReadinessMock.mockReturnValue({
      data: {
        totals: { total: 1, ic_ready: 1, pre_ic: 0, diligence: 0, early: 0 },
        average_score: 85,
        portfolio_blockers: [],
        top_ready: [
          { deal_id: 'deal-uuid-1', deal_name: 'Jigani Apartments', tier: 'ic_ready', score: 85, top_blocker: null },
        ],
        top_needs_attention: [],
        deals_count: 1,
      },
      isLoading: false, isError: false,
    });
    render(wrap(<PortfolioReadinessWidget />));
    const link = screen.getByRole('link', { name: /Jigani Apartments/ });
    expect(link.getAttribute('href')).toBe('/dashboard/deals/deal-uuid-1');
  });
});
