import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Tests the deal-page Audit tab. Mocks the events hook so we control
// the timeline directly + asserts on the rendered KPI deltas, the
// expand/collapse behaviour, and the empty / loading / error states.

let eventsState;
const verifyMutate = vi.fn();
const replayMutate = vi.fn();
const bulkBatchMock = vi.fn();

vi.mock('../../../hooks/useDealContext', () => ({
  useDealContext: () => ({ dealId: 'd-test' }),
}));

vi.mock('../../../hooks/useDealEvents', () => ({
  useDealEvents: () => eventsState,
  useVerifyDealEvent: () => ({ mutate: verifyMutate, mutateAsync: verifyMutate, isPending: false }),
  useReplayDealEvent: () => ({ mutate: replayMutate, isPending: false }),
}));

vi.mock('../../../services/api', () => ({
  financialsAPI: {
    bulkBatch: (...args) => bulkBatchMock(...args),
  },
}));

import AuditTab, { attachDeltas } from '../AuditTab';

const renderWithClient = (ui) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  verifyMutate.mockReset();
  replayMutate.mockReset();
  bulkBatchMock.mockReset();
  eventsState = { data: [], isLoading: false, isError: false };
});

describe('AuditTab', () => {
  it('renders skeleton during initial load', () => {
    eventsState = { data: undefined, isLoading: true };
    renderWithClient(<AuditTab />);
    // SkeletonList exposes role="status" + aria-busy="true" so screen
    // readers announce the loading state. Asserting on the role is
    // more durable than the underlying CSS animation class.
    const skeleton = screen.getByRole('status');
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the empty-state CTA when there are no events', () => {
    renderWithClient(<AuditTab />);
    expect(screen.getByText(/No audit events yet/)).toBeInTheDocument();
    expect(screen.getByText(/Run the financial model/i)).toBeInTheDocument();
  });

  it('renders error state with Try-again button', () => {
    eventsState = { isError: true, error: { message: 'boom' } };
    renderWithClient(<AuditTab />);
    expect(screen.getByText(/Couldn't load the audit trail/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });

  it('renders a timeline of events with actor + relative time', () => {
    eventsState = {
      data: [
        {
          id: 'e1',
          event_type: 'calculate_and_save',
          engine_version: '1.2.0',
          actor: { id: 'u1', name: 'Rachit Jain', email: 'r@x.io' },
          inputs_hash: 'a'.repeat(64),
          outputs_hash: 'b'.repeat(64),
          signature: 'c'.repeat(64),
          created_at: new Date().toISOString(),
          outputs_summary: {
            irr_pct: 22.4, npv_cr: 14, total_revenue_cr: 75, total_cost_cr: 42,
            gross_profit_cr: 33, gross_margin_pct: 43.3,
            equity_multiple: 1.85, residual_land_value_cr: 13,
          },
        },
      ],
      isLoading: false,
    };
    renderWithClient(<AuditTab />);
    expect(screen.getByText(/Audit trail/)).toBeInTheDocument();
    expect(screen.getByText('Calculate & Save')).toBeInTheDocument();
    expect(screen.getByText('Rachit Jain')).toBeInTheDocument();
  });

  it('shows KPI deltas between two consecutive events', () => {
    eventsState = {
      data: [
        // Newest first.
        {
          id: 'e2',
          event_type: 'scenario_recompute',
          engine_version: '1.2.0',
          actor: { id: 'u1', name: 'Rachit Jain' },
          inputs_hash: 'd'.repeat(64),
          outputs_hash: 'e'.repeat(64),
          signature: 'f'.repeat(64),
          created_at: new Date().toISOString(),
          outputs_summary: {
            irr_pct: 25.0, npv_cr: 18, total_revenue_cr: 80, total_cost_cr: 42,
            gross_profit_cr: 38, gross_margin_pct: 47.5,
            equity_multiple: 2.0, residual_land_value_cr: 13,
          },
        },
        {
          id: 'e1',
          event_type: 'calculate_and_save',
          engine_version: '1.2.0',
          actor: { id: 'u1', name: 'Rachit Jain' },
          inputs_hash: 'a'.repeat(64),
          outputs_hash: 'b'.repeat(64),
          signature: 'c'.repeat(64),
          created_at: new Date(Date.now() - 60000).toISOString(),
          outputs_summary: {
            irr_pct: 22.4, npv_cr: 14, total_revenue_cr: 75, total_cost_cr: 42,
            gross_profit_cr: 33, gross_margin_pct: 43.3,
            equity_multiple: 1.85, residual_land_value_cr: 13,
          },
        },
      ],
      isLoading: false,
    };
    renderWithClient(<AuditTab />);
    // The newer event shows IRR delta vs the older one (+2.6).
    // Look for a +2.60 % delta — formatted via fmtNum with 2 decimals.
    const deltaText = screen.getAllByText(/\+2\.60/);
    expect(deltaText.length).toBeGreaterThan(0);
  });

  it('expand toggle reveals cryptographic provenance + KPI snapshot', () => {
    eventsState = {
      data: [{
        id: 'e1',
        event_type: 'calculate_and_save',
        engine_version: '1.2.0',
        actor: { name: 'Rachit Jain' },
        inputs_hash: 'a'.repeat(64),
        outputs_hash: 'b'.repeat(64),
        signature: 'sigsigsigsigsig123',
        created_at: new Date().toISOString(),
        outputs_summary: { irr_pct: 22.4 },
      }],
      isLoading: false,
    };
    renderWithClient(<AuditTab />);
    // Click the row to expand
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    // The page-level subhead also says "cryptographic provenance"; the
    // expanded panel adds a label with the same text. Grab all matches
    // and assert on count rather than uniqueness.
    const provenanceMatches = screen.getAllByText(/cryptographic provenance/i);
    expect(provenanceMatches.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Outputs snapshot/i)).toBeInTheDocument();
    // Verify + Replay buttons are exposed
    expect(screen.getByRole('button', { name: /Verify/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Replay/i })).toBeInTheDocument();
  });
});

describe('attachDeltas (pure helper)', () => {
  it('returns events with delta=null when there is no prior event', () => {
    const events = [{ id: 'e1', outputs_summary: { irr_pct: 22 } }];
    const result = attachDeltas(events);
    expect(result[0].delta).toBeNull();
  });

  it('produces delta entries only for fields that changed', () => {
    const events = [
      { id: 'newer', outputs_summary: { irr_pct: 25, npv_cr: 14 } },
      { id: 'older', outputs_summary: { irr_pct: 22, npv_cr: 14 } },
    ];
    const result = attachDeltas(events);
    expect(result[0].delta).toMatchObject({
      irr_pct: { from: 22, to: 25, delta: 3 },
    });
    expect(result[0].delta.npv_cr).toBeUndefined();
    // Older event has no prior → delta null.
    expect(result[1].delta).toBeNull();
  });

  it('returns delta=null when fields all match', () => {
    const events = [
      { id: 'a', outputs_summary: { irr_pct: 22 } },
      { id: 'b', outputs_summary: { irr_pct: 22 } },
    ];
    const result = attachDeltas(events);
    expect(result[0].delta).toBeNull();
  });

  it('handles missing outputs_summary gracefully', () => {
    const events = [
      { id: 'a' },
      { id: 'b', outputs_summary: { irr_pct: 22 } },
    ];
    const result = attachDeltas(events);
    expect(result[0].delta).toBeNull();
    expect(result[1].delta).toBeNull();
  });

  it('computes percent change for non-zero baselines', () => {
    const events = [
      { id: 'a', outputs_summary: { total_revenue_cr: 75 } },
      { id: 'b', outputs_summary: { total_revenue_cr: 50 } },
    ];
    const result = attachDeltas(events);
    expect(result[0].delta.total_revenue_cr.pct).toBeCloseTo(50, 0);
  });

  it('skips mutation rows entirely (no delta attached)', () => {
    const events = [
      { id: 'mut', kind: 'mutation', event_type: 'stage_changed' },
      { id: 'a', outputs_summary: { irr_pct: 22 } },
    ];
    const result = attachDeltas(events);
    // Mutation row passes through unchanged.
    expect(result[0]).toEqual({ id: 'mut', kind: 'mutation', event_type: 'stage_changed' });
    expect(result[0].delta).toBeUndefined();
  });

  it('threads the prior-financial pointer past intervening mutation rows', () => {
    // Newest financial → mutation → older financial. The newer
    // financial should still see a delta against the older one
    // because attachDeltas skips mutation rows when seeking
    // "previous financial event with a summary".
    const events = [
      { id: 'newer', outputs_summary: { irr_pct: 25 } },
      { id: 'mut', kind: 'mutation', event_type: 'stage_changed' },
      { id: 'older', outputs_summary: { irr_pct: 22 } },
    ];
    const result = attachDeltas(events);
    expect(result[0].delta).toMatchObject({
      irr_pct: { from: 22, to: 25, delta: 3 },
    });
  });
});

// ── Mutation-row UI ────────────────────────────────────────────────────────

describe('AuditTab mutation events', () => {
  it('renders a stage-changed mutation row with before → after diff', () => {
    eventsState = {
      data: [{
        id: 'm1',
        kind: 'mutation',
        event_type: 'stage_changed',
        actor: { id: 'u1', name: 'Rachit Jain' },
        before: { stage: 'sourced' },
        after: { stage: 'screening' },
        metadata: {},
        created_at: new Date().toISOString(),
      }],
      isLoading: false,
    };
    renderWithClient(<AuditTab />);
    expect(screen.getByText('Stage changed')).toBeInTheDocument();
    expect(screen.getByText('sourced')).toBeInTheDocument();
    expect(screen.getByText('screening')).toBeInTheDocument();
    expect(screen.getByText('Rachit Jain')).toBeInTheDocument();
  });

  it('renders an archived mutation row with the reason metadata badge', () => {
    eventsState = {
      data: [{
        id: 'm2',
        kind: 'mutation',
        event_type: 'archived',
        actor: { id: 'u1', name: 'Rachit Jain' },
        before: { is_archived: false },
        after: { is_archived: true, archived_reason: 'Owner pulled out' },
        metadata: { reason: 'Owner pulled out' },
        created_at: new Date().toISOString(),
      }],
      isLoading: false,
    };
    renderWithClient(<AuditTab />);
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByText(/Owner pulled out/)).toBeInTheDocument();
  });

  it('renders a bulk-deleted row with batch-size context when diff is empty', () => {
    eventsState = {
      data: [{
        id: 'm3',
        kind: 'mutation',
        event_type: 'bulk_deleted',
        actor: { id: 'u1', name: 'Admin User' },
        before: {},
        after: {},
        metadata: { bulk_id: 'batch-1', bulk_size: 4 },
        created_at: new Date().toISOString(),
      }],
      isLoading: false,
    };
    renderWithClient(<AuditTab />);
    expect(screen.getByText('Deleted (bulk)')).toBeInTheDocument();
    expect(screen.getByText(/bulk batch/i)).toBeInTheDocument();
    expect(screen.getByText(/4 deals/)).toBeInTheDocument();
  });

  it('renders the merged-feed breakdown sub-text', () => {
    eventsState = {
      data: [
        {
          id: 'fin1',
          event_type: 'calculate_and_save',
          actor: { name: 'Rachit Jain' },
          inputs_hash: 'a'.repeat(64),
          outputs_hash: 'b'.repeat(64),
          signature: 'c'.repeat(64),
          created_at: new Date().toISOString(),
          outputs_summary: { irr_pct: 22 },
        },
        {
          id: 'mut1',
          kind: 'mutation',
          event_type: 'stage_changed',
          actor: { name: 'Rachit Jain' },
          before: { stage: 'sourced' },
          after: { stage: 'screening' },
          metadata: {},
          created_at: new Date(Date.now() - 60000).toISOString(),
        },
      ],
      isLoading: false,
    };
    renderWithClient(<AuditTab />);
    expect(screen.getByText(/1 signed financial event/)).toBeInTheDocument();
    expect(screen.getByText(/1 mutation event/)).toBeInTheDocument();
  });
});

// ── Filter chips, CSV export, bulk-batch peek ──────────────────────────────

describe('AuditTab UX upgrades', () => {
  const mixedFeed = () => ({
    data: [
      {
        id: 'fin1',
        event_type: 'calculate_and_save',
        actor: { name: 'Rachit Jain' },
        inputs_hash: 'a'.repeat(64),
        outputs_hash: 'b'.repeat(64),
        signature: 'c'.repeat(64),
        created_at: new Date().toISOString(),
        outputs_summary: { irr_pct: 22 },
      },
      {
        id: 'mut1',
        kind: 'mutation',
        event_type: 'bulk_archived',
        actor: { name: 'Rachit Jain' },
        before: { is_archived: false },
        after: { is_archived: true },
        metadata: { bulk_id: 'batch-xyz', bulk_size: 4 },
        created_at: new Date(Date.now() - 60000).toISOString(),
      },
    ],
    isLoading: false,
  });

  it('renders the filter chips with counts and lets the user filter to mutations', () => {
    eventsState = mixedFeed();
    renderWithClient(<AuditTab />);
    // Three chips
    const allChip = screen.getByRole('tab', { name: /^All/ });
    const finChip = screen.getByRole('tab', { name: /^Financial/ });
    const mutChip = screen.getByRole('tab', { name: /^Mutations/ });
    expect(allChip).toHaveAttribute('aria-selected', 'true');
    expect(finChip).toHaveAttribute('aria-selected', 'false');
    expect(mutChip).toHaveAttribute('aria-selected', 'false');

    // Click Mutations — financial row should drop out of view.
    fireEvent.click(mutChip);
    expect(mutChip).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Archived (bulk)')).toBeInTheDocument();
    expect(screen.queryByText('Calculate & Save')).not.toBeInTheDocument();

    // Click Financial — bulk row should drop out, financial row visible.
    fireEvent.click(finChip);
    expect(finChip).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Calculate & Save')).toBeInTheDocument();
    expect(screen.queryByText('Archived (bulk)')).not.toBeInTheDocument();
  });

  it('opens the bulk-batch peek when "View batch" is clicked on a bulk-event row', async () => {
    eventsState = mixedFeed();
    bulkBatchMock.mockResolvedValueOnce({
      data: {
        data: [
          { deal_id: 'd-test', deal_name: 'This deal', deal_stage: 'screening', deal_is_archived: true,  event_type: 'bulk_archived', created_at: new Date().toISOString() },
          { deal_id: 'd-2',     deal_name: 'Other deal', deal_stage: 'screening', deal_is_archived: true, event_type: 'bulk_archived', created_at: new Date().toISOString() },
        ],
      },
    });
    renderWithClient(<AuditTab />);
    const viewBtn = screen.getByRole('button', { name: /View batch/ });
    fireEvent.click(viewBtn);
    // Modal renders with a header
    expect(screen.getByRole('dialog', { name: /Bulk batch/i })).toBeInTheDocument();
    // Wait for fetch
    await new Promise((r) => setTimeout(r, 20));
    expect(bulkBatchMock).toHaveBeenCalledWith('batch-xyz');
    expect(screen.getByText('Other deal')).toBeInTheDocument();
    // Two matches expected: the deal name "This deal" and the
    // "(this deal)" highlight badge for the row that matches the
    // currentDealId. Asserting on the badge specifically.
    expect(screen.getByText(/^\(this deal\)$/i)).toBeInTheDocument();
  });
});
