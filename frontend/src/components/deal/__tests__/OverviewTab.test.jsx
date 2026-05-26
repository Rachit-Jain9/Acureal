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
  // OverviewTab consumes the Recommendation Engine slice via this selector;
  // the test renders the empty-state to keep the test focused on its
  // legacy assertions.
  useDealRecommendations: () => ({
    recommendations: [],
    snapshot_hash: null,
    signal_count: 0,
    generated_at: null,
  }),
  // P1-PR2 — Micro-Market Briefing slice. Test renders the "no coordinates"
  // empty state by returning the unavailable reason.
  useDealMicroMarket: () => ({
    classification: { locality_code: null, confidence: null },
    locality: null,
    benchmarks: [],
    demand_signals: [],
    reason: 'no_parcel_coordinates',
  }),
  // P2-PR1 — Best Use Simulator slice. Test renders the "no coordinates"
  // empty state in the same shape as the Micro-Market panel.
  useDealBestUse: () => ({
    classification: { locality_code: null, confidence: null },
    locality: null,
    scores: [],
    reason: 'no_parcel_coordinates',
  }),
  // P2-PR2 — Deal-Structure Recommender slice. Test renders the "no asset
  // class" empty state — recommender stays inert until the deal has one.
  useDealStructureRecommender: () => ({ scores: [], reason: 'no_asset_class' }),
  // P2-PR3 — Capital-Stack Optimizer slice. Test renders the "no financial
  // model" empty state — optimizer stays inert until the kernel has run.
  useDealCapitalStack: () => ({ scenarios: [], reason: 'no_financial_model' }),
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

// Workstream A — ModelTrustSummary is its own component with its own test
// and its own React Query hooks; stub it so this OverviewTab test stays
// focused.
vi.mock('../../financials/ModelTrustSummary', () => ({
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

  it('renders the live Stage Playbook for the deal stage', () => {
    renderWithProviders(<OverviewTab />);

    // Workstream D1 — the deal is in `screening`, so the stage playbook
    // shows the screening checklist; a bare mock deal leaves it pending.
    expect(screen.getByText('Stage Playbook')).toBeInTheDocument();
    expect(screen.getByText('Link the parcel')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /playbook progress/i })).toBeInTheDocument();
  });
});
