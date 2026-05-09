import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Tests the deal-page Audit tab. Mocks the events hook so we control
// the timeline directly + asserts on the rendered KPI deltas, the
// expand/collapse behaviour, and the empty / loading / error states.

let eventsState;
const verifyMutate = vi.fn();
const replayMutate = vi.fn();

vi.mock('../../../hooks/useDealContext', () => ({
  useDealContext: () => ({ dealId: 'd-test' }),
}));

vi.mock('../../../hooks/useDealEvents', () => ({
  useDealEvents: () => eventsState,
  useVerifyDealEvent: () => ({ mutate: verifyMutate, mutateAsync: verifyMutate, isPending: false }),
  useReplayDealEvent: () => ({ mutate: replayMutate, isPending: false }),
}));

import AuditTab, { attachDeltas } from '../AuditTab';

const renderWithClient = (ui) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  verifyMutate.mockReset();
  replayMutate.mockReset();
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
});
