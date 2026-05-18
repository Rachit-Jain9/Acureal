import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockHookState = {
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
  isFetching: false,
};

vi.mock('../../../hooks/useSensitivityNarrative', () => ({
  useSensitivityNarrative: () => mockHookState,
}));

import SensitivityNarrativePanel from '../SensitivityNarrativePanel';

const renderPanel = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SensitivityNarrativePanel dealId="d-1" />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  mockHookState.data = undefined;
  mockHookState.isLoading = false;
  mockHookState.isError = false;
  mockHookState.error = null;
  mockHookState.isFetching = false;
  mockHookState.refetch = vi.fn();
});

describe('SensitivityNarrativePanel (PR-NX48)', () => {
  it('shows skeleton during initial load', () => {
    mockHookState.isLoading = true;
    renderPanel();
    expect(screen.getByText(/Sensitivity Analysis/i)).toBeInTheDocument();
    expect(screen.getByText(/AI-assisted/i)).toBeInTheDocument();
  });

  it('renders both paragraphs + dominant_driver eyebrow + attribution', () => {
    mockHookState.data = {
      available: true,
      driver_decomposition_paragraph: 'Sell rate dominates with 800 bps IRR swing.',
      stress_test_paragraph: 'Stress 1: sell rate −10% takes IRR to 14%.',
      dominant_driver: 'Sell Rate',
      confidence: 'high',
      provider: 'gpt-5.4',
      fallbackReason: null,
    };
    renderPanel();
    expect(screen.getByText(/Sensitivity Analysis/i)).toBeInTheDocument();
    expect(screen.getByText(/Dominant driver:/i)).toBeInTheDocument();
    expect(screen.getByText(/Sell rate dominates/i)).toBeInTheDocument();
    expect(screen.getByText(/sell rate −10%/i)).toBeInTheDocument();
    expect(screen.getByText(/Confidence: high · Synthesis: gpt-5.4/i)).toBeInTheDocument();
  });

  it('hides eyebrow dominant_driver line when null', () => {
    mockHookState.data = {
      available: true,
      driver_decomposition_paragraph: 'ok',
      stress_test_paragraph: 'ok',
      dominant_driver: null,
      confidence: 'medium',
      provider: 'gpt-5.4',
    };
    renderPanel();
    // No "Dominant driver:" line
    expect(screen.queryByText(/Dominant driver:/i)).not.toBeInTheDocument();
  });

  it('renders NOTHING when narrative unavailable (no financial model / sparse grid)', () => {
    mockHookState.data = {
      available: false,
      reason: 'insufficient sensitivity grid (< 3 rows or < 3 cols)',
      driver_decomposition_paragraph: null,
      stress_test_paragraph: null,
    };
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders NOTHING when data is undefined', () => {
    mockHookState.data = undefined;
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows error state with status code', () => {
    mockHookState.isError = true;
    mockHookState.error = {
      response: { status: 500, data: { message: 'Internal server error' } },
    };
    renderPanel();
    expect(screen.getByText(/Sensitivity synthesis unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/\(500\)/)).toBeInTheDocument();
  });

  it('Refresh button calls refetch', () => {
    mockHookState.data = {
      available: true,
      driver_decomposition_paragraph: 'ok',
      stress_test_paragraph: 'ok',
      dominant_driver: 'Sell Rate',
      confidence: 'high',
      provider: 'gpt-5.4',
    };
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(mockHookState.refetch).toHaveBeenCalledTimes(1);
  });
});
