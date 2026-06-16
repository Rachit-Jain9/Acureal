import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
  // Portfolio Risk Radar self-fetches via this hook; the dashboard test
  // doesn't exercise the widget's content (separate suite handles that),
  // but the dashboard renderer mounts it so the mock has to satisfy the
  // hook's contract — an empty payload renders the widget's "no live deals"
  // state, which keeps the rest of the dashboard test isolated.
  usePortfolioRiskRadar: () => ({
    data: {
      empty: true,
      totals: { deals: 0, flagged: 0, unverified: 0, cleared: 0 },
      open_severity: { critical: 0, high: 0, medium: 0, low: 0, total: 0, portfolio_score: 0 },
      failure_modes: [],
      top_deals_at_risk: [],
      recently_flagged: [],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  // Phase 4 prologue — Portfolio Readiness widget self-fetches. Empty
  // payload here so the dashboard test focuses on the existing 4-KPI
  // layout regression; the widget's own suite verifies populated states.
  usePortfolioReadiness: () => ({
    data: {
      totals: { total: 0, ic_ready: 0, pre_ic: 0, diligence: 0, early: 0 },
      average_score: 0,
      portfolio_blockers: [],
      top_ready: [],
      top_needs_attention: [],
      deals: [],
      deals_count: 0,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  // Today's Attention panel self-fetches via this hook. The dashboard
  // test isolates itself by returning an empty/all-caught-up payload —
  // its own suite verifies the populated states.
  useAttention: () => ({
    data: {
      generated_at: new Date().toISOString(),
      totals: {
        overdue_dd: 0, expiring_approvals: 0, new_risk_flags: 0,
        stale_deals: 0, any: false,
      },
      overdue_dd_items: [],
      expiring_approvals: [],
      new_risk_flags: [],
      stale_deals: [],
      recent_activity: [],
      thresholds: { stale_deal_days: 14, new_risk_window_days: 7, expiring_window_days: 30 },
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

// AI cost summary + audit-trail-tail widgets self-fetch via adminAPI; the setup
// checklist self-fetches the deals list (and, for admins, members). Stub the
// network so the dashboard renders without real HTTP traffic.
vi.mock('../../services/api', () => ({
  adminAPI: {
    getAiUsage: vi.fn(() => Promise.resolve({ data: { data: null } })),
    getRecentEvents: vi.fn(() => Promise.resolve({ data: { data: [] } })),
  },
  dealsAPI: {
    list: vi.fn(() => Promise.resolve({ data: { data: [] } })),
  },
  organizationAPI: {
    listMembers: vi.fn(() => Promise.resolve({ data: { data: { members: [] } } })),
  },
}));

beforeEach(() => {
  // Each test starts from a clean layout — defaults visible.
  window.localStorage.clear();
});

// Recharts brings ResizeObserver needs; the Dashboard renders charts conditionally
// on non-empty data — with empty arrays above, no chart tree mounts.
import DashboardPage from '../DashboardPage';

function renderPage() {
  // Each test gets a fresh client; retries off so failed queries surface
  // immediately instead of looping in the background.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage — cinematic hero', () => {
  it('renders the live pipeline hero + the four KPI tiles', () => {
    renderPage();
    expect(screen.getByText('Pipeline · live')).toBeInTheDocument();
    expect(screen.getByText('Active deals')).toBeInTheDocument();
    expect(screen.getByText('Avg IRR')).toBeInTheDocument();
    expect(screen.getByText('Open high risks')).toBeInTheDocument();
    expect(screen.getByText('Investor-grade')).toBeInTheDocument();
  });

  it('tags IRR at/above the benchmark when >= 12% (mock IRR 22.4)', () => {
    renderPage();
    expect(screen.getByText('At or above bench')).toBeInTheDocument();
  });

  it('does not render the legacy secondary KPIs', () => {
    renderPage();
    expect(screen.queryByText('Total Deals')).toBeNull();
    expect(screen.queryByText('Documents')).toBeNull();
    expect(screen.queryByText('Closed value')).toBeNull();
  });
});
