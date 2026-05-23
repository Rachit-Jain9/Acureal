import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import AttentionPanel from '../AttentionPanel';

// Mock the API the hook calls. Keeping it at the api layer (not the hook
// layer) keeps the test honest about how the hook wires up.
vi.mock('../../../services/api', () => ({
  dashboardAPI: {
    attention: vi.fn(),
  },
}));

import { dashboardAPI } from '../../../services/api';

const renderPanel = () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AttentionPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const wrap = (payload) => ({ data: { data: payload } });
const emptyPayload = {
  generated_at: new Date().toISOString(),
  totals: {
    overdue_dd: 0, expiring_approvals: 0, new_risk_flags: 0,
    stale_deals: 0, any: false,
  },
  overdue_dd_items: [],
  expiring_approvals: [],
  new_risk_flags: [],
  stale_deals: [],
  recent_activity: [],
  thresholds: { stale_deal_days: 14, new_risk_window_days: 7, expiring_window_days: 30 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AttentionPanel', () => {
  it('renders the "all caught up" empty state when every list is empty', async () => {
    dashboardAPI.attention.mockResolvedValueOnce(wrap(emptyPayload));
    renderPanel();
    expect(await screen.findByText(/All caught up/i)).toBeInTheDocument();
  });

  it('renders an overdue diligence row with the right deal context + days-over', async () => {
    dashboardAPI.attention.mockResolvedValueOnce(wrap({
      ...emptyPayload,
      totals: { ...emptyPayload.totals, overdue_dd: 1, any: true },
      overdue_dd_items: [{
        id: 'dd-1',
        deal_id: 'deal-1',
        item_name: 'Title search — EC 30y',
        category: 'title_ownership',
        severity: 'critical',
        due_date: '2026-05-01',
        days_overdue: 22,
        deal_name: 'Whitefield Land',
        deal_stage: 'due_diligence',
      }],
    }));
    renderPanel();
    expect(await screen.findByText('Title search — EC 30y')).toBeInTheDocument();
    expect(screen.getByText('Whitefield Land')).toBeInTheDocument();
    expect(screen.getByText('22d over')).toBeInTheDocument();
    // Row is a Link to the deal's DD tab.
    const row = screen.getByRole('link', { name: /Title search/i });
    expect(row.getAttribute('href')).toBe('/dashboard/deals/deal-1?tab=dd');
  });

  it('renders an expiring-approval row with days until expiry', async () => {
    dashboardAPI.attention.mockResolvedValueOnce(wrap({
      ...emptyPayload,
      totals: { ...emptyPayload.totals, expiring_approvals: 1, any: true },
      expiring_approvals: [{
        id: 'ap-1',
        deal_id: 'deal-1',
        name: 'RERA approval',
        approval_type: 'rera',
        expiry_date: '2026-06-15',
        days_until_expiry: 23,
        is_validated: true,
        status: 'approved',
        deal_name: 'Whitefield',
        deal_stage: 'underwriting',
      }],
    }));
    renderPanel();
    expect(await screen.findByText('RERA approval')).toBeInTheDocument();
    expect(screen.getByText(/23d/)).toBeInTheDocument();
  });

  it('renders a new-risk-flag row linking to the deal\'s risk tab', async () => {
    dashboardAPI.attention.mockResolvedValueOnce(wrap({
      ...emptyPayload,
      totals: { ...emptyPayload.totals, new_risk_flags: 1, any: true },
      new_risk_flags: [{
        id: 'rf-1',
        deal_id: 'deal-1',
        title: 'Title chain gap 1995-1998',
        severity: 'critical',
        category: 'title',
        status: 'open',
        source: 'manual',
        created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        deal_name: 'Whitefield',
        deal_stage: 'due_diligence',
      }],
    }));
    renderPanel();
    const link = await screen.findByRole('link', { name: /Title chain gap/i });
    expect(link.getAttribute('href')).toBe('/dashboard/deals/deal-1?tab=risk');
  });

  it('renders a stale-deal row linking to the deal overview', async () => {
    dashboardAPI.attention.mockResolvedValueOnce(wrap({
      ...emptyPayload,
      totals: { ...emptyPayload.totals, stale_deals: 1, any: true },
      stale_deals: [{
        id: 'deal-7',
        name: 'Old Sourced Lead',
        stage: 'sourced',
        last_activity_at: '2026-05-01T00:00:00Z',
        days_stale: 22,
      }],
    }));
    renderPanel();
    const link = await screen.findByRole('link', { name: /Old Sourced Lead/i });
    expect(link.getAttribute('href')).toBe('/dashboard/deals/deal-7');
    expect(screen.getByText('22d quiet')).toBeInTheDocument();
  });

  it('stale-deal row shows the DEAL NAME as the row title (regression: was rendering stage label as title)', async () => {
    dashboardAPI.attention.mockResolvedValueOnce(wrap({
      ...emptyPayload,
      totals: { ...emptyPayload.totals, stale_deals: 1, any: true },
      stale_deals: [{
        id: 'deal-7',
        name: 'Whitefield JV Phase 2',
        stage: 'due_diligence',
        last_activity_at: '2026-05-01T00:00:00Z',
        days_stale: 22,
      }],
    }));
    renderPanel();
    // The deal name must appear as the row's primary text — the bug
    // shipped on master briefly rendered the stage label ("Due
    // diligence") in its place, so the user couldn't identify the deal.
    expect(await screen.findByText('Whitefield JV Phase 2')).toBeInTheDocument();
    // And the stage label STILL renders, but as a secondary stage chip.
    expect(screen.getByText('Due diligence')).toBeInTheDocument();
  });

  it('renders the recent-activity footer with deal name + actor', async () => {
    dashboardAPI.attention.mockResolvedValueOnce(wrap({
      ...emptyPayload,
      totals: { ...emptyPayload.totals, new_risk_flags: 1, any: true },
      new_risk_flags: [{
        id: 'rf-1', deal_id: 'deal-1', title: 'A flag', severity: 'high',
        category: 'title', created_at: new Date().toISOString(),
        deal_name: 'Whitefield', deal_stage: 'due_diligence',
      }],
      recent_activity: [{
        id: 'a-1',
        deal_id: 'deal-1',
        type: 'note',
        description: 'Linked a document to a DD item',
        created_at: new Date().toISOString(),
        deal_name: 'Whitefield',
        deal_stage: 'due_diligence',
        performed_by_name: 'Rachit Jain',
      }],
    }));
    renderPanel();
    expect(await screen.findByText(/Latest across the portfolio/i)).toBeInTheDocument();
    expect(screen.getByText(/Linked a document to a DD item/)).toBeInTheDocument();
    expect(screen.getByText(/Rachit Jain/)).toBeInTheDocument();
  });

  it('omits empty sections — the panel only renders sections that have items', async () => {
    dashboardAPI.attention.mockResolvedValueOnce(wrap({
      ...emptyPayload,
      totals: { ...emptyPayload.totals, overdue_dd: 1, any: true },
      overdue_dd_items: [{
        id: 'dd-1', deal_id: 'deal-1', item_name: 'Only thing',
        category: 'title_ownership', severity: 'high', due_date: '2026-05-01',
        days_overdue: 3, deal_name: 'Deal', deal_stage: 'due_diligence',
      }],
    }));
    renderPanel();
    expect(await screen.findByText('Only thing')).toBeInTheDocument();
    // Other sections' headers should NOT appear when their lists are empty.
    expect(screen.queryByText(/Approvals expiring/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/New risks/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Stale/i)).not.toBeInTheDocument();
  });
});
