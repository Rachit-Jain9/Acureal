import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Tests bulk multi-select on the Comps Review Queue page. Mocks the
// queue list + the bulk-action mutations so we control state without
// hitting the network. Covers: select-all, individual toggles, the
// sticky action bar, the reject modal flow.

const bulkApproveMutateAsync = vi.fn();
const bulkRejectMutateAsync = vi.fn();
const useCompsReviewQueueListMock = vi.fn();
const useProcessPendingBatchMock = vi.fn(() => ({ mutate: vi.fn(), isPending: false }));
const useManualUploadMock = vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false }));
const useBulkApproveQueueMock = vi.fn(() => ({
  mutateAsync: bulkApproveMutateAsync,
  isPending: false,
}));
const useBulkRejectQueueMock = vi.fn(() => ({
  mutateAsync: bulkRejectMutateAsync,
  isPending: false,
}));

vi.mock('../../hooks/useCompsReviewQueue', () => ({
  useCompsReviewQueueList: (...args) => useCompsReviewQueueListMock(...args),
  useProcessPendingBatch: (...args) => useProcessPendingBatchMock(...args),
  useManualUpload: (...args) => useManualUploadMock(...args),
  useBulkApproveQueue: (...args) => useBulkApproveQueueMock(...args),
  useBulkRejectQueue: (...args) => useBulkRejectQueueMock(...args),
}));

import CompsQueuePage from '../CompsQueuePage';

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CompsQueuePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const sampleRows = [
  { id: 'r-1', status: 'pending_review', source: 'email_broker_quote', source_meta: { subject: 'Whitefield Q1', from: 'broker@a.com' }, confidence_scores: { _overall: 0.85 }, created_at: '2026-05-09T10:00:00Z' },
  { id: 'r-2', status: 'pending_review', source: 'email_ipc_report',   source_meta: { subject: 'JLL Bengaluru',  from: 'ipc@jll.com' }, confidence_scores: { _overall: 0.92 }, created_at: '2026-05-09T11:00:00Z' },
  { id: 'r-3', status: 'pending_review', source: 'manual_upload',      source_meta: { subject: 'Manual upload',  from: 'analyst@redip.com' }, confidence_scores: { _overall: 0.70 }, created_at: '2026-05-09T12:00:00Z' },
];

beforeEach(() => {
  bulkApproveMutateAsync.mockReset();
  bulkApproveMutateAsync.mockResolvedValue({ succeeded_count: 2, failed_count: 0 });
  bulkRejectMutateAsync.mockReset();
  bulkRejectMutateAsync.mockResolvedValue({ succeeded_count: 1, failed_count: 0 });
  // Two list hooks are mounted on the page — pending_review (the visible
  // filter) and pending_extraction (used for the "Process pending now"
  // button count). Return the same mock for both to keep things simple.
  useCompsReviewQueueListMock.mockImplementation(({ status }) => ({
    data: { data: status === 'pending_review' ? sampleRows : [], pagination: { total: status === 'pending_review' ? 3 : 0 } },
    isLoading: false,
    isError: false,
  }));
  // Stub the confirm dialog so the bulk approve flow doesn't pause on it.
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('CompsQueuePage — bulk actions', () => {
  it('renders the multi-select header on the pending_review filter', () => {
    renderPage();
    expect(screen.getByText(/Select rows for bulk approve/i)).toBeInTheDocument();
  });

  it('selecting a row reveals the sticky bulk action bar', () => {
    renderPage();
    // First row's checkbox button (the only one whose aria-label is "Select row").
    const checkboxes = screen.getAllByRole('button', { name: /Select row/i });
    fireEvent.click(checkboxes[0]);
    // "1 selected" appears in both the list-header status row and the
    // sticky action bar — both legitimate, so assert >= 1 match.
    expect(screen.getAllByText('1 selected').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /^Approve 1$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Reject 1$/ })).toBeInTheDocument();
  });

  it('select-all toggles all rows and the action bar shows full count', () => {
    renderPage();
    const selectAll = screen.getByRole('button', { name: /Select all/i });
    fireEvent.click(selectAll);
    expect(screen.getAllByText('3 selected').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /^Approve 3$/ })).toBeInTheDocument();
  });

  it('Approve button calls bulkApprove with the selected ids', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Select all/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Approve 3$/ }));
    await waitFor(() =>
      expect(bulkApproveMutateAsync).toHaveBeenCalledWith(['r-1', 'r-2', 'r-3']),
    );
  });

  it('Reject opens the modal; confirm submits with the optional reason', async () => {
    renderPage();
    const checkboxes = screen.getAllByRole('button', { name: /Select row/i });
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole('button', { name: /^Reject 1$/ }));
    // Modal renders
    expect(screen.getByText(/Reject 1 item/i)).toBeInTheDocument();
    // Type a reason
    const textarea = screen.getByPlaceholderText(/Duplicate batch/i);
    fireEvent.change(textarea, { target: { value: 'Old data; superseded by Q1' } });
    // Click confirm
    const confirmBtn = screen.getAllByRole('button', { name: /^Reject 1$/ }).pop();
    fireEvent.click(confirmBtn);
    await waitFor(() =>
      expect(bulkRejectMutateAsync).toHaveBeenCalledWith({
        ids: ['r-1'],
        reason: 'Old data; superseded by Q1',
      }),
    );
  });

  it('Clear button drops the selection without submitting', () => {
    renderPage();
    const checkboxes = screen.getAllByRole('button', { name: /Select row/i });
    fireEvent.click(checkboxes[0]);
    // "1 selected" appears in both the list-header status row and the
    // sticky action bar — both legitimate, so assert >= 1 match.
    expect(screen.getAllByText('1 selected').length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: /Clear selection/i }));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    expect(bulkApproveMutateAsync).not.toHaveBeenCalled();
    expect(bulkRejectMutateAsync).not.toHaveBeenCalled();
  });

  it('switching the status filter clears the selection', () => {
    renderPage();
    const checkboxes = screen.getAllByRole('button', { name: /Select row/i });
    fireEvent.click(checkboxes[0]);
    // "1 selected" appears in both the list-header status row and the
    // sticky action bar — both legitimate, so assert >= 1 match.
    expect(screen.getAllByText('1 selected').length).toBeGreaterThanOrEqual(1);
    // Switch to "Committed" filter — a terminal status that disables bulk ops.
    fireEvent.click(screen.getByRole('button', { name: /Committed/i }));
    // Bulk bar should disappear (selection cleared, filter no longer eligible).
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
  });
});
