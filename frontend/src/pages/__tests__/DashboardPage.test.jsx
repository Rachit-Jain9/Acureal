import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useDashboard', () => ({
  useDashboard: () => ({
    data: {
      stats: {
        total_deals: 42,
        active_deals_count: 18,
        total_pipeline_value_cr: 812.5,
        avg_irr_pct: 22.4,
        ic_ready_count: 5,
        deals_with_open_risks: 2,
        total_documents: 318,
        closed_value_cr: 0,
      },
      stage_distribution: [],
      recent_activities: [],
      top_deals_by_irr: [],
      cities_distribution: [],
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// Recharts brings ResizeObserver needs; the Dashboard renders charts conditionally
// on non-empty data — with empty arrays above, no chart tree mounts.
import DashboardPage from '../DashboardPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe('DashboardPage — 4-KPI institutional scan layout', () => {
  it('renders exactly 4 primary KPI labels (regression guard for PR #44)', () => {
    renderPage();
    expect(screen.getByText('Pipeline Value')).toBeInTheDocument();
    expect(screen.getByText('Active Deals')).toBeInTheDocument();
    expect(screen.getByText('Avg IRR')).toBeInTheDocument();
    expect(screen.getByText('Investor-Grade')).toBeInTheDocument();
  });

  it('does not render removed secondary KPIs (Total Deals / Documents / Closed value / Open risks tile)', () => {
    renderPage();
    expect(screen.queryByText('Total Deals')).toBeNull();
    expect(screen.queryByText('Documents')).toBeNull();
    expect(screen.queryByText('Closed value')).toBeNull();
    // "Open risks" appeared as its own tile title; after migration the signal
    // is expressed as a delta line under Active Deals, not a standalone tile.
    expect(screen.queryByText('Open risks')).toBeNull();
  });

  it('surfaces open-risk signal as a delta under Active Deals when > 0', () => {
    renderPage();
    expect(screen.getByText(/2 with open risk/)).toBeInTheDocument();
  });

  it('surfaces "Above 20% bench" when IRR ≥ 20%', () => {
    renderPage();
    expect(screen.getByText(/Above 20% bench/)).toBeInTheDocument();
  });

  it('surfaces "Ready to deploy" under IC-ready when count > 0', () => {
    renderPage();
    expect(screen.getByText(/Ready to deploy/)).toBeInTheDocument();
  });
});
