import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import DependentsPopover from '../DependentsPopover';

// Mock the api module — we don't want to hit a network in unit tests.
const sampleResponse = {
  supported: true,
  note: null,
  owners: [
    {
      link_id: 'link-1',
      owner_kind: 'dd_item',
      owner_id: 'dd-1',
      owner_label: 'Title chain verified by lawyer',
      deal_id: 'deal-a',
      deal_name: 'Whitefield Heights',
      confidence_score: 0.92,
      verified_at: '2026-05-20T00:00:00Z',
      link_created_at: '2026-05-20T00:00:00Z',
    },
    {
      link_id: 'link-2',
      owner_kind: 'approval',
      owner_id: 'ap-1',
      owner_label: 'BBMP plan sanction',
      deal_id: 'deal-a',
      deal_name: 'Whitefield Heights',
      confidence_score: 0.85,
      verified_at: null,
      link_created_at: '2026-05-21T00:00:00Z',
    },
  ],
  grouped: { dd_item: 1, approval: 1 },
};

vi.mock('../../../services/api', () => ({
  evidenceLinksAPI: {
    dependents: vi.fn(() => Promise.resolve({ data: { data: sampleResponse } })),
  },
}));

const harness = (props) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DependentsPopover sourceKind="document" sourceId="doc-uuid-1" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => { vi.clearAllMocks(); });

describe('DependentsPopover', () => {
  it('renders a default trigger with the configured label', () => {
    harness({ triggerLabel: 'Show dependents' });
    expect(screen.getByRole('button', { name: /show dependents/i })).toBeInTheDocument();
  });

  it('does NOT call the API until the user clicks the trigger', async () => {
    const apiModule = await import('../../../services/api');
    harness();
    expect(apiModule.evidenceLinksAPI.dependents).not.toHaveBeenCalled();
  });

  it('opens the popover and fires the dependents API on first click', async () => {
    const apiModule = await import('../../../services/api');
    harness();
    fireEvent.click(screen.getByRole('button', { name: /what depends on this/i }));
    await waitFor(() => {
      expect(apiModule.evidenceLinksAPI.dependents).toHaveBeenCalledWith('document', 'doc-uuid-1');
    });
  });

  it('renders the count summary + per-kind chips after the API resolves', async () => {
    harness();
    fireEvent.click(screen.getByRole('button', { name: /what depends on this/i }));
    await waitFor(() => {
      expect(screen.getByText(/2 items cite this source/i)).toBeInTheDocument();
    });
    // Per-kind chip + the row's eyebrow both say "DD item" / "Approval".
    // The summary chip is uniquely identifiable by being inside the heading
    // group with the count number next to it.
    expect(screen.getAllByText(/DD item/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Approval/i).length).toBeGreaterThan(0);
  });

  it('renders each owner row with its label + parent deal link', async () => {
    harness();
    fireEvent.click(screen.getByRole('button', { name: /what depends on this/i }));
    await waitFor(() => {
      expect(screen.getByText(/Title chain verified by lawyer/i)).toBeInTheDocument();
      expect(screen.getByText(/BBMP plan sanction/i)).toBeInTheDocument();
    });
    const dealLinks = screen.getAllByRole('link', { name: /Whitefield Heights/i });
    expect(dealLinks.length).toBe(2);
    expect(dealLinks[0].getAttribute('href')).toBe('/deals/deal-a');
    expect(dealLinks[0].getAttribute('target')).toBe('_blank');
  });

  it('renders the confidence chip when confidence_score is present', async () => {
    harness();
    fireEvent.click(screen.getByRole('button', { name: /what depends on this/i }));
    await waitFor(() => {
      expect(screen.getByText(/92% confidence/i)).toBeInTheDocument();
      expect(screen.getByText(/85% confidence/i)).toBeInTheDocument();
    });
  });

  it('closes on Escape', async () => {
    harness();
    fireEvent.click(screen.getByRole('button', { name: /what depends on this/i }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('renders the "Nothing currently cites this" empty state when owners array is empty', async () => {
    const apiModule = await import('../../../services/api');
    apiModule.evidenceLinksAPI.dependents.mockResolvedValueOnce({
      data: { data: { owners: [], grouped: {}, supported: true, note: null } },
    });
    harness();
    fireEvent.click(screen.getByRole('button', { name: /what depends on this/i }));
    await waitFor(() => {
      expect(screen.getByText(/Nothing currently cites this/i)).toBeInTheDocument();
    });
  });

  it('renders the note when the response is supported=false (comp special case)', async () => {
    const apiModule = await import('../../../services/api');
    apiModule.evidenceLinksAPI.dependents.mockResolvedValueOnce({
      data: { data: { owners: [], grouped: {}, supported: false, note: 'Comp reverse-lookup runs through the comp_reliance signal layer, not evidence_links.' } },
    });
    harness({ sourceKind: 'comp', sourceId: 'comp-id-1' });
    fireEvent.click(screen.getByRole('button', { name: /what depends on this/i }));
    await waitFor(() => {
      expect(screen.getByText(/comp_reliance signal layer/i)).toBeInTheDocument();
    });
  });

  it('respects renderTrigger render-prop for custom trigger embedding', async () => {
    const renderTrigger = vi.fn(({ onOpen }) => (
      <button type="button" data-testid="custom-trigger" onClick={onOpen}>Custom</button>
    ));
    harness({ renderTrigger });
    expect(renderTrigger).toHaveBeenCalled();
    expect(screen.getByTestId('custom-trigger')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /what depends on this/i })).not.toBeInTheDocument();
  });
});
