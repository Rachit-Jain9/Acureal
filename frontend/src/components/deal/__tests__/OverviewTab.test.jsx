import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../hooks/useDealContext', () => ({
  useDealContext: () => ({ dealId: 'deal-123' }),
  useDealRecord: () => ({
    id: 'deal-123',
    name: 'Hebbal Mixed Use',
    stage: 'screening',
    deal_type: 'acquisition',
    financials: {
      total_cost_cr: 100,
      total_revenue_cr: 140,
      gross_margin_pct: 28,
      gross_profit_cr: 40,
      irr_pct: 24,
      npv_cr: 12,
      equity_multiple: 1.8,
      developer_profit_cr: 18,
    },
    stage_history: [],
    recent_activities: [],
    next_steps: [],
    key_risks: [],
  }),
}));

vi.mock('../../../services/api', () => ({
  intelligenceAPI: {
    getDealAnalysis: vi.fn(),
    streamDealAnalysis: vi.fn(() => ({ promise: new Promise(() => {}), abort: vi.fn() })),
    getCachedDealAnalysis: vi.fn(() => Promise.resolve({ data: { data: null } })),
  },
  // Q&A box (Tier-2 #11) is rendered at the bottom of OverviewTab. The
  // hooks call useQueryClient() — return enough shape for a no-op
  // render under the test's QueryClientProvider.
  dealQaAPI: {
    history: vi.fn(() => Promise.resolve({ data: { data: [] } })),
    ask: vi.fn(),
    stream: vi.fn(() => ({ promise: new Promise(() => {}), abort: vi.fn() })),
    deleteRow: vi.fn(),
  },
}));

vi.mock('../BuildabilitySummary', () => ({
  default: () => null,
}));

// Workstream B — RiskRadarStrip is its own component with its own test;
// stub it so this OverviewTab test stays focused.
vi.mock('../RiskRadarStrip', () => ({
  default: () => null,
}));

import OverviewTab from '../OverviewTab';

const renderWithProviders = (ui) => {
  // Each test gets a fresh client; retries off so failed queries surface
  // immediately instead of looping in the background.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('OverviewTab', () => {
  it('links to the financial model with the context deal id', () => {
    renderWithProviders(<OverviewTab />);

    expect(screen.getByRole('link', { name: /full model/i })).toHaveAttribute(
      'href',
      '/dashboard/financials/deal-123',
    );
  });
});
