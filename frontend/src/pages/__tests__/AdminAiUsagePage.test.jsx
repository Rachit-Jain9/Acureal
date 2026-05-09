import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mocks the AI usage hook so we control the rollup payload directly.
// Doesn't hit the network. Asserts on the KPI tiles, the per-task
// breakdown, the top-cost table, and the time-window switcher.

let usageState;
const useAiUsageMock = vi.fn();

vi.mock('../../hooks/useAiUsage', () => ({
  useAiUsage: (...args) => useAiUsageMock(...args),
}));

import AdminAiUsagePage from '../AdminAiUsagePage';

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminAiUsagePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const samplePayload = {
  summary: {
    window_days: 30,
    total_calls: 1234,
    total_cost_usd: 12.34,
    total_tokens: 4_500_000,
    cache_hits: 123,
    cache_hit_rate_pct: 10,
    successes: 1100,
    errors: 11,
    cost_capped: 0,
    recovered_via_retry: 4,
    prompt_cache_used: 60,
    avg_latency_ms: 800,
    p50_latency_ms: 600,
    p95_latency_ms: 2400,
  },
  daily: [
    { day: '2026-05-08', calls: 100, cost_usd: 1.5, cache_hits: 10, failures: 0 },
    { day: '2026-05-09', calls: 150, cost_usd: 2.25, cache_hits: 15, failures: 1 },
  ],
  by_task_provider: [
    { task: 'reasoning', provider: 'claude', model: 'claude-sonnet-4-6', calls: 200, cost_usd: 5.5, total_tokens: 1_200_000, cache_hits: 20, avg_latency_ms: 4200 },
    { task: 'document_extraction', provider: 'gemini', model: 'gemini-3-flash-preview', calls: 800, cost_usd: 2.1, total_tokens: 3_000_000, cache_hits: 40, avg_latency_ms: 600 },
  ],
  by_doctype: [
    { doctype: 'comps_rate_sheet', language: 'en', calls: 80, successes: 76, errors: 4, cost_usd: 0.95 },
  ],
  top_cost_calls: [
    {
      id: 'call-1',
      task: 'reasoning',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      status: 'success',
      cost_usd: 0.42,
      latency_ms: 4200,
      total_tokens: 15000,
      deal_id: 'deal-uuid-1',
      document_id: null,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    },
  ],
  generated_at: new Date().toISOString(),
};

beforeEach(() => {
  useAiUsageMock.mockReset();
  usageState = { data: samplePayload, isLoading: false, isError: false, refetch: vi.fn(), isFetching: false };
  useAiUsageMock.mockImplementation(() => usageState);
});

describe('AdminAiUsagePage', () => {
  it('renders the four headline KPI tiles', () => {
    renderPage();
    expect(screen.getByText(/Total cost/i)).toBeInTheDocument();
    expect(screen.getByText(/Latency p50 \/ p95/i)).toBeInTheDocument();
    expect(screen.getByText(/Cache hit rate/i)).toBeInTheDocument();
    // Cost rendered as "$12.34"
    expect(screen.getByText('$12.34')).toBeInTheDocument();
    // Latency rendered as "600 ms / 2.4 s"
    expect(screen.getByText(/600 ms \/ 2\.4 s/)).toBeInTheDocument();
  });

  it('renders the per-task / provider breakdown table', () => {
    renderPage();
    expect(screen.getByText(/By task × provider × model/i)).toBeInTheDocument();
    // 'reasoning' appears in both the breakdown row and the top-cost row,
    // 'document_extraction' only in the breakdown — single-element check is
    // fine for it. We just need to confirm the table rendered something.
    expect(screen.getByText('document_extraction')).toBeInTheDocument();
    expect(screen.getAllByText('reasoning').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the top-cost calls table with a deal link when present', () => {
    renderPage();
    expect(screen.getByText(/Top 20 most expensive individual calls/i)).toBeInTheDocument();
    // Cost is formatted as $0.4200 (under 1 USD path)
    expect(screen.getByText('$0.4200')).toBeInTheDocument();
    // Deal link points at the actual deal page
    const dealLink = screen.getByRole('link', { name: /Deal/i });
    expect(dealLink).toHaveAttribute('href', '/dashboard/deals/deal-uuid-1');
  });

  it('renders the by-doctype extraction breakdown when present', () => {
    renderPage();
    expect(screen.getByText(/By document type & language/i)).toBeInTheDocument();
    expect(screen.getByText('comps_rate_sheet')).toBeInTheDocument();
  });

  it('window switcher updates the active state', () => {
    renderPage();
    const sevenDay = screen.getByRole('button', { name: /^7 days$/ });
    fireEvent.click(sevenDay);
    // useAiUsage is called once per render; on click we re-render with days=7
    // The mock receives multiple calls; latest should be 7.
    const lastCall = useAiUsageMock.mock.calls.at(-1);
    expect(lastCall[0]).toBe(7);
  });

  it('Refresh button calls refetch', () => {
    renderPage();
    const refresh = screen.getByRole('button', { name: /Refresh/i });
    fireEvent.click(refresh);
    expect(usageState.refetch).toHaveBeenCalled();
  });

  it('shows loading state via SkeletonList', () => {
    usageState = { isLoading: true, refetch: vi.fn(), isFetching: true };
    renderPage();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows error state with Try-again button', () => {
    usageState = { isError: true, error: { message: 'boom' }, refetch: vi.fn(), isFetching: false };
    renderPage();
    expect(screen.getByText(/Couldn't load AI usage/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });
});
