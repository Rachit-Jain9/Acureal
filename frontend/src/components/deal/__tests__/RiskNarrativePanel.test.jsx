import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the hook before importing the component.
const mockHookState = {
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
  isFetching: false,
};

vi.mock('../../../hooks/useRiskNarrative', () => ({
  useRiskNarrative: () => mockHookState,
}));

import RiskNarrativePanel from '../RiskNarrativePanel';

const renderPanel = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RiskNarrativePanel dealId="d-1" />
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

describe('RiskNarrativePanel (PR-NX47)', () => {
  it('shows skeleton during initial load', () => {
    mockHookState.isLoading = true;
    renderPanel();
    expect(screen.getByText(/Risk Profile Synthesis/i)).toBeInTheDocument();
    expect(screen.getByText(/AI-assisted/i)).toBeInTheDocument();
  });

  it('renders both paragraphs + attribution when narrative is available', () => {
    mockHookState.data = {
      available: true,
      summary_paragraph: 'Legal exposure dominates the risk picture.',
      critical_spotlight_paragraph: 'Conversion order pending is the single dealbreaker.',
      confidence: 'high',
      provider: 'claude-sonnet-4-6',
      fallbackReason: null,
    };
    renderPanel();
    expect(screen.getByText(/Risk Profile Synthesis/i)).toBeInTheDocument();
    expect(screen.getByText(/Legal exposure dominates/i)).toBeInTheDocument();
    expect(screen.getByText(/Conversion order pending/i)).toBeInTheDocument();
    expect(screen.getByText(/Confidence: high · Synthesis: claude-sonnet-4-6/i)).toBeInTheDocument();
  });

  it('shows a CLEAN auto-failover line — strips raw provider error JSON', () => {
    mockHookState.data = {
      available: true,
      summary_paragraph: 'Synthesis ok.',
      critical_spotlight_paragraph: 'Critical noted.',
      confidence: 'medium',
      provider: 'gpt-5.4',
      // The router sometimes splices upstream JSON into this string.
      // The panel must extract only the "succeeded on <provider>" tail
      // so customer-facing UI never shows the raw JSON blob.
      fallbackReason: 'Claude 404 404 {"type":"error","error":{"type":"not_found_error","message":"model: gemini-3-flash-preview"},"request_id":"req_011Cb"} — auto-failover succeeded on openai',
    };
    renderPanel();
    expect(screen.getByText(/auto-failover succeeded on openai/i)).toBeInTheDocument();
    // The raw JSON / 404 noise must NOT leak through.
    expect(screen.queryByText(/not_found_error/)).toBeNull();
    expect(screen.queryByText(/request_id/)).toBeNull();
    expect(screen.queryByText(/Claude 404/i)).toBeNull();
  });

  it('renders NOTHING when narrative is unavailable (no risks logged)', () => {
    mockHookState.data = {
      available: false,
      reason: 'no risks logged',
      summary_paragraph: null,
      critical_spotlight_paragraph: null,
    };
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders NOTHING when data is undefined (still loading or query disabled)', () => {
    mockHookState.data = undefined;
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows error state with status code when API errored', () => {
    mockHookState.isError = true;
    mockHookState.error = {
      response: { status: 403, data: { message: 'Forbidden — admin/analyst role required' } },
    };
    renderPanel();
    expect(screen.getByText(/Risk synthesis unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/\(403\)/)).toBeInTheDocument();
    expect(screen.getByText(/admin\/analyst role required/i)).toBeInTheDocument();
  });

  it('Refresh button calls refetch', () => {
    mockHookState.data = {
      available: true,
      summary_paragraph: 'ok',
      critical_spotlight_paragraph: 'ok',
      confidence: 'high',
      provider: 'claude-sonnet-4-6',
    };
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(mockHookState.refetch).toHaveBeenCalledTimes(1);
  });

  it('only renders one paragraph when the other is null', () => {
    mockHookState.data = {
      available: true,
      summary_paragraph: 'Only the summary is present.',
      critical_spotlight_paragraph: null,
      confidence: 'medium',
      provider: 'gpt-5.4',
    };
    renderPanel();
    expect(screen.getByText(/Only the summary is present/i)).toBeInTheDocument();
    expect(screen.queryByText(/Critical \/ High-Severity Spotlight/i)).not.toBeInTheDocument();
  });
});
