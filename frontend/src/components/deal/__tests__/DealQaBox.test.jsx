import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Tier-2 #11 — Deal Q&A box. Tests the streaming UI flow (live answer
// painting, citation chips on persisted history rows, suggested-question
// affordance on first use, delete) without ever calling a real LLM.
//
// We mock the Q&A hooks directly — the streaming hook is mutable so we
// can flip `isStreaming` and `streamingText` between renders to simulate
// the SSE timeline.

let qaState;
const askFn = vi.fn();
const abortFn = vi.fn();
const deleteFn = vi.fn();

vi.mock('../../../hooks/useDealQa', () => ({
  useDealQaHistory: () => qaState.history,
  useStreamDealQa: () => ({
    ask: askFn,
    streamingText: qaState.streamingText,
    isStreaming: qaState.isStreaming,
    abort: abortFn,
  }),
  useDeleteDealQaRow: () => ({ mutate: deleteFn }),
}));

import DealQaBox from '../DealQaBox';

const renderWithClient = (ui) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  askFn.mockReset();
  abortFn.mockReset();
  deleteFn.mockReset();
  qaState = {
    history: { data: [], isLoading: false },
    streamingText: '',
    isStreaming: false,
  };
});

describe('DealQaBox', () => {
  it('shows the suggested questions when history is empty', () => {
    renderWithClient(<DealQaBox dealId="d-1" />);
    expect(screen.getByText(/Try one of these/i)).toBeInTheDocument();
    // 4 suggestion chips
    expect(screen.getByRole('button', { name: /open title risks/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /IC-ready/i })).toBeInTheDocument();
  });

  it('does not show suggested questions when history is populated', () => {
    qaState.history = { data: [
      { id: 'r1', question: 'old q', answer: 'old a', citations: [], status: 'complete', created_at: '2026-05-09T10:00:00Z' },
    ], isLoading: false };
    renderWithClient(<DealQaBox dealId="d-1" />);
    expect(screen.queryByText(/Try one of these/i)).not.toBeInTheDocument();
  });

  it('clicking a suggested question fills the textarea', () => {
    renderWithClient(<DealQaBox dealId="d-1" />);
    fireEvent.click(screen.getByRole('button', { name: /open title risks/i }));
    const textarea = screen.getByPlaceholderText(/title risks/i);
    expect(textarea.value).toBe('What are the open title risks?');
  });

  it('submitting a question calls ask with the dealId + trimmed text', () => {
    renderWithClient(<DealQaBox dealId="d-42" />);
    const textarea = screen.getByPlaceholderText(/title risks/i);
    fireEvent.change(textarea, { target: { value: '  Is the IRR reasonable?  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/ }));
    expect(askFn).toHaveBeenCalledWith({ dealId: 'd-42', question: 'Is the IRR reasonable?' });
  });

  it('Cmd+Enter submits the form', () => {
    renderWithClient(<DealQaBox dealId="d-7" />);
    const textarea = screen.getByPlaceholderText(/title risks/i);
    fireEvent.change(textarea, { target: { value: 'What are the comps?' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(askFn).toHaveBeenCalledWith({ dealId: 'd-7', question: 'What are the comps?' });
  });

  it('renders the streaming answer with a Cancel button while in flight', () => {
    qaState.streamingText = 'The IRR is 22.4% on';
    qaState.isStreaming = true;
    renderWithClient(<DealQaBox dealId="d-1" />);
    // Live answer paints into the streaming panel.
    expect(screen.getByText(/The IRR is 22\.4% on/)).toBeInTheDocument();
    // Cancel button is exposed mid-stream.
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });

  it('Cancel button aborts the stream', () => {
    qaState.streamingText = 'partial';
    qaState.isStreaming = true;
    renderWithClient(<DealQaBox dealId="d-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(abortFn).toHaveBeenCalled();
  });

  it('renders persisted history rows with citation chips', () => {
    qaState.history = { data: [
      {
        id: 'r1',
        question: 'What are the comps?',
        answer: 'Median INR 8500/sqft across 4 verified comps in Whitefield.',
        citations: [
          { embedding_id: 'e-1', kind: 'document', document_name: 'Whitefield JLL Q1 2026.pdf', page_number: 12, similarity: 0.91, excerpt: 'Whitefield median INR 8500/sqft.' },
        ],
        status: 'complete',
        numerical_drifts: [],
        created_at: '2026-05-09T10:00:00Z',
      },
    ], isLoading: false };
    renderWithClient(<DealQaBox dealId="d-1" />);
    // Question collapsed by default
    expect(screen.getByText('What are the comps?')).toBeInTheDocument();
    // Click to expand
    fireEvent.click(screen.getByText('What are the comps?'));
    expect(screen.getByText(/Median INR 8500\/sqft/)).toBeInTheDocument();
    // Citation chip surfaced
    expect(screen.getByText('Whitefield JLL Q1 2026.pdf')).toBeInTheDocument();
  });

  it('renders synthetic citation chips with the deal-data label', () => {
    qaState.history = { data: [
      {
        id: 'r-syn',
        question: 'Brief about this deal',
        answer: 'This is a 9-acre Jigani parcel at IRR 13.6%.',
        citations: [
          { embedding_id: 'deal_snapshot', kind: 'synthetic', document_name: 'Deal snapshot', excerpt: 'IRR 13.6% / 9 acres', why_relevant: 'IRR claim' },
        ],
        status: 'complete',
        created_at: '2026-05-09T10:00:00Z',
      },
    ], isLoading: false };
    renderWithClient(<DealQaBox dealId="d-1" />);
    fireEvent.click(screen.getByText('Brief about this deal'));
    // Synthetic chip uses the friendly label "Deal snapshot"
    expect(screen.getByText('Deal snapshot')).toBeInTheDocument();
  });

  it('shows the failure-reason banner on a failed history row', () => {
    qaState.history = { data: [
      {
        id: 'r1',
        question: 'x',
        answer: null,
        citations: [],
        status: 'failed',
        failure_reason: 'Hallucinated citation ids: e-fake',
        created_at: '2026-05-09T10:00:00Z',
      },
    ], isLoading: false };
    renderWithClient(<DealQaBox dealId="d-1" />);
    fireEvent.click(screen.getByText('x'));
    expect(screen.getByText(/Hallucinated citation ids/)).toBeInTheDocument();
  });

  it('Remove on a history row calls delete with the right ids', async () => {
    qaState.history = { data: [
      {
        id: 'r-77',
        question: 'old',
        answer: 'old answer',
        citations: [],
        status: 'complete',
        created_at: '2026-05-09T10:00:00Z',
      },
    ], isLoading: false };
    renderWithClient(<DealQaBox dealId="d-1" />);
    fireEvent.click(screen.getByText('old'));
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
    await waitFor(() => expect(deleteFn).toHaveBeenCalledWith({ dealId: 'd-1', rowId: 'r-77' }));
  });

  it('renders the standing AI-assisted disclaimer in the streaming panel', () => {
    qaState.streamingText = 'partial answer text';
    qaState.isStreaming = true;
    renderWithClient(<DealQaBox dealId="d-1" />);
    expect(screen.getByText(/AI-assisted/i)).toBeInTheDocument();
  });
});
