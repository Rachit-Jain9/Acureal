import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import CompareDealsModal from '../CompareDealsModal';

// ─── Mock the deals API ────────────────────────────────────────────────────
// CompareDealsModal calls `dealsAPI.getWorkspace(id)` once per deal via
// useQueries. We return one fake workspace per id so each column has data.

const workspaces = {
  'd-whitefield': {
    deal: {
      id: 'd-whitefield', name: 'Whitefield Heights', stage: 'ic_review',
      asset_class: 'residential_apartments', deal_structure: 'outright',
    },
    financial: {
      summary: {
        irr_pct: 18.5, npv_cr: 45.2, dscr: 1.7, equity_multiple: 1.8,
        total_cost_cr: 250, total_revenue_cr: 320, developer_profit_cr: 35,
        gross_margin_pct: 18, land_cost_cr: 40,
      },
    },
    dd: { score: { total: 16, done: 14, percent: 87.5, dealBreakersOpen: 0 } },
    risk: {
      score: { postureCounts: { flagged: 1, unverified: 2, cleared: 3 }, openCritical: 0, openHigh: 1 },
    },
    approvals: [
      { is_required: true, is_available: true },
      { is_required: true, is_available: true },
      { is_required: true, is_available: false },
    ],
    documents: { documents: [{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}] },
    ic_readiness: { score: 78, tier: 'ic_ready', top_gaps: [] },
    promoter_profile: { posture: 'cleared' },
  },
  'd-jigani': {
    deal: {
      id: 'd-jigani', name: 'Jigani Apartments', stage: 'screening',
      asset_class: 'plotted_development', deal_structure: 'jda',
    },
    financial: {
      summary: {
        irr_pct: 22.3, npv_cr: 120, dscr: 1.4, equity_multiple: 2.1,
        total_cost_cr: 400, total_revenue_cr: 580, land_cost_cr: 80,
      },
    },
    dd: { score: { total: 16, done: 8, percent: 50, dealBreakersOpen: 4 } },
    risk: { score: { postureCounts: { flagged: 2, unverified: 1, cleared: 2 } } },
    approvals: [{ is_required: true }],
    documents: { documents: [{}, {}, {}] },
    ic_readiness: { score: 58, tier: 'pre_ic', top_gaps: [{ label: 'Land schedule incomplete' }] },
    promoter_profile: { posture: 'unverified' },
  },
};

vi.mock('../../../services/api', () => ({
  dealsAPI: {
    getWorkspace: vi.fn((id) =>
      Promise.resolve({ data: { data: workspaces[id] || null } }),
    ),
  },
}));

// ─── Test harness ─────────────────────────────────────────────────────────

const renderModal = (props = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CompareDealsModal
          open
          dealIds={['d-whitefield', 'd-jigani']}
          onClose={vi.fn()}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CompareDealsModal', () => {
  it('renders nothing when open=false', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CompareDealsModal open={false} dealIds={['d-whitefield']} onClose={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the modal title with the deal count', async () => {
    renderModal();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Compare deals · 2/i)).toBeInTheDocument();
  });

  it('renders deal names as links in the header row', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Whitefield Heights/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Jigani Apartments/i })).toBeInTheDocument();
    });
  });

  it('renders the headline IRR / NPV / DSCR values from the kernel', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByText('18.5%')).toBeInTheDocument(); // Whitefield IRR
      expect(screen.getByText('22.3%')).toBeInTheDocument(); // Jigani IRR
      expect(screen.getByText('1.70×')).toBeInTheDocument(); // Whitefield DSCR
      expect(screen.getByText('1.40×')).toBeInTheDocument(); // Jigani DSCR
    });
  });

  it('renders IC readiness score + tier with proper badge labels', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByText('78')).toBeInTheDocument();
      expect(screen.getByText('58')).toBeInTheDocument();
      expect(screen.getByText('IC-ready')).toBeInTheDocument();
      expect(screen.getByText('Pre-IC')).toBeInTheDocument();
    });
  });

  it('renders risk posture badges (flagged / unverified / cleared)', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByText('1 flagged')).toBeInTheDocument();
      expect(screen.getAllByText(/unverified/).length).toBeGreaterThan(0);
    });
  });

  it('renders deal-breaker count with appropriate tone', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByText('None')).toBeInTheDocument(); // Whitefield 0 breakers
      expect(screen.getByText('4')).toBeInTheDocument();    // Jigani 4 breakers
    });
  });

  it('renders DD progress as ratio + percentage', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByText('14 / 16')).toBeInTheDocument();
      expect(screen.getByText('(88%)')).toBeInTheDocument();
      expect(screen.getByText('8 / 16')).toBeInTheDocument();
      expect(screen.getByText('(50%)')).toBeInTheDocument();
    });
  });

  it('renders the top IC blocker for deals that have one', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByText(/Land schedule incomplete/i)).toBeInTheDocument();
    });
  });

  it('renders "No blocker" for deals with no top gap', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByText(/No blocker/i)).toBeInTheDocument();
    });
  });

  it('renders promoter posture badges', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByText('cleared')).toBeInTheDocument();
      // 'unverified' appears in both risk-posture badges and promoter posture
      expect(screen.getAllByText('unverified').length).toBeGreaterThan(0);
    });
  });

  it('fires onClose when the X button is clicked', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByLabelText(/Close comparison/i));
    expect(onClose).toHaveBeenCalled();
  });

  it('fires onClose when Escape is pressed inside the dialog', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    // Focus is trapped inside the dialog (useFocusTrap), so Escape is handled
    // at the dialog container — fire it from a focusable within, which is where
    // focus lands when the modal opens.
    fireEvent.keyDown(screen.getByLabelText(/Close comparison/i), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('fires onClose when the overlay is clicked outside the modal', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalled();
  });

  it('caps to 4 deals (extras silently dropped)', async () => {
    renderModal({ dealIds: ['d-whitefield', 'd-jigani', 'd-x', 'd-y', 'd-z'] });
    await waitFor(() => {
      // header shows the capped count
      expect(screen.getByText(/Compare deals · 4/i)).toBeInTheDocument();
    });
  });

  it('includes the disclaimer footer', async () => {
    renderModal();
    expect(screen.getByText(/organisation aid/i)).toBeInTheDocument();
    expect(screen.getByText(/never an IC verdict/i)).toBeInTheDocument();
  });
});
