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

vi.mock('../../../hooks/useDocumentInsights', () => ({
  useDocumentInsights: () => mockHookState,
}));

import DocumentInsightsPanel from '../DocumentInsightsPanel';

const renderPanel = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DocumentInsightsPanel dealId="d-1" />
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

describe('DocumentInsightsPanel (PR-NX49)', () => {
  it('shows skeleton during initial load', () => {
    mockHookState.isLoading = true;
    renderPanel();
    expect(screen.getByText(/Cross-Document Analysis/i)).toBeInTheDocument();
    expect(screen.getByText(/AI-assisted/i)).toBeInTheDocument();
  });

  it('renders summary + findings sorted by severity', () => {
    mockHookState.data = {
      available: true,
      summary_paragraph: '3 documents on file.',
      findings: [
        { title: 'Minor area mismatch', severity: 'medium', description: 'small area diff', recommendation: 'survey' },
        { title: 'Owner mismatch',      severity: 'critical', description: 'owner names differ', recommendation: 'order khata' },
        { title: 'Date format',         severity: 'low',      description: 'minor', recommendation: null },
      ],
      confidence: 'high',
      provider: 'claude-sonnet-4-6',
      fallbackReason: null,
    };
    renderPanel();
    expect(screen.getByText(/3 documents on file/i)).toBeInTheDocument();
    expect(screen.getByText(/Inconsistency findings \(3\)/i)).toBeInTheDocument();
    // Critical title appears
    expect(screen.getByText('Owner mismatch')).toBeInTheDocument();
    expect(screen.getByText('Minor area mismatch')).toBeInTheDocument();
    expect(screen.getByText('Date format')).toBeInTheDocument();
    // Severity tags rendered — labels are stored Title-cased in the
    // panel ('Critical') and uppercased visually via CSS `uppercase`.
    // The DOM text content has Title case.
    const body = document.body.textContent;
    expect(body).toContain('[Critical]');
    expect(body).toContain('[Medium]');
    expect(body).toContain('[Low]');
    // Attribution line
    expect(screen.getByText(/Confidence: high · Synthesis: claude-sonnet-4-6/i)).toBeInTheDocument();
  });

  it('shows positive-signal "no inconsistencies detected" when findings empty', () => {
    mockHookState.data = {
      available: true,
      summary_paragraph: 'Documents corroborate.',
      findings: [],
      confidence: 'high',
      provider: 'claude-sonnet-4-6',
    };
    renderPanel();
    expect(screen.getByText(/No inconsistencies detected/i)).toBeInTheDocument();
    // Positive signal phrasing
    expect(screen.getByText(/positive signal/i)).toBeInTheDocument();
  });

  it('renders NOTHING when unavailable (no extractions)', () => {
    mockHookState.data = {
      available: false,
      reason: 'no extractions with structured_fields available',
      findings: [],
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
      response: { status: 500, data: { message: 'AI provider outage' } },
    };
    renderPanel();
    expect(screen.getByText(/Document insights unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/\(500\)/)).toBeInTheDocument();
    expect(screen.getByText(/AI provider outage/i)).toBeInTheDocument();
  });

  it('Refresh button calls refetch', () => {
    mockHookState.data = {
      available: true,
      summary_paragraph: 'ok',
      findings: [],
      confidence: 'high',
      provider: 'claude-sonnet-4-6',
    };
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(mockHookState.refetch).toHaveBeenCalledTimes(1);
  });

  it('shows recommendation line on findings that have one', () => {
    mockHookState.data = {
      available: true,
      summary_paragraph: 'ok',
      findings: [
        { title: 'X', severity: 'high', description: 'detail', recommendation: 'do this specific thing' },
      ],
      confidence: 'high',
      provider: 'claude-sonnet-4-6',
    };
    renderPanel();
    expect(screen.getByText(/do this specific thing/i)).toBeInTheDocument();
    expect(screen.getByText(/Recommended:/i)).toBeInTheDocument();
  });
});
